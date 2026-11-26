// Chaos for money movement (npm run chaos:money, src/chaos/money.ts): the real executor, saga, Airwallex client and
// recovery against a stand-in Airwallex with faults, process deaths, skewed clocks and webhook storms. Here: every
// hand-written scenario, the first 100 randomized ones of the committed seed (the full run makes 300), and the canaries,
// planted breaks each invariant must catch. The committed report is checked against the code that made it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAOS_COUNT, CHAOS_SEED, chaosMoney } from "../src/cli/chaosMoney.js";
import { HAND_WRITTEN, randomScenarios, runScenario } from "../src/chaos/money.js";
import type { ChaosReport } from "../src/chaos/report.js";

describe("chaos for money movement", () => {
  it("hand-written and randomized scenarios break no invariant; every canary is caught", { timeout: 600_000 }, async () => {
    const r = await chaosMoney({ count: 100 });
    expect(r.hand).toHaveLength(HAND_WRITTEN.length);
    expect(r.random).toHaveLength(100);
    const broken = [...r.hand, ...r.random].filter((x) => !x.ok).map((x) => `${x.id}: ${x.invariants.filter((i) => !i.ok).map((i) => `${i.id} ${i.detail}`).join("; ")}`);
    expect(broken).toEqual([]);
    // Outside audit 2.1: every approved payment refused before it began was named by an alarm while it waited (I4 fails
    // otherwise); H17's second approval, refused at the EUR floor, is recorded and shown, not silent.
    expect([...r.hand, ...r.random].flatMap((x) => x.silentApprovals)).toEqual([]);
    expect(r.hand.find((x) => x.id === "H17")!.blockedShown).toEqual(["P-0002"]);
    // The scenarios do what they say: faults were injected and processes died.
    expect(r.random.reduce((s, x) => s + x.faults, 0)).toBeGreaterThan(100);
    expect([...r.hand, ...r.random].reduce((s, x) => s + x.crashes, 0)).toBeGreaterThan(20);
    for (const c of r.canaries) expect({ canary: c.id, caught: !c.ok }).toEqual({ canary: c.id, caught: true });
    // The ones planted against one invariant are caught by it.
    const by = (id: string) => r.canaries.find((c) => c.id === id)!.invariants.filter((i) => !i.ok).map((i) => i.id);
    expect(by("C1")).toContain("I1");
    expect(by("C2")).toContain("I2");
    expect(by("C3")).toContain("I3");
    expect(by("C4")).toContain("I4");
  });

  it("the scenarios are the seed's: the same seed makes the same scenarios", () => {
    expect(randomScenarios(CHAOS_SEED, 5)).toEqual(randomScenarios(CHAOS_SEED, 5));
    expect(randomScenarios(CHAOS_SEED, 300).slice(0, 100)).toEqual(randomScenarios(CHAOS_SEED, 100));
  });

  it("the committed report is a full run of the committed seed, and says what it found", () => {
    const report = JSON.parse(readFileSync(new URL("../docs/evidence/chaos-money.json", import.meta.url), "utf8")) as ChaosReport;
    const md = readFileSync(new URL("../docs/evidence/chaos-money.md", import.meta.url), "utf8");
    expect(report.format).toBe("purser.chaos-money/v1");
    expect(report.seed).toBe(CHAOS_SEED);
    expect(report.totals.randomized).toBe(CHAOS_COUNT);
    expect(report.totals.randomized).toBeGreaterThanOrEqual(200);
    expect(report.totals.hand_written).toBe(HAND_WRITTEN.length);
    expect(report.totals.scenarios).toBe(report.totals.passed + report.totals.failed);
    expect(report.scenarios.filter((s) => s.id.startsWith("R")).map((s) => s.params)).toEqual(randomScenarios(CHAOS_SEED, CHAOS_COUNT).map(({ id: _i, title: _t, seed: _s, ...rest }) => rest));
    expect(report.canaries.every((c) => c.caught)).toBe(true);
    expect(md).toContain(`**${report.totals.scenarios} scenarios (${report.totals.randomized} randomized, ${report.totals.hand_written} hand-written), ${report.totals.passed} passed, ${report.totals.failed} failed**`);
    for (const s of report.scenarios.filter((x) => !x.ok)) expect(md).toContain(`### ${s.id}:`);
    if (report.totals.silent_approvals) expect(md).toContain("Observation: an approved payment refused before it begins raises no alarm");
    expect(report.totals.silent_approvals).toBe(0);
    if (report.totals.blocked_shown) expect(md).toContain("### Approved payments refused before they began are shown (outside audit 2.1)");
  });
});

describe("the stand-in Airwallex under concurrent lives", () => {
  // Nightly 26 Nov (seed 20261126, R2277): two concurrent lives, and one read GET /transfers?request_id= in the moment
  // between the fake adding the transfer under its own id (tr_N) and the stand-in giving it the Airwallex id; the ledger
  // kept tr_N and the reconciliation found no such transfer. The stand-in now gives the id before any await.
  it("holds the scenario that once read a transfer under the fake's id", async () => {
    const sc = randomScenarios(20261126, 2277).at(-1)!;
    expect(sc.id).toBe("R2277");
    expect(sc.concurrent).toBe(true);
    const res = await runScenario(sc);
    expect(res.invariants.filter((i) => !i.ok)).toEqual([]);
    expect(res.ok).toBe(true);
  }, 60_000);
});
