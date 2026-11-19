// npm run airwallex:coverage-live -- plan | live: the Airwallex coverage check (src/proof/awxCoverageLive.ts). Each
// endpoint the coverage report had not seen live, called once against the Airwallex sandbox through Purser's own function
// for it; test money only; what it makes is removed again where Purser's client can.
//
//   plan   the whole check on the in-memory stand-in; 0 network, no keys read. Prints each row and the calls it would send.
//   live   the check against the sandbox. Needs AIRWALLEX_CALL_BUDGET (1 to 60) and AIRWALLEX_CALL_LOG (every call counted
//          in one log, src/airwallex/callBudget.ts), the sandbox API key pair, and AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH
//          off. Writes docs/runs/<AWX_COVERAGE_DATE or today>-airwallex-coverage.json and .md, also when a call fails.
//          AIRWALLEX_HOSTED_FLOW_TEMPLATE (Airwallex's onboarding template id), if ever issued, lets the hosted flow run.
// Then: npm run airwallex:coverage, which reads the record.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { budgetFromEnv, readCallLog } from "../airwallex/callBudget.js";
import { fromEnv } from "../airwallex/client.js";
import { coverageMarkdownRecord, coverageRecord, notingFetch, runCoverageCheck, standInFetch, type HttpLine } from "../proof/awxCoverageLive.js";

export const MAX_BUDGET = 60;
const repo = resolve(import.meta.dirname, "../..");
const cmd = process.argv[2] ?? "plan";
const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const date = process.env.AWX_COVERAGE_DATE ?? new Date().toISOString().slice(0, 10);

/** Why a live run may not start; empty when it may. */
export function liveRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${MAX_BUDGET}`);
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (Purser's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.AWX_COVERAGE_DATE ?? "2000-01-01")) why.push("AWX_COVERAGE_DATE as YYYY-MM-DD");
  return why;
}

const isMain = process.argv[1]?.endsWith("airwallexCoverageLive.ts");
if (isMain && cmd === "plan") {
  const lines: HttpLine[] = [];
  const rows = await runCoverageCheck({ cfg: { clientId: "stand-in", apiKey: "stand-in", fetchImpl: notingFetch(standInFetch(), lines), minGapMs: 0 }, lines, runId, date, log: (l) => console.log(`STAND-IN ${l}`) });
  console.log(`\nstand-in: ${rows.filter((r) => r.live).length} of ${rows.length} endpoints would answer 2xx; ${lines.length} calls (2 logins: the client and the acceptance client). Live: AIRWALLEX_CALL_BUDGET=${lines.length + 10} leaves room for 429 retries.`);
} else if (isMain && cmd === "live") {
  const why = liveRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const cfg = fromEnv();
  if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
  const lines: HttpLine[] = [];
  // The budgeted fetch the client would build from the environment, over one that notes each answer (never a body).
  const live = { ...cfg, fetchImpl: budgetFromEnv(process.env, notingFetch((...a) => fetch(...a), lines))! };
  const ranAt = new Date().toISOString();
  const base = resolve(repo, "docs/runs", `${date}-airwallex-coverage`);
  let rows: Awaited<ReturnType<typeof runCoverageCheck>> = [];
  try {
    rows = await runCoverageCheck({ cfg: live, lines, runId, date, hostedFlowTemplate: process.env.AIRWALLEX_HOSTED_FLOW_TEMPLATE ?? null, log: (l) => console.log(l) });
  } finally {
    const rec = coverageRecord(rows, lines, { ranAt, budget: Number(process.env.AIRWALLEX_CALL_BUDGET), used: readCallLog(process.env.AIRWALLEX_CALL_LOG!).length });
    writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
    writeFileSync(`${base}.md`, coverageMarkdownRecord(rec, date));
    console.log(`\n${rec.totals.live} of ${rec.totals.targets} live, ${rec.totals.refused} refused, ${rec.totals.not_run} not run; ${rec.budget.used} calls of ${rec.budget.approved}, ${rec.budget.status_429} answered 429`);
    console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
  }
} else if (isMain) {
  console.error("usage: npm run airwallex:coverage-live -- plan | live");
  process.exit(2);
}
