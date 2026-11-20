// The card drill's and the stop drill's records (src/e2e/drillRecord.ts, cardDrillRecord.ts, stopDrillRecord.ts) over
// several passes: the "in short" lines are computed from the steps (passed, failed, not judged, void), every request is
// tied to its pass and step, and the Markdown names the cards, a pass's note, its code, where it stopped and its
// timings, with no hole where a value is missing.
import { describe, expect, it } from "vitest";
import { drillRecord, renderDrillMarkdown, type DrillPass } from "../src/e2e/drillRecord.js";
import { cardDrillSummary, statusLatencies, voidSteps } from "../src/e2e/cardDrillRecord.js";
import { STOP_DRILL_NOT_SHOWN, STOP_DRILL_SIMULATED, stopDrillSummary } from "../src/e2e/stopDrillRecord.js";
import type { DrillLine } from "../src/e2e/drillHttp.js";

type Step = DrillPass["steps"][number];
const step = (id: string, pass: boolean | null, o: Partial<Step> = {}): Step => ({
  phase: "cycle", id, agent: "sourcing", title: `title of ${id}`, expect: "as planned", outcome: `outcome of ${id}`, pass, simulated: null,
  started_at: "2026-11-20T10:00:00.000Z", ended_at: "2026-11-20T10:00:01.000Z", ms: 10, lines: [], facts: {}, error: null, ...o,
} as Step);
const line = (n: number, o: Partial<DrillLine> = {}): DrillLine => ({ n, pid: 1, at: "2026-11-20T10:00:00.000Z", answered_at: "2026-11-20T10:00:00.250Z", ms: 250, method: "POST", endpoint: "/issuing/cards/{id}/update", status: 200, awx_request_id: null, trace_id: null, code: null, ...o } as DrillLine);
const pass = (pass_no: number, steps: Step[], o: Partial<DrillPass> = {}): DrillPass => ({ pass_no, started_at: "2026-11-20T10:00:00.000Z", ended_at: "2026-11-20T10:05:00.000Z", stopped: null, note: null, steps, ...o });
const record = (passes: DrillPass[], lines: DrillLine[] = [], o: { cards?: { agent: string; card_id: string; last4: string; nickname: string }[]; commit?: string | null } = {}) => drillRecord({
  run: "stop-drill", date: "2026-11-20", command: "npm run airwallex:stop-drill -- live", commit: o.commit === undefined ? "0123456789abcdef" : o.commit, simulated: STOP_DRILL_SIMULATED,
  max: 120, approved: null, cards: o.cards ?? [], passes, lines, callLog: [], notShown: STOP_DRILL_NOT_SHOWN,
});

describe("the stop drill's summary", () => {
  it("one pass: the pull, the blocked checks, the lift and the velocity stop, each from its steps", () => {
    const r = record([pass(1, [
      step("stop.pull", true, { outcome: "every agent stopped" }),
      step("blocked.payout", true), step("blocked.card", false, { agent: "support" }), step("blocked.alta", false, { agent: null }),
      step("lift.phone", true), step("lift.passkey", false, { outcome: "a window stayed open" }), step("lift.typed", null),
      step("velocity.burst", true, { outcome: "stopped after 3 charges" }), step("velocity.lift_passkey", true), step("velocity.card", null),
    ], { timings: { velocity_stop_after_authorisation_ms: 412 } })]);
    expect(stopDrillSummary(r)).toEqual([
      "emergency stop pulled: every agent stopped.",
      "after the stop, 1 of 3 checks blocked; not blocked: blocked.card support, blocked.alta.",
      "lifting it: phone as expected, passkey NOT as expected, typed not judged (lift.passkey: a window stayed open).",
      "velocity stop: stopped after 3 charges; the agent was stopped 412 ms after Airwallex answered the authorisation that broke the limit.",
      "after the velocity stop: lift_passkey as expected, card not judged.",
    ]);
  });

  it("several passes are named; a pass without timings or steps of a kind says only what it has", () => {
    const r = record([pass(1, [step("velocity.burst", true, { outcome: "stopped" })]), pass(2, [step("blocked.payout", true), step("lift.phone", true)])]);
    expect(stopDrillSummary(r)).toEqual([
      "Pass 1: velocity stop: stopped; the agent was stopped – ms after Airwallex answered the authorisation that broke the limit.",
      "Pass 2: after the stop, 1 of 1 checks blocked.",
      "Pass 2: lifting it: phone as expected.",
    ]);
  });
});

describe("the card drill's summary over passes", () => {
  it("latencies per pass, charges not judged, the purchase window, both crashes, the poll and the replay", () => {
    const r = record([
      pass(1, [
        step("cycle.freeze", true, { facts: { update_to_readback_ms: 600 } }), step("cycle.thaw", true, { facts: {} }),
        step("cycle.charge_frozen", true), step("cycle.charge_after_refreeze", null),
        step("cycle.auth_in_window", true, { facts: { approved: true, same_amount_as_purchase: true } }),
        step("crash.k1.restart", true), step("crash.k1.recover", false), step("crash.k2.read", null),
        step("detect.poll", false, { outcome: "missed one" }), step("webhooks.local_replay", null, { outcome: "malformed" }),
      ]),
      pass(2, [
        step("cycle.freeze", true, { agent: "support", facts: { update_to_readback_ms: 480 } }), step("cycle.refreeze", true, { facts: { update_to_readback_ms: "x" } }),
        step("cycle.charge_frozen", false), step("cycle.auth_in_window", false, { facts: { approved: false, failure_reason: "CARD_INACTIVE" } }),
        step("purchase.window", true, { facts: { window_ms: 3100 } }), step("purchase.window", true, { facts: {} }),
        step("crash.k2.recover", true), step("detect.poll", true, { outcome: "found it" }), step("webhooks.local_replay", true, { outcome: "answered once" }),
      ]),
    ]);
    const s = cardDrillSummary(r);
    expect(s[0]).toBe("Update sent to Airwallex until the new status read back: freeze pass 1 sourcing 600 ms, pass 2 support 480 ms; thaw pass 1 sourcing – ms; refreeze pass 2 sourcing – ms.");
    expect(s[1]).toBe("Charges on a frozen card (before the thaw, and right after the refreeze was read back): 1 of 2 declined CARD_INACTIVE; 1 not judged (the sandbox refused to simulate).");
    expect(s[2]).toContain("pass 1 sourcing APPROVED (same amount as the purchase), pass 2 sourcing declined CARD_INACTIVE");
    expect(s).toContain("Purser's own purchase path (chargeInWindow) kept the card thawed for 3100 ms, – ms (thaw sent until the refreeze read back).");
    expect(s).toContain("Crash k1 (killed after the thaw was recorded): pass 1 restart pass, recover FAIL.");
    expect(s).toContain("Crash k2 (killed the moment Airwallex answered the thaw, before the ledger heard): pass 1 read measured; pass 2 recover pass.");
    expect(s).toContain("Detection by the poll, pass 1 FAIL: missed one.");
    expect(s).toContain("Webhook replay (local), pass 1 not judged: malformed.");
    expect(s).toContain("Webhook replay (local), pass 2 pass: answered once.");
  });

  it("a drill without the cycle says nothing of it", () => {
    expect(cardDrillSummary(record([pass(1, [step("webhooks.local_replay", false, { outcome: "two rows" })])]))).toEqual(["Webhook replay (local), FAIL: two rows."]);
  });

  it("marks the void step of pass 1 only, keeping what was seen", () => {
    const steps = [step("webhooks.local_replay", false, { outcome: "30 refused" }), step("detect.poll", true)];
    const [v, kept] = voidSteps(1, steps);
    expect(v).toMatchObject({ pass: null, outcome: expect.stringMatching(/^VOID \(the drill's log kept the simulation answers without their date.*\)\. Seen: 30 refused$/) });
    expect(kept).toBe(steps[1]);
    expect(voidSteps(3, steps)).toEqual(steps);
  });

  it("a status step without its update or read back in the log has no latency; other steps are left as they are", () => {
    const freeze = step("cycle.freeze", true, { lines: [1], outcome: "read back INACTIVE; update to read-back 900 ms" });
    const other = step("detect.poll", true, { lines: [1] });
    const [f, o] = statusLatencies([freeze, other], [line(1, { method: "GET", endpoint: "/issuing/cards/{id}" })]);
    expect(f!.facts).toMatchObject({ update_to_readback_ms: null, update_ms: null });
    expect(f!.outcome).toBe("read back INACTIVE; update to read-back - ms");
    expect(o).toBe(other);
  });
});

describe("the drill record's Markdown", () => {
  it("names the cards, each pass's note, code, stop and timings, ties requests to passes, and lists the unexpected answers", () => {
    const lines = [
      line(1, { endpoint: "/authentication/login" }),
      line(2, { status: 400, code: "bad_request", awx_request_id: "req_2", trace_id: "tr_2" }),
      line(3, { status: 429 }),
      line(4, { status: 0, method: "GET", endpoint: "/issuing/cards/{id}", card_status: "INACTIVE" }),
      line(5, { endpoint: "/simulation/issuing/create", sim: { process_result: null, status: "DECLINED", failure_reason: "CARD_INACTIVE" } } as Partial<DrillLine>),
      line(6, { endpoint: "/simulation/issuing/create", sim: {} } as Partial<DrillLine>),
      line(7, { endpoint: "/other" }),
    ];
    const r = record([
      pass(1, [step("stop.pull", true, { lines: [2, 3], simulated: "the phone | played by the drill" })], { note: "The first pass.", code: { cards: "f667d16" }, stopped: "at velocity.card: HTTP 400", timings: { stop_ms: 120, lift_ms: null } }),
      pass(2, [step("lift.phone", false, { lines: [4, 5, 6], agent: null })], { ended_at: null, timings: {} }),
    ], lines, { cards: [{ agent: "sourcing", card_id: "card_1", last4: "4242", nickname: "Sourcing | drill" }] });
    expect(r.budget.unexpected_non_2xx).toEqual([
      { n: 2, status: 400, call: "POST /issuing/cards/{id}/update", code: "bad_request" },
      { n: 4, status: 0, call: "GET /issuing/cards/{id}", code: null },
    ]);
    expect(r.budget.status_429).toBe(1);
    expect(r.calls.map((c) => c.step)).toEqual(["login", "pass 1 stop.pull (sourcing)", "pass 1 stop.pull (sourcing)", "pass 2 lift.phone", "pass 2 lift.phone", "pass 2 lift.phone", null]);
    const md = renderDrillMarkdown(r, { title: "Stop drill", intro: "Pulls the stop.", file: "docs/runs/x.json", summary: stopDrillSummary(r) });
    expect(md).toContain("Code when this record was written: `0123456789ab` (each pass says what it ran on).");
    expect(md).toContain("of a budget of – (the drill's hard limit: 120");
    expect(md).toContain("## In short");
    expect(md).toContain("| sourcing | `card_1` | 4242 | Sourcing \\| drill |");
    expect(md).toContain("## Pass 1 (10:00:00.000–10:05:00.000 UTC)");
    expect(md).toContain("## Pass 2 (10:00:00.000–– UTC)");
    expect(md).toContain("The first pass.");
    expect(md).toContain("Code under test: `cards` f667d16.");
    expect(md).toContain("**Stopped:** at velocity.card: HTTP 400");
    expect(md).toContain("Timings: stop_ms 120 ms; lift_ms – ms.");
    expect(md).toContain("*(simulated: the phone \\| played by the drill)*");
    expect(md).toContain("| 400 bad_request | `req_2` | `tr_2` |");
    expect(md).toContain("| INACTIVE |");
    expect(md).toContain("| auth DECLINED CARD_INACTIVE |");
    expect(md).toContain("| auth ? |");
    expect(md).not.toMatch(/undefined|NaN|null \|/);
  });

  it("one pass is just 'Steps', and a record without a commit, cards or summary leaves those out", () => {
    const md = renderDrillMarkdown(record([pass(1, [step("stop.pull", true)])], [], { commit: null }), { title: "Stop drill", intro: "i", file: "f", summary: [] });
    expect(md).toContain("## Steps (");
    expect(md).not.toContain("Code when this record was written");
    expect(md).not.toContain("## The cards");
    expect(md).not.toContain("## In short");
  });
});
