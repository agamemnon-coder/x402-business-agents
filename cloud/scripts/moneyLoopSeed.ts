// npm run cloud:money-loop-seed: writes cloud/src/guest/moneyLoop.gen.ts, the demo company's Cash & FX and Receivables
// (v1.5.1). Made here by the runner's own code on stand-ins, with no network and no model: the demo's sales invoices
// and the payments matched to them, the same ones its books hold (./demoReceivables.ts), the reminder drafts due by
// the demo's last day; then the 13-week forecast from that ledger
// (src/treasury/advisor.ts), the FX advice on a stand-in indicative rate (labelled so), and the conversion it suggests
// filed for the CFO's passkey, never approved. Then the snapshot the runner would push (src/treasury/cloudSnapshot.ts).
// Its cash per currency is the demo company's ledger bank on its last day (accounts 1200, 1201 and 1202 in
// cloud/src/guest/seed.gen.ts: the opening balances its books hold, plus everything that moved), the figure its Books
// and its Overview show; its payables the two invoices that wait there (BTX-2026-24, ZV-4471) and a USD supplier
// invoice. Demo data: no real money, no real company, no real customer.
import { writeFileSync } from "node:fs";
import { openDb, type DB } from "../../src/db/open.js";
import { postEntry } from "../../src/ledger/core.js";
import { cashByCurrency } from "../../src/ledger/reports.js";
import { bankAccountFor } from "../../src/config/gl.js";
import { draftReminders } from "../../src/receivables/ar.js";
import { isBank } from "../../src/ledger/accounts.js";
import { forecastInput, ledgerOpening, proposeFxConversion } from "../../src/treasury/advisor.js";
import { cashForecast } from "../../src/treasury/forecastCore.js";
import { fxAdvice, ratesNeeded, fxExposure, type IndicativeRate } from "../../src/treasury/fxCore.js";
import { moneyLoopSnapshot } from "../../src/treasury/cloudSnapshot.js";
import { DEMO_END, SEED_BATCHES } from "../src/guest/seed.gen.js";
import { DEMO_AR_STEPS } from "./demoReceivables.js";

const end = new Date(DEMO_END);
const asOf = DEMO_END.slice(0, 10);
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const db: DB = openDb(":memory:");
const set = (key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, at("2026-10-01").toISOString());

// The CFO's policy: a floor per currency and the FX threshold above which a conversion is proposed (and needs the passkey).
set("eur_floor", "2000.00");
set("usd_floor", "1000.00");
set("floor.GBP", "1000.00");
set("treasury.fx_threshold_eur", "400.00");

// The demo company's sales invoices and the payments matched to them, the same story its books hold
// (cloud/scripts/demoReceivables.ts; customer and payer names stay on the runner).
for (const step of DEMO_AR_STEPS) await step.run(db, at(step.day, step.hour));
draftReminders(db, asOf, end);

// Payables the forecast counts: the two the demo company waits on, and a USD data supplier's invoice.
const doc = db.prepare("INSERT INTO ap_documents (sha256, filename, mime, bytes, path, source, text_chars, received_at) VALUES (?, ?, 'application/pdf', 1, ?, 'upload', 1, ?)");
const ap = db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by, gl_account, gl_rule, cost_centre, status, findings_json, received_at, updated_at)
  VALUES (?, ?, 'invoice', 'code', ?, ?, ?, ?, ?, ?, ?, ?, '0000', 'DEMOXXXX', '{}', 'code', '6900', 'demo', 'ops', ?, '[]', ?, ?)`);
for (const [id, vendor, no, issued, due, currency, sub, tax, total, status] of [
  ["AP-0005", "Bergtex Textil GmbH", "BTX-2026-24", "2026-11-09", "2026-11-23", "EUR", "1100.00", "209.00", "1309.00", "waiting_cfo"],
  ["AP-0006", "Zeeland Verpakkingen B.V.", "ZV-4471", "2026-11-03", "2026-11-17", "EUR", "400.00", "84.00", "484.00", "needs_vendor"],
  ["AP-0008", "Ridgeline Data Inc", "RD-2026-118", "2026-11-05", "2026-11-19", "USD", "2400.00", "0.00", "2400.00", "ready"],
] as const) {
  doc.run(`demo-${id}`, `${no}.pdf`, `demo/${no}.pdf`, at(issued).toISOString());
  ap.run(id, `demo-${id}`, vendor, no, issued, due, currency, sub, tax, total, status, at(issued).toISOString(), at(issued).toISOString());
}

// The agents' card charges the forecast reads (a monthly subscription repeats; the rest is averaged per week).
db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'ch_demo', 'card_demo_sourcing', '4242', 'Sourcing (demo)', 'EUR', 5000, 20000, 'ACTIVE', ?, ?)").run(at("2026-10-01").toISOString(), at("2026-10-01").toISOString());
const charge = db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES (?, 'card_demo_sourcing', 'sourcing', ?, '5734', ?, ?, 'APPROVED', 1, 'simulation', ?, ?)");
for (const [id, merchant, cents, currency, day] of [
  ["ctx_demo_1", "Packwise", 1999, "EUR", "2026-10-10"], ["ctx_demo_2", "Packwise", 1999, "EUR", "2026-11-09"],
  ["ctx_demo_3", "Stockline data", 12_000, "USD", "2026-10-13"], ["ctx_demo_4", "Stockline data", 12_000, "USD", "2026-11-11"],
  ["ctx_demo_5", "Replyhub", 3800, "EUR", "2026-10-19"], ["ctx_demo_6", "Replyhub", 3800, "EUR", "2026-11-03"],
] as const) charge.run(id, merchant, cents, currency, at(day).toISOString(), at(day).toISOString());

// The opening balances, so that the cash per currency on the demo's last day is the demo company's own ledger bank:
// what its books hold on 1200, 1201 and 1202 (their opening balances against owner's equity, 3000, and every movement
// booked since). One figure for Books, Cash & FX and the Overview; none made up here.
const ledgerBank = () => {
  const by: Record<string, number> = {};
  for (const b of SEED_BATCHES) for (const e of ((b as { ledger_entries?: { lines: { account: string; currency: string; debit_cents: number; credit_cents: number }[] }[] }).ledger_entries ?? [])) {
    for (const l of e.lines) if (isBank(l.account) && l.currency !== "USDZ") by[l.currency] = (by[l.currency] ?? 0) + l.debit_cents - l.credit_cents;
  }
  return by;
};
const TARGET = ledgerBank();
if (!TARGET.EUR) throw new Error("the demo company's ledger holds no EUR bank balance");
const now = Object.fromEntries(cashByCurrency(db).map((r) => [r.currency, r.balance_cents]));
for (const [currency, want] of Object.entries(TARGET)) {
  const diff = want - (now[currency] ?? 0);
  if (diff < 0) throw new Error(`${currency}: the payments here exceed the demo company's ledger bank`);
  if (diff === 0) continue;
  postEntry(db, { date: "2026-10-01", description: `Opening balance, ${currency} Global Account (demo, test money)`, created_by: "treasury", source_key: `demo:opening:${currency}`,
    lines: [{ account: bankAccountFor(currency), debit: diff, currency }, { account: "3000", credit: diff, currency }] }, at("2026-10-01"));
}
const read = Object.fromEntries(cashByCurrency(db).map((r) => [r.currency, r.balance_cents]));
for (const [currency, want] of Object.entries(TARGET)) if (read[currency] !== want) throw new Error(`${currency}: ${read[currency]} here, ${want} in the demo company's ledger`);

// The forecast, the advice on stand-in indicative rates (the runner reads Airwallex's; the demo reads none), and the
// conversion it suggests, filed for the CFO's passkey and left waiting.
const f = cashForecast(forecastInput(db, asOf, ledgerOpening(db), "the ledger's cash per currency"));
const STAND_IN: Record<string, number> = { "USD/EUR": 0.9210, "GBP/EUR": 1.1590, "USD/GBP": 0.7947 };
const rates: IndicativeRate[] = ratesNeeded(fxExposure(f)).flatMap((n) => {
  const r = STAND_IN[`${n.buy_currency}/${n.sell_currency}`];
  return r ? [{ ...n, sell_cents: Math.round(n.buy_cents * r), rate: r.toFixed(4), at: at(asOf, 15).toISOString(), source: "demo stand-in rate (indicative, not Airwallex's)" }] : [];
});
const advice = fxAdvice(f, rates, 40_000);
for (const s of advice.suggestions) proposeFxConversion(db, s, f, at(asOf, 15));
const snap = moneyLoopSnapshot(db, end, advice, f);
if (!snap.fx.proposals.some((p) => p.status === "PENDING_APPROVAL")) throw new Error("the demo's conversion was not filed");
writeFileSync(new URL("../src/guest/moneyLoop.gen.ts", import.meta.url), `// Generated by npm run cloud:money-loop-seed (cloud/scripts/moneyLoopSeed.ts): the demo company's Cash & FX and
// Receivables. Do not edit. Demo data, made on stand-ins by the runner's own code: no real money, no real customer.
import type { MoneyLoopSnapshot } from "../moneyLoop.js";

export const DEMO_MONEY_LOOP: MoneyLoopSnapshot = ${JSON.stringify(snap)};
`);
console.log(`money loop ${snap.as_of}: ${snap.cash.map((c) => `${c.currency} ${(c.cents / 100).toFixed(2)}`).join(", ")}; ${snap.receivables.invoices.length} invoices, ${snap.receivables.payments.length} payments, ${snap.receivables.review.length} to review, ${snap.receivables.dunning.length} reminder steps; ${advice.suggestions.length} conversion(s) filed; ${advice.notes.length} note(s)`);
