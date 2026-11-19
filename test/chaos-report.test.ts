// The money chaos report (src/chaos/report.ts, docs/evidence/chaos-money.md and .json): what it counts from the
// scenarios' results and what its Markdown says, on hand-made results (the full chaos run is test/chaos-money.test.ts).
import { describe, expect, it } from "vitest";
import type { Invariant, Scenario, ScenarioResult } from "../src/chaos/money.js";
import { chaosMarkdown, chaosReport, INVARIANT_WORDS } from "../src/chaos/report.js";

const scenario = (id: string, title: string, seed: number): Scenario => ({
  id, title, seed, invoices: 1, faultRate: 0.15, faults: [], faultyLives: 1, crash: null, secondCrash: null, skewMs: 0, delayMs: 0,
  concurrent: false, hookCopies: 2, forgedHooks: 1,
});

const inv = (i4: string, broken: Partial<Record<Invariant["id"], string>> = {}): Invariant[] =>
  (["I1", "I2", "I3", "I4", "I5"] as const).map((id) => ({ id, ok: !broken[id], detail: broken[id] ?? (id === "I4" ? i4 : "held") }));

function result(id: string, o: Partial<ScenarioResult> & { i4: string; broken?: Partial<Record<Invariant["id"], string>> }): ScenarioResult {
  const invariants = inv(o.i4, o.broken);
  return {
    id, title: o.title ?? `scenario ${id}`, seed: o.seed ?? 7, ok: invariants.every((i) => i.ok), invariants,
    silentApprovals: o.silentApprovals ?? [], outcome: o.outcome ?? [`${id} life 1`],
    calls: o.calls ?? 10, faults: o.faults ?? 2, faultKinds: o.faultKinds ?? { lost_answer: 1, http500: 1 }, crashes: o.crashes ?? 1,
    hooks: o.hooks ?? { delivered: 4, forged: 1, ignored: 1 }, scenario: scenario(id, o.title ?? `scenario ${id}`, o.seed ?? 7),
  };
}

const H1 = result("H1", { title: "lost answer | then a retry", i4: "P-1 EXECUTED, PAID at Airwallex" });
const H2 = result("H2", { title: "terms edited after approval", i4: "P-2 APPROVED, then EXPIRED", silentApprovals: ["P-2"], outcome: ["(calm) the terms do not match the approved hash"], faultKinds: { http503: 3 } });
const H3 = result("H3", { title: "floor", i4: "P-3 FAILED, nothing at Airwallex → a person (alarm row)", silentApprovals: ["P-3"], outcome: ["(calm) the EUR floor would be broken"] });
const R1 = result("R001", { i4: "P-1 EXECUTED; P-2 FAILED", faultKinds: { lost_answer: 2 } });
const R2 = result("R002", { i4: "nothing to say", broken: { I1: "paid twice: two transfers for P-1" }, outcome: ["life 1: crash", "life 2: retry"] });
const R3 = result("R003", { i4: "P-9 EXECUTED", silentApprovals: ["P-9"], outcome: ["(calm) refused for another reason"] });
const C1 = result("C1", { title: "pay twice", i4: "P-1 EXECUTED", broken: { I1: "two transfers", I3: "ledger off" } });
const C2 = result("C2", { title: "a canary nothing catches", i4: "P-1 EXECUTED" });

describe("the chaos report", () => {
  const r = chaosReport(42, [R1, R2, R3], [H1, H2, H3], [C1, C2], "2026-11-19");

  it("counts scenarios, hand-written first, with passes, failures and the totals of calls, faults, deaths and webhooks", () => {
    expect(r.format).toBe("purser.chaos-money/v1");
    expect(r.seed).toBe(42);
    expect(r.checked).toBe("2026-11-19");
    expect(r.scenarios.map((s) => s.id)).toEqual(["H1", "H2", "H3", "R001", "R002", "R003"]);
    expect(r.totals).toMatchObject({ scenarios: 6, randomized: 3, hand_written: 3, passed: 5, failed: 1, calls: 60, faults: 12, crashes: 6, webhooks: 24, forged_webhooks: 6 });
    // Each kind summed over every scenario.
    expect(r.totals.faults_by_kind).toEqual({ lost_answer: 1 + 1 + 2 + 1 + 1, http500: 1 + 1 + 1 + 1, http503: 3 });
  });

  it("reads each payment's end state from the I4 detail, and says 'no proposal' when it names none", () => {
    const end = Object.fromEntries(r.scenarios.map((s) => [s.id, s.end]));
    expect(end).toEqual({ H1: "EXECUTED", H2: "APPROVED", H3: "FAILED", R001: "EXECUTED+FAILED", R002: "no proposal", R003: "EXECUTED" });
    expect(r.totals.end_states).toEqual({ EXECUTED: 3, APPROVED: 1, FAILED: 2, "no proposal": 1 });
  });

  it("counts payments that went to a person and scenarios with a silent approval", () => {
    expect(r.totals.to_a_person).toBe(1);
    expect(r.totals.silent_approvals).toBe(3);
  });

  it("tallies each invariant held and broken, with its words", () => {
    expect(r.invariants.I1).toEqual({ held: 5, broken: 1, what: INVARIANT_WORDS.I1 });
    for (const id of ["I2", "I3", "I4", "I5"]) expect(r.invariants[id]).toMatchObject({ held: 6, broken: 0 });
  });

  it("calls a canary caught only when an invariant broke, and names which", () => {
    expect(r.canaries).toEqual([
      { id: "C1", title: "pay twice", caught: true, by: ["I1", "I3"] },
      { id: "C2", title: "a canary nothing catches", caught: false, by: [] },
    ]);
  });

  it("keeps the outcome of hand-written, failed and silent scenarios only, and their params without id, title or seed", () => {
    const s = Object.fromEntries(r.scenarios.map((x) => [x.id, x]));
    expect(s.H1!.outcome).toEqual(["H1 life 1"]);
    expect(s.R001).not.toHaveProperty("outcome");
    expect(s.R002!.outcome).toEqual(["life 1: crash", "life 2: retry"]);
    expect(s.R002!.broken).toEqual([{ id: "I1", detail: "paid twice: two transfers for P-1" }]);
    expect(s.R003!.silent_approvals).toEqual(["P-9"]);
    expect(s.R001).not.toHaveProperty("silent_approvals");
    expect(s.H1!.params).not.toHaveProperty("id");
    expect(s.H1!.params).not.toHaveProperty("title");
    expect(s.H1!.params).not.toHaveProperty("seed");
    expect(s.H1!.params).toMatchObject({ invoices: 1, faultRate: 0.15, hookCopies: 2 });
  });
});

describe("the chaos report in Markdown", () => {
  it("states the totals, the canaries, each finding with its repro, and why approvals sat silent", () => {
    const r = chaosReport(42, [R1, R2, R3], [H1, H2, H3], [C1, C2], "2026-11-19");
    const md = chaosMarkdown(r, [H1, H2, H3]);
    expect(md).toContain("seed 42: **6 scenarios (3 randomized, 3 hand-written), 5 passed, 1 failed**");
    expect(md).toContain(`| I1: ${INVARIANT_WORDS.I1} | 5 | 1 |`);
    expect(md).toContain("faults injected: 12 (lost_answer 6, http500 4, http503 3); process deaths: 6.");
    expect(md).toContain("Webhooks delivered: 24, of which forged: 6.");
    expect(md).toContain("| pay twice (`C1`) | yes | I1, I3 |");
    expect(md).toContain("| a canary nothing catches (`C2`) | **NO** | - |");
    expect(md).toContain("### R002: scenario R002 (seed 7)");
    expect(md).toContain("- I1 broken: paid twice: two transfers for P-1");
    expect(md).toContain("- Repro: `npm run chaos:money -- --only R002` (seed 42)");
    expect(md).toContain("    life 2: retry");
    expect(md).not.toContain("No invariant was broken in any scenario.");
    // One silent approval per reason the calm life gave.
    expect(md).toContain("In 3 scenario(s) an approved proposal was refused");
    expect(md).toContain("Why they were refused: terms changed after the approval 1, the EUR floor 1, another refusal 1. Seen in: H2, H3, R003.");
    // A pipe in a title is escaped in the table; the randomized table lists only R scenarios.
    expect(md).toContain("| `H1` lost answer \\| then a retry | held | P-1 EXECUTED, PAID at Airwallex |");
    expect(md).toContain("| `R002` | 2 | 1 | **broken** | no proposal |");
    expect(md).not.toMatch(/\| `H1` \| 2 \|/);
  });

  it("says no invariant was broken, and has no silent-approval section, when none was", () => {
    const r = chaosReport(1, [R1], [H1], [], "2026-11-20");
    const md = chaosMarkdown(r, [H1]);
    expect(md).toContain("No invariant was broken in any scenario.");
    expect(md).not.toContain("Observation: an approved payment refused");
    expect(md).toContain("| `R001` | 2 | 1 | held | EXECUTED+FAILED |");
  });

  it("marks a broken hand-written scenario in its table", () => {
    const bad = result("H9", { title: "bad", i4: "P-1 FAILED", broken: { I2: "unsigned" } });
    const md = chaosMarkdown(chaosReport(1, [], [bad], [], "2026-11-20"), [bad]);
    expect(md).toContain("| `H9` bad | **broken** | P-1 FAILED |");
  });
});
