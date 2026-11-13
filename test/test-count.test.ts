// One source for the suite's count (final review, 13 Nov): docs/assets/test-summary.json, from a full run's own vitest
// report. The site's stats band reads it (src/redesign/scale.ts); the README's line and badge, docs/claims.md's Tests row
// and docs/submission/demo-day.md are written from it by `npm run test-count` (scripts/test-count.ts).
import { describe, expect, it } from "vitest";
import { apply, badge, read, readmeLine, summary } from "../scripts/test-count.js";
import { scaleFigures, scaleStats } from "../src/redesign/scale.js";

describe("the test count, from one file", () => {
  const s = summary(), now = read();

  it("is a full run's: every test passed or skipped, none failed", () => {
    expect(s.failed).toBe(0);
    expect(s.passed + s.skipped).toBe(s.total);
    expect(s.commit).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("is the number the README, the claims and the Demo Day pack show, written by npm run test-count", () => {
    expect(apply(s, now)).toEqual(now);
    expect(now.readme).toContain(readmeLine(s));
    expect(now.readme).toContain(badge(s));
  });

  it("is the number the site's stats band shows", () => {
    expect(scaleFigures().tests?.passed).toBe(s.passed);
    expect(scaleStats().find((x) => x.label === "tests passing")?.n).toBe(s.passed);
  });

  it("names no other count of tests in the README", () => {
    const counts = [...now.readme.matchAll(/\b(\d{4,}) tests\b/g)].map((m) => Number(m[1]));
    expect(counts.every((n) => n === s.passed)).toBe(true);
  });
});
