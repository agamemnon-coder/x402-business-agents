// Proposal -> approval -> execution (build plan 2.3). A person approves the hash of the exact terms;
// the executor runs only if the stored terms still hash to what was approved, once.

import { approvalHashOf } from "../metal/ownersExecute.js";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit, type Actor } from "../audit/log.js";
import { auditChainRefusal } from "../audit/intact.js";
import { checkpointRefusal } from "../audit/checkpointer.js";
import { loosens } from "./loosens.js";
import type { DB } from "../db/open.js";
import { prefixMatches, rejectionSha256, termsHash, type Terms } from "../lib/terms.js";
import { fourEyes } from "./fourEyes.js";
import { proposerOf, sodChanges, sodThreshold } from "./policySod.js";
import { recordFactor, secondKeyReasons } from "./secondKey.js";
import { policyVersion } from "./versions.js";
import { currentOrigin } from "../provenance/origin.js";
import { hubGateRefusal } from "../hub/gate.js";
import { hubDecisionsEnabled } from "../hub/config.js";
import { BATCH_KIND, BATCHABLE, openBatchOf, verifyBatch } from "./batchLines.js";
import { aloneDecision } from "./withinLimit.js";
import { aloneLimitInForce, sourceWords } from "./aloneLimit.js";
import { ALONE_KINDS, approvalSignatureRefusal, POLICY_METHOD, WITHIN_LIMIT } from "./signedApproval.js";
import { blockedApprovals, recordBlocked } from "./blocked.js";

export type ProposalStatus =
  | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "SUPERSEDED"
  | "EXECUTING" | "EXECUTED" | "FAILED" | "NEEDS_REAPPROVAL";

// NEEDS_REAPPROVAL is terminal: the terms can no longer run, a new proposal is needed. Besides an execution that ends
// there, code closes a proposal there before it runs when its executor's guard shows the terms can never run (dry-179:
// "spent moved … a new one is needed"); that moves no money and runs nothing (closeAsStale).
const ALLOWED: Record<ProposalStatus, ProposalStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED", "NEEDS_REAPPROVAL"],
  APPROVED: ["EXECUTING", "EXPIRED", "NEEDS_REAPPROVAL"],
  EXECUTING: ["EXECUTED", "FAILED", "NEEDS_REAPPROVAL"],
  FAILED: ["EXECUTING", "EXPIRED", "NEEDS_REAPPROVAL"],
  REJECTED: [],
  EXPIRED: [],
  SUPERSEDED: [],
  EXECUTED: [],
  NEEDS_REAPPROVAL: [],
};

export interface ProposalRow {
  proposal_id: string;
  kind: string;
  terms_json: string;
  terms_sha256: string;
  created_by: string;
  status: ProposalStatus;
  expires_at: string;
}

function get(db: DB, id: string): ProposalRow {
  const row = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as ProposalRow | undefined;
  if (!row) throw new Error(`no proposal ${id}`);
  return row;
}

/** Moves a proposal from one status to another; refuses any transition the state machine does not list. */
function transition(db: DB, id: string, from: ProposalStatus, to: ProposalStatus): void {
  if (!ALLOWED[from].includes(to)) throw new Error(`illegal transition ${from} -> ${to} for ${id}`);
  const r = db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ? AND status = ?").run(to, id, from);
  if (r.changes !== 1) throw new Error(`${id} is no longer ${from}`);
}

export function nextProposalId(db: DB): string {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;
  return `P-${String(n + 1).padStart(4, "0")}`;
}

/** A proposal the caller's guard refused inside createProposal's transaction; nothing was written. */
export class ProposalRefused extends Error {
  constructor(readonly reason: string) { super(`proposal refused: ${reason}`); this.name = "ProposalRefused"; }
}

/**
 * Files a proposal. proposal.created records the origin in force (D24; review, 2 November): an agent's Claude run when
 * an agent planned it, the CFO's command (`npm run licence`) when a person started it, code's rule, or null when
 * nothing set one. created_by stays the role that owns the proposal (four eyes reads it); the origin says who started it.
 */
export function createProposal(
  db: DB,
  args: { terms: Terms; createdBy: Actor; evidence?: Json; explanation?: string; guard?: (db: DB) => string | null; assignId?: boolean },
  now = new Date(),
): ProposalRow {
  const origin = currentOrigin();
  return db.transaction(() => {
    // A caller's guard runs inside the write lock (BEGIN IMMEDIATE), so no other run can file between its check and the insert.
    const refused = args.guard?.(db) ?? null;
    if (refused) throw new ProposalRefused(refused);
    // assignId: the number is taken inside the same lock, so two runs filing at once (two connections) never pick the
    // same one (Opus re-review, 2 November); the terms, and so their hash, carry the number taken here.
    const terms: Terms = args.assignId ? { ...args.terms, proposal_id: nextProposalId(db) } : args.terms;
    const sha = termsHash(terms);
    const policy = policyVersion(db, now);
    db.prepare(
      `INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, evidence_json, explanation, status, expires_at, created_at, policy_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, ?)`,
    ).run(
      terms.proposal_id, terms.kind, JSON.stringify(terms), sha, args.createdBy,
      args.evidence === undefined ? null : JSON.stringify(args.evidence), args.explanation ?? null,
      terms.expires_at, now.toISOString(), policy.version,
    );
    audit(db, args.createdBy, "proposal.created", terms.proposal_id, { kind: terms.kind, terms_sha256: sha, policy_version: policy.version, origin: (origin as Json | null) ?? null }, now);
    return get(db, terms.proposal_id);
  }).immediate();
}

function expireIfDue(db: DB, p: ProposalRow, now: Date): boolean {
  if (Date.parse(p.expires_at) > now.getTime()) return false;
  if (p.status === "PENDING_APPROVAL" || p.status === "APPROVED" || p.status === "FAILED") {
    transition(db, p.proposal_id, p.status, "EXPIRED");
    audit(db, "system", "proposal.expired", p.proposal_id, { expires_at: p.expires_at }, now);
  }
  return true;
}

/**
 * Price options replace the same mandates; once one is approved, the others must never be (the executor would
 * refuse them on chain anyway, and supersedes them after it runs). Returns the approved alternative, if any.
 */
export function approvedAlternative(db: DB, p: Pick<ProposalRow, "proposal_id" | "kind" | "terms_json">): string | null {
  if (p.kind !== "mandate_replace") return null;
  const replaced = (json: string) => {
    const steps = (JSON.parse(json) as { steps?: { replaces_credential_hash?: string }[] }).steps ?? [];
    return steps.map((s) => s.replaces_credential_hash).filter((h): h is string => typeof h === "string");
  };
  const mine = new Set(replaced(p.terms_json));
  const others = db.prepare("SELECT proposal_id, terms_json FROM proposals WHERE kind = 'mandate_replace' AND status IN ('APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED') AND proposal_id != ?")
    .all(p.proposal_id) as { proposal_id: string; terms_json: string }[];
  return others.find((o) => replaced(o.terms_json).some((h) => mine.has(h)))?.proposal_id ?? null;
}

export type Decision = "APPROVED" | "REJECTED";
export type ApprovalMethod = "web" | "cli" | "telegram" | "passkey";

export interface DecideArgs {
  proposalId: string;
  decision: Decision;
  typedPrefix: string;
  approver: string;
  method: ApprovalMethod;
  note?: string;
  /** Method passkey: the full hash the passkey signed (its WebAuthn challenge), already verified by the caller: the
   *  terms hash to approve, rejectionSha256(terms hash) to reject. */
  signedSha256?: string;
  /** Method passkey: which credential signed, and the hash of the stored assertion; factor: a passkey (the default) or a
   *  security key, which only ever counts as the second key of a high-risk payment (src/policy/secondKey.ts). */
  passkey?: { credentialId: string; assertionSha256: string; factor?: "passkey" | "security_key" };
}

/**
 * The approver types the first 8 hex characters of the hash they saw, or (method passkey) their passkey signed
 * the full hash (or, to reject, the rejection hash derived from it). A wrong prefix or a signature over other
 * terms records nothing.
 */
export function decide(db: DB, args: DecideArgs, now = new Date()): ProposalStatus {
  if (args.method === "passkey") {
    if (!args.signedSha256) throw new Error("a passkey decision needs the signed hash");
    if (!args.passkey) throw new Error("a passkey decision needs the signing credential");
  }
  // Once a passkey is enrolled it is the only way to approve: a typed hash prefix is not a secret (the relay shows
  // every pending hash), so the CLI and the local page may still reject, never approve (security review H1).
  if (args.decision === "APPROVED" && args.method !== "passkey" && db.prepare("SELECT 1 FROM passkeys WHERE status = 'ACTIVE'").get()) {
    throw new Error("a passkey is enrolled: approve with it (Face ID on the phone); a typed hash prefix can only reject");
  }
  const passkey = args.passkey && { credential_id: args.passkey.credentialId, assertion_sha256: args.passkey.assertionSha256 };
  return db.transaction((): ProposalStatus => {
    const p = args.decision === "APPROVED" ? ofSignedKind(get(db, args.proposalId)) : get(db, args.proposalId);
    if (p.status !== "PENDING_APPROVAL") throw new Error(`${p.proposal_id} is ${p.status}, not waiting for approval`);
    // A payment in a waiting batch is decided with its batch only: the CFO signs the list, not the line on its own.
    const inBatch = BATCHABLE.has(p.kind) ? openBatchOf(db, p.proposal_id) : null;
    if (inBatch) throw new Error(`${p.proposal_id} is in batch ${inBatch}: approve or reject the batch (or take it out of the batch first)`);
    if (args.method === "passkey") {
      // An approval signs the terms hash; a rejection signs the hash derived from it, so neither passes as the other.
      if (args.decision === "REJECTED" && args.signedSha256 === p.terms_sha256) throw new Error("a passkey rejection signs the rejection hash, not the terms hash");
      const expected = args.decision === "APPROVED" ? approvalHashOf(p) : rejectionSha256(p.terms_sha256);
      if (args.signedSha256 !== expected) throw new Error(`the passkey signed other terms than ${p.proposal_id}'s`);
    }
    if (expireIfDue(db, p, now)) {
      // A decision that arrives after the terms ran out records who tried, and approves nothing.
      audit(db, "human", "approval.too_late", p.proposal_id,
        { terms_sha256: p.terms_sha256, approver: args.approver, method: args.method, expires_at: p.expires_at, ...(passkey ? { passkey } : {}) }, now);
      return "EXPIRED";
    }
    if (!prefixMatches(p.terms_sha256, args.typedPrefix)) throw new Error("typed prefix does not match the terms hash");
    // A batch approves only if every line is exactly what was signed and still waits; one changed line refuses it all.
    if (p.kind === BATCH_KIND && args.decision === "APPROVED") verifyBatch(db, p, now);
    const alternative = args.decision === "APPROVED" ? approvedAlternative(db, p) : null;
    if (alternative) throw new Error(`another option, ${alternative}, was already approved`);
    let approver = args.approver;
    const factor = args.passkey?.factor ?? "passkey";
    // A high-risk payment (src/policy/secondKey.ts, off until the CFO switches a trigger on): the same person signs its
    // exact terms with two different keys, their passkey and a security key. With one of them it keeps waiting. A
    // security key never approves anything else.
    const highRisk = args.decision === "APPROVED" ? secondKeyReasons(db, p, now) : [];
    if (highRisk.length) {
      if (args.method !== "passkey" || !passkey) throw new Error(`${p.proposal_id} is high-risk (${highRisk.join("; ")}): it needs your Face ID and your security key`);
      const person = args.approver.split(" (")[0]!;
      const both = recordFactor(db, { proposalId: p.proposal_id, termsSha256: p.terms_sha256, person, credentialId: passkey.credential_id, factor, assertionSha256: passkey.assertion_sha256 }, now);
      if (!both) {
        audit(db, "human", "proposal.factor_signed", p.proposal_id, { terms_sha256: p.terms_sha256, approver: args.approver, person, factor, high_risk: highRisk, of: "1 of 2 keys", passkey }, now);
        return "PENDING_APPROVAL";
      }
      approver = `${person} (passkey and security key)`;
    } else if (args.decision === "APPROVED" && factor === "security_key") {
      throw new Error(`${p.proposal_id} is not high-risk: a security key alone never approves; approve with your passkey (Face ID)`);
    }
    // Segregation of duties (src/policy/policySod.ts): whoever proposed a policy change never approves it, with one
    // person or two; loosening above the CFO's threshold for it needs two people (four eyes, below).
    const sod = args.decision === "APPROVED" && p.kind === "policy_change" ? sodChanges(db, p.terms_json) : [];
    const sodWhy = sod.length ? { threshold_eur: sodThreshold(db), loosens: sod.map((c) => ({ key: c.key, from: c.from, to: c.to, why: c.why })) } : null;
    const rule = sodWhy ? "segregation of duties: this loosens the CFO policy above the threshold" : "four eyes";
    if (args.decision === "APPROVED" && p.kind === "policy_change") {
      const person = approver.split(" (")[0]!;
      const proposer = proposerOf(p);
      if (person === proposer) throw new Error(`${person} proposed ${p.proposal_id}, so ${person} cannot approve it (segregation of duties)`);
    }
    if (args.decision === "APPROVED" && fourEyes(db, p)) {
      // E1, four eyes: two different people, each with their own passkey, and never the one who proposed it. The
      // first signature is kept and the proposal waits; the second approves. One person's rejection stops it.
      if (args.method !== "passkey" || !passkey) throw new Error(`${p.proposal_id} needs the passkeys of two different people (${rule})`);
      const person = approver.split(" (")[0]!;
      if (person === p.created_by) throw new Error(`${person} proposed ${p.proposal_id}, so ${person} cannot approve it (${rule})`);
      const signed = db.prepare("SELECT person, approver FROM cosignatures WHERE proposal_id = ? AND terms_sha256 = ? ORDER BY created_at, rowid").all(p.proposal_id, p.terms_sha256) as { person: string; approver: string }[]; // only a first signature over these exact terms counts: one made before the stored terms changed signed other terms (zero-trust matrix, 12 November)
      if (signed.some((x) => x.person === person)) throw new Error(`${person} already approved ${p.proposal_id}; a second person must approve it with their own passkey${sodWhy ? ` (${rule})` : ""}`);
      db.prepare("INSERT INTO cosignatures (proposal_id, credential_id, person, approver, terms_sha256, assertion_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(p.proposal_id, passkey.credential_id, person, approver, p.terms_sha256, passkey.assertion_sha256, now.toISOString());
      if (signed.length === 0) {
        audit(db, "human", "proposal.cosigned", p.proposal_id, { terms_sha256: p.terms_sha256, approver, person, of: "1 of 2", method: args.method, passkey, ...(sodWhy ? { segregation_of_duties: sodWhy } : {}) }, now);
        return "PENDING_APPROVAL";
      }
      approver = [...signed.map((x) => x.approver), approver].join(" + ");
    }
    // The policy as it stood when the person decided (backend review B4).
    const policy = policyVersion(db, now);
    db.prepare(
      `INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at, policy_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.proposal_id, args.decision, p.terms_sha256, approver, args.method, args.typedPrefix.trim().toLowerCase(), args.note ?? null, now.toISOString(), policy.version);
    transition(db, p.proposal_id, "PENDING_APPROVAL", args.decision);
    audit(db, "human", args.decision === "APPROVED" ? "proposal.approved" : "proposal.rejected", p.proposal_id,
      { terms_sha256: p.terms_sha256, approver, method: args.method, note: args.note ?? null, ...(passkey ? { passkey } : {}), policy_version: policy.version, ...(sodWhy ? { segregation_of_duties: sodWhy } : {}) }, now);
    if (p.kind === BATCH_KIND) decideBatchLines(db, p, args.decision, approver, args.method, passkey, policy.version, now);
    return args.decision;
  }).immediate();
}

// ALONE_KINDS: the kinds an agent may pay alone within the CFO's limit (a supplier invoice's payment, nothing else).
// WITHIN_LIMIT: the audit row of a payment approved by code within that limit (no person signed it). POLICY_METHOD: the
// approval method of such a payment, the CFO's policy applied by code (approvals.method). All three live beside the check
// that execution makes of such an approval (src/policy/signedApproval.ts).
export { POLICY_METHOD, WITHIN_LIMIT };

/**
 * A supplier invoice's payment approved by code, without a person, because its exact terms are within the CFO's limit
 * to pay alone (owner, 16 Nov: on /try a visitor sees an agent pay an invoice on its own). Only for an invoice payment
 * that waits for approval on its own (no batch), whose stored terms still hash to its hash and ask a plain amount at or
 * below the limit in the limit's own currency, and that needs no second person or second key: anything else is left to
 * the CFO, untouched, with the reason. The caller decides whether the agents and code's checks said pay
 * (src/ap/pay.ts payAlone); this is the last check, on the terms that will run. The approval is recorded as the policy's
 * (method "policy", approver "Purser's code"), the executor runs it like any approved payment, and every money step
 * records code's rule as its origin (src/executors/index.ts approvalOrigin).
 */
export function approveWithinLimit(db: DB, args: { proposalId: string; limit: { currency: string; amount: string }; rule: string; agent: string }, now = new Date()): { ok: true } | { ok: false; reason: string } {
  return db.transaction((): { ok: true } | { ok: false; reason: string } => {
    const no = (reason: string) => ({ ok: false as const, reason });
    const p = get(db, args.proposalId);
    if (p.status !== "PENDING_APPROVAL") return no(`${p.proposal_id} is ${p.status}, not waiting for approval`);
    if (!ALONE_KINDS.has(p.kind)) return no(`${p.proposal_id} is a ${p.kind}: only an invoice's payment may be paid alone`);
    let terms: { kind?: unknown; amount?: unknown; currency?: unknown };
    try { terms = JSON.parse(p.terms_json) as typeof terms; } catch { return no(`${p.proposal_id}'s terms cannot be read`); }
    let same: boolean;
    try { same = terms.kind === p.kind && termsHash(terms as Terms) === p.terms_sha256; } catch { same = false; }
    if (!same) return no(`${p.proposal_id}'s stored terms are not the ones filed`);
    if (BATCHABLE.has(p.kind) && openBatchOf(db, p.proposal_id)) return no(`${p.proposal_id} is in a batch: the CFO signs the batch`);
    if (expireIfDue(db, p, now)) return no(`${p.proposal_id} expired at ${p.expires_at}`);
    const { amount, currency } = terms;
    // Only the limit in force counts (finding 7, 20 Nov): one the CFO signed with the passkey, or a test company's
    // labelled default (src/policy/aloneLimit.ts); a limit handed in that is not that one approves nothing.
    const inForce = aloneLimitInForce(db);
    if (!inForce) return no("no limit to pay alone is in force (none signed by the CFO with the passkey, and no labelled system default)");
    if (inForce.currency !== args.limit.currency || inForce.amount !== args.limit.amount) return no(`the limit given (${args.limit.currency} ${args.limit.amount}) is not the one in force (${inForce.currency} ${inForce.amount})`);
    // Integer cents only (src/policy/withinLimit.ts, proven in formal/dafny/Limit.dfy).
    const decision = aloneDecision(amount, currency, args.limit);
    if (decision === "no_limit") return no("no limit to pay alone is set");
    if (decision === "not_within") {
      return no(`${String(currency)} ${String(amount)} is not within the ${args.limit.currency} ${args.limit.amount} the agent may pay alone`);
    }
    if (fourEyes(db, p)) return no(`${p.proposal_id} needs two people's approval (four eyes)`);
    const highRisk = secondKeyReasons(db, p, now);
    if (highRisk.length) return no(`${p.proposal_id} is high-risk (${highRisk.join("; ")}): the CFO signs it with two keys`);
    const policy = policyVersion(db, now);
    const approver = "Purser's code";
    db.prepare(
      `INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at, policy_version)
       VALUES (?, 'APPROVED', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.proposal_id, p.terms_sha256, approver, POLICY_METHOD, p.terms_sha256.slice(0, 8), args.rule.slice(0, 600), now.toISOString(), policy.version);
    transition(db, p.proposal_id, "PENDING_APPROVAL", "APPROVED");
    audit(db, "system", WITHIN_LIMIT, p.proposal_id, {
      terms_sha256: p.terms_sha256, approver, method: POLICY_METHOD, agent: args.agent, rule: args.rule.slice(0, 600),
      // Within the limit, the amount is a string and the currency is the limit's own (aloneDecision).
      amount: String(amount), currency: args.limit.currency, limit: `${args.limit.currency} ${args.limit.amount}`, policy_version: policy.version,
      // Where the limit comes from, in words: signed by the CFO (and which policy change), or a labelled system default.
      limit_source: sourceWords(inForce.source),
    }, now);
    return { ok: true };
  }).immediate();
}

/**
 * The lines of a batch the CFO just decided: each line's own proposal gets the same decision, recorded against its own
 * terms hash with the batch's id and hash beside it (so a line's approval proves which signed list it was in). Runs in
 * decide()'s transaction: the batch and its lines are decided together or not at all.
 */
function decideBatchLines(db: DB, batch: ProposalRow, decision: Decision, approver: string, method: ApprovalMethod,
  passkey: { credential_id: string; assertion_sha256: string } | undefined, policyVersionNo: number, now: Date): void {
  const lines = db.prepare("SELECT proposal_id FROM batch_lines WHERE batch_id = ? ORDER BY position").all(batch.proposal_id) as { proposal_id: string }[];
  for (const { proposal_id } of lines) {
    const line = get(db, proposal_id);
    if (line.status !== "PENDING_APPROVAL") {
      if (decision === "APPROVED") throw new Error(`${batch.proposal_id}: line ${proposal_id} is ${line.status}, not waiting for approval`);
      continue;
    }
    const note = `in batch ${batch.proposal_id} (batch hash ${batch.terms_sha256})`;
    db.prepare(
      `INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at, policy_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(proposal_id, decision, line.terms_sha256, approver, method, line.terms_sha256.slice(0, 8), note, now.toISOString(), policyVersionNo);
    transition(db, proposal_id, "PENDING_APPROVAL", decision);
    audit(db, "human", decision === "APPROVED" ? "proposal.approved" : "proposal.rejected", proposal_id,
      { terms_sha256: line.terms_sha256, approver, method, note, batch: { id: batch.proposal_id, terms_sha256: batch.terms_sha256 }, ...(passkey ? { passkey } : {}), policy_version: policyVersionNo }, now);
  }
}

/**
 * The execution guard. In one transaction: the stored terms still hash to the approved hash, the
 * approval is unused, the proposal has not expired, and the caller's precondition check still holds.
 * Returns the terms; the executor must build every payload from these and nothing else.
 */
/** Actions a restart is resuming (src/policy/saga.ts): only these may be begun again while EXECUTING. */
export const resuming = new Set<string>();

export function beginExecution<T extends Terms>(db: DB, proposalId: string, preconditions: (terms: T) => void = () => {}, now = new Date()): T {
  // Expiry is committed on its own, so the EXPIRED status survives the error thrown below.
  const expired = db.transaction(() => {
    const row = get(db, proposalId);
    // The expiry the CFO signed is the one inside the terms. The column is a copy the hash does not cover, so the
    // earlier of the two counts: pushing the column out buys no time (zero-trust matrix, 12 November).
    const p = { ...row, expires_at: signedExpiry(row) };
    return (p.status === "APPROVED" || p.status === "FAILED") && Date.parse(p.expires_at) <= now.getTime() ? (expireIfDue(db, p, now), p.expires_at) : null;
  }).immediate();
  if (expired) throw new Error(`${proposalId} expired at ${expired}; approval void`);
  // 19 Nov, fourth round (red team rewrite-history): nothing the CFO approved runs on an audit log that no longer
  // verifies, except a policy change (the emergency stop, a pause, a limit), which moves no money and must still work
  // in an incident. A restart's resume is not a new execution: it was checked when it began.
  const tampered = db.transaction(() => {
    const p = get(db, proposalId);
    // The kind the CFO signed (inside the hashed terms, checked below), not the column beside it.
    const kind = String((JSON.parse(p.terms_json) as { kind?: unknown }).kind);
    if (kind === "policy_change" || (p.status === "EXECUTING" && resuming.has(proposalId))) return null;
    const why = auditChainRefusal(db);
    if (why) audit(db, "system", "execution.refused_ledger_tampered", proposalId, { reason: why, kind }, now);
    return why;
  }).immediate();
  if (tampered) {
    recordBlocked(db, proposalId, tampered, now);
    throw new Error(`${proposalId}: ${tampered}`);
  }
  // Outside audit 1.4: with a checkpoint key configured, the ledger must also match its latest signed checkpoint
  // (src/audit/checkpointer.ts). A policy change that only tightens (the emergency stop, a pause, a lower limit) still
  // runs in an incident; one that loosens anything is checked, its chain included. Checked outside a transaction, so
  // another process can finish the checkpoint of a payment it has just made. A restart's resume is not checked again.
  const unanchored = (() => {
    const p = get(db, proposalId);
    if (p.status === "EXECUTING" && resuming.has(proposalId)) return null;
    const t = JSON.parse(p.terms_json) as { kind?: unknown; changes?: unknown };
    if (t.kind !== "policy_change") return checkpointRefusal(db, "payment", now);
    const changes = Array.isArray(t.changes) ? (t.changes as { key?: unknown; from?: unknown; to?: unknown }[]) : [];
    const looser = changes.some((c) => loosens({ key: String(c?.key ?? ""), from: String(c?.from ?? ""), to: String(c?.to ?? "") }));
    return looser ? checkpointRefusal(db, "policy change", now) : null;
  })();
  if (unanchored) throw new Error(`${proposalId}: ${unanchored}`);
  // The hub gate (src/hub/gate.ts), an extra gate on top of every check below, never instead of one; off unless
  // HUB_DECISIONS_ENABLED. Its refusal is committed on its own, so the record survives the error thrown here. A
  // restart's resume is not a new execution: it was gated when it began.
  const hubRefused = hubDecisionsEnabled() && db.transaction(() => {
    const p = get(db, proposalId);
    if (p.status === "EXECUTING" && resuming.has(proposalId)) return null;
    if (p.status !== "APPROVED" && p.status !== "FAILED") return null;
    const why = hubGateRefusal(db, p, now);
    if (why) audit(db, "system", "hub.gate_refused", proposalId, { reason: why, terms_sha256: p.terms_sha256 }, now);
    return why;
  }).immediate();
  if (hubRefused) throw new Error(hubRefused);
  // Outside audit 2.1: a refusal below of a proposal that is APPROVED (the hash, the signature, the executor's own
  // preconditions: the EUR floor, a hold, a changed payee) is recorded with its reason and time (src/policy/blocked.ts),
  // so the CFO sees it blocked and /health raises approved_blocked, instead of it waiting silently until it expires.
  // Nothing is recorded for a failed run's retry or a restart's resume (not APPROVED), nor for the hub gate (a wait).
  let run: { terms: T } | { unsigned: string };
  try {
    run = guard();
  } catch (e) {
    if (!(e as Error).message.startsWith("hub gate:")) recordBlocked(db, proposalId, (e as Error).message, now);
    throw e;
  }
  if ("unsigned" in run) {
    recordBlocked(db, proposalId, unsignedRefusal(run.unsigned), now);
    throw new Error(unsignedRefusal(run.unsigned));
  }
  return run.terms;

  function guard(): { terms: T } | { unsigned: string } {
    return db.transaction((): { terms: T } | { unsigned: string } => {
      const p = get(db, proposalId);
      // A restart resumes an action a crash left EXECUTING: same hash checks and preconditions, no new transition.
      const resume = p.status === "EXECUTING" && resuming.has(proposalId);
      if (p.status !== "APPROVED" && p.status !== "FAILED" && !resume) throw new Error(`${proposalId} is ${p.status}, not approved`);
      const terms = JSON.parse(p.terms_json) as T;
      const approval = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as
        { approved_sha256: string; decision: string } | undefined;
      const recomputed = termsHash(terms);
      if (!approval || approval.decision !== "APPROVED") throw new Error(`${proposalId} has no approval`);
      if (recomputed !== p.terms_sha256 || recomputed !== approval.approved_sha256) throw new Error(`${proposalId}: terms do not match the approved hash ${approval.approved_sha256}`);
      if (!resume) {
        // 20 Nov (security review, finding 1): the approval row is not enough, since it lives in the same database as the
        // terms. The stored passkey signatures behind it must verify, here, over these exact terms (or, for a payment code
        // approved within the limit to pay alone, its record and the limit it stood on: src/policy/signedApproval.ts). The
        // refusal is recorded and committed, as a ledger-tamper refusal is, and nothing moves to EXECUTING.
        const unsigned = approvalSignatureRefusal(db, proposalId);
        if (unsigned) {
          audit(db, "system", REFUSED_UNSIGNED, proposalId, { reason: unsigned.slice(0, 400), terms_sha256: recomputed }, now);
          return { unsigned };
        }
        // Again inside the write lock, so nothing can change between the gate and the transition.
        const why = hubGateRefusal(db, p, now);
        if (why) throw new Error(why);
      }
      preconditions(terms);
      if (resume) return { terms };
      transition(db, proposalId, p.status, "EXECUTING");
      audit(db, "system", "proposal.executing", proposalId, { terms_sha256: recomputed }, now);
      return { terms };
    }).immediate();
  }
}

/** The audit row of an execution refused because no verifying signature stands behind its approval (finding 1). */
export const REFUSED_UNSIGNED = "execution.refused_unsigned";
/** The error the execution guard throws for it. */
export const unsignedRefusal = (reason: string) => `execution_refused_unsigned: ${reason}; no money moves on it`;

/** When a proposal runs out: the expiry in its terms (the one the hash covers), or the column's when that is earlier or the terms cannot be read. */
function signedExpiry(p: Pick<ProposalRow, "terms_json" | "expires_at">): string {
  let inTerms: unknown;
  try { inTerms = (JSON.parse(p.terms_json) as { expires_at?: unknown }).expires_at; } catch { return p.expires_at; }
  return typeof inTerms === "string" && Date.parse(inTerms) < Date.parse(p.expires_at) ? inTerms : p.expires_at;
}

/**
 * A proposal whose kind column is the kind inside its terms, the one the hash covers; refused otherwise. The column
 * decides four eyes and batches, so a kind changed beside the terms would let one person approve what needs two
 * (zero-trust matrix, 12 November).
 */
function ofSignedKind(p: ProposalRow): ProposalRow {
  let inTerms: unknown;
  try { inTerms = (JSON.parse(p.terms_json) as { kind?: unknown }).kind; } catch { inTerms = null; }
  if (inTerms !== p.kind) throw new Error(`${p.proposal_id} is filed as ${p.kind}, but its signed terms say ${String(inTerms)}; nothing is approved`);
  return p;
}

export function finishExecution(db: DB, proposalId: string, outcome: "EXECUTED" | "FAILED" | "NEEDS_REAPPROVAL", detail: Json = {}, now = new Date()): void {
  db.transaction(() => {
    transition(db, proposalId, "EXECUTING", outcome);
    audit(db, "system", `proposal.${outcome.toLowerCase()}`, proposalId, detail, now);
  }).immediate();
}

/**
 * Closes a proposal whose terms can never run (its executor's guard refused them, or would): NEEDS_REAPPROVAL, terminal,
 * with the reason in a proposal.needs_reapproval row. From waiting, approved, failed, or (only for a restart's resume)
 * executing; anything else is left as it is. True when it was closed here. Runs nothing and moves no money.
 */
export function closeAsStale(db: DB, proposalId: string, detail: { error: string } & Record<string, Json>, opts: { resuming?: boolean } = {}, now = new Date()): boolean {
  return db.transaction((): boolean => {
    const p = get(db, proposalId);
    const from: ProposalStatus[] = ["PENDING_APPROVAL", "APPROVED", "FAILED", ...(opts.resuming ? ["EXECUTING" as const] : [])];
    if (!from.includes(p.status)) return false;
    transition(db, proposalId, p.status, "NEEDS_REAPPROVAL");
    audit(db, "system", "proposal.needs_reapproval", proposalId, { ...detail, error: detail.error.slice(0, 300), from: p.status }, now);
    return true;
  }).immediate();
}

/**
 * A person closes an approved proposal that its executor blocked (src/policy/blocked.ts), as a rejection after the
 * approval: NEEDS_REAPPROVAL, terminal, with the block's reason. It runs nothing and moves no money, so the first 8 hex
 * of the terms hash suffice, as for a rejection. Paying on other terms is a new proposal with a new approval.
 */
export function closeBlocked(db: DB, proposalId: string, typedPrefix: string, person: string, now = new Date()): void {
  const p = get(db, proposalId);
  if (!prefixMatches(p.terms_sha256, typedPrefix)) throw new Error("typed prefix does not match the terms hash");
  const b = blockedApprovals(db, now).find((x) => x.proposal_id === proposalId);
  if (!b) throw new Error(`${proposalId} is ${p.status} and not blocked at execution; nothing to close`);
  closeAsStale(db, proposalId, { error: b.reason, stopped: `closed by ${person} after its execution was blocked`, check: b.check, blocked_since: b.since }, {}, now);
}

/**
 * The terms a proposal was approved with, for what follows the payment (the books, the archive): the stored terms,
 * only while they still hash to the stored hash and to the hash the approval records, as the execution guard checks
 * before the payment. Otherwise why not: the terms were changed after they were signed, or nobody approved them.
 */
export function signedTerms<T extends Terms>(db: DB, proposalId: string): { ok: true; terms: T; sha256: string } | { ok: false; reason: string } {
  const p = db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string; terms_sha256: string } | undefined;
  if (!p) return { ok: false, reason: `no proposal ${proposalId}` };
  const approval = db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(proposalId) as { approved_sha256: string } | undefined;
  if (!approval) return { ok: false, reason: `${proposalId} has no approval` };
  let terms: T;
  let recomputed: string;
  try {
    terms = JSON.parse(p.terms_json) as T;
    recomputed = termsHash(terms);
  } catch {
    return { ok: false, reason: `${proposalId}: the stored terms cannot be read, so they do not match the approved hash` };
  }
  if (recomputed !== p.terms_sha256 || recomputed !== approval.approved_sha256) return { ok: false, reason: `${proposalId}: the stored terms do not match the approved hash` };
  return { ok: true, terms, sha256: recomputed };
}

/** Marks every proposal whose time ran out as EXPIRED, so no list shows it as still waiting. */
export function expireDue(db: DB, now = new Date()): string[] {
  // Timestamps are compared as instants, not strings: "…00Z" and "…00.000Z" are the same moment.
  const due = (db.prepare("SELECT * FROM proposals WHERE status IN ('PENDING_APPROVAL', 'APPROVED')").all() as ProposalRow[])
    .filter((p) => Date.parse(p.expires_at) <= now.getTime());
  return db.transaction(() => due.filter((p) => expireIfDue(db, p, now)).map((p) => p.proposal_id)).immediate();
}
