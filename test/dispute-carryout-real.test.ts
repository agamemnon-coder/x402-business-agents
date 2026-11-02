// A dispute decision carried out against the real refund executor (src/executors/refunds.ts) on a ledger file, with a
// stand-in Metal pull that counts each payment id: two processes (two connections, two carriers) at once, and a crash
// after a refund was PAID but before the decision noted it. Each payment id must be pulled once. Also s2's early
// paths as a real process: --resume-only with nothing to resume, and a decision already carried out, end without
// reading Claude, the chain or any key. No network.
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditSettlement, carryOut, decisionOf, decisionSummary, recordDecision, type Carrier, type DecisionExec } from "../src/agents/disputeDecision.js";
import { reconcile } from "../src/finance/reconcile.js";
import { health } from "../src/ops/health.js";
import { openDb, type DB } from "../src/db/open.js";
import { refundSale } from "../src/executors/refunds.js";
import { sha256Hex } from "../src/lib/terms.js";
import type { Puller } from "../src/metal/pull.js";
import type { Origin } from "../src/provenance/origin.js";

const PAYER = "0x00000000000000000000000000000000000000c1" as const;
const AGENT: Origin = { actor: "agent", agent: "support", model: "claude-sonnet-5-5", request_id: "req_1", run_id: "run_1" };
const never = <T>() => new Promise<T>(() => undefined);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function world() {
  const dir = mkdtempSync(join(tmpdir(), "kit11-carry-"));
  dirs.push(dir);
  const file = join(dir, "world.sqlite");
  const db = openDb(file);
  db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-r', 'Summit Outfitters', 'x', 'now')").run();
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, ?, 'u', '{}', 'DELIVERED', 'now')").run(PAYER);
  const pulls = new Map<string, number>();
  /** What Metal answers per payment id, in order (default PAID). */
  const answers = new Map<string, ("PAID" | "HELD" | "REFUSED" | "VELOCITY")[]>();
  const pull: Puller = async ({ paymentId }) => {
    const n = (pulls.get(paymentId) ?? 0) + 1;
    pulls.set(paymentId, n);
    await new Promise((r) => setTimeout(r, 5));
    const a = answers.get(paymentId)?.shift() ?? "PAID";
    if (a === "VELOCITY") return { outcome: "REFUSED", tx: null, reason: "7 payments in a minute, the limit is 6", already: false };
    if (a === "REFUSED") return { outcome: "REFUSED", tx: null, reason: "refused at Metal: the customer's receive policy rejected it", already: false };
    return { outcome: a, tx: `0x${paymentId}`, reason: null, already: n > 1 };
  };
  const exec = (conn: DB, crashAfterPaid?: number): DecisionExec => ({
    refund: async (seq, opts) => {
      const r = await refundSale(conn, { sale_id: seq, amount_cents: 5, to: PAYER, dispute_id: "D-r" }, { pull, retry: opts?.retry === true });
      if (crashAfterPaid === seq) return never();
      return r;
    },
    state: (seq) => (conn.prepare("SELECT outcome FROM refunds WHERE sale_id = ?").get(seq) as { outcome: string } | undefined)?.outcome ?? null,
    existing: () => null,
  });
  return { file, db, pulls, answers, exec };
}
const carrier = (pid: number, alive: () => boolean): Carrier => ({ pid, start: `s${pid}`, alive });

describe("carrying out a dispute decision with the real refund executor", () => {
  it("two processes at once: one carries it out, the other leaves it; each payment id pulled once", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [1, 2, 3].map((seq) => ({ seq, cents: 5, origin: AGENT })), escalate: null, approval: null });
    const a = openDb(w.file);
    const b = openDb(w.file);
    let aRunning = true;
    const [da, db] = await Promise.all([
      carryOut(a, "D-r", w.exec(a), () => undefined, carrier(111, () => true)).finally(() => { aRunning = false; }),
      carryOut(b, "D-r", w.exec(b), () => undefined, carrier(222, () => aRunning)),
    ]);
    expect(da!.status).toBe("DONE");
    expect(db!.status).toBe("DECIDED");
    expect([...w.pulls.entries()]).toEqual([["refund-1", 1], ["refund-2", 1], ["refund-3", 1]]);
    expect(decisionOf(w.db, "D-r")).toMatchObject({ status: "DONE", paid: [1, 2, 3] });
    // Each refund carries the agent's origin from its decision (D24).
    for (const r of w.db.prepare("SELECT origin_json FROM refunds").all() as { origin_json: string }[]) expect(JSON.parse(r.origin_json)).toMatchObject({ actor: "agent", agent: "support" });
  });

  it("a crash after a refund was PAID, before the decision noted it: the restart pulls nothing again", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "code", model: null, refunds: [1, 2, 3].map((seq) => ({ seq, cents: 5, origin: { actor: "code", rule: "refund within the CFO's automatic limits", agent: "support" } as Origin })), escalate: null, approval: null });
    const first = openDb(w.file);
    const cut = await Promise.race([carryOut(first, "D-r", w.exec(first, 2), () => undefined, carrier(111, () => false)).then(() => "finished"), new Promise((ok) => setTimeout(() => ok("crashed"), 300))]);
    expect(cut).toBe("crashed");
    expect(decisionOf(w.db, "D-r")!.paid).toEqual([1]);
    // The restart: the crashed carrier is gone.
    const again = openDb(w.file);
    const d = await carryOut(again, "D-r", w.exec(again), () => undefined, carrier(333, () => false));
    expect(d).toMatchObject({ status: "DONE", paid: [1, 2, 3] });
    expect([...w.pulls.entries()]).toEqual([["refund-1", 1], ["refund-2", 1], ["refund-3", 1]]);
  });

  it("a refund that no longer fits the automatic limits is not paid; it goes to the CFO as one proposal", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [1, 2].map((seq) => ({ seq, cents: 5, origin: AGENT })), escalate: null, approval: null });
    const made: number[][] = [];
    const exec: DecisionExec = { ...w.exec(w.db), limits: () => ({ eachCents: 10, perDisputeCents: 5 }), refundedCents: (except) => (w.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM refunds WHERE outcome IN ('PAID', 'PENDING', 'HELD') AND sale_id != ?").get(except) as { c: number }).c, create: (_part, seqs) => { made.push(seqs); return "P-0007"; } };
    const d = await carryOut(w.db, "D-r", exec, () => undefined, carrier(111, () => false));
    expect(d).toMatchObject({ status: "DONE", paid: [1], handover: [2], handover_proposal: "P-0007" });
    expect(made).toEqual([[2]]);
    expect([...w.pulls.keys()]).toEqual(["refund-1"]);
  });

  it("a refund held at Metal is looked at again with the same payment id: paid once it settles; after three looks sent, unconfirmed, never 'refunded'", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [1, 2].map((seq) => ({ seq, cents: 5, origin: AGENT })), escalate: null, approval: null, agent_ran: true });
    w.answers.set("refund-1", ["HELD", "PAID"]);
    w.answers.set("refund-2", ["HELD", "HELD", "HELD"]);
    const c = carrier(111, () => false);
    expect(await carryOut(w.db, "D-r", w.exec(w.db), () => undefined, c)).toMatchObject({ status: "DECIDED", paid: [], held_looks: { 1: 1, 2: 1 } });
    expect(await carryOut(w.db, "D-r", w.exec(w.db), () => undefined, c)).toMatchObject({ status: "DECIDED", paid: [1] });
    const d = (await carryOut(w.db, "D-r", w.exec(w.db), () => undefined, c))!;
    expect(d).toMatchObject({ status: "DONE", paid: [1], sent: [2], handover: [] });
    expect(decisionSummary(d)).toMatch(/#2 sent but still held at Metal: unconfirmed, not refunded/);
    auditSettlement(w.db, "D-r");
    const row = JSON.parse((w.db.prepare("SELECT payload_json FROM audit_log WHERE event = 'dispute.settled_by_agent'").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(row).toMatchObject({ refunded: ["#1"], refunded_now: ["#1"], sent_unconfirmed: ["#2"] });
    // Each look is a pull of the same payment id (Metal sends nothing twice); no new payment id, no proposal.
    expect([...w.pulls.entries()]).toEqual([["refund-1", 2], ["refund-2", 3]]);
    expect(w.db.prepare("SELECT event FROM audit_log WHERE subject = '2' AND event LIKE 'refund.%' ORDER BY seq").all()).toEqual([{ event: "refund.held" }, { event: "refund.already_held" }, { event: "refund.already_held" }]);
    // Followed after two hours: /health warns, the reconciliation looks it up, and it is not reported as refunded.
    const later = new Date(Date.now() + 3 * 60 * 60_000);
    expect(health(w.db, later).alerts.find((a) => a.code === "refund_held")!.words).toMatch(/refund-2 \(sale 2\) was sent but is held at Metal/);
    const rec = await reconcile(w.db, {}, later);
    expect(rec.held).toEqual([expect.objectContaining({ ref: "refund-2", chain: "not looked up (no RPC)" })]);
    expect(rec.differences).toEqual([]);
  });

  it("refused twice for a speed limit and then held once is one look at a hold, not three", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [{ seq: 1, cents: 5, origin: AGENT }], escalate: null, approval: null });
    w.answers.set("refund-1", ["VELOCITY", "VELOCITY", "HELD"]);
    const c = carrier(111, () => false);
    await carryOut(w.db, "D-r", w.exec(w.db), () => undefined, c);
    await carryOut(w.db, "D-r", w.exec(w.db), () => undefined, c);
    const d = await carryOut(w.db, "D-r", w.exec(w.db), () => undefined, c);
    expect(d).toMatchObject({ status: "DECIDED", paid: [], sent: [], handover: [], held_looks: { 1: 1 } });
  });

  it("a refund held at Metal and then refused there: not refunded, handed to the CFO, critical on /health", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [{ seq: 1, cents: 5, origin: AGENT }], escalate: null, approval: null });
    w.answers.set("refund-1", ["HELD", "REFUSED"]);
    const made: number[][] = [];
    const exec: DecisionExec = { ...w.exec(w.db), create: (_p, seqs) => { made.push(seqs); return "P-0005"; } };
    const c = carrier(111, () => false);
    await carryOut(w.db, "D-r", exec, () => undefined, c);
    const d = await carryOut(w.db, "D-r", exec, () => undefined, c);
    expect(d).toMatchObject({ status: "DONE", paid: [], sent: [], handover: [1], handover_proposal: "P-0005" });
    expect(made).toEqual([[1]]);
    expect(health(w.db).alerts.find((a) => a.code === "refund_held_then_refused")).toMatchObject({ severity: "critical", words: expect.stringMatching(/refund-1 \(sale 1\) was held at Metal and then refused.*nothing was refunded/) });
  });

  it("a refund already in flight (PENDING) is not judged again against tighter limits; its pull is finished", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [{ seq: 1, cents: 5, origin: AGENT }], escalate: null, approval: null });
    w.db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id, origin_json) VALUES (1, 'refund-1', 5, ?, 'PENDING', 'D-r', ?)").run(PAYER, JSON.stringify(AGENT));
    const made: number[][] = [];
    const exec: DecisionExec = { ...w.exec(w.db), limits: () => ({ eachCents: 1, perDisputeCents: 1 }), refundedCents: () => 0, create: (_p, seqs) => { made.push(seqs); return "P-0001"; } };
    const d = await carryOut(w.db, "D-r", exec, () => undefined, carrier(111, () => false));
    expect(d).toMatchObject({ status: "DONE", paid: [1], handover: [] });
    expect(made).toEqual([]);
    expect([...w.pulls.entries()]).toEqual([["refund-1", 1]]);
  });

  it("a ledger whose dispute_decisions table was made by an earlier build of this branch is brought up to date", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kit11-old-"));
    dirs.push(dir);
    const file = join(dir, "old.sqlite");
    const raw = new Database(file);
    raw.exec(`CREATE TABLE dispute_decisions (dispute_id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK (source IN ('claude', 'code')), plan_json TEXT NOT NULL,
      decided_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('DECIDED', 'DONE')), paid_json TEXT NOT NULL DEFAULT '[]', escalation_proposal TEXT,
      approval_proposal TEXT, last_note TEXT, audited INTEGER NOT NULL DEFAULT 0, done_at TEXT)`);
    raw.prepare("INSERT INTO dispute_decisions (dispute_id, source, plan_json, decided_at, status) VALUES ('D-r', 'code', ?, 'then', 'DECIDED')").run(JSON.stringify({ source: "code", model: null, refunds: [{ seq: 1, cents: 5, origin: null }], escalate: null, approval: null }));
    raw.close();
    const db = openDb(file);
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-r', 'Summit Outfitters', 'x', 'now')").run();
    db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, ?, 'u', '{}', 'DELIVERED', 'now')").run(PAYER);
    expect(decisionOf(db, "D-r")).toMatchObject({ attempts: 0, handover: [], handover_proposal: null });
    const pulls: string[] = [];
    const d = await carryOut(db, "D-r", { refund: (seq) => refundSale(db, { sale_id: seq, amount_cents: 5, to: PAYER, dispute_id: "D-r" }, { pull: async ({ paymentId }) => { pulls.push(paymentId); return { outcome: "PAID", tx: "0x1", reason: null, already: false }; } }), existing: () => null }, () => undefined, carrier(111, () => false));
    expect(d).toMatchObject({ status: "DONE", paid: [1] });
    expect(pulls).toEqual(["refund-1"]);
  });

  it("a refund refused for good goes to the CFO; a speed-limit refusal is tried again later", async () => {
    const w = world();
    recordDecision(w.db, "D-r", { source: "claude", model: "m", refunds: [1, 2].map((seq) => ({ seq, cents: 5, origin: AGENT })), escalate: null, approval: null });
    const made: number[][] = [];
    const exec: DecisionExec = {
      refund: async (seq) => ({ outcome: "REFUSED", reason: seq === 1 ? "mandate_cap_exceeded: over the support mandate" : "7 payments in a minute, the limit is 6" }),
      existing: () => null, create: (_part, seqs) => { made.push(seqs); return "P-0008"; },
    };
    const first = await carryOut(w.db, "D-r", exec, () => undefined, carrier(111, () => false));
    expect(first).toMatchObject({ status: "DECIDED", handover: [1], handover_proposal: null });
    await carryOut(w.db, "D-r", exec, () => undefined, carrier(111, () => false));
    const third = await carryOut(w.db, "D-r", exec, () => undefined, carrier(111, () => false));
    // The third try hands the speed-limited one over too, and both go to the CFO in one proposal.
    expect(third).toMatchObject({ status: "DONE", handover: [1, 2], handover_proposal: "P-0008" });
    expect(made).toEqual([[1, 2]]);
  });
});

describe("s2's early paths as a real process (no Claude, no chain, no keys)", () => {
  const repo = resolve(import.meta.dirname, "..");
  const s2 = (file: string, ...args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env, KIT11_DB: file };
    for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "KIT11_AGENTS"]) delete env[k];
    const r = spawnSync(resolve(repo, "node_modules/.bin/tsx"), [resolve(repo, "src/cli/s2.ts"), ...args], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const disputeId = `D-${sha256Hex(readFileSync(resolve(repo, "fixtures/summit-dispute-email.txt"), "utf8")).slice(0, 8)}`;

  it("--resume-only with no decision does nothing; with a carried-out decision it says so; a rerun says already decided", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit11-s2-"));
    dirs.push(dir);
    const file = join(dir, "world.sqlite");
    openDb(file).close();
    const none = s2(file, "--resume-only");
    expect(none.code).toBe(0);
    expect(none.out).toMatch(/no decision to carry out; nothing to do/);
    const db = openDb(file);
    recordDecision(db, disputeId, { source: "code", model: null, refunds: [], escalate: null, approval: null });
    db.prepare("UPDATE dispute_decisions SET status = 'DONE' WHERE dispute_id = ?").run(disputeId);
    const rows = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    db.close();
    expect(s2(file, "--resume-only").out).toMatch(/carried out already; nothing to do/);
    const again = s2(file);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/ALREADY DECIDED .*decided by code.*Nothing is decided again/);
    const after = openDb(file);
    expect((after.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(rows);
  }, 120_000);
});
