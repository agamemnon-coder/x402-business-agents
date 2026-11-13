// Money received (13 November): deposits to the company's Airwallex global accounts are read, recorded once, and each
// settled one is checked against Airwallex's own ledger to the cent in the hourly reconciliation
// (src/airwallex/deposits.ts, src/finance/reconcile.ts). Breaks if a deposit is recorded twice, if a window wider than
// the docs allow is asked, if a deposit not yet settled is compared, or if a cent off passes. No network.
import { describe, expect, it } from "vitest";
import { listDeposits, recordDeposits, settledDeposits, toDeposit, type Deposit } from "../src/airwallex/deposits.js";
import { openDb } from "../src/db/open.js";
import type { FinancialTx } from "../src/finance/awxFinancialTx.js";
import { reconcile } from "../src/finance/reconcile.js";

const now = new Date("2026-11-13T12:00:00Z");
const dep = (o: Partial<Deposit> = {}): Deposit => ({ id: "dep-1", globalAccountId: "ga-1", currency: "EUR", amountCents: 125000, status: "SETTLED", payer: "Summit Outfitters", reference: "NW-2026-119", createdAt: "2026-11-13T10:00:00Z", ...o });
const ft = (o: Partial<FinancialTx> = {}): FinancialTx => ({ id: "ft-1", sourceId: "dep-1", sourceType: "DEPOSIT", transactionType: "DEPOSIT", currency: "EUR", amountCents: 125000, feeCents: 0, netCents: 125000, status: "SETTLED", createdAt: null, settledAt: null, ...o });

describe("deposits to global accounts", () => {
  it("reads Airwallex's fields in integer cents", () => {
    expect(toDeposit({ id: "d", global_account_id: "g", currency: "eur", amount: "1250.00", status: "SETTLED", payer_name: "P", reference: "R", created_at: "t" }))
      .toEqual({ id: "d", globalAccountId: "g", currency: "EUR", amountCents: 125000, status: "SETTLED", payer: "P", reference: "R", createdAt: "t" });
  });

  it("asks one window of at most 31 days, page by page, and never a wider one", async () => {
    const asked: Record<string, string>[] = [];
    const api = { call: async (_m: string, _p: string, _b: unknown, q: Record<string, string>) => { asked.push(q); return { items: [{ id: `d${q.page_num}`, amount: 1 }], has_more: q.page_num === "0" }; } };
    const got = await listDeposits(api as never, { from: "2026-11-01T00:00:00+0000", to: "2026-11-13T00:00:00+0000" });
    expect(got.map((d) => d.id)).toEqual(["d0", "d1"]);
    expect(asked.map((q) => q.page_num)).toEqual(["0", "1"]);
    await expect(listDeposits(api as never, { from: "2026-09-01T00:00:00Z", to: "2026-11-13T00:00:00Z" })).rejects.toThrow(/0 to 31 days/);
  });

  it("records each deposit once and each change of status; only a settled one is a movement", () => {
    const db = openDb(":memory:");
    expect(recordDeposits(db, [dep({ status: "PENDING" })], now)).toHaveLength(1);
    expect(recordDeposits(db, [dep({ status: "PENDING" })], now)).toHaveLength(0);
    expect(settledDeposits(db)).toEqual([]);
    recordDeposits(db, [dep()], now);
    expect(settledDeposits(db)).toEqual([{ id: "dep-1", currency: "EUR", amountCents: 125000, label: "deposit from Summit Outfitters (NW-2026-119)" }]);
    expect(db.prepare("SELECT event FROM audit_log WHERE subject = 'dep-1' ORDER BY seq").all()).toEqual([{ event: "awx_deposit.seen" }, { event: "awx_deposit.status" }]);
  });
});

describe("in the hourly reconciliation, against Airwallex's own ledger", () => {
  it("a settled deposit agrees to the cent", async () => {
    const db = openDb(":memory:");
    const r = await reconcile(db, { deposits: async () => [dep()], financialTransactions: async (id) => (id === "dep-1" ? [ft()] : []) }, now);
    expect(r.differences).toEqual([]);
    expect(db.prepare("SELECT subject FROM audit_log WHERE event = 'awx_ft.agreed'").all()).toEqual([{ subject: "dep-1" }]);
  });

  it("a cent off is flagged as a difference", async () => {
    const r = await reconcile(openDb(":memory:"), { deposits: async () => [dep()], financialTransactions: async () => [ft({ amountCents: 124999 })] }, now);
    expect(r.differences).toEqual([expect.objectContaining({ area: "airwallex ledger", ref: "dep-1" })]);
  });

  it("a deposit list that cannot be read is a difference, never a quiet nothing", async () => {
    const r = await reconcile(openDb(":memory:"), { deposits: async () => { throw new Error("503"); }, financialTransactions: async () => [] }, now);
    expect(r.differences).toEqual([expect.objectContaining({ area: "airwallex ledger", ref: "deposits" })]);
  });
});
