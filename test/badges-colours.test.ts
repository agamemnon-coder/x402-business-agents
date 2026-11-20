// The badges' colours and refusals (src/proof/badges.ts BUILD), the ones test/badges.test.ts leaves: each colour step a
// figure can reach, and each record shape the build refuses instead of guessing a figure.
import { describe, expect, it } from "vitest";
import { BUILD } from "../src/proof/badges.js";

const cov = (s: [number, number], b: [number, number], commit: unknown = "abc1234") => ({ run: { commit }, scopes: { product: { after: { statements: { covered: s[0], total: s[1] }, branches: { covered: b[0], total: b[1] } } } } });

describe("the badges' colours", () => {
  it("Airwallex endpoints: green from 90% live, yellow below", () => {
    expect(BUILD["airwallex-endpoints"]({ totals: { endpoints: 10, live: 9 } })).toMatchObject({ message: "9/10", color: "green" });
    expect(BUILD["airwallex-endpoints"]({ totals: { endpoints: 10, live: 8 } })).toMatchObject({ color: "yellow" });
  });

  it("chaos red with a broken invariant; fuzz orange with a failed property", () => {
    expect(BUILD.chaos({ totals: { scenarios: 1200 }, invariants: { cents: { broken: 0 }, caps: { broken: 2 } } })).toEqual({ label: "chaos invariants broken", message: "2 in 1,200 scenarios", color: "red" });
    expect(BUILD.fuzz({ totals: { runs: 10_000, properties: 12, failed: 1 } })).toEqual({ label: "fuzz runs", message: "10,000 · 1/12 properties failed", color: "orange" });
  });

  it("Dafny red with an error or nothing verified", () => {
    expect(BUILD.dafny({ totals: { verified: 40, errors: 1 }, verifier: "Dafny program verifier finished with 40 verified, 1 errors" })).toMatchObject({ color: "red" });
    expect(BUILD.dafny({ totals: { verified: 0, errors: 0 }, verifier: "Dafny program verifier finished with 0 verified, 0 errors" })).toMatchObject({ color: "red" });
  });

  it("coverage: bright green only at 90% of statements and 80% of branches, then green, yellow and red by statements", () => {
    expect(BUILD.coverage(cov([90, 100], [80, 100]))).toEqual({ label: "coverage, run on abc1234", message: "90.0% statements · 80.0% branches", color: "brightgreen" });
    expect(BUILD.coverage(cov([95, 100], [79, 100])).color).toBe("green");
    expect(BUILD.coverage(cov([70, 100], [90, 100])).color).toBe("yellow");
    expect(BUILD.coverage(cov([59, 100], [90, 100])).color).toBe("red");
  });

  it("mutation: bright green from 80, yellow from 60, red below", () => {
    expect(BUILD.mutation({ score: 85.04 })).toEqual({ label: "mutation score", message: "85.0%", color: "brightgreen" });
    expect(BUILD.mutation({ score: 60 }).color).toBe("yellow");
    expect(BUILD.mutation({ score: 59.9 }).color).toBe("red");
  });
});

describe("records the badges refuse", () => {
  it("a record without totals, a chaos record without invariants, a mutation score out of range", () => {
    expect(() => BUILD.fuzz({})).toThrow("docs/evidence/fuzzing.json: no totals");
    expect(() => BUILD.fuzz({ totals: "many" })).toThrow(/no totals/);
    expect(() => BUILD.chaos({ totals: { scenarios: 3 }, invariants: {} })).toThrow("chaos: no invariants");
    expect(() => BUILD.chaos({ totals: { scenarios: 3 } })).toThrow("chaos: no invariants");
    for (const score of [-1, 101, "90"]) expect(() => BUILD.mutation({ score })).toThrow("mutation: no score between 0 and 100");
  });

  it("coverage without its run's commit, without the product scope, or with a share that is not one", () => {
    expect(() => BUILD.coverage(cov([1, 2], [1, 2], "HEAD"))).toThrow("coverage: no run commit");
    expect(() => BUILD.coverage({ run: { commit: "abc1234" } })).toThrow("coverage: no product scope");
    expect(() => BUILD.coverage(cov([3, 2], [1, 2]))).toThrow("coverage statements: not a share");
    expect(() => BUILD.coverage(cov([1, 2], [0, 0]))).toThrow("coverage branches: not a share");
    expect(() => BUILD.coverage(cov([1.5, 2], [1, 2]))).toThrow("coverage statements covered: not a count in its record");
  });
});
