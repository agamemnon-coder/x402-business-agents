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
import { procOf } from "../ops/processes.js";

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
  /** Planned refunds code could not pay (limits no longer fit, or refused for good), handed to the CFO as one proposal. */
  handover: number[];
  handover_proposal: string | null;
  /** Looks at each refund held at Metal, by sale number. */
  held_looks: Record<string, number>;
  /** Held at Metal through HANDOVER_AFTER looks: sent, unconfirmed. Never counted as refunded. */
  sent: number[];
  done_at: string | null;
}

interface Row { dispute_id: string; plan_json: string; decided_at: string; status: "DECIDED" | "DONE"; paid_json: string; escalation_proposal: string | null; approval_proposal: string | null; last_note: string | null; audited: number; attempts: number; attempted_at: string | null; handover_json: string; handover_proposal: string | null; held_json: string; sent_json: string; done_at: string | null }

export function decisionOf(db: DB, disputeId: string): DisputeDecision | null {
  const r = db.prepare("SELECT * FROM dispute_decisions WHERE dispute_id = ?").get(disputeId) as Row | undefined;
  if (!r) return null;
  const plan = JSON.parse(r.plan_json) as DecisionPlan;
  for (const x of [...plan.refunds, plan.escalate, plan.approval]) if (x) x.origin = parseOrigin(JSON.stringify(x.origin));
  return { dispute_id: r.dispute_id, plan, decided_at: r.decided_at, status: r.status, paid: JSON.parse(r.paid_json) as number[], escalation_proposal: r.escalation_proposal, approval_proposal: r.approval_proposal, last_note: r.last_note, audited: r.audited === 1, attempts: r.attempts, attempted_at: r.attempted_at, handover: JSON.parse(r.handover_json) as number[], handover_proposal: r.handover_proposal, held_looks: JSON.parse(r.held_json) as Record<string, number>, sent: JSON.parse(r.sent_json) as number[], done_at: r.done_at };
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
  const unpaid = p.refunds.map((r) => r.seq).filter((s) => !d.paid.includes(s) && !d.handover.includes(s) && !d.sent.includes(s));
  const parts = [
    `decided by ${who} at ${d.decided_at}`,
    `refund ${list(p.refunds.map((r) => r.seq))} (${fromCents(p.refunds.reduce((n, r) => n + r.cents, 0))})${p.refunds.length ? `, paid ${list(d.paid)}${unpaid.length ? `, still to pay ${list(unpaid)}` : ""}` : ""}`,
  ];
  if (p.approval) parts.push(`${list(p.approval.seqs)} above the automatic limits to the CFO as ${d.approval_proposal ?? "a proposal not yet made"}`);
  if (p.escalate) parts.push(`${list(p.escalate.seqs)} to the CFO as ${d.escalation_proposal ?? "a proposal not yet made"}`);
  if (d.sent.length) parts.push(`${list(d.sent)} sent but still held at Metal: unconfirmed, not refunded yet (followed on /health and by the reconciliation)`);
  if (d.handover.length) parts.push(`${list(d.handover)} could not be paid automatically and go${d.handover_proposal ? "" : " (once nothing else is pending)"} to the CFO as ${d.handover_proposal ?? "a proposal not yet made"}`);
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
export type Part = "escalate" | "approval" | "handover";

export interface DecisionExec {
  /** Refunds one sale of the dispute to the customer (keyed by the sale: a second call reports the first outcome). */
  /** retry: look again at a refund already sent and held at Metal (the same payment id; nothing is sent twice). */
  refund(seq: number, opts?: { retry?: boolean }): Promise<{ outcome: string; tx?: string | null; already?: boolean; reason?: string | null }>;
  /** The refund's state in the ledger (PROPOSED, PENDING, PAID, HELD, REFUSED), or null when it has none. */
  state?(seq: number): string | null;
  /** The proposal for this part already in the ledger (made before a crash cut off noting it here), or null. */
  existing(part: Part): string | null;
  /**
   * Makes the proposal for this part in the ledger, synchronously: it runs in one write transaction with the look-up
   * above and the note in the decision, so two processes carrying out the same decision cannot both make one.
   */
  create?(part: Part, seqs: number[], text: string, source: DecisionPlan["source"]): string;
  /** The review that goes with the proposal (Opus, advisory); run again after a crash if the proposal has none. */
  review?(part: Part, proposalId: string, seqs: number[], text: string, source: DecisionPlan["source"]): Promise<void>;
  /** Whether this part's proposal has the review it needs (a part that takes no review answers true). */
  reviewed?(part: Part, proposalId: string): boolean;
  /** The automatic refund limits as they stand now, and what this dispute has refunded or has in flight besides one sale. */
  limits?(): { eachCents: number; perDisputeCents: number };
  refundedCents?(exceptSeq: number): number;
  /** Without create: makes the proposal asynchronously (stand-ins in tests and the sim, one process only). */
  propose?(part: Part, seqs: number[], text: string, source: DecisionPlan["source"]): Promise<string>;
}

// PAID is done. A HELD refund (sent, held at Metal) is looked at again with the same payment id, once per carry-out;
// after HANDOVER_AFTER looks at THAT refund it is "sent, unconfirmed": the decision stops pulling it (as the CFO's refund
// batch stops at HELD, src/executors/refundBatch.ts), never reports it as refunded, and /health and the reconciliation
// keep following it until Metal settles or refuses it.
const FINAL = new Set(["PAID"]);
/**
 * A refusal that a later try can clear (a speed limit, the network, a server error); any other refusal hands the
 * refund to the CFO. A CFO freeze or pause (frozen_by_cfo, paused_by_cfo) counts as lasting on purpose: the refund then
 * waits for the CFO as a proposal, the CFO's own decision, rather than being paid by code once the freeze lifts.
 */
const TRANSIENT = /velocity|in a minute|in an hour|speed|timeout|timed out|network|ECONN|ETIMEDOUT|fetch failed|(?:HTTP|status)\s*5\d\d\b|\b5\d\d (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i;
/** D24: when a refund cannot be paid automatically, code's own rule sends it to the CFO. */
export const CODE_HANDS_OVER: Origin = { actor: "code", rule: "carrying out a dispute decision: a refund code cannot pay automatically goes to the CFO", agent: "support" };
/** After this many carry-outs a refund still refused goes to the CFO whatever the reason. */
export const HANDOVER_AFTER = 3;

/**
 * Carries out the dispute's recorded decision as far as it can: pays each planned refund not yet paid (under the origin
 * of whoever decided it), makes each planned proposal the ledger does not have yet, and marks the decision DONE when
 * all of it is done. Safe to call any number of times, from any process: it never decides anything.
 */
/** Who carries a decision out: this process, and how to tell whether another carrier still lives. */
export interface Carrier { pid: number; start: string; alive(pid: number, start: string): boolean }
// The claim names a process by pid and start time from /proc (Linux, where the runners run). Without /proc the start time
// is empty and another live carrier is not recognised: there, refunds still rely on their own keys (refund-<sale>).
const thisProcess = (): Carrier => ({
  pid: process.pid, start: procOf(process.pid)?.start ?? "",
  // Another process that still runs (same pid and start time, not a zombie). This process's own earlier call never blocks it.
  alive: (pid, start) => pid !== process.pid && ((p) => !!p && p.start === start && !p.state.startsWith("Z"))(procOf(pid)),
});

export async function carryOut(db: DB, disputeId: string, exec: DecisionExec, log: (line: string) => void = () => undefined, me: Carrier = thisProcess()): Promise<DisputeDecision | null> {
  // One carrier at a time: the runner's resume, s2 run by hand, the Support agent's tool. A crashed carrier is gone, so
  // its claim lapses at once; nothing is paid by two processes side by side.
  const claim = db.transaction(() => {
    const cur = decisionOf(db, disputeId);
    if (!cur || cur.status === "DONE") return { d: cur, busy: null as string | null };
    const held = (db.prepare("SELECT carrier FROM dispute_decisions WHERE dispute_id = ?").get(disputeId) as { carrier: string | null }).carrier;
    const other = held ? (JSON.parse(held) as { pid: number; start: string }) : null;
    if (other && !(other.pid === me.pid && other.start === me.start) && me.alive(other.pid, other.start)) return { d: cur, busy: `pid ${other.pid}` };
    db.prepare("UPDATE dispute_decisions SET carrier = ?, attempts = attempts + 1, attempted_at = ? WHERE dispute_id = ?").run(JSON.stringify({ pid: me.pid, start: me.start }), new Date().toISOString(), disputeId);
    return { d: cur, busy: null };
  }).immediate();
  if (!claim.d || claim.d.status === "DONE") return claim.d;
  if (claim.busy) {
    log(`dispute ${disputeId}'s decision is being carried out by ${claim.busy}; left to it`);
    return claim.d;
  }
  try {
    return await carryOutClaimed(db, disputeId, claim.d, exec, log);
  } finally {
    db.prepare("UPDATE dispute_decisions SET carrier = NULL WHERE dispute_id = ? AND carrier = ?").run(disputeId, JSON.stringify({ pid: me.pid, start: me.start }));
  }
}

async function carryOutClaimed(db: DB, disputeId: string, d: DisputeDecision, exec: DecisionExec, log: (line: string) => void): Promise<DisputeDecision | null> {
  const attempt = d.attempts + 1;
  const notes: string[] = [];
  const now0 = () => decisionOf(db, disputeId)!;
  // Each added in place (another process may be carrying out the same decision): never written from a stale copy.
  const add = (column: "paid_json" | "handover_json" | "sent_json", seq: number) =>
    db.prepare(`UPDATE dispute_decisions SET ${column} = json_insert(${column}, '$[#]', ?) WHERE dispute_id = ? AND NOT EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ?)`).run(seq, disputeId, seq);
  const handOver = (seq: number, why: string) => {
    add("handover_json", seq);
    notes.push(`refund #${seq} goes to the CFO: ${why}`);
    log(`refund #${seq} is not paid automatically (${why}); it goes to the CFO as a proposal`);
  };
  for (const r of d.plan.refunds) {
    const cur = now0();
    if (cur.paid.includes(r.seq) || cur.handover.includes(r.seq) || cur.sent.includes(r.seq)) continue;
    // The automatic limits as they stand now: a refund decided under looser limits is never paid around tighter ones.
    const lim = exec.limits?.();
    // A refund already sent (PENDING) or held is not judged again: its pull may still settle, and refundSale checks it.
    const state = exec.state?.(r.seq) ?? null;
    const inFlight = state === "PENDING" || state === "HELD";
    if (lim && !inFlight) {
      const other = exec.refundedCents?.(r.seq) ?? 0;
      if (r.cents > lim.eachCents || other + r.cents > lim.perDisputeCents) {
        handOver(r.seq, `no longer within the automatic limits (${fromCents(lim.eachCents)} each, ${fromCents(lim.perDisputeCents)} per dispute; ${fromCents(other)} refunded besides)`);
        continue;
      }
    }
    try {
      const opts = state === "HELD" ? { retry: true } : undefined;
      const res = await (r.origin ? withOrigin(r.origin, () => exec.refund(r.seq, opts)) : exec.refund(r.seq, opts));
      if (FINAL.has(res.outcome)) {
        add("paid_json", r.seq);
        log(`refund #${r.seq}: ${res.already ? "already paid earlier, nothing sent" : res.outcome}${res.tx ? ` ${res.tx}` : ""}`);
      } else if (res.outcome === "HELD") {
        // Looks at THIS refund held at Metal, counted in place.
        db.prepare("UPDATE dispute_decisions SET held_json = json_set(held_json, ?, COALESCE(json_extract(held_json, ?), 0) + 1) WHERE dispute_id = ?").run(`$."${r.seq}"`, `$."${r.seq}"`, disputeId);
        const looks = now0().held_looks[String(r.seq)] ?? 1;
        if (looks >= HANDOVER_AFTER) {
          add("sent_json", r.seq);
          notes.push(`refund #${r.seq} sent, still held at Metal after ${looks} looks: unconfirmed`);
          log(`refund #${r.seq}: sent, still held at Metal after ${looks} looks; unconfirmed, not reported as refunded (followed on /health)`);
        } else {
          notes.push(`refund #${r.seq} held at Metal (look ${looks})`);
          log(`refund #${r.seq}: held at Metal (look ${looks}); looked at again when the decision is carried out again`);
        }
      } else if (res.outcome === "REFUSED" && (!TRANSIENT.test(res.reason ?? "") || attempt >= HANDOVER_AFTER)) {
        handOver(r.seq, `refused${res.reason ? `: ${res.reason}` : ""}${attempt >= HANDOVER_AFTER ? ` (try ${attempt})` : ""}`);
      } else {
        notes.push(`refund #${r.seq} ${res.outcome}${res.reason ? `: ${res.reason}` : ""}`);
        log(`refund #${r.seq}: ${res.outcome}${res.reason ? ` (${res.reason})` : ""}; tried again when the decision is carried out again (at most every half hour)`);
      }
    } catch (e) {
      notes.push(`refund #${r.seq}: ${(e as Error).message.slice(0, 160)}`);
      log(`refund #${r.seq} failed: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  // Refunds handed over go to the CFO as one proposal, once every other refund is paid (nothing still pending).
  const mid = now0();
  const handover: PlannedProposal | null = mid.handover.length && d.plan.refunds.every((r) => mid.paid.includes(r.seq) || mid.handover.includes(r.seq) || mid.sent.includes(r.seq))
    ? { seqs: [...mid.handover].sort((a, b) => a - b), text: notes.filter((n) => n.includes("goes to the CFO")).join("; ") || "the automatic refunds could not be paid", origin: CODE_HANDS_OVER }
    : null;
  for (const part of ["approval", "escalate", "handover"] as const) {
    const p = part === "handover" ? (mid.handover_proposal ? null : handover) : d.plan[part];
    const column = part === "escalate" ? "escalation_proposal" : part === "approval" ? "approval_proposal" : "handover_proposal";
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
  const reviewed = (part: Part, id: string) => !exec.review || !exec.reviewed || exec.reviewed(part, id);
  const done = now.plan.refunds.every((r) => now.paid.includes(r.seq) || now.handover.includes(r.seq) || now.sent.includes(r.seq))
    && (!now.handover.length || !!now.handover_proposal)
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

/**
 * Disputes settled before decisions were recorded whose refunds were left unfinished (proposed, pending or refused):
 * they are never decided again, so a person must see them (/health).
 */
export function legacyUnfinished(db: DB): { dispute_id: string; refunds: string[] }[] {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dispute_decisions'").get();
  if (!has) return [];
  const rows = db.prepare("SELECT r.dispute_id, r.sale_id, r.outcome FROM refunds r WHERE r.dispute_id IS NOT NULL AND r.outcome IN ('PROPOSED', 'PENDING', 'REFUSED') AND NOT EXISTS (SELECT 1 FROM dispute_decisions d WHERE d.dispute_id = r.dispute_id) ORDER BY r.dispute_id, r.sale_id").all() as { dispute_id: string; sale_id: number; outcome: string }[];
  const out = new Map<string, string[]>();
  for (const r of rows) if (legacyDecision(db, r.dispute_id)) out.set(r.dispute_id, [...(out.get(r.dispute_id) ?? []), `sale ${r.sale_id} ${r.outcome}`]);
  return [...out].map(([dispute_id, refunds]) => ({ dispute_id, refunds }));
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
      // Sent but held at Metal: not refunded until Metal settles it.
      ...(d.sent.length ? { sent_unconfirmed: d.sent.map((s) => `#${s}`) } : {}),
      decided: p.refunds.map((r) => `#${r.seq}`),
      escalated: p.escalate ? { proposal: d.escalation_proposal, sales: p.escalate.seqs.map((s) => `#${s}`) } : null,
      said: (p.said ?? "").slice(0, 1200), ...(p.agent_note ? { note: p.agent_note } : {}),
    });
    db.prepare("UPDATE dispute_decisions SET audited = 1 WHERE dispute_id = ?").run(disputeId);
  }).immediate();
}
