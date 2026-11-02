// Property tests on the money rules (Max, 2 November, enterprise QA 2.5): the SWIFT fee reserve, the invoice plan
// and the order of mandate replaces. Each property is a rule code must keep for every input, not one example.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SWIFT_FEE_MAX_EUR_CENTS, TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { feeReserveCents, feeReserveOverCap, planInvoice, SWIFT_FEE_BUFFER, SWIFT_FEE_RESERVE_CAP_CENTS } from "../src/policy/treasury.js";
import { planReplaceSteps, type MandateNow } from "../src/policy/mandates.js";

const cents = (max: number) => fc.integer({ min: 1, max });
const fees = fc.array(fc.integer({ min: 0, max: 50_000 }), { maxLength: 20 });

describe("the SWIFT fee reserve, for any fees Airwallex charged", () => {
  it("is never under the ceiling nor over the cap, and covers the highest fee plus the buffer unless the plan escalates", () => {
    fc.assert(fc.property(fees, (f) => {
      const r = feeReserveCents(f);
      expect(r).toBeGreaterThanOrEqual(SWIFT_FEE_MAX_EUR_CENTS);
      expect(r).toBeLessThanOrEqual(SWIFT_FEE_RESERVE_CAP_CENTS);
      expect(Number.isSafeInteger(r)).toBe(true);
      // either the reserve covers the highest fee plus the buffer, or the plan goes to a person (euroBill)
      expect(r >= Math.max(0, ...f) * SWIFT_FEE_BUFFER || feeReserveOverCap(f)).toBe(true);
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
  // Review (2 November): the rule that matters is that shrinking budgets go first, so a plan whose start and end both
  // fit the 20.00 total is never refused. Generated so that most cases are feasible, and counted.
  it("never refuse a feasible plan, never bind more than 20.00 after any step, and run on real cases", () => {
    let ran = 0;
    fc.assert(fc.property(
      fc.tuple(cents(800), cents(800), cents(400)), fc.tuple(fc.nat(100), fc.nat(100), fc.nat(100)),
      fc.tuple(cents(900), cents(900), cents(900)), fc.tuple(cents(5), cents(5), cents(5)),
      (budgets, spent, newBudgets, caps) => {
        const current: MandateNow[] = agents.map((a, i) => ({ agent: a, capCents: 3, budgetCents: budgets[i]!, spentCents: Math.min(spent[i]!, budgets[i]! - 1) }));
        const targets = agents.map((a, i) => ({ agent: a, capCents: Math.min(caps[i]!, newBudgets[i]!), budgetCents: newBudgets[i]! }));
        const start = current.reduce((t, m) => t + m.budgetCents, 0);
        const end = targets.reduce((t, m) => t + m.budgetCents, 0);
        const valid = targets.every((t, i) => t.budgetCents > current[i]!.spentCents);
        if (!valid || start > TOTAL_BUDGET_CENTS) {
          expect(() => planReplaceSteps(current, targets)).toThrow();
          return;
        }
        if (end > TOTAL_BUDGET_CENTS) { expect(() => planReplaceSteps(current, targets)).toThrow(/over the/); return; }
        const steps = planReplaceSteps(current, targets); // a feasible plan: must not throw
        ran++;
        for (const st of steps) expect(st.totalAfterCents).toBeLessThanOrEqual(TOTAL_BUDGET_CENTS);
        expect(steps.at(-1)?.totalAfterCents ?? start).toBe(end);
      },
    ), { numRuns: 300 });
    expect(ran).toBeGreaterThan(100);
  });
});
