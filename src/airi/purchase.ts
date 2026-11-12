// The Airi rail's executor (docs/plans/vic-airi.md, step 1): an agent's purchase paid with a single-use card credential
// from Airwallex's Airi wallet, at a merchant's checkout. On only with KIT11_AIRI_RAIL=on (src/airi/policy.ts).
//
//   1. Purser's checks first, calling nothing outside: emergency stop, pause, velocity stop, the agent's identity,
//      amount, items adding up, currency, merchant, hard cap. A refusal returns Purser's code and is audited.
//   2. Within the CFO's limit and the day's count, the purchase is reserved (a row in airi_purchases, under the write
//      lock: that is its hold) and runs at once. Above, a proposal whose terms (agent, amount, currency, merchant, items)
//      the CFO signs with Face ID; it runs when the runner executes it (src/executors/index.ts).
//   3. The run, each outside call a step in money_steps (src/policy/saga.ts): the checkout's order is opened (no card),
//      the mandate is created from the terms only, its description carrying the action's id and the full SHA-256 of
//      those terms; the terms hash is checked again; the mandate is read back from Airi and must carry that id and the
//      approved hash (Airi stores the description, it does not check it: the check is Purser's); only then the wallet
//      owner taps in Airi (the link is shown on the operator console only), the credential goes to a fresh 0700
//      directory, the checkout reads it and pays, the directory is removed, and the result is reported to Airi. When
//      Purser stops before the checkout, the mandate is cancelled.
//   4. Audit rows carry safe references only: the order's hash, the mandate id, the receipt's status and token type,
//      the checkout's reference and code. Never the credential, its file, or the passkey link.
//   5. After a crash nothing is sent twice: a started payment is looked up at the checkout by its reference; anything
//      stopped before the payment is cancelled at Airi and released (recoverAiriPurchases).
//
// Airi's own passkey approval (the wallet owner's, in Airi) happens for every mandate, whatever Purser decided: the
// CFO's Face ID above the limit comes on top of it, not instead of it.

import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../lib/terms.js";
import { beginExecution, closeAsStale, createProposal, finishExecution, nextProposalId, resuming } from "../policy/approvals.js";
import { authorize } from "../policy/principals.js";
import { frozen, paused } from "../policy/rules.js";
import { finishStep, startStep, stepDone } from "../policy/saga.js";
import { stopped } from "../policy/velocity.js";
import { currentOrigin, withOrigin, type Origin } from "../provenance/origin.js";
import { AIRI_TEXT_MAX, AiriRefusal, AiriWaitTimeout, CheckoutOutcomeUnknown, scrubText, type AiriCheckout, type AiriClient, type AiriMandateRecord, type AiriMandateRequest, type CheckoutAnswer } from "./client.js";
import { airiPolicy, type AiriPolicy } from "./policy.js";

export const AIRI_PURCHASE_KIND = "airi_purchase";
export const AIRI_ALONE_RULE = "an Airi purchase within the CFO's limit for this rail";
const TTL_MS = 30 * 60 * 1000;
export const TMP_PREFIX = "purser-airi-";
/** How often the mandate is looked for in Airi's list before the credential is asked for, and the wait between two tries. */
export const READ_BACK_TRIES = 3;
export const READ_BACK_WAIT_MS = 1500;

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
  | "PURSER_EMERGENCY_STOP" | "PURSER_AGENT_PAUSED" | "PURSER_AGENT_STOPPED" | "PURSER_IDENTITY_DENIED"
  | "PURSER_AMOUNT_INVALID" | "PURSER_ITEMS_TOTAL_MISMATCH" | "PURSER_CURRENCY_NOT_ALLOWED"
  | "PURSER_MERCHANT_URL_INVALID" | "PURSER_MERCHANT_NOT_ALLOWED" | "PURSER_ABOVE_HARD_CAP"
  | "PURSER_HASH_MISMATCH" | "PURSER_MANDATE_HASH_MISMATCH" | "PURSER_MANDATE_NOT_READ_BACK"
  | "PURSER_NOT_AN_AIRI_PURCHASE" | "PURSER_NO_TAP" | "PURSER_RESTARTED_BEFORE_CHECKOUT";

export type AiriDecision = { route: "alone" } | { route: "cfo"; why: string } | { route: "refused"; code: PurserRefusalCode; reason: string };

export type AiriOutcome =
  | { status: "refused"; by: "purser" | "airi" | "checkout"; code: string; reason: string; actionId?: string; proposalId?: string; mandateId?: string }
  | { status: "pending_approval"; proposalId: string; termsSha256: string }
  | { status: "succeeded"; actionId: string; orderSha256: string; mandateId: string; reference: string; code?: string; proposalId?: string; label: string }
  /** The checkout's outcome is not known: nothing is retried and nothing is reported to Airi until a look-up tells. */
  | { status: "unconfirmed"; actionId: string; orderSha256: string; mandateId: string; reference: string; reason: string; proposalId?: string };

export interface AiriDeps {
  airi: AiriClient;
  checkout: AiriCheckout;
  /** Shows the wallet owner Airi's one-time approval link: the operator console only, never a log or a record. */
  showPasskeyUrl: (url: string, info: { actionId: string; merchant: string; amount: string; currency: string }) => void;
  /** Called once the tap is over (credential or not): a sink that kept the link somewhere removes it. */
  clearPasskeyUrl?: (actionId: string) => void;
  /** The operator console: what is happening, no secrets. */
  say?: (line: string) => void;
  /** Where the 0700 credential directories go (default: the OS temp dir). */
  tmpRoot?: string;
  /** The wait between two tries of the mandate read-back (default: a timer). */
  sleep?: (ms: number) => Promise<void>;
}

const AMOUNT = /^(0|[1-9]\d{0,8})\.\d{2}$/;
const cents = (s: string): number | null => (AMOUNT.test(s) ? toCents(s) : null);

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/** Pure: where this request goes under this policy, given how many purchases ran alone today. */
export function decideAiriPurchase(policy: AiriPolicy, req: AiriPurchaseRequest, aloneToday = 0): AiriDecision {
  const refuse = (code: PurserRefusalCode, reason: string): AiriDecision => ({ route: "refused", code, reason });
  const total = cents(req.amount);
  if (total === null || total === 0) return refuse("PURSER_AMOUNT_INVALID", `the amount ${JSON.stringify(req.amount)} is not a positive two-decimal amount`);
  let sum = 0;
  for (const i of req.items) {
    const each = cents(i.unitPrice);
    if (each === null || !/^[1-9]\d{0,3}$/.test(i.quantity)) return refuse("PURSER_AMOUNT_INVALID", `item ${JSON.stringify(i.name)} has no valid price or quantity`);
    sum += each * Number(i.quantity);
  }
  if (req.items.length === 0 || sum !== total) return refuse("PURSER_ITEMS_TOTAL_MISMATCH", `the items add up to ${fromCents(sum)}, the total is ${req.amount}`);
  if (!policy.currencies.includes(req.currency)) return refuse("PURSER_CURRENCY_NOT_ALLOWED", `${req.currency} is not a currency the CFO allows on this rail`);
  const origin = originOf(req.merchantUrl);
  if (!origin) return refuse("PURSER_MERCHANT_URL_INVALID", "the merchant URL is not a plain https URL");
  if (!policy.merchants.includes(origin)) return refuse("PURSER_MERCHANT_NOT_ALLOWED", `${origin} is not a merchant the CFO allows on this rail`);
  if (total > policy.hardCapCents) return refuse("PURSER_ABOVE_HARD_CAP", `${req.amount} ${req.currency} is above the hard cap of ${fromCents(policy.hardCapCents)}; not even Face ID can approve it`);
  if (total > policy.aloneMaxCents) return { route: "cfo", why: `above the ${fromCents(policy.aloneMaxCents)} the agent may spend alone` };
  if (aloneToday >= policy.alonePerDay) return { route: "cfo", why: `already ${aloneToday} purchase(s) without Face ID today (the CFO allows ${policy.alonePerDay})` };
  return { route: "alone" };
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

export type AiriTerms = Terms & {
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

/** The tag that ends a mandate's description: the action's id and the full SHA-256 of its terms. */
const tagOf = (actionId: string, termsSha256: string) => `[${actionId} terms:${termsSha256}]`;

/**
 * The mandate's description: the purchase's own text, then the tag with the action's id (so a restart can find the
 * mandate it made) and the full SHA-256 of the very terms the mandate is built from (the hash the CFO signed, above the
 * limit). The text is cut to make room; the tag never is: the whole stays within AIRI_TEXT_MAX.
 */
export function mandateDescription(t: AiriTerms, actionId: string): string {
  const tag = tagOf(actionId, termsHash(t));
  const text = t.description.slice(0, Math.max(0, AIRI_TEXT_MAX - tag.length - 1)).trimEnd();
  return text ? `${text} ${tag}` : tag;
}

/** The tag at the end of a mandate description, or null when it has none. */
export function mandateTag(description: string): { actionId: string; termsSha256: string } | null {
  const m = /\[(\S{1,64}) terms:([0-9a-f]{64})\]$/.exec(description);
  return m ? { actionId: m[1]!, termsSha256: m[2]! } : null;
}

function mandateFromTerms(t: AiriTerms, actionId: string): AiriMandateRequest {
  return {
    source: `Purser ${t.agent} agent`, paymentMethodId: t.payment_method_id, merchantName: t.merchant.name,
    merchantUrl: t.merchant.url, merchantCountry: t.merchant.country, totalAmount: t.amount, currency: t.currency,
    items: t.items.map((i) => ({ name: i.name, unitPrice: i.unit_price, quantity: i.quantity })), description: mandateDescription(t, actionId),
  };
}

/** A refusal's text as it may be stored: secrets redacted, no link, no long digit run, one line, bounded. */
const safe = (s: string): string => scrubText(redactSecrets(s));

/** Refusals by the agent's state and identity, before any amount is looked at. */
function stateRefusal(db: DB, agent: Agent, now: Date): AiriDecision | null {
  if (frozen(db)) return { route: "refused", code: "PURSER_EMERGENCY_STOP", reason: "the emergency stop is on" };
  if (paused(db, agent)) return { route: "refused", code: "PURSER_AGENT_PAUSED", reason: `the ${agent} agent is paused by the CFO` };
  if (stopped(db, agent)) return { route: "refused", code: "PURSER_AGENT_STOPPED", reason: `the ${agent} agent was stopped (velocity limit)` };
  const denied = authorize(db, agent, { rail: "card", currency: "EUR", payee: "merchants" }, now);
  if (denied) return { route: "refused", code: "PURSER_IDENTITY_DENIED", reason: denied };
  return null;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const aloneToday = (db: DB, now: Date) => (db.prepare("SELECT COUNT(*) AS n FROM airi_purchases WHERE day = ? AND route = 'alone' AND status != 'RELEASED'").get(dayOf(now)) as { n: number }).n;

interface Row {
  action_id: string; agent: Agent; route: "alone" | "cfo"; proposal_id: string | null; order_sha256: string; terms_json: string;
  cents: number; status: string; mandate_id: string | null; checkout_ref: string | null; created_at: string;
}
const rowOf = (db: DB, actionId: string) => db.prepare("SELECT * FROM airi_purchases WHERE action_id = ?").get(actionId) as Row | undefined;
function setRow(db: DB, actionId: string, fields: Partial<Record<"status" | "mandate_id" | "checkout_ref" | "outcome" | "code", string | null>>, now: Date): void {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE airi_purchases SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE action_id = ?`).run(...keys.map((k) => fields[k as keyof typeof fields] ?? null), now.toISOString(), actionId);
}

/** The origin of a purchase that runs alone: code's rule, set by whoever asked (D24). */
function aloneOrigin(agent: Agent): Origin {
  const base = currentOrigin();
  return { actor: "code", rule: AIRI_ALONE_RULE, agent, ...(base && base.actor !== "code" ? { set_by: base } : {}) };
}

/**
 * An agent asks to buy. Refused: audited, nothing outside is called. Above the limit (or past the day's count): a
 * proposal for the CFO's Face ID, nothing outside is called. Within: reserved and run now.
 */
export async function requestAiriPurchase(db: DB, deps: AiriDeps, req: AiriPurchaseRequest, now = new Date()): Promise<AiriOutcome> {
  const merchantOrigin = originOf(req.merchantUrl);
  const actionId = `airi-${now.getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  // Decided and, within the limit, reserved in one write transaction: two requests cannot both take the day's last one.
  const decided = db.transaction((): AiriDecision => {
    const d = stateRefusal(db, req.agent, now) ?? decideAiriPurchase(airiPolicy(db), req, aloneToday(db, now));
    if (d.route !== "alone") return d;
    const terms = airiTerms(req, actionId, expiresAt);
    db.prepare(`INSERT INTO airi_purchases (action_id, agent, route, proposal_id, order_sha256, terms_json, cents, day, status, created_at, updated_at)
      VALUES (?, ?, 'alone', NULL, ?, ?, ?, ?, 'HELD', ?, ?)`).run(actionId, req.agent, termsHash(terms), JSON.stringify(terms), toCents(req.amount), dayOf(now), now.toISOString(), now.toISOString());
    return d;
  }).immediate();
  audit(db, req.agent, "airi.purchase_requested", merchantOrigin, { agent: req.agent, amount: req.amount, currency: req.currency, merchant: safe(req.merchantName), route: decided.route, client: deps.airi.kind, ...(decided.route === "alone" ? { action_id: actionId } : {}) }, now);
  if (decided.route === "refused") {
    audit(db, "system", "airi.purchase_refused", merchantOrigin, { agent: req.agent, by: "purser", code: decided.code, reason: safe(decided.reason) }, now);
    return { status: "refused", by: "purser", code: decided.code, reason: decided.reason };
  }
  if (decided.route === "cfo") {
    let p;
    try {
      p = createProposal(db, {
        terms: airiTerms(req, nextProposalId(db), expiresAt), createdBy: req.agent, assignId: true,
        explanation: `An Airi purchase ${decided.why}: the CFO's Face ID over agent, amount, currency, merchant and items.`,
        // Checked again inside the proposal's own write lock.
        guard: (g) => { const again = stateRefusal(g, req.agent, now) ?? decideAiriPurchase(airiPolicy(g), req, Number.MAX_SAFE_INTEGER); return again.route === "refused" ? `${again.code}: ${again.reason}` : null; },
      }, now);
    } catch (e) {
      const reason = (e as Error).message;
      audit(db, "system", "airi.purchase_refused", merchantOrigin, { agent: req.agent, by: "purser", code: "PURSER_POLICY_CHANGED", reason: safe(reason) }, now);
      return { status: "refused", by: "purser", code: "PURSER_POLICY_CHANGED", reason };
    }
    return { status: "pending_approval", proposalId: p.proposal_id, termsSha256: p.terms_sha256 };
  }
  const row = rowOf(db, actionId)!;
  return withOrigin(aloneOrigin(req.agent), () => run(db, deps, row, () => {
    const r = rowOf(db, actionId);
    return !!r && termsHash(JSON.parse(r.terms_json) as Terms) === r.order_sha256 && r.order_sha256 === row.order_sha256;
  }, now));
}

/**
 * Runs an approved airi_purchase proposal (the runner, src/executors/index.ts). The executor's own checks come first;
 * the approval does not skip them. A restart's resume (src/policy/saga.ts) lands here too and finishes what was left.
 */
export async function executeAiriPurchase(db: DB, deps: AiriDeps, proposalId: string, now = new Date()): Promise<AiriOutcome> {
  const p = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string } | undefined;
  if (!p || p.kind !== AIRI_PURCHASE_KIND) return { status: "refused", by: "purser", code: "PURSER_NOT_AN_AIRI_PURCHASE", reason: `${proposalId} is not an Airi purchase`, proposalId };
  const existing = db.prepare("SELECT action_id FROM airi_purchases WHERE proposal_id = ?").get(proposalId) as { action_id: string } | undefined;
  if (existing) {
    // Only a restart's resume finishes an action that began; a failed one is never run a second time.
    if (!resuming.has(proposalId)) return { status: "refused", by: "purser", code: "PURSER_ALREADY_RAN", reason: `${proposalId} already ran once; a new purchase needs a new proposal`, proposalId };
    const out = await recoverOne(db, deps, existing.action_id, now);
    return out ?? { status: "refused", by: "purser", code: "PURSER_RESTARTED_BEFORE_CHECKOUT", reason: "resumed after a restart", proposalId };
  }
  // The policy may have tightened since the CFO signed: checked again now; a refusal closes the proposal.
  const stored = JSON.parse(p.terms_json) as AiriTerms;
  const again = stateRefusal(db, stored.agent, now) ?? decideAiriPurchase(airiPolicy(db), requestFromTerms(stored), Number.MAX_SAFE_INTEGER);
  if (again.route === "refused") {
    audit(db, "system", "airi.purchase_refused", proposalId, { agent: stored.agent, by: "purser", code: again.code, reason: safe(again.reason) }, now);
    closeAsStale(db, proposalId, { error: `${again.code}: ${again.reason}` }, {}, now);
    return { status: "refused", by: "purser", code: again.code, reason: again.reason, proposalId };
  }
  // The stored terms hash to the approved hash, the approval is unused and in time (src/policy/approvals.ts).
  const terms = beginExecution<AiriTerms>(db, proposalId, (t) => {
    if (t.kind !== AIRI_PURCHASE_KIND) throw new Error(`${proposalId} is not an Airi purchase`);
  }, now);
  const sha = termsHash(terms);
  const actionId = proposalId;
  db.prepare(`INSERT INTO airi_purchases (action_id, agent, route, proposal_id, order_sha256, terms_json, cents, day, status, created_at, updated_at)
    VALUES (?, ?, 'cfo', ?, ?, ?, ?, ?, 'HELD', ?, ?)`).run(actionId, terms.agent, proposalId, sha, JSON.stringify(terms), toCents(terms.amount), dayOf(now), now.toISOString(), now.toISOString());
  const stillApproved = (): boolean => {
    const q = db.prepare("SELECT status, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string; terms_json: string; terms_sha256: string };
    const a = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as { approved_sha256: string; decision: string } | undefined;
    const r = rowOf(db, actionId);
    return q.status === "EXECUTING" && a?.decision === "APPROVED" && termsHash(JSON.parse(q.terms_json) as Terms) === sha && q.terms_sha256 === sha && a.approved_sha256 === sha
      && !!r && r.order_sha256 === sha && termsHash(JSON.parse(r.terms_json) as Terms) === sha;
  };
  return run(db, deps, rowOf(db, actionId)!, stillApproved, now);
}

/** Ends an action: its row, its proposal (if any), the audit row. Releases the hold unless the outcome is unknown. */
function close(db: DB, row: Row, end: { status: "SETTLED" | "RELEASED" | "UNCONFIRMED"; outcome?: string; code?: string }, now: Date): void {
  setRow(db, row.action_id, { status: end.status, outcome: end.outcome ?? null, code: end.code ?? null }, now);
  if (row.proposal_id) {
    const s = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(row.proposal_id) as { status: string }).status;
    if (s === "EXECUTING") finishExecution(db, row.proposal_id, end.status === "SETTLED" ? "EXECUTED" : "FAILED", { action_id: row.action_id, ...(end.outcome ? { outcome: end.outcome } : {}), ...(end.code ? { code: end.code } : {}), ...(end.status === "UNCONFIRMED" ? { unconfirmed: true } : {}) }, now);
  }
}

async function cancelQuietly(deps: AiriDeps, db: DB, row: Row, mandateId: string, why: string, now: Date): Promise<void> {
  try {
    await deps.airi.cancelMandate(mandateId);
    audit(db, "system", "airi.mandate_cancelled", row.proposal_id ?? row.action_id, { action_id: row.action_id, mandate_id: mandateId, why: safe(why) }, now);
  } catch (e) {
    audit(db, "system", "airi.mandate_cancel_failed", row.proposal_id ?? row.action_id, { action_id: row.action_id, mandate_id: mandateId, error: safe((e as Error).message) }, now);
  }
}

function refuse(db: DB, row: Row, by: "purser" | "airi" | "checkout", code: string, reason: string, now: Date, mandateId?: string): AiriOutcome {
  audit(db, "system", "airi.purchase_refused", row.proposal_id ?? row.action_id, { action_id: row.action_id, agent: row.agent, by, code: safe(code), reason: safe(reason), ...(mandateId ? { mandate_id: mandateId } : {}) }, now);
  close(db, row, { status: "RELEASED", code: safe(code) }, now);
  return { status: "refused", by, code: safe(code), reason: safe(reason), actionId: row.action_id, ...(row.proposal_id ? { proposalId: row.proposal_id } : {}), ...(mandateId ? { mandateId } : {}) };
}

/** Steps of one action. Each outside call is recorded STARTED before and DONE after (src/policy/saga.ts). */
async function run(db: DB, deps: AiriDeps, row: Row, recheck: () => boolean, now: Date): Promise<AiriOutcome> {
  const terms = JSON.parse(row.terms_json) as AiriTerms;
  const ids = { action_id: row.action_id, order_sha256: row.order_sha256 };
  const subject = row.proposal_id ?? row.action_id;
  const say = deps.say ?? (() => {});

  // 1. The merchant's order, without the card. A checkout that cannot take it stops everything before Airi is asked.
  startStep(db, row.action_id, 1, "airi.checkout_prepare", row.action_id, now);
  // The order ref is Airwallex's request_id: unique per Airwallex account, and every world numbers its proposals from
  // P-0001, so the row's own start (to the millisecond) goes with it. Stable for this row, so a retry reuses it.
  const orderRef = `${row.action_id}-${Date.parse(row.created_at).toString(36)}`;
  const prepared = await deps.checkout.prepare({ ref: orderRef, amount: terms.amount, currency: terms.currency, description: terms.description });
  if ("outcome" in prepared) return refuse(db, row, "checkout", prepared.code, prepared.reason, now);
  finishStep(db, row.action_id, "airi.checkout_prepare", { reference: prepared.reference }, now);
  setRow(db, row.action_id, { checkout_ref: prepared.reference }, now);
  audit(db, "system", "airi.checkout_prepared", subject, { ...ids, reference: safe(prepared.reference), checkout: deps.checkout.kind }, now);

  // 2. The mandate, from the terms and nothing else.
  startStep(db, row.action_id, 2, "airi.mandate", row.action_id, now);
  let mandate;
  try {
    mandate = await deps.airi.createMandate(mandateFromTerms(terms, row.action_id));
  } catch (e) {
    if (e instanceof AiriRefusal) return refuse(db, row, e.by, e.code, e.message, now);
    // No answer: a mandate may exist. It is looked up by its description and cancelled, never used.
    const found = await deps.airi.findMandate(mandateDescription(terms, row.action_id), new Date(Date.parse(row.created_at) - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")).catch(() => null);
    if (found) await cancelQuietly(deps, db, row, found.mandateId, "mandate create had no answer", now);
    return refuse(db, row, "airi", "AIRI_NO_ANSWER", `mandate create: ${(e as Error).message}`, now, found?.mandateId);
  }
  finishStep(db, row.action_id, "airi.mandate", { mandate_id: mandate.mandateId }, now);
  setRow(db, row.action_id, { mandate_id: mandate.mandateId }, now);
  audit(db, "system", "airi.mandate_created", subject, { ...ids, mandate_id: mandate.mandateId, amount: terms.amount, currency: terms.currency, merchant: safe(terms.merchant.name), client: deps.airi.kind }, now);

  // 3. The hash again, before the credential is asked for. A mismatch cancels the mandate; no credential is requested.
  if (!recheck()) {
    await cancelQuietly(deps, db, row, mandate.mandateId, "the terms no longer hash to what was approved", now);
    return refuse(db, row, "purser", "PURSER_HASH_MISMATCH", "the terms no longer hash to what was approved; the mandate was cancelled and no credential requested", now, mandate.mandateId);
  }

  // 3b. The mandate, read back from Airi: what Airi stores for this mandate id must carry this action's id and the
  // approved terms hash. Otherwise the mandate is cancelled, the link is never shown and no credential is requested.
  const back = await readBack(deps, row, mandate.mandateId);
  if (!back.ok) {
    audit(db, "system", "airi.mandate_read_back_failed", subject, { ...ids, mandate_id: mandate.mandateId, code: back.code, ...(back.found ? { action_id_in_mandate: safe(back.found.actionId), terms_sha256_in_mandate: back.found.termsSha256 } : {}) }, now);
    await cancelQuietly(deps, db, row, mandate.mandateId, back.why, now);
    return refuse(db, row, "purser", back.code, `${back.why}; the mandate was cancelled and no credential requested`, now, mandate.mandateId);
  }
  audit(db, "system", "airi.mandate_read_back", subject, { ...ids, mandate_id: mandate.mandateId, terms_sha256_in_mandate: back.termsSha256, match: true, status: safe(back.status) }, now);
  say(`AIRI MANDATE ${row.action_id}: read back from Airi; its description carries this purchase's id and terms ${short(back.termsSha256)}`);

  // 4. The wallet owner's tap in Airi, then the credential into a fresh 0700 directory.
  setRow(db, row.action_id, { status: "WAITING_FOR_TAP" }, now);
  audit(db, "system", "airi.waiting_for_tap", subject, { ...ids, mandate_id: mandate.mandateId }, now);
  deps.showPasskeyUrl(mandate.passkeyUrl, { actionId: row.action_id, merchant: terms.merchant.name, amount: terms.amount, currency: terms.currency });
  say(`AIRI WAIT  ${row.action_id}: waiting for your tap in Airi (up to 5 minutes) for ${terms.amount} ${terms.currency} at ${terms.merchant.name}`);
  const dir = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), TMP_PREFIX));
  try {
    chmodSync(dir, 0o700);
    const file = join(dir, "credential.json");
    let receipt;
    try {
      receipt = await deps.airi.getCredential(mandate.mandateId, file);
    } catch (e) {
      if (e instanceof AiriWaitTimeout) {
        await cancelQuietly(deps, db, row, mandate.mandateId, "no tap in time", now);
        return refuse(db, row, "purser", "PURSER_NO_TAP", `${e.message}; Purser stopped and cancelled the mandate`, now, mandate.mandateId);
      }
      if (e instanceof AiriRefusal) {
        await cancelQuietly(deps, db, row, mandate.mandateId, `Airi refused the credential (${e.code})`, now);
        return refuse(db, row, "airi", e.code, e.message, now, mandate.mandateId);
      }
      await cancelQuietly(deps, db, row, mandate.mandateId, "get-credential failed", now);
      return refuse(db, row, "airi", "AIRI_CLI_FAILED", (e as Error).message, now, mandate.mandateId);
    } finally {
      deps.clearPasskeyUrl?.(row.action_id);
    }
    audit(db, "system", "airi.credential_received", subject, { ...ids, mandate_id: mandate.mandateId, status: safe(receipt.status), token_type: safe(receipt.tokenType), token_expiration: safe(receipt.tokenExpiration) }, now);
    say(`AIRI TAPPED ${row.action_id}: credential received (kept in a private file for this checkout only)`);

    // 5. The checkout pays. STARTED first: after a crash the payment is looked up by its reference, never resent.
    setRow(db, row.action_id, { status: "PAYING" }, now);
    startStep(db, row.action_id, 3, "airi.checkout_pay", prepared.reference, now);
    let answer: CheckoutAnswer;
    try {
      answer = await deps.checkout.pay(prepared.reference, orderRef, file);
    } catch (e) {
      const reason = e instanceof CheckoutOutcomeUnknown ? e.message : `the checkout failed without an answer: ${safe((e as Error).message ?? "")}`;
      return unconfirmed(db, row, mandate.mandateId, prepared.reference, reason, now);
    }
    if (answer.outcome === "NOT_SUBMITTED") {
      finishStep(db, row.action_id, "airi.checkout_pay", { outcome: "NOT_SUBMITTED", code: safe(answer.code) }, now);
      await cancelQuietly(deps, db, row, mandate.mandateId, `the checkout did not take the card (${answer.code})`, now);
      return refuse(db, row, "checkout", answer.code, answer.reason, now, mandate.mandateId);
    }
    finishStep(db, row.action_id, "airi.checkout_pay", { outcome: answer.outcome, ...(answer.code ? { code: safe(answer.code) } : {}) }, now);
    return finish(db, deps, row, mandate.mandateId, prepared.reference, answer, now);
  } finally {
    // The credential lives only for this checkout.
    rmSync(dir, { recursive: true, force: true });
  }
}

const short = (h: string) => `${h.slice(0, 8)}…`;

type ReadBack =
  | { ok: true; termsSha256: string; status: string }
  | { ok: false; code: "PURSER_MANDATE_HASH_MISMATCH" | "PURSER_MANDATE_NOT_READ_BACK"; why: string; found?: { actionId: string; termsSha256: string } };

/**
 * Reads the mandate back from Airi and holds its description to this action's id and the approved terms hash (the
 * row's order_sha256, which recheck() has just held to the approval). Airi stores the description; it does not check
 * it. A mandate Airi does not list yet is asked for again, READ_BACK_TRIES times in all; a mandate that cannot be read
 * back at all counts as not matching: nothing is assumed.
 */
async function readBack(deps: AiriDeps, row: Row, mandateId: string): Promise<ReadBack> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const since = new Date(Date.parse(row.created_at) - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  let stored: AiriMandateRecord | null;
  for (let tries = 1; ; tries++) {
    try {
      stored = await deps.airi.readMandate(mandateId, since);
    } catch (e) {
      return { ok: false, code: "PURSER_MANDATE_NOT_READ_BACK", why: `the mandate could not be read back from Airi (${safe(e instanceof AiriRefusal ? `${e.code}: ${e.message}` : (e as Error).message ?? "")})` };
    }
    if (stored || tries >= READ_BACK_TRIES) break;
    await sleep(READ_BACK_WAIT_MS);
  }
  if (!stored) return { ok: false, code: "PURSER_MANDATE_NOT_READ_BACK", why: `Airi did not list the mandate in ${READ_BACK_TRIES} tries` };
  if (stored.description === null) return { ok: false, code: "PURSER_MANDATE_NOT_READ_BACK", why: "Airi listed the mandate with no description, so its terms hash could not be read back" };
  const found = mandateTag(stored.description);
  if (found && found.actionId === row.action_id && found.termsSha256 === row.order_sha256) return { ok: true, termsSha256: found.termsSha256, status: stored.status };
  const why = !found ? `Airi's stored mandate does not carry this purchase's id and terms hash (its description has ${stored.description.length} characters)`
    : found.actionId !== row.action_id ? `Airi's stored mandate carries the id ${safe(found.actionId)}, not ${row.action_id}`
    : `Airi's stored mandate carries terms ${short(found.termsSha256)}, not the approved ${short(row.order_sha256)}`;
  return { ok: false, code: "PURSER_MANDATE_HASH_MISMATCH", why, ...(found ? { found } : {}) };
}

function unconfirmed(db: DB, row: Row, mandateId: string, reference: string, reason: string, now: Date): AiriOutcome {
  audit(db, "system", "airi.checkout_unconfirmed", row.proposal_id ?? row.action_id, { action_id: row.action_id, order_sha256: row.order_sha256, mandate_id: mandateId, reference: safe(reference), reason: safe(reason) }, now);
  close(db, row, { status: "UNCONFIRMED" }, now);
  return { status: "unconfirmed", actionId: row.action_id, orderSha256: row.order_sha256, mandateId, reference, reason: safe(reason), ...(row.proposal_id ? { proposalId: row.proposal_id } : {}) };
}

/** The checkout answered: report it to Airi (always, after a submitted checkout), then settle or release. */
async function finish(db: DB, deps: AiriDeps, row: Row, mandateId: string, reference: string, answer: Extract<CheckoutAnswer, { outcome: "SUCCEEDED" | "DECLINED" }>, now: Date): Promise<AiriOutcome> {
  const subject = row.proposal_id ?? row.action_id;
  audit(db, "system", "airi.checkout_result", subject, { action_id: row.action_id, order_sha256: row.order_sha256, mandate_id: mandateId, outcome: answer.outcome, reference: safe(reference), ...(answer.code ? { code: safe(answer.code) } : {}), checkout: deps.checkout.kind, amount: fromCents(row.cents) }, now);
  if (!stepDone(db, row.action_id, "airi.result")) {
    startStep(db, row.action_id, 4, "airi.result", mandateId, now);
    try {
      await deps.airi.reportResult(mandateId, answer.outcome, answer.outcome === "DECLINED" ? answer.code : undefined);
      finishStep(db, row.action_id, "airi.result", { result: answer.outcome }, now);
      audit(db, "system", "airi.result_reported", subject, { action_id: row.action_id, mandate_id: mandateId, result: answer.outcome }, now);
    } catch (e) {
      // The payment's outcome stands; the report is tried again by the recovery.
      audit(db, "system", "airi.result_report_failed", subject, { action_id: row.action_id, mandate_id: mandateId, error: safe((e as Error).message) }, now);
    }
  }
  if (answer.outcome === "SUCCEEDED") {
    close(db, row, { status: "SETTLED", outcome: "SUCCEEDED", ...(answer.code ? { code: safe(answer.code) } : {}) }, now);
    return { status: "succeeded", actionId: row.action_id, orderSha256: row.order_sha256, mandateId, reference, ...(answer.code ? { code: safe(answer.code) } : {}), label: deps.airi.label, ...(row.proposal_id ? { proposalId: row.proposal_id } : {}) };
  }
  const code = answer.code ?? "DECLINED";
  close(db, row, { status: "RELEASED", outcome: "DECLINED", code: safe(code) }, now);
  return { status: "refused", by: "checkout", code: safe(code), reason: `the checkout declined (${safe(code)}); DECLINED reported to Airi`, actionId: row.action_id, mandateId, ...(row.proposal_id ? { proposalId: row.proposal_id } : {}) };
}

/**
 * After a restart (or for a person, `npm run airi:vic-1 -- recover`): every Airi purchase not yet SETTLED or RELEASED.
 * A started payment is looked up at the checkout; if the answer is final it is reported to Airi and settled or
 * released; if not, it stays UNCONFIRMED and keeps counting. Anything stopped before the payment is cancelled at Airi
 * (the link to tap is gone with the process) and released. Leftover credential directories are removed.
 */
export async function recoverAiriPurchases(db: DB, deps: AiriDeps, now = new Date()): Promise<{ actionId: string; status: string }[]> {
  const root = deps.tmpRoot ?? tmpdir();
  for (const d of readdirSync(root)) if (d.startsWith(TMP_PREFIX)) rmSync(join(root, d), { recursive: true, force: true });
  const open = (db.prepare("SELECT action_id FROM airi_purchases WHERE status IN ('HELD', 'WAITING_FOR_TAP', 'PAYING', 'UNCONFIRMED') ORDER BY created_at").all() as { action_id: string }[]).map((r) => r.action_id);
  const out: { actionId: string; status: string }[] = [];
  for (const id of open) {
    await recoverOne(db, deps, id, now);
    out.push({ actionId: id, status: rowOf(db, id)!.status });
  }
  return out;
}

async function recoverOne(db: DB, deps: AiriDeps, actionId: string, now: Date): Promise<AiriOutcome | null> {
  const row = rowOf(db, actionId);
  if (!row || ["SETTLED", "RELEASED"].includes(row.status)) return null;
  const run = () => recoverSteps(db, deps, row, now);
  // Under the origin it ran with: the approval for a proposal, code's rule for a purchase that ran alone.
  if (row.proposal_id) {
    const a = db.prepare("SELECT approval_id, approver, method FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(row.proposal_id) as { approval_id: number; approver: string; method: string } | undefined;
    return a ? withOrigin({ actor: "cfo", proposal_id: row.proposal_id, approval_id: String(a.approval_id), method: a.method, approver: a.approver }, run) : run();
  }
  return withOrigin({ actor: "code", rule: AIRI_ALONE_RULE, agent: row.agent }, run);
}

async function recoverSteps(db: DB, deps: AiriDeps, row: Row, now: Date): Promise<AiriOutcome> {
  const paid = stepDone<{ outcome: string; code?: string }>(db, row.action_id, "airi.checkout_pay");
  const payStarted = !!db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = 'airi.checkout_pay'").get(row.action_id);
  if (payStarted && row.checkout_ref && row.mandate_id && (!paid || paid.outcome === "SUCCEEDED" || paid.outcome === "DECLINED")) {
    const answer: CheckoutAnswer | null = paid && (paid.outcome === "SUCCEEDED" || paid.outcome === "DECLINED")
      ? { outcome: paid.outcome, reference: row.checkout_ref, ...(paid.code ? { code: paid.code } : {}) }
      : await deps.checkout.lookup(row.checkout_ref);
    if (answer && answer.outcome !== "NOT_SUBMITTED") {
      if (!paid) finishStep(db, row.action_id, "airi.checkout_pay", { outcome: answer.outcome, ...(answer.code ? { code: safe(answer.code) } : {}), looked_up: true }, now);
      return finish(db, deps, row, row.mandate_id, row.checkout_ref, answer, now);
    }
    if (!answer) {
      if (row.status !== "UNCONFIRMED") return unconfirmed(db, row, row.mandate_id, row.checkout_ref, "after a restart the checkout could not tell the payment's outcome", now);
      return { status: "unconfirmed", actionId: row.action_id, orderSha256: row.order_sha256, mandateId: row.mandate_id, reference: row.checkout_ref, reason: "still not known" };
    }
  }
  // Stopped before the payment: the mandate (if any) is cancelled, the hold released. Nothing reached a card network.
  let mandateId = row.mandate_id;
  if (!mandateId && db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = 'airi.mandate'").get(row.action_id)) {
    const terms = JSON.parse(row.terms_json) as AiriTerms;
    const found = await deps.airi.findMandate(mandateDescription(terms, row.action_id), new Date(Date.parse(row.created_at) - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")).catch(() => null);
    mandateId = found?.mandateId ?? null;
  }
  if (mandateId) await cancelQuietly(deps, db, row, mandateId, "a restart before the checkout", now);
  return refuse(db, row, "purser", "PURSER_RESTARTED_BEFORE_CHECKOUT", "Purser restarted before the checkout; the mandate was cancelled and nothing was charged", now, mandateId ?? undefined);
}

/** The rail's rows for a run record and the dashboard: safe fields only. */
export function airiPurchases(db: DB): Json[] {
  return db.prepare("SELECT action_id, agent, route, proposal_id, order_sha256, cents, day, status, mandate_id, checkout_ref, outcome, code, created_at, updated_at FROM airi_purchases ORDER BY created_at, action_id").all() as Json[];
}
