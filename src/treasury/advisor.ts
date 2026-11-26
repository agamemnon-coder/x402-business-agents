// The Treasury advisor's ledger side (docs/treasury.md): it reads the forecast's inputs from what Purser already holds
// (unpaid supplier invoices, open customer invoices, approved card charges, the CFO's floors), reads indicative FX
// rates from the Airwallex sandbox (GET /fx/rates/current: read-only, nothing is quoted or converted), and files a
// conversion the advice suggests as a proposal that the CFO approves with the passkey like any money action. It never
// converts anything itself: src/executors/fxConversion.ts runs an approved one, and only that.

import { randomUUID } from "node:crypto";
import type { Balance, PayoutRail } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { cashByCurrency } from "../ledger/reports.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { createProposal, ProposalRefused, type ProposalRow } from "../policy/approvals.js";
import { frozen, paused, policyValue } from "../policy/rules.js";
import { floorCents } from "../payouts/plan.js";
import { SWIFT_CURRENCIES } from "../payouts/routes.js";
import { cashForecast, type Forecast, type ForecastInput, type ForecastItem } from "./forecastCore.js";
import { FX_THRESHOLD_KEY, fxAdvice, fxExposure, ratesNeeded, type FxAdvice, type FxSuggestion, type IndicativeRate } from "./fxCore.js";

const has = (db: DB, t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const cents = (amount: string): number | null => { try { return toCents(amount); } catch { return null; } };

/** The opening balances from the ledger's bank accounts (test *USDZ on chain left out: not Airwallex money). */
export function ledgerOpening(db: DB): { currency: string; cents: number }[] {
  const by = new Map<string, number>();
  for (const r of cashByCurrency(db)) if (r.currency !== "USDZ") by.set(r.currency, (by.get(r.currency) ?? 0) + r.balance_cents);
  return [...by].map(([currency, c]) => ({ currency, cents: c })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The opening balances as Airwallex reports them available (pending and reserved money never counts). */
export const airwallexOpening = (b: Record<string, Balance>) =>
  Object.entries(b).map(([currency, x]) => ({ currency, cents: x.availableCents })).sort((a, b2) => a.currency.localeCompare(b2.currency));

/** The forecast's inputs from the ledger, on `asOf`, with the opening balances the caller read. */
export function forecastInput(db: DB, asOf: string, opening: { currency: string; cents: number }[], openingSource: string): ForecastInput {
  const payables: ForecastItem[] = [];
  if (has(db, "ap_invoices")) {
    for (const r of db.prepare("SELECT id, currency, total, due_date FROM ap_invoices WHERE status NOT IN ('paid', 'rejected') ORDER BY id").all() as { id: string; currency: string; total: string; due_date: string }[]) {
      const c = cents(r.total);
      if (c !== null && c > 0 && /^\d{4}-\d{2}-\d{2}/.test(r.due_date)) payables.push({ ref: r.id, currency: r.currency, cents: c, due_date: r.due_date.slice(0, 10) });
    }
  }
  const receivables: ForecastItem[] = [];
  for (const t of ["ar_invoices", "receivables"]) {
    if (!has(db, t)) continue;
    for (const r of db.prepare(`SELECT invoice_no, currency, amount_cents - paid_cents AS open, due_date FROM ${t} WHERE status IN ('OPEN', 'PARTIAL') ORDER BY invoice_no`).all() as { invoice_no: string; currency: string; open: number; due_date: string }[]) {
      if (r.open > 0) receivables.push({ ref: r.invoice_no, currency: r.currency, cents: r.open, due_date: r.due_date.slice(0, 10) });
    }
  }
  const cardHistory = has(db, "card_transactions")
    ? (db.prepare("SELECT merchant, currency, amount_cents, occurred_at FROM card_transactions WHERE approved = 1 AND amount_cents > 0 ORDER BY occurred_at").all() as { merchant: string; currency: string; amount_cents: number; occurred_at: string }[])
      .map((c) => ({ merchant: c.merchant, currency: c.currency, cents: c.amount_cents, date: c.occurred_at.slice(0, 10) }))
    : [];
  const currencies = new Set([...opening.map((o) => o.currency), ...payables.map((p) => p.currency), ...receivables.map((r) => r.currency), ...cardHistory.map((c) => c.currency)]);
  const floors = Object.fromEntries([...currencies].map((c) => [c, floorOrZero(db, c)]));
  return { asOf, opening, openingSource, payables, receivables, cardHistory, floors };
}

function floorOrZero(db: DB, currency: string): number {
  try { return floorCents(db, currency); } catch { return 0; }
}

export const ledgerForecast = (db: DB, asOf: string): Forecast => cashForecast(forecastInput(db, asOf, ledgerOpening(db), "the ledger's cash per currency"));

/** The CFO's FX threshold in EUR cents (policy treasury.fx_threshold_eur), or null while it is not set. */
export function fxThresholdCents(db: DB): number | null {
  const v = policyValue(db, FX_THRESHOLD_KEY);
  return v ? toCents(v) : null;
}

/** The indicative rates the advice needs, read from Airwallex (GET /fx/rates/current); a pair it cannot price is left out. */
export async function indicativeRates(rail: Pick<PayoutRail, "currentRateAny">, f: Forecast, source = "Airwallex sandbox, GET /fx/rates/current (indicative)"): Promise<{ rates: IndicativeRate[]; missing: string[] }> {
  const rates: IndicativeRate[] = [], missing: string[] = [];
  for (const n of ratesNeeded(fxExposure(f))) {
    try {
      const r = await rail.currentRateAny({ buyCurrency: n.buy_currency, sellCurrency: n.sell_currency, buyAmountCents: n.buy_cents });
      rates.push({ ...n, sell_cents: r.sellAmountCents, rate: r.rate, at: r.at, source });
    } catch (e) {
      missing.push(`${n.sell_currency}→${n.buy_currency}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return { rates, missing };
}

export const adviseFx = (db: DB, f: Forecast, rates: readonly IndicativeRate[]): FxAdvice => fxAdvice(f, rates, fxThresholdCents(db));

export interface FxConversionTerms extends Terms {
  kind: "fx_conversion";
  buy_currency: string;
  buy_amount: string;
  sell_currency: string;
  /** The most the conversion may sell: what the CFO signs. */
  sell_max: string;
  indicative_sell: string;
  indicative_rate: string;
  rate_at: string;
  rate_source: string;
  conversion_request_id: string;
  reason: string;
  forecast_as_of: string;
  forecast_sha256: string;
  money: string;
}

/** How long a filed conversion waits for the CFO: a day (the executor takes a fresh quote and holds it to sell_max). */
export const FX_PROPOSAL_TTL_MS = 24 * 3600_000;

/**
 * Files one suggested conversion for the CFO's passkey, after the policy's checks: no emergency stop, the Treasury agent
 * not paused, the CFO's threshold set and met, both currencies ones Airwallex pays in, the sell currency still above
 * its floor after the most it may sell, and no other conversion of the same pair waiting. Moves nothing.
 */
export function proposeFxConversion(db: DB, s: FxSuggestion, f: Forecast, now = new Date()): ProposalRow {
  const threshold = fxThresholdCents(db);
  const refuse = (why: string): never => {
    audit(db, "treasury", "treasury.fx_refused", `${s.sell_currency}/${s.buy_currency}`, { reason: why, buy: fromCents(s.buy_cents), test_money: true }, now);
    throw new ProposalRefused(why);
  };
  if (frozen(db)) refuse("the CFO's emergency stop is on: nothing is proposed");
  if (paused(db, "treasury")) refuse("the CFO paused the Treasury agent: nothing is proposed");
  if (threshold === null) refuse(`the CFO has set no FX threshold (${FX_THRESHOLD_KEY})`);
  if (s.eur_cents < threshold!) refuse(`about EUR ${fromCents(s.eur_cents)} is below the CFO's threshold of EUR ${fromCents(threshold!)}`);
  for (const c of [s.buy_currency, s.sell_currency]) if (!(SWIFT_CURRENCIES as readonly string[]).includes(c)) refuse(`${c} is not a currency Purser converts`);
  const sell = f.currencies.find((c) => c.currency === s.sell_currency);
  if (!sell || sell.min_closing_cents - s.sell_max_cents < sell.floor_cents) refuse(`selling up to ${s.sell_currency} ${fromCents(s.sell_max_cents)} would take ${s.sell_currency} under its floor in the forecast`);
  const pair = `${s.sell_currency}/${s.buy_currency}`;
  const terms: FxConversionTerms = {
    schema: TERMS_SCHEMA, kind: "fx_conversion", proposal_id: "P-PENDING",
    expires_at: new Date(now.getTime() + FX_PROPOSAL_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    buy_currency: s.buy_currency, buy_amount: fromCents(s.buy_cents), sell_currency: s.sell_currency, sell_max: fromCents(s.sell_max_cents),
    indicative_sell: fromCents(s.sell_cents), indicative_rate: s.rate, rate_at: s.rate_at, rate_source: s.rate_source,
    conversion_request_id: randomUUID(), reason: s.reason, forecast_as_of: f.as_of, forecast_sha256: sha256Hex(JSON.stringify(f.currencies)),
    money: "test money (Airwallex sandbox)",
  };
  const guard = (tx: DB) => {
    const open = tx.prepare("SELECT terms_json FROM proposals WHERE kind = 'fx_conversion' AND status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')").all() as { terms_json: string }[];
    return open.some((o) => { const t = JSON.parse(o.terms_json) as FxConversionTerms; return `${t.sell_currency}/${t.buy_currency}` === pair; })
      ? `a ${pair} conversion is already waiting; a second is not filed` : null;
  };
  return createProposal(db, { terms, createdBy: "treasury", explanation: s.reason, guard, assignId: true }, now);
}
