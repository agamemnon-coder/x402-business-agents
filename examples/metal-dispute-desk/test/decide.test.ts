// The seller's rules on plain data: every row of the case table, plus the invariants that must hold for any input.
import { describe, expect, it } from "vitest";
import { CLAIM_WORDS, decideDispute, type DisputeClaim } from "../src/index.js";
import { CASES, CUSTOMER, pack } from "./cases.js";

describe("decideDispute: the case table", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const d = decideDispute(c.claim, c.packs);
      expect(d.claim).toBe(c.claim);
      expect(d.outcome).toBe(c.outcome);
      expect(d.per_sale.map((s) => s.sale_id)).toEqual(c.packs.map((p) => p.sale_id));
      expect(d.per_sale.map((s) => s.refund_cents)).toEqual(c.refunds);
      expect(d.refund_cents).toBe(c.refunds.reduce((a, b) => a + b, 0));
      c.why.forEach((re, i) => { if (re) expect(d.per_sale[i]!.why).toMatch(re); });
    });
  }
});

describe("decideDispute: invariants", () => {
  const claims = Object.keys(CLAIM_WORDS) as DisputeClaim[];

  it("refunds only to the account that paid", () => {
    for (const claim of claims) expect(decideDispute(claim, [pack({ sale_id: 1 })]).refund_to).toBe(CUSTOMER);
  });

  it("never refunds more than was charged less what was already refunded, for any claim", () => {
    const packs = [
      pack({ sale_id: 1, charged_cents: 7, order: { ...pack({ sale_id: 1 }).order, amount_cents: 0, valid: false } }),
      pack({ sale_id: 2, charged_cents: 9, refunded_cents: 4, data_wrong: true }),
      pack({ sale_id: 3, request: "GET /v1/stock?seq=2", refunded_cents: 5 }),
    ];
    for (const claim of claims) {
      for (const s of decideDispute(claim, packs).per_sale) {
        const p = packs.find((x) => x.sale_id === s.sale_id)!;
        expect(s.refund_cents).toBeGreaterThanOrEqual(0);
        expect(s.refund_cents).toBeLessThanOrEqual(p.charged_cents - (p.refunded_cents ?? 0));
      }
    }
  });

  it("gives every payment a reason in words", () => {
    for (const claim of claims) for (const s of decideDispute(claim, [pack({ sale_id: 1 })]).per_sale) expect(s.why.length).toBeGreaterThan(10);
  });

  it("names each claim in the customer's words", () => {
    expect(claims).toEqual(["never_ordered", "wrong_price", "not_authorised", "wrong_data", "forged_order", "double_charged"]);
    expect(CLAIM_WORDS.double_charged).toBe("we were charged twice");
  });
});
