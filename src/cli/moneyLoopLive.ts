// npm run airwallex:money-loop-live -- <command> <run>: the money loop run live (src/e2e/moneyLoopLive.ts) against the
// Airwallex sandbox, test money only. <run> is fx-convert, receivables or negotiated-pay.
//
//   stand-in <run>  the run on the in-memory stand-ins (src/e2e/moneyLoopStandIn.ts); 0 network.
//   live <run>      against the sandbox. Needs LOOP_LIVE_GO=yes, AIRWALLEX_CALL_BUDGET (at most 40), AIRWALLEX_CALL_LOG,
//                   KIT11_DB=…/money-loop-<run>*.sqlite (a fresh ledger), AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH off.
//                   Results go beside the ledger: results.json and http.jsonl (every request; never a body, header,
//                   token, key or account number). It stops at the first unexpected 4xx or 5xx, and at the first failed step.
//   record <run>    writes docs/runs/<LOOP_LIVE_DATE or today>-<record>.json and .md from those files; 0 calls.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [cmd = "stand-in", runArg = ""] = process.argv.slice(2);
const repo = resolve(import.meta.dirname, "../..");
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const loop = await import("../e2e/moneyLoopLive.js");
const { LOOP_RECORD, LOOP_RECORD_NAME } = await import("../e2e/moneyLoopLiveRecord.js");
const { drillFetch, drillHaltReason, readDrillLog } = await import("../e2e/drillHttp.js");
type LoopRun = import("../e2e/moneyLoopLive.js").LoopRun;

const usage = `usage: npm run airwallex:money-loop-live -- stand-in|live|record ${loop.LOOP_RUNS.join("|")}`;
if (!(loop.LOOP_RUNS as readonly string[]).includes(runArg)) { console.error(usage); process.exit(2); }
const run = runArg as LoopRun;

const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");
// The run's own ledger file: its name holds money-loop-<run> and ends in .sqlite (plain string checks).
const ledgerOk = (env: Record<string, string | undefined>) => { const f = basename(env.KIT11_DB ?? ""); return f.includes(`money-loop-${run}`) && f.endsWith(".sqlite"); };
const httpLog = () => join(runDir(), "http.jsonl");

function refusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.LOOP_LIVE_GO !== "yes") why.push("LOOP_LIVE_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > loop.LOOP_LIVE_MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${loop.LOOP_LIVE_MAX_BUDGET}`);
  if (!ledgerOk(env)) why.push(`KIT11_DB=…/money-loop-${run}*.sqlite (the run's own, fresh ledger)`);
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  return why;
}

const str = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);
const money = (v: unknown): string => (typeof v === "number" ? v.toFixed(2) : typeof v === "string" ? Number(v).toFixed(2) : "");
/** Only the metadata keys Purser writes (hashes), never anything else Airwallex may echo. */
const hashes = (m: unknown): Record<string, unknown> | null => {
  if (!m || typeof m !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const k of ["approval_sha256", "agreement_sha256"]) if (typeof (m as Record<string, unknown>)[k] === "string") out[k] = (m as Record<string, unknown>)[k];
  return out;
};

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`money-loop stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { openDb } = await import("../db/open.js");
  const { standInLog } = await import("../e2e/governanceLive.js");
  const { standInLoopRun } = await import("../e2e/moneyLoopStandIn.js");
  const { lines, counted } = standInLog();
  const { res } = await standInLoopRun(run, { db: openDb(":memory:"), now: () => new Date(), lines: () => lines, counted, log: (l) => console.log(`STAND-IN ${l}`) });
  const fails = res.steps.filter((s) => s.pass === false);
  console.log(`stand-in ${run}: ${res.steps.length} steps, ${fails.length} failed (${fails.map((s) => s.id).join(", ") || "none"}); ${lines.length} rail calls${res.stopped ? `; STOPPED: ${res.stopped}` : ""}`);
  process.exit(fails.length ? 1 : 0);
} else if (cmd === "live") {
  const why = refusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const halted = drillHaltReason(httpLog());
  if (halted) { console.error(`REFUSED  this run is halted (${halted}); look at it before anything else is sent`); process.exit(2); }
  mkdirSync(runDir(), { recursive: true });
  const { openDb } = await import("../db/open.js");
  const db = openDb();
  const used = (db.prepare("SELECT (SELECT COUNT(*) FROM proposals) + (SELECT COUNT(*) FROM passkeys) + (SELECT COUNT(*) FROM ar_invoices) AS n").get() as { n: number }).n;
  if (used) { console.error("REFUSED  this ledger is not fresh (proposals, passkeys or invoices in it)"); process.exit(2); }
  const { fromEnv, Airwallex, SANDBOX_BASE } = await import("../airwallex/client.js");
  const { budgetFromEnv } = await import("../airwallex/callBudget.js");
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const cfg = fromEnv();
  if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
  if ((cfg.baseUrl ?? SANDBOX_BASE) !== SANDBOX_BASE || !SANDBOX_BASE.startsWith("https://api.sandbox.airwallex.com/")) { console.error("REFUSED  the configured base URL is not the sandbox; nothing was called"); process.exit(2); }
  console.log(`SANDBOX  ${SANDBOX_BASE} (test money); budget ${process.env.AIRWALLEX_CALL_BUDGET}`);
  // An indicative rate the sandbox cannot price is an expected answer (the advisor records it and leaves the pair out).
  const expected = (l: { method: string; endpoint: string; status: number }) => l.method === "GET" && l.endpoint === "/fx/rates/current" && l.status >= 400 && l.status < 500;
  const fetchImpl = drillFetch(budgetFromEnv(process.env, (...a) => fetch(...a))!, { file: httpLog(), expected });
  const api = new Airwallex({ ...cfg, fetchImpl });
  const rest = new AirwallexRest(api);
  const out = join(runDir(), "results.json");
  const base = { db, mode: "live" as const, now: () => new Date(), lines: () => readDrillLog(httpLog()), halted: () => drillHaltReason(httpLog()), log: (l: string) => console.log(l), save: (r: unknown) => writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`) };
  let res;
  if (run === "fx-convert") {
    res = await loop.runFxConvert({
      ...base, rail: rest,
      readConversion: async (id) => {
        const c = await api.call<Record<string, unknown>>("GET", `/fx/conversions/${encodeURIComponent(id)}`);
        return { conversion_id: str(c.conversion_id) ?? id, request_id: str(c.request_id), status: str(c.status) ?? "", buy_currency: str(c.buy_currency) ?? "", buy_amount: money(c.buy_amount), sell_currency: str(c.sell_currency) ?? "", sell_amount: money(c.sell_amount), metadata: hashes(c.metadata) };
      },
    });
  } else if (run === "receivables") {
    res = await loop.runReceivables({ ...base, api, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  } else {
    res = await loop.runNegotiatedPay({
      ...base, awx: rest,
      readTransfer: async (id) => {
        const t = await api.call<Record<string, unknown>>("GET", `/transfers/${encodeURIComponent(id)}`);
        return { id: str(t.id) ?? id, request_id: str(t.request_id), status: str(t.status) ?? "", amount: money(t.transfer_amount ?? t.amount_beneficiary_receives), currency: str(t.transfer_currency) ?? "", reference: str(t.reference), metadata: hashes(t.metadata) };
      },
    });
  }
  console.log(`SUMMARY  ${run}: ${res.steps.length} steps, ${res.steps.filter((s) => s.pass === true).length} passed, ${res.steps.filter((s) => s.pass === false).length} failed; ${readDrillLog(httpLog()).length} requests${res.stopped ? `; STOPPED: ${res.stopped}` : ""}`);
} else if (cmd === "record") {
  if (!ledgerOk(process.env) || !process.env.AIRWALLEX_CALL_LOG) { console.error(`REFUSED  KIT11_DB=…/money-loop-${run}*.sqlite and AIRWALLEX_CALL_LOG (this run's own files); nothing was read`); process.exit(2); }
  const file = join(runDir(), "results.json");
  if (!existsSync(file)) { console.error(`no results in ${runDir()}: run live first`); process.exit(2); }
  const { readCallLog } = await import("../airwallex/callBudget.js");
  const { drillRecord, renderDrillMarkdown } = await import("../e2e/drillRecord.js");
  const r = JSON.parse(readFileSync(file, "utf8")) as import("../e2e/governanceLive.js").GovResults;
  const date = process.env.LOOP_LIVE_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("LOOP_LIVE_DATE is YYYY-MM-DD"); process.exit(2); }
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } })();
  const meta = LOOP_RECORD[run];
  const rec = drillRecord({
    run, date, command: `npm run airwallex:money-loop-live -- live ${run}`, commit, simulated: meta.simulated, max: loop.LOOP_LIVE_MAX_BUDGET,
    approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, cards: r.cards,
    passes: [{ pass_no: 1, started_at: r.started_at, ended_at: r.ended_at, stopped: r.stopped, note: meta.note, timings: Object.fromEntries(Object.entries(r.timings).filter(([k]) => k.endsWith("_ms"))), steps: r.steps }],
    lines: readDrillLog(httpLog()), callLog: readCallLog(process.env.AIRWALLEX_CALL_LOG), notShown: meta.notShown,
  });
  const name = `${date}-${LOOP_RECORD_NAME[run]}`;
  const baseFile = resolve(repo, "docs/runs", name);
  writeFileSync(`${baseFile}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${baseFile}.md`, renderDrillMarkdown(rec, { title: meta.title, intro: meta.intro, file: `docs/runs/${name}.json`, summary: meta.summary(rec) }));
  console.log(`WROTE    ${baseFile}.json\nWROTE    ${baseFile}.md`);
} else {
  console.error(usage);
  process.exit(2);
}
