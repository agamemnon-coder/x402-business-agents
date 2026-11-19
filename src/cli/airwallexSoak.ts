// npm run airwallex:soak -- <command>: the Airwallex live soak (src/e2e/airwallexSoak.ts): 30 supplier payments through
// Purser's own pipeline against the Airwallex sandbox (test money), each signed by a labelled virtual test passkey,
// created with metadata.approval_sha256, taken to PAID by the sandbox's simulation endpoint (simulated), and read back
// from Airwallex; and 5 negative controls, changed by one cent after signing, which must be refused before any create.
//
//   stand-in   the whole soak on the in-memory Airwallex stand-in; 0 network. Prints the calls the live adapter would
//              send (plus 1 login per live process and one more each 25 minutes), to size the call budget.
//   live       the soak against the sandbox. Needs AWX_SOAK_GO=yes, AIRWALLEX_CALL_BUDGET (at most 450),
//              AIRWALLEX_CALL_LOG, KIT11_DB=…/awx-soak*.sqlite (a fresh ledger). Results go beside the ledger
//              (KIT11_DB without .sqlite): results.json and http.json (each call's HTTP status; never a body or header).
//   record     writes docs/runs/<AWX_SOAK_DATE or today>-airwallex-soak.json and .md from those files and the call log; 0 calls.
// No Claude call anywhere: the invoices are read by the parser, and no model key is kept in this process.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const soak = await import("../e2e/airwallexSoak.js");
const { renderSoakMarkdown, soakRecord } = await import("../e2e/airwallexSoakRecord.js");
const { endpointOf, readCallLog } = await import("../airwallex/callBudget.js");
type Http = { at: string; method: string; endpoint: string; status: number };

const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");
const soakLedger = (env: Record<string, string | undefined>) => /awx-soak[^\\/]*\.sqlite$/.test(env.KIT11_DB ?? "");

function liveRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.AWX_SOAK_GO !== "yes") why.push("AWX_SOAK_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > soak.SOAK_MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${soak.SOAK_MAX_BUDGET}`);
  if (!soakLedger(env)) why.push("KIT11_DB=…/awx-soak*.sqlite (this run's own ledger)");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  return why;
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "T0_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`airwallex-soak stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { openDb } = await import("../db/open.js");
  const { soakStandIn } = await import("../e2e/airwallexSoakStandIn.js");
  const { rail, get, calls } = await soakStandIn();
  const db = openDb(":memory:");
  const res = await soak.runSoak({ db, rail, get, calls, feeRetry: { delaysMs: [], sleep: async () => {} }, mode: "stand-in", log: (l) => console.log(`STAND-IN ${l}`) });
  const s = soak.summarize(res, calls(), null);
  console.log(JSON.stringify(s, null, 2));
  const ok = s.created === 30 && s.paid === 30 && s.readback_matches === 30 && s.negatives.refused === 5 && s.negatives.posts_in_window === 0 && s.negatives.found_at_airwallex === 0 && !s.errors.length;
  console.log(`${ok ? "PASS" : "FAIL"}     stand-in: ${s.created}/30 created, ${s.paid} PAID, ${s.readback_matches} read-backs match, ${s.negatives.refused}/5 negatives refused, ${s.calls.total} rail calls (+1 login live)`);
  process.exitCode = ok ? 0 : 1;
} else if (cmd === "live") {
  const why = liveRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const { openDb } = await import("../db/open.js");
  const db = openDb();
  const busy = soak.soakLedgerRefusal(db);
  if (busy) { console.error(`REFUSED  ${busy}`); process.exit(2); }
  const { fromEnv, Airwallex } = await import("../airwallex/client.js");
  const { budgetFromEnv } = await import("../airwallex/callBudget.js");
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const { FEE_RETRY } = await import("../executors/invoicePayment.js");
  const cfg = fromEnv();
  if (!cfg) { console.error("no Airwallex sandbox keys; nothing was called"); process.exit(2); }
  // The same budgeted fetch the client builds from the environment, over a fetch that also notes each answer's HTTP
  // status (for 429s): the method, the endpoint with ids folded, the time and the status; never a body or a header.
  const http: Http[] = [];
  const noting: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const line = { at: new Date().toISOString(), method: (init?.method ?? "GET").toUpperCase(), endpoint: endpointOf(url) };
    try { const r = await fetch(input, init); http.push({ ...line, status: r.status }); return r; } catch (e) { http.push({ ...line, status: 0 }); throw e; }
  };
  const api = new Airwallex({ ...cfg, fetchImpl: budgetFromEnv(process.env, noting)! });
  const rail = new AirwallexRest(api) as unknown as import("../e2e/airwallexSoak.js").Rail;
  const dir = runDir();
  mkdirSync(dir, { recursive: true });
  const file = process.env.AIRWALLEX_CALL_LOG!;
  const save = (r: unknown) => { writeFileSync(join(dir, "results.json"), `${JSON.stringify(r, null, 2)}\n`); writeFileSync(join(dir, "http.json"), `${JSON.stringify(http)}\n`); };
  try {
    const res = await soak.runSoak({ db, rail, get: (path, q) => api.call("GET", path, undefined, q), calls: () => readCallLog(file), feeRetry: FEE_RETRY, mode: "live", log: (l) => console.log(l), save });
    const s = soak.summarize(res, readCallLog(file), http);
    console.log(`SUMMARY  ${s.created}/${s.planned} created, ${s.paid} PAID, ${s.readback_matches} read-backs match; conversions ${s.conversions.booked}/${s.conversions.planned} (${s.conversions.readback_matches} match); create→PAID p50 ${s.latency_ms.p50} ms, p95 ${s.latency_ms.p95} ms`);
    console.log(`SUMMARY  negatives ${s.negatives.refused}/${s.negatives.planned} refused; ${s.negatives.calls_in_window} calls (${s.negatives.posts_in_window} POST) from change to refusal; found at Airwallex: ${s.negatives.found_at_airwallex}`);
    console.log(`SUMMARY  ${s.calls.total} Airwallex calls; HTTP 429: ${s.http?.status_429}; errors: ${s.errors.length}${s.stopped ? `; stopped: ${s.stopped}` : ""}`);
  } finally {
    writeFileSync(join(dir, "http.json"), `${JSON.stringify(http)}\n`);
  }
} else if (cmd === "record") {
  if (!soakLedger(process.env) || !process.env.AIRWALLEX_CALL_LOG) { console.error("REFUSED  KIT11_DB=…/awx-soak*.sqlite and AIRWALLEX_CALL_LOG (this run's own files); nothing was read"); process.exit(2); }
  const dir = runDir();
  if (!existsSync(join(dir, "results.json"))) { console.error(`no ${join(dir, "results.json")}: run live first`); process.exit(2); }
  const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as import("../e2e/airwallexSoak.js").SoakResults;
  const http = JSON.parse(readFileSync(join(dir, "http.json"), "utf8")) as Http[];
  const calls = readCallLog(process.env.AIRWALLEX_CALL_LOG);
  const date = process.env.AWX_SOAK_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("AWX_SOAK_DATE is YYYY-MM-DD"); process.exit(2); }
  const base = resolve(repo, "docs/runs", `${date}-airwallex-soak`);
  const rec = soakRecord(results, calls, http, { budget: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, file: `docs/runs/${date}-airwallex-soak.json` });
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderSoakMarkdown(rec, date));
  console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
} else {
  console.error("usage: npm run airwallex:soak -- stand-in | live | record");
  process.exit(2);
}
