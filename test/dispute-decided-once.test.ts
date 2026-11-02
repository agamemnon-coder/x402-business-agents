// A dispute is decided once, also after a restart (agent run 1: after a container restart the Support agent decided
// the same dispute again; two dispute.settled_by_agent rows, and only the refunds' own idempotency kept the money
// right). Here a "process" is a connection to a ledger file in a temp dir; a crash is a call that never returns (the
// old process's work never continues), and the restart is a new connection that runs the settlement again. Each run
// must end with exactly one decision, each refund paid once, the CFO's proposal made once. Fake client only.
import type Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { carryOut, decisionOf, recordDecision } from "../src/agents/disputeDecision.js";
import { settleDispute, type SupportDeps } from "../src/agents/supportAgent.js";
import { publish } from "../src/autonomy/bus.js";
import { supportProfile } from "../src/autonomy/teamProfiles.js";
import { wake } from "../src/autonomy/runtime.js";
import { openDb, type DB } from "../src/db/open.js";
import { health } from "../src/ops/health.js";
import { currentOrigin, type Origin } from "../src/provenance/origin.js";

const SEQS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const WRONG = new Set([7, 10, 13]);
const RIGHT = SEQS.filter((s) => !WRONG.has(s));
const facts = { disputeId: "D-restart", customer: "Summit Outfitters", seqs: SEQS, requested: "refund_all", email: "Refund all 12 orders #5 to #16." };
const never = <T>() => new Promise<T>(() => undefined);

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function ledgerFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "kit11-dispute-"));
  dirs.push(dir);
  return join(dir, "world.sqlite");
}

/**
 * The outside world, shared across "processes" like the chain and the ledger are: what was sent on chain (each send
 * counted), and the CFO proposals in the ledger. A refund of a sale already sent reports it, as metal-agent does.
 */
function world() {
  const sends = new Map<number, number>();
  const origins = new Map<number, Origin | null>();
  const proposals: { id: string; seqs: number[]; advice: string }[] = [];
  let crashOn: { refundNo?: number; escalate?: "before" | "after" } = {};
  let refundCalls = 0;
  const deps = (): SupportDeps => ({
    verify: async (seq) => ({ seq, signed_order: true, within_mandate: true, payer_is_customer: true, tx: `0xtx${seq}` }),
    data: (seq) => [{ seq, field: "on_hand", delivered: 343, corrected: WRONG.has(seq) ? 93 : 343, refund: WRONG.has(seq) }],
    priceCents: () => 5,
    refund: async (seq) => {
      refundCalls++;
      if (crashOn.refundNo === refundCalls) return never();
      const already = sends.has(seq);
      if (!already) { sends.set(seq, 1); origins.set(seq, currentOrigin()); }
      return { outcome: "PAID", tx: `0xrefund${seq}`, already };
    },
    escalate: async (seqs, advice) => {
      if (crashOn.escalate === "before") return never();
      const id = `P-${String(proposals.length + 4).padStart(4, "0")}`;
      proposals.push({ id, seqs, advice });
      if (crashOn.escalate === "after") return never();
      return { proposalId: id };
    },
    // The ledger's view of earlier runs: the refunds sent, and a proposal for the rest.
    earlier: () => ({ refunded: [...sends.keys()].map((seq) => ({ seq, cents: 5 })), escalated: proposals[0] ? { proposalId: proposals[0].id, seqs: proposals[0].seqs } : null }),
    existing: (part) => (part === "escalate" ? proposals[0]?.id ?? null : null),
    limits: { eachCents: 10, perDisputeCents: 20 },
  });
  return {
    sends, origins, proposals, deps,
    crash(at: typeof crashOn) { crashOn = at; refundCalls = 0; },
  };
}

/** The agent's run: check the data, refund the three wrong ones, send the other nine to the CFO, then finish. */
function agent(): Anthropic & { asked: number } {
  const turns = [
    [7, 10, 13].map((seq) => ({ name: "refund", input: { seq, reason: "wrong stock level" } })),
    [{ name: "escalate_to_cfo", input: { seqs: RIGHT, advice: "Reject: all signed, data right." } }],
  ];
  const c = {
    asked: 0,
    beta: { messages: { create: async () => {
      const t = turns[c.asked++];
      const usage = { input_tokens: 10, output_tokens: 10 };
      if (!t) return { content: [{ type: "text", text: "Refunded #7, #10, #13; the rest goes to the CFO." }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage };
      return { content: t.map((u, k) => ({ type: "tool_use", id: `t${c.asked}-${k}`, ...u })), stop_reason: "tool_use", model: "claude-sonnet-5-5", usage };
    } } },
  };
  return c as unknown as Anthropic & { asked: number };
}

const count = (db: DB, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const decisions = (db: DB) => count(db, "SELECT COUNT(*) AS n FROM dispute_decisions WHERE dispute_id = ?", facts.disputeId);
const settledRows = (db: DB) => count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'dispute.settled_by_agent' AND subject = ?", facts.disputeId);

/** Runs the settlement until it is cut off (the promise never settles); the process is then gone. */
async function runUntilCrash(file: string, w: ReturnType<typeof world>): Promise<void> {
  const db = openDb(file);
  const out = await Promise.race([settleDispute(db, facts, w.deps(), agent()).then(() => "finished" as const), new Promise<"crashed">((ok) => setTimeout(() => ok("crashed"), 300))]);
  expect(out).toBe("crashed");
}

describe("a dispute is decided once, also after a restart", () => {
  for (const [what, crash] of [
    ["after the decision row, before any refund", { refundNo: 1 }],
    ["after one of the three refunds", { refundNo: 2 }],
    ["after all refunds, before the CFO's proposal", { escalate: "before" }],
    ["after the CFO's proposal was made, before it was noted", { escalate: "after" }],
  ] as const) {
    it(`a crash ${what}: the restart carries out THAT decision; one decision, each refund once, one proposal`, async () => {
      const file = ledgerFile();
      const w = world();
      w.crash(crash);
      await runUntilCrash(file, w);
      // The decision was written before anything was paid.
      const crashed = openDb(file);
      expect(decisions(crashed)).toBe(1);
      expect(decisionOf(crashed, facts.disputeId)!.status).toBe("DECIDED");
      crashed.close();

      // The restart: a new process, the agent asked to settle again. It is not asked: the decision stands.
      w.crash({});
      const db = openDb(file);
      const again = agent();
      const r = await settleDispute(db, facts, w.deps(), again);
      expect(again.asked).toBe(0);
      expect(r.already).toMatch(/decided by the Support agent/);
      expect(decisions(db)).toBe(1);
      expect(settledRows(db)).toBe(1);
      expect([...w.sends.entries()].sort((a, b) => a[0] - b[0])).toEqual([[7, 1], [10, 1], [13, 1]]);
      expect(w.proposals.map((p) => p.seqs)).toEqual([RIGHT]);
      const d = decisionOf(db, facts.disputeId)!;
      expect(d).toMatchObject({ status: "DONE", paid: [7, 10, 13], escalation_proposal: "P-0004" });
      // D24: a refund paid after the restart still records the agent's tool call that decided it.
      for (const seq of [7, 10, 13]) expect(w.origins.get(seq)).toMatchObject({ actor: "agent", agent: "support" });

      // A third run, after it was carried out: "already decided", and nothing at all is written.
      const rows = count(db, "SELECT COUNT(*) AS n FROM audit_log");
      const third = await settleDispute(db, facts, w.deps(), agent());
      expect(third.already).toMatch(/carried out/);
      expect(count(db, "SELECT COUNT(*) AS n FROM audit_log")).toBe(rows);
      expect(w.sends.size).toBe(3);
      expect(w.proposals).toHaveLength(1);
    });
  }

  it("without a crash: decided, paid and proposed once, then 'already decided' with nothing written", async () => {
    const db = openDb(ledgerFile());
    const w = world();
    const r = await settleDispute(db, facts, w.deps(), agent());
    expect(r).toMatchObject({ source: "claude", decided: "claude", refunded: [7, 10, 13], escalated: { proposalId: "P-0004", seqs: RIGHT } });
    expect(r.already).toBeUndefined();
    const rows = count(db, "SELECT COUNT(*) AS n FROM audit_log");
    const again = agent();
    const second = await settleDispute(db, facts, w.deps(), again);
    expect(again.asked).toBe(0);
    expect(second.already).toMatch(/refund #7, #10, #13 .*paid #7, #10, #13.*P-0004.*carried out/);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log")).toBe(rows);
    expect(decisions(db)).toBe(1);
    expect(settledRows(db)).toBe(1);
  });

  /** Proposals kept in the ledger file itself (as the live proposals table), made in carryOut's transaction. */
  function ledgerProposals(db: DB, hangReview: { on: boolean }) {
    db.exec("CREATE TABLE IF NOT EXISTS test_props (id TEXT PRIMARY KEY, part TEXT, seqs TEXT, review TEXT)");
    return {
      existing: (part: "escalate" | "approval") => (db.prepare("SELECT id FROM test_props WHERE part = ?").get(part) as { id: string } | undefined)?.id ?? null,
      proposals: {
        create: (part: "escalate" | "approval", seqs: number[]) => {
          const id = `P-${String(count(db, "SELECT COUNT(*) AS n FROM test_props") + 9).padStart(4, "0")}`;
          db.prepare("INSERT INTO test_props (id, part, seqs) VALUES (?, ?, ?)").run(id, part, JSON.stringify(seqs));
          return id;
        },
        review: async (_part: "escalate" | "approval", id: string) => {
          if (hangReview.on) return never<void>();
          db.prepare("UPDATE test_props SET review = 'advisory' WHERE id = ?").run(id);
        },
        reviewed: (part: "escalate" | "approval", id: string) => part === "approval" || !!(db.prepare("SELECT review FROM test_props WHERE id = ?").get(id) as { review: string | null } | undefined)?.review,
      },
    };
  }
  const codePlan = () => ({
    plan: { refunds: [7, 10, 13].map((seq) => ({ seq, cents: 5, origin: { actor: "code", rule: "refund within the CFO's automatic limits", agent: "support" } as Origin })), escalate: { seqs: RIGHT, text: "customer request", origin: null }, approval: null },
    audits: [{ actor: "support" as const, event: "refund.auto_approved", payload: { sales: ["7", "10", "13"] } }],
  });

  it("code's decision (the agent's run did not count) is recorded once and carried out once after a crash", async () => {
    const file = ledgerFile();
    const w = world();
    const hang = { on: false };
    const withCode = (db: DB): SupportDeps => ({ ...w.deps(), ...ledgerProposals(db, hang), fallback: { plan: codePlan } });
    w.crash({ refundNo: 2 });
    const first = openDb(file);
    const cut = await Promise.race([settleDispute(first, facts, withCode(first), null).then(() => "finished"), new Promise((ok) => setTimeout(() => ok("crashed"), 300))]);
    expect(cut).toBe("crashed");
    w.crash({});
    const db = openDb(file);
    const r = await settleDispute(db, facts, withCode(db), agent());
    expect(r).toMatchObject({ source: "fallback", decided: "code" });
    expect(r.already).toBeTruthy();
    expect([...w.sends.values()]).toEqual([1, 1, 1]);
    expect(db.prepare("SELECT id, seqs, review FROM test_props").all()).toEqual([{ id: "P-0009", seqs: JSON.stringify(RIGHT), review: "advisory" }]);
    expect(decisions(db)).toBe(1);
    expect(settledRows(db)).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'refund.auto_approved'")).toBe(1);
    for (const seq of [7, 10, 13]) expect(w.origins.get(seq)).toMatchObject({ actor: "code", rule: "refund within the CFO's automatic limits" });
  });

  it("a crash while the proposal's review runs: the restart keeps that proposal and adds the missing review", async () => {
    const file = ledgerFile();
    const w = world();
    const hang = { on: true };
    const first = openDb(file);
    const withCode = (db: DB): SupportDeps => ({ ...w.deps(), ...ledgerProposals(db, hang), fallback: { plan: codePlan } });
    const cut = await Promise.race([settleDispute(first, facts, withCode(first), null).then(() => "finished"), new Promise((ok) => setTimeout(() => ok("crashed"), 300))]);
    expect(cut).toBe("crashed");
    expect(decisionOf(first, facts.disputeId)).toMatchObject({ status: "DECIDED", escalation_proposal: "P-0009" });
    hang.on = false;
    const db = openDb(file);
    await settleDispute(db, facts, withCode(db), null);
    expect(db.prepare("SELECT id, review FROM test_props").all()).toEqual([{ id: "P-0009", review: "advisory" }]);
    expect(decisionOf(db, facts.disputeId)!.status).toBe("DONE");
  });

  it("refunds above the automatic limits go to the CFO as one proposal, and the decision is then carried out", async () => {
    const db = openDb(ledgerFile());
    const w = world();
    const l = ledgerProposals(db, { on: false });
    recordDecision(db, facts.disputeId, { source: "code", model: null, refunds: [], escalate: null, approval: { seqs: [7, 10, 13], text: "wrong data per supplier correction", origin: null } });
    const d = await carryOut(db, facts.disputeId, { refund: w.deps().refund, existing: l.existing, ...l.proposals });
    expect(d).toMatchObject({ status: "DONE", approval_proposal: "P-0009" });
    expect(w.sends.size).toBe(0);
  });

  it("the agent's decision through the ledger's proposal transaction: a crash in the review, then a crash after a refund", async () => {
    const file = ledgerFile();
    const w = world();
    const hang = { on: true };
    const withLedger = (db: DB): SupportDeps => ({ ...w.deps(), ...ledgerProposals(db, hang) });
    const first = openDb(file);
    const cut = await Promise.race([settleDispute(first, facts, withLedger(first), agent()).then(() => "finished"), new Promise((ok) => setTimeout(() => ok("crashed"), 300))]);
    expect(cut).toBe("crashed");
    // Refunds paid, proposal made and noted in one transaction, review cut off.
    expect(decisionOf(first, facts.disputeId)).toMatchObject({ status: "DECIDED", paid: [7, 10, 13], escalation_proposal: "P-0009" });
    hang.on = false;
    const db = openDb(file);
    const again = agent();
    const r = await settleDispute(db, facts, withLedger(db), again);
    expect(again.asked).toBe(0);
    expect(r.already).toMatch(/carried out/);
    expect(db.prepare("SELECT id, seqs, review FROM test_props").all()).toEqual([{ id: "P-0009", seqs: JSON.stringify(RIGHT), review: "advisory" }]);
    expect([...w.sends.values()]).toEqual([1, 1, 1]);
    expect(settledRows(db)).toBe(1);
  });

  it("two processes carrying out the same decision at once: one proposal, each refund sent once", async () => {
    const file = ledgerFile();
    const w = world();
    const hang = { on: false };
    const a = openDb(file);
    const b = openDb(file);
    recordDecision(a, facts.disputeId, { ...codePlan().plan, source: "code", model: null });
    const run = (db: DB) => { const l = ledgerProposals(db, hang); return carryOut(db, facts.disputeId, { refund: w.deps().refund, existing: l.existing, ...l.proposals }); };
    await Promise.all([run(a), run(b)]);
    expect(count(a, "SELECT COUNT(*) AS n FROM test_props")).toBe(1);
    expect([...w.sends.values()]).toEqual([1, 1, 1]);
    expect(decisionOf(a, facts.disputeId)).toMatchObject({ status: "DONE", paid: [7, 10, 13] });
  });

  it("a second process that decides at the same time: the first decision stands, the second writes nothing", () => {
    const db = openDb(":memory:");
    const plan = { source: "claude" as const, model: "m", refunds: [{ seq: 7, cents: 5, origin: null }], escalate: null, approval: null };
    expect(recordDecision(db, "D-x", plan).fresh).toBe(true);
    const rows = count(db, "SELECT COUNT(*) AS n FROM audit_log");
    const second = recordDecision(db, "D-x", { ...plan, refunds: [{ seq: 10, cents: 5, origin: null }] });
    expect(second.fresh).toBe(false);
    expect(second.decision.plan.refunds.map((r) => r.seq)).toEqual([7]);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log")).toBe(rows);
  });

  it("a recorded decision cannot be changed or deleted, only its progress filled in", () => {
    const db = openDb(":memory:");
    recordDecision(db, "D-x", { source: "code", model: null, refunds: [], escalate: null, approval: null });
    expect(() => db.prepare("UPDATE dispute_decisions SET plan_json = '{}' WHERE dispute_id = 'D-x'").run()).toThrow(/decided once/);
    expect(() => db.prepare("UPDATE dispute_decisions SET source = 'claude' WHERE dispute_id = 'D-x'").run()).toThrow(/decided once/);
    expect(() => db.prepare("DELETE FROM dispute_decisions").run()).toThrow(/kept/);
    expect(() => db.prepare("INSERT OR REPLACE INTO dispute_decisions (dispute_id, source, plan_json, decided_at, status) VALUES ('D-x', 'claude', '{}', 'x', 'DECIDED')").run()).toThrow(/decided once/);
    db.prepare("UPDATE dispute_decisions SET status = 'DONE' WHERE dispute_id = 'D-x'").run();
  });

  it("a dispute settled before decisions were recorded (agent run 1's ledger) is not decided again", async () => {
    const db = openDb(":memory:");
    audit(db, "support", "dispute.settled_by_agent", facts.disputeId, { source: "claude", refunded: ["#7"] });
    const w = world();
    const client = agent();
    const r = await settleDispute(db, facts, w.deps(), client);
    expect(client.asked).toBe(0);
    expect(r.already).toMatch(/settled by the Support agent's run/);
    expect(w.sends.size).toBe(0);
    expect(settledRows(db)).toBe(1);
  });
});

describe("the Support agent's settle_dispute tool after a restart", () => {
  const T0 = new Date("2026-11-05T10:00:00Z");
  const finish = (summary: string) => ({ name: "finish", input: { summary } });
  function fake(turns: { name: string; input: unknown }[][]): Anthropic {
    let i = 0;
    return { beta: { messages: { create: async () => {
      const t = turns[i++];
      const usage = { input_tokens: 10, output_tokens: 10 };
      if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage };
      return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-sonnet-5-5", usage };
    } } } } as unknown as Anthropic;
  }
  function onFile(db: DB, status: "DONE" | "DECIDED"): void {
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-1', '0xc', 'h', ?)").run(T0.toISOString());
    recordDecision(db, "D-1", { source: "claude", model: "claude-sonnet-5-5", refunds: [{ seq: 7, cents: 5, origin: null }], escalate: { seqs: [5, 6], text: "Reject.", origin: null }, approval: null, agent_ran: true });
    if (status === "DONE") db.prepare("UPDATE dispute_decisions SET status = 'DONE', paid_json = '[7]', escalation_proposal = 'P-0004', audited = 1 WHERE dispute_id = 'D-1'").run();
  }

  it("answers 'already decided' with the decision's summary and ids, and settles nothing", async () => {
    const db = openDb(":memory:");
    onFile(db, "DONE");
    let settled = 0;
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, { settle: async () => { settled++; return { ok: true, text: "x" }; } }), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Already decided.")]]), now: T0 });
    expect(settled).toBe(0);
    expect(w!.run!.calls[0]).toMatchObject({ tool: "settle_dispute", blocked: "already decided" });
    expect(w!.run!.calls[0]!.text).toMatch(/Already decided: D-1: decided by the Support agent .*refund #7.*paid #7.*#5, #6 to the CFO as P-0004/);
  });

  it("a decision carried out but whose settlement row a crash cut off is finished, not reported as done", async () => {
    const db = openDb(":memory:");
    onFile(db, "DONE");
    db.prepare("UPDATE dispute_decisions SET audited = 0 WHERE dispute_id = 'D-1'").run();
    expect(health(db).alerts.map((x) => x.code)).toContain("dispute_decision_open");
    let settled = 0;
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    await wake(db, supportProfile(30 * 60_000, { settle: async () => { settled++; return { ok: true, text: "RESUMED" }; } }), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Finished.")]]), now: T0 });
    expect(settled).toBe(1);
  });

  it("a refund refused at payment is tried again at most every half hour, never decided again", async () => {
    const db = openDb(":memory:");
    onFile(db, "DECIDED");
    db.prepare("UPDATE dispute_decisions SET attempts = 1, attempted_at = ?, last_note = 'refund #7 REFUSED: velocity' WHERE dispute_id = 'D-1'").run(new Date().toISOString());
    let settled = 0;
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, { settle: async () => { settled++; return { ok: true, text: "x" }; } }), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Later.")]]), now: T0 });
    expect(settled).toBe(0);
    expect(w!.run!.calls[0]).toMatchObject({ blocked: "carried out recently" });
    expect(w!.run!.calls[0]!.text).toMatch(/REFUSED: velocity.*nothing is decided again/);
  });

  it("carries out a decision a restart cut off, even within the half hour, and says nothing is decided again", async () => {
    const db = openDb(":memory:");
    onFile(db, "DECIDED");
    audit(db, "support", "dispute.settled_by_agent", "D-1", { source: "claude" }, T0);
    let settled = 0;
    publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const w = await wake(db, supportProfile(30 * 60_000, { settle: async () => { settled++; return { ok: true, text: "RESUMED" }; } }), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Finished.")]]), now: T0 });
    expect(w!.run!.calls[0]).toMatchObject({ tool: "settle_dispute" });
    expect(settled).toBe(1);
    expect(w!.run!.calls[0]!.text).toMatch(/nothing decided again.*RESUMED/);
  });
});
