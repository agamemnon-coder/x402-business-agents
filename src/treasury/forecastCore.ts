// The Treasury advisor's 13-week cash forecast (docs/treasury.md): a pure function over what the ledger already holds.
// No database, no SDK, no clock: the same input gives the same forecast, to the cent. It is a forecast, labelled so
// everywhere it is shown; nothing here moves money or proposes anything.
//
// The method, in full (docs/treasury.md says the same in words):
//   Weeks      week n (1..13) covers asOf + 7(n-1) to asOf + 7n - 1, both days included.
//   Opening    the balance per currency the caller read (Airwallex's available balances, or the ledger's cash).
//   Payables   every unpaid supplier invoice, in the week its due date falls in; an overdue one in week 1. A due date
//              past the horizon is left out (listed under `excluded`).
//   Receivables every open customer invoice, for what is still open, in the week its due date falls in. One already
//              overdue by 1 to 90 days is expected in week 2 (a week for the first reminder to work); one overdue by
//              more than 90 days is doubtful and left out (listed under `excluded`), never counted as cash.
//   Card spend recurring: a merchant that charged the same card currency at least twice, every gap 25 to 35 days (the
//              subscription rule of src/agents/spendReview.ts), charges its last amount again every 30 days after its
//              last charge (one not charged for 45 days is taken as stopped). Other: the approved non-recurring charges of the 8 weeks before asOf, divided by 8, every
//              week (rounded to the cent, half up).
//   Closing    opening + receivables - payables - card spend; flagged when it falls below the currency's floor.
// Currencies are never added together here: each has its own rows. Integer cents only.

export interface ForecastItem { ref: string; currency: string; cents: number; due_date: string }
export interface CardCharge { merchant: string; currency: string; cents: number; date: string }

export interface ForecastInput {
  /** YYYY-MM-DD: the first day of week 1. */
  asOf: string;
  weeks?: number;
  opening: { currency: string; cents: number }[];
  /** Where the opening balances were read: "Airwallex sandbox balances" or "the ledger's cash". */
  openingSource: string;
  payables: ForecastItem[];
  receivables: ForecastItem[];
  /** Approved card charges (declines left out by the caller). */
  cardHistory: CardCharge[];
  /** The CFO's reserve floor per currency, in cents (absent: 0). */
  floors?: Record<string, number>;
}

export interface WeekRow {
  currency: string;
  opening_cents: number;
  receivables_cents: number;
  payables_cents: number;
  card_recurring_cents: number;
  card_other_cents: number;
  closing_cents: number;
  below_floor: boolean;
}
export interface ForecastWeek { week: number; from: string; to: string; rows: WeekRow[] }
export interface CurrencySummary {
  currency: string;
  opening_cents: number;
  in_cents: number;
  out_cents: number;
  closing_cents: number;
  /** The lowest closing balance of any week, and the first week it is reached. */
  min_closing_cents: number;
  min_week: number;
  floor_cents: number;
  below_floor_weeks: number[];
}
export interface Excluded { ref: string; currency: string; cents: number; why: string }
export interface RecurringCharge { merchant: string; currency: string; cents: number; next: string[] }

export interface Forecast {
  label: "forecast";
  as_of: string;
  weeks: ForecastWeek[];
  currencies: CurrencySummary[];
  recurring: RecurringCharge[];
  excluded: Excluded[];
  opening_source: string;
  method: string[];
}

export const FORECAST_WEEKS = 13;
/** Receivables overdue by more than this are doubtful: left out of the forecast. */
export const DOUBTFUL_AFTER_DAYS = 90;
/** The weeks of card history the non-recurring average is taken over. */
export const CARD_HISTORY_WEEKS = 8;
/** A recurring charge: gaps of 25 to 35 days (src/agents/spendReview.ts), projected every 30 days. */
export const RECURRING_GAP = { min: 25, max: 35, every: 30, stoppedAfter: 45 } as const;

export const FORECAST_METHOD: string[] = [
  "Weeks: week n covers as-of + 7(n-1) to as-of + 7n - 1 days, 13 weeks.",
  "Opening: the balance per currency read at the start (its source is named).",
  "Payables: each unpaid supplier invoice in the week of its due date; overdue ones in week 1; due after week 13 left out.",
  `Receivables: what is still open on each customer invoice in the week of its due date; overdue by 1-${DOUBTFUL_AFTER_DAYS} days in week 2; overdue by more is doubtful and left out.`,
  `Card spend: a merchant charging every ${RECURRING_GAP.min}-${RECURRING_GAP.max} days repeats its last amount every ${RECURRING_GAP.every} days (not charged for ${RECURRING_GAP.stoppedAfter} days: taken as stopped); other approved charges of the last ${CARD_HISTORY_WEEKS} weeks are averaged per week.`,
  "Closing: opening + receivables - payables - card spend, per currency; below the CFO's floor is flagged. Currencies are never added together.",
];

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

function check(i: ForecastInput): void {
  if (!DATE.test(i.asOf)) throw new Error(`asOf must be YYYY-MM-DD, not ${JSON.stringify(i.asOf)}`);
  const amounts = [...i.opening.map((o) => ({ c: o.cents, ok: Number.isSafeInteger(o.cents) })),
    ...[...i.payables, ...i.receivables, ...i.cardHistory].map((x) => ({ c: x.cents, ok: Number.isSafeInteger(x.cents) && x.cents >= 0 }))];
  const bad = amounts.find((a) => !a.ok);
  if (bad) throw new Error(`an amount is whole cents (not negative, except an opening balance): ${bad.c}`);
  for (const x of [...i.payables, ...i.receivables]) if (!DATE.test(x.due_date.slice(0, 10))) throw new Error(`${x.ref}: due date ${JSON.stringify(x.due_date)} is not a date`);
}

/** Merchants that charge monthly, with the dates of their next charges within [from, to]. */
export function recurringCharges(history: readonly CardCharge[], from: string, to: string): RecurringCharge[] {
  const groups = new Map<string, CardCharge[]>();
  for (const c of [...history].sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant))) {
    const k = `${c.merchant}\u0000${c.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const out: RecurringCharge[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const gaps = g.slice(1).map((c, n) => daysBetween(g[n]!.date, c.date));
    if (!gaps.every((d) => d >= RECURRING_GAP.min && d <= RECURRING_GAP.max)) continue;
    const last = g.at(-1)!;
    // A subscription not charged for more than 45 days is taken as stopped.
    if (daysBetween(last.date, from) > RECURRING_GAP.stoppedAfter) continue;
    const next: string[] = [];
    for (let d = addDays(last.date, RECURRING_GAP.every); d <= to; d = addDays(d, RECURRING_GAP.every)) if (d >= from) next.push(d);
    out.push({ merchant: last.merchant, currency: last.currency, cents: last.cents, next });
  }
  return out.sort((a, b) => a.merchant.localeCompare(b.merchant) || a.currency.localeCompare(b.currency));
}

/** The 13-week forecast. Throws on input it cannot read; never guesses an amount. */
export function cashForecast(i: ForecastInput): Forecast {
  check(i);
  const weeks = i.weeks ?? FORECAST_WEEKS;
  const end = addDays(i.asOf, 7 * weeks - 1);
  const weekOf = (d: string) => (d < i.asOf ? 1 : Math.floor(daysBetween(i.asOf, d) / 7) + 1);
  const excluded: Excluded[] = [];
  const currencies = new Set<string>([...i.opening.map((o) => o.currency), ...i.payables.map((p) => p.currency), ...i.receivables.map((r) => r.currency)]);
  // cents[currency][week][column]
  const flows = new Map<string, { rec: number[]; pay: number[]; cardR: number[]; cardO: number[] }>();
  const at = (c: string) => {
    let f = flows.get(c);
    if (!f) flows.set(c, f = { rec: Array(weeks + 1).fill(0), pay: Array(weeks + 1).fill(0), cardR: Array(weeks + 1).fill(0), cardO: Array(weeks + 1).fill(0) });
    return f;
  };
  for (const p of i.payables) {
    const due = p.due_date.slice(0, 10);
    if (due > end) { excluded.push({ ref: p.ref, currency: p.currency, cents: p.cents, why: `payable due ${due}, after week ${weeks}` }); continue; }
    at(p.currency).pay[weekOf(due)]! += p.cents;
  }
  for (const r of i.receivables) {
    const due = r.due_date.slice(0, 10);
    const late = daysBetween(due, i.asOf);
    if (late > DOUBTFUL_AFTER_DAYS) { excluded.push({ ref: r.ref, currency: r.currency, cents: r.cents, why: `receivable ${late} days overdue: doubtful, not counted` }); continue; }
    if (due > end) { excluded.push({ ref: r.ref, currency: r.currency, cents: r.cents, why: `receivable due ${due}, after week ${weeks}` }); continue; }
    at(r.currency).rec[late > 0 ? Math.min(2, weeks) : weekOf(due)]! += r.cents;
  }
  const recurring = recurringCharges(i.cardHistory.filter((c) => c.date.slice(0, 10) < i.asOf), i.asOf, end);
  const isRecurring = new Set(recurring.map((r) => `${r.merchant}\u0000${r.currency}`));
  for (const r of recurring) {
    currencies.add(r.currency);
    for (const d of r.next) at(r.currency).cardR[weekOf(d)]! += r.cents;
  }
  const since = addDays(i.asOf, -7 * CARD_HISTORY_WEEKS);
  const other = new Map<string, number>();
  for (const c of i.cardHistory) {
    const d = c.date.slice(0, 10);
    if (d < since || d >= i.asOf || isRecurring.has(`${c.merchant}\u0000${c.currency}`)) continue;
    other.set(c.currency, (other.get(c.currency) ?? 0) + c.cents);
  }
  for (const [cur, total] of other) {
    currencies.add(cur);
    const perWeek = Math.floor((total * 2 + CARD_HISTORY_WEEKS) / (2 * CARD_HISTORY_WEEKS));
    for (let w = 1; w <= weeks; w++) at(cur).cardO[w] = perWeek;
  }

  const sorted = [...currencies].sort();
  const balance = new Map(sorted.map((c) => [c, i.opening.filter((o) => o.currency === c).reduce((a, o) => a + o.cents, 0)]));
  const floorOf = (c: string) => i.floors?.[c] ?? 0;
  const out: ForecastWeek[] = [];
  for (let w = 1; w <= weeks; w++) {
    const rows = sorted.map((c): WeekRow => {
      const f = at(c);
      const opening = balance.get(c)!;
      const closing = opening + f.rec[w]! - f.pay[w]! - f.cardR[w]! - f.cardO[w]!;
      balance.set(c, closing);
      return { currency: c, opening_cents: opening, receivables_cents: f.rec[w]!, payables_cents: f.pay[w]!, card_recurring_cents: f.cardR[w]!, card_other_cents: f.cardO[w]!, closing_cents: closing, below_floor: closing < floorOf(c) };
    });
    out.push({ week: w, from: addDays(i.asOf, 7 * (w - 1)), to: addDays(i.asOf, 7 * w - 1), rows });
  }
  const summaries = sorted.map((c): CurrencySummary => {
    const rows = out.map((wk) => wk.rows.find((r) => r.currency === c)!);
    const min = rows.reduce((m, r, n) => (r.closing_cents < m.c ? { c: r.closing_cents, w: n + 1 } : m), { c: rows[0]?.opening_cents ?? 0, w: 0 });
    return {
      currency: c, opening_cents: rows[0]?.opening_cents ?? 0,
      in_cents: rows.reduce((a, r) => a + r.receivables_cents, 0),
      out_cents: rows.reduce((a, r) => a + r.payables_cents + r.card_recurring_cents + r.card_other_cents, 0),
      closing_cents: rows.at(-1)?.closing_cents ?? 0, min_closing_cents: min.c, min_week: min.w, floor_cents: floorOf(c),
      below_floor_weeks: out.filter((wk) => wk.rows.find((r) => r.currency === c)!.below_floor).map((wk) => wk.week),
    };
  });
  return { label: "forecast", as_of: i.asOf, weeks: out, currencies: summaries, recurring, excluded, opening_source: i.openingSource, method: FORECAST_METHOD };
}

/** Cents as a signed two-decimal string ("-12.30"). */
export const signedAmount = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
