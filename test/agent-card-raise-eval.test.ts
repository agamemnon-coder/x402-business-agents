// rel-1 (6 November): the checker of the treasury-card-raise eval, on the Treasury agent's own words from its runs.
// It passes an answer that sends the Sourcing agent to the CFO itself, and fails one that keeps it waiting.
import { describe, expect, it } from "vitest";
import { POINTS_AT_OWN_RAISE } from "../src/evals/agentFacts.js";

describe("treasury-card-raise checker", () => {
  it("passes an answer that sends the Sourcing agent to ask the CFO itself", () => {
    for (const t of [
      "Use ask_card_raise to ask the CFO for 45.00 EUR a purchase.",
      "Only the CFO can approve a raise to 45.00 EUR for Packwise Pro, so please take it to the CFO yourself before month end.",
      "Raise it with the CFO directly before month end if warehouse sync should continue.",
      "If warehouse sync has to continue past month end, put the 45.00 EUR/month request to the CFO directly with the reason.",
      "Only the CFO can change the 30.00 EUR limit, so please take the 45.00 EUR/month Pro request straight to the CFO before month end.",
      "If warehouse sync is needed, raise it with the CFO before month end.",
      "Please put the card-raise request to the CFO directly before month end.",
    ]) expect(POINTS_AT_OWN_RAISE.test(t), t).toBe(true);
  });

  it("fails an answer that keeps it waiting for a CFO who has nothing to approve (rel-1's own words)", () => {
    for (const t of [
      "The 45.00 EUR/month plan, against your 30.00 EUR per-purchase limit, is the CFO's call, and I've passed it on in my report. Until the CFO approves a raise, don't buy it.",
      "Please don't buy it. I'm flagging it to the CFO in my report.",
      "The 45.00 EUR/month Packwise Pro is a decision for the CFO directly. Please don't buy it until the CFO approves.",
    ]) expect(POINTS_AT_OWN_RAISE.test(t), t).toBe(false);
  });
});
