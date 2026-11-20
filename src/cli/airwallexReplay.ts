// npm run airwallex:replay -- live: the replay check (src/proof/awxReplay.ts) against the Airwallex sandbox. The same
// money-moving create sent twice under one request_id, then once more with one cent more, and the request_id looked up.
// Test money only. Needs AIRWALLEX_CALL_BUDGET (1 to 60) and AIRWALLEX_CALL_LOG (every call counted in one log,
// src/airwallex/callBudget.ts), the sandbox API key pair, and AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH off. Writes
// docs/runs/<AWX_REPLAY_DATE or today>-airwallex-replay.json and .md, also when a call fails. Keys are never printed.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { budgetFromEnv, readCallLog } from "../airwallex/callBudget.js";
import { fromEnv } from "../airwallex/client.js";
import { notingFetch, type HttpLine } from "../proof/awxCoverageLive.js";
import { replayMarkdown, runReplay, type ReplayRecord } from "../proof/awxReplay.js";
import { liveRefusals } from "./airwallexCoverageLive.js";

const repo = resolve(import.meta.dirname, "../..");
const date = process.env.AWX_REPLAY_DATE ?? new Date().toISOString().slice(0, 10);
const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);

if (process.argv[2] !== "live") { console.error("usage: npm run airwallex:replay -- live"); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("REFUSED  AWX_REPLAY_DATE as YYYY-MM-DD"); process.exit(2); }
const why = liveRefusals(process.env);
if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
const cfg = fromEnv();
if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
if (cfg.baseUrl && !cfg.baseUrl.startsWith("https://api.sandbox.airwallex.com/")) { console.error("REFUSED  not the Airwallex sandbox"); process.exit(2); }

const lines: HttpLine[] = [];
const live = { ...cfg, fetchImpl: budgetFromEnv(process.env, notingFetch((...a) => fetch(...a), lines))! };
const ranAt = new Date().toISOString();
const base = resolve(repo, "docs/runs", `${date}-airwallex-replay`);
let body: Awaited<ReturnType<typeof runReplay>> | null = null;
const fatal: string[] = [];
try {
  body = await runReplay({ cfg: live, lines, runId, log: (l) => console.log(l) });
} catch (e) {
  fatal.push((e as Error).message.slice(0, 300));
} finally {
  const rec: ReplayRecord = {
    run: `${date}-airwallex-replay`, ran_at: ranAt, finished_at: new Date().toISOString(), sandbox: true, test_money: true,
    made_by: "npm run airwallex:replay -- live (src/cli/airwallexReplay.ts, src/proof/awxReplay.ts)",
    payee: body?.payee ?? { name: "", beneficiary_id: null },
    budget: { approved: Number(process.env.AIRWALLEX_CALL_BUDGET) || null, used: readCallLog(process.env.AIRWALLEX_CALL_LOG!).length },
    cases: body?.cases ?? [],
    summary: body?.summary ?? { cases: 0, one_object: 0, repeats_safe: 0, repeats_sent: 0, repeats_refused: 0, repeats_returned_first: 0, duplicate_codes_seen: [], codes_purser_reads_as_refusal: [] },
    calls: lines,
    errors: [...(body?.errors ?? []), ...fatal],
  };
  writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${base}.md`, replayMarkdown(rec, date));
  const s = rec.summary;
  console.log(`\n${s.one_object}/${s.cases} one object under its request_id; ${s.repeats_refused}/${s.repeats_sent} repeats refused (${s.duplicate_codes_seen.join(", ") || "none"}); ${rec.budget.used} calls of ${rec.budget.approved}; errors ${rec.errors.length}`);
  console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
}
