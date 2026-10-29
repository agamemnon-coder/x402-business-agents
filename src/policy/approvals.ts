// Proposal -> approval -> execution (build plan 2.3). A person approves the hash of the exact terms;
// the executor runs only if the stored terms still hash to what was approved, once.

import type { Json } from "@metalntwx/metal-pay/mandates";
import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { prefixMatches, termsHash, type Terms } from "../lib/terms.js";

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

export type Decision = "APPROVED" | "REJECTED";

/** The approver types the first 8 hex characters of the hash they saw. A wrong prefix records nothing. */
export function decide(
  db: DB,
  args: { proposalId: string; decision: Decision; typedPrefix: string; approver: string; method: "web" | "cli" | "telegram"; note?: string },
  now = new Date(),
): ProposalStatus {
  return db.transaction((): ProposalStatus => {
    const p = get(db, args.proposalId);
    if (p.status !== "PENDING_APPROVAL") throw new Error(`${p.proposal_id} is ${p.status}, not waiting for approval`);
    if (expireIfDue(db, p, now)) return "EXPIRED";
    if (!prefixMatches(p.terms_sha256, args.typedPrefix)) throw new Error("typed prefix does not match the terms hash");
    db.prepare(
      `INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.proposal_id, args.decision, p.terms_sha256, args.approver, args.method, args.typedPrefix.trim().toLowerCase(), args.note ?? null, now.toISOString());
    transition(db, p.proposal_id, "PENDING_APPROVAL", args.decision);
    audit(db, "human", args.decision === "APPROVED" ? "proposal.approved" : "proposal.rejected", p.proposal_id,
      { terms_sha256: p.terms_sha256, approver: args.approver, method: args.method, note: args.note ?? null }, now);
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
