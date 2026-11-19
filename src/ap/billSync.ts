// Airwallex Spend Bills sync (AIRWALLEX_BILLS=on; off by default): each invoice Purser pays becomes a Bill in Airwallex's
// own accounts payable, with the invoice PDF attached, and is marked paid there once its transfer is PAID. The CFO then
// sees the bills the agents paid in Airwallex itself, next to the transfers. Run from syncPayments (src/ap/pay.ts), after
// the payouts were followed; it never fails the sync: an error is recorded (awx_bill.failed) and tried on the next sync.
//
// The bill's external_id is the terms hash the CFO signed (approvals.approved_sha256, a person's approval only), which
// the transfer already carries as metadata.approval_sha256; an invoice paid with no person's signature (code approved it
// within the CFO's limit to pay alone) uses Purser's invoice id instead. A signed hash that differs from the transfer's
// is never sent: the bill is refused and a person looks.
//
// Airwallex keeps neither external_id nor request_id unique for us in a way we can look up (probe of 19 November,
// src/airwallex/bills.ts), so the ledger's own row (awx_bill.created) is the first guard, then a full listing matched on
// external_id, then a request_id derived from the invoice and its hash (a resend is refused by Airwallex, never doubled).
// A lost answer is left ambiguous and resolved by that listing on the next sync. Every bill is read back and compared.

import { AirwallexAmbiguous } from "../airwallex/client.js";
import { attachmentName, seededUuid, vendorExternalId, type AwxBill, type BillsRail } from "../airwallex/bills.js";
import { toCents } from "../lib/money.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { readDoc } from "./docStore.js";
import { apInvoice, type ApInvoiceRow } from "./store.js";

export const BILL_CREATED = "awx_bill.created";
export const BILL_PAID = "awx_bill.paid";

export type ExternalIdKind = "approval_sha256" | "invoice_id";

interface PayRow { proposal_id: string; terms_sha256: string; transfer_id: string; transfer_status: string; approval_sha256: string; approved_sha256: string | null; method: string | null }

export interface BillLine {
  invoice: string;
  invoice_no: string;
  step: "created" | "adopted" | "paid" | "skipped" | "refused" | "ambiguous" | "failed";
  bill_id: string | null;
  detail: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
type J = Record<string, unknown>;

const payRow = (db: DB, proposalId: string): PayRow | undefined => db.prepare(`SELECT p.proposal_id, p.terms_sha256, t.transfer_id, t.status AS transfer_status, t.approval_sha256,
    a.approved_sha256, a.method FROM proposals p
    JOIN transfers t ON t.request_id = json_extract(p.terms_json, '$.transfer_request_id')
    LEFT JOIN approvals a ON a.proposal_id = p.proposal_id AND a.decision = 'APPROVED'
    WHERE p.proposal_id = ? AND t.transfer_id IS NOT NULL`).get(proposalId) as PayRow | undefined;

/** The last audit payload of this event for this invoice, or null. */
const last = (db: DB, event: string, invoiceId: string): J | null => {
  const r = db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq DESC LIMIT 1").get(event, invoiceId) as { payload_json: string } | undefined;
  return r ? (JSON.parse(r.payload_json) as J) : null;
};

/**
 * The bill's external_id: the hash a person signed (and the transfer carries), else the invoice id when no person
 * signed. A refusal (a string) when the signed hash and the transfer's disagree.
 */
export function billExternalId(inv: Pick<ApInvoiceRow, "id">, pay: Pick<PayRow, "approved_sha256" | "method" | "approval_sha256" | "terms_sha256">): { externalId: string; kind: ExternalIdKind } | string {
  const signed = pay.approved_sha256 && pay.method && pay.method !== "policy" ? pay.approved_sha256 : null;
  if (!signed) return { externalId: inv.id, kind: "invoice_id" };
  if (!HEX64.test(signed)) return `the signed hash of ${inv.id} is not a SHA-256`;
  if (signed !== pay.approval_sha256 || signed !== pay.terms_sha256) return `the transfer's approval_sha256 is not the hash the CFO signed for ${inv.id}; no bill is sent`;
  return { externalId: signed, kind: "approval_sha256" };
}

/** What a bill read back from Airwallex must hold for this invoice; the differences, or none. */
export function billDifferences(bill: AwxBill, want: { externalId: string; invoiceNo: string; currency: string; total: string; vendorId?: string; attachmentIds?: string[]; status?: string }): string[] {
  const d: string[] = [];
  if (bill.externalId !== want.externalId) d.push(`external_id ${bill.externalId || "-"} is not ${want.externalId}`);
  if (bill.invoiceNumber !== want.invoiceNo) d.push(`invoice_number ${bill.invoiceNumber || "-"} is not ${want.invoiceNo}`);
  if (bill.currency !== want.currency) d.push(`billing_currency ${bill.currency || "-"} is not ${want.currency}`);
  const same = ((): boolean => { try { return toCents(bill.amount) === toCents(want.total); } catch { return false; } })();
  if (!same) d.push(`billing_amount ${bill.amount || "-"} is not ${want.total}`);
  if (want.vendorId && bill.vendorId !== want.vendorId) d.push("the bill names another vendor");
  for (const a of want.attachmentIds ?? []) if (!bill.attachmentIds.includes(a)) d.push(`attachment ${a} is missing`);
  if (want.status && bill.status !== want.status) d.push(`status ${bill.status || "-"} is not ${want.status}`);
  return d;
}

/** Airwallex's vendor for this supplier: the one Purser recorded, else one listed with its external_id, else a new one. */
async function vendorFor(db: DB, rail: BillsRail, name: string, legalEntityId: string, now: Date): Promise<string> {
  const ext = vendorExternalId(name);
  const known = db.prepare("SELECT json_extract(payload_json, '$.vendor_id') AS id FROM audit_log WHERE event = 'awx_vendor.created' AND subject = ? ORDER BY seq DESC LIMIT 1").get(ext) as { id: string | null } | undefined;
  if (known?.id) return known.id;
  const found = await rail.findVendor(ext);
  const v = found ?? await rail.createVendor({ requestId: seededUuid(`purser-vendor:${ext}`), externalId: ext, name: name.slice(0, 200), legalEntityId });
  audit(db, "system", "awx_vendor.created", ext, { vendor_id: v.id, status: v.status, how: found ? "found at Airwallex by its external_id" : "created at Airwallex" }, now);
  return v.id;
}

/** The invoice's PDF, uploaded once (awx_bill.attachment); null when the document cannot be read (said why). */
async function attachmentFor(db: DB, rail: BillsRail, inv: ApInvoiceRow, now: Date): Promise<{ fileId: string | null; why: string | null }> {
  const had = last(db, "awx_bill.attachment", inv.id);
  if (typeof had?.file_id === "string") return { fileId: had.file_id, why: null };
  const doc = db.prepare("SELECT path FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string } | undefined;
  let bytes: Buffer;
  try { bytes = readDoc(db, doc?.path ?? ""); } catch { return { fileId: null, why: "the invoice's PDF could not be read from the ledger's document store" }; }
  const up = await rail.uploadAttachment({ bytes, fileName: attachmentName(inv.invoice_no), notes: `Purser ${inv.id}` });
  audit(db, "system", "awx_bill.attachment", inv.id, { file_id: up.fileId, size: up.size, doc_sha256: inv.doc_sha256, purpose: "SPEND_ATTACHMENT" }, now);
  return { fileId: up.fileId, why: null };
}

const describeBill = (inv: ApInvoiceRow, pay: PayRow, kind: ExternalIdKind): string =>
  `Paid by Purser: ${inv.vendor} invoice ${inv.invoice_no}, proposal ${pay.proposal_id}, Airwallex transfer ${pay.transfer_id}. `
  + (kind === "approval_sha256" ? "external_id is the SHA-256 of the terms the CFO signed (the transfer's approval_sha256)." : "No signature: approved by code within the CFO's limit; external_id is Purser's invoice id.");

/** One invoice: its bill made (or found) and checked; marked paid once the invoice is paid and its transfer PAID. */
async function syncOne(db: DB, rail: BillsRail, inv: ApInvoiceRow, now: Date): Promise<BillLine | null> {
  const line = (step: BillLine["step"], bill: string | null, detail: string): BillLine => ({ invoice: inv.id, invoice_no: inv.invoice_no, step, bill_id: bill, detail });
  const pay = payRow(db, inv.proposal_id!);
  if (!pay) return null;
  let created = last(db, BILL_CREATED, inv.id);
  if (!created) {
    if (["FAILED", "CANCELLED"].includes(pay.transfer_status)) return null;
    const ext = billExternalId(inv, pay);
    if (typeof ext === "string") {
      if (!last(db, "awx_bill.refused", inv.id)) audit(db, "system", "awx_bill.refused", inv.id, { reason: ext }, now);
      return line("refused", null, ext);
    }
    const want = { externalId: ext.externalId, invoiceNo: inv.invoice_no, currency: inv.currency, total: inv.total };
    // Airwallex keeps external_id unique for no one: a bill already there under this external_id is this one.
    const there = await rail.findBills(ext.externalId);
    if (there.length > 1) {
      audit(db, "system", "awx_bill.refused", inv.id, { reason: `Airwallex holds ${there.length} bills with external_id ${ext.externalId}; a person picks one`, bill_ids: there.map((b) => b.id) }, now);
      return line("refused", null, `${there.length} bills at Airwallex under one external_id`);
    }
    let bill: AwxBill;
    let how: "created" | "adopted";
    let attachment: { fileId: string | null; why: string | null } = { fileId: null, why: null };
    if (there[0]) {
      bill = there[0];
      how = "adopted";
    } else {
      const legalEntityId = await rail.legalEntityId();
      const vendorId = await vendorFor(db, rail, inv.vendor, legalEntityId, now);
      attachment = await attachmentFor(db, rail, inv, now);
      const requestId = seededUuid(`purser-bill:${inv.id}:${ext.externalId}`);
      try {
        bill = await rail.createBill({
          requestId, externalId: ext.externalId, invoiceNumber: inv.invoice_no, currency: inv.currency, total: inv.total,
          issuedDate: inv.issue_date, dueDate: inv.due_date, legalEntityId, vendorId,
          lineDescription: `${inv.vendor} invoice ${inv.invoice_no}`.slice(0, 200), description: describeBill(inv, pay, ext.kind),
          attachmentIds: attachment.fileId ? [attachment.fileId] : [],
        });
      } catch (e) {
        if (!(e instanceof AirwallexAmbiguous)) throw e;
        audit(db, "system", "awx_bill.ambiguous", inv.id, { request_id: requestId, external_id: ext.externalId, note: "no answer to the create; the next sync lists Airwallex's bills by external_id, never resends" }, now);
        return line("ambiguous", null, "no answer to the create: looked up on the next sync");
      }
      how = "created";
    }
    // Read back by id: what Airwallex holds, not what it answered.
    const back = await rail.getBill(bill.id);
    const diff = billDifferences(back, { ...want, ...(how === "created" ? { vendorId: bill.vendorId, attachmentIds: attachment.fileId ? [attachment.fileId] : [] } : {}) });
    audit(db, "system", BILL_CREATED, inv.id, {
      bill_id: back.id, how, external_id: ext.externalId, external_id_is: ext.kind, invoice_no: inv.invoice_no, amount: `${back.currency} ${back.amount}`,
      status: back.status, attachment_ids: back.attachmentIds, attachment_note: attachment.why, proposal_id: pay.proposal_id, transfer_id: pay.transfer_id,
      read_back: diff.length ? "differs" : "agrees", differences: diff, created_at: back.createdAt,
    }, now);
    created = last(db, BILL_CREATED, inv.id);
    if (diff.length) return line("refused", back.id, `read back differs: ${diff.join("; ")}`);
    if (!(inv.status === "paid" && pay.transfer_status === "PAID")) return line(how, back.id, `${back.status}, external_id ${ext.kind}`);
  }
  const billId = String(created!.bill_id);
  if (created!.read_back !== "agrees") return null;
  const paid = last(db, BILL_PAID, inv.id);
  if (paid) {
    // Airwallex cannot take back a bill marked paid; a payout that came back after it goes to a person, once.
    if (["FAILED", "CANCELLED"].includes(pay.transfer_status) && !last(db, "awx_bill.payout_returned", inv.id)) {
      audit(db, "system", "awx_bill.payout_returned", inv.id, { bill_id: billId, transfer_id: pay.transfer_id, transfer_status: pay.transfer_status, note: "the bill is PAID at Airwallex but its payout came back; a person corrects the bill in Airwallex" }, now);
      return line("refused", billId, "payout came back after the bill was marked paid");
    }
    return null;
  }
  if (!(inv.status === "paid" && pay.transfer_status === "PAID")) return null;
  await rail.markPaid(billId);
  const back = await rail.getBill(billId);
  const diff = billDifferences(back, { externalId: String(created!.external_id), invoiceNo: inv.invoice_no, currency: inv.currency, total: inv.total, status: "PAID" });
  audit(db, "system", BILL_PAID, inv.id, {
    bill_id: billId, external_id: String(created!.external_id), status: back.status, transfer_id: pay.transfer_id,
    payments: back.payments.map((p) => ({ id: p.id, type: p.type, amount: `${p.currency} ${p.amount}`, transfer_id: p.transferId })),
    read_back: diff.length ? "differs" : "agrees", differences: diff, updated_at: back.updatedAt,
    link: "mark_as_paid takes no transfer: the transfer is named in the bill's description",
  }, now);
  return line(diff.length ? "refused" : "paid", billId, diff.length ? `read back differs: ${diff.join("; ")}` : `PAID (${back.payments.map((p) => p.type).join(", ") || "no payment listed"})`);
}

/** Every invoice Purser paid (or is paying), as a bill at Airwallex. Errors are recorded per invoice, never thrown. */
export async function syncBills(db: DB, rail: BillsRail, opts: { now?: () => Date } = {}): Promise<BillLine[]> {
  const now = (opts.now ?? (() => new Date()))();
  const ids = db.prepare(`SELECT i.id FROM ap_invoices i JOIN proposals p ON p.proposal_id = i.proposal_id
    WHERE i.status IN ('waiting_cfo', 'paid') AND p.status = 'EXECUTED' ORDER BY i.received_at, i.id`).all() as { id: string }[];
  const out: BillLine[] = [];
  for (const { id } of ids) {
    const inv = apInvoice(db, id)!;
    try {
      const l = await syncOne(db, rail, inv, now);
      if (l) out.push(l);
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string };
      audit(db, "system", "awx_bill.failed", id, { http_status: err.status ?? null, code: err.code ?? null, error: err.message.slice(0, 200), note: "tried again on the next sync" }, now);
      out.push({ invoice: id, invoice_no: inv.invoice_no, step: "failed", bill_id: null, detail: err.message.slice(0, 200) });
    }
  }
  return out;
}
