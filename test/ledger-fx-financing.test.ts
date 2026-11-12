// Master list 126: double entry for realised FX differences and for invoice token financing. Every entry balances to
// the cent, carries the CFO's Face ID hash and the rail's id next to doc_sha256, and the rounding rules hold for every
// amount fast-check can think of. The financing discount is the token contract's own price (discountedPrice). Entries
// posted before the two links existed still hash as they did. In memory, no network.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { ledgerRows, LedgerRefused, postEntry, reverseEntry, verifyLedger } from "../src/ledger/core.js";
import { salesInvoice } from "../src/ledger/documents.js";
import { bookedCents, fxDifference, postFxDifference } from "../src/ledger/fx.js";
import { financingTerms, postFinancing, postFinancingSettlement, SIMULATED_FINANCIER } from "../src/ledger/financing.js";
import { balanceSheet, trialBalance } from "../src/ledger/reports.js";
import { LEDGER_ACCOUNTS } from "../src/ledger/accounts.js";
import { discountedPrice } from "../src/tokenize/flow.js";
import { baseUnitsToCents, centsToBaseUnits } from "../src/lib/money.js";

const RUNS = { numRuns: 300 };
const APPROVAL = "ab".repeat(32);
const TX = `0x${"cd".repeat(32)}`;
const NOW = new Date("2026-11-12T10:00:00Z");

function balanced(db: ReturnType<typeof openDb>) {
  for (const e of ledgerRows(db)) {
    const per = new Map<string, number>();
    for (const l of e.lines) per.set(l.currency, (per.get(l.currency) ?? 0) + l.debit_cents - l.credit_cents);
    expect([...per.values()].every((v) => v === 0)).toBe(true);
  }
}

function withSale(face = 24_000) {
  const db = openDb(":memory:");
  salesInvoice(db, { customer: "Northwind Outdoor (test)", doc_ref: "S-2026-41", date: "2026-11-01", due_date: "2026-12-01", currency: "EUR", created_by: "test",
    lines: [{ account: "4000", net_cents: face, vat_code: "S0" }] }, NOW);
  return db;
}

describe("the two links on an entry", () => {
  it("are stored, hashed and read back only when set; an entry without them hashes as before", () => {
    const db = openDb(":memory:");
    const plain = { date: "2026-11-02", description: "plain", created_by: "test", lines: [{ account: "1200", debit: 100, currency: "EUR" }, { account: "3000", credit: 100, currency: "EUR" }] };
    postEntry(db, plain, NOW);
    postEntry(db, { ...plain, description: "linked", approval_sha256: APPROVAL, rail_ref: "tfr_123" }, NOW);
    const [a, b] = ledgerRows(db);
    expect(a).not.toHaveProperty("approval_sha256");
    expect(a).not.toHaveProperty("rail_ref");
    expect(b).toMatchObject({ approval_sha256: APPROVAL, rail_ref: "tfr_123" });
    expect(verifyLedger(db)).toMatchObject({ ok: true, entries: 2 });
    // A reversal keeps the links of what it reverses.
    reverseEntry(db, 2, "test", "test", NOW);
    expect(ledgerRows(db)[2]).toMatchObject({ approval_sha256: APPROVAL, rail_ref: "tfr_123", reverses: 2 });
    expect(verifyLedger(db).ok).toBe(true);
    // Changing a link after posting breaks the chain.
    db.exec("DROP TRIGGER IF EXISTS ledger_entries_no_update");
    try { db.prepare("UPDATE ledger_entries SET rail_ref = 'tfr_999' WHERE entry_id = 2").run(); } catch { return; }
    expect(verifyLedger(db)).toMatchObject({ ok: false, entry_id: 2 });
  });

  it("refuses a link that is not a hash or an id", () => {
    const db = openDb(":memory:");
    const e = { date: "2026-11-02", description: "x", created_by: "test", lines: [{ account: "1200", debit: 1, currency: "EUR" }, { account: "3000", credit: 1, currency: "EUR" }] };
    expect(() => postEntry(db, { ...e, approval_sha256: "not-a-hash" }, NOW)).toThrow(LedgerRefused);
    expect(() => postEntry(db, { ...e, rail_ref: " " }, NOW)).toThrow(LedgerRefused);
    expect(ledgerRows(db)).toHaveLength(0);
  });
});

describe("realised FX differences", () => {
  it("posts a loss and a gain against money in transit, balanced, with both links", () => {
    const db = openDb(":memory:");
    // USD 1,000.00 booked at 0.9200 = EUR 920.00; the conversion sold EUR 925.13: a loss of 5.13.
    const loss = postFxDifference(db, { date: "2026-11-10", doc_ref: "INV-US-1", party: "Acme (test)", foreign: { currency: "USD", amount_cents: 100_000 }, functional: { currency: "EUR", booked_rate: "0.9200", paid_cents: 92_513 }, approval_sha256: APPROVAL, rail_ref: "conv_1", created_by: "test" }, NOW)!;
    expect(loss).toMatchObject({ booked_cents: 92_000, paid_cents: 92_513, difference_cents: 513 });
    const gain = postFxDifference(db, { date: "2026-11-11", doc_ref: "INV-US-2", foreign: { currency: "USD", amount_cents: 100_000 }, functional: { currency: "EUR", booked_rate: "0.92", paid_cents: 91_900 }, approval_sha256: APPROVAL, rail_ref: "conv_2", created_by: "test" }, NOW)!;
    expect(gain.difference_cents).toBe(-100);
    const [l, g] = ledgerRows(db);
    expect(l!.lines.map((x) => [x.account, x.debit_cents, x.credit_cents])).toEqual([["7900", 513, 0], ["1590", 0, 513]]);
    expect(g!.lines.map((x) => [x.account, x.debit_cents, x.credit_cents])).toEqual([["1590", 100, 0], ["7900", 0, 100]]);
    for (const e of [l!, g!]) expect(e).toMatchObject({ approval_sha256: APPROVAL });
    expect([l!.rail_ref, g!.rail_ref]).toEqual(["conv_1", "conv_2"]);
    balanced(db);
    expect(postFxDifference(db, { date: "2026-11-11", doc_ref: "INV-US-3", foreign: { currency: "USD", amount_cents: 100 }, functional: { currency: "EUR", booked_rate: "1", paid_cents: 100 }, approval_sha256: APPROVAL, rail_ref: "conv_3", created_by: "test" }, NOW)).toBeNull();
    expect(() => postFxDifference(db, { date: "2026-11-11", doc_ref: "x", foreign: { currency: "EUR", amount_cents: 1 }, functional: { currency: "EUR", booked_rate: "1", paid_cents: 2 }, approval_sha256: APPROVAL, rail_ref: "c", created_by: "t" }, NOW)).toThrow(/two currencies/);
    expect(() => postFxDifference(db, { date: "2026-11-11", doc_ref: "x", foreign: { currency: "USD", amount_cents: 1 }, functional: { currency: "EUR", booked_rate: "1", paid_cents: 2 }, approval_sha256: "", rail_ref: "c", created_by: "t" }, NOW)).toThrow(/approval hash/);
  });

  it("rounds the booked value half up to a whole cent, and booked + difference is always what was paid (property)", () => {
    expect(bookedCents(1, "0.5")).toBe(1);
    expect(bookedCents(1, "0.49999999")).toBe(0);
    expect(bookedCents(3, "0.5")).toBe(2);
    expect(() => bookedCents(1, "0")).toThrow(/not a rate/);
    expect(() => bookedCents(1, "-1")).toThrow(/not a rate/);
    expect(() => bookedCents(9_226_636_487, "976217")).toThrow(/too large/);
    fc.assert(fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), fc.integer({ min: 1, max: 999_999 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 20_000_000_000 }), (amount, rateInt, decimals, paid) => {
      const digits = String(rateInt).padStart(decimals + 1, "0");
      const rate = decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
      const scale = 10n ** BigInt(decimals);
      // Past 2^53 cents (12 Nov: a run drew 9226636487 cents at 976217) the value is refused, not rounded silently.
      if ((2n * BigInt(amount) * BigInt(rateInt) + scale) / (2n * scale) > BigInt(Number.MAX_SAFE_INTEGER)) {
        expect(() => bookedCents(amount, rate)).toThrow(/too large/);
        return;
      }
      const booked = bookedCents(amount, rate);
      // Exact: |booked - amount * rate| <= 1/2 cent, computed in integers.
      const exact2 = 2n * BigInt(amount) * BigInt(rateInt);
      const diff2 = 2n * BigInt(booked) * scale - exact2;
      expect(diff2 <= scale && diff2 > -scale).toBe(true);
      const d = fxDifference(amount, rate, paid);
      expect(d.booked_cents + d.difference_cents).toBe(paid);
      expect(Number.isInteger(d.difference_cents)).toBe(true);
    }), RUNS);
  });
});

describe("invoice token financing", () => {
  it("prices the token exactly as the contract does: the discount equals face value less discountedPrice (property)", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000_000_00 }), fc.integer({ min: 1, max: 9_999 }), (face, bps) => {
      const t = financingTerms(face, bps);
      expect(t.price_cents).toBe(baseUnitsToCents(discountedPrice(centsToBaseUnits(face), bps)));
      expect(t.price_cents + t.discount_cents).toBe(face);
      expect(t.discount_cents).toBeGreaterThanOrEqual(0);
    }), RUNS);
    expect(financingTerms(24_000, 200)).toEqual({ face_cents: 24_000, discount_bps: 200, price_cents: 23_520, discount_cents: 480 });
    expect(() => financingTerms(0, 200)).toThrow(LedgerRefused);
    expect(() => financingTerms(100, 0)).toThrow(LedgerRefused);
  });

  it("with recourse: bank and the simulated financier on financing, the discount as finance cost at settlement", () => {
    const db = withSale();
    const common = { doc_ref: "S-2026-41", party: "Northwind Outdoor (test)", currency: "EUR", face_cents: 24_000, discount_bps: 200, approval_sha256: APPROVAL, created_by: "test" };
    const f = postFinancing(db, { ...common, date: "2026-11-05", bank: "1200", rail_ref: TX }, NOW);
    expect(f).toMatchObject({ price_cents: 23_520, discount_cents: 480, duplicate: false });
    const s = postFinancingSettlement(db, { ...common, date: "2026-12-01", rail_ref: `0x${"ef".repeat(32)}` }, NOW)!;
    expect(s.discount_cents).toBe(480);
    const [, fin, set] = ledgerRows(db);
    expect(fin!.lines.map((l) => [l.account, l.debit_cents, l.credit_cents, l.party])).toEqual([["1200", 23_520, 0, null], ["2150", 0, 23_520, SIMULATED_FINANCIER]]);
    expect(set!.lines.map((l) => [l.account, l.debit_cents, l.credit_cents])).toEqual([["2150", 23_520, 0], ["7100", 480, 0], ["1300", 0, 24_000]]);
    for (const e of [fin!, set!]) expect(e.approval_sha256).toBe(APPROVAL);
    expect([fin!.rail_ref, set!.rail_ref]).toEqual([TX, `0x${"ef".repeat(32)}`]);
    balanced(db);
    // After settlement nothing is owed to the financier and nothing is open on the invoice.
    const tb = Object.fromEntries(trialBalance(db).map((r) => [r.account, r.balance_cents]));
    expect(tb["2150"] ?? 0).toBe(0);
    expect(tb["1300"] ?? 0).toBe(0);
    expect(tb["7100"]).toBe(480);
    expect(LEDGER_ACCOUNTS["2150"]).toMatch(/^Simulated financier \(testnet\)/);
    expect(balanceSheet(db, "2026-12-31").EUR!.balanced).toBe(true);
    // Each posts once: a replay is the same entry.
    expect(postFinancing(db, { ...common, date: "2026-11-05", bank: "1200", rail_ref: TX }, NOW).duplicate).toBe(true);
  });

  it("without recourse: the receivable goes at once, the discount is the cost, nothing posts at settlement", () => {
    const db = withSale();
    const common = { doc_ref: "S-2026-41", party: "Northwind Outdoor (test)", currency: "EUR", face_cents: 24_000, discount_bps: 250, approval_sha256: APPROVAL, created_by: "test", mode: "derecognise" as const };
    postFinancing(db, { ...common, date: "2026-11-05", bank: "1200", rail_ref: TX }, NOW);
    expect(postFinancingSettlement(db, { ...common, date: "2026-12-01", rail_ref: TX }, NOW)).toBeNull();
    const e = ledgerRows(db)[1]!;
    expect(e.lines.map((l) => [l.account, l.debit_cents, l.credit_cents])).toEqual([["1200", 23_400, 0], ["7100", 600, 0], ["1300", 0, 24_000]]);
    balanced(db);
  });

  it("refuses without both links, without an open invoice, or for more than is open", () => {
    const db = withSale(10_000);
    const base = { doc_ref: "S-2026-41", party: "Northwind Outdoor (test)", currency: "EUR", face_cents: 10_000, discount_bps: 200, created_by: "test", date: "2026-11-05", bank: "1200" };
    expect(() => postFinancing(db, { ...base, approval_sha256: "", rail_ref: TX }, NOW)).toThrow(/approval hash/);
    expect(() => postFinancing(db, { ...base, approval_sha256: APPROVAL, rail_ref: "" }, NOW)).toThrow(/transaction hash/);
    expect(() => postFinancing(db, { ...base, doc_ref: "S-0", approval_sha256: APPROVAL, rail_ref: TX }, NOW)).toThrow(/no open customer invoice/);
    expect(() => postFinancing(db, { ...base, face_cents: 10_001, approval_sha256: APPROVAL, rail_ref: TX }, NOW)).toThrow(/10000 cents open/);
    expect(() => postFinancing(db, { ...base, bank: "4000", approval_sha256: APPROVAL, rail_ref: TX }, NOW)).toThrow(/not a bank account/);
    expect(ledgerRows(db)).toHaveLength(1);
  });
});
