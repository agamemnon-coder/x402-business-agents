// "Checked on every change" (Max, 15 Nov: "add the CI, we have a lot, it's a way to show that we verify"): one line per
// CI job, in plain words, describing only what .github/workflows/ci.yml, tap-interop.yml and GitHub's code scanning run.
// Text links only (no badge images: the page's CSP allows images from 'self'). The one figure, the test count, comes
// from docs/assets/test-summary.json and its line names that file (data-rec).
import { TEST_SUMMARY, testSummary, testsTitle } from "./scale.js";
import { esc } from "./ui.js";

const REPO = "https://github.com/agamemnon-coder/x402-business-agents";
export const CI_RUNS_URL = `${REPO}/actions/workflows/ci.yml?query=branch%3Amain`;
export const CODEQL_URL = `${REPO}/actions/workflows/github-code-scanning/codeql`;
export const CI_TITLE = "Checked on every change";
export const CI_VERIFY_URL = "/verify";

export interface CiJob { job: string; what: string; rec?: string; title?: string }

/** The jobs, in the order ci.yml lists them, then the interop workflow and code scanning. */
export function ciJobs(): CiJob[] {
  const t = testSummary();
  return [
    t
      ? { job: "test", what: `${t.passed.toLocaleString("en-GB")} tests, plus typecheck, lint and npm audit.`, rec: TEST_SUMMARY, title: testsTitle(t) }
      : { job: "test", what: "The full test suite, plus typecheck, lint and npm audit." },
    { job: "judge", what: "A fresh clone with no keys replays the demo (npm run judge -- --check), then the pages in Chromium." },
    { job: "webkit", what: "The signing page in WebKit, Safari's engine." },
    { job: "firefox", what: "The pages and the signing page in Firefox." },
    { job: "secrets", what: "gitleaks scans the whole git history for keys." },
    { job: "security", what: "Semgrep blocks on any finding; an SBOM lists the runtime dependencies." },
    { job: "interop", what: "Our signed agent checkout against the card network's public reference, unchanged, when that code changes." },
    { job: "CodeQL", what: "GitHub code scanning." },
  ];
}

export function ciChecksHtml(): string {
  const li = (j: CiJob) => `<li${j.rec ? ` data-rec="${esc(j.rec)}"` : ""}${j.title ? ` title="${esc(j.title)}"` : ""}><code>${esc(j.job)}</code> <span>${esc(j.what)}</span></li>`;
  return `<section class="cichk" aria-labelledby="cichk-h">
  <h2 id="cichk-h">${esc(CI_TITLE)}</h2>
  <ul>${ciJobs().map(li).join("")}</ul>
  <p class="cilinks"><a href="${esc(CI_RUNS_URL)}" target="_blank" rel="noopener">See the latest runs on main ↗</a> <a href="${esc(CODEQL_URL)}" target="_blank" rel="noopener">Code scanning ↗</a> <span>And you can check a payment yourself on <a href="${esc(CI_VERIFY_URL)}">/verify</a>.</span></p>
</section>`;
}

export const CI_CSS = `
.cichk { margin: 28px 0; padding: 18px 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.cichk h2 { font-size: 20px; font-weight: 720; margin: 0 0 10px; }
.cichk ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.cichk li { display: grid; grid-template-columns: 6.5em 1fr; gap: 10px; align-items: baseline; font-size: 14.5px; line-height: 1.45; }
.cichk code { font-size: 13px; color: var(--muted); }
.cichk .cilinks { margin: 12px 0 0; display: flex; flex-wrap: wrap; align-items: center; column-gap: 16px; font-size: 14.5px; }
.cichk .cilinks a { display: inline-flex; align-items: center; min-height: 44px; }
@media (max-width: 480px) { .cichk { padding: 14px; } .cichk li { grid-template-columns: 1fr; gap: 0; } }
`;
