// The plan for a mandate change (src/policy/mandates.ts planReplaceSteps) refuses every plan it cannot run safely,
// before any credential is issued: the same agent twice (in what is bound or in the targets), an agent with no bound
// mandate, a cap or budget that is not a positive whole number of cents, a cap above its budget, and bound budgets that
// already break the total. Equal moves keep a fixed order, so the same plan always signs the same steps.
import { describe, expect, it } from "vitest";
import { planReplaceSteps, type MandateNow } from "../src/policy/mandates.js";

const now: MandateNow[] = [
  { agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 100 },
  { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 },
  { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 0 },
];

describe("a mandate plan is refused", () => {
  it("when an agent appears twice in what is bound or in the targets", () => {
    expect(() => planReplaceSteps([...now, now[0]!], [])).toThrow("duplicate agent in current mandates");
    expect(() => planReplaceSteps(now, [{ agent: "support", capCents: 10, budgetCents: 300 }, { agent: "support", capCents: 10, budgetCents: 350 }])).toThrow("duplicate agent in targets");
  });

  it("for an agent with no bound mandate", () => {
    expect(() => planReplaceSteps(now.slice(0, 2), [{ agent: "treasury", capCents: 100, budgetCents: 100 }])).toThrow("no bound mandate for treasury");
  });

  it("when a cap or budget is not a positive whole number of cents", () => {
    for (const capCents of [0, -1, 2.5, Number.NaN, 2 ** 53]) {
      expect(() => planReplaceSteps(now, [{ agent: "support", capCents, budgetCents: 400 }])).toThrow("support: cap must be a positive whole number of cents");
    }
    for (const budgetCents of [0, -400, 399.5, Number.POSITIVE_INFINITY]) {
      expect(() => planReplaceSteps(now, [{ agent: "support", capCents: 10, budgetCents }])).toThrow("support: budget must be a positive whole number of cents");
    }
  });

  it("when a cap is above its budget", () => {
    expect(() => planReplaceSteps(now, [{ agent: "treasury", capCents: 601, budgetCents: 600 }])).toThrow("treasury: cap 601 exceeds budget 600");
  });

  it("when what is bound already breaks the total, even for a plan that shrinks", () => {
    const over = now.map((m) => (m.agent === "support" ? { ...m, budgetCents: 401 } : m));
    expect(() => planReplaceSteps(over, [{ agent: "support", capCents: 10, budgetCents: 300 }])).toThrow("bound budgets already exceed the total: 2001");
  });
});

describe("a mandate plan that may run", () => {
  it("orders equal moves by agent name, and a cap-only change as a step that leaves the total as it is", () => {
    const steps = planReplaceSteps(now, [
      { agent: "treasury", capCents: 500, budgetCents: 500 },
      { agent: "support", capCents: 10, budgetCents: 300 },
      { agent: "sourcing", capCents: 4, budgetCents: 1000 },
    ]);
    expect(steps.map((s) => [s.order, s.agent, s.totalAfterCents])).toEqual([[1, "support", 1900], [2, "treasury", 1800], [3, "sourcing", 1800]]);
  });
});
