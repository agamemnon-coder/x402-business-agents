// Per customer query, what the customer got (Kit 11: "answer the customer with an error status: the middleware then
// doesn't settle"). The seller records its side when it refuses (sale.refused: 503, not settled); the world's serve
// loop records the customer's side of every query here (query.answered): the HTTP status the customer received and
// whether the payment settled, which for an error answer is the facilitator's own public list, looked up by the
// payment's nonce (src/agents/customer.ts), not our assumption.

import { audit } from "../audit/log.js";
import type { Purchase } from "../agents/customer.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";

export interface QueryAnswer {
  seq: number;
  /** The HTTP status the customer received; null when no answer came (the request failed). */
  status: number | null;
  /** Whether the customer's payment settled: true, false, or null when it could not be known. */
  settled: boolean | null;
  outcome: "paid" | "refused" | "in_doubt" | "failed";
  amount?: string;
  tx?: string;
  sale_id?: number;
  reason?: string;
}

export function answerOf(seq: number, p: Purchase | { error: string }): QueryAnswer {
  if ("error" in p) return { seq, status: null, settled: null, outcome: "failed", reason: p.error.slice(0, 200) };
  const o = p.outcome;
  if (o.kind === "paid") return { seq, status: o.status, settled: true, outcome: "paid", amount: fromCents(baseUnitsToCents(BigInt(o.amount))), tx: o.tx };
  // refused: nothing was paid (the facilitator refused or nothing was signed); in doubt: the lookup by nonce decided.
  const settled = o.kind === "refused" ? false : p.charged ?? null;
  return { seq, status: o.status ?? null, settled, outcome: o.kind, reason: o.reason.slice(0, 200) };
}

/** Records the customer's side of query `seq` in the ledger, with the sale it made (if any). */
export function recordQueryAnswer(db: DB, seq: number, p: Purchase | { error: string }, now = new Date()): QueryAnswer {
  const a = answerOf(seq, p);
  const sale = db.prepare("SELECT sale_id FROM sales WHERE json_extract(request_params_json, '$.seq') = ? ORDER BY sale_id DESC LIMIT 1").get(String(seq)) as { sale_id: number } | undefined;
  const row: QueryAnswer = sale ? { ...a, sale_id: sale.sale_id } : a;
  audit(db, "system", "query.answered", String(seq), { ...row }, now);
  return row;
}
