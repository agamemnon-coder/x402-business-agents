// The tests figure on Home and /proof (14 Nov): "6,606 of 6,610 tests passed" read as 4 failed when the 4 were skipped,
// and an N of M fraction. The title now says what passed, then what failed or was skipped; the README draft the same.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homePage } from "../src/redesign/home.js";
import { proofPage } from "../src/redesign/proof.js";
import { testsTitle, type TestSummary } from "../src/redesign/scale.js";

const summary = JSON.parse(readFileSync(new URL("../docs/assets/test-summary.json", import.meta.url), "utf8")) as TestSummary;
const n = (x: number) => x.toLocaleString("en-GB");

describe("the tests figure's title", () => {
  it("says passed, then skipped, never N of M", () => {
    const t = testsTitle(summary);
    expect(t.startsWith(`${n(summary.passed)} tests passed, ${n(summary.skipped)} skipped, in the last full run, on commit ${summary.commit} `)).toBe(true);
    expect(t).not.toMatch(/\d of [\d,]+ tests/);
    for (const page of [homePage(), proofPage()]) expect(page).toContain(`title="${t}"`);
  });

  it("names failures when there are any", () => {
    expect(testsTitle({ total: 10, passed: 7, failed: 1, skipped: 2, files: 3, commit: "abc" })).toMatch(/^7 tests passed, 1 failed, 2 skipped, in the last full run/);
  });

  it("the README draft has no N of M either", () => {
    expect(readFileSync(new URL("../src/cli/readmeDraft.ts", import.meta.url), "utf8")).not.toContain("${summary.passed} of ${summary.total} tests passed");
  });
});
