// The payment rationale record (25 November): for every supplier or invoice payment Purser executed or refused, a short
// structured "why", stored in the audit log (payment.rationale) and shown on the invoice's own page (src/ap/detail.ts;
// src/servers/rationaleWords.ts puts it in words there). Airwallex's own definition of agentic banking asks an agent to
// know which entity owns the money, which account funds a payment, which rail carries it and what happens when it fails,
// and to leave a trace afterwards. So the record holds:
//   - funding: the account and currency the payment left from, that currency's balance and floor as signed, and the
//     conversion on its locked quote when that balance alone did not cover it;
//   - rail: LOCAL (with its clearing system) or SWIFT, the account it went to, the fee held back and the fee charged;
//   - rule: the CFO policy rule and version it was allowed under (the limit to pay alone), and whether code applied it;
//   - approval: who decided the exact terms, how, when, and the terms hash;
//   - the transfer at Airwallex, a replacement of a failed one (src/executors/replaceFailed.ts), or why it was refused.
// Every value is read from the record (the signed terms, the approval row, the policy version, the transfer rows, the
// audit log); nothing is written by hand. Terms that no longer hash to what was signed get none. Moves nothing.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { termsHash, type Terms as LibTerms } from "../lib/terms.js";
import { POLICY_METHOD } from "../policy/signedApproval.js";
import { policyAt } from "../policy/versions.js";

export const RATIONALE_EVENT = "payment.rationale";
const KINDS = new Set(["supplier_payment", "invoice_payment"]);
const ALONE = "ap.alone_eur";

type Transfer = { request_id: string; transfer_id: string | null; status: string; failure_type: string | null; fee_actual: string | null } | null;
export interface PaymentRationale {
  proposal_id: string;
  kind: string;
  /** executed: Airwallex has it (paid or on its way); failed: Airwallex failed it; refused: Purser stopped it first. */
  outcome: "executed" | "failed" | "refused";
  amount: string;
  currency: string;
  payee: string;
  invoice_no: string;
  funding: { account: string | null; balance: string; floor: string; conversion: null | { sell: string; buy: string; rate: string; quote_id: string } };
  rail: { method: string; clearing: string | null; to: string; fee_held: string; fee_charged: string | null };
  rule: { key: string; value: string; policy_version: number | null; policy_sha256: string | null; by_code: boolean; note: string | null };
  approval: { decision: string; by: string; method: string; at: string; terms_sha256: string } | null;
  transfer: Transfer;
  replacement: Transfer;
  refused: string | null;
}

interface Terms {
  kind: string; invoice_no: string; amount: string; currency: string; method: string; clearing?: string | null; beneficiary_name: string;
  account?: string; iban_last4?: string; fee_reserve?: string; fee_max?: string; transfer_request_id: string;
  conversion: null | { quote_id: string; client_rate: string; buy_currency: string; buy_amount: string; sell_currency: string; sell_amount: string };
  balances_before: Record<string, string>; floors: Record<string, string>; paying_account?: { id: string; name: string };
}

/**
 * The rationale of one payment as the record stands; null for another kind of proposal, or for terms that no longer hash
 * to the signed hash. `refusal`: the error the executor just threw, when the record does not hold it yet.
 */
export function buildRationale(db: DB, proposalId: string, refusal: string | null = null): PaymentRationale | null {
  const p = db.prepare("SELECT kind, status, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; status: string; terms_json: string; terms_sha256: string } | undefined;
  if (!p || !KINDS.has(p.kind)) return null;
  let t: Terms;
  try {
    t = JSON.parse(p.terms_json) as Terms;
    if (termsHash(t as unknown as LibTerms) !== p.terms_sha256) return null;
  } catch { return null; }
  const euro = t.kind === "invoice_payment";
  const row = (sql: string) => (db.prepare(`SELECT request_id, transfer_id, status, failure_type, fee_actual FROM transfers WHERE ${sql} = ?`).get(t.transfer_request_id) ?? null) as Transfer;
  const first = row("request_id");
  const next = row("replaces_request_id");
  const live = next ?? first;
  const a = db.prepare("SELECT decision, approver, method, created_at, approved_sha256, policy_version, note FROM approvals WHERE proposal_id = ? ORDER BY approval_id DESC LIMIT 1").get(proposalId) as
    { decision: string; approver: string; method: string; created_at: string; approved_sha256: string; policy_version: number | null; note: string | null } | undefined;
  const policy = a?.policy_version != null ? policyAt(db, a.policy_version) : null;
  const c = t.conversion;
  const outcome = live?.transfer_id && ["FAILED", "CANCELLED"].includes(live.status) ? "failed" : live?.transfer_id && p.status !== "REJECTED" ? "executed" : "refused";
  // Why Purser stopped it: the executor's error, else the reason stored before, else the proposal's state.
  const refused = outcome === "refused" ? (refusal ?? readRationale(db, proposalId)?.refused ?? `the proposal is ${p.status.toLowerCase()}`).slice(0, 300) : null;
  return {
    proposal_id: proposalId, kind: p.kind, outcome, amount: t.amount, currency: t.currency, payee: t.beneficiary_name, invoice_no: t.invoice_no,
    funding: {
      account: t.paying_account ? `${t.paying_account.name} (${t.paying_account.id})` : null,
      balance: (euro ? t.balances_before.eur_available : t.balances_before[t.currency]) ?? "", floor: (euro ? t.floors.eur_floor : t.floors[t.currency]) ?? "",
      conversion: c && { sell: `${c.sell_currency} ${c.sell_amount}`, buy: `${c.buy_currency} ${c.buy_amount}`, rate: c.client_rate, quote_id: c.quote_id },
    },
    rail: {
      method: t.method, clearing: t.clearing ?? null, to: t.account ?? (t.iban_last4 ? `IBAN …${t.iban_last4}` : ""),
      fee_held: `${t.currency} ${t.fee_reserve ?? t.fee_max ?? ""}`, fee_charged: live?.fee_actual ?? null,
    },
    rule: { key: ALONE, value: policy?.values[ALONE] ?? "", policy_version: a?.policy_version ?? null, policy_sha256: policy?.sha256 ?? null, by_code: a?.method === POLICY_METHOD, note: a?.note ?? null },
    approval: a ? { decision: a.decision, by: a.approver, method: a.method, at: a.created_at, terms_sha256: a.approved_sha256 } : null,
    transfer: first, replacement: next, refused,
  };
}

/** Stores the rationale as it stands, unless the newest stored one says the same. Never throws: it changes no outcome. */
export function recordRationale(db: DB, proposalId: string, refusal: string | null = null, now = new Date()): PaymentRationale | null {
  try {
    const r = buildRationale(db, proposalId, refusal);
    if (!r) return null;
    const last = readRationale(db, proposalId);
    // The log stores payloads canonically (JCS), so both sides are compared that way.
    if (last && jcs(last as unknown as Json) === jcs(r as unknown as Json)) return last;
    audit(db, "system", RATIONALE_EVENT, proposalId, r as unknown as Json, now);
    return r;
  } catch {
    return null;
  }
}

/** The newest stored rationale of a payment, or null. */
export function readRationale(db: DB, proposalId: string | null): PaymentRationale | null {
  const r = proposalId ? db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq DESC LIMIT 1").get(RATIONALE_EVENT, proposalId) as { payload_json: string } | undefined : undefined;
  return r ? (JSON.parse(r.payload_json) as PaymentRationale) : null;
}

/** Runs a payment, then stores its rationale whatever the outcome (with the error, when it threw). */
export async function withRationale<T>(db: DB, proposalId: string, now: () => Date, run: () => Promise<T>): Promise<T> {
  let refusal: string | null = null;
  try {
    return await run();
  } catch (e) {
    refusal = (e as Error).message;
    throw e;
  } finally {
    recordRationale(db, proposalId, refusal, now());
  }
}
