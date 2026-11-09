// Payables: one invoice as its own page shows it (src/servers/payables.ts, /invoices/:id). Everything here is read from
// the ledger: the checks as a fixed list, each passed or with the findings that stopped it; the timeline from the
// audit log; the supplier's own total line from the stored document; and which actions the page may offer, with the
// reason when one is closed. The reading's account is masked as on the list (publicInvoice).

import { batchesOf } from "../policy/batchLines.js";
import { readFileSync } from "node:fs";
import type { DB } from "../db/open.js";
import { payableCurrency } from "../payouts/routes.js";
import { pdfText } from "./pdfText.js";
import { publicInvoice } from "./public.js";
import { totalLine } from "./reading.js";
import type { Box } from "./scan.js";
import { STATUS_WORDS } from "./review.js";
import { apInvoice, type ApStatus, type Finding } from "./store.js";

/** The checks, in the order the page lists them, and the finding codes that mean each one did not pass. */
export const CHECKS: readonly { key: string; title: string; codes: readonly string[] }[] = [
  { key: "document", title: "A supplier invoice, readable", codes: ["not_an_invoice", "receipt", "credit_note", "reminder", "no_text", "read_from_scan"] },
  { key: "fields", title: "Every field read, and the amounts add up", codes: ["missing_fields", "sum_mismatch", "ambiguous_total"] },
  { key: "duplicate", title: "Not paid or filed before", codes: ["duplicate", "possible_duplicate", "rejected_before"] },
  { key: "supplier", title: "A supplier on file", codes: ["new_supplier", "unknown_vendor", "lookalike_vendor", "mixed_scripts", "payee_blocked"] },
  { key: "bank", title: "Bank details valid and as on file", codes: ["no_bank_details", "iban_invalid", "bank_details_invalid", "bank_details_changed", "account_name_mismatch", "account_currency"] },
  { key: "fraud", title: "No signs of invoice fraud", codes: ["possible_fraud", "pressure_language", "bank_change_language"] },
  { key: "amount", title: "An amount as usual for this supplier", codes: ["unusual_amount"] },
  { key: "route", title: "A currency and country Purser pays", codes: ["currency_not_paid", "country_not_paid", "payment_not_planned"] },
  { key: "due", title: "Not past its due date", codes: ["overdue"] },
];

export type CheckResult = "passed" | "warn" | "wait" | "review" | "block" | "not_checked";
/** reasons: the code's English words; codes: each reason's finding code, in the same order (a page words it in its own language). */
export interface CheckRow { key: string; title: string; result: CheckResult; reasons: string[]; codes: string[] }
/** what/detail: English words; kind and vars: the same, as a code and its values, for a page in another language. */
export interface TimelineRow { at: string; what: string; detail: string; by: string; kind: string; vars: Record<string, string> }
/** why: English words; code and vars: the same, as a code and its values (src/ui/i18n.ts action.*). */
export interface Action { allowed: boolean; why: string; code: string; vars: Record<string, string> }
export interface InvoiceDetail {
  invoice: ReturnType<typeof publicInvoice>;
  checks: CheckRow[];
  timeline: TimelineRow[];
  /** The supplier's own total line, as on the document ("" when the document has none code can find). */
  total_line: string;
  document: { filename: string; source: string; from: string; subject: string };
  actions: { pay: Action; supplier_request: Action; reject: Action };
  /** The batch this invoice's payment is in (one Face ID for many, src/policy/batch.ts), or null. */
  batch: { id: string; status: string; count: string; waiting: boolean } | null;
  /** A scanned invoice: whether its two readings agree, what they differ on, and where on which page each field was read. */
  scan: ScanView | null;
}
export interface ScanView { agreed: boolean; differ: string[]; readings: number; model: string; boxes: Box[] }

/** A scan's stored readings, for the detail page and the payment terms. */
export function scanView(db: DB, id: string): ScanView | null {
  const r = db.prepare("SELECT agreed, differ_json, boxes_json, readings, model FROM ap_scan_readings WHERE invoice_id = ?").get(id) as
    { agreed: number; differ_json: string; boxes_json: string; readings: number; model: string } | undefined;
  return r ? { agreed: r.agreed === 1, differ: JSON.parse(r.differ_json) as string[], readings: r.readings, model: r.model, boxes: JSON.parse(r.boxes_json) as Box[] } : null;
}

/** The line the CFO sees beside the amount for a scan: there is no text line on it, so it says what was read and how. */
export function scanTotalLine(inv: { currency: string; total: string }, scan: ScanView): string {
  return `read from a scan: ${inv.currency} ${inv.total}${scan.agreed ? " (two readings agree)" : " (a person checks it against the page)"}`;
}

const SEVERITY: CheckResult[] = ["block", "review", "wait", "warn"];
const READ_FULLY = new Set(["invoice", "credit_note", "reminder"]);

/** Every check with its result: the worst level of its findings, or passed; a document that is not an invoice is not checked further. */
export function checkRows(findings: Finding[], docKind: string): CheckRow[] {
  const known = new Set(CHECKS.flatMap((c) => c.codes));
  const rows: CheckRow[] = CHECKS.map((c) => {
    // A suspected fraud names its signals (a changed account, a lookalike name): the check each one belongs to fails too, with that signal's own reason.
    const hits: Finding[] = [
      ...findings.filter((f) => c.codes.includes(f.code)),
      ...findings.flatMap((f) => (f.code === "possible_fraud" ? (f.signals ?? []) : []).filter((s) => c.codes.includes(s.code)).map((s) => ({ code: s.code, level: f.level, detail: s.detail }))),
    ];
    const result = hits.length ? SEVERITY.find((s) => hits.some((h) => h.level === s))! : c.key !== "document" && !READ_FULLY.has(docKind) ? "not_checked" : "passed";
    return { key: c.key, title: c.title, result, reasons: hits.map((h) => h.detail), codes: hits.map((h) => h.code) };
  });
  // A finding this list does not name yet is never hidden.
  const other = findings.filter((f) => !known.has(f.code));
  if (other.length) rows.push({ key: "other", title: "Other checks", result: SEVERITY.find((s) => other.some((h) => h.level === s))!, reasons: other.map((h) => h.detail), codes: other.map((h) => h.code) });
  return rows;
}

const SOURCE_WORDS: Record<string, string> = { upload: "uploaded on this page", email: "by e-mail", folder: "from the watched folder", api: "through the API" };
const word = (s: string) => STATUS_WORDS[s] ?? s.replace(/_/g, " ");

/** The invoice's story from the audit log, oldest first. */
export function timeline(db: DB, id: string): TimelineRow[] {
  const rows = db.prepare("SELECT ts, actor, event, payload_json FROM audit_log WHERE subject = ? AND event IN ('ap.received', 'ap.status', 'ap.review_note', 'ap.duplicate_cleared') ORDER BY seq").all(id) as
    { ts: string; actor: string; event: string; payload_json: string }[];
  const out: TimelineRow[] = [];
  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as Record<string, unknown>;
    const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    if (r.event === "ap.received") {
      out.push({ at: r.ts, what: "Received", detail: `${s("filename")}, ${SOURCE_WORDS[s("source")] ?? s("source")}`, by: "Purser", kind: "received", vars: { filename: s("filename"), source: s("source") } });
      out.push({ at: r.ts, what: `Checked: ${word(s("status"))}`, detail: s("read_by") === "parser" ? "read by Purser's code" : `read by ${s("read_by")}, checked by Purser's code`, by: "Purser", kind: "checked", vars: { status: s("status"), read_by: s("read_by") } });
    } else if (r.event === "ap.status") {
      const to = s("to") as ApStatus;
      const what = to === "ready" && s("from") === "waiting_cfo" ? "Ready to pay again" : word(to);
      out.push({ at: r.ts, what, detail: s("reason"), by: r.actor === "human" ? "a person" : r.actor === "awx-executor" ? "Airwallex" : "Purser", kind: to === "ready" && s("from") === "waiting_cfo" ? "ready_again" : "status", vars: { status: to, reason: s("reason") } });
    } else if (r.event === "ap.review_note") {
      const by = s("by");
      out.push({ at: r.ts, what: "Note written", detail: by.startsWith("claude:") ? `by ${by.slice("claude:".length)} (advisory)` : "by Purser's code", by: by.startsWith("claude:") ? "Claude" : "Purser", kind: "note", vars: { model: by.startsWith("claude:") ? by.slice("claude:".length) : "" } });
    } else {
      out.push({ at: r.ts, what: "Cleared as not a duplicate", detail: `by ${s("by")}${s("note") ? `: ${s("note")}` : ""}`, by: "a person", kind: "cleared", vars: { by: s("by"), note: s("note") } });
    }
  }
  return out;
}

/** Which actions the page offers for an invoice in this state, and why one is closed. */
export function actionsFor(inv: { status: ApStatus; currency: string; findings: Finding[] }): InvoiceDetail["actions"] {
  const no = (why: string, code: string, vars: Record<string, string> = {}): Action => ({ allowed: false, why, code, vars });
  const yes: Action = { allowed: true, why: "", code: "", vars: {} };
  const blocking = inv.findings.filter((f) => f.level !== "warn");
  const reasons = blocking.map((f) => f.detail).join("; ");
  const pay = inv.status === "ready"
    ? payableCurrency(inv.currency) ? yes : no(`Purser does not pay ${inv.currency || "this currency"}; a person pays it by hand`, "currency_not_paid", { currency: inv.currency })
    : inv.status === "needs_vendor" ? no("a new supplier is verified and approved first", "needs_vendor")
    : inv.status === "waiting_cfo" ? no("filed already: it waits for the CFO's Face ID on the phone", "filed")
    : inv.status === "paid" ? no("paid", "paid")
    : inv.status === "rejected" ? no("rejected", "rejected")
    : reasons ? no(reasons, "findings", { codes: blocking.map((f) => f.code).join(",") }) : no(word(inv.status), "status", { status: inv.status });
  const supplier_request = inv.status === "needs_vendor" ? yes : no("only for an invoice that waits for a new supplier", "only_needs_vendor");
  const reject = ["blocked", "needs_review", "needs_vendor", "ready"].includes(inv.status) ? yes
    : inv.status === "waiting_cfo" ? no("it waits for the CFO: approve or reject it on the phone", "waits_cfo")
    : inv.status === "paid" ? no("paid", "paid") : no("rejected already", "rejected_already");
  return { pay, supplier_request, reject };
}

export async function invoiceDetail(db: DB, id: string): Promise<InvoiceDetail | null> {
  const inv = apInvoice(db, id);
  if (!inv) return null;
  const doc = db.prepare("SELECT path, filename, source, meta_json FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as
    { path: string; filename: string; source: string; meta_json: string } | undefined;
  let line = "";
  const scan = scanView(db, id);
  if (scan) line = scanTotalLine(inv, scan);
  else if (doc) {
    try { line = totalLine((await pdfText(readFileSync(doc.path))).text); } catch { line = ""; }
  }
  const meta = doc ? (JSON.parse(doc.meta_json) as Record<string, unknown>) : {};
  const m = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).slice(0, 200) : "");
  return {
    invoice: publicInvoice(inv),
    checks: checkRows(inv.findings, inv.doc_kind),
    timeline: timeline(db, id),
    total_line: line.slice(0, 160),
    document: { filename: doc?.filename ?? "", source: doc?.source ?? "", from: m("from"), subject: m("subject") },
    actions: actionsFor(inv),
    batch: batchOfInvoice(db, inv.proposal_id),
    scan,
  };
}

/** The newest batch this invoice's payment proposal is in, with its count and whether it still waits for the CFO. */
function batchOfInvoice(db: DB, proposalId: string | null): InvoiceDetail["batch"] {
  if (!proposalId) return null;
  const b = batchesOf(db, proposalId)[0];
  if (!b) return null;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM batch_lines WHERE batch_id = ?").get(b.batch_id) as { n: number }).n;
  return { id: b.batch_id, status: b.status, count: String(count), waiting: b.status === "PENDING_APPROVAL" };
}
