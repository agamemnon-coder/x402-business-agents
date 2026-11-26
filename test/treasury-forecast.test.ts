// The Treasury advisor's 13-week cash forecast and FX advice (src/treasury/forecastCore.ts, fxCore.ts): pure, deterministic,
// integer cents, per currency, with the method written down. Breaks if a payable or receivable lands in the wrong week,
// a doubtful debt is counted as cash, a card subscription is not projected, currencies are added together, or a
// conversion is suggested below the CFO's threshold or from a currency that cannot spare it.
import { describe, expect, it } from "vitest";
import { cashForecast, recurringCharges, FORECAST_METHOD, type ForecastInput } from "../src/treasury/forecastCore.js";
import { fxAdvice, fxExposure, ratesNeeded, type IndicativeRate } from "../src/treasury/fxCore.js";

const base = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  asOf: "2026-11-26", openingSource: "test", opening: [{ currency: "EUR", cents: 1_000_000 }, { currency: "USD", cents: 500_000 }],
  payables: [], receivables: [], cardHistory: [], floors: { EUR: 200_000, USD: 100_000 }, ...over,
});

describe("the 13-week cash forecast", () => {
  it("is labelled a forecast, has 13 weeks of 7 days, and writes its method down", () => {
    const f = cashForecast(base());
    expect(f.label).toBe("forecast");
    expect(f.weeks).toHaveLength(13);
    expect(f.weeks[0]).toMatchObject({ week: 1, from: "2026-11-26", to: "2026-12-02" });
    expect(f.weeks[12]).toMatchObject({ week: 13, from: "2027-02-18", to: "2027-02-24" });
    expect(f.method).toEqual(FORECAST_METHOD);
    expect(f.method.join(" ")).toMatch(/never added together/);
  });

  it("puts payables in the week of their due date, overdue ones in week 1, and leaves out those after the horizon", () => {
    const f = cashForecast(base({ payables: [
      { ref: "AP-1", currency: "EUR", cents: 10_000, due_date: "2026-11-20" },
      { ref: "AP-2", currency: "EUR", cents: 20_000, due_date: "2026-12-03" },
      { ref: "AP-3", currency: "EUR", cents: 30_000, due_date: "2027-06-01" },
    ] }));
    const eur = (w: number) => f.weeks[w - 1]!.rows.find((r) => r.currency === "EUR")!;
    expect(eur(1).payables_cents).toBe(10_000);
    expect(eur(2).payables_cents).toBe(20_000);
    expect(f.excluded).toEqual([expect.objectContaining({ ref: "AP-3", why: expect.stringMatching(/after week 13/) })]);
    expect(f.currencies.find((c) => c.currency === "EUR")!.closing_cents).toBe(1_000_000 - 30_000);
  });

  it("expects receivables on their due date, overdue ones in week 2, and never counts a debt over 90 days late", () => {
    const f = cashForecast(base({ receivables: [
      { ref: "NW-1", currency: "EUR", cents: 5_000, due_date: "2026-12-10" },
      { ref: "NW-2", currency: "EUR", cents: 7_000, due_date: "2026-11-01" },
      { ref: "NW-3", currency: "EUR", cents: 9_000, due_date: "2026-07-01" },
    ] }));
    const eur = (w: number) => f.weeks[w - 1]!.rows.find((r) => r.currency === "EUR")!;
    expect(eur(3).receivables_cents).toBe(5_000);
    expect(eur(2).receivables_cents).toBe(7_000);
    expect(f.excluded.map((x) => x.ref)).toEqual(["NW-3"]);
    expect(f.currencies.find((c) => c.currency === "EUR")!.in_cents).toBe(12_000);
  });

  it("projects a monthly card subscription every 30 days and averages the other card spend over 8 weeks", () => {
    const history = [
      { merchant: "Figma", currency: "EUR", cents: 4_500, date: "2026-09-27" },
      { merchant: "Figma", currency: "EUR", cents: 4_500, date: "2026-10-27" },
      { merchant: "Ads Co", currency: "EUR", cents: 8_000, date: "2026-11-02" },
      { merchant: "Ads Co", currency: "EUR", cents: 8_000, date: "2026-11-20" },
      { merchant: "Old", currency: "EUR", cents: 99_999, date: "2026-08-01" },
    ];
    expect(recurringCharges(history, "2026-11-26", "2027-02-24")).toEqual([{ merchant: "Figma", currency: "EUR", cents: 4_500, next: ["2026-11-26", "2026-12-26", "2027-01-25", "2027-02-24"] }]);
    const f = cashForecast(base({ cardHistory: history }));
    const eur = f.weeks.map((w) => w.rows.find((r) => r.currency === "EUR")!);
    expect(eur[0]!.card_recurring_cents).toBe(4_500);
    // 16,000 cents of other charges in the 8 weeks before as-of (the August one is older): 2,000 a week.
    expect(eur.every((r) => r.card_other_cents === 2_000)).toBe(true);
    expect(eur.reduce((a, r) => a + r.card_recurring_cents, 0)).toBe(4 * 4_500);
  });

  it("keeps currencies apart, flags weeks below the floor, and gives the same forecast for the same input", () => {
    const input = base({ payables: [{ ref: "AP-9", currency: "USD", cents: 450_000, due_date: "2026-12-15" }] });
    const f = cashForecast(input);
    const usd = f.currencies.find((c) => c.currency === "USD")!;
    expect(usd).toMatchObject({ opening_cents: 500_000, closing_cents: 50_000, min_closing_cents: 50_000, min_week: 3, below_floor_weeks: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] });
    expect(f.currencies.find((c) => c.currency === "EUR")!.closing_cents).toBe(1_000_000);
    expect(cashForecast(input)).toEqual(f);
  });

  it("refuses an amount that is not whole cents and a date it cannot read", () => {
    expect(() => cashForecast(base({ payables: [{ ref: "x", currency: "EUR", cents: 1.5, due_date: "2026-12-01" }] }))).toThrow(/whole cents/);
    expect(() => cashForecast(base({ asOf: "26/11/2026" }))).toThrow(/YYYY-MM-DD/);
  });
});

describe("FX exposure and conversion advice", () => {
  const short = () => cashForecast(base({ payables: [{ ref: "AP-9", currency: "USD", cents: 450_000, due_date: "2026-12-15" }] }));
  const rate: IndicativeRate = { buy_currency: "USD", sell_currency: "EUR", buy_cents: 50_000, sell_cents: 46_000, rate: "0.92", at: "2026-11-26T09:00:00.000Z", source: "stand-in" };

  it("measures each currency's shortfall and spare against its floor in the worst week, and asks only the rates it needs", () => {
    const ex = fxExposure(short());
    expect(ex.find((e) => e.currency === "USD")).toMatchObject({ shortfall_cents: 50_000, spare_cents: 0, min_week: 3 });
    expect(ex.find((e) => e.currency === "EUR")).toMatchObject({ shortfall_cents: 0, spare_cents: 800_000 });
    expect(ratesNeeded(ex)).toEqual([{ buy_currency: "USD", sell_currency: "EUR", buy_cents: 50_000 }]);
  });

  it("suggests nothing while the CFO has set no threshold, or below it", () => {
    expect(fxAdvice(short(), [rate], null)).toMatchObject({ suggestions: [], notes: [expect.stringMatching(/no FX threshold/)] });
    expect(fxAdvice(short(), [rate], 50_000).suggestions).toEqual([]);
    expect(fxAdvice(short(), [rate], 50_000).notes.join()).toMatch(/below the CFO's threshold of EUR 500\.00/);
  });

  it("suggests buying exactly the shortfall, selling at most the indicative amount plus 1%, from a currency that can spare it", () => {
    const a = fxAdvice(short(), [rate], 40_000);
    expect(a.suggestions).toEqual([expect.objectContaining({ buy_currency: "USD", buy_cents: 50_000, sell_currency: "EUR", sell_cents: 46_000, sell_max_cents: 46_460, eur_cents: 46_000, week: 3 })]);
    expect(a.suggestions[0]!.reason).toMatch(/USD at USD 500\.00 in week 3, USD 500\.00 under its floor of USD 1000\.00/);
  });

  it("raises a funding question, not a conversion, when no currency has enough above its floor", () => {
    const f = cashForecast(base({ opening: [{ currency: "EUR", cents: 210_000 }, { currency: "USD", cents: 500_000 }], payables: [{ ref: "AP-9", currency: "USD", cents: 450_000, due_date: "2026-12-15" }] }));
    const a = fxAdvice(f, [rate], 1_000);
    expect(a.suggestions).toEqual([]);
    expect(a.notes.join()).toMatch(/funding question for the CFO/);
  });
});
