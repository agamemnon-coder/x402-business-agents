// npm run airwallex:deep -- plan | live: Airwallex, deeper (src/proof/awxDeepLive.ts). Five capabilities, each through
// Purser's own function, against the Airwallex sandbox with test money only.
//
//   plan   the whole run on the in-memory stand-in; 0 network, no keys read.
//   live   against the sandbox. Needs AIRWALLEX_CALL_BUDGET (1 to 60) and AIRWALLEX_CALL_LOG (every call counted in one
//          log, src/airwallex/callBudget.ts), the sandbox API key pair, AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH off, and
//          DEEP_GO=yes. The run's receivable lives in an in-memory ledger. Writes docs/runs/<AWX_DEEP_DATE or today>-
//          airwallex-deep<DEEP_RECORD_SUFFIX>.json and .md, also when a call fails. A second pass: DEEP_ONLY (a comma
//          list of capabilities) and DEEP_REVOKE_TRANSFER (cancel a transfer an earlier pass scheduled).
//   render <record.json>  the Markdown again from a committed JSON record; 0 calls.
// Then: npm run airwallex:coverage, which reads the record.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { budgetFromEnv, readCallLog } from "../airwallex/callBudget.js";
import { fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { CAPABILITIES, deepMarkdownRecord, deepNotingFetch, deepRecord, deepStandInFetch, runDeepCheck, SOAK, type Capability, type DeepLine, type DeepRecord } from "../proof/awxDeepLive.js";

export const MAX_BUDGET = 60;
const repo = resolve(import.meta.dirname, "../..");
const cmd = process.argv[2] ?? "plan";
const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const date = process.env.AWX_DEEP_DATE ?? new Date().toISOString().slice(0, 10);

/** Why a live run may not start; empty when it may. */
export function liveRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.DEEP_GO !== "yes") why.push("DEEP_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${MAX_BUDGET}`);
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (Purser's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.AWX_DEEP_DATE ?? "2000-01-01")) why.push("AWX_DEEP_DATE as YYYY-MM-DD");
  if (env.DEEP_ONLY && !env.DEEP_ONLY.split(",").every((c) => (CAPABILITIES as readonly string[]).includes(c))) why.push(`DEEP_ONLY a comma list of ${CAPABILITIES.join(", ")}`);
  if (env.DEEP_REVOKE_TRANSFER && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(env.DEEP_REVOKE_TRANSFER)) why.push("DEEP_REVOKE_TRANSFER a transfer id (UUID)");
  if (env.DEEP_RECORD_SUFFIX && !/^-[a-z0-9-]{1,20}$/.test(env.DEEP_RECORD_SUFFIX)) why.push("DEEP_RECORD_SUFFIX like -2");
  return why;
}

const isMain = process.argv[1]?.endsWith("airwallexDeep.ts");
if (isMain && (cmd === "plan" || cmd === "live")) {
  const soak = JSON.parse(readFileSync(resolve(repo, SOAK.record), "utf8"));
  const lines: DeepLine[] = [];
  const known = new Set<string>();
  const db = openDb(":memory:");
  if (cmd === "plan") {
    const { rows } = await runDeepCheck({ cfg: { clientId: "stand-in", apiKey: "stand-in", fetchImpl: deepNotingFetch(deepStandInFetch(), lines, known), minGapMs: 0 }, lines, known, runId, db, soak, sleep: async () => {}, log: (l) => console.log(`STAND-IN ${l}`) });
    console.log(`\nstand-in: ${rows.filter((r) => r.live).length} of ${rows.length} rows would answer 2xx; ${lines.length} calls.`);
  } else {
    const why = liveRefusals(process.env);
    if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
    const cfg = fromEnv();
    if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
    const live = { ...cfg, fetchImpl: budgetFromEnv(process.env, deepNotingFetch((...a) => fetch(...a), lines, known))! };
    const ranAt = new Date().toISOString();
    const name = `${date}-airwallex-deep${process.env.DEEP_RECORD_SUFFIX ?? ""}`;
    const base = resolve(repo, "docs/runs", name);
    const only = process.env.DEEP_ONLY ? new Set(process.env.DEEP_ONLY.split(",") as Capability[]) : undefined;
    let out: Awaited<ReturnType<typeof runDeepCheck>> = { rows: [], facts: { revoke: null, receivable: null, card: null, statement: null, cleanup: null } };
    try {
      out = await runDeepCheck({ cfg: live, lines, known, runId, db, soak, only, revokeExisting: process.env.DEEP_REVOKE_TRANSFER, log: (l) => console.log(l) });
    } finally {
      const rec = deepRecord(out.rows, out.facts, lines, { ranAt, budget: Number(process.env.AIRWALLEX_CALL_BUDGET), used: readCallLog(process.env.AIRWALLEX_CALL_LOG!).length });
      writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
      writeFileSync(`${base}.md`, deepMarkdownRecord(rec, date, name));
      console.log(`\n${rec.totals.new_endpoints_live} of ${rec.totals.new_endpoints} new endpoints live; ${rec.totals.live} of ${rec.totals.rows} rows live; ${rec.budget.used} calls of ${rec.budget.approved}, ${rec.budget.status_429} answered 429`);
      console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
    }
  }
} else if (isMain && cmd === "render") {
  // The Markdown again from a committed JSON record (0 calls): npm run airwallex:deep -- render docs/runs/<name>.json
  const file = resolve(repo, process.argv[3] ?? "");
  const name = file.replace(/^.*\//, "").replace(/\.json$/, "");
  writeFileSync(file.replace(/\.json$/, ".md"), deepMarkdownRecord(JSON.parse(readFileSync(file, "utf8")) as DeepRecord, name.slice(0, 10), name));
  console.log(`WROTE    ${file.replace(/\.json$/, ".md")}`);
} else if (isMain) {
  console.error("usage: npm run airwallex:deep -- plan | live | render <record.json>");
  process.exit(2);
}
