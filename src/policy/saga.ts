// Money actions as an explicit state machine with a step log (backend review B2).
//
//   proposed → approved → executing (step n) → settled | failed | cancelled
//
// The first part is the proposal's own lifecycle (src/policy/approvals.ts). While it executes, each outside call is a
// step in money_steps: STARTED with its idempotency key before the call, DONE with the answer after it (an outbox).
// When the process dies, `resumeInterrupted` on the next start finds every action still EXECUTING and runs its
// executor again; the executor skips DONE steps and resolves a STARTED one by its key at the outside service (a
// conversion or transfer by its request_id, a Metal pull by its payment id), so nothing is ever done twice.

import { originJson } from "../provenance/origin.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { resuming } from "./approvals.js";

export type MoneyState = "proposed" | "approved" | "executing" | "settled" | "failed" | "cancelled";

/**
 * A point where a test may stop the process (chaos tests only; in a live run nothing is set and this does nothing).
 * The test sets `chaos.at` in its own worker process; the code never reads it from the environment or a request.
 */
export const chaos: { at: ((point: string) => void | Promise<void>) | null } = { at: null };
export async function checkpoint(point: string): Promise<void> {
  if (chaos.at) await chaos.at(point);
}

export function stepDone<T>(db: DB, actionId: string, step: string): T | null {
  const r = db.prepare("SELECT detail_json FROM money_steps WHERE action_id = ? AND step = ? AND status = 'DONE'").get(actionId, step) as { detail_json: string | null } | undefined;
  return r ? (JSON.parse(r.detail_json ?? "null") as T) : null;
}

export function startStep(db: DB, actionId: string, n: number, step: string, key: string, now = new Date()): void {
  db.prepare("INSERT INTO money_steps (action_id, n, step, key, status, updated_at, origin_json) VALUES (?, ?, ?, ?, 'STARTED', ?, ?) ON CONFLICT(action_id, step) DO NOTHING")
    .run(actionId, n, step, key, now.toISOString(), originJson());
}

export function finishStep(db: DB, actionId: string, step: string, detail: unknown, now = new Date()): void {
  db.prepare("UPDATE money_steps SET status = 'DONE', detail_json = ?, updated_at = ? WHERE action_id = ? AND step = ?").run(JSON.stringify(detail), now.toISOString(), actionId, step);
}

/**
 * Runs one step at most once: a DONE step returns what it recorded; otherwise the step is marked STARTED (with its
 * key) and `run` is called; on a retry (`retry` true) it must look the key up at the outside service before calling.
 */
export async function step<T>(db: DB, actionId: string, n: number, name: string, key: string, run: (retry: boolean) => Promise<T>, now = () => new Date(), final: (out: T) => boolean = () => true): Promise<T> {
  const done = stepDone<T>(db, actionId, name);
  if (done !== null) return done;
  // STARTED before this run: the call may have reached the outside service before the crash, so `run` looks first.
  const retry = !!db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = ?").get(actionId, name);
  startStep(db, actionId, n, name, key, now());
  await checkpoint(`${name}:before`);
  const out = await run(retry);
  await checkpoint(`${name}:after-call`);
  // An outcome that is not final (a refund refused for now) leaves the step open, so a later run tries it again.
  if (final(out)) finishStep(db, actionId, name, out, now());
  await checkpoint(`${name}:after`);
  return out;
}

const STATE: Record<string, MoneyState> = {
  PENDING_APPROVAL: "proposed", APPROVED: "approved", EXECUTING: "executing", EXECUTED: "settled", FAILED: "failed",
  REJECTED: "cancelled", EXPIRED: "cancelled", SUPERSEDED: "cancelled", NEEDS_REAPPROVAL: "cancelled",
};

/** Where a money action stands: its state, and while it executes the step it is on. */
export function moneyActionState(db: DB, proposalId: string): { state: MoneyState; step: { n: number; name: string; status: string } | null; steps: { n: number; name: string; status: string }[] } {
  const p = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId) as { status: string } | undefined;
  if (!p) throw new Error(`no proposal ${proposalId}`);
  const steps = (db.prepare("SELECT n, step AS name, status FROM money_steps WHERE action_id = ? ORDER BY n, step").all(proposalId) as { n: number; name: string; status: string }[]);
  const state = STATE[p.status] ?? "failed";
  const open = steps.find((s) => s.status === "STARTED") ?? steps.at(-1) ?? null;
  return { state, step: state === "executing" ? open : null, steps };
}

/**
 * On start: every action a crash left EXECUTING is run again by its executor, which resumes after its last DONE
 * step. Returns what happened to each, for the log.
 */
export async function resumeInterrupted(db: DB, run: (db: DB, proposalId: string) => Promise<void>, now = new Date()): Promise<{ id: string; outcome: string }[]> {
  const ids = (db.prepare("SELECT proposal_id FROM proposals WHERE status = 'EXECUTING' ORDER BY proposal_id").all() as { proposal_id: string }[]).map((r) => r.proposal_id);
  const out: { id: string; outcome: string }[] = [];
  for (const id of ids) {
    audit(db, "system", "proposal.resumed", id, { after: "a restart; the executor resumes after its last finished step" }, now);
    resuming.add(id);
    try {
      await run(db, id);
      out.push({ id, outcome: (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status });
    } catch (e) {
      out.push({ id, outcome: `error: ${(e as Error).message}` });
    } finally {
      resuming.delete(id);
    }
  }
  // Approved, but the process died before the executor began (dry-6: killed right after the CFO's Face ID). Its
  // executor starts it as usual, with every check it makes (hash, approval, expiry, quote): a late one runs nothing.
  const approved = (db.prepare("SELECT proposal_id FROM proposals WHERE status = 'APPROVED' ORDER BY proposal_id").all() as { proposal_id: string }[]).map((r) => r.proposal_id);
  for (const id of approved) {
    audit(db, "system", "proposal.resumed", id, { after: "a restart; approved, but its execution had not begun" }, now);
    try {
      await run(db, id);
      out.push({ id, outcome: (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status });
    } catch (e) {
      out.push({ id, outcome: `error: ${(e as Error).message}` });
    }
  }
  return out;
}
