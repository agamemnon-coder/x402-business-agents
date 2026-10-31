// The finance view (double entry, light): every journal line becomes a debit and a credit of the same integer
// cents in the same currency, so debits equal credits per currency, always; the trial balance nets to zero.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { books, booksCsv, doubleEntry, trialBalance } from "../src/accounting/books.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { redTeamWorld } from "../src/redteam/world.js";
import { audit } from "../src/audit/log.js";
import { booksView } from "../src/accounting/books.js";

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
    await buyPlan(w.db, w.issuing, "replyhub-starter", w.now());
    const b = books(w.db);
    expect(b.balanced).toBe(true);
    expect(b.cash).toContainEqual(expect.objectContaining({ account: "1200", currency: "EUR", moved_cents: -(1999 + 3800) }));
    expect(b.spend).toEqual(expect.arrayContaining([
      { cost_centre: "CC100", name: "Sourcing agent (operations)", currency: "EUR", cents: 1999 },
      { cost_centre: "CC200", name: "Support agent (refunds and helpdesk software)", currency: "EUR", cents: 3800 },
    ]));
    const csv = booksCsv(b.postings).split("\n");
    expect(csv[0]).toBe("entry,date,account,account_name,debit,credit,currency,cost_centre,ref,description,proof");
    expect(csv).toHaveLength(1 + b.postings.length + 1);
  });
});

describe("the Books screen", () => {
  // Breaks if the dashboard's books differ from npm run books, or a long journal bloats the snapshot.
  it("puts the same trial balance on the dashboard, with the latest postings only", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const w = await redTeamWorld();
    for (let i = 0; i < 3; i++) await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    const s = buildSnapshot(w.db, w.now()).books!;
    const b = books(w.db);
    expect(s.balanced).toBe(true);
    expect(s.trial.map((t) => [t.account, t.currency, t.debit, t.credit, t.balance])).toEqual(
      b.trial.map((t) => [t.account, t.currency, (t.debit_cents / 100).toFixed(2), (t.credit_cents / 100).toFixed(2), (t.balance_cents < 0 ? "-" : "") + (Math.abs(t.balance_cents) / 100).toFixed(2)]));
    expect(s.postings.length).toBeLessThanOrEqual(20);
    expect(s.postings[0]!.entry).toBe(b.postings[b.postings.length - 1]!.entry);
    expect(s.total_postings).toBe(b.postings.length);
  });
});

describe("opening balances (the money there before the run)", () => {
  // Seen 31 Oct: without them the bank accounts went below zero and revenue showed as -2.70 on the Books tab.
  it("books the owner's funding of the Metal account and Airwallex's first known balances, so no bank account goes below zero", async () => {
    const w = await redTeamWorld();
    const t0 = w.now();
    audit(w.db, "owner-signer", "business.funded", "0xb1", { amount: "20.00", tx: "0xfund" }, t0);
    // One card purchase before Airwallex's balances were first read, one after: the first is inside that balance.
    await buyPlan(w.db, w.issuing, "packwise-starter", t0);
    w.db.prepare("INSERT INTO balance_snapshots (taken_at, label, json) VALUES (?, 'seed', ?)").run(new Date(t0.getTime() + 1000).toISOString(), JSON.stringify({ EUR: { availableCents: 148_001 }, USD: { availableCents: 2_500_000 } }));
    w.issuing.clock = () => t0.getTime() + 2000; // the card issuer stamps its own time on the charge
    await buyPlan(w.db, w.issuing, "replyhub-starter", new Date(t0.getTime() + 2000));
    const b = books(w.db);
    expect(b.balanced).toBe(true);
    const cash = (acc: string, cur: string) => b.cash.find((c) => c.account === acc && c.currency === cur)!;
    expect(cash("1200", "EUR")).toMatchObject({ opening_cents: 150_000, moved_cents: -(1999 + 3800), closing_cents: 150_000 - 1999 - 3800 });
    expect(cash("1201", "USD")).toMatchObject({ opening_cents: 2_500_000, closing_cents: 2_500_000 });
    expect(cash("1210", "USDZ")).toMatchObject({ opening_cents: 2000, closing_cents: 2000 });
    expect(b.cash.every((c) => c.closing_cents >= 0)).toBe(true);
    const equity = b.trial.filter((t) => t.account === "3000").map((t) => [t.currency, t.balance_cents]);
    expect(equity).toEqual(expect.arrayContaining([["EUR", -150_000], ["USD", -2_500_000], ["USDZ", -2000]]));
  });

  it("shows balances the bookkeeper's way: a debit or a credit column, never a minus sign", async () => {
    const w = await redTeamWorld();
    audit(w.db, "owner-signer", "business.funded", "0xb1", { amount: "20.00", tx: "0xfund" }, w.now());
    const v = booksView(w.db);
    const eq = v.trial.find((t) => t.account === "3000" && t.currency === "USDZ")!;
    expect(eq).toMatchObject({ balance_debit: "", balance_credit: "20.00" });
    expect(JSON.stringify(v.trial.map((t) => [t.balance_debit, t.balance_credit]))).not.toContain("-");
    expect(v.cash.find((c) => c.account === "1210")).toMatchObject({ opening: "20.00", closing: "20.00" });
  });
});
