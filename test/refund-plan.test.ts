// dry-125 (soak, 1 November): the disputed numbers that the supplier corrected were never sold in that world, so code's
// data check found nothing wrong, and the dispute script crashed on "empty refund batch" before it could send the
// customer's "refund all" to the CFO. Nothing to refund is a plan of its own; the shared rule still refuses an empty batch.
import { describe, expect, it } from "vitest";
import { planRefunds, routeRefundBatch } from "../src/policy/refunds.js";

const limits = { eachCents: 10, perDisputeCents: 20 };

describe("planning a dispute's refunds", () => {
  it("plans nothing when code's data check finds no delivered sale wrong", () => {
    expect(planRefunds([], limits)).toEqual({ route: "none" });
  });
  it("routes a non-empty batch with the shared rule", () => {
    expect(planRefunds([5, 5], limits)).toEqual({ route: "auto" });
    expect(planRefunds([5, 5, 5, 10], limits)).toMatchObject({ route: "approval" });
  });
  it("keeps the shared rule's guard: routing an empty batch is still an error", () => {
    expect(() => routeRefundBatch([], limits)).toThrow(/empty refund batch/);
  });
});
