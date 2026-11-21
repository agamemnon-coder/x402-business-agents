/**
 * Independent, read-only release gate for the recorded /try browser walks.
 *
 * Run: npx tsx scripts/qa-try-release-gate.ts
 *      npx tsx scripts/qa-try-release-gate.ts --report-only
 *
 * No provider calls, credentials, mutable files or payment operations.
 * Security verdicts must never silently count incomplete/timeout attempts as
 * "tamper refused" or "tamper accepted".
 */
import { readFileSync } from "node:fs";

const SOURCES = [
  "docs/runs/2026-11-19-live-try/summary.json",
  "docs/runs/2026-11-19-mega-run/summary.json",
  "docs/runs/2026-11-21-phone-try/summary.json",
] as const;

interface FailedRun { run: number; profile?: string; failures: string[] }
interface Summary {
  aggregate: {
    runs: number;
    ok: number;
    refused: number;
    failed_runs?: FailedRun[];
    every_site_step_passed?: number;
    console_errors?: number;
    outside_requests?: number;
  };
}

const reportOnly = process.argv.includes("--report-only");
let attempts = 0, completedRefusals = 0, fullyPassing = 0;
const findings: string[] = [];

for (const source of SOURCES) {
  const summary = JSON.parse(readFileSync(source, "utf8")) as Summary;
  const a = summary.aggregate;
  if (![a.runs, a.ok, a.refused].every((n) => Number.isInteger(n) && n >= 0)) {
    throw new Error(`Invalid run counters: ${source}`);
  }
  if (a.ok > a.runs || a.refused > a.runs) throw new Error(`Impossible run counters: ${source}`);
  attempts += a.runs;
  fullyPassing += a.ok;
  completedRefusals += a.refused;
  const failed = a.failed_runs ?? [];
  if (a.runs !== a.ok + failed.length) {
    findings.push(`FAIL ${source}: runs (${a.runs}) != ok (${a.ok}) + failed_runs (${failed.length})`);
  }
  for (const run of failed) {
    const detail = run.failures.join(" | ") || "unspecified";
    const category = /Timeout|__name is not defined|waitForResponse/i.test(detail)
      ? "INCONCLUSIVE / execution failure"
      : /\/verify, the downloaded proof/i.test(detail)
        ? "PROOF UI assertion regression"
        : "OTHER FAILURE (investigate)";
    findings.push(`FAIL ${source} run ${run.run} (${run.profile ?? "unknown"}): ${category}: ${detail}`);
  }
  if ((a.console_errors ?? 0) > 0) findings.push(`FAIL ${source}: ${a.console_errors} browser console errors`);
  if ((a.outside_requests ?? 0) > 0) findings.push(`FAIL ${source}: ${a.outside_requests} unexpected requests`);
  console.log(`${source}: ${a.ok}/${a.runs} full walks passed; ${a.refused} recorded refusals; ${failed.length} failed walks`);
}

const inconclusiveOrMissing = attempts - completedRefusals;
console.log(`\nTOTAL: ${fullyPassing}/${attempts} full walks passed; ${completedRefusals}/${attempts} recorded tamper refusals; ${inconclusiveOrMissing} attempts without a recorded refusal.`);
console.log("IMPORTANT: a timeout or absent refusal is NOT, by itself, proof of an unauthorized payment. The corresponding provider transfer and authorization records require investigation.");
for (const finding of findings) console.error(finding);
if (inconclusiveOrMissing) console.error(`FAIL: ${inconclusiveOrMissing} attempts did not record an explicit tamper refusal; do not advertise a 100% demo success rate.`);
if (findings.length || inconclusiveOrMissing) {
  console.error(reportOnly ? "REPORT ONLY: release is not cleared." : "RELEASE GATE BLOCKED.");
  if (!reportOnly) process.exitCode = 1;
} else {
  console.log("PASS: all recorded walks and tamper refusals complete.");
}
