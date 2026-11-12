// The accountant's export of one month (closing a month): every journal entry posted in the month with its lines, as
// CSV and as JSON. Per entry it says where the entry comes from: the hash of the document behind it (the entry's own,
// or the supplier invoice's), the hash of the payment terms the CFO approved for that invoice, and the payment's id
// at Airwallex (the transfer id, else Purser's request id). What the ledger cannot show is left empty, never guessed.
// The JSON also says whether the period is locked (by whom, when) and holds the check of the ledger's whole chain.

import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import type { DB } from "../db/open.js";
import { csvCell } from "../lib/csv.js";
import { fromCents } from "../lib/money.js";
import { LEDGER_ACCOUNTS as CHART } from "./accounts.js";
import { ledgerRows, verifyLedgerRows, type LedgerCheck, type LedgerEntry } from "./core.js";
import { periodState, type PeriodState } from "./pack.js";

export interface ExportLine {
  account: string;
  account_name: string;
  debit: string;
  credit: string;
  currency: string;
  cost_centre: string;
  vat_code: string;
  vat: string;
  party: string;
  doc_ref: string;
  memo: string;
}

export interface ExportEntry {
  entry: number;
  posting_date: string;
  doc_date: string;
  description: string;
  source_key: string;
  entry_hash: string;
  /** The document behind the entry: the entry's own hash, or the supplier invoice's; "" when the ledger shows none. */
  doc_sha256: string;
  /** The payment terms hash the CFO approved for that invoice; "" when there is none. */
  terms_sha256: string;
  /** The payment at Airwallex: its transfer id, else Purser's request id; "" when there is none. */
  payment_id: string;
  lines: ExportLine[];
}

export interface AccountantExport {
  month: string;
  period: PeriodState;
  /** The whole ledger's chain check (src/ledger/core.ts verifyLedgerRows). */
  chain: LedgerCheck;
  entries: ExportEntry[];
}

const signed = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));

interface Invoice { id: string; doc_sha256: string; proposal_id: string | null; key: string }

/** Where each entry comes from, from the ledger's own records. */
function provenance(db: DB) {
  const hasAp = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ap_invoices'").get();
  const invoices: Invoice[] = hasAp
    ? (db.prepare("SELECT id, doc_sha256, proposal_id, invoice_no, vendor FROM ap_invoices ORDER BY id").all() as { id: string; doc_sha256: string; proposal_id: string | null; invoice_no: string; vendor: string }[])
      .map((i) => ({ id: i.id, doc_sha256: i.doc_sha256, proposal_id: i.proposal_id, key: ledgerInvoiceNo(i.invoice_no, i.vendor) }))
    : [];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const byKey = new Map(invoices.map((i) => [i.key, i]));
  const transfer = db.prepare("SELECT request_id, transfer_id, invoice_no FROM transfers WHERE request_id = ?");
  const paidFor = db.prepare("SELECT request_id, transfer_id FROM transfers WHERE invoice_no = ? AND status = 'PAID' ORDER BY updated_at DESC LIMIT 1");
  const proposalOf = db.prepare("SELECT proposal_id FROM proposals WHERE json_extract(terms_json, '$.transfer_request_id') = ? LIMIT 1");
  const approved = db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'");
  const approvedHash = (proposalId: string | null | undefined) => (proposalId ? (approved.get(proposalId) as { approved_sha256: string } | undefined)?.approved_sha256 ?? "" : "");

  return (e: LedgerEntry): Pick<ExportEntry, "doc_sha256" | "terms_sha256" | "payment_id"> => {
    let inv: Invoice | undefined;
    let pay: { request_id: string; transfer_id: string | null; invoice_no?: string } | undefined;
    const accrual = /^ap-accrual\|([^@|]+)/.exec(e.source_key ?? "");
    if (accrual) inv = byId.get(accrual[1]!);
    const moved = /^transfer\|([^|]+)\|/.exec(e.source_key ?? "");
    if (moved) {
      pay = transfer.get(moved[1]!) as { request_id: string; transfer_id: string | null; invoice_no: string } | undefined;
      if (pay?.invoice_no) inv ??= byKey.get(pay.invoice_no);
    }
    // An entry posted from a document names the invoice on its lines (the payable's document reference).
    if (!inv) for (const ref of [e.doc_ref, ...e.lines.map((l) => l.doc_ref)]) { if (ref && byKey.has(ref)) { inv = byKey.get(ref); break; } }
    if (inv && !pay) pay = paidFor.get(inv.key) as { request_id: string; transfer_id: string | null } | undefined;
    const proposal = pay ? (proposalOf.get(pay.request_id) as { proposal_id: string } | undefined)?.proposal_id ?? inv?.proposal_id : inv?.proposal_id;
    return {
      doc_sha256: e.doc_sha256 ?? inv?.doc_sha256 ?? "",
      terms_sha256: approvedHash(proposal),
      payment_id: pay ? pay.transfer_id ?? pay.request_id : "",
    };
  };
}

/** The month's entries with where they come from, the period's state and the chain check. */
export function accountantExport(db: DB, month: string): AccountantExport {
  const period = periodState(db, month);
  const all = ledgerRows(db);
  const from = provenance(db);
  const entries = all.filter((e) => e.posting_date >= period.from && e.posting_date <= period.to).map((e): ExportEntry => ({
    entry: e.entry_id, posting_date: e.posting_date, doc_date: e.doc_date, description: e.description, source_key: e.source_key ?? "", entry_hash: e.entry_hash,
    ...from(e),
    lines: e.lines.map((l) => ({
      account: l.account, account_name: CHART[l.account] ?? "", debit: l.debit_cents ? fromCents(l.debit_cents) : "", credit: l.credit_cents ? fromCents(l.credit_cents) : "",
      currency: l.currency, cost_centre: l.cost_centre ?? "", vat_code: l.vat_code ?? "", vat: l.vat_cents === null ? "" : signed(l.vat_cents), party: l.party ?? "",
      doc_ref: l.doc_ref ?? e.doc_ref ?? "", memo: l.memo ?? "",
    })),
  }));
  return { month, period, chain: verifyLedgerRows(all), entries };
}

export const EXPORT_COLUMNS = ["month", "period_locked", "entry", "posting_date", "doc_date", "description", "account", "account_name", "debit", "credit", "currency", "cost_centre", "vat_code", "vat", "party", "doc_ref", "source_key", "doc_sha256", "terms_sha256", "payment_id", "entry_hash"] as const;

/** One row per line, the entry's fields repeated; cells safe to open in a spreadsheet. */
export function accountantCsv(x: AccountantExport): string {
  const locked = x.period.locked ? `locked ${x.period.locked_at?.slice(0, 10) ?? ""} by ${x.period.locked_by ?? ""}`.trim() : "open";
  const rows = x.entries.flatMap((e) => e.lines.map((l) => [x.month, locked, e.entry, e.posting_date, e.doc_date, e.description, l.account, l.account_name, l.debit, l.credit, l.currency, l.cost_centre, l.vat_code, l.vat, l.party, l.doc_ref, e.source_key, e.doc_sha256, e.terms_sha256, e.payment_id, e.entry_hash]));
  return [EXPORT_COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

/** The same as JSON, with the time it was made (the caller's clock, so the bytes are the same for the same clock). */
export function accountantJson(x: AccountantExport, madeAt: Date): string {
  return JSON.stringify({ ...x, made_at: madeAt.toISOString(), note: x.period.locked ? "The period is locked: nothing more is posted into it." : "The period is open: entries can still be posted into it." }, null, 2) + "\n";
}
