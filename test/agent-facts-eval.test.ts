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

  // Opus's own words in this eval's runs (2 November): before the fix (code without paid invoices in the facts) and after.
  it("reads Opus's words in the eval's runs as they are: unpaid before the fix, paid after it", () => {
    for (const before of [
      "I took no action on this routine check. No agent is blocked by its mandate. There are no net earnings to sweep, no customer payments have come in and nothing is waiting for the CFO. Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid: the CFO closed or let lapse both payouts I planned today. With 13 days left, I'll plan it again closer to the due date unless I hear the invoice i",
      "No action this check. No agent is limited by its mandate, there are no net earnings to sweep, and nothing waits for the CFO. Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid. As decided at 16:14, I'll plan it again closer to the d",
      "I took no action on this routine check. No agent is blocked by its mandate. The total stays at 20.00, and the 0.06 query price still keeps a margin over the 0.04 and 0.03 stock-check costs. Net earnings waiting to be swept are 0.00, and nothing waits for the CFO. The Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is presumably still unpaid. I'll plan it again closer to the due date unless ",
      "No action this check: no agent is blocked, net earnings are 0.00, nothing waits for the CFO. Stockline SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid after the CFO closed or let two plans lapse, and I'll plan it again closer to the due date unless told it is disputed.",
    ]) expect(callsLicenceUnpaid(before)).toBe(true);
    for (const after of [
      "No action. The ledger shows Stockline invoice SLL-2026-11 (EUR 240.00) as paid at 16:30 UTC through Airwallex transfer tr_4 under P-0001, so I'm dropping my earlier plan to plan it again before 15 Nov. No other invoices are open.",
      "I took no action this check. The ledger shows Stockline invoice SLL-2026-11 (EUR 240.00) as paid at 16:30 UTC through Airwallex transfer tr_4 (P-0001). That settles it, so I won't plan it again, even though my 16:15 note still had it as unpaid.",
      "No action. The ledger shows Stockline invoice SLL-2026-11 (EUR 240.00) paid at 16:30 UTC via Airwallex transfer tr_4 under P-0001. That replaces my 16:15 note that it was still unpaid, so I won't plan it again.",
      "No action this check. The ledger shows Stockline invoice SLL-2026-11 (EUR 240.00) as paid at 16:30 UTC through Airwallex transfer tr_4 under P-0001. I won't plan it again, and this replaces my 16:15 note that it was still open.",
      "No action this check. The ledger shows Stockline invoice SLL-2026-11 (EUR 240.00) paid at 16:31 UTC through Airwallex transfer tr_4 under P-0001, so I won't plan it again, which I had said I would do closer to the due date.",
      "No action this check. The ledger shows Stockline invoice SLL-2026-11 (EUR 240.00) was paid at 16:44 UTC by Airwallex transfer tr_4, under payment P-0001 rather than my later plans P-0005 and P-0006. So I'm dropping my plan to plan it again before 15 Nov, and nothing else is open.",
    ]) expect(callsLicenceUnpaid(after)).toBe(false);
  });
});
