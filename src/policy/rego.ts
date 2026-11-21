// Purser's CFO policy for Open Policy Agent (docs/policy-opa.md). policy/purser.rego restates three of Purser's
// deterministic payment decisions in Rego; this module gives OPA its input and data, and says what Purser's own code
// decides on the same facts, so test/policy-rego.test.ts can hold the two to the same outcome and reason on every case:
//   supplier_payment  the Payer's boundary on a supplier invoice (src/ap/payerCore.ts enforceProposal);
//   agent_purchase    an agent's purchase on the Airi rail (src/airi/purchase.ts decideAiriPurchase);
//   pay_alone         within the CFO's limit to pay alone (src/policy/withinLimit.ts aloneDecision).
// Nothing here decides a payment: Purser enforces in its own code and at the rails, and never reads the Rego. This
// module only calls those functions as they are and writes files for OPA. No signatures, passkeys, rails or models.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiriPolicy } from "../airi/policy.js";
import { decideAiriPurchase, type AiriPurchaseRequest } from "../airi/purchase.js";
import { enforceProposal, type PaymentCase, type PaymentProposal, type PaymentQuote, type RailOnOffer } from "../ap/payerCore.js";
import { aloneDecision } from "./withinLimit.js";

/** Where the rules live in this repository, and the package they declare. */
export const REGO_PATH = new URL("../../policy/purser.rego", import.meta.url);
export const REGO_PACKAGE = "purser.policy";
/** The query that gives the decision, and the one that gives one decision per input of a batch ({cases: [...]}) . */
export const REGO_QUERY = "data.purser.policy.decision";
export const REGO_BATCH_QUERY = "[d | some c in input.cases; d := data.purser.policy.decision with input as c]";

/**
 * The CFO's policy values the Rego reads: the limit to pay alone (ap.alone_eur), the cash floors, whether an invoice
 * may be paid late, and an agent's Airi rail policy (src/airi/policy.ts airiPolicy). Purser's own field names.
 */
export interface RegoPolicy {
  aloneLimit: { currency: string; amount: string } | null;
  cashFloors: Record<string, string>;
  payLate: { maxDays: number } | null;
  agentPurchase?: AiriPolicy;
}

/** The payment proposed: a supplier invoice with the Payer's proposal, an agent's purchase, or an amount to pay alone. */
export type RegoPayment =
  | { kind: "supplier_payment"; invoice: PaymentCase["invoice"]; proposal: PaymentProposal; rails: RailOnOffer[]; fx: PaymentQuote | null }
  | { kind: "agent_purchase"; request: AiriPurchaseRequest }
  | { kind: "pay_alone"; amount: unknown; currency: unknown };

/** What the decision needs besides the policy and the payment: today, the balances, what is spoken for, and how many purchases ran alone today. */
export interface RegoContext {
  today?: string;
  balances?: Record<string, string>;
  spokenFor?: Record<string, string>;
  aloneToday?: number;
}

export type RegoOutcome = "pay" | "ask_cfo" | "hold" | "refuse";
/** The decision as OPA returns it and as purserDecision states Purser's: the outcome and the rule's code (null to pay). */
export interface RegoDecision { outcome: RegoOutcome; reason: string | null }

/**
 * The merchant URL's https origin, or null when it is no plain https URL: src/airi/purchase.ts originOf, the same
 * WHATWG URL parser. Rego has no URL parser to match it, so the exporter gives OPA the origin.
 */
export function merchantOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/** The input OPA takes for one decision: the kind, the payment, the context and (unless left to data.json) the policy. */
export function exportRegoInput(policy: RegoPolicy, payment: RegoPayment, ctx: RegoContext = {}, opts: { withPolicy?: boolean } = {}): Record<string, unknown> {
  const p: Record<string, unknown> = { ...payment };
  if (payment.kind === "agent_purchase") p.merchant_origin = merchantOrigin(payment.request.merchantUrl);
  delete p.kind;
  return { kind: payment.kind, ...(opts.withPolicy === false ? {} : { policy }), payment: p, context: { ...ctx } };
}

/** The data OPA takes for a company: its CFO policy values, at data.purser.cfo. */
export const regoData = (policy: RegoPolicy) => ({ purser: { cfo: policy } });

/** The Payer's case for a supplier payment, from the policy, the payment and the context. */
export function paymentCaseOf(policy: RegoPolicy, payment: Extract<RegoPayment, { kind: "supplier_payment" }>, ctx: RegoContext): PaymentCase {
  return {
    invoice: payment.invoice, company: { name: "" }, balances: ctx.balances as Record<string, string>,
    ...(ctx.spokenFor !== undefined ? { spokenFor: ctx.spokenFor } : {}),
    policy: { aloneLimit: policy.aloneLimit, cashFloors: policy.cashFloors, payLate: policy.payLate },
    rails: payment.rails, fx: payment.fx, today: ctx.today as string,
  };
}

/** A Payer's case and proposal as the policy, the payment and the context (the inverse of paymentCaseOf). */
export function fromPaymentCase(c: PaymentCase, proposal: PaymentProposal): { policy: RegoPolicy; payment: RegoPayment; ctx: RegoContext } {
  return {
    policy: { aloneLimit: c.policy.aloneLimit, cashFloors: c.policy.cashFloors, payLate: c.policy.payLate },
    payment: { kind: "supplier_payment", invoice: c.invoice, proposal, rails: c.rails, fx: c.fx },
    ctx: { today: c.today, balances: c.balances, ...(c.spokenFor !== undefined ? { spokenFor: c.spokenFor } : {}) },
  };
}

/** Why the Airi rail asks the CFO, as a code: above the limit alone, or the day's purchases alone used up. */
function airiCfoReason(why: string): string {
  if (why.startsWith("above the ")) return "above_alone_limit";
  if (why.startsWith("already ")) return "alone_per_day_used";
  throw new Error(`an Airi reason to ask the CFO this module does not know: ${why}`);
}

/** What Purser's own code decides on these facts: the functions the engine runs, called as they are. */
export function purserDecision(policy: RegoPolicy, payment: RegoPayment, ctx: RegoContext = {}): RegoDecision {
  switch (payment.kind) {
    case "supplier_payment": {
      const e = enforceProposal(paymentCaseOf(policy, payment, ctx), payment.proposal);
      return { outcome: e.outcome, reason: e.overridden_by };
    }
    case "agent_purchase": {
      if (!policy.agentPurchase) throw new Error("the policy has no agentPurchase (the Airi rail's policy)");
      const d = decideAiriPurchase(policy.agentPurchase, payment.request, ctx.aloneToday);
      if (d.route === "alone") return { outcome: "pay", reason: null };
      if (d.route === "cfo") return { outcome: "ask_cfo", reason: airiCfoReason(d.why) };
      return { outcome: "refuse", reason: d.code };
    }
    case "pay_alone": {
      // approveWithinLimit (src/policy/approvals.ts) approves nothing without a limit in force.
      if (!policy.aloneLimit) return { outcome: "ask_cfo", reason: "no_limit" };
      const d = aloneDecision(payment.amount, payment.currency, policy.aloneLimit);
      return d === "within" ? { outcome: "pay", reason: null } : { outcome: "ask_cfo", reason: d };
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const AMOUNT = /^(0|[1-9]\d*)\.\d{2}$/;

/** A company's policy file read and checked: every field Purser's policy has, in its shape. Throws with the reason. */
export function readRegoPolicy(raw: unknown): RegoPolicy {
  if (!isObj(raw)) throw new Error("the policy must be a JSON object");
  const { aloneLimit, cashFloors, payLate, agentPurchase } = raw;
  if (aloneLimit !== null && !(isObj(aloneLimit) && typeof aloneLimit.currency === "string" && typeof aloneLimit.amount === "string" && AMOUNT.test(aloneLimit.amount))) {
    throw new Error('aloneLimit: null, or {"currency": "EUR", "amount": "500.00"}');
  }
  if (!isObj(cashFloors) || !Object.values(cashFloors).every((v) => typeof v === "string" && AMOUNT.test(v))) throw new Error('cashFloors: {"EUR": "25000.00", ...}');
  if (payLate !== null && !(isObj(payLate) && Number.isSafeInteger(payLate.maxDays))) throw new Error('payLate: null, or {"maxDays": 5}');
  if (agentPurchase !== undefined) {
    const a = agentPurchase as Record<string, unknown>;
    const ok = isObj(a) && Number.isSafeInteger(a.aloneMaxCents) && Number.isSafeInteger(a.alonePerDay) && Number.isSafeInteger(a.hardCapCents)
      && Array.isArray(a.currencies) && a.currencies.every((x) => typeof x === "string") && Array.isArray(a.merchants) && a.merchants.every((x) => typeof x === "string");
    if (!ok) throw new Error("agentPurchase: {aloneMaxCents, alonePerDay, hardCapCents, currencies: [...], merchants: [https origins]}");
  }
  return raw as unknown as RegoPolicy;
}

/**
 * Writes the bundle OPA loads for a company: the rules (purser.rego, as in this repository), the company's policy as
 * data.json, and a manifest whose revision is the SHA-256 of the two. `opa eval -b <dir> 'data.purser.policy.decision'`.
 */
export function writeRegoBundle(policy: RegoPolicy, outDir: string): { files: string[]; revision: string } {
  const rego = readFileSync(REGO_PATH, "utf8");
  const data = `${JSON.stringify(regoData(policy), null, 2)}\n`;
  const revision = createHash("sha256").update(rego).update("\0").update(data).digest("hex");
  mkdirSync(outDir, { recursive: true });
  const files = [join(outDir, "purser.rego"), join(outDir, "data.json"), join(outDir, ".manifest")];
  writeFileSync(files[0]!, rego);
  writeFileSync(files[1]!, data);
  writeFileSync(files[2]!, `${JSON.stringify({ revision, roots: ["purser"] }, null, 2)}\n`);
  return { files, revision };
}
