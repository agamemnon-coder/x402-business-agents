// T:0's own statements: the balance sheet must balance (assets = liabilities + equity) for every period, and the cash
// flow statement is read with the same report query. Pure checks on the shapes T:0's OpenAPI documents; no network.
import { describe, expect, it } from "vitest";
import { balanceSheetCheck, cashFlowNetChange, T0Client, type T0BalanceSheet, type T0CashFlow } from "../src/accounting/t0.js";

const head = { periods: [{ id: "p1", label: "Nov 2026", start_date: "2026-11-01", end_date: "2026-11-30" }], reporting_currency: "USD", atoms_per_unit: 100 };

const sheet = (assets: number, liabilities: number, equity: number): T0BalanceSheet => ({
  ...head,
  sections: [
    { account_type: "asset", label: "Assets", balances: { p1: assets } },
    { account_type: "liability", label: "Liabilities", balances: { p1: liabilities } },
    { account_type: "equity", label: "Equity", balances: { p1: equity } },
  ],
});

describe("T:0 balance sheet check", () => {
  it("passes when assets equal liabilities plus equity", () => {
    const [p] = balanceSheetCheck(sheet(1_000_00, 400_00, 600_00));
    expect(p).toMatchObject({ period: "Nov 2026", assets: 1000, liabilities: 400, equity: 600, difference: 0, balances: true });
  });
  it("flags a period that does not balance, with the difference in units", () => {
    const [p] = balanceSheetCheck(sheet(1_000_00, 400_00, 599_00));
    expect(p).toMatchObject({ difference: 1, balances: false });
  });
  it("treats a period with no data as not checkable, never as balanced", () => {
    const bs = sheet(0, 0, 0);
    for (const s of bs.sections) s.balances = { p1: null };
    expect(balanceSheetCheck(bs)[0]).toMatchObject({ balances: false, noData: true });
  });
  it("refuses a sheet without the three sections", () => {
    const bs = sheet(1, 1, 0);
    bs.sections = bs.sections.slice(0, 2);
    expect(() => balanceSheetCheck(bs)).toThrow(/equity/);
  });
});

describe("T:0 cash flow", () => {
  it("reads the computed net change per period", () => {
    const cf: T0CashFlow = { ...head, sections: [
      { key: "operating", label: "Operating", balances: { p1: 50_00 } },
      { key: "net_change", label: "Net change in cash", is_subtotal: true, balances: { p1: 50_00 } },
    ] };
    expect(cashFlowNetChange(cf)).toEqual([{ period: "Nov 2026", netChange: 50 }]);
  });
  it("asks T:0 for /v1/reports/cash-flow with the report window", async () => {
    let url = "";
    const fetch = (async (u: string | URL | Request) => { url = String(u); return new Response(JSON.stringify({ ...head, sections: [] }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof globalThis.fetch;
    await new T0Client({ apiKey: "k", fetch, retryDelayMs: 0 }).cashFlow({ start_date: "2026-11-01", end_date: "2026-11-30" });
    expect(url).toContain("/v1/reports/cash-flow");
    expect(url).toContain("start_date=2026-11-01");
  });
});
