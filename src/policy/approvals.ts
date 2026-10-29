// Proposal -> approval -> execution (build plan 2.3). A person approves the hash of the exact terms;
// the executor runs only if the stored terms still hash to what was approved, once.

import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { prefixMatches, rejectionSha256, termsHash, type Terms } from "../lib/terms.js";
import { fourEyes } from "./fourEyes.js";

export type ProposalStatus =
  | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED" | "SUPERSEDED"
  | "EXECUTING" | "EXECUTED" | "FAILED" | "NEEDS_REAPPROVAL";

const ALLOWED: Record<ProposalStatus, ProposalStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED"],
  APPROVED: ["EXECUTING", "EXPIRED"],
  EXECUTING: ["EXECUTED", "FAILED", "NEEDS_REAPPROVAL"],
  FAILED: ["EXECUTING", "EXPIRED"],
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

export function createProposal(
  db: DB,
  args: { terms: Terms; createdBy: Actor; evidence?: Json; explanation?: string },
  now = new Date(),
): ProposalRow {
  const sha = termsHash(args.terms);
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, evidence_json, explanation, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?)`,
    ).run(
      args.terms.proposal_id, args.terms.kind, JSON.stringify(args.terms), sha, args.createdBy,
      args.evidence === undefined ? null : JSON.stringify(args.evidence), args.explanation ?? null,
      args.terms.expires_at, now.toISOString(),
    );
    audit(db, args.createdBy, "proposal.created", args.terms.proposal_id, { kind: args.terms.kind, terms_sha256: sha }, now);
    return get(db, args.terms.proposal_id);
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
    const p = get(db, args.proposalId);
    if (p.status !== "PENDING_APPROVAL") throw new Error(`${p.proposal_id} is ${p.status}, not waiting for approval`);
    if (args.method === "passkey") {
      // An approval signs the terms hash; a rejection signs the hash derived from it, so neither passes as the other.
      if (args.decision === "REJECTED" && args.signedSha256 === p.terms_sha256) throw new Error("a passkey rejection signs the rejection hash, not the terms hash");
      const expected = args.decision === "APPROVED" ? p.terms_sha256 : rejectionSha256(p.terms_sha256);
      if (args.signedSha256 !== expected) throw new Error(`the passkey signed other terms than ${p.proposal_id}'s`);
    }
    if (expireIfDue(db, p, now)) {
      // A decision that arrives after the terms ran out records who tried, and approves nothing.
      audit(db, "human", "approval.too_late", p.proposal_id,
        { terms_sha256: p.terms_sha256, approver: args.approver, method: args.method, expires_at: p.expires_at, ...(passkey ? { passkey } : {}) }, now);
      return "EXPIRED";
    }
    if (!prefixMatches(p.terms_sha256, args.typedPrefix)) throw new Error("typed prefix does not match the terms hash");
    const alternative = args.decision === "APPROVED" ? approvedAlternative(db, p) : null;
    if (alternative) throw new Error(`another option, ${alternative}, was already approved`);
    let approver = args.approver;
    if (args.decision === "APPROVED" && fourEyes(db, p)) {
      // E1, four eyes: two different people, each with their own passkey, and never the one who proposed it. The
      // first signature is kept and the proposal waits; the second approves. One person's rejection stops it.
      if (args.method !== "passkey" || !passkey) throw new Error(`${p.proposal_id} needs the passkeys of two different people (four eyes)`);
      const person = args.approver.split(" (")[0]!;
      if (person === p.created_by) throw new Error(`${person} proposed ${p.proposal_id}, so ${person} cannot approve it (four eyes)`);
      const signed = db.prepare("SELECT person, approver FROM cosignatures WHERE proposal_id = ? ORDER BY created_at, rowid").all(p.proposal_id) as { person: string; approver: string }[];
      if (signed.some((x) => x.person === person)) throw new Error(`${person} already approved ${p.proposal_id}; a second person must approve it with their own passkey`);
      db.prepare("INSERT INTO cosignatures (proposal_id, credential_id, person, approver, terms_sha256, assertion_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(p.proposal_id, passkey.credential_id, person, args.approver, p.terms_sha256, passkey.assertion_sha256, now.toISOString());
      if (signed.length === 0) {
        audit(db, "human", "proposal.cosigned", p.proposal_id, { terms_sha256: p.terms_sha256, approver: args.approver, person, of: "1 of 2", method: args.method, passkey }, now);
        return "PENDING_APPROVAL";
      }
      approver = [...signed.map((x) => x.approver), args.approver].join(" + ");
    }
    db.prepare(
      `INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.proposal_id, args.decision, p.terms_sha256, approver, args.method, args.typedPrefix.trim().toLowerCase(), args.note ?? null, now.toISOString());
    transition(db, p.proposal_id, "PENDING_APPROVAL", args.decision);
    audit(db, "human", args.decision === "APPROVED" ? "proposal.approved" : "proposal.rejected", p.proposal_id,
      { terms_sha256: p.terms_sha256, approver, method: args.method, note: args.note ?? null, ...(passkey ? { passkey } : {}) }, now);
    return args.decision;
  }).immediate();
}

/**
 * The execution guard. In one transaction: the stored terms still hash to the approved hash, the
 * approval is unused, the proposal has not expired, and the caller's precondition check still holds.
 * Returns the terms; the executor must build every payload from these and nothing else.
 */
export function beginExecution<T extends Terms>(db: DB, proposalId: string, preconditions: (terms: T) => void = () => {}, now = new Date()): T {
  // Expiry is committed on its own, so the EXPIRED status survives the error thrown below.
  const expired = db.transaction(() => {
    const p = get(db, proposalId);
    return (p.status === "APPROVED" || p.status === "FAILED") && Date.parse(p.expires_at) <= now.getTime() ? (expireIfDue(db, p, now), p.expires_at) : null;
  }).immediate();
  if (expired) throw new Error(`${proposalId} expired at ${expired}; approval void`);
  return db.transaction((): T => {
    const p = get(db, proposalId);
    if (p.status !== "APPROVED" && p.status !== "FAILED") throw new Error(`${proposalId} is ${p.status}, not approved`);
    const terms = JSON.parse(p.terms_json) as T;
    const approval = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(proposalId) as
      { approved_sha256: string; decision: string } | undefined;
    const recomputed = termsHash(terms);
    if (!approval || approval.decision !== "APPROVED") throw new Error(`${proposalId} has no approval`);
    if (recomputed !== p.terms_sha256 || recomputed !== approval.approved_sha256) throw new Error(`${proposalId}: terms do not match the approved hash`);
    preconditions(terms);
    transition(db, proposalId, p.status, "EXECUTING");
    audit(db, "system", "proposal.executing", proposalId, { terms_sha256: recomputed }, now);
    return terms;
  }).immediate();
}

export function finishExecution(db: DB, proposalId: string, outcome: "EXECUTED" | "FAILED" | "NEEDS_REAPPROVAL", detail: Json = {}, now = new Date()): void {
  db.transaction(() => {
    transition(db, proposalId, "EXECUTING", outcome);
    audit(db, "system", `proposal.${outcome.toLowerCase()}`, proposalId, detail, now);
  }).immediate();
}

/** Marks every proposal whose time ran out as EXPIRED, so no list shows it as still waiting. */
export function expireDue(db: DB, now = new Date()): string[] {
  // Timestamps are compared as instants, not strings: "…00Z" and "…00.000Z" are the same moment.
  const due = (db.prepare("SELECT * FROM proposals WHERE status IN ('PENDING_APPROVAL', 'APPROVED')").all() as ProposalRow[])
    .filter((p) => Date.parse(p.expires_at) <= now.getTime());
  return db.transaction(() => due.filter((p) => expireIfDue(db, p, now)).map((p) => p.proposal_id)).immediate();
}
