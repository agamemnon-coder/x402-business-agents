// Read-back and reconciliation after a sync (Moneybird sandbox run, 12 November 2026): every purchase invoice the ERP
// holds for Purser is read again from the ERP and set next to Purser's own ledger, to the cent: net, VAT, gross, the
// amount paid and whether it is paid. The result is data, and it is computed: each difference is named with both
// amounts; none is assumed away.
//
// Three kinds of document are read:
//   - "invoice": an invoice as the ledger holds it now (for a corrected one, its new version);
//   - "replaced": the version a correction replaced, which the ERP keeps;
//   - "credit_note": the credit note that cancels that version.
// A replaced version and its credit note are set against the totals the correction recorded for what it cancelled
// (the audit log's erp.corrected row); they must be each other's opposite.

import type { DB } from "../db/open.js";
import type { MoneybirdDocument } from "./moneybird.js";
import type { Payment, PurchaseInvoice } from "./model.js";
import { ledgerItems } from "./source.js";
import { syncStatus, type SyncItem } from "./sync.js";

/** Whole cents as "12.34" (a sign only when negative); "-" when there is no amount. */
export const cents = (c: number | null): string => {
  if (c === null) return "-";
  const a = Math.abs(c);
  return `${c < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

export interface Side { net: string; vat: string; gross: string; paid: string; state: string }
export interface ReconcileRow {
  role: "invoice" | "replaced" | "credit_note";
  /** The invoice's id in Purser's ledger and its supplier's own number. */
  invoice: string;
  number: string;
  /** The ERP's id of the document, as a string. */
  external_id: string;
  purser: Side;
  erp: Side & { reference: string | null; attachments: number; payments: number; lines: { ledger_account_id: string | null; tax_rate_id: string | null; price: string }[] };
  differences: string[];
}
export interface Reconciliation {
  connector: string;
  read_at: string;
  documents: number;
  differences: number;
  rows: ReconcileRow[];
  /** Objects that could not be set next to the ERP at all (not sent, or waiting for a person), with the reason. */
  not_compared: { invoice: string; reason: string }[];
}

/** Moneybird's states for a purchase invoice that mean "not paid yet". */
const OPEN_STATES = new Set(["new", "open", "late", "pending_payment"]);
const stateOf = (state: string) => (state === "paid" ? "paid" : OPEN_STATES.has(state) ? "open" : state || "unknown");

function compare(want: { net: number; vat: number; gross: number; paid: number | null; state: string | null; pdf: boolean }, doc: MoneybirdDocument): { purser: Side; erp: ReconcileRow["erp"]; differences: string[] } {
  const vat = doc.netCents === null || doc.grossCents === null ? null : doc.grossCents - doc.netCents;
  const paid = doc.payments.reduce((s, p) => s + (p.cents ?? 0), 0);
  const d: string[] = [];
  const amount = (what: string, purser: number, erp: number | null) => { if (erp !== purser) d.push(`${what}: Purser ${cents(purser)}, the ERP ${cents(erp)}`); };
  amount("net", want.net, doc.netCents);
  amount("VAT", want.vat, vat);
  amount("gross", want.gross, doc.grossCents);
  if (want.paid !== null) amount("paid", want.paid, paid);
  const state = stateOf(doc.state);
  if (want.state !== null && state !== want.state) d.push(`state: Purser ${want.state}, the ERP ${doc.state || "none"}`);
  if (want.pdf && doc.attachments === 0) d.push("the PDF is not attached in the ERP");
  if (doc.payments.some((p) => p.cents === null)) d.push("a payment in the ERP has no readable amount");
  return {
    purser: { net: cents(want.net), vat: cents(want.vat), gross: cents(want.gross), paid: want.paid === null ? "-" : cents(want.paid), state: want.state ?? "-" },
    erp: {
      net: cents(doc.netCents), vat: cents(vat), gross: cents(doc.grossCents), paid: cents(paid), state: doc.state, reference: doc.reference, attachments: doc.attachments, payments: doc.payments.length,
      lines: doc.lines.map((l) => ({ ledger_account_id: l.ledgerAccountId, tax_rate_id: l.taxRateId, price: cents(l.cents) })),
    },
    differences: d,
  };
}

/**
 * Reads every purchase invoice the ERP holds for this connector and compares it with the ledger. `read` is the
 * connector's read-back of one document (one request each); `items` is what the ledger feeds the ERP now.
 */
export async function reconcile(db: DB, connector: string, read: (externalId: string) => Promise<MoneybirdDocument>, o: { items?: SyncItem[]; now?: () => Date } = {}): Promise<Reconciliation> {
  const items = o.items ?? ledgerItems(db);
  const invoices = new Map(items.filter((i) => i.kind === "invoice").map((i) => [i.object.id, i.object as PurchaseInvoice]));
  const paidOf = (invoiceId: string) => items.filter((i) => i.kind === "payment" && (i.object as Payment).invoiceId === invoiceId).reduce((s, i) => s + (i.object as Payment).amountCents, 0);
  const rows: ReconcileRow[] = [];
  const notCompared: Reconciliation["not_compared"] = [];
  const synced = syncStatus(db, connector).filter((r) => r.kind === "invoice");
  for (const [id] of invoices) if (!synced.some((r) => r.object_id === id)) notCompared.push({ invoice: id, reason: "not sent to the ERP" });
  // The corrections on record: which document each replaced, its credit note, and the totals it cancelled.
  const corrections = (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'erp.corrected' ORDER BY seq").all() as { subject: string; payload_json: string }[])
    .map((r) => ({ subject: r.subject, p: JSON.parse(r.payload_json) as { connector?: string; credit_note?: string; replaced?: string; credited_net_cents?: number; credited_vat_cents?: number; credited_gross_cents?: number } }))
    .filter((r) => r.p.connector === connector && r.subject.startsWith(`${connector}:invoice:`));

  for (const r of synced) {
    const inv = invoices.get(r.object_id);
    if (!r.external_id || (r.status !== "synced" && r.status !== "needs_correction")) { notCompared.push({ invoice: r.object_id, reason: `${r.status.replace(/_/g, " ")} in the ERP link${r.last_error ? `: ${r.last_error}` : ""}` }); continue; }
    if (!inv) { notCompared.push({ invoice: r.object_id, reason: "sent to the ERP, and no longer in the ledger's feed" }); continue; }
    const paid = paidOf(inv.id);
    const want = { net: inv.totals.netCents, vat: inv.totals.vatCents, gross: inv.totals.grossCents, paid, state: paid >= inv.totals.grossCents && inv.totals.grossCents > 0 ? "paid" : "open", pdf: !!inv.pdf };
    rows.push({ role: "invoice", invoice: inv.id, number: inv.number, external_id: r.external_id, ...compare(want, await read(r.external_id)) });
    for (const c of corrections.filter((x) => x.subject === `${connector}:invoice:${inv.id}`)) {
      const known = c.p.credited_net_cents !== undefined && c.p.credited_vat_cents !== undefined && c.p.credited_gross_cents !== undefined;
      for (const [role, ext, sign] of [["replaced", c.p.replaced, 1], ["credit_note", c.p.credit_note, -1]] as const) {
        if (!ext) continue;
        if (!known) { notCompared.push({ invoice: `${inv.id} (${role.replace("_", " ")} ${ext})`, reason: "the correction recorded no totals for the version it cancelled" }); continue; }
        // Purser holds no payment state for a cancelled version or its credit note: amounts only.
        const cancelled = { net: sign * c.p.credited_net_cents!, vat: sign * c.p.credited_vat_cents!, gross: sign * c.p.credited_gross_cents!, paid: null, state: null, pdf: false };
        rows.push({ role, invoice: inv.id, number: inv.number, external_id: ext, ...compare(cancelled, await read(ext)) });
      }
    }
  }
  return { connector, read_at: (o.now ?? (() => new Date()))().toISOString(), documents: rows.length, differences: rows.reduce((s, r) => s + r.differences.length, 0), rows, not_compared: notCompared };
}

/** The reconciliation as lines for a terminal: one per document, its differences under it. */
export function reconciliationLines(r: Reconciliation): string[] {
  const out: string[] = [];
  for (const row of r.rows) {
    out.push(`${row.role.replace("_", " ").padEnd(11)} ${row.number.padEnd(14)} ${row.external_id}  net ${row.erp.net}  VAT ${row.erp.vat}  gross ${row.erp.gross}  paid ${row.erp.paid}  ${row.erp.state}  ${row.differences.length ? "DIFFERS" : "equal"}`);
    for (const d of row.differences) out.push(`    ${d}`);
  }
  for (const n of r.not_compared) out.push(`not compared: ${n.invoice}: ${n.reason}`);
  out.push(`${r.differences} differences in ${r.documents} documents read back`);
  return out;
}
