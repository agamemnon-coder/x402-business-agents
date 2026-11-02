// A dispute is decided once, also after a restart (agent run 1: after a container restart the Support agent decided
// the same dispute a second time; only the refunds' own idempotency kept the money right).
//
// The decision (which sales are refunded within the automatic limits, which go to the CFO) is written to
// dispute_decisions before anything is paid or proposed. Carrying it out is a separate step that may be cut off at any
// point; running it again pays only the refunds of THAT decision not yet paid (each refund is keyed by its sale, so a
// refund already sent is reported, never sent twice) and makes each proposal only if the ledger has none yet. Whoever
// comes to the dispute later (the agent's tool after a restart, s2 run again) finds the decision and gets "already
// decided" with its summary: nothing is decided again.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { parseOrigin, withOrigin, type Origin } from "../provenance/origin.js";

export interface PlannedRefund { seq: number; cents: number; origin: Origin | null }
export interface PlannedProposal { seqs: number[]; text: string; origin: Origin | null }

export interface DecisionPlan {
  source: "claude" | "code";
  /** The Claude model that decided, or null for code. */
  model: string | null;
  /** Refunds within the CFO's automatic limits, paid without a person. */
  refunds: PlannedRefund[];
  /** The sales the customer wants refunded beyond that ("the rest"), as one proposal for the CFO; text: the advice. */
  escalate: PlannedProposal | null;
  /** Code only: refunds the evidence supports but above the automatic limits, as one proposal; text: the reason. */
  approval: PlannedProposal | null;
  /** What the agent said, or, when code decided after the agent ran, why the agent's run did not count. */
  said?: string;
  agent_note?: string;
  /** The agent ran (Claude or not): its run is recorded once as dispute.settled_by_agent. */
  agent_ran?: boolean;
  /** Refunds of this dispute paid before this decision (an older run), carried in its record. */
  earlier?: number[];
}

export interface DisputeDecision {
  dispute_id: string;
  plan: DecisionPlan;
  decided_at: string;
  status: "DECIDED" | "DONE";
  /** The planned refunds already paid (by sale number). */
  paid: number[];
  escalation_proposal: string | null;
  approval_proposal: string | null;
  last_note: string | null;
  audited: boolean;
  /** How often it was carried out, and when last: a refund refused at payment is tried again at most every half hour. */
  attempts: number;
  attempted_at: string | null;
  done_at: string | null;
}

interface Row { dispute_id: string; plan_json: string; decided_at: string; status: "DECIDED" | "DONE"; paid_json: string; escalation_proposal: string | null; approval_proposal: string | null; last_note: string | null; audited: number; attempts: number; attempted_at: string | null; done_at: string | null }

export function decisionOf(db: DB, disputeId: string): DisputeDecision | null {
  const r = db.prepare("SELECT * FROM dispute_decisions WHERE dispute_id = ?").get(disputeId) as Row | undefined;
  if (!r) return null;
  const plan = JSON.parse(r.plan_json) as DecisionPlan;
  for (const x of [...plan.refunds, plan.escalate, plan.approval]) if (x) x.origin = parseOrigin(JSON.stringify(x.origin));
  return { dispute_id: r.dispute_id, plan, decided_at: r.decided_at, status: r.status, paid: JSON.parse(r.paid_json) as number[], escalation_proposal: r.escalation_proposal, approval_proposal: r.approval_proposal, last_note: r.last_note, audited: r.audited === 1, attempts: r.attempts, attempted_at: r.attempted_at, done_at: r.done_at };
}

/**
 * A dispute decided before decisions were recorded: the agent's settlement row, code's automatic refund, or a refund
 * proposal for the CFO (pending or decided) for this dispute. Returns what it found, or null.
 */
export function legacyDecision(db: DB, disputeId: string): string | null {
  const settled = db.prepare("SELECT ts FROM audit_log WHERE event = 'dispute.settled_by_agent' AND subject = ? ORDER BY seq LIMIT 1").get(disputeId) as { ts: string } | undefined;
  if (settled) return `settled by the Support agent's run at ${settled.ts}`;
  const auto = db.prepare("SELECT ts FROM audit_log WHERE event = 'refund.auto_approved' AND subject = ? ORDER BY seq LIMIT 1").get(disputeId) as { ts: string } | undefined;
  if (auto) return `code refunded within the automatic limits at ${auto.ts}`;
  const props = db.prepare("SELECT proposal_id, status FROM proposals WHERE kind = 'refund_batch' AND json_extract(terms_json, '$.dispute_id') = ? ORDER BY created_at").all(disputeId) as { proposal_id: string; status: string }[];
  if (props.length) return `sent to the CFO as ${props.map((p) => `${p.proposal_id} (${p.status})`).join(", ")}`;
  return null;
}

const list = (seqs: number[]) => seqs.map((s) => `#${s}`).join(", ") || "none";

/** One line for a person or the agent: who decided, what, what is paid, which proposal. */
export function decisionSummary(d: DisputeDecision): string {
  const p = d.plan;
  const who = p.source === "claude" ? `the Support agent (${p.model ?? "Claude"})` : "code";
  const unpaid = p.refunds.map((r) => r.seq).filter((s) => !d.paid.includes(s));
  const parts = [
    `decided by ${who} at ${d.decided_at}`,
    `refund ${list(p.refunds.map((r) => r.seq))} (${fromCents(p.refunds.reduce((n, r) => n + r.cents, 0))})${p.refunds.length ? `, paid ${list(d.paid)}${unpaid.length ? `, still to pay ${list(unpaid)}` : ""}` : ""}`,
  ];
  if (p.approval) parts.push(`${list(p.approval.seqs)} above the automatic limits to the CFO as ${d.approval_proposal ?? "a proposal not yet made"}`);
  if (p.escalate) parts.push(`${list(p.escalate.seqs)} to the CFO as ${d.escalation_proposal ?? "a proposal not yet made"}`);
  parts.push(d.status === "DONE" ? "carried out" : `not yet carried out${d.last_note ? ` (${d.last_note})` : ""}`);
  return parts.join("; ");
}

export interface DecisionAudit { actor: "support"; event: string; payload: Record<string, unknown> }

/**
 * Records the decision, once. If the dispute already has one (another process got there first, or this is a rerun),
 * nothing is written and that decision is returned with fresh = false. The audit rows given (code's automatic-refund
 * rule, the decision itself) are written in the same transaction as the decision, so a crash leaves both or neither.
 */
export function recordDecision(db: DB, disputeId: string, plan: DecisionPlan, audits: DecisionAudit[] = [], now = new Date()): { decision: DisputeDecision; fresh: boolean } {
  const tx = db.transaction(() => {
    const before = decisionOf(db, disputeId);
    if (before) return { decision: before, fresh: false };
    db.prepare("INSERT INTO dispute_decisions (dispute_id, source, plan_json, decided_at, status) VALUES (?, ?, ?, ?, 'DECIDED')").run(disputeId, plan.source, JSON.stringify(plan), now.toISOString());
    audit(db, "support", "dispute.decision_recorded", disputeId, {
      source: plan.source, model: plan.model, refunds: plan.refunds.map((r) => `#${r.seq}`), escalate: plan.escalate ? plan.escalate.seqs.map((s) => `#${s}`) : null,
      approval: plan.approval ? plan.approval.seqs.map((s) => `#${s}`) : null,
    }, now);
    for (const a of audits) audit(db, a.actor, a.event, disputeId, a.payload as never, now);
    return { decision: decisionOf(db, disputeId)!, fresh: true };
  });
  return tx.immediate();
}

/** What carrying out a decision needs from the world; the caller passes the live rails or stand-ins. */
export interface DecisionExec {
  /** Refunds one sale of the dispute to the customer (keyed by the sale: a second call reports the first outcome). */
  refund(seq: number): Promise<{ outcome: string; tx?: string | null; already?: boolean; reason?: string | null }>;
  /** The proposal for this part already in the ledger (made before a crash cut off noting it here), or null. */
  existing(part: "escalate" | "approval"): string | null;
  /**
   * Makes the proposal for this part in the ledger, synchronously: it runs in one write transaction with the look-up
   * above and the note in the decision, so two processes carrying out the same decision cannot both make one.
   */
  create?(part: "escalate" | "approval", seqs: number[], text: string, source: DecisionPlan["source"]): string;
  /** The review that goes with the proposal (Opus, advisory); run again after a crash if the proposal has none. */
  review?(part: "escalate" | "approval", proposalId: string, seqs: number[], text: string, source: DecisionPlan["source"]): Promise<void>;
  /** Whether this part's proposal has the review it needs (a part that takes no review answers true). */
  reviewed?(part: "escalate" | "approval", proposalId: string): boolean;
  /** Without create: makes the proposal asynchronously (stand-ins in tests and the sim, one process only). */
  propose?(part: "escalate" | "approval", seqs: number[], text: string, source: DecisionPlan["source"]): Promise<string>;
}

const FINAL = new Set(["PAID", "HELD"]);

/**
 * Carries out the dispute's recorded decision as far as it can: pays each planned refund not yet paid (under the origin
 * of whoever decided it), makes each planned proposal the ledger does not have yet, and marks the decision DONE when
 * all of it is done. Safe to call any number of times, from any process: it never decides anything.
 */
export async function carryOut(db: DB, disputeId: string, exec: DecisionExec, log: (line: string) => void = () => undefined): Promise<DisputeDecision | null> {
  const d = decisionOf(db, disputeId);
  if (!d || d.status === "DONE") return d;
  db.prepare("UPDATE dispute_decisions SET attempts = attempts + 1, attempted_at = ? WHERE dispute_id = ?").run(new Date().toISOString(), disputeId);
  const notes: string[] = [];
  const paidNow = () => decisionOf(db, disputeId)!.paid;
  for (const r of d.plan.refunds) {
    if (paidNow().includes(r.seq)) continue;
    try {
      const res = await (r.origin ? withOrigin(r.origin, () => exec.refund(r.seq)) : exec.refund(r.seq));
      if (FINAL.has(res.outcome)) {
        // Added in place (another process may be carrying out the same decision): never written from a stale copy.
        db.prepare("UPDATE dispute_decisions SET paid_json = json_insert(paid_json, '$[#]', ?) WHERE dispute_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(paid_json) WHERE value = ?)").run(r.seq, disputeId, r.seq);
        log(`refund #${r.seq}: ${res.already ? "already paid earlier, nothing sent" : res.outcome}${res.tx ? ` ${res.tx}` : ""}`);
      } else {
        notes.push(`refund #${r.seq} ${res.outcome}${res.reason ? `: ${res.reason}` : ""}`);
        log(`refund #${r.seq}: ${res.outcome}${res.reason ? ` (${res.reason})` : ""}; tried again when the decision is carried out again (at most every half hour)`);
      }
    } catch (e) {
      notes.push(`refund #${r.seq}: ${(e as Error).message.slice(0, 160)}`);
      log(`refund #${r.seq} failed: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  for (const part of ["approval", "escalate"] as const) {
    const p = d.plan[part];
    const column = part === "escalate" ? "escalation_proposal" : "approval_proposal";
    if (!p) continue;
    const run = <T>(fn: () => T): T => (p.origin ? withOrigin(p.origin, fn) : fn());
    try {
      let id: string | null;
      let made = false;
      if (exec.create) {
        // One write transaction: the note in the decision, the ledger's look-up, and the proposal itself.
        ({ id, made } = db.transaction(() => {
          const noted = (db.prepare(`SELECT ${column} AS id FROM dispute_decisions WHERE dispute_id = ?`).get(disputeId) as { id: string | null }).id;
          if (noted) return { id: noted, made: false };
          const found = exec.existing(part);
          const pid = found ?? run(() => exec.create!(part, p.seqs, p.text, d.plan.source));
          db.prepare(`UPDATE dispute_decisions SET ${column} = ? WHERE dispute_id = ?`).run(pid, disputeId);
          return { id: pid, made: !found };
        }).immediate());
      } else {
        id = decisionOf(db, disputeId)![column];
        if (!id) {
          const found = exec.existing(part);
          id = found ?? await run(() => exec.propose!(part, p.seqs, p.text, d.plan.source));
          made = !found;
          db.prepare(`UPDATE dispute_decisions SET ${column} = ? WHERE dispute_id = ?`).run(id, disputeId);
        }
      }
      if (made) log(`${list(p.seqs)} to the CFO as ${id}`);
      // A proposal a crash left without its review gets it now; the review never changes the terms.
      if (id && exec.review && (made || !exec.reviewed?.(part, id))) await run(() => exec.review!(part, id!, p.seqs, p.text, d.plan.source));
    } catch (e) {
      notes.push(`proposal for ${list(p.seqs)}: ${(e as Error).message.slice(0, 160)}`);
      log(`the proposal for ${list(p.seqs)} failed: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  const now = decisionOf(db, disputeId)!;
  const reviewed = (part: "escalate" | "approval", id: string) => !exec.review || !exec.reviewed || exec.reviewed(part, id);
  const done = now.plan.refunds.every((r) => now.paid.includes(r.seq))
    && (!now.plan.escalate || (!!now.escalation_proposal && reviewed("escalate", now.escalation_proposal)))
    && (!now.plan.approval || (!!now.approval_proposal && reviewed("approval", now.approval_proposal)));
  db.prepare("UPDATE dispute_decisions SET status = ?, last_note = ?, done_at = ? WHERE dispute_id = ? AND status = 'DECIDED'")
    .run(done ? "DONE" : "DECIDED", notes.length ? notes.join("; ").slice(0, 600) : null, done ? new Date().toISOString() : null, disputeId);
  return decisionOf(db, disputeId);
}

/** Decisions not yet carried out (a restart cut them off, or a refund was refused): for the runner's start and /health. */
export function openDecisions(db: DB): DisputeDecision[] {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dispute_decisions'").get();
  if (!has) return [];
  return (db.prepare("SELECT dispute_id FROM dispute_decisions WHERE status = 'DECIDED' OR (audited = 0 AND json_extract(plan_json, '$.agent_ran') = 1)").all() as { dispute_id: string }[])
    .map((r) => decisionOf(db, r.dispute_id)!);
}

/** Carried out completely: everything paid and proposed, and the agent's settlement row written if its run took part. */
export const finished = (d: DisputeDecision) => d.status === "DONE" && (d.audited || !d.plan.agent_ran);

/**
 * The Support agent's settlement row (dispute.settled_by_agent), written once per decision the agent's run took part
 * in, after the decision was carried out the first time (so it names the CFO's proposal). The row and the flag that
 * says it was written go in one transaction: a restart writes it if it is missing, never twice.
 */
export function auditSettlement(db: DB, disputeId: string): void {
  db.transaction(() => {
    const d = decisionOf(db, disputeId);
    if (!d || d.audited || !d.plan.agent_ran) return;
    const p = d.plan;
    const earlier = p.earlier ?? [];
    audit(db, "support", "dispute.settled_by_agent", disputeId, {
      source: p.source === "claude" ? "claude" : "fallback", model: p.model,
      // refunded_now: this decision's refunds that were paid; `refunded` also carries the dispute's earlier ones;
      // decided: every refund the decision holds (one a refusal held back is paid when it is carried out again).
      refunded: [...earlier, ...d.paid].map((s) => `#${s}`), refunded_now: d.paid.map((s) => `#${s}`),
      decided: p.refunds.map((r) => `#${r.seq}`),
      escalated: p.escalate ? { proposal: d.escalation_proposal, sales: p.escalate.seqs.map((s) => `#${s}`) } : null,
      said: (p.said ?? "").slice(0, 1200), ...(p.agent_note ? { note: p.agent_note } : {}),
    });
    db.prepare("UPDATE dispute_decisions SET audited = 1 WHERE dispute_id = ?").run(disputeId);
  }).immediate();
}
