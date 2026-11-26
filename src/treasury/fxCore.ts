// The Treasury advisor's FX exposure and conversion suggestions (docs/treasury.md): pure, over a forecast
// (src/treasury/forecastCore.ts) and indicative rates the caller read (Airwallex sandbox, GET /fx/rates/current, which
// moves nothing). A suggestion is advice only: src/treasury/advisor.ts turns it into a proposal that the CFO approves
// with the passkey, and src/executors/fxConversion.ts runs it only then. Nothing here converts anything.
//
// Rules:
//   exposure   per currency, the forecast's lowest closing balance against the CFO's floor: a shortfall is what must
//              be bought to stay at the floor in the worst week; a spare is what is above it in that worst week.
//   threshold  the CFO's policy treasury.fx_threshold_eur: a shortfall is worth a conversion only when its cost in
//              EUR (at the indicative rate) is at or above it. Not set: nothing is suggested.
//   source     the currency to sell is one with a spare that covers the sell amount plus a 1% rate buffer (the most the
//              CFO signs for); EUR first when it can, else the one with the most spare relative to what it would sell.
//              None: no suggestion, a funding question for the CFO in words.

import { signedAmount, type Forecast } from "./forecastCore.js";

export interface Exposure {
  currency: string;
  balance_cents: number;
  receivables_cents: number;
  payables_cents: number;
  min_closing_cents: number;
  min_week: number;
  floor_cents: number;
  shortfall_cents: number;
  spare_cents: number;
}

export interface IndicativeRate { buy_currency: string; sell_currency: string; buy_cents: number; sell_cents: number; rate: string; at: string; source: string }

export interface FxSuggestion {
  buy_currency: string;
  buy_cents: number;
  sell_currency: string;
  /** At the indicative rate. */
  sell_cents: number;
  /** The most the CFO signs to sell: the indicative amount plus SELL_BUFFER_BPS, rounded up to the cent. */
  sell_max_cents: number;
  rate: string;
  rate_at: string;
  rate_source: string;
  eur_cents: number;
  threshold_eur_cents: number;
  week: number;
  reason: string;
}

export interface FxAdvice { label: "advice"; exposures: Exposure[]; suggestions: FxSuggestion[]; notes: string[] }

/** The rate buffer on a suggested sell amount, in basis points (1%). */
export const SELL_BUFFER_BPS = 100;
export const FX_THRESHOLD_KEY = "treasury.fx_threshold_eur";

export function fxExposure(f: Forecast): Exposure[] {
  return f.currencies.map((c) => ({
    currency: c.currency, balance_cents: c.opening_cents, receivables_cents: c.in_cents, payables_cents: c.out_cents,
    min_closing_cents: c.min_closing_cents, min_week: c.min_week, floor_cents: c.floor_cents,
    shortfall_cents: Math.max(0, c.floor_cents - c.min_closing_cents), spare_cents: Math.max(0, c.min_closing_cents - c.floor_cents),
  }));
}

/** The indicative rates the advice needs: each short currency against EUR, and against each currency with a spare. */
export function ratesNeeded(ex: readonly Exposure[]): { buy_currency: string; sell_currency: string; buy_cents: number }[] {
  const out: { buy_currency: string; sell_currency: string; buy_cents: number }[] = [];
  for (const s of ex.filter((e) => e.shortfall_cents > 0)) {
    if (s.currency !== "EUR") out.push({ buy_currency: s.currency, sell_currency: "EUR", buy_cents: s.shortfall_cents });
    for (const o of ex) if (o.currency !== s.currency && o.spare_cents > 0 && o.currency !== "EUR") out.push({ buy_currency: s.currency, sell_currency: o.currency, buy_cents: s.shortfall_cents });
  }
  return out;
}

const withBuffer = (c: number) => Math.ceil((c * (10_000 + SELL_BUFFER_BPS)) / 10_000);
const money = (c: number, cur: string) => `${cur} ${signedAmount(c)}`;
const inWeek = (w: number) => (w ? `in week ${w}` : "already now");

export function fxAdvice(f: Forecast, rates: readonly IndicativeRate[], thresholdEurCents: number | null): FxAdvice {
  const exposures = fxExposure(f);
  const notes: string[] = [];
  const suggestions: FxSuggestion[] = [];
  const short = exposures.filter((e) => e.shortfall_cents > 0);
  if (!short.length) notes.push("No currency falls below its floor in the 13 weeks: no conversion is needed.");
  if (thresholdEurCents === null) {
    if (short.length) notes.push(`The CFO has set no FX threshold (${FX_THRESHOLD_KEY}): nothing is suggested.`);
    return { label: "advice", exposures, suggestions, notes };
  }
  const spare = new Map(exposures.map((e) => [e.currency, e.spare_cents]));
  const rate = (buy: string, sell: string, cents: number) => rates.find((r) => r.buy_currency === buy && r.sell_currency === sell && r.buy_cents === cents);
  for (const s of short) {
    const eur = s.currency === "EUR" ? s.shortfall_cents : rate(s.currency, "EUR", s.shortfall_cents)?.sell_cents;
    if (eur === undefined) { notes.push(`${s.currency} is short by ${money(s.shortfall_cents, s.currency)} ${inWeek(s.min_week)}, but there is no rate to EUR: nothing is suggested.`); continue; }
    if (eur < thresholdEurCents) { notes.push(`${s.currency} is short by ${money(s.shortfall_cents, s.currency)} ${inWeek(s.min_week)} (about ${money(eur, "EUR")}), below the CFO's threshold of ${money(thresholdEurCents, "EUR")}: no conversion.`); continue; }
    const candidates = exposures
      .filter((o) => o.currency !== s.currency)
      .map((o) => ({ o, r: rate(s.currency, o.currency, s.shortfall_cents) }))
      .filter((x): x is { o: Exposure; r: IndicativeRate } => !!x.r && spare.get(x.o.currency)! >= withBuffer(x.r.sell_cents))
      .sort((a, b) => Number(b.o.currency === "EUR") - Number(a.o.currency === "EUR")
        || spare.get(b.o.currency)! / withBuffer(b.r.sell_cents) - spare.get(a.o.currency)! / withBuffer(a.r.sell_cents) || a.o.currency.localeCompare(b.o.currency));
    const pick = candidates[0];
    if (!pick) { notes.push(`${s.currency} is short by ${money(s.shortfall_cents, s.currency)} ${inWeek(s.min_week)} and no currency has enough above its floor to cover it: a funding question for the CFO, not a conversion.`); continue; }
    const max = withBuffer(pick.r.sell_cents);
    spare.set(pick.o.currency, spare.get(pick.o.currency)! - max);
    suggestions.push({
      buy_currency: s.currency, buy_cents: s.shortfall_cents, sell_currency: pick.o.currency, sell_cents: pick.r.sell_cents, sell_max_cents: max,
      rate: pick.r.rate, rate_at: pick.r.at, rate_source: pick.r.source, eur_cents: eur, threshold_eur_cents: thresholdEurCents, week: s.min_week,
      reason: `The forecast has ${s.currency} at ${money(s.min_closing_cents, s.currency)} ${inWeek(s.min_week)}, ${money(s.shortfall_cents, s.currency)} under its floor of ${money(s.floor_cents, s.currency)}; `
        + `buying it with ${pick.o.currency} (about ${money(pick.r.sell_cents, pick.o.currency)}, at most ${money(max, pick.o.currency)}) keeps ${pick.o.currency} above its own floor.`,
    });
  }
  return { label: "advice", exposures, suggestions, notes };
}
