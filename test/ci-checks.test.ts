// "Checked on every change" (15 Nov, Max: "add the CI"): one line per CI job on /proof and /security, each job one that
// the workflows really run, the test count from the last full run's summary, text links only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CI_RUNS_URL, CI_TITLE, CODEQL_URL, ciChecksHtml, ciJobs, otherChecks } from "../src/redesign/ciChecks.js";
import { proofPage } from "../src/redesign/proof.js";
import { securityPage } from "../src/redesign/security.js";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const tap = readFileSync(new URL("../.github/workflows/tap-interop.yml", import.meta.url), "utf8");
const summary = JSON.parse(readFileSync(new URL("../docs/assets/test-summary.json", import.meta.url), "utf8")) as { passed: number; date: string };

describe("Checked on every change", () => {
  // Outside audit, 22 November: the list said 8 jobs and named two that do not run on every change (interop, CodeQL)
  // while leaving out formal, formal-dafny and reuse. It is now every job of ci.yml, in its order, read from ci.yml here.
  it("lists every job of ci.yml, in its order, and the checks outside it apart, each saying when it runs", () => {
    const top = [...ci.slice(ci.indexOf("\njobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
    expect(top.length).toBe(9);
    expect(ciJobs().map((j) => j.job)).toEqual(top);
    // ci.yml runs every job on every push to main and every pull request: no job has an if: or a paths filter.
    expect(ci).toMatch(/^on:\n(?:.*\n)*? {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/m);
    expect(ci).not.toMatch(/^ {4}if:/m);
    expect(ci.slice(0, ci.indexOf("\njobs:\n"))).not.toMatch(/paths/);
    expect(otherChecks().map((j) => j.job)).toEqual(["interop", "CodeQL"]);
    expect(tap).toMatch(/^ {2}interop:$/m);
    expect(tap).toMatch(/^ {2}push:\n {4}paths:/m);
    expect(otherChecks()[0]!.what).toContain("only when that code changes");
    expect(otherChecks()[1]!.what).toContain("GitHub's default setup, beside ci.yml");
    expect(ciChecksHtml()).toContain("Also, not on every change:");
    expect(ci).toContain("npm run judge -- --check");
    expect(ci).toContain("gitleaks");
    expect(ci).toContain("semgrep");
    expect(ci).toContain("bash scripts/formal.sh");
    expect(ci).toContain("bash scripts/formal-dafny.sh");
    expect(ci).toContain("reuse lint");
  });

  it("takes the test count from docs/assets/test-summary.json, on a line that names it", () => {
    expect(ciChecksHtml()).toContain(`<li data-rec="docs/assets/test-summary.json" title="${summary.passed.toLocaleString("en-GB")} tests passed`);
    // With the run's day beside it (outside audit, 22 November): the summary's date, its commit's.
    expect(summary.date).toBe("2026-11-20");
    expect(ciChecksHtml()).toContain(`${summary.passed.toLocaleString("en-GB")} tests (20 Nov), plus typecheck`);
    expect(ciChecksHtml()).not.toMatch(/\d+\/\d+/);
  });

  it("links the runs on main, code scanning and /verify as text, no badge images", () => {
    const h = ciChecksHtml();
    expect(h).toContain(`href="${CI_RUNS_URL.replace(/&/g, "&amp;")}"`);
    expect(h).toContain(`href="${CODEQL_URL}"`);
    expect(h).toContain('And you can check a payment yourself on <a href="/verify">/verify</a>.');
    expect(h).not.toMatch(/<img|shields\.io/);
  });

  it("is on /proof (under the fold, above the utility links) and on /security", () => {
    const proof = proofPage();
    expect(proof).toContain(`<h2 id="cichk-h">${CI_TITLE}</h2>`);
    expect(proof.indexOf('class="cichk"')).toBeGreaterThan(proof.indexOf('id="details"'));
    expect(proof.indexOf('class="cichk"')).toBeLessThan(proof.indexOf('<nav class="util"'));
    expect(securityPage()).toContain(`<h2 id="cichk-h">${CI_TITLE}</h2>`);
  });
});
