// npm run treasury -- forecast | fx: the Treasury advisor (docs/treasury.md). Advice only; test money, Airwallex sandbox.
//   forecast [--as-of YYYY-MM-DD] [--ledger] [--json]   the 13-week cash forecast. Opening balances from Airwallex's
//            available balances when the sandbox keys are set (read-only), else (or with --ledger) the ledger's cash.
//   fx [--as-of …] [--ledger] [--propose] [--json]       FX exposure per currency against the CFO's floors, indicative
//            rates read from Airwallex (GET /fx/rates/current, read-only), and a suggested conversion where a shortfall
//            is worth at least the CFO's threshold (policy treasury.fx_threshold_eur). With --propose each suggestion is
//            filed as a proposal for the CFO's passkey; nothing converts until the CFO approves it.
// The ledger is KIT11_DB.

import { airwallexFromEnv } from "../airwallex/adapter.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { ProposalRefused } from "../policy/approvals.js";
import { adviseFx, airwallexOpening, forecastInput, fxThresholdCents, indicativeRates, ledgerOpening, proposeFxConversion } from "../treasury/advisor.js";
import { cashForecast, signedAmount, type Forecast } from "../treasury/forecastCore.js";
import { FX_THRESHOLD_KEY } from "../treasury/fxCore.js";

const args = process.argv.slice(2);
const mode = args[0];
const flag = (k: string) => args.includes(k);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (mode !== "forecast" && mode !== "fx") {
  console.error("usage: npm run treasury -- forecast|fx [--as-of YYYY-MM-DD] [--ledger] [--json] [--propose (fx only)]");
  process.exit(2);
}
const asOf = arg("--as-of") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { console.error("--as-of is YYYY-MM-DD"); process.exit(2); }

const db = openDb();
const awx = flag("--ledger") ? null : await airwallexFromEnv();
const opening = awx ? airwallexOpening(await awx.rail.balancesAll()) : ledgerOpening(db);
const forecast = cashForecast(forecastInput(db, asOf, opening, awx ? "Airwallex sandbox available balances (read-only)" : "the ledger's cash per currency (no Airwallex keys, or --ledger)"));

const pad = (s: string, n: number) => s.padStart(n);
const when = (w: number) => (w ? `week ${w}` : "at the start");
function printForecast(f: Forecast): void {
  console.log(`FORECAST (not a promise of cash; test money): 13 weeks from ${f.as_of}; opening from ${f.opening_source}`);
  for (const c of f.currencies) {
    console.log(`\n${c.currency}  opening ${signedAmount(c.opening_cents)}  in ${signedAmount(c.in_cents)}  out ${signedAmount(c.out_cents)}  closing ${signedAmount(c.closing_cents)}  lowest ${signedAmount(c.min_closing_cents)} (${when(c.min_week)})  floor ${signedAmount(c.floor_cents)}${c.below_floor_weeks.length ? `  BELOW FLOOR in weeks ${c.below_floor_weeks.join(", ")}` : ""}`);
    console.log(`  wk  from        ${pad("in", 12)} ${pad("payables", 12)} ${pad("cards", 12)} ${pad("closing", 14)}`);
    for (const w of f.weeks) {
      const r = w.rows.find((x) => x.currency === c.currency)!;
      console.log(`  ${String(w.week).padStart(2)}  ${w.from}  ${pad(signedAmount(r.receivables_cents), 12)} ${pad(signedAmount(r.payables_cents), 12)} ${pad(signedAmount(r.card_recurring_cents + r.card_other_cents), 12)} ${pad(signedAmount(r.closing_cents), 14)}${r.below_floor ? "  < floor" : ""}`);
    }
  }
  if (f.recurring.length) console.log(`\nrecurring card charges: ${f.recurring.map((r) => `${r.merchant} ${r.currency} ${fromCents(r.cents)} every 30 days`).join("; ")}`);
  if (f.excluded.length) console.log(`left out: ${f.excluded.map((x) => `${x.ref} (${x.why})`).join("; ")}`);
  console.log(`\nmethod:\n${f.method.map((m) => `  - ${m}`).join("\n")}`);
}

if (mode === "forecast") {
  if (flag("--json")) console.log(JSON.stringify(forecast, null, 2));
  else printForecast(forecast);
  process.exit(0);
}

// fx
const { rates, missing } = awx ? await indicativeRates(awx.rail, forecast) : { rates: [], missing: ["no Airwallex sandbox keys: no rate read, so no conversion is suggested"] };
const advice = adviseFx(db, forecast, rates);
if (flag("--json")) console.log(JSON.stringify({ advice, missing }, null, 2));
else {
  const t = fxThresholdCents(db);
  console.log(`FX exposure (from the forecast; test money). CFO's threshold (${FX_THRESHOLD_KEY}): ${t === null ? "not set" : `EUR ${fromCents(t)}`}`);
  for (const e of advice.exposures) {
    console.log(`  ${e.currency}  balance ${signedAmount(e.balance_cents)}  in ${signedAmount(e.receivables_cents)}  out ${signedAmount(e.payables_cents)}  lowest ${signedAmount(e.min_closing_cents)} (${when(e.min_week)})  floor ${signedAmount(e.floor_cents)}  ${e.shortfall_cents ? `SHORT ${signedAmount(e.shortfall_cents)}` : `spare ${signedAmount(e.spare_cents)}`}`);
  }
  for (const n of [...advice.notes, ...missing]) console.log(`  note: ${n}`);
  for (const s of advice.suggestions) console.log(`\nSUGGESTED (advice; the CFO decides with the passkey): buy ${s.buy_currency} ${fromCents(s.buy_cents)} with at most ${s.sell_currency} ${fromCents(s.sell_max_cents)} (indicative ${fromCents(s.sell_cents)} at ${s.rate}, ${s.rate_source}, ${s.rate_at})\n  ${s.reason}`);
}
if (flag("--propose")) {
  for (const s of advice.suggestions) {
    try {
      const p = proposeFxConversion(db, s, forecast);
      console.log(`${p.proposal_id} filed: approve or reject it on the phone with Face ID (hash ${p.terms_sha256.slice(0, 8)}); nothing converts before that`);
    } catch (e) {
      if (!(e instanceof ProposalRefused)) throw e;
      console.log(`not filed: ${e.reason}`);
    }
  }
}
