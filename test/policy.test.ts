import { describe, expect, it } from "vitest";
import { INITIAL_MANDATES, TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { planReplaceSteps, priceRiseOptions } from "../src/policy/mandates.js";
import { routeRefundBatch } from "../src/policy/refunds.js";
import { checkQuoteAgainstFloor, planInvoice, proposalExpiry, type TreasuryState } from "../src/policy/treasury.js";

describe("initial mandates", () => {
  it("add up to exactly the total", () => {
    const sum = Object.values(INITIAL_MANDATES).reduce((s, m) => s + m.budgetCents, 0);
    expect(sum).toBe(TOTAL_BUDGET_CENTS);
  });
});

describe("price rise (S1)", () => {
  it("prices the options from the brief", () => {
    const [a, b, c] = priceRiseOptions(5, 7, 4);
    expect(a).toMatchObject({ id: "A", marginCents: 1, marginPercent: 20 });
    expect(b).toMatchObject({ id: "B", marginCents: 3, marginPercent: 43 });
    expect(c).toMatchObject({ id: "C", sellCents: null });
  });

  const now = [
    { agent: "sourcing" as const, capCents: 3, budgetCents: 1000, spentCents: 80 },
    { agent: "support" as const, capCents: 10, budgetCents: 400, spentCents: 0 },
    { agent: "treasury" as const, capCents: 600, budgetCents: 600, spentCents: 0 },
  ];

  it("shrinks treasury before growing sourcing, never over 20.00", () => {
    const steps = planReplaceSteps(now, [
      { agent: "sourcing", capCents: 4, budgetCents: 1200 },
      { agent: "treasury", capCents: 400, budgetCents: 400 },
    ]);
    expect(steps.map((s) => [s.agent, s.totalAfterCents])).toEqual([
      ["treasury", 1800],
      ["sourcing", 2000],
    ]);
  });

  it("refuses a plan that breaks the total", () => {
    expect(() => planReplaceSteps(now, [{ agent: "sourcing", capCents: 4, budgetCents: 1200 }])).toThrow(/over the 2000 total/);
  });

  it("refuses a budget at or under the spend carried over", () => {
    expect(() => planReplaceSteps(now, [{ agent: "sourcing", capCents: 4, budgetCents: 80 }])).toThrow(/must exceed spend/);
  });

  it("skips agents whose limits do not change", () => {
    const steps = planReplaceSteps(now, [{ agent: "support", capCents: 10, budgetCents: 400 }]);
    expect(steps).toEqual([]);
  });
});

describe("refunds (S2)", () => {
  it("runs three 5-cent refunds on their own", () => expect(routeRefundBatch([5, 5, 5])).toEqual({ route: "auto" }));
  it("escalates refunding all twelve", () => expect(routeRefundBatch(Array(12).fill(5)).route).toBe("approval"));
  it("escalates one large refund", () => expect(routeRefundBatch([11]).route).toBe("approval"));
});

describe("euro bill (S3)", () => {
  const s: TreasuryState = {
    eurAvailableCents: 1_000_000,
    eurFloorCents: 50_000,
    eurObligationsCents: 800_000,
    usdAvailableCents: 2_500_000,
    usdFloorCents: 2_000_000,
  };

  it("converts only the shortfall, fee ceiling included", () => {
    expect(planInvoice(185_000, s)).toEqual({ kind: "convert_shortfall", needEurCents: 187_000, freeEurCents: 150_000, buyEurCents: 37_000 });
  });

  it("pays straight from EUR when free EUR covers it", () => {
    expect(planInvoice(100_000, s).kind).toBe("pay_from_eur");
  });

  it("escalates when the USD side would break its floor", () => {
    expect(checkQuoteAgainstFloor(42_000, s).ok).toBe(true);
    expect(checkQuoteAgainstFloor(500_001, s).ok).toBe(false);
  });

  it("expires a proposal 30 s before its quote", () => {
    expect(proposalExpiry(0, 600_000, 60_000)).toBe(30_000);
    expect(proposalExpiry(0, 600_000)).toBe(600_000);
  });
});
