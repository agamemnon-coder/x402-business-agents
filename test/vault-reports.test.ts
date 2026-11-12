// The year report needs the year's result before the closing entry: after a year close, every profit-and-loss account
// is brought to zero on the last day. The ledger marks those lines as closing (review of PR #108, finding 2), so the
// profit and loss leaves them out and a closed year still shows its result; the vault's year report relies on that.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { closeYear } from "../src/ledger/close.js";
import { postEntry } from "../src/ledger/core.js";
import { profitAndLoss } from "../src/ledger/reports.js";

describe("profit and loss around the year close", () => {
  it("leaves out the closing entry, so a closed year still shows its result", () => {
    const db = openDb(":memory:");
    postEntry(db, { date: "2026-03-02", description: "sale", created_by: "t", lines: [
      { account: "1200", debit: 10_000, currency: "EUR" }, { account: "4000", credit: 10_000, currency: "EUR" }] });
    postEntry(db, { date: "2026-04-02", description: "cost", created_by: "t", lines: [
      { account: "6900", debit: 4_000, currency: "EUR" }, { account: "1200", credit: 4_000, currency: "EUR" }] });
    closeYear(db, 2026, "t", new Date("2027-01-05T09:00:00Z"));
    const year = { from: "2026-01-01", to: "2026-12-31" };
    expect(profitAndLoss(db, year).EUR).toMatchObject({ revenue_cents: 10_000, expense_cents: 4_000, result_cents: 6_000 });
  });
});
