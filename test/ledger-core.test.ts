// The stored general ledger (docs/superpowers/specs/2026-11-08-bookkeeping-core-design.md, part 1): balanced or
// refused, immutable, hash-chained, idempotent by source key, and closed months stay closed.
import { describe, expect, it } from "vitest";
import { AP_CHART, CHART } from "../src/config/gl.js";
import { openDb, type DB } from "../src/db/open.js";
import { LEDGER_ACCOUNTS } from "../src/ledger/accounts.js";
import { ledgerRows, lockMonth, postEntry, reverseEntry, verifyLedger, verifyLedgerRows, LedgerRefused } from "../src/ledger/core.js";

const NOW = new Date("2026-11-08T10:00:00Z");
const fresh = (): DB => openDb(":memory:");
const sale = (over: Partial<Parameters<typeof postEntry>[1]> = {}) => ({
  date: "2026-11-03", description: "Stock data sold", created_by: "test",
  lines: [{ account: "1200", debit: 12_100, currency: "EUR" }, { account: "4000", credit: 12_100, currency: "EUR" }],
  ...over,
});

describe("posting", () => {
  it("posts a balanced entry and reads it back", () => {
    const db = fresh();
    const r = postEntry(db, sale(), NOW);
    expect(r).toMatchObject({ duplicate: false, posting_date: "2026-11-03" });
    const rows = ledgerRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lines.map((l) => [l.account, l.debit_cents, l.credit_cents])).toEqual([["1200", 12_100, 0], ["4000", 0, 12_100]]);
  });

  it("refuses an entry whose debits and credits differ in a currency, and writes nothing", () => {
    const db = fresh();
    expect(() => postEntry(db, sale({ lines: [{ account: "1200", debit: 100, currency: "EUR" }, { account: "4000", credit: 99, currency: "EUR" }] }), NOW)).toThrow(LedgerRefused);
    expect(() => postEntry(db, sale({ lines: [{ account: "1200", debit: 100, currency: "EUR" }, { account: "4000", credit: 100, currency: "USD" }] }), NOW)).toThrow(/EUR/);
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it("refuses an account outside the chart, a line with both or neither side, a single line and a bad VAT code", () => {
    const db = fresh();
    expect(() => postEntry(db, sale({ lines: [{ account: "9999", debit: 1, currency: "EUR" }, { account: "4000", credit: 1, currency: "EUR" }] }), NOW)).toThrow(/9999/);
    expect(() => postEntry(db, sale({ lines: [{ account: "1200", debit: 1, credit: 1, currency: "EUR" }, { account: "4000", credit: 0, currency: "EUR" }] }), NOW)).toThrow(LedgerRefused);
    expect(() => postEntry(db, sale({ lines: [{ account: "1200", debit: 0, currency: "EUR" }] }), NOW)).toThrow(LedgerRefused);
    expect(() => postEntry(db, sale({ lines: [{ account: "1200", debit: 5, currency: "EUR" }, { account: "4000", credit: 5, currency: "EUR", vat_code: "X99" }] }), NOW)).toThrow(/X99/);
    expect(() => postEntry(db, sale({ lines: [{ account: "1200", debit: 1.5, currency: "EUR" }, { account: "4000", credit: 1.5, currency: "EUR" }] }), NOW)).toThrow(LedgerRefused);
  });

  it("accepts the payables and ledger accounts, which stay out of the cash journal's chart (T:0 mirrors it)", () => {
    const db = fresh();
    expect(postEntry(db, sale({ lines: [{ account: "1300", debit: 100, currency: "EUR" }, { account: "2100", credit: 100, currency: "EUR" }] }), NOW).duplicate).toBe(false);
    for (const a of ["1300", "1510", "1700", "2100", "2200", "2210", "3100", "8000"]) {
      expect(CHART[a], a).toBeUndefined();
      expect(LEDGER_ACCOUNTS[a], a).toBeTruthy();
    }
    expect(AP_CHART).toEqual({ "1510": "Input VAT receivable (supplier invoices)", "2100": "Accounts payable (supplier invoices)" });
  });

  it("posts each source key once", () => {
    const db = fresh();
    const a = postEntry(db, sale({ source_key: "sale|1" }), NOW);
    const b = postEntry(db, sale({ source_key: "sale|1" }), NOW);
    expect(b).toEqual({ ...a, duplicate: true });
    expect(ledgerRows(db)).toHaveLength(1);
  });
});

describe("immutability and the chain", () => {
  it("refuses UPDATE and DELETE on entries, lines and locks", () => {
    const db = fresh();
    postEntry(db, sale(), NOW);
    lockMonth(db, "2026-10", "test", NOW);
    expect(() => db.prepare("UPDATE ledger_lines SET debit_cents = 1 WHERE line_no = 1").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM ledger_locks").run()).toThrow(/append-only/);
  });

  it("corrects only by a reversing entry that names the one it reverses, once", () => {
    const db = fresh();
    const { entry_id } = postEntry(db, sale(), NOW);
    const rev = reverseEntry(db, entry_id, "posted to the wrong account", "test", NOW);
    expect(reverseEntry(db, entry_id, "again", "test", NOW).duplicate).toBe(true);
    const rows = ledgerRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ entry_id: rev.entry_id, reverses: entry_id });
    expect(rows[1]!.lines.map((l) => [l.account, l.debit_cents, l.credit_cents])).toEqual([["1200", 0, 12_100], ["4000", 12_100, 0]]);
  });

  it("verifies the hash chain, and finds a changed amount in an exported copy", () => {
    const db = fresh();
    postEntry(db, sale(), NOW);
    postEntry(db, sale({ date: "2026-11-04" }), NOW);
    const ok = verifyLedger(db);
    expect(ok).toMatchObject({ ok: true, entries: 2 });
    const rows = ledgerRows(db);
    rows[0]!.lines[0]!.debit_cents = 12_000;
    expect(verifyLedgerRows(rows)).toMatchObject({ ok: false, entry_id: rows[0]!.entry_id });
  });
});

describe("closed months", () => {
  it("posts a late item from a closed month on the first day of the next open month, keeping its document date", () => {
    const db = fresh();
    lockMonth(db, "2026-10", "test", NOW);
    const r = postEntry(db, sale({ date: "2026-10-20" }), NOW);
    expect(r.posting_date).toBe("2026-11-01");
    expect(ledgerRows(db)[0]).toMatchObject({ posting_date: "2026-11-01", doc_date: "2026-10-20" });
  });

  it("skips every locked month in a row", () => {
    const db = fresh();
    lockMonth(db, "2026-10", "test", NOW);
    lockMonth(db, "2026-11", "test", NOW);
    expect(postEntry(db, sale({ date: "2026-10-02" }), NOW).posting_date).toBe("2026-12-01");
  });

  it("locks a month once", () => {
    const db = fresh();
    expect(lockMonth(db, "2026-10", "test", NOW)).toBe(true);
    expect(lockMonth(db, "2026-10", "test", NOW)).toBe(false);
    expect(() => lockMonth(db, "2026-13", "test", NOW)).toThrow();
  });
});
