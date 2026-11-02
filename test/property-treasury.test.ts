// Property tests on the money rules (Max, 2 November, enterprise QA 2.5): the SWIFT fee reserve, the invoice plan
// and the order of mandate replaces. Each property is a rule code must keep for every input, not one example.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SWIFT_FEE_MAX_EUR_CENTS, TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { feeReserveCents, planInvoice, SWIFT_FEE_BUFFER } from "../src/policy/treasury.js";
import { planReplaceSteps, type MandateNow } from "../src/policy/mandates.js";

const cents = (max: number) => fc.integer({ min: 1, max });
const fees = fc.array(fc.integer({ min: 0, max: 50_000 }), { maxLength: 20 });

describe("the SWIFT fee reserve, for any fees Airwallex charged", () => {
  it("is never under the ceiling, and always covers the highest fee plus the buffer", () => {
    fc.assert(fc.property(fees, (f) => {
      const r = feeReserveCents(f);
      expect(r).toBeGreaterThanOrEqual(SWIFT_FEE_MAX_EUR_CENTS);
      expect(r).toBeGreaterThanOrEqual(Math.max(0, ...f) * SWIFT_FEE_BUFFER);
      expect(Number.isSafeInteger(r)).toBe(true);
    }));
  });
  it("never falls when a new fee is recorded", () => {
    fc.assert(fc.property(fees, fc.integer({ min: 0, max: 50_000 }), (f, extra) => {
      expect(feeReserveCents([...f, extra])).toBeGreaterThanOrEqual(feeReserveCents(f));
    }));
  });
});

describe("the invoice plan, for any invoice, balances and fee reserve", () => {
  const state = fc.record({
    eurAvailableCents: fc.integer({ min: 0, max: 10_000_000 }), eurFloorCents: fc.integer({ min: 0, max: 5_000_000 }),
    eurObligationsCents: fc.integer({ min: 0, max: 5_000_000 }), usdAvailableCents: fc.integer({ min: 0, max: 10_000_000 }), usdFloorCents: fc.integer({ min: 0, max: 5_000_000 }),
  });
  it("needs exactly the invoice plus the reserve, and converts only the shortfall", () => {
    fc.assert(fc.property(cents(5_000_000), state, fees, (inv, s, f) => {
      const reserve = feeReserveCents(f);
      const p = planInvoice(inv, s, reserve);
      expect(p.needEurCents).toBe(inv + reserve);
      const free = s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents;
      if (free < 0) expect(p.kind).toBe("underfunded");
      else if (free >= p.needEurCents) expect(p.kind).toBe("pay_from_eur");
      else {
        expect(p.kind).toBe("convert_shortfall");
        if (p.kind === "convert_shortfall") {
          // after converting, free EUR covers the need exactly: never short, never more bought than needed
          expect(p.buyEurCents + free).toBe(p.needEurCents);
          expect(p.buyEurCents).toBeGreaterThan(0);
        }
      }
    }));
  });
  it("refuses a reserve under the ceiling", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: SWIFT_FEE_MAX_EUR_CENTS - 1 }), (r) => {
      expect(() => planInvoice(24_000, { eurAvailableCents: 1, eurFloorCents: 0, eurObligationsCents: 0, usdAvailableCents: 0, usdFloorCents: 0 }, r)).toThrow(/fee reserve/);
    }));
  });
});

describe("mandate replaces, for any current mandates and targets", () => {
  const agents = ["sourcing", "support", "treasury"] as const;
  it("never bind more than the 20.00 total after any single step, or are refused", () => {
    fc.assert(fc.property(
      fc.tuple(cents(1000), cents(1000), cents(1000)), fc.tuple(fc.nat(500), fc.nat(500), fc.nat(500)),
      fc.tuple(cents(1500), cents(1500), cents(1500)), fc.tuple(cents(100), cents(100), cents(100)),
      (budgets, spent, newBudgets, caps) => {
        const current: MandateNow[] = agents.map((a, i) => ({ agent: a, capCents: 3, budgetCents: budgets[i]!, spentCents: Math.min(spent[i]!, budgets[i]! - 1) }));
        const targets = agents.map((a, i) => ({ agent: a, capCents: Math.min(caps[i]!, newBudgets[i]!), budgetCents: newBudgets[i]! }));
        let steps;
        try { steps = planReplaceSteps(current, targets); } catch { return; }
        for (const s of steps) expect(s.totalAfterCents).toBeLessThanOrEqual(TOTAL_BUDGET_CENTS);
        // each new budget exceeds what the agent already spent (a replace carries spend over)
        for (const s of steps) expect(s.budgetCents).toBeGreaterThan(current.find((c) => c.agent === s.agent)!.spentCents);
      },
    ));
  });
});
