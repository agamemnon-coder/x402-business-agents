// One source for the test count (review, 13 Nov): the scale band on /proof and Home reads docs/assets/test-summary.json
// (src/redesign/scale.ts); the README's badge and its test line, docs/claims.md and the Demo Day table say the same
// number, so the site and the repository never disagree. `npm run readme-draft -- --tests <vitest json>` writes the
// summary from a full run; the texts follow it in the same commit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scaleStats, testSummary } from "../src/redesign/scale.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the test count, from one source", () => {
  const s = testSummary()!;
  it("is the summary's passed count on the site's band", () => {
    expect(s).not.toBeNull();
    expect(s.failed).toBe(0);
    expect(scaleStats().find((x) => x.label === "tests passing")?.n).toBe(s.passed);
  });

  it("is the same number in the README's badge and test line, docs/claims.md and the Demo Day table", () => {
    const readme = read("README.md");
    expect(/tests-(\d+)%20passing/.exec(readme)?.[1]).toBe(String(s.passed));
    expect(/\*\*(\d+) tests passing\*\*/.exec(readme)?.[1]).toBe(String(s.passed));
    expect(/^\| Tests \| (\d+) passing/m.exec(read("docs/claims.md"))?.[1]).toBe(String(s.passed));
    expect(/`npm run verify`; (\d+) tests \|/.exec(read("docs/submission/demo-day.md"))?.[1]).toBe(String(s.passed));
  });
});
