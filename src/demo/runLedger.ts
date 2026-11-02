// What the pages need from a run's ledger beyond the dashboard snapshot (whose feed and traces are capped): the whole
// run's rows for the approvals, the mandate replacements with their tx, the refunds, the sweep, the refusals recorded
// on chain and the transfers; the dispute case with its evidence; and each proposal's terms. Public-safe: no passkey
// credential id or assertion, no viewer key, no relay host, no Airwallex beneficiary or request ids, no balances.

import type { DB } from "../db/open.js";

/** The audit events recorded in full for the pages. */
export const LEDGER_EVENTS = [
  "proposal.created", "proposal.cosigned", "proposal.approved", "proposal.rejected", "proposal.failed", "proposal.superseded", "proposal.executed",
  "mandate.replaced", "refund.paid", "upstream.refused_on_chain", "credit.locked", "credit.deposited",
] as const;
const PREFIXES = ["sweep.", "transfer."];

/** Keys never recorded, wherever they appear. */
const DROP = new Set(["passkey", "credential_id", "assertion_sha256", "transfer_request_id", "beneficiary_id", "iban", "iban_last4", "bic", "balances_before", "floors", "after", "email_sha256", "viewer", "view_key", "token", "relay", "host"]);

/** A copy without the keys above, and with "(passkey AbCd1234)" labels taken out of every string. */
export function scrub<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\s*\(passkey [A-Za-z0-9_-]+\)/g, "") as T;
  if (Array.isArray(v)) return v.map(scrub) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, scrub(x)])) as T;
  return v;
}

export interface LedgerRow { seq: number; ts: string; actor: string; event: string; subject: string | null; payload: Record<string, unknown> }
export interface RunLedger {
  events: LedgerRow[];
  proposals: { proposal_id: string; kind: string; status: string; created_by: string; created_at: string; terms: Record<string, unknown> }[];
  disputes: { dispute_id: string; customer: string; created_at: string; claims: unknown; evidence: unknown; verdicts: unknown }[];
}

const parse = (s: string | null): unknown => { try { return s ? JSON.parse(s) as unknown : null; } catch { return null; } };

export function runLedger(db: DB): RunLedger {
  const marks = LEDGER_EVENTS.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event IN (${marks}) OR ${PREFIXES.map(() => "event LIKE ?").join(" OR ")} ORDER BY seq`)
    .all(...LEDGER_EVENTS, ...PREFIXES.map((p) => `${p}%`)) as { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }[];
  const proposals = db.prepare("SELECT proposal_id, kind, status, created_by, created_at, terms_json FROM proposals ORDER BY proposal_id").all() as { proposal_id: string; kind: string; status: string; created_by: string; created_at: string; terms_json: string }[];
  const disputes = db.prepare("SELECT dispute_id, customer, created_at, claims_json, evidence_json, verdicts_json FROM disputes ORDER BY created_at").all() as { dispute_id: string; customer: string; created_at: string; claims_json: string | null; evidence_json: string | null; verdicts_json: string | null }[];
  return scrub({
    events: rows.map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: (parse(r.payload_json) ?? {}) as Record<string, unknown> })),
    proposals: proposals.map((p) => ({ proposal_id: p.proposal_id, kind: p.kind, status: p.status, created_by: p.created_by, created_at: p.created_at, terms: (parse(p.terms_json) ?? {}) as Record<string, unknown> })),
    disputes: disputes.map((d) => ({ dispute_id: d.dispute_id, customer: d.customer, created_at: d.created_at, claims: parse(d.claims_json), evidence: parse(d.evidence_json), verdicts: parse(d.verdicts_json) })),
  });
}

/** What must never be in a published record: passkey ids, viewer keys, relay hosts and tokens, private keys. */
export function secretsIn(text: string): string[] {
  const found: string[] = [];
  const hit = (name: string, re: RegExp) => { const m = re.exec(text); if (m) found.push(`${name}: ${m[0].slice(0, 40)}`); };
  hit("passkey credential id", /"credential_id"|\(passkey [A-Za-z0-9_-]{6,}\)/);
  hit("passkey assertion", /"assertion_sha256"/);
  hit("viewer key", /[#?&](k|key|view)=[A-Za-z0-9_-]{8,}|"view(er)?_?key"/i);
  hit("relay token", /"(relay_)?token"\s*:|runner=[A-Za-z0-9]|x-relay-token|Bearer\s+[A-Za-z0-9._-]{10,}/i);
  hit("relay host", /https?:\/\/(?!testnet\.metalntwx\.com\b|www\.airwallex\.com\b|platform\.claude\.com\b|github\.com\b)[a-z0-9.-]+\.(workers\.dev|[a-z]{2,})(?=[/:"])/i);
  hit("private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_?key"\s*:|"secret"\s*:/i);
  return found;
}
