// The eval cases for agent run 1's wrong facts (src/evals/agentFacts.ts) judge the agents' words with three small
// classifiers. Here they read the run's own words (from data/agent-1.sqlite's agent.decision and agent.message rows) and
// the corrected ones: a classifier that missed the run's wrong words would let a wrong fact pass the eval. No Claude.
import { describe, expect, it } from "vitest";
import { callsLicenceUnpaid, callsStocklineDown, pointsAtRidgeline } from "../src/evals/agentFacts.js";

describe("the classifiers of the agent-facts eval cases", () => {
  it("catches Sourcing calling Stockline unreachable (run 1, 10:48 and 12:58), not a clause about Ridgeline alone", () => {
    expect(callsStocklineDown("Both Stockline and Ridgeline are unreachable right now, so buying would fail or pay for nothing.")).toBe(true);
    expect(callsStocklineDown("Market now shows both suppliers unreachable (Stockline was 0.02 earlier; Ridgeline in maintenance until 22:42 UTC).")).toBe(true);
    expect(callsStocklineDown("Routine check: market unchanged. Stockline and Ridgeline are both unreachable right now, and the mandate is 0.04 per purchase.")).toBe(true);
    expect(callsStocklineDown("Stockline raised its price to 0.04 per stock check, which is above our 0.03 per-purchase cap, so purchases are blocked. Ridgeline is unreachable until its maintenance ends at 22:42 UTC.")).toBe(false);
    expect(callsStocklineDown("Stockline did not answer one price check; Ridgeline is offline until 22:42.")).toBe(false);
  });

  it("catches Treasury pointing Sourcing at Ridgeline (run 1, 10:49), not advice for after the maintenance", () => {
    expect(pointsAtRidgeline("Thanks. Stockline at 0.04 is over your 0.03 cap, but Ridgeline Data sells a stock check at 0.03. That fits your cap and leaves a 0.02 margin on the 0.05 price, compared with 0.01 at Stockline. Please buy stock checks from Ridgeline instead of serving only from cache.")).toBe(true);
    expect(pointsAtRidgeline("No rebalance: Sourcing can still do its job, because Ridgeline Data at 0.03 fits its 0.03 cap and keeps a 0.02 margin, better than Stockline's 0.01 at 0.04.")).toBe(true);
    expect(pointsAtRidgeline("No rebalance. Stockline's 0.04 is over the 0.03 sourcing cap, but Ridgeline Data at 0.03 fits the cap and keeps a 0.02 margin on the 0.05 query price.")).toBe(true);
    expect(pointsAtRidgeline("Treasury: I take back my earlier advice to switch to Ridgeline, because it is down until 22:42 UTC. After 22:42, go back to Ridgeline at 0.03.")).toBe(false);
    expect(pointsAtRidgeline("Sourcing is blocked until 22:42 UTC: Ridgeline is down for maintenance, and Stockline at 0.04 is over the 0.03 cap.")).toBe(false);
  });

  it("catches Treasury calling the paid licence unpaid (run 1, 14:40), not a sentence that says it is paid", () => {
    expect(callsLicenceUnpaid("No action on this routine check, because nothing has changed since 14:25. Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid.")).toBe(true);
    expect(callsLicenceUnpaid("With 13 days left, I'll plan it again closer to the due date unless I hear it's disputed.")).toBe(true);
    expect(callsLicenceUnpaid("SLL-2026-11 is paid (P-0007, Airwallex transfer 7bbb3d61); nothing is owed and nothing to plan.")).toBe(false);
    expect(callsLicenceUnpaid("No action: nothing changed, nothing waits for the CFO.")).toBe(false);
  });
});
