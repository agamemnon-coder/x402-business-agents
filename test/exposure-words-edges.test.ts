// The worst case's words (src/policy/exposure.ts exposureWords) in the shapes the other files leave: task cards named
// apart from the figure, with and without payments alone; payments alone with no daily count given (none a day); the
// figure in bold always the sum of what the fold lists; and a rate that is not one refused before any total is shown.
import { describe, expect, it } from "vitest";
import { approxEurCents, exposureOf, exposureWords, startPolicy, type ExposurePolicy } from "../src/policy/exposure.js";

const withAlone = (perDay?: number): ExposurePolicy => ({ ...startPolicy(), invoiceAloneCents: { sourcing: 0, support: 0, treasury: 50_000 }, ...(perDay === undefined ? {} : { invoicesAlonePerDay: perDay }) });

describe("task cards named apart", () => {
  it("without payments alone: the figure is on cards; a day is the same as a month", () => {
    const p = startPolicy();
    const w = exposureWords(exposureOf(p), p, null, "apart");
    expect(w.figure).toMatch(/^EUR [\d,]+ on cards \+ USD [\d,]+ on chain a month$/);
    expect(w.tasks).toMatch(/^Task cards the Treasury agent may issue alone: up to EUR [\d,]+ a day\.$/);
    expect(w.how).toContainEqual(expect.stringMatching(/the same as a month: neither a card nor a mandate has a daily limit\.$/));
    expect(w.how).toContainEqual(expect.stringMatching(/, not counted above\.$/));
    expect(w.form).not.toContain("(cards and task cards)");
  });

  it("with payments alone: each agent's card and payments alone together, and the payments alone a day", () => {
    const p = withAlone(2);
    const w = exposureWords(exposureOf(p), p, null, "apart");
    expect(w.figure).toMatch(/ incl\. payments alone \+ /);
    expect(w.tasks).toMatch(/^Plus the Treasury agent's task cards: up to EUR [\d,]+ a day\.$/);
    expect(w.how).toContainEqual(expect.stringMatching(/^Treasury agent: EUR [\d,]+ on its card and payments alone \+ USD [\d,]+ on chain \(test USD\) a month\.$/));
    expect(w.how).toContainEqual(expect.stringMatching(/^Sourcing agent: EUR [\d,]+ on its card \+ USD/));
    expect(w.how).toContainEqual(expect.stringMatching(/a card or a mandate can go in one day, payments alone 2 a day\.$/));
  });
});

describe("task cards counted", () => {
  it("without a daily count for payments alone: none a day, and no EUR total without a rate", () => {
    const p = withAlone();
    const x = exposureOf(p);
    const w = exposureWords(x, p, null, "counted");
    expect(w.figure).toMatch(/ on cards and task cards \+ /);
    expect(w.how.find((h) => h.startsWith("Treasury agent"))).not.toContain("payments alone");
    expect(w.how).toContainEqual(expect.stringMatching(/^No EUR total: the record has no usable rate/));
  });

  it("with payments alone a day: they are named in the bold figure and in the fold", () => {
    const p = withAlone(3);
    const w = exposureWords(exposureOf(p), p, { usdPerEur: "1.129917", date: "2026-11-03", source: "docs/demo/main-run.json" }, "counted");
    expect(w.figure).toMatch(/ incl\. task cards, payments alone \+ /);
    expect(w.how).toContainEqual(expect.stringMatching(/task cards \d+ a day, payments alone 3 a day\.$/));
    expect(w.how).toContainEqual(expect.stringMatching(/^Payments alone: up to each agent's limit, at most 3 a day per agent, 31 days a month, counted above\.$/));
    expect(w.how).toContainEqual(expect.stringMatching(/^≈ EUR [\d,.]+ in all at the main run's rate of 3 Nov 2026 \(1\.129917 USD per EUR/));
  });
});

describe("the rate", () => {
  it("one that is not a decimal is refused", () => {
    expect(() => approxEurCents(100, 100, "1,13")).toThrow("not a rate: 1,13");
    expect(() => approxEurCents(100, 100, "1")).toThrow("not a rate: 1");
    expect(approxEurCents(0, 113, "1.13")).toBe(100);
  });
});
