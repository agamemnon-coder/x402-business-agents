// npm run e2e:live            the platform end-to-end as a dry run: three test companies, every outside service a
//                             stand-in, nothing leaves this machine; prints what a live run would call
// npm run e2e:live -- --live  the live run (Airwallex sandbox, Claude, T:0 sandbox). Also needs E2E_LIVE=yes in the
//                             environment, keeps to the approved budget (E2E_BUDGET="airwallex=26,t0=12,claude=8"), and
//                             refuses before any call when the dry run says the run would need more.
// Options: --dir <folder> (default data/e2e/<time>). T0_RATES (e.g. "EUR=1.08") when T:0's currency is not EUR.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CallBudget, PHASE2_BUDGET, type Service } from "../e2e/budget.js";
import { estimateLive } from "../e2e/estimate.js";
import { functionalCurrency } from "../accounting/t0.js";
import { runPlatformE2E, type RunSummary } from "../e2e/platformRun.js";
import { budgetedReader, dryRunDeps, liveDeps, parserOnly, PROXY_INJECTED, PURSER_PLATFORM_ACCOUNT } from "../e2e/setup.js";
import { finishRun } from "../e2e/finish.js";
import { retryCompany } from "../e2e/retry.js";
import { WaitingForAirwallexApproval } from "../e2e/platformRun.js";
import { Airwallex, fromEnv as airwallexEnv } from "../airwallex/client.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { WORLD } from "../e2e/world.js";
import { T0Client } from "../accounting/t0.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const dirArg = args.indexOf("--dir") >= 0 ? args[args.indexOf("--dir") + 1] : undefined;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const log = (l: string) => console.log(l);

function budgetFromEnv(raw: string | undefined): Record<Service, number> {
  const out = { ...PHASE2_BUDGET };
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(airwallex|t0|claude|metal)=(\d+)$/.exec(part);
    if (!m) throw new Error(`E2E_BUDGET: "${part}" is not service=number`);
    out[m[1] as Service] = Number(m[2]);
  }
  return out;
}

const print = (s: RunSummary) => {
  console.log(`\n${s.mode}: ${s.companies.length} companies, ${s.payments.length} approvals, ${s.payments.reduce((n, p) => n + p.transfers.length, 0)} payouts, ${s.t0.posted} T:0 entries`);
  for (const p of s.payments) console.log(`  ${p.company.padEnd(12)} ${p.kind} ${p.proposal_id}: ${p.transfers.map((t) => `${t.transfer_id} ${t.status} ${t.amount}${t.purser_fee ? ` (fee ${t.purser_fee})` : ""}`).join("; ")}\n  ${"".padEnd(12)} receipt: npm run verify-receipt -- ${p.receipt}`);
};

// --finish <run dir>: a live run that stopped part-way, finished from its ledgers without any Airwallex call: the facts
// of every company, and for each company whose payouts are all PAID its receipt and its entries in T:0, converted at the
// rate the run recorded in its log. Needs E2E_LIVE=yes (T:0 is live) and E2E_T0_CURRENCY as the run read it.
const finishAt = args.indexOf("--finish");
if (finishAt >= 0) {
  const runDir = args[finishAt + 1];
  if (!runDir || process.env.E2E_LIVE !== "yes") { console.error("--finish <run dir> needs E2E_LIVE=yes: nothing was called"); process.exit(2); }
  const log = readFileSync(`${runDir}.log`, "utf8");
  const m = /converted at Airwallex sandbox rate (\d+\.\d+) USD per EUR at (\S+) \((.+)\)$/m.exec(log);
  const cur = /^([A-Z]{3}):(\d+)$/.exec(process.env.E2E_T0_CURRENCY ?? "");
  if (!m || !cur) { console.error("the run's log has no recorded rate, or E2E_T0_CURRENCY is not set: nothing was called"); process.exit(2); }
  const fx = { rate: m[1]!, to: "USD", at: m[2]!, source: m[3]! };
  const budget = new CallBudget(budgetFromEnv(process.env.E2E_BUDGET), { file: join(runDir, "calls-finish.jsonl") });
  const client = new T0Client({ apiKey: PROXY_INJECTED, fetch: budget.fetchFor("t0"), retryDelayMs: 0 });
  // The chart as read once into the run's folder (t0-chart.json), so finishing does not read it again.
  const chartFile = join(runDir, "t0-chart.json");
  const chart = existsSync(chartFile) ? JSON.parse(readFileSync(chartFile, "utf8")) as Awaited<ReturnType<T0Client["listGlAccounts"]>> : null;
  const t0 = { listGlAccounts: async () => chart ?? client.listGlAccounts(), profitLoss: client.profitLoss.bind(client), postJournalEntry: client.postJournalEntry.bind(client), listJournalEntries: client.listJournalEntries.bind(client) };
  const facts = await finishRun({ t0, t0Rate: (_d, c) => (c === "EUR" ? Number(fx.rate) : undefined), t0Currency: { currency: cur[1]!, atomsPerUnit: Number(cur[2]) }, fx, now: () => new Date() }, runDir, `${runDir}.log`, WORLD);
  for (const f of facts) console.log(`${f.key.padEnd(12)} ${f.account}: ${f.transfers.map((t) => `${t.transfer_id ?? "(no transfer)"} ${t.status}`).join(", ")}${f.receipt ? `; receipt ${f.receipt}; T:0 ${f.t0_entries.join(", ")}` : ""}`);
  console.log(`Calls made: ${JSON.stringify({ airwallex: budget.used("airwallex"), t0: budget.used("t0"), claude: budget.used("claude") })}; facts in ${join(runDir, "facts.json")}`);
  process.exit(0);
}

// --retry <run dir> KEY[,KEY]: the companies' refused payouts paid again from their own ledgers (src/e2e/retry.ts), with
// their TEST registration numbers as the payer's; then their receipts (T:0 not posted: --t0 posts too). Needs E2E_LIVE=yes.
const retryAt = args.indexOf("--retry");
if (retryAt >= 0) {
  const runDir = args[retryAt + 1], keys = (args[retryAt + 2] ?? "").split(",").filter(Boolean);
  if (!runDir || !keys.length || process.env.E2E_LIVE !== "yes") { console.error("--retry <run dir> KEY[,KEY] needs E2E_LIVE=yes: nothing was called"); process.exit(2); }
  const cfg = airwallexEnv({ ...process.env, AIRWALLEX_CALL_BUDGET: undefined, AIRWALLEX_CALL_LOG: undefined, AIRWALLEX_PLATFORM: undefined });
  if (!cfg) { console.error("no Airwallex keys: nothing was called"); process.exit(2); }
  const facts = JSON.parse(readFileSync(join(runDir, "facts.json"), "utf8")) as { key: string; account: string }[];
  const budget = new CallBudget(budgetFromEnv(process.env.E2E_BUDGET), { file: join(runDir, "calls-retry.jsonl") });
  const fetchAwx = budget.fetchFor("airwallex");
  const rails = new Map<string, AirwallexRest>();
  const railFor = (accountId: string) => { let r = rails.get(accountId); if (!r) rails.set(accountId, (r = new AirwallexRest(new Airwallex({ clientId: cfg.clientId, apiKey: cfg.apiKey, fetchImpl: fetchAwx, onBehalfOf: accountId })))); return { rail: r, sim: r }; };
  const retryLog = (l: string) => { console.log(l); appendFileSync(`${runDir}.log`, `${l}\n`); };
  try {
    for (const key of keys) {
      const c = WORLD.find((w) => w.key === key), account = facts.find((f) => f.key === key)?.account;
      if (!c || !account) throw new Error(`${key}: not a company of this run`);
      await retryCompany({ platform: { feeAccount: PURSER_PLATFORM_ACCOUNT }, railFor, feeBps: "50", now: () => new Date(), log: retryLog }, runDir, { ...c, accountId: account });
    }
  } catch (e) {
    console.error(e instanceof WaitingForAirwallexApproval ? `IN_APPROVAL at Airwallex: ${e.transfers.join(", ")} (${e.company}): a person approves it in Airwallex's web app; then: --follow` : (e as Error).message);
    console.log(`Calls made: ${JSON.stringify({ airwallex: budget.used("airwallex"), t0: budget.used("t0"), claude: budget.used("claude") })}`);
    process.exit(e instanceof WaitingForAirwallexApproval ? 5 : 1);
  }
  const log = readFileSync(`${runDir}.log`, "utf8");
  const m = /converted at Airwallex sandbox rate (\d+\.\d+) USD per EUR at (\S+) \((.+)\)$/m.exec(log)!;
  const fx = { rate: m[1]!, to: "USD", at: m[2]!, source: m[3]! };
  const done = await finishRun({ t0: null as never, t0Rate: () => undefined, fx, now: () => new Date(), postT0: false, only: keys, factsFile: "facts-retry.json" }, runDir, `${runDir}.log`, WORLD);
  for (const f of done) console.log(`${f.key.padEnd(12)} ${f.account}: ${f.transfers.map((t) => `${t.transfer_id ?? "(none)"} ${t.status}`).join(", ")}; receipt ${f.receipt ?? "none"}`);
  console.log(`Calls made: ${JSON.stringify({ airwallex: budget.used("airwallex"), t0: budget.used("t0"), claude: budget.used("claude") })}`);
  process.exit(0);
}

// The dry run always runs first: it is the plan the live run is held to.
const dryDir = join(dirArg ?? join("data", "e2e", stamp), live ? "dry-run" : "");
mkdirSync(dryDir, { recursive: true });
const dry = dryRunDeps();
const counter = new CallBudget({ airwallex: 1e6, t0: 1e6, claude: 1e6, metal: 0 });
const dryRun = await runPlatformE2E({ ...dry.deps, readerFor: () => budgetedReader(parserOnly, counter), dir: dryDir, now: () => new Date(), log: live ? () => undefined : log });
const est = estimateLive(dry, counter.used("claude"));
if (!live) {
  print(dryRun);
  console.log(`\nA live run would make about:\n  ${est.detail.join("\n  ")}`);
  console.log(`\nDry run only: nothing left this machine. The live run: E2E_LIVE=yes npm run e2e:live -- --live`);
  process.exit(0);
}

if (process.env.E2E_LIVE !== "yes") { console.error("--live needs E2E_LIVE=yes in the environment as well: nothing was called"); process.exit(2); }
const caps = budgetFromEnv(process.env.E2E_BUDGET);
// A known currency saves the P&L read; a T:0 not in EUR costs one Airwallex rate call.
if (/^[A-Z]{3}:\d+$/.test(process.env.E2E_T0_CURRENCY ?? "")) est.calls.t0 -= 1;
if (process.env.E2E_T0_CURRENCY && !process.env.E2E_T0_CURRENCY.startsWith("EUR:")) est.calls.airwallex += 1;
const over = (Object.keys(caps) as Service[]).filter((s) => est.calls[s] > caps[s]);
console.log(`Budget: ${JSON.stringify(caps)}\nPlanned (from the dry run): ${JSON.stringify(est.calls)}\n  ${est.detail.join("\n  ")}`);
if (over.length) { console.error(`\nThe run would need more than approved for ${over.join(", ")}: nothing was called. Ask for a larger budget first.`); process.exit(3); }

const dir = dirArg ?? join("data", "e2e", stamp);
const budget = new CallBudget(caps, { file: join(dir, "calls.jsonl") });
mkdirSync(dir, { recursive: true });
const deps = liveDeps(budget, process.env);
if (typeof deps === "string") { console.error(deps); process.exit(2); }
// T:0's currency, read once before any money moves (one call), or as an earlier run read it (E2E_T0_CURRENCY, e.g.
// "USD:100"). Another currency than EUR: every EUR entry is converted at Airwallex's current sandbox rate (one call,
// on the platform's own login), named with its time in every entry's memo.
const known = /^([A-Z]{3}):(\d+)$/.exec(process.env.E2E_T0_CURRENCY ?? "");
const cur = known ? { currency: known[1]!, atomsPerUnit: Number(known[2]) } : await functionalCurrency(deps.t0);
console.log(`T:0's functional currency: ${cur.currency} (${cur.atomsPerUnit} atoms a unit)${known ? ", as read before (E2E_T0_CURRENCY)" : ""}`);
deps.t0Currency = cur;
if (cur.currency !== "EUR") {
  if (cur.currency !== "USD") { console.error(`T:0 books in ${cur.currency}: no rate source for it here. Stopped before any Airwallex call.`); process.exit(4); }
  const fx = await deps.platform.eurRate("USD");
  deps.fx = fx;
  deps.t0Rate = (_date, c) => (c === "EUR" ? Number(fx.rate) : undefined);
  console.log(`EUR entries converted at Airwallex sandbox rate ${fx.rate} USD per EUR at ${fx.at} (${fx.source})`);
}
try {
  print(await runPlatformE2E({ ...deps, dir, now: () => new Date(), log }));
} finally {
  console.log(`\nCalls made: ${JSON.stringify({ airwallex: budget.used("airwallex"), t0: budget.used("t0"), claude: budget.used("claude") })} (log: ${join(dir, "calls.jsonl")})`);
}
