// "Checked on every change" (15 Nov, Max: "add the CI"): one line per CI job on /proof and /security, each job one that
// the workflows really run, the test count from the last full run's summary, text links only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CI_RUNS_URL, CI_TITLE, CODEQL_URL, ciChecksHtml, ciJobs } from "../src/redesign/ciChecks.js";
import { proofPage } from "../src/redesign/proof.js";
import { securityPage } from "../src/redesign/security.js";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const tap = readFileSync(new URL("../.github/workflows/tap-interop.yml", import.meta.url), "utf8");
const summary = JSON.parse(readFileSync(new URL("../docs/assets/test-summary.json", import.meta.url), "utf8")) as { passed: number };

describe("Checked on every change", () => {
  it("names only jobs the workflows define, plus GitHub's code scanning", () => {
    const jobs = ciJobs().map((j) => j.job);
    expect(jobs).toEqual(["test", "judge", "webkit", "firefox", "secrets", "security", "interop", "CodeQL"]);
    for (const j of jobs.slice(0, 6)) expect(ci).toMatch(new RegExp(`^ {2}${j}:$`, "m"));
    expect(tap).toMatch(/^ {2}interop:$/m);
    expect(ci).toContain("npm run judge -- --check");
    expect(ci).toContain("gitleaks");
    expect(ci).toContain("semgrep");
  });

  it("takes the test count from docs/assets/test-summary.json, on a line that names it", () => {
    expect(ciChecksHtml()).toContain(`<li data-rec="docs/assets/test-summary.json" title="${summary.passed.toLocaleString("en-GB")} tests passed`);
    expect(ciChecksHtml()).toContain(`${summary.passed.toLocaleString("en-GB")} tests, plus typecheck`);
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
