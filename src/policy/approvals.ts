// Proposal -> approval -> execution (build plan 2.3). A person approves the hash of the exact terms;
// the executor runs only if the stored terms still hash to what was approved, once.

import { approvalHashOf } from "../metal/ownersExecute.js";
import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { prefixMatches, rejectionSha256, termsHash, type Terms } from "../lib/terms.js";
import { fourEyes } from "./fourEyes.js";
import { policyVersion } from "./versions.js";
import { currentOrigin } from "../provenance/origin.js";
import { hubGateRefusal } from "../hub/gate.js";
import { hubDecisionsEnabled } from "../hub/config.js";
import { BATCH_KIND, BATCHABLE, openBatchOf, verifyBatch } from "./batchLines.js";

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
  /** Method passkey: which credential signed, and the hash of the stored assertion. */
  passkey?: { credentialId: string; assertionSha256: string };
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
    if (args.decision === "APPROVED" && fourEyes(db, p)) {
      // E1, four eyes: two different people, each with their own passkey, and never the one who proposed it. The
      // first signature is kept and the proposal waits; the second approves. One person's rejection stops it.
      if (args.method !== "passkey" || !passkey) throw new Error(`${p.proposal_id} needs the passkeys of two different people (four eyes)`);
      const person = args.approver.split(" (")[0]!;
      if (person === p.created_by) throw new Error(`${person} proposed ${p.proposal_id}, so ${person} cannot approve it (four eyes)`);
      const signed = db.prepare("SELECT person, approver FROM cosignatures WHERE proposal_id = ? AND terms_sha256 = ? ORDER BY created_at, rowid").all(p.proposal_id, p.terms_sha256) as { person: string; approver: string }[]; // only a first signature over these exact terms counts: one made before the stored terms changed signed other terms (zero-trust matrix, 12 November)
      if (signed.some((x) => x.person === person)) throw new Error(`${person} already approved ${p.proposal_id}; a second person must approve it with their own passkey`);
      db.prepare("INSERT INTO cosignatures (proposal_id, credential_id, person, approver, terms_sha256, assertion_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(p.proposal_id, passkey.credential_id, person, args.approver, p.terms_sha256, passkey.assertion_sha256, now.toISOString());
      if (signed.length === 0) {
        audit(db, "human", "proposal.cosigned", p.proposal_id, { terms_sha256: p.terms_sha256, approver: args.approver, person, of: "1 of 2", method: args.method, passkey }, now);
        return "PENDING_APPROVAL";
      }
      approver = [...signed.map((x) => x.approver), args.approver].join(" + ");
    }
    // The policy as it stood when the person decided (backend review B4).
    const policy = policyVersion(db, now);
    db.prepare(
      `INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at, policy_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.proposal_id, args.decision, p.terms_sha256, approver, args.method, args.typedPrefix.trim().toLowerCase(), args.note ?? null, now.toISOString(), policy.version);
    transition(db, p.proposal_id, "PENDING_APPROVAL", args.decision);
    audit(db, "human", args.decision === "APPROVED" ? "proposal.approved" : "proposal.rejected", p.proposal_id,
      { terms_sha256: p.terms_sha256, approver, method: args.method, note: args.note ?? null, ...(passkey ? { passkey } : {}), policy_version: policy.version }, now);
    if (p.kind === BATCH_KIND) decideBatchLines(db, p, args.decision, approver, args.method, passkey, policy.version, now);
    return args.decision;
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
  return db.transaction((): T => {
    const p = get(db, proposalId);
    // A restart resumes an action a crash left EXECUTING: same hash checks and preconditions, no new transition.
    const resume = p.status === "EXECUTING" && resuming.has(proposalId);
    if (p.status !== "APPROVED" && p.status !== "FAILED" && !resume) throw new Error(`${proposalId} is ${p.status}, not approved`);
    const terms = JSON.parse(p.terms_json) as T;
    const approval = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as
      { approved_sha256: string; decision: string } | undefined;
    const recomputed = termsHash(terms);
    if (!approval || approval.decision !== "APPROVED") throw new Error(`${proposalId} has no approval`);
    if (recomputed !== p.terms_sha256 || recomputed !== approval.approved_sha256) throw new Error(`${proposalId}: terms do not match the approved hash`);
    if (!resume) {
      // Again inside the write lock, so nothing can change between the gate and the transition.
      const why = hubGateRefusal(db, p, now);
      if (why) throw new Error(why);
    }
    preconditions(terms);
    if (resume) return terms;
    transition(db, proposalId, p.status, "EXECUTING");
    audit(db, "system", "proposal.executing", proposalId, { terms_sha256: recomputed }, now);
    return terms;
  }).immediate();
}

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
