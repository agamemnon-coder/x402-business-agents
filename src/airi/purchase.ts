// Airi rail, groundwork only (docs/plans/vic-airi.md): the executor's decisions for an agent's card purchase paid with
// a single-use credential from Airwallex's Airi wallet. Not wired into the runner (src/executors/index.ts has no
// airi_purchase case): nothing here runs outside the tests, and the only client is the stand-in (./standIn.ts).
//
//   1. Purser's own checks, before any outside call: emergency stop, paused or stopped agent, amount, currency,
//      merchant, items. A refusal returns Purser's code and is audited; Airi is never asked.
//   2. At or below the CFO's limit for Airi purchases the purchase runs on its own. Above it, a proposal whose terms
//      (agent, amount, currency, merchant, items) the CFO signs with Face ID; above the hard cap, refused even so.
//   3. Running: the mandate is built from the terms only. Before the credential is requested the terms hash is checked
//      again (for a proposal: the stored terms still hash to the approved hash). Then the credential goes to a private
//      file, the checkout reads it, the file is deleted, and the result is reported to Airi.
//   4. The audit log gets a row per request and per result with safe references only: the order's hash, the mandate
//      id, the receipt's status and token type, the merchant's order reference. Never the credential, the file's
//      contents or the passkey URL.
//
// Airi's own passkey approval (the wallet owner's, on app.airi.com) happens for every mandate, whatever Purser decided:
// the CFO's Face ID above the limit comes on top of it, not instead of it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../lib/terms.js";
import { beginExecution, closeAsStale, createProposal, finishExecution, nextProposalId } from "../policy/approvals.js";
import { frozen, paused } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";
import { AiriRefusal, type AiriCheckout, type AiriClient, type AiriMandateRequest } from "./client.js";

export const AIRI_PURCHASE_KIND = "airi_purchase";
const TTL_MS = 30 * 60 * 1000;

/** The CFO's settings for this rail. Wiring them into the CFO policy (src/policy/rules.ts) is step 1's work. */
export interface AiriPolicy {
  /** At or below: the agent's purchase runs without the CFO. */
  autoMaxCents: number;
  /** Above: refused, even with Face ID. */
  hardCapCents: number;
  currencies: readonly string[];
  /** Allowed merchants as https origins, e.g. "https://shop.example". */
  merchants: readonly string[];
}

export interface AiriPurchaseRequest {
  agent: Agent;
  paymentMethodId: string;
  merchantName: string;
  merchantUrl: string;
  merchantCountry: string;
  amount: string;
  currency: string;
  items: { name: string; unitPrice: string; quantity: string }[];
  description: string;
}

/** Purser's own refusal codes: what the person sees, word for word. */
export type PurserRefusalCode =
  | "PURSER_EMERGENCY_STOP" | "PURSER_AGENT_PAUSED" | "PURSER_AGENT_STOPPED"
  | "PURSER_AMOUNT_INVALID" | "PURSER_ITEMS_TOTAL_MISMATCH" | "PURSER_CURRENCY_NOT_ALLOWED"
  | "PURSER_MERCHANT_URL_INVALID" | "PURSER_MERCHANT_NOT_ALLOWED" | "PURSER_ABOVE_HARD_CAP"
  | "PURSER_HASH_MISMATCH" | "PURSER_NOT_AN_AIRI_PURCHASE";

export type AiriDecision =
  | { route: "auto" }
  | { route: "cfo" }
  | { route: "refused"; code: PurserRefusalCode; reason: string };

export type AiriOutcome =
  | { status: "refused"; by: "purser" | "airi" | "checkout"; code: string; reason: string; proposalId?: string; mandateId?: string }
  | { status: "pending_approval"; proposalId: string; termsSha256: string }
  | { status: "succeeded"; orderSha256: string; mandateId: string; reference: string; proposalId?: string; label: string }
  /** The checkout's outcome is not known: nothing is retried and nothing is reported to Airi until a person looks. */
  | { status: "unconfirmed"; orderSha256: string; mandateId: string; reason: string; proposalId?: string };

export interface AiriDeps {
  airi: AiriClient;
  checkout: AiriCheckout;
  policy: AiriPolicy;
  /** Shows the wallet owner Airi's passkey URL for this mandate. The URL is never written to the log. */
  showPasskeyUrl: (url: string, order: { merchantName: string; amount: string; currency: string }) => void;
}

const AMOUNT = /^(0|[1-9]\d{0,8})\.\d{2}$/;

function cents(s: string): number | null {
  return AMOUNT.test(s) ? toCents(s) : null;
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/** Pure: where this request goes under this policy. */
export function decideAiriPurchase(policy: AiriPolicy, req: AiriPurchaseRequest): AiriDecision {
  const refuse = (code: PurserRefusalCode, reason: string): AiriDecision => ({ route: "refused", code, reason });
  const total = cents(req.amount);
  if (total === null || total === 0) return refuse("PURSER_AMOUNT_INVALID", `the amount ${JSON.stringify(req.amount)} is not a positive two-decimal amount`);
  let sum = 0;
  for (const i of req.items) {
    const each = cents(i.unitPrice);
    if (each === null || !/^[1-9]\d{0,3}$/.test(i.quantity)) return refuse("PURSER_AMOUNT_INVALID", `item ${JSON.stringify(i.name)} has no valid price or quantity`);
    sum += each * Number(i.quantity);
  }
  if (req.items.length === 0 || sum !== total) return refuse("PURSER_ITEMS_TOTAL_MISMATCH", `the items add up to ${(sum / 100).toFixed(2)}, the total is ${req.amount}`);
  if (!policy.currencies.includes(req.currency)) return refuse("PURSER_CURRENCY_NOT_ALLOWED", `${req.currency} is not a currency the CFO allows on this rail`);
  const origin = originOf(req.merchantUrl);
  if (!origin) return refuse("PURSER_MERCHANT_URL_INVALID", "the merchant URL is not a plain https URL");
  if (!policy.merchants.includes(origin)) return refuse("PURSER_MERCHANT_NOT_ALLOWED", `${origin} is not a merchant the CFO allows on this rail`);
  if (total > policy.hardCapCents) return refuse("PURSER_ABOVE_HARD_CAP", `${req.amount} ${req.currency} is above the hard cap of ${(policy.hardCapCents / 100).toFixed(2)}; not even Face ID can approve it`);
  return total <= policy.autoMaxCents ? { route: "auto" } : { route: "cfo" };
}

/** The terms: what the CFO signs above the limit, and what the order's hash covers at any amount. No numbers in it. */
export function airiTerms(req: AiriPurchaseRequest, proposalId: string, expiresAt: string): Terms {
  return {
    schema: TERMS_SCHEMA, kind: AIRI_PURCHASE_KIND, proposal_id: proposalId, expires_at: expiresAt,
    agent: req.agent, amount: req.amount, currency: req.currency,
    merchant: { name: req.merchantName, url: req.merchantUrl, country: req.merchantCountry },
    items: req.items.map((i) => ({ name: i.name, unit_price: i.unitPrice, quantity: i.quantity })),
    description: req.description, payment_method_id: req.paymentMethodId,
  };
}

type AiriTerms = Terms & {
  agent: Agent; amount: string; currency: string; merchant: { name: string; url: string; country: string };
  items: { name: string; unit_price: string; quantity: string }[]; description: string; payment_method_id: string;
};

function requestFromTerms(t: AiriTerms): AiriPurchaseRequest {
  return {
    agent: t.agent, paymentMethodId: t.payment_method_id, merchantName: t.merchant.name, merchantUrl: t.merchant.url,
    merchantCountry: t.merchant.country, amount: t.amount, currency: t.currency, description: t.description,
    items: t.items.map((i) => ({ name: i.name, unitPrice: i.unit_price, quantity: i.quantity })),
  };
}

function mandateFromTerms(t: AiriTerms): AiriMandateRequest {
  return {
    source: `Purser ${t.agent} agent`, paymentMethodId: t.payment_method_id, merchantName: t.merchant.name,
    merchantUrl: t.merchant.url, merchantCountry: t.merchant.country, totalAmount: t.amount, currency: t.currency,
    items: t.items.map((i) => ({ name: i.name, unitPrice: i.unit_price, quantity: i.quantity })), description: t.description,
  };
}

/** A refusal's text as it may be stored: secrets redacted, one line, bounded. */
function safeText(s: string): string {
  return redactSecrets(s).replace(/\p{Cc}+/gu, " ").slice(0, 300);
}

function agentState(db: DB, agent: Agent): AiriDecision | null {
  if (frozen(db)) return { route: "refused", code: "PURSER_EMERGENCY_STOP", reason: "the emergency stop is on" };
  if (paused(db, agent)) return { route: "refused", code: "PURSER_AGENT_PAUSED", reason: `the ${agent} agent is paused by the CFO` };
  if (stopped(db, agent)) return { route: "refused", code: "PURSER_AGENT_STOPPED", reason: `the ${agent} agent was stopped (velocity limit)` };
  return null;
}

/**
 * An agent asks to buy. Refused: audited, nothing outside is called. Above the limit: a proposal for the CFO's Face ID,
 * nothing outside is called. Within the limit: runs now.
 */
export async function requestAiriPurchase(db: DB, deps: AiriDeps, req: AiriPurchaseRequest, now = new Date()): Promise<AiriOutcome> {
  const decision = agentState(db, req.agent) ?? decideAiriPurchase(deps.policy, req);
  const origin = originOf(req.merchantUrl);
  audit(db, req.agent, "airi.purchase_requested", origin, { agent: req.agent, amount: req.amount, currency: req.currency, merchant: req.merchantName, route: decision.route, client: deps.airi.kind }, now);
  if (decision.route === "refused") {
    audit(db, "system", "airi.purchase_refused", origin, { agent: req.agent, by: "purser", code: decision.code, reason: decision.reason }, now);
    return { status: "refused", by: "purser", code: decision.code, reason: decision.reason };
  }
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  if (decision.route === "cfo") {
    const p = createProposal(db, { terms: airiTerms(req, nextProposalId(db), expiresAt), createdBy: req.agent, assignId: true }, now);
    return { status: "pending_approval", proposalId: p.proposal_id, termsSha256: p.terms_sha256 };
  }
  // Within the limit: no proposal, but the same terms and hash, so the run below is bound to them just the same.
  const terms = airiTerms(req, `airi-auto-${now.getTime()}`, expiresAt) as AiriTerms;
  const sha = termsHash(terms);
  const frozenText = JSON.stringify(terms);
  return run(db, deps, terms, sha, () => termsHash(JSON.parse(frozenText) as Terms) === sha, undefined, now);
}

/** Runs an approved airi_purchase proposal. The executor's own checks come first; the approval does not skip them. */
export async function executeAiriPurchase(db: DB, deps: AiriDeps, proposalId: string, now = new Date()): Promise<AiriOutcome> {
  const row = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string } | undefined;
  if (!row || row.kind !== AIRI_PURCHASE_KIND) return { status: "refused", by: "purser", code: "PURSER_NOT_AN_AIRI_PURCHASE", reason: `${proposalId} is not an Airi purchase`, proposalId };
  // The policy may have tightened since the CFO signed: checked again now, and a refusal closes the proposal.
  const stored = JSON.parse(row.terms_json) as AiriTerms;
  const again = agentState(db, stored.agent) ?? decideAiriPurchase(deps.policy, requestFromTerms(stored));
  if (again.route === "refused") {
    audit(db, "system", "airi.purchase_refused", proposalId, { agent: stored.agent, by: "purser", code: again.code, reason: again.reason }, now);
    closeAsStale(db, proposalId, { error: `${again.code}: ${again.reason}` }, {}, now);
    return { status: "refused", by: "purser", code: again.code, reason: again.reason, proposalId };
  }
  // The stored terms hash to the approved hash, the approval is unused and in time (src/policy/approvals.ts).
  const terms = beginExecution<AiriTerms>(db, proposalId, (t) => {
    if (t.kind !== AIRI_PURCHASE_KIND) throw new Error(`${proposalId} is not an Airi purchase`);
  }, now);
  const sha = termsHash(terms);
  const stillApproved = (): boolean => {
    const p = db.prepare("SELECT status, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string; terms_json: string; terms_sha256: string };
    const a = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as { approved_sha256: string; decision: string } | undefined;
    const now2 = termsHash(JSON.parse(p.terms_json) as Terms);
    return p.status === "EXECUTING" && a?.decision === "APPROVED" && now2 === sha && p.terms_sha256 === sha && a.approved_sha256 === sha;
  };
  return run(db, deps, terms, sha, stillApproved, proposalId, now);
}

async function run(db: DB, deps: AiriDeps, terms: AiriTerms, sha: string, recheck: () => boolean, proposalId: string | undefined, now: Date): Promise<AiriOutcome> {
  const subject = proposalId ?? originOf(terms.merchant.url);
  const ids = { order_sha256: sha, ...(proposalId ? { proposal_id: proposalId } : {}) };
  const end = (outcome: "EXECUTED" | "FAILED", detail: Json) => { if (proposalId) finishExecution(db, proposalId, outcome, detail, now); };
  const refused = (by: "airi" | "checkout" | "purser", code: string, reason: string, mandateId?: string): AiriOutcome => {
    audit(db, "system", "airi.purchase_refused", subject, { ...ids, agent: terms.agent, by, code: safeText(code), reason: safeText(reason), ...(mandateId ? { mandate_id: mandateId } : {}) }, now);
    end("FAILED", { by, code: safeText(code) });
    return { status: "refused", by, code: safeText(code), reason: safeText(reason), ...(proposalId ? { proposalId } : {}), ...(mandateId ? { mandateId } : {}) };
  };

  // The mandate, from the terms and nothing else.
  let mandate;
  try {
    mandate = await deps.airi.createMandate(mandateFromTerms(terms));
  } catch (e) {
    if (e instanceof AiriRefusal) return refused(e.by, e.code, e.message);
    throw e;
  }
  audit(db, "system", "airi.mandate_created", subject, { ...ids, mandate_id: mandate.mandateId, amount: terms.amount, currency: terms.currency, merchant: terms.merchant.name, client: deps.airi.kind }, now);

  // The hash again, before the credential is asked for. A mismatch cancels the mandate; no credential is requested.
  if (!recheck()) {
    await deps.airi.cancelMandate(mandate.mandateId);
    return refused("purser", "PURSER_HASH_MISMATCH", "the terms no longer hash to what was approved; the mandate was cancelled and no credential requested", mandate.mandateId);
  }
  deps.showPasskeyUrl(mandate.passkeyUrl, { merchantName: terms.merchant.name, amount: terms.amount, currency: terms.currency });

  const dir = mkdtempSync(join(tmpdir(), "purser-airi-"));
  try {
    const file = join(dir, "credential.json");
    let receipt;
    try {
      receipt = await deps.airi.getCredential(mandate.mandateId, file);
    } catch (e) {
      if (e instanceof AiriRefusal) return refused(e.by, e.code, e.message, mandate.mandateId);
      throw e;
    }
    audit(db, "system", "airi.credential_received", subject, { ...ids, mandate_id: mandate.mandateId, status: safeText(receipt.status), token_type: safeText(receipt.tokenType), token_expiration: safeText(receipt.tokenExpiration) }, now);

    let result;
    try {
      result = await deps.checkout.submit({ merchantUrl: terms.merchant.url, amount: terms.amount, currency: terms.currency }, file);
    } catch (e) {
      // Not known whether the merchant charged: never retried, never reported as a result, left for a person.
      const reason = safeText(e instanceof Error ? e.message : String(e));
      audit(db, "system", "airi.checkout_unconfirmed", subject, { ...ids, mandate_id: mandate.mandateId, reason }, now);
      end("FAILED", { unconfirmed: true, mandate_id: mandate.mandateId });
      return { status: "unconfirmed", orderSha256: sha, mandateId: mandate.mandateId, reason, ...(proposalId ? { proposalId } : {}) };
    }
    await deps.airi.reportResult(mandate.mandateId, result.outcome, result.code);
    audit(db, "system", "airi.checkout_result", subject, { ...ids, mandate_id: mandate.mandateId, outcome: result.outcome, reference: safeText(result.reference), ...(result.code ? { code: safeText(result.code) } : {}), checkout: deps.checkout.kind }, now);
    if (result.outcome !== "SUCCEEDED") return refused("checkout", result.code ?? result.outcome, `the checkout answered ${result.outcome}`, mandate.mandateId);
    end("EXECUTED", { mandate_id: mandate.mandateId, reference: safeText(result.reference), client: deps.airi.kind });
    return { status: "succeeded", orderSha256: sha, mandateId: mandate.mandateId, reference: result.reference, label: deps.airi.label, ...(proposalId ? { proposalId } : {}) };
  } finally {
    // The credential lives only for this checkout.
    rmSync(dir, { recursive: true, force: true });
  }
}
