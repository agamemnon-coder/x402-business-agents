// The Scenario Lab (E) as a regression test: every scenario in the CFO's test script must behave as expected.
import { describe, expect, it } from "vitest";
import { runScenario, SCENARIOS } from "../src/lab/scenarios.js";

describe("the Scenario Lab", () => {
  it("has the twelve scenarios of the test script, each with an expectation and an honest offline note", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["normal-purchase", "over-limit-raise", "price-rise", "changed-bank-details", "ai-trick", "duplicate-invoice", "velocity-stop", "emergency-stop", "outside-agent", "reconciliation-difference", "ask-purser", "unknown-sender"]);
    for (const s of SCENARIOS) expect(s.expected.length > 20 && s.offline.length > 10).toBe(true);
  });

  for (const s of SCENARIOS) {
    it(`${s.id}: ${s.title}`, async () => {
      const r = await runScenario(s);
      expect(r.happened, r.happened).not.toMatch(/^the scenario stopped/);
      expect(r.passed, r.happened).toBe(true);
    });
  }
});
