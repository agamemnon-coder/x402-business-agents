// Mutation testing, 20 November (docs/evidence/mutation-testing.md, group saga): the gaps the mutants of the money-action
// state machine (src/policy/saga.ts) showed. The crash tests stop a worker process at each checkpoint (test/chaos-kill),
// whose code Stryker's mutants do not reach, so the step log itself had to be pinned here, in process. Breaks if a DONE
// step runs again or loses what it recorded, a step started before a crash is not run as a retry, a step whose outcome is
// not final is closed, a checkpoint is skipped or renamed, the state reported for a proposal changes, or a restart's resume
// misses an EXECUTING or APPROVED action, runs one twice, stops at the first error, or leaves an action marked resuming.
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, resuming } from "../src/policy/approvals.js";
import { chaos, checkpoint, finishStep, moneyActionState, resumeInterrupted, startStep, step, stepDone } from "../src/policy/saga.js";

const NOW = new Date("2026-11-20T10:00:00Z");
const steps = (db: DB, id = "P-0001") => db.prepare("SELECT n, step, key, status, detail_json FROM money_steps WHERE action_id = ? ORDER BY n").all(id);

function proposal(db: DB, id: string, status: string): void {
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z" } as Terms, createdBy: "treasury" }, NOW);
  db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(status, id);
}

afterEach(() => { chaos.at = null; resuming.clear(); });

describe("the step log", () => {
  it("records STARTED with its key before the call and DONE with the answer after it, and replays a DONE step without calling", async () => {
    const db = openDb(":memory:");
    const seen: string[] = [];
    chaos.at = (point) => { seen.push(point); };
    const calls: boolean[] = [];
    const out = await step(db, "P-0001", 2, "transfer", "rq-9", async (retry) => { calls.push(retry); expect(steps(db)).toEqual([{ n: 2, step: "transfer", key: "rq-9", status: "STARTED", detail_json: null }]); return { id: "t-1" }; }, () => NOW);
    expect(out).toEqual({ id: "t-1" });
    expect(calls).toEqual([false]);
    expect(seen).toEqual(["transfer:before", "transfer:after-call", "transfer:after"]);
    expect(steps(db)).toEqual([{ n: 2, step: "transfer", key: "rq-9", status: "DONE", detail_json: '{"id":"t-1"}' }]);
    expect(stepDone(db, "P-0001", "transfer")).toEqual({ id: "t-1" });
    const again = await step(db, "P-0001", 2, "transfer", "rq-9", async () => { calls.push(true); return { id: "t-2" }; });
    expect(again).toEqual({ id: "t-1" });
    expect(calls).toEqual([false]);
  });

  it("runs a step STARTED before a crash as a retry, without a second row, and closes it", async () => {
    const db = openDb(":memory:");
    startStep(db, "P-0001", 1, "conversion", "rq-c", NOW);
    startStep(db, "P-0001", 1, "conversion", "rq-other", NOW); // the same step again keeps its first key
    expect(steps(db)).toEqual([{ n: 1, step: "conversion", key: "rq-c", status: "STARTED", detail_json: null }]);
    expect(stepDone(db, "P-0001", "conversion")).toBeNull();
    const retries: boolean[] = [];
    await step(db, "P-0001", 1, "conversion", "rq-c", async (retry) => { retries.push(retry); return "adopted"; });
    expect(retries).toEqual([true]);
    expect(steps(db)).toEqual([{ n: 1, step: "conversion", key: "rq-c", status: "DONE", detail_json: '"adopted"' }]);
  });

  it("leaves a step whose outcome is not final open, so the next run tries it again", async () => {
    const db = openDb(":memory:");
    const out = await step(db, "P-0001", 1, "refund", "pay-1", async () => ({ refused: true }), () => NOW, (o) => !o.refused);
    expect(out).toEqual({ refused: true });
    expect(steps(db)).toEqual([{ n: 1, step: "refund", key: "pay-1", status: "STARTED", detail_json: null }]);
    const retries: boolean[] = [];
    await step(db, "P-0001", 1, "refund", "pay-1", async (retry) => { retries.push(retry); return { refused: false }; }, () => NOW, (o) => !o.refused);
    expect(retries).toEqual([true]);
    expect(stepDone(db, "P-0001", "refund")).toEqual({ refused: false });
  });

  it("a step DONE with nothing recorded reads as null detail; finishStep writes the time it is given", () => {
    const db = openDb(":memory:");
    startStep(db, "P-0001", 3, "settle", "t-1", NOW);
    db.prepare("UPDATE money_steps SET status = 'DONE' WHERE action_id = 'P-0001'").run();
    expect(stepDone(db, "P-0001", "settle")).toBeNull();
    finishStep(db, "P-0001", "settle", { status: "PAID" }, new Date("2026-11-20T10:05:00Z"));
    expect(db.prepare("SELECT updated_at, detail_json FROM money_steps").get()).toEqual({ updated_at: "2026-11-20T10:05:00.000Z", detail_json: '{"status":"PAID"}' });
    expect(stepDone(db, "P-0002", "settle")).toBeNull();
  });

  it("a checkpoint does nothing until a test sets one, then waits for it", async () => {
    await expect(checkpoint("x")).resolves.toBeUndefined();
    let waited = false;
    chaos.at = async () => { await new Promise((r) => setTimeout(r, 5)); waited = true; };
    await checkpoint("x");
    expect(waited).toBe(true);
  });
});

describe("where a money action stands", () => {
  it("maps every proposal status to its state, and names the open step only while executing", () => {
    const db = openDb(":memory:");
    const want: Record<string, string> = {
      PENDING_APPROVAL: "proposed", APPROVED: "approved", EXECUTING: "executing", EXECUTED: "settled", FAILED: "failed",
      REJECTED: "cancelled", EXPIRED: "cancelled", SUPERSEDED: "cancelled", NEEDS_REAPPROVAL: "cancelled",
    };
    let i = 0;
    for (const [status, state] of Object.entries(want)) {
      const id = `P-${String(++i).padStart(4, "0")}`;
      proposal(db, id, status);
      expect(moneyActionState(db, id)).toEqual({ state, step: null, steps: [] });
    }
    expect(() => moneyActionState(db, "P-0404")).toThrow("no proposal P-0404");
  });

  it("while executing: the STARTED step, else the last one; steps in order", () => {
    const db = openDb(":memory:");
    proposal(db, "P-0001", "EXECUTING");
    startStep(db, "P-0001", 1, "conversion", "a", NOW);
    finishStep(db, "P-0001", "conversion", {}, NOW);
    startStep(db, "P-0001", 2, "transfer", "b", NOW);
    expect(moneyActionState(db, "P-0001")).toEqual({
      state: "executing", step: { n: 2, name: "transfer", status: "STARTED" },
      steps: [{ n: 1, name: "conversion", status: "DONE" }, { n: 2, name: "transfer", status: "STARTED" }],
    });
    finishStep(db, "P-0001", "transfer", {}, NOW);
    expect(moneyActionState(db, "P-0001").step).toEqual({ n: 2, name: "transfer", status: "DONE" });
    db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = 'P-0001'").run();
    expect(moneyActionState(db, "P-0001")).toMatchObject({ state: "settled", step: null });
  });
});

describe("the resume after a restart", () => {
  it("runs every EXECUTING action marked as resuming, then every APPROVED one, each once, in order, and reports each outcome", async () => {
    const db = openDb(":memory:");
    proposal(db, "P-0003", "EXECUTING");
    proposal(db, "P-0001", "EXECUTING");
    proposal(db, "P-0002", "APPROVED");
    proposal(db, "P-0004", "FAILED");
    proposal(db, "P-0005", "PENDING_APPROVAL");
    const ran: { id: string; resuming: boolean }[] = [];
    const out = await resumeInterrupted(db, async (d, id) => {
      ran.push({ id, resuming: resuming.has(id) });
      if (id === "P-0001") throw new Error("Airwallex did not answer");
      d.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = ?").run(id);
    }, NOW);
    expect(ran).toEqual([{ id: "P-0001", resuming: true }, { id: "P-0003", resuming: true }, { id: "P-0002", resuming: false }]);
    expect(out).toEqual([{ id: "P-0001", outcome: "error: Airwallex did not answer" }, { id: "P-0003", outcome: "EXECUTED" }, { id: "P-0002", outcome: "EXECUTED" }]);
    expect(resuming.size).toBe(0);
    const audit = db.prepare("SELECT actor, subject, payload_json, ts FROM audit_log WHERE event = 'proposal.resumed' ORDER BY seq").all() as { actor: string; subject: string; payload_json: string; ts: string }[];
    expect(audit.map((a) => [a.actor, a.subject, JSON.parse(a.payload_json).after])).toEqual([
      ["system", "P-0001", "a restart; the executor resumes after its last finished step"],
      ["system", "P-0003", "a restart; the executor resumes after its last finished step"],
      ["system", "P-0002", "a restart; approved, but its execution had not begun"],
    ]);
    expect(audit.every((a) => a.ts === NOW.toISOString())).toBe(true);
  });

  it("reports an approved action whose run fails, and goes on to the next", async () => {
    const db = openDb(":memory:");
    proposal(db, "P-0001", "APPROVED");
    proposal(db, "P-0002", "APPROVED");
    const out = await resumeInterrupted(db, async (d, id) => {
      if (id === "P-0001") throw new Error("quote expired");
      d.prepare("UPDATE proposals SET status = 'FAILED' WHERE proposal_id = ?").run(id);
    }, NOW);
    expect(out).toEqual([{ id: "P-0001", outcome: "error: quote expired" }, { id: "P-0002", outcome: "FAILED" }]);
  });

  it("does nothing, and records nothing, when no action was interrupted", async () => {
    const db = openDb(":memory:");
    proposal(db, "P-0001", "EXECUTED");
    expect(await resumeInterrupted(db, async () => { throw new Error("must not run"); }, NOW)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.resumed'").get()).toEqual({ n: 0 });
  });
});
