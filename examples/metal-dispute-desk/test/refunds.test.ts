// Who pays the refund out: small ones run on their own, one large refund or a large batch waits for a person.
import { describe, expect, it } from "vitest";
import { routeRefundBatch } from "../src/index.js";

const limits = { eachCents: 10, perDisputeCents: 20 };

describe("routeRefundBatch", () => {
  it("runs refunds within both limits on their own", () => {
    expect(routeRefundBatch([5, 5, 5], limits)).toEqual({ route: "auto" });
    expect(routeRefundBatch([10, 10], limits)).toEqual({ route: "auto" });
  });

  it("sends one refund over the per-refund limit to a person", () => {
    expect(routeRefundBatch([5, 11], limits)).toEqual({ route: "approval", reason: "one refund is 11 cents, over the 10 cent limit" });
  });

  it("sends a batch over the per-dispute limit to a person", () => {
    expect(routeRefundBatch(Array(5).fill(5), limits)).toEqual({ route: "approval", reason: "the batch is 25 cents, over the 20 cent limit per dispute" });
  });

  it("refuses an empty batch and amounts that are not whole positive cents", () => {
    expect(() => routeRefundBatch([], limits)).toThrow(/empty refund batch/);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => routeRefundBatch([bad], limits)).toThrow(/bad refund amount/);
  });
});
