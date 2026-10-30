// The finance view (double entry, light): every journal line becomes a debit and a credit of the same integer
// cents in the same currency, so debits equal credits per currency, always; the trial balance nets to zero.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { books, booksCsv, doubleEntry, trialBalance } from "../src/accounting/books.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { redTeamWorld } from "../src/redteam/world.js";

const line = (over: Partial<JournalLine>): JournalLine => ({
  date: "2026-10-30T10:00:00Z", source: "card", ref: "r", description: "d", counterparty: "c", agent: "sourcing", cost_centre: "CC100",
  gl_account: "6100", gl_name: "Software", bank_account: "1200", amount: "-19.99", currency: "EUR", proof: "p", approval: "", rule: "", ...over,
});

describe("double entry", () => {
  it("books money out as a debit to the expense and a credit to the bank, and money in the other way round", () => {
    expect(doubleEntry([line({})]).map((p) => [p.account, p.debit_cents, p.credit_cents])).toEqual([["6100", 1999, 0], ["1200", 0, 1999]]);
    expect(doubleEntry([line({ gl_account: "4000", bank_account: "1210", amount: "0.05", currency: "USDZ" })]).map((p) => [p.account, p.debit_cents, p.credit_cents])).toEqual([["1210", 5, 0], ["4000", 0, 5]]);
  });

  // Breaks if any posting is lost, doubled or rounded: debits must equal credits in every currency.
  it("balances in every currency for any journal, in integer cents", () => {
    const amount = fc.integer({ min: -10_000_000, max: 10_000_000 }).filter((c) => c !== 0).map((c) => (c < 0 ? `-${(-c / 100).toFixed(2)}` : (c / 100).toFixed(2)));
    const lines = fc.array(fc.record({
      amount, currency: fc.constantFrom("EUR", "USD", "USDZ"), gl_account: fc.constantFrom("4000", "4100", "5000", "6100", "6150", "6300", "6800", "1590"),
      bank_account: fc.constantFrom("1200", "1201", "1210", "1220"),
    }).map((r) => line(r)), { maxLength: 60 });
    fc.assert(fc.property(lines, (ls) => {
      const ps = doubleEntry(ls);
      expect(ps).toHaveLength(ls.length * 2);
      for (const p of ps) expect(Number.isInteger(p.debit_cents) && Number.isInteger(p.credit_cents) && (p.debit_cents === 0) !== (p.credit_cents === 0)).toBe(true);
      const byCur = new Map<string, number>();
      for (const p of ps) byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + p.debit_cents - p.credit_cents);
      for (const v of byCur.values()) expect(v).toBe(0);
      for (const cur of new Set(ls.map((l) => l.currency))) expect(trialBalance(ps).filter((t) => t.currency === cur).reduce((s, t) => s + t.balance_cents, 0)).toBe(0);
    }), { numRuns: 300 });
  });
});

describe("the books of a world", () => {
  it("shows a balanced trial balance, cash moved per account and currency, and spend per cost centre; exports as CSV", async () => {
    const w = await redTeamWorld();
    await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    await buyPlan(w.db, w.issuing, "adwave-starter", w.now());
    const b = books(w.db);
    expect(b.balanced).toBe(true);
    expect(b.cash).toContainEqual({ account: "1200", name: "Bank: Airwallex EUR (incl. company cards)", currency: "EUR", moved_cents: -(1999 + 3800) });
    expect(b.spend).toEqual(expect.arrayContaining([
      { cost_centre: "CC100", name: "Operations agent (operations)", currency: "EUR", cents: 1999 },
      { cost_centre: "CC200", name: "Sales agent (ads and retail accounts)", currency: "EUR", cents: 3800 },
    ]));
    const csv = booksCsv(b.postings).split("\n");
    expect(csv[0]).toBe("entry,date,account,account_name,debit,credit,currency,cost_centre,ref,description,proof");
    expect(csv).toHaveLength(1 + b.postings.length + 1);
  });
});
