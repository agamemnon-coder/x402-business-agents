// The card drill and the stop drill (20 Nov): their HTTP log and its rules, the whole of each drill on the stand-ins,
// and the record. No network: the live runs are docs/runs/2026-11-20-card-drill.* and -stop-drill.*.
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { setupCards } from "../src/policy/cards.js";
import { drillFetch, drillHaltReason, readDrillLog, DrillHalted } from "../src/e2e/drillHttp.js";
import { CARD_DRILL_SUFFIX, crashChild, runCardDrill } from "../src/e2e/cardDrill.js";
import { runStopDrill } from "../src/e2e/stopDrill.js";
import { soakStandIn } from "../src/e2e/airwallexSoakStandIn.js";
import { drillRecord, renderDrillMarkdown } from "../src/e2e/drillRecord.js";
import { cardDrillSummary } from "../src/e2e/cardDrillRecord.js";

const SANDBOX = "https://api.sandbox.airwallex.com/api/v1";
const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("the drill's HTTP log", () => {
  const fresh = () => join(mkdtempSync(join(tmpdir(), "drill-")), "http.jsonl");

  it("refuses any host but the sandbox, before anything is sent", async () => {
    let sent = 0;
    const f = drillFetch(async () => { sent++; return answer(200, {}); }, { file: fresh() });
    await expect(f("https://api.airwallex.com/api/v1/balances/current")).rejects.toBeInstanceOf(DrillHalted);
    expect(sent).toBe(0);
  });

  it("logs each request with its status and Airwallex's ids, a card's status, and only whitelisted fields of an authorisation", async () => {
    const file = fresh();
    const f = drillFetch(async (i) => String(i).includes("simulation")
      ? answer(201, { card_id: "c1", card_transaction_id: "ct1", transaction_amount: 1, transaction_currency: "EUR", process_result: "APPROVED", transacted_at: "2026-11-20T10:00:00Z", card_number: "4111111111111111", merchant: { name: "M", category_code: "5734" } })
      : answer(200, { card_status: "INACTIVE", card_number: "4111111111111111" }, { "x-b3-traceid": "abc123", "x-request-id": "rq-1" }), { file });
    await f(`${SANDBOX}/issuing/cards/0b7c7a5e-1c1b-4c1f-9a7e-2d7f0c0c0c0c`);
    await f(`${SANDBOX}/simulation/issuing/create`, { method: "POST" });
    const lines = readDrillLog(file);
    expect(lines[0]).toMatchObject({ n: 1, method: "GET", endpoint: "/issuing/cards/{id}", status: 200, trace_id: "abc123", awx_request_id: "rq-1", card_status: "INACTIVE" });
    expect(lines[1]).toMatchObject({ n: 2, endpoint: "/simulation/issuing/create", sim: { card_transaction_id: "ct1", process_result: "APPROVED", transacted_at: "2026-11-20T10:00:00Z" } });
    expect(JSON.stringify(lines)).not.toMatch(/4111/);
  });

  it("keeps requests at least 200 ms apart, across processes sharing the log", async () => {
    const file = fresh();
    let clock = 1_000_000;
    const waits: number[] = [];
    const f = drillFetch(async () => answer(200, {}), { file, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    await f(`${SANDBOX}/balances/current`);
    clock += 50;
    await f(`${SANDBOX}/balances/current`);
    expect(waits).toEqual([150]);
  });

  it("halts the run at an unexpected 4xx: nothing more is sent, by any process of the run; a 429 does not halt", async () => {
    const file = fresh();
    let next = 429;
    let sent = 0;
    const f = drillFetch(async () => { sent++; return answer(next, { code: "bad_request", message: "something" }); }, { file });
    await f(`${SANDBOX}/issuing/cards`);
    expect(drillHaltReason(file)).toBeNull();
    next = 400;
    await f(`${SANDBOX}/simulation/issuing/create`, { method: "POST" });
    expect(drillHaltReason(file)).toMatch(/HTTP 400 bad_request on POST \/simulation\/issuing\/create/);
    expect(readDrillLog(file)[1]).toMatchObject({ code: "bad_request", message: "something" });
    await expect(drillFetch(async () => answer(200, {}), { file })(`${SANDBOX}/issuing/cards`)).rejects.toBeInstanceOf(DrillHalted);
    expect(sent).toBe(2);
    expect(existsSync(`${file}.halt`)).toBe(true);
  });
});

describe("the card drill on the stand-in", () => {
  it("runs every phase; only the second authorisation inside a window is approved (Airwallex judges a thawed card on its limits)", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    let clock = Date.parse("2026-11-20T10:00:00Z");
    awx.clock = () => clock;
    const res = await runCardDrill({
      db, rail: awx, lines: () => [], mode: "stand-in", now: () => new Date(clock), sleep: async (ms) => { clock += ms; }, halted: () => null,
      crash: async (kind, agent) => {
        let dead = false;
        void crashChild(db, awx, agent, kind, new Date(clock), () => { dead = true; return new Promise<never>(() => undefined); });
        while (!dead) await new Promise((r) => setImmediate(r));
        return { signal: "SIGKILL", code: null };
      },
    });
    expect(res.code).toEqual({ recover_card_windows: true, thaw_marked_before_call: true });
    expect(res.steps.filter((s) => s.pass === false).map((s) => `${s.id} ${s.agent}`)).toEqual(["cycle.auth_in_window sourcing", "cycle.auth_in_window support", "cycle.auth_in_window treasury"]);
    for (const id of ["crash.k1.recover", "crash.k2.recover", "crash.k1.charge", "crash.k2.charge", "detect.poll"]) expect(res.steps.find((s) => s.id === id)?.pass).toBe(true);
    expect(awx.cards.every((c) => c.status === "INACTIVE")).toBe(true);
  }, 60_000);
});

describe("the stop drill on the stand-ins", () => {
  it("blocks every agent, card and pending action, and lifts only with the passkey on a runner proposal", async () => {
    const iss = new FakeIssuing();
    await setupCards(openDb(":memory:"), iss, new Date(), { nicknameSuffix: CARD_DRILL_SUFFIX });
    const { rail: awx, awx: fake } = await soakStandIn();
    const res = await runStopDrill({ db: openDb(":memory:"), rail: iss, awx, transferExists: async (rid) => fake.transfers.some((t) => t.requestId === rid), lines: () => [], mode: "stand-in", now: () => new Date(), halted: () => null });
    expect(res.steps.filter((s) => s.pass !== true).map((s) => s.id)).toEqual([]);
    expect(res.steps.map((s) => s.id)).toEqual(expect.arrayContaining(["stop.pull", "blocked.payout", "lift.phone", "lift.typed", "lift.passkey", "velocity.burst", "velocity.lift_passkey"]));
    expect(fake.transfers).toHaveLength(0);
    expect(iss.cards.every((c) => c.status === "INACTIVE")).toBe(true);
  }, 60_000);

  it("re-runs only the groups asked for", async () => {
    const iss = new FakeIssuing();
    await setupCards(openDb(":memory:"), iss, new Date(), { nicknameSuffix: CARD_DRILL_SUFFIX });
    const { rail: awx } = await soakStandIn();
    const res = await runStopDrill({ db: openDb(":memory:"), rail: iss, awx, transferExists: async () => false, lines: () => [], mode: "stand-in", now: () => new Date(), halted: () => null, only: new Set(["windows", "stop", "lift"]), passNo: 3 });
    expect(res.steps.map((s) => s.id)).toEqual(["setup.cards", "setup.passkey", "setup.windows", "stop.pull", "lift.phone", "lift.unapproved", "lift.typed", "lift.passkey", "lift.purchase"]);
    expect(res.steps.every((s) => s.pass === true)).toBe(true);
  }, 60_000);
});

describe("the drill record", () => {
  it("counts the steps, ties each request to its step and renders without a hole", () => {
    const step = (id: string, pass: boolean | null, lines: number[], facts: Record<string, unknown> = {}) => ({ phase: "cycle" as const, id, agent: "sourcing", title: "t", expect: "e", outcome: "o", pass, simulated: null, started_at: "2026-11-20T10:00:00.000Z", ended_at: "2026-11-20T10:00:01.000Z", ms: 1000, lines, facts, error: null });
    const line = (n: number) => ({ n, pid: 1, at: "2026-11-20T10:00:00.000Z", answered_at: "2026-11-20T10:00:00.300Z", ms: 300, method: "POST", endpoint: "/issuing/cards/{id}/update", status: 200, awx_request_id: null, trace_id: `t${n}`, code: null });
    const rec = drillRecord({
      run: "card-drill", date: "2026-11-20", command: "npm run airwallex:card-drill -- live", commit: "abc", simulated: ["s"], max: 200, approved: 200, cards: [],
      passes: [{ pass_no: 1, started_at: "2026-11-20T10:00:00.000Z", ended_at: "2026-11-20T10:01:00.000Z", stopped: null, note: null, steps: [step("cycle.freeze", true, [2], { update_to_readback_ms: 612 }), step("cycle.auth_in_window", false, [3]), step("webhooks.sandbox_replay", null, [])] }],
      lines: [line(1), line(2), line(3)], callLog: [1, 2, 3].map(() => ({ at: "x", method: "POST", endpoint: "/issuing/cards/{id}/update", pid: 1 })), notShown: ["n"],
    });
    expect(rec.totals).toEqual({ steps: 3, pass: 1, fail: 1, not_judged: 1 });
    expect(rec.calls.map((c) => c.step)).toEqual([null, "cycle.freeze (sourcing)", "cycle.auth_in_window (sourcing)"]);
    const md = renderDrillMarkdown(rec, { title: "Card drill", intro: "i", file: "docs/runs/2026-11-20-card-drill.json", summary: cardDrillSummary(rec) });
    expect(md).toMatch(/1 of 3 steps passed, 1 failed, 1 not judged/);
    expect(md).toMatch(/freeze sourcing 612 ms/);
    expect(md).not.toMatch(/undefined|NaN/);
  });
});
