// The ICC rail's flow (docs/visa-icc.md, sections 4 to 7): an agent's purchase for which a single-use payment
// credential is requested through Intelligent Commerce Connect, within the terms the CFO signed. Built from the public
// documentation only; nothing here has been sent to the service. On only with KIT11_ICC_RAIL=on (src/icc/policy.ts).
//
//   1. Purser's checks first, calling nothing outside: emergency stop, pause, velocity stop, the agent's identity,
//      amount, items adding up, the API's field limits, currency, merchant, hard cap. A refusal returns Purser's code
//      and is audited. Every purchase that passes becomes a proposal: its terms (agent, amount, currency, merchant,
//      items, the card's token, the expiry) are what the CFO signs with Face ID. Nothing runs alone on this rail.
//   2. The run starts from the approved proposal, with the repository's own approval check (src/policy/approvals.ts):
//      the stored terms hash to the approved hash, the approval is unused and in time. The instruction is built from
//      those terms and nothing else (src/icc/instruction.ts), and Purser's record of it is stored before it is sent.
//   3. The approved hash is checked again, then the instruction is created (one POST).
//   4. The instruction check, before any credential is requested: Purser's record of the instruction it sent, and the
//      create answer, are compared with the signed terms; any difference, an expired instruction or an amount above
//      the cap refuses the purchase. (The documented API has no call that reads an instruction back.)
//   5. The credential is requested (one POST). Only its documented envelope is looked at; then it is dropped. The flow
//      stops here, before any checkout: the audit row says "credential received, not used", and nothing is recorded
//      as paid or booked. No confirmation is sent for a credential that was not used.
//   6. Nothing is sent twice. Before each POST or PUT the intent is written (the action's status and a step in
//      money_steps). A call whose answer did not come, or could not be read, leaves the action UNCONFIRMED; a second
//      run of the same action sends nothing and reports that. There is no retry.
//   7. Audit rows carry safe references only (the terms hash, the instruction ID, codes) and the origin in force: the
//      CFO's approval. Never the credential, the device or assurance data, a key, or an answer's text.
//
// Device and assurance data come from the cardholder's passkey step, through the owner's private file. They are read
// at the moment of use, passed through unchanged, and never stored.

import { randomUUID } from "node:crypto";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit } from "../audit/log.js";
import type { Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../lib/terms.js";
import { beginExecution, closeAsStale, createProposal, finishExecution, nextProposalId } from "../policy/approvals.js";
import { authorize } from "../policy/principals.js";
import { frozen, paused } from "../policy/rules.js";
import { finishStep, startStep } from "../policy/saga.js";
import { stopped } from "../policy/velocity.js";
import { currentOrigin, withOrigin, type Origin } from "../provenance/origin.js";
import { IccCryptoError } from "./auth.js";
import { IccBudgetSpent } from "./callBudget.js";
import { IccApiError, IccNoAnswer, IccNotAllowed, type IccClient } from "./client.js";
import {
  ICC_PURCHASE_KIND, IccFieldRefusal, buildCredentialsRequest, buildInstruction, checkInstruction, instructionRequestBody, purchaseFromTerms, recordOf,
  type IccCheckCode, type IccPassthrough, type IccTerms,
} from "./instruction.js";
import { ICC_CURRENCIES, ICC_HARD_CAP_CENTS, iccMerchantOf, iccRailOn } from "./policy.js";

export { ICC_PURCHASE_KIND };
/** What the flow's last audit row says. The flow stops before checkout: nothing is paid. */
export const ICC_NOT_USED = "credential received, not used";
const TTL_MS = 30 * 60 * 1000;

export interface IccPurchaseRequest {
  agent: Agent;
  /** The instrument identifier token of the enrolled test card. Never a card number. */
  paymentMethodId: string;
  merchantName: string;
  merchantUrl: string;
  merchantCountry: string;
  amount: string;
  currency: string;
  items: { name: string; unitPrice: string; quantity: string }[];
  description: string;
}

export type IccDecision = { route: "cfo" } | { route: "refused"; code: string; reason: string };

export interface IccEnvelope {
  authorization: boolean;
  signedPayload: boolean;
  signedPayloadForm: "three parts" | "other" | "absent";
}

export type IccOutcome =
  | { status: "refused"; by: "purser" | "icc"; code: string; reason: string; proposalId?: string; actionId?: string; instructionId?: string }
  | { status: "pending_approval"; proposalId: string; termsSha256: string }
  /** The credential came in its documented envelope and was dropped. Nothing was paid. */
  | { status: "credential_received_not_used"; note: typeof ICC_NOT_USED; actionId: string; proposalId: string; termsSha256: string; instructionId: string; envelope: IccEnvelope }
  /** A call's outcome is not known. Nothing is sent again. */
  | { status: "unconfirmed"; step: "instruction" | "credential"; actionId: string; proposalId: string; reason: string; instructionId?: string };

export interface IccDeps {
  client: Pick<IccClient, "createInstruction" | "requestCredentials" | "cancel">;
  /** Device and assurance data, read at the moment of use (src/icc/config.ts readAssuranceFile). Never stored. */
  passthrough: () => IccPassthrough;
  /** A new cardholder verification, if one is at hand: only with it is a refused instruction cancelled. */
  freshAssurance?: () => IccPassthrough | null;
  /** The operator console: what is happening, no secrets. */
  say?: (line: string) => void;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

const AMOUNT = /^(0|[1-9]\d{0,8})\.\d{2}$/;
const cents = (s: string): number | null => (AMOUNT.test(s) ? toCents(s) : null);
/** A text as it may be stored: secrets redacted, no link, no long digit run, one line, bounded. */
const safe = (s: string): string => redactSecrets(s).replace(/https?:\/\/\S+/gi, "[link]").replace(/\b(?:\d[ -]?){12,19}\b/g, "[digits]").replace(/\p{Cc}+/gu, " ").slice(0, 300);

export function iccTerms(req: IccPurchaseRequest, proposalId: string, expiresAt: string): IccTerms {
  return {
    schema: TERMS_SCHEMA, kind: ICC_PURCHASE_KIND, proposal_id: proposalId, expires_at: expiresAt,
    agent: req.agent, amount: req.amount, currency: req.currency,
    merchant: { name: req.merchantName, url: req.merchantUrl, country: req.merchantCountry },
    items: req.items.map((i) => ({ name: i.name, unit_price: i.unitPrice, quantity: i.quantity })),
    description: req.description, payment_method_id: req.paymentMethodId,
  };
}

function requestFromTerms(t: IccTerms): IccPurchaseRequest {
  return {
    agent: t.agent as Agent, paymentMethodId: t.payment_method_id, merchantName: t.merchant.name, merchantUrl: t.merchant.url,
    merchantCountry: t.merchant.country, amount: t.amount, currency: t.currency, description: t.description,
    items: t.items.map((i) => ({ name: i.name, unitPrice: i.unit_price, quantity: i.quantity })),
  };
}

/** Pure: whether this request may go to the CFO at all. There is no route without the CFO on this rail. */
export function decideIccPurchase(req: IccPurchaseRequest): IccDecision {
  const refuse = (code: string, reason: string): IccDecision => ({ route: "refused", code, reason });
  const total = cents(req.amount);
  if (total === null || total === 0) return refuse("PURSER_AMOUNT_INVALID", `the amount ${JSON.stringify(String(req.amount).slice(0, 20))} is not a positive two-decimal amount`);
  let sum = 0;
  for (const i of req.items) {
    const each = cents(i.unitPrice);
    if (each === null || !/^[1-9]\d{0,3}$/.test(i.quantity)) return refuse("PURSER_AMOUNT_INVALID", "an item has no valid price or quantity");
    sum += each * Number(i.quantity);
  }
  if (req.items.length === 0 || sum !== total) return refuse("PURSER_ITEMS_TOTAL_MISMATCH", `the items add up to ${fromCents(sum)}, the total is ${req.amount}`);
  // The API's documented limits, on the instruction and the credential request these terms would build.
  try {
    const terms = iccTerms(req, "P-0000", "2000-01-01T00:00:00Z");
    const ids = { actionId: "P-0000", correlationId: "00000000-0000-4000-8000-000000000000" };
    buildInstruction(terms, "0".repeat(64), ids);
    buildCredentialsRequest(terms, "0".repeat(64), ids, purchaseFromTerms(terms, ids.actionId));
  } catch (e) {
    if (e instanceof IccFieldRefusal) return refuse(e.code, e.message);
    throw e;
  }
  if (!ICC_CURRENCIES.includes(req.currency)) return refuse("PURSER_CURRENCY_NOT_ALLOWED", `${req.currency} is not a currency this rail takes`);
  if (!iccMerchantOf({ name: req.merchantName, url: req.merchantUrl, country: req.merchantCountry })) return refuse("PURSER_MERCHANT_NOT_ALLOWED", "the merchant (name, URL and country) is not in this rail's registry");
  if (total > ICC_HARD_CAP_CENTS) return refuse("PURSER_ABOVE_HARD_CAP", `${req.amount} ${req.currency} is above the hard cap of ${fromCents(ICC_HARD_CAP_CENTS)}; not even Face ID can approve it`);
  return { route: "cfo" };
}

/** Refusals by the agent's state and identity, before any amount is looked at. */
function stateRefusal(db: DB, agent: Agent, currency: string, now: Date): IccDecision | null {
  if (frozen(db)) return { route: "refused", code: "PURSER_EMERGENCY_STOP", reason: "the emergency stop is on" };
  if (paused(db, agent)) return { route: "refused", code: "PURSER_AGENT_PAUSED", reason: `the ${agent} agent is paused by the CFO` };
  if (stopped(db, agent)) return { route: "refused", code: "PURSER_AGENT_STOPPED", reason: `the ${agent} agent was stopped (velocity limit)` };
  const denied = authorize(db, agent, { rail: "card", currency, payee: "merchants" }, now);
  if (denied) return { route: "refused", code: "PURSER_IDENTITY_DENIED", reason: denied };
  return null;
}

// ---- the action's state ------------------------------------------------------------------------------------------------

// One row per purchase, made when the flow first runs (the table does not exist while the rail is off). The status is
// the durable intent: INSTRUCTION_SENT and CREDENTIAL_SENT are written before the call they name, so a row found in
// either state after a restart means a call may have gone out, and nothing is sent again. `instruction_json` is
// Purser's record of the instruction it sent (the fields that come from the terms; no device or assurance data),
// stored with its SHA-256 before sending. `answer_json` holds the create answer's status fields. Safe references only.
const TABLE = `CREATE TABLE IF NOT EXISTS icc_purchases (
  action_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE,
  agent TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'INSTRUCTION_SENT', 'INSTRUCTION_CREATED', 'CREDENTIAL_SENT', 'CREDENTIAL_RECEIVED_NOT_USED', 'REFUSED', 'UNCONFIRMED')),
  correlation_id TEXT NOT NULL,
  instruction_json TEXT NOT NULL,
  instruction_sha256 TEXT NOT NULL,
  instruction_id TEXT,
  answer_json TEXT,
  code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

type Status = "STARTED" | "INSTRUCTION_SENT" | "INSTRUCTION_CREATED" | "CREDENTIAL_SENT" | "CREDENTIAL_RECEIVED_NOT_USED" | "REFUSED" | "UNCONFIRMED";
interface Row {
  action_id: string; proposal_id: string; agent: string; terms_sha256: string; terms_json: string; cents: number; currency: string; status: Status;
  correlation_id: string; instruction_json: string; instruction_sha256: string; instruction_id: string | null; answer_json: string | null; code: string | null;
  created_at: string; updated_at: string;
}
interface StoredAnswer { http_status: number; status: string | null; pending_events: string[]; correlation_matches: boolean; encrypted: boolean }

const hasTable = (db: DB): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'icc_purchases'").get();
const rowOf = (db: DB, actionId: string) => db.prepare("SELECT * FROM icc_purchases WHERE action_id = ?").get(actionId) as Row | undefined;
function setRow(db: DB, actionId: string, fields: Partial<Record<"status" | "instruction_id" | "answer_json" | "code", string | null>>, now: Date): void {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE icc_purchases SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE action_id = ?`).run(...keys.map((k) => fields[k as keyof typeof fields] ?? null), now.toISOString(), actionId);
}

/** An audit row of this rail: its payload plus the origin in force (the CFO's approval during a run). */
function note(db: DB, event: string, subject: string | null, payload: Record<string, Json>, now: Date, actor: "system" | Agent = "system"): void {
  audit(db, actor, event, subject, { ...payload, origin: (currentOrigin() as Json | null) ?? null }, now);
}

// ---- the request ---------------------------------------------------------------------------------------------------------

/**
 * An agent asks to buy on this rail. Refused: audited, nothing outside is called. Otherwise a proposal whose exact
 * terms the CFO signs with Face ID; nothing outside is called here either.
 */
export async function requestIccPurchase(db: DB, req: IccPurchaseRequest, now = new Date(), env: IccDeps["env"] = process.env): Promise<IccOutcome> {
  if (!iccRailOn(env)) return { status: "refused", by: "purser", code: "PURSER_ICC_RAIL_OFF", reason: "the ICC rail is off (KIT11_ICC_RAIL); nothing was filed" };
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const decide = (d: DB): IccDecision => stateRefusal(d, req.agent, req.currency, now) ?? decideIccPurchase(req);
  const decided = decide(db);
  note(db, "icc.purchase_requested", null, { agent: req.agent, amount: safe(String(req.amount)), currency: safe(String(req.currency)), merchant: safe(String(req.merchantName)), route: decided.route }, now, req.agent);
  if (decided.route === "refused") {
    note(db, "icc.purchase_refused", null, { agent: req.agent, by: "purser", code: decided.code, reason: safe(decided.reason) }, now);
    return { status: "refused", by: "purser", code: decided.code, reason: safe(decided.reason) };
  }
  try {
    const p = createProposal(db, {
      terms: iccTerms(req, nextProposalId(db), expiresAt), createdBy: req.agent, assignId: true,
      explanation: "A purchase for which a payment credential is requested through Intelligent Commerce Connect: the CFO's Face ID over agent, amount, currency, merchant, items and expiry. The flow stops before checkout; nothing is paid.",
      // Checked again inside the proposal's own write lock.
      guard: (g) => { const again = decide(g); return again.route === "refused" ? `${again.code}: ${again.reason}` : null; },
    }, now);
    return { status: "pending_approval", proposalId: p.proposal_id, termsSha256: p.terms_sha256 };
  } catch (e) {
    const reason = safe((e as Error).message);
    note(db, "icc.purchase_refused", null, { agent: req.agent, by: "purser", code: "PURSER_POLICY_CHANGED", reason }, now);
    return { status: "refused", by: "purser", code: "PURSER_POLICY_CHANGED", reason };
  }
}

// ---- the run -------------------------------------------------------------------------------------------------------------

/** What an error from the client means for the action: sent with an unknown outcome, refused by the service, or never sent. */
function classify(e: unknown): { kind: "unknown" | "icc" | "not_sent"; code: string; reason: string } {
  if (e instanceof IccNoAnswer) return { kind: "unknown", code: "ICC_NO_ANSWER", reason: e.message };
  if (e instanceof IccApiError) return { kind: "icc", code: `ICC_HTTP_${e.httpStatus}${e.reason ? `_${e.reason}` : ""}`, reason: e.message };
  if (e instanceof IccBudgetSpent) return { kind: "not_sent", code: "PURSER_ICC_BUDGET_SPENT", reason: e.message };
  if (e instanceof IccNotAllowed) return { kind: "not_sent", code: "PURSER_ICC_NOT_ALLOWED", reason: e.message };
  if (e instanceof IccCryptoError) return { kind: "not_sent", code: "PURSER_ICC_KEYS", reason: e.message };
  if (e instanceof IccFieldRefusal) return { kind: "not_sent", code: e.code, reason: e.message };
  // Anything else after the intent was written: whether the call went out is not known. Its text is not repeated.
  return { kind: "unknown", code: "ICC_NO_ANSWER", reason: `an unexpected ${e instanceof Error ? e.name : "error"} after the call was started; the outcome is unknown` };
}

/**
 * Runs an approved icc_purchase proposal (the runner, src/executors/index.ts, or the conductor). The executor's own
 * checks come first; the approval does not skip them. A second run of the same proposal sends nothing.
 * `clock` is read again at the instruction check, after the create call.
 */
export async function executeIccPurchase(db: DB, deps: IccDeps, proposalId: string, clock: () => Date = () => new Date()): Promise<IccOutcome> {
  const now = clock();
  if (!iccRailOn(deps.env ?? process.env)) return { status: "refused", by: "purser", code: "PURSER_ICC_RAIL_OFF", reason: "the ICC rail is off (KIT11_ICC_RAIL); nothing was run", proposalId };
  const p = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string } | undefined;
  if (!p || p.kind !== ICC_PURCHASE_KIND) return { status: "refused", by: "purser", code: "PURSER_NOT_AN_ICC_PURCHASE", reason: `${proposalId} is not an ICC purchase`, proposalId };
  db.exec(TABLE);
  const origin = currentOrigin() ?? approvalOrigin(db, proposalId);
  const go = () => runOnce(db, deps, proposalId, p.terms_json, clock, now);
  return origin ? withOrigin(origin, go) : go();
}

/** The approval as the origin of what an approved run does, when the caller set none (the runner sets it itself). */
function approvalOrigin(db: DB, proposalId: string): Origin | null {
  const a = db.prepare("SELECT approval_id, approver, method FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(proposalId) as { approval_id: number; approver: string; method: string } | undefined;
  return a ? { actor: "cfo", proposal_id: proposalId, approval_id: String(a.approval_id), method: a.method, approver: a.approver } : null;
}

async function runOnce(db: DB, deps: IccDeps, proposalId: string, storedTerms: string, clock: () => Date, now: Date): Promise<IccOutcome> {
  const existing = db.prepare("SELECT action_id FROM icc_purchases WHERE proposal_id = ?").get(proposalId) as { action_id: string } | undefined;
  if (existing) return rerun(db, rowOf(db, existing.action_id)!, now);

  // The policy may have tightened since the CFO signed: checked again now; a refusal closes the proposal.
  const stored = JSON.parse(storedTerms) as IccTerms;
  const again = stateRefusal(db, stored.agent as Agent, stored.currency, now) ?? decideIccPurchase(requestFromTerms(stored));
  if (again.route === "refused") {
    note(db, "icc.purchase_refused", proposalId, { agent: safe(String(stored.agent)), by: "purser", code: again.code, reason: safe(again.reason) }, now);
    closeAsStale(db, proposalId, { error: `${again.code}: ${again.reason}` }, {}, now);
    return { status: "refused", by: "purser", code: again.code, reason: safe(again.reason), proposalId };
  }
  // The stored terms hash to the approved hash, the approval is unused and in time (src/policy/approvals.ts).
  const terms = beginExecution<IccTerms>(db, proposalId, (t) => {
    if (t.kind !== ICC_PURCHASE_KIND) throw new Error(`${proposalId} is not an ICC purchase`);
  }, now);
  const sha = termsHash(terms);
  const actionId = proposalId;
  const correlationId = randomUUID();
  // Purser's record of the instruction, stored before anything is sent.
  const record = buildInstruction(terms, sha, { actionId, correlationId });
  const recorded = recordOf(record);
  db.prepare(`INSERT INTO icc_purchases (action_id, proposal_id, agent, terms_sha256, terms_json, cents, currency, status, correlation_id, instruction_json, instruction_sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'STARTED', ?, ?, ?, ?, ?)`).run(actionId, proposalId, terms.agent, sha, JSON.stringify(terms), toCents(terms.amount), terms.currency, correlationId, recorded.json, recorded.sha256, now.toISOString(), now.toISOString());
  const ids = { action_id: actionId, terms_sha256: sha };
  const say = deps.say ?? (() => {});
  note(db, "icc.purchase_started", proposalId, { ...ids, agent: terms.agent, amount: terms.amount, currency: terms.currency, merchant: safe(terms.merchant.name), expires_at: terms.expires_at, instruction_sha256: recorded.sha256 }, now);

  const stillApproved = (): boolean => {
    const q = db.prepare("SELECT status, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string; terms_json: string; terms_sha256: string };
    const a = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as { approved_sha256: string; decision: string } | undefined;
    const r = rowOf(db, actionId);
    const hashOf = (json: string): string | null => { try { return termsHash(JSON.parse(json) as Terms); } catch { return null; } };
    return q.status === "EXECUTING" && a?.decision === "APPROVED" && hashOf(q.terms_json) === sha && q.terms_sha256 === sha && a.approved_sha256 === sha
      && !!r && r.terms_sha256 === sha && hashOf(r.terms_json) === sha;
  };
  const end = (status: "REFUSED" | "UNCONFIRMED" | "CREDENTIAL_RECEIVED_NOT_USED", code: string | null, detail: Record<string, Json>, at: Date): void => {
    setRow(db, actionId, { status, code }, at);
    finishExecution(db, proposalId, status === "CREDENTIAL_RECEIVED_NOT_USED" ? "EXECUTED" : "FAILED", { action_id: actionId, ...detail }, at);
  };
  const refuse = (by: "purser" | "icc", code: string, reason: string, extra: Record<string, Json> = {}, at = clock()): IccOutcome => {
    const instructionId = rowOf(db, actionId)?.instruction_id ?? null;
    note(db, "icc.purchase_refused", proposalId, { ...ids, agent: terms.agent, by, code: safe(code), reason: safe(reason), ...(instructionId ? { instruction_id: instructionId } : {}), ...extra }, at);
    end("REFUSED", safe(code), { code: safe(code) }, at);
    say(`ICC REFUSED  ${actionId}: ${safe(code)} (by ${by === "purser" ? "Purser" : "the service"}); no credential was used`);
    return { status: "refused", by, code: safe(code), reason: safe(reason), proposalId, actionId, ...(instructionId ? { instructionId } : {}) };
  };
  const unconfirmed = (step: "instruction" | "credential", reason: string, at = clock()): IccOutcome => {
    const instructionId = rowOf(db, actionId)?.instruction_id ?? null;
    note(db, `icc.${step}_unconfirmed`, proposalId, { ...ids, reason: safe(reason), ...(instructionId ? { instruction_id: instructionId } : {}), sent_again: false }, at);
    end("UNCONFIRMED", `ICC_NO_ANSWER_${step.toUpperCase()}`, { unconfirmed: true, step }, at);
    say(`ICC UNCONFIRMED  ${actionId}: the ${step} call has no usable answer; nothing is sent again`);
    return { status: "unconfirmed", step, actionId, proposalId, reason: safe(reason), ...(instructionId ? { instructionId } : {}) };
  };

  // 3. The approved hash again, then the device and assurance data, then the instruction.
  if (!stillApproved()) return refuse("purser", "PURSER_HASH_MISMATCH", "the terms no longer hash to what was approved; nothing was sent", {}, now);
  let passthrough: IccPassthrough;
  try {
    passthrough = deps.passthrough();
  } catch (e) {
    return refuse("purser", "PURSER_ICC_ASSURANCE_UNAVAILABLE", `the device and assurance data could not be read (${e instanceof Error ? e.name : "error"}); nothing was sent`, {}, now);
  }
  setRow(db, actionId, { status: "INSTRUCTION_SENT" }, now);
  startStep(db, actionId, 1, "icc.instruction", actionId, now);
  let created;
  try {
    created = await deps.client.createInstruction(instructionRequestBody(record, passthrough));
  } catch (e) {
    const c = classify(e);
    if (c.kind === "unknown") return unconfirmed("instruction", c.reason);
    finishStep(db, actionId, "icc.instruction", { sent: c.kind === "icc", code: safe(c.code) }, clock());
    return refuse(c.kind === "icc" ? "icc" : "purser", c.code, c.reason);
  }
  const afterCreate = clock();
  const instructionId = created.instructionId !== null && /^[A-Za-z0-9-]{1,50}$/.test(created.instructionId) ? created.instructionId : null;
  const answer: StoredAnswer = { http_status: created.httpStatus, status: created.status, pending_events: created.pendingEvents, correlation_matches: created.clientCorrelationId === correlationId, encrypted: created.encrypted };
  finishStep(db, actionId, "icc.instruction", { http_status: created.httpStatus, instruction_id: instructionId, status: created.status }, afterCreate);
  setRow(db, actionId, { status: "INSTRUCTION_CREATED", instruction_id: instructionId, answer_json: JSON.stringify(answer) }, afterCreate);
  note(db, "icc.instruction_created", proposalId, { ...ids, instruction_id: instructionId, http_status: created.httpStatus, status: created.status, pending_events: created.pendingEvents, answer_encrypted: created.encrypted, cap: terms.amount, currency: terms.currency, merchant: safe(terms.merchant.name), expires_at: terms.expires_at, instruction_sha256: recorded.sha256 }, afterCreate);
  say(`ICC INSTRUCTION  ${actionId}: created for at most ${terms.amount} ${terms.currency} at ${safe(terms.merchant.name)}, until ${terms.expires_at}`);

  /** After a refusal, an instruction that exists is cancelled only with a new cardholder verification; else it runs out. */
  const leave = async (out: IccOutcome): Promise<IccOutcome> => {
    const r = rowOf(db, actionId)!;
    if (!r.instruction_id) return out;
    let fresh: IccPassthrough | null;
    try { fresh = deps.freshAssurance?.() ?? null; } catch { fresh = null; }
    if (!fresh) {
      note(db, "icc.instruction_left_to_expire", proposalId, { ...ids, instruction_id: r.instruction_id, expires_at: terms.expires_at, why: "no fresh assurance data for a cancel call; the instruction ends at the signed expiry" }, clock());
      return out;
    }
    startStep(db, actionId, 3, "icc.cancel", r.instruction_id, clock());
    try {
      const cancelled = await deps.client.cancel(r.instruction_id, { clientCorrelationId: r.correlation_id, paymentInformation: record.paymentInformation, deviceInformation: { ...fresh.deviceInformation, applicationName: record.deviceInformation.applicationName }, assuranceData: fresh.assuranceData });
      finishStep(db, actionId, "icc.cancel", { http_status: cancelled.httpStatus, status: cancelled.status }, clock());
      note(db, "icc.instruction_cancelled", proposalId, { ...ids, instruction_id: r.instruction_id, http_status: cancelled.httpStatus, status: cancelled.status }, clock());
    } catch (e) {
      const c = classify(e);
      if (c.kind !== "unknown") finishStep(db, actionId, "icc.cancel", { sent: c.kind === "icc", code: safe(c.code) }, clock());
      note(db, c.kind === "unknown" ? "icc.instruction_cancel_unconfirmed" : "icc.instruction_cancel_failed", proposalId, { ...ids, instruction_id: r.instruction_id, code: safe(c.code), reason: safe(c.reason), sent_again: false }, clock());
    }
    return out;
  };

  // 4. The instruction check, on what is stored now: the terms, Purser's record of the instruction, the create answer.
  const checkedAt = clock();
  if (!stillApproved()) return leave(refuse("purser", "PURSER_HASH_MISMATCH", "the terms no longer hash to what was approved; no credential was requested", {}, checkedAt));
  const r = rowOf(db, actionId)!;
  const signedNow = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as IccTerms;
  const approvedSha = (db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(proposalId) as { approved_sha256: string }).approved_sha256;
  const storedAnswer = JSON.parse(r.answer_json ?? "{}") as Partial<StoredAnswer>;
  const purchase = purchaseFromTerms(JSON.parse(r.terms_json) as IccTerms, actionId);
  const check = checkInstruction({
    terms: signedNow, approvedSha256: approvedSha, actionId, recorded: { json: r.instruction_json, sha256: r.instruction_sha256 },
    answer: { httpStatus: storedAnswer.http_status ?? 0, clientCorrelationId: storedAnswer.correlation_matches ? r.correlation_id : null, instructionId: r.instruction_id, status: storedAnswer.status ?? null, pendingEvents: storedAnswer.pending_events ?? [] },
    purchase, now: checkedAt,
  });
  if (!check.ok) {
    const first = check.findings[0]!;
    return leave(refuse("purser", first.code satisfies IccCheckCode, `${first.reason}; no credential was requested`, { findings: check.findings.map((f) => ({ code: f.code, reason: safe(f.reason) })) }, checkedAt));
  }
  note(db, "icc.instruction_checked", proposalId, { ...ids, instruction_id: r.instruction_id, compared: "Purser's record of the instruction it sent, and the create answer, with the signed terms", result: "no difference", instruction_sha256: r.instruction_sha256 }, checkedAt);

  // 5. The credential: requested, its envelope looked at, dropped. The flow stops here, before any checkout.
  const instruction = r.instruction_id!;
  let request: Record<string, unknown>;
  try {
    request = buildCredentialsRequest(signedNow, approvedSha, { actionId, correlationId: r.correlation_id }, purchase);
  } catch (e) {
    const c = classify(e);
    return leave(refuse("purser", c.kind === "not_sent" ? c.code : "PURSER_ICC_FIELD_NOT_ALLOWED", c.reason, {}, checkedAt));
  }
  setRow(db, actionId, { status: "CREDENTIAL_SENT" }, checkedAt);
  startStep(db, actionId, 2, "icc.credential", instruction, checkedAt);
  let answered;
  try {
    answered = await deps.client.requestCredentials(instruction, request);
  } catch (e) {
    const c = classify(e);
    if (c.kind === "unknown") return unconfirmed("credential", c.reason);
    finishStep(db, actionId, "icc.credential", { sent: c.kind === "icc", code: safe(c.code) }, clock());
    return leave(refuse(c.kind === "icc" ? "icc" : "purser", c.code, c.reason));
  }
  const at = clock();
  if (answered.kind === "pending") {
    finishStep(db, actionId, "icc.credential", { http_status: answered.httpStatus, pending: true }, at);
    return leave(refuse("icc", "ICC_CREDENTIAL_PENDING", "the service answered that the credential is pending; none was received", { pending_events: answered.pendingEvents }, at));
  }
  let envelope: IccEnvelope;
  try {
    envelope = answered.credential.envelope();
  } finally {
    // Single-use and never kept: let go of it whatever happens next.
    answered.credential.drop();
  }
  const documented = envelope.signedPayload && answered.instructionId === instruction && answered.clientCorrelationId === r.correlation_id;
  finishStep(db, actionId, "icc.credential", { http_status: answered.httpStatus, envelope, documented_shape: documented }, at);
  if (!documented) return leave(refuse("purser", "PURSER_ICC_CREDENTIAL_SHAPE", "the credentials answer does not have the documented shape (a signed payload, this instruction, this correlation ID); it was dropped", { envelope: envelope as unknown as Json }, at));
  note(db, "icc.credential_received_not_used", proposalId, { ...ids, instruction_id: instruction, note: ICC_NOT_USED, paid: false, http_status: answered.httpStatus, status: answered.status, envelope: envelope as unknown as Json, answer_encrypted: answered.encrypted, amount: terms.amount, currency: terms.currency, merchant: safe(terms.merchant.name) }, at);
  end("CREDENTIAL_RECEIVED_NOT_USED", null, { outcome: ICC_NOT_USED, paid: false, instruction_id: instruction }, at);
  say(`ICC CREDENTIAL  ${actionId}: ${ICC_NOT_USED}; the flow stops before checkout and nothing is paid`);
  return { status: "credential_received_not_used", note: ICC_NOT_USED, actionId, proposalId, termsSha256: sha, instructionId: instruction, envelope };
}

/** A second run of an action that already began: nothing is sent, whatever state the first run left. */
function rerun(db: DB, row: Row, now: Date): IccOutcome {
  const base = { proposalId: row.proposal_id, actionId: row.action_id, ...(row.instruction_id ? { instructionId: row.instruction_id } : {}) };
  // An intent without a recorded answer (a crash), or an answer that never came: the call may have gone out.
  const open = row.status === "INSTRUCTION_SENT" || row.status === "CREDENTIAL_SENT" || row.status === "UNCONFIRMED";
  note(db, "icc.rerun_sent_nothing", row.proposal_id, { action_id: row.action_id, terms_sha256: row.terms_sha256, found: row.status, sent_again: false }, now);
  if (!open) return { status: "refused", by: "purser", code: "PURSER_ALREADY_RAN", reason: `${row.proposal_id} already ran once (${row.status}); a new purchase needs a new proposal`, ...base };
  const step = row.status === "INSTRUCTION_SENT" || row.code === "ICC_NO_ANSWER_INSTRUCTION" ? "instruction" : "credential";
  if (row.status !== "UNCONFIRMED") {
    setRow(db, row.action_id, { status: "UNCONFIRMED", code: `ICC_NO_ANSWER_${step.toUpperCase()}` }, now);
    const s = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(row.proposal_id) as { status: string }).status;
    if (s === "EXECUTING") finishExecution(db, row.proposal_id, "FAILED", { action_id: row.action_id, unconfirmed: true, step }, now);
  }
  return { status: "unconfirmed", step, reason: `the ${step} call of an earlier run has no recorded answer; nothing is sent again`, ...base };
}

/** The rail's rows for a run record: safe fields only. Empty while the rail never ran. */
export function iccPurchases(db: DB): Json[] {
  if (!hasTable(db)) return [];
  return db.prepare("SELECT action_id, proposal_id, agent, terms_sha256, cents, currency, status, instruction_id, instruction_sha256, code, created_at, updated_at FROM icc_purchases ORDER BY created_at, action_id").all() as Json[];
}
