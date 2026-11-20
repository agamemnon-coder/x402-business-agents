// npm run airwallex:stop-drill -- <command>: the emergency stop and the velocity stop pulled live (src/e2e/stopDrill.ts),
// against the Airwallex sandbox with test money. The agents' cards are the card drill's (run that first).
//
//   stand-in   the whole drill on the in-memory stand-ins; 0 network.
//   live       against the sandbox. Needs STOP_DRILL_GO=yes, AIRWALLEX_CALL_BUDGET (at most 150), AIRWALLEX_CALL_LOG,
//              KIT11_DB=…/stop-drill*.sqlite (a fresh ledger), AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH off. Results go
//              beside the ledger (or beside DRILL_HTTP_LOG, one log for every pass): results-pass<n>.json and http.jsonl.
//              STOP_DRILL_ONLY=group,… re-runs only those groups on a fresh ledger; STOP_DRILL_PASS=n names the pass.
//              It stops at the first unexpected 4xx or 5xx.
//   record     writes docs/runs/<STOP_DRILL_DATE or today>-stop-drill.json and .md from those files; 0 calls.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const cmd = process.argv[2] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const drill = await import("../e2e/stopDrill.js");
const { drillFetch, drillHaltReason, readDrillLog } = await import("../e2e/drillHttp.js");

const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");
const drillLedger = (env: Record<string, string | undefined>) => /stop-drill[^\\/]*\.sqlite$/.test(env.KIT11_DB ?? "");
/** One HTTP log for every pass of a run (DRILL_HTTP_LOG names it for a pass on a new ledger); results go beside it. */
const httpLog = () => process.env.DRILL_HTTP_LOG ?? join(runDir(), "http.jsonl");
const resultsDir = () => dirname(httpLog());

export function stopDrillRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.STOP_DRILL_GO !== "yes") why.push("STOP_DRILL_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > drill.STOP_DRILL_MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${drill.STOP_DRILL_MAX_BUDGET}`);
  if (!drillLedger(env)) why.push("KIT11_DB=…/stop-drill*.sqlite (the drill's own, fresh ledger)");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  if (env.STOP_DRILL_ONLY && !env.STOP_DRILL_ONLY.split(",").every((p) => (drill.STOP_GROUPS as readonly string[]).includes(p))) why.push(`STOP_DRILL_ONLY a comma list of ${drill.STOP_GROUPS.join(", ")}`);
  if (env.STOP_DRILL_PASS && !/^[1-9]$/.test(env.STOP_DRILL_PASS)) why.push("STOP_DRILL_PASS a pass number 1 to 9");
  if (env.STOP_DRILL_SIM_FAILURES && !/^[0-5]$/.test(env.STOP_DRILL_SIM_FAILURES)) why.push("STOP_DRILL_SIM_FAILURES a number 0 to 5");
  if (env.DRILL_HTTP_LOG && !/\.jsonl$/.test(env.DRILL_HTTP_LOG)) why.push("DRILL_HTTP_LOG a .jsonl file");
  return why;
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`stop-drill stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { openDb } = await import("../db/open.js");
  const { FakeIssuing } = await import("../redteam/issuing.js");
  const { soakStandIn } = await import("../e2e/airwallexSoakStandIn.js");
  const { CARD_DRILL_SUFFIX } = await import("../e2e/cardDrill.js");
  const { setupCards } = await import("../policy/cards.js");
  const iss = new FakeIssuing();
  // The card drill's cards, issued once beforehand (as the live drill finds them at Airwallex).
  await setupCards(openDb(":memory:"), iss, new Date(), { nicknameSuffix: CARD_DRILL_SUFFIX });
  const { rail: awx, awx: fake } = await soakStandIn();
  const db = openDb(":memory:");
  const res = await drill.runStopDrill({
    db, rail: iss, awx, transferExists: async (rid) => fake.transfers.some((t) => t.requestId === rid), lines: () => [], mode: "stand-in", now: () => new Date(), halted: () => null,
    log: (l) => console.log(`STAND-IN ${l}`),
  });
  const fails = res.steps.filter((s) => s.pass === false);
  console.log(`stand-in: ${res.steps.length} steps, ${fails.length} failed (${fails.map((s) => `${s.id} ${s.agent ?? ""}`).join(", ") || "none"}); ${iss.calls.length} card rail calls`);
} else if (cmd === "live") {
  const why = stopDrillRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const halted = drillHaltReason(httpLog());
  if (halted) { console.error(`REFUSED  this run is halted (${halted}); look at it before anything else is sent`); process.exit(2); }
  mkdirSync(runDir(), { recursive: true });
  mkdirSync(resultsDir(), { recursive: true });
  const { openDb } = await import("../db/open.js");
  const db = openDb();
  const used = (db.prepare("SELECT (SELECT COUNT(*) FROM proposals) + (SELECT COUNT(*) FROM passkeys) + (SELECT COUNT(*) FROM cards) AS n").get() as { n: number }).n;
  // A first pass needs a fresh ledger; a later pass (a re-run of some groups) continues the drill's own ledger.
  const passNo = Number(process.env.STOP_DRILL_PASS ?? "1");
  if (used && passNo === 1) { console.error("REFUSED  this ledger is not fresh (proposals, passkeys or cards in it); the stop drill's first pass runs on a fresh ledger"); process.exit(2); }
  if (passNo > 1 && !process.env.STOP_DRILL_ONLY) { console.error("REFUSED  a later pass re-runs some groups: set STOP_DRILL_ONLY"); process.exit(2); }
  const foreign = (db.prepare("SELECT label FROM passkeys").all() as { label: string }[]).filter((p) => !p.label.startsWith(drill.STOP_PASSKEY_LABEL));
  if (foreign.length) { console.error("REFUSED  this ledger holds a passkey that is not the drill's virtual one"); process.exit(2); }
  const { fromEnv, Airwallex, SANDBOX_BASE } = await import("../airwallex/client.js");
  const { budgetFromEnv } = await import("../airwallex/callBudget.js");
  const { IssuingRest } = await import("../airwallex/issuing.js");
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const cfg = fromEnv();
  if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
  if ((cfg.baseUrl ?? SANDBOX_BASE) !== SANDBOX_BASE) { console.error("REFUSED  the configured base URL is not the sandbox; nothing was called"); process.exit(2); }
  const api = new Airwallex({ ...cfg, fetchImpl: drillFetch(budgetFromEnv(process.env, (...a) => fetch(...a))!, { file: httpLog(), toleratedSimFailures: Number(process.env.STOP_DRILL_SIM_FAILURES ?? "0") }) });
  const out = join(resultsDir(), `results-pass${passNo}.json`);
  const res = await drill.runStopDrill({
    only: process.env.STOP_DRILL_ONLY ? new Set(process.env.STOP_DRILL_ONLY.split(",") as import("../e2e/stopDrill.js").StopGroup[]) : undefined, passNo,
    db, rail: new IssuingRest(api), awx: new AirwallexRest(api),
    transferExists: async (rid) => ((await api.call<{ items?: { request_id?: string }[] }>("GET", "/transfers", undefined, { request_id: rid, page_num: "0", page_size: "10" })).items ?? []).some((i) => i.request_id === rid),
    lines: () => readDrillLog(httpLog()), mode: "live", now: () => new Date(), halted: () => drillHaltReason(httpLog()),
    log: (l) => console.log(l), save: (r) => writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`),
  });
  console.log(`SUMMARY  ${res.steps.length} steps, ${res.steps.filter((s) => s.pass === true).length} passed, ${res.steps.filter((s) => s.pass === false).length} failed; ${readDrillLog(httpLog()).length} requests${res.stopped ? `; STOPPED: ${res.stopped}` : ""}`);
} else if (cmd === "record") {
  if (!drillLedger(process.env) || !process.env.AIRWALLEX_CALL_LOG) { console.error("REFUSED  KIT11_DB=…/stop-drill*.sqlite and AIRWALLEX_CALL_LOG (this run's own files); nothing was read"); process.exit(2); }
  const files = existsSync(resultsDir()) ? readdirSync(resultsDir()).filter((f) => /^results-pass\d\.json$/.test(f)).sort() : [];
  if (!files.length) { console.error(`no results in ${resultsDir()}: run live first`); process.exit(2); }
  const { readCallLog } = await import("../airwallex/callBudget.js");
  const { drillRecord, renderDrillMarkdown } = await import("../e2e/drillRecord.js");
  const { stopDrillSummary, STOP_DRILL_SIMULATED, STOP_DRILL_NOT_SHOWN, STOP_DRILL_PASS_NOTES } = await import("../e2e/stopDrillRecord.js");
  const results = files.map((f) => JSON.parse(readFileSync(join(resultsDir(), f), "utf8")) as import("../e2e/stopDrill.js").StopDrillResults);
  const date = process.env.STOP_DRILL_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("STOP_DRILL_DATE is YYYY-MM-DD"); process.exit(2); }
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } })();
  const rec = drillRecord({
    run: "stop-drill", date, command: "npm run airwallex:stop-drill -- live", commit, simulated: STOP_DRILL_SIMULATED, max: drill.STOP_DRILL_MAX_BUDGET,
    approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, cards: results[0]!.cards,
    passes: results.map((r) => ({ pass_no: r.pass_no, started_at: r.started_at, ended_at: r.ended_at, stopped: r.stopped, note: STOP_DRILL_PASS_NOTES[r.pass_no] ?? null, timings: r.timings, steps: r.steps })),
    lines: readDrillLog(httpLog()), callLog: readCallLog(process.env.AIRWALLEX_CALL_LOG), notShown: STOP_DRILL_NOT_SHOWN,
  });
  const base = resolve(repo, "docs/runs", `${date}-stop-drill`);
  writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderDrillMarkdown(rec, { title: "Stop drill", intro: "The emergency stop and the velocity stop pulled live against sandbox-backed agents: every agent, card and pending action tried after each, the time to fully blocked measured, and every way of lifting it tried.", file: `docs/runs/${date}-stop-drill.json`, summary: stopDrillSummary(rec) }));
  console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
} else {
  console.error("usage: npm run airwallex:stop-drill -- stand-in | live | record");
  process.exit(2);
}
