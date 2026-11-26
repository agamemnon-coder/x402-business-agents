// Retention on the runner's ledger (26 Nov): how long each kind of record is kept by default, and a check that reports
// the rows older than that. It never deletes: the audit log is append-only (the database refuses an edit or a delete)
// and the ledger is a hash chain, so records past their period leave whole, by a procedure the deployer runs
// (docs/compliance/retention.md). Purser Cloud's own retention is in docs/privacy/retention.md and cloud/src/privacy.ts.
//
// The periods are defaults to adopt and adapt: the books follow the seven years docs/privacy/retention.md gives (Article
// 2:10 BW, Article 52 AWR, until 31 December of the seventh year), which is longer than the six months the EU AI Act
// asks logs to be kept at least (Arts. 19(1) and 26(6)). A deployer confirms them with its adviser.

import type { DB } from "../db/open.js";

/** Kept until 31 December of the `years`-th year after the record, or for `days` days. */
export type Period = { years_to_year_end: number } | { days: number };

export interface RetentionRule {
  table: string;
  /** The column that dates a row (ISO 8601 text, as the code writes it). */
  at: string;
  /** The table's level in docs/security/data-classification.md. */
  level: "Secret" | "Restricted" | "Internal";
  kind: string;
  keep: Period;
  basis: string;
}

const BOOKS: Period = { years_to_year_end: 7 };
const BOOKS_BASIS = "bookkeeping: Article 2:10 BW, Article 52 AWR (docs/privacy/retention.md)";
const EVIDENCE_BASIS = "evidence for a payment's decision, kept with the books; longer than the 6 months of EU AI Act Arts. 19(1) and 26(6)";

export const RETENTION: readonly RetentionRule[] = [
  { table: "audit_log", at: "ts", level: "Restricted", kind: "The hash-chained audit log: every decision, refusal and approval", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "ledger_entries", at: "created_at", level: "Restricted", kind: "The double-entry ledger", keep: BOOKS, basis: BOOKS_BASIS },
  { table: "proposals", at: "created_at", level: "Restricted", kind: "Proposals with their exact terms", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "approvals", at: "created_at", level: "Restricted", kind: "Approvals: who, how, which terms hash", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "passkey_assertions", at: "verified_at", level: "Restricted", kind: "The stored passkey signatures behind approvals", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "cosignatures", at: "created_at", level: "Restricted", kind: "First signatures of two-person approvals", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "policy_versions", at: "created_at", level: "Internal", kind: "Every version of the CFO policy, hashed", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "ap_invoices", at: "received_at", level: "Restricted", kind: "Supplier invoices as read", keep: BOOKS, basis: BOOKS_BASIS },
  { table: "ap_documents", at: "received_at", level: "Restricted", kind: "The invoice documents as received", keep: BOOKS, basis: BOOKS_BASIS },
  { table: "card_transactions", at: "recorded_at", level: "Restricted", kind: "The agents' card transactions", keep: BOOKS, basis: BOOKS_BASIS },
  { table: "airwallex_events", at: "received_at", level: "Restricted", kind: "Airwallex webhooks, after their signature verified", keep: BOOKS, basis: EVIDENCE_BASIS },
  { table: "payee_changes", at: "created_at", level: "Restricted", kind: "Changes of a supplier's bank details and their checks", keep: BOOKS, basis: BOOKS_BASIS },
  { table: "agent_messages", at: "created_at", level: "Restricted", kind: "Messages between the agents (may quote invoice data)", keep: { days: 365 }, basis: "proposed default: not bookkeeping; a year to investigate an incident" },
  { table: "balance_snapshots", at: "taken_at", level: "Restricted", kind: "The runner's balance snapshots", keep: { days: 365 }, basis: "proposed default: operational; the books keep the balances" },
  { table: "passkey_pending", at: "created_at", level: "Restricted", kind: "Passkeys waiting for their fingerprint to be confirmed", keep: { days: 1 }, basis: "short-lived: an enrolment window lasts minutes" },
  { table: "tap_nonces", at: "seen_at", level: "Internal", kind: "Nonces of signed agent requests (replay protection)", keep: { days: 1 }, basis: "short-lived: a nonce is checked within minutes" },
];

/** The instant before which a row is past its period, at `now`. */
export function cutoff(keep: Period, now: Date): Date {
  if ("days" in keep) return new Date(now.getTime() - keep.days * 86_400_000);
  // Kept until 31 December of the n-th year after the record: past once that year has ended.
  return new Date(Date.UTC(now.getUTCFullYear() - keep.years_to_year_end, 0, 1));
}

export const periodWords = (keep: Period): string => ("days" in keep
  ? keep.days === 1 ? "1 day" : keep.days === 365 ? "1 year" : `${keep.days} days`
  : `${keep.years_to_year_end} years, to 31 December`);

export interface RetentionFinding { table: string; kind: string; keep: string; present: boolean; rows: number; past: number; oldest_past: string | null; cutoff: string }

const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`not a table or column name: ${s}`); return `"${s}"`; };

/** For each rule, the rows dated before its cutoff at `now`. Reads only; never deletes. */
export function retentionCheck(db: DB, now: Date, rules: readonly RetentionRule[] = RETENTION): RetentionFinding[] {
  return rules.map((r) => {
    const c = cutoff(r.keep, now);
    const present = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(r.table));
    if (!present) return { table: r.table, kind: r.kind, keep: periodWords(r.keep), present, rows: 0, past: 0, oldest_past: null, cutoff: c.toISOString() };
    // Compared by instant, not text: a column holds ISO strings the code wrote.
    const dates = (db.prepare(`SELECT ${ident(r.at)} AS at FROM ${ident(r.table)}`).all() as { at: string | null }[]).map((x) => Date.parse(String(x.at)));
    const past = dates.filter((d) => Number.isFinite(d) && d < c.getTime()).sort((a, b) => a - b);
    return { table: r.table, kind: r.kind, keep: periodWords(r.keep), present, rows: dates.length, past: past.length, oldest_past: past.length ? new Date(past[0]!).toISOString() : null, cutoff: c.toISOString() };
  });
}

/** The rules as a Markdown table, for docs/compliance/retention.md (a test holds the page to it). */
export function retentionTable(rules: readonly RetentionRule[] = RETENTION): string {
  const L = ["| Table | What it holds | Level | Kept for | Basis |", "|---|---|---|---|---|"];
  for (const r of rules) L.push(`| \`${r.table}\` (by \`${r.at}\`) | ${r.kind} | ${r.level} | ${periodWords(r.keep)} | ${r.basis} |`);
  return L.join("\n");
}

/** The generated block of docs/compliance/retention.md, markers included. */
export const retentionBlock = (): string => `<!-- retention:start -->\n${retentionTable()}\n<!-- retention:end -->`;
