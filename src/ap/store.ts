// Payables: the ledger rows of supplier invoices (ap_invoices) and how they are read back. Every write to an invoice's
// status goes through setStatus, which records the change in the audit log.

import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { ApReading } from "./reading.js";

export type ApStatus = "blocked" | "needs_review" | "needs_vendor" | "ready" | "waiting_cfo" | "paid" | "rejected";

/** One thing the checks found. block stops payment; review needs a person; wait is a new supplier; warn is shown. */
export interface Finding { code: string; level: "block" | "review" | "wait" | "warn"; detail: string }

interface Row {
  id: string; doc_sha256: string; doc_kind: string; classified_by: string; vendor: string; invoice_no: string; issue_date: string; due_date: string; currency: string;
  subtotal: string; tax: string; total: string; iban_last4: string; bic: string; reading_json: string; read_by: string;
  gl_account: string; gl_rule: string; cost_centre: string; status: ApStatus; findings_json: string; proposal_id: string | null;
  review_note: string | null; review_by: string | null;
  received_at: string; updated_at: string; paid_at: string | null;
}

export type ApInvoiceRow = Omit<Row, "reading_json" | "findings_json"> & { reading: ApReading; findings: Finding[] };

const shape = (r: Row): ApInvoiceRow => {
  const { reading_json, findings_json, ...rest } = r;
  return { ...rest, reading: JSON.parse(reading_json) as ApReading, findings: JSON.parse(findings_json) as Finding[] };
};

export function apInvoice(db: DB, id: string): ApInvoiceRow | null {
  const r = db.prepare("SELECT * FROM ap_invoices WHERE id = ?").get(id) as Row | undefined;
  return r ? shape(r) : null;
}

export function apInvoices(db: DB, filter: { status?: ApStatus } = {}): ApInvoiceRow[] {
  const rows = filter.status
    ? db.prepare("SELECT * FROM ap_invoices WHERE status = ? ORDER BY received_at, id").all(filter.status)
    : db.prepare("SELECT * FROM ap_invoices ORDER BY received_at, id").all();
  return (rows as Row[]).map(shape);
}

export function nextApId(db: DB): string {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM ap_invoices").get() as { n: number }).n;
  return `AP-${String(n + 1).padStart(4, "0")}`;
}

/** Moves an invoice to a new status (with its findings, if they changed), and says so in the audit log. */
export function setStatus(db: DB, id: string, status: ApStatus, by: Actor, extra: { findings?: Finding[]; proposal_id?: string | null; paid_at?: string; reason?: string } = {}, now = new Date()): ApInvoiceRow {
  const before = apInvoice(db, id);
  if (!before) throw new Error(`no payables invoice ${id}`);
  db.transaction(() => {
    db.prepare("UPDATE ap_invoices SET status = ?, findings_json = COALESCE(?, findings_json), proposal_id = CASE WHEN ? THEN ? ELSE proposal_id END, paid_at = COALESCE(?, paid_at), updated_at = ? WHERE id = ?")
      .run(status, extra.findings ? JSON.stringify(extra.findings) : null, extra.proposal_id !== undefined ? 1 : 0, extra.proposal_id ?? null, extra.paid_at ?? null, now.toISOString(), id);
    if (before.status !== status) audit(db, by, "ap.status", id, { from: before.status, to: status, ...(extra.reason ? { reason: extra.reason } : {}), ...(extra.proposal_id ? { proposal_id: extra.proposal_id } : {}) }, now);
  }).immediate();
  return apInvoice(db, id)!;
}
