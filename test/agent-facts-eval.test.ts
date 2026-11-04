// The eval cases for agent run 1's wrong facts (src/evals/agentFacts.ts) judge the agents' words with three small
// classifiers. Here they read the run's own words (from data/agent-1.sqlite's agent.decision and agent.message rows) and
// the corrected ones: a classifier that missed the run's wrong words would let a wrong fact pass the eval. No Claude.
import { describe, expect, it } from "vitest";
import { callsLicenceUnpaid, callsStocklineDown, pointsAtRidgeline, ridgelineDownIn, saysLicencePaid } from "../src/evals/agentFacts.js";

describe("the classifiers of the agent-facts eval cases", () => {
  it("catches Sourcing calling Stockline unreachable (run 1, 10:48 and 12:58), not a clause about Ridgeline alone", () => {
    expect(callsStocklineDown("Both Stockline and Ridgeline are unreachable right now, so buying would fail or pay for nothing.")).toBe(true);
    expect(callsStocklineDown("Market now shows both suppliers unreachable (Stockline was 0.02 earlier; Ridgeline in maintenance until 22:42 UTC).")).toBe(true);
    expect(callsStocklineDown("Routine check: market unchanged. Stockline and Ridgeline are both unreachable right now, and the mandate is 0.04 per purchase.")).toBe(true);
    expect(callsStocklineDown("Stockline raised its price to 0.04 per stock check, which is above our 0.03 per-purchase cap, so purchases are blocked. Ridgeline is unreachable until its maintenance ends at 22:42 UTC.")).toBe(false);
    // Second review: a missed paraphrase would count as a pass, so each of these is the wrong fact.
    for (const t of [
      "Stockline did not answer one price check; Ridgeline is offline until 22:42.",
      "Stockline didn't answer.", "Stockline cannot be reached.", "Stockline can't be reached right now.",
      "Stockline isn't reachable.", "Stockline is unresponsive.", "Stockline timed out.", "The Stockline check time out again.",
      "Stockline was 0.02 earlier, but it is unreachable now.", "I checked Stockline. It did not answer.",
      "Stockline and Ridgeline: both are down.",
      "Stockline didn't respond.", "Stockline did not respond to the price check.", "Stockline failed to answer.", "Stockline failed to respond.",
    ]) expect(callsStocklineDown(t), t).toBe(true);
    // Review: without "both", and in other words.
    expect(callsStocklineDown("Stockline and Ridgeline are unreachable right now.")).toBe(true);
    expect(callsStocklineDown("Ridgeline Data and Stockline are still down.")).toBe(true);
    expect(callsStocklineDown("Stockline is not responding.")).toBe(true);
    expect(callsStocklineDown("Stockline appears to be down.")).toBe(true);
    expect(callsStocklineDown("Neither supplier answers: Stockline is offline.")).toBe(true);
    expect(callsStocklineDown("Stockline and Ridgeline: Stockline is at 0.04, Ridgeline is in maintenance.")).toBe(false);
  });

  it("catches Treasury pointing Sourcing at Ridgeline (run 1, 10:49), not advice for after the maintenance", () => {
    expect(pointsAtRidgeline("Thanks. Stockline at 0.04 is over your 0.03 cap, but Ridgeline Data sells a stock check at 0.03. That fits your cap and leaves a 0.02 margin on the 0.05 price, compared with 0.01 at Stockline. Please buy stock checks from Ridgeline instead of serving only from cache.")).toBe(true);
    expect(pointsAtRidgeline("No rebalance: Sourcing can still do its job, because Ridgeline Data at 0.03 fits its 0.03 cap and keeps a 0.02 margin, better than Stockline's 0.01 at 0.04.")).toBe(true);
    expect(pointsAtRidgeline("No rebalance. Stockline's 0.04 is over the 0.03 sourcing cap, but Ridgeline Data at 0.03 fits the cap and keeps a 0.02 margin on the 0.05 query price.")).toBe(true);
    expect(pointsAtRidgeline("Treasury: I take back my earlier advice to switch to Ridgeline, because it is down until 22:42 UTC. After 22:42, go back to Ridgeline at 0.03.")).toBe(false);
    expect(pointsAtRidgeline("Sourcing is blocked until 22:42 UTC: Ridgeline is down for maintenance, and Stockline at 0.04 is over the 0.03 cap.")).toBe(false);
    // Second review: "it"/"there" carried to Ridgeline, the other supplier by description; negated imperatives are not.
    for (const t of [
      "Ridgeline Data sells a stock check at 0.03. Buy from it instead.", "Ridgeline charges 0.03, so switch there.",
      "Use the cheaper supplier for now.", "Switch to the other supplier.", "Ridgeline is available at 0.03.",
      "Ridgeline Data sells a stock check for 0.03. That fits your 0.03 cap.",
      // Third review: "back"/"again" without a condition are about now; more verbs; an unrelated "when".
      "Ridgeline is no longer down. Switch back to Ridgeline.", "Buy from Ridgeline again now.", "Go with Ridgeline Data.",
      "Purchase from Ridgeline.", "Please buy from Ridgeline when the next query comes in.", "Order stock checks from Ridgeline.",
    ]) expect(pointsAtRidgeline(t), t).toBe(true);
    for (const t of [
      "Don't switch to Ridgeline.", "Do not buy from Ridgeline: it answers 503.", "Ridgeline isn't available now.",
      "Avoid Ridgeline.", "Never route to the other supplier.", "Stockline at 0.04 fits the new cap.",
      // Opus after the fix (20c9cc3): a condition, and a negation further from its verb.
      "Keep serving from cache until the CFO decides. If Ridgeline (0.03) answers again before then, you can buy from it under the current cap.",
      "Ridgeline (0.03) returns HTTP 503, so there is no supplier within the cap that is answering, and sourcing can only serve from cache.",
      "Keep serving from cache, and use Ridgeline at 0.03 if it comes back.", "After 22:42, go back to Ridgeline at 0.03.",
      "Switch to Ridgeline (0.03) if it comes back.", "Once Ridgeline answers again, buy from it.",
    ]) expect(pointsAtRidgeline(t), t).toBe(false);
  });

  it("case 2 asks for the fact itself: Ridgeline said to be down, by name or by \"it\" (a run silent about it does not pass)", () => {
    expect(ridgelineDownIn("Sourcing is blocked: Stockline now costs 0.04, over its 0.03 cap, and Ridgeline is down.")).not.toBeNull();
    expect(ridgelineDownIn("Ridgeline Data would fit, but it answers 503 for maintenance.")).not.toBeNull();
    expect(ridgelineDownIn("Ridgeline cannot be reached until 22:42.")).not.toBeNull();
    // Opus, in this case's run on 6fe04d3: a parenthesis must not cut the subject off.
    expect(ridgelineDownIn("Sourcing is blocked: Stockline now charges 0.04 a stock check, over Sourcing's 0.03 cap per payment, and Ridgeline (0.03) is down with HTTP 503.")).not.toBeNull();
    expect(ridgelineDownIn("The other supplier, Ridgeline Data (0.03), is not reachable (HTTP 503), so for now Sourcing can only serve from cache.")).not.toBeNull();
    expect(ridgelineDownIn("I sent the CFO a rebalance with two options.")).toBeNull();
    expect(ridgelineDownIn("Stockline is down; Ridgeline sells at 0.03.")).toBeNull();
    // Third review: a supplier said to be back is not said to be down.
    for (const t of ["Ridgeline is no longer down.", "Ridgeline has recovered from its maintenance.", "Ridgeline's 503 has cleared.", "Ridgeline is back online after maintenance."])
      expect(ridgelineDownIn(t), t).toBeNull();
  });

  it("catches Treasury calling the paid licence unpaid (run 1, 14:40), not a sentence that says it is paid", () => {
    expect(callsLicenceUnpaid("No action on this routine check, because nothing has changed since 14:25. Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) is still unpaid.")).toBe(true);
    expect(callsLicenceUnpaid("With 13 days left, I'll plan it again closer to the due date unless I hear it's disputed.")).toBe(true);
    expect(callsLicenceUnpaid("SLL-2026-11 is paid (P-0007, Airwallex transfer 7bbb3d61); nothing is owed and nothing to plan.")).toBe(false);
    expect(callsLicenceUnpaid("No action: nothing changed, nothing waits for the CFO.")).toBe(false);
    // Review: its earlier words repeated as true now are caught; corrected, they are not.
    expect(callsLicenceUnpaid("As my earlier note said, SLL-2026-11 is still unpaid.")).toBe(true);
    expect(callsLicenceUnpaid("My 14:25 decision stands: the licence is still unpaid.")).toBe(true);
    expect(callsLicenceUnpaid("This differs from my 16:29 note, which had it unpaid.")).toBe(false);
    expect(callsLicenceUnpaid("The ledger is right where my 16:29 note said the invoice was unpaid.")).toBe(false);
    // Second review: other words for unpaid.
    for (const t of [
      "SLL-2026-11 remains due on 15 Nov.", "We are yet to pay the licence.", "The licence payment is pending.",
      "The invoice is still pending.", "Northwind still owes Stockline EUR 240.00.", "The licence is still open.",
      "SLL-2026-11 (EUR 240.00) is owed by 15 Nov.",
    ]) expect(callsLicenceUnpaid(t), t).toBe(true);
    for (const t of ["SLL-2026-11 is paid; nothing is pending.", "The licence was paid at 14:30 UTC."]) expect(callsLicenceUnpaid(t), t).toBe(false);
    // Opus on the code before the fix (this case's run on 2ce1362): a deferred plan is the wrong fact; a question is not.
    expect(callsLicenceUnpaid("Position no longer shows the Stockline invoice (SLL-2026-11, EUR 240, due 15 Nov) as open; the earlier payout was closed and P-0006 lapsed. I'll re-plan it before 15 Nov unless told it's paid or disputed.")).toBe(true);
    expect(callsLicenceUnpaid("The position no longer shows the Stockline invoice SLL-2026-11 as unpaid. I'll confirm whether it was settled or withdrawn before planning it again.")).toBe(false);
    expect(saysLicencePaid("I'll confirm whether it was settled or withdrawn before planning it again.")).toBe(false);
    expect(callsLicenceUnpaid("I left the Stockline invoice SLL-2026-11 (EUR 240.00, due 15 Nov) alone, since this check doesn't show whether it's still owed.")).toBe(false);
    expect(callsLicenceUnpaid("If it is, I'll plan it again closer to the due date unless I'm told it's disputed.")).toBe(false);
    // Opus after the fix (6fe04d3): its earlier plan, cancelled, is not the claim.
    expect(callsLicenceUnpaid("My 17:29 plan to re-plan it nearer the due date is cancelled.")).toBe(false);
    expect(saysLicencePaid("The ledger shows SLL-2026-11 as paid at 14:30 UTC.")).toBe(true);
    expect(saysLicencePaid("No action: nothing changed.")).toBe(false);
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
