// npm run airwallex:governance-live -- <command> <run>: the governance features run live (src/e2e/governanceLive.ts)
// against the Airwallex sandbox, test money only. <run> is card-hours, stop-rail or entities.
//
//   stand-in <run>  the run on the in-memory stand-ins; 0 network.
//   live <run>      against the sandbox. Needs GOV_LIVE_GO=yes, AIRWALLEX_CALL_BUDGET (at most 80), AIRWALLEX_CALL_LOG,
//                   KIT11_DB=…/governance-<run>*.sqlite (a fresh ledger), AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH off.
//                   Results go beside the ledger: results.json and http.jsonl (every request; never a body, header,
//                   token, key or card number). It stops at the first unexpected 4xx or 5xx, and at the first failed step.
//   record <run>    writes docs/runs/<GOV_LIVE_DATE or today>-<record>.json and .md from those files; 0 calls.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [cmd = "stand-in", runArg = ""] = process.argv.slice(2);
const repo = resolve(import.meta.dirname, "../..");
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const gov = await import("../e2e/governanceLive.js");
const { drillFetch, drillHaltReason, readDrillLog } = await import("../e2e/drillHttp.js");
type GovRun = import("../e2e/governanceLive.js").GovRun;

if (!(gov.GOV_RUNS as readonly string[]).includes(runArg)) { console.error(`usage: npm run airwallex:governance-live -- stand-in|live|record ${gov.GOV_RUNS.join("|")}`); process.exit(2); }
const run = runArg as GovRun;

/** The record each run writes (docs/runs/<date>-<name>.md). */
export const RECORD_NAME: Record<GovRun, string> = { "card-hours": "card-governance-live", "stop-rail": "stop-at-rail-live", entities: "entities-live", "replace-failed": "replace-failed-live" };
/** Entity A: the sandbox's connected account (ACTIVE since 10 Nov, docs/runs/2026-11-10-connected-accounts-sandbox.md). */
const ENTITY_A = { id: "nl-test-sole", name: "Purser Sandbox Test (fake sole trader, connected account)", country: "NL", currency: "EUR", funding_account: "acct_SC-QD89fOneAeqaRFgOymw" };
/** Entity B: the sandbox's platform account, the API key's own account. */
const ENTITY_B = { id: "nl-platform", name: "Northwind Outdoor BV (the sandbox platform account)", country: "NL", currency: "EUR", funding_account: "acct_op0_QItiOyWKsYb5pwQihA" };
/** The payee on file at entity A's account that the run uses (made on 10 Nov, the connected-accounts run). */
const PAYEE_AT_A = "f8678483-2718-4393-a328-d78261b5d5a4";

const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");
const ledgerOk = (env: Record<string, string | undefined>) => new RegExp(`governance-${run}[^\\\\/]*\\.sqlite$`).test(env.KIT11_DB ?? "");
const httpLog = () => join(runDir(), "http.jsonl");

function refusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.GOV_LIVE_GO !== "yes") why.push("GOV_LIVE_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > gov.GOV_LIVE_MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${gov.GOV_LIVE_MAX_BUDGET}`);
  if (!ledgerOk(env)) why.push(`KIT11_DB=…/governance-${run}*.sqlite (the run's own, fresh ledger)`);
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  return why;
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`governance-live stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { openDb } = await import("../db/open.js");
  const { FakeIssuing } = await import("../redteam/issuing.js");
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const { MANUFACTURER } = await import("../config/payees.js");
  const db = openDb(":memory:");
  const { lines, counted } = gov.standInLog();
  const base = { db, mode: "stand-in" as const, now: () => new Date(), lines: () => lines, halted: () => null, log: (l: string) => console.log(`STAND-IN ${l}`) };
  let res;
  if (run === "card-hours") {
    const iss = new FakeIssuing();
    res = await gov.runCardHours({ ...base, rail: counted(iss) });
  } else if (run === "stop-rail") {
    const awx = new FakeAirwallex();
    awx.bal.EUR.availableCents = 6_000_000;
    await awx.createBeneficiary(MANUFACTURER);
    const rail = counted(awx);
    res = await gov.runStopRail({ ...base, awx: rail, simBank: new FakeAirwallex(), issuing: counted(new FakeIssuing()), transferExists: async (rid) => awx.transfers.some((t) => t.requestId === rid) });
  } else if (run === "replace-failed") {
    const awx = new FakeAirwallex();
    awx.bal.EUR.availableCents = 6_000_000;
    await awx.createBeneficiary(MANUFACTURER);
    res = await gov.runReplaceFailed({ ...base, awx: counted(awx), transferExists: async (rid) => awx.transfers.some((t) => t.requestId === rid), sleep: async () => undefined });
  } else {
    const a = new FakeAirwallex(), b = new FakeAirwallex();
    a.payingAccount = ENTITY_A.funding_account;
    a.bal.EUR.availableCents = 5_406;
    const payee = { name: "Zeeland Verpakkingen BV", iban: "NL91ABNA0417164300", bic: "ABNANL2A", currency: "EUR" as const, countryCode: "NL" as const, bankName: "ABN AMRO", address: { street: "Testlaan 1", city: "Middelburg", postcode: "4331", countryCode: "NL" as const } };
    const ben = await a.createBeneficiary(payee as never);
    const bExplicit = new FakeAirwallex();
    bExplicit.payingAccount = ENTITY_B.funding_account;
    res = await gov.runEntities({
      ...base, a: { entity: ENTITY_A, rail: counted(a) }, b: { entity: ENTITY_B, rail: counted(bExplicit), ownRail: counted(b) },
      payeeAtA: async () => ({ id: ben.id, name: payee.name, iban: payee.iban, bic: payee.bic }),
      transferExists: async (at, rid) => (at === "a" ? a : b).transfers.some((t) => t.requestId === rid),
    });
  }
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
  const used = (db.prepare("SELECT (SELECT COUNT(*) FROM proposals) + (SELECT COUNT(*) FROM passkeys) + (SELECT COUNT(*) FROM cards) AS n").get() as { n: number }).n;
  if (used) { console.error("REFUSED  this ledger is not fresh (proposals, passkeys or cards in it)"); process.exit(2); }
  const { fromEnv, Airwallex, SANDBOX_BASE } = await import("../airwallex/client.js");
  const { budgetFromEnv } = await import("../airwallex/callBudget.js");
  const { IssuingRest } = await import("../airwallex/issuing.js");
  const { AirwallexRest } = await import("../airwallex/adapter.js");
  const { FakeAirwallex } = await import("../redteam/airwallex.js");
  const cfg = fromEnv();
  if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
  if ((cfg.baseUrl ?? SANDBOX_BASE) !== SANDBOX_BASE || !SANDBOX_BASE.startsWith("https://api.sandbox.airwallex.com/")) { console.error("REFUSED  the configured base URL is not the sandbox; nothing was called"); process.exit(2); }
  console.log(`SANDBOX  ${SANDBOX_BASE} (test money); budget ${process.env.AIRWALLEX_CALL_BUDGET}`);
  const fetchImpl = drillFetch(budgetFromEnv(process.env, (...a) => fetch(...a))!, { file: httpLog(), toleratedSimFailures: 1 });
  const api = new Airwallex({ ...cfg, fetchImpl });
  const out = join(runDir(), "results.json");
  const base = { db, mode: "live" as const, now: () => new Date(), lines: () => readDrillLog(httpLog()), halted: () => drillHaltReason(httpLog()), log: (l: string) => console.log(l), save: (r: unknown) => writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`) };
  type TItem = { request_id?: string };
  const existsWith = (a: InstanceType<typeof Airwallex>) => async (rid: string) => ((await a.call<{ items?: TItem[] }>("GET", "/transfers", undefined, { request_id: rid, page_num: "0", page_size: "10" })).items ?? []).some((i) => i.request_id === rid);
  let res;
  if (run === "card-hours") {
    res = await gov.runCardHours({ ...base, rail: new IssuingRest(api) });
  } else if (run === "stop-rail") {
    const rest = new AirwallexRest(api);
    res = await gov.runStopRail({ ...base, awx: rest, simBank: new FakeAirwallex(), issuing: new IssuingRest(api), transferExists: existsWith(api) });
  } else if (run === "replace-failed") {
    res = await gov.runReplaceFailed({ ...base, awx: new AirwallexRest(api), transferExists: existsWith(api), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  } else {
    const apiA = new Airwallex({ ...cfg, fetchImpl, onBehalfOf: ENTITY_A.funding_account });
    const apiBExplicit = new Airwallex({ ...cfg, fetchImpl, onBehalfOf: ENTITY_B.funding_account });
    type B = { id: string; beneficiary?: { company_name?: string; bank_details?: { iban?: string; swift_code?: string; account_name?: string; account_currency?: string; bank_name?: string } } };
    res = await gov.runEntities({
      ...base, a: { entity: ENTITY_A, rail: new AirwallexRest(apiA) }, b: { entity: ENTITY_B, rail: new AirwallexRest(apiBExplicit), ownRail: new AirwallexRest(api) },
      payeeAtA: async () => {
        const r = await apiA.call<{ items: B[] }>("GET", "/beneficiaries", undefined, { page_num: "0", page_size: "100" });
        const hit = r.items.find((x) => x.id === PAYEE_AT_A && x.beneficiary?.bank_details?.iban && x.beneficiary.bank_details.account_currency === "EUR");
        const bd = hit?.beneficiary?.bank_details;
        // Airwallex's record of this payee holds no swift_code (read 26 Nov); its bank is ABN AMRO, whose BIC is ABNANL2A:
        // the allowlist row and the test invoice carry that. Attempts 1 and 2 left it empty and stopped at the invoice check.
        const bic = bd?.swift_code || (/ABN AMRO/i.test(bd?.bank_name ?? "") ? "ABNANL2A" : "");
        return hit && bd?.iban && bic ? { id: hit.id, name: hit.beneficiary?.company_name ?? bd.account_name ?? "", iban: bd.iban.replace(/\s+/g, ""), bic } : undefined;
      },
      transferExists: (at, rid) => existsWith(at === "a" ? apiA : api)(rid),
    });
  }
  console.log(`SUMMARY  ${run}: ${res.steps.length} steps, ${res.steps.filter((s) => s.pass === true).length} passed, ${res.steps.filter((s) => s.pass === false).length} failed; ${readDrillLog(httpLog()).length} requests${res.stopped ? `; STOPPED: ${res.stopped}` : ""}`);
} else if (cmd === "record") {
  if (!ledgerOk(process.env) || !process.env.AIRWALLEX_CALL_LOG) { console.error(`REFUSED  KIT11_DB=…/governance-${run}*.sqlite and AIRWALLEX_CALL_LOG (this run's own files); nothing was read`); process.exit(2); }
  const file = join(runDir(), "results.json");
  if (!existsSync(file)) { console.error(`no results in ${runDir()}: run live first`); process.exit(2); }
  const { readCallLog } = await import("../airwallex/callBudget.js");
  const { drillRecord, renderDrillMarkdown } = await import("../e2e/drillRecord.js");
  const { GOV_RECORD } = await import("../e2e/governanceLiveRecord.js");
  const r = JSON.parse(readFileSync(file, "utf8")) as import("../e2e/governanceLive.js").GovResults;
  const date = process.env.GOV_LIVE_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("GOV_LIVE_DATE is YYYY-MM-DD"); process.exit(2); }
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } })();
  const meta = GOV_RECORD[run];
  const rec = drillRecord({
    run, date, command: `npm run airwallex:governance-live -- live ${run}`, commit, simulated: meta.simulated, max: gov.GOV_LIVE_MAX_BUDGET,
    approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, cards: r.cards,
    passes: [{ pass_no: 1, started_at: r.started_at, ended_at: r.ended_at, stopped: r.stopped, note: meta.note, timings: Object.fromEntries(Object.entries(r.timings).filter(([k]) => k.endsWith("_ms"))), steps: r.steps }],
    lines: readDrillLog(httpLog()), callLog: readCallLog(process.env.AIRWALLEX_CALL_LOG), notShown: meta.notShown,
  });
  const name = `${date}-${RECORD_NAME[run]}`;
  const baseFile = resolve(repo, "docs/runs", name);
  writeFileSync(`${baseFile}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${baseFile}.md`, renderDrillMarkdown(rec, { title: meta.title, intro: meta.intro, file: `docs/runs/${name}.json`, summary: meta.summary(rec) }));
  console.log(`WROTE    ${baseFile}.json\nWROTE    ${baseFile}.md`);
} else {
  console.error(`usage: npm run airwallex:governance-live -- stand-in|live|record ${gov.GOV_RUNS.join("|")}`);
  process.exit(2);
}
