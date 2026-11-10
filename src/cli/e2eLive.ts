// npm run e2e:live            the platform end-to-end as a dry run: three test companies, every outside service a
//                             stand-in, nothing leaves this machine; prints what a live run would call
// npm run e2e:live -- --live  the live run (Airwallex sandbox, Claude, T:0 sandbox). Also needs E2E_LIVE=yes in the
//                             environment, keeps to the approved budget (E2E_BUDGET="airwallex=26,t0=12,claude=8"), and
//                             refuses before any call when the dry run says the run would need more.
// Options: --dir <folder> (default data/e2e/<time>). T0_RATES (e.g. "EUR=1.08") when T:0's currency is not EUR.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CallBudget, PHASE2_BUDGET, type Service } from "../e2e/budget.js";
import { estimateLive } from "../e2e/estimate.js";
import { functionalCurrency } from "../accounting/t0.js";
import { runPlatformE2E, type RunSummary } from "../e2e/platformRun.js";
import { budgetedReader, dryRunDeps, liveDeps, parserOnly } from "../e2e/setup.js";

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
