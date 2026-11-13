// /books (owner, 13 Nov): drawn from the month's run record (npm run books:month). The statement ties, every figure on
// the page is the record's, every invoice Claude sorted carries the tag, Claude's own reason and its outcome, Claude read
// and coded the invoices live, and the PDF is served. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cashChart, money, otherCurrencies, RUN_FILE, spendChart, type RunRecord } from "../src/redesign/booksPage.js";
import { centsOf, statementView } from "../src/vault/statementPdf.js";
import { BOOKS_CSP, BOOKS_PAGE, LOGOS } from "../src/servers/dashboard.js";

type Inv = RunRecord["invoices"][number] & { read_by: string; coding: { source: string } | null; expected: { total: string; currency: string } };
const run = JSON.parse(readFileSync(RUN_FILE, "utf8")) as Omit<RunRecord, "invoices"> & { dry: boolean; invoices: Inv[] };
const file = run.books;

describe("/books, from the month's run record", () => {
  it("is a live run: Claude read and coded the invoices, within the caps, and the books balance", () => {
    expect(run.dry).toBe(false);
    expect(run.invoices.length).toBeGreaterThanOrEqual(15);
    expect(run.claude.on).toBe(true);
    expect(run.claude.spent_micros).toBeGreaterThan(0);
    expect(run.claude.spent_micros).toBeLessThanOrEqual(run.claude.caps.cap_company_micros);
    expect(run.invoices.filter((i) => i.read_by.startsWith("claude")).length).toBeGreaterThan(run.invoices.length / 2);
    expect(run.checks.coded_by_claude).toBe(file.sorted.rows.length);
    expect(run.checks.balanced).toBe(true);
  });

  it("read every invoice's total as the invoice says it", () => {
    for (const i of run.invoices) expect({ n: i.number, got: `${i.currency} ${i.total}` }).toEqual({ n: i.number, got: `${i.expected.currency} ${i.expected.total}` });
  });

  it("ties: assets = liabilities + equity, the result is the P&L's; a statement that does not tie is refused", () => {
    const v = statementView(file)!;
    expect(v.balances).toBe(true);
    expect(v.totalAssets).toBe(centsOf(file.balance[0]!.assets));
    expect(v.revenue - v.totalExpenses).toBe(centsOf(file.balance[0]!.result));
    const bad = structuredClone(file);
    bad.balance[0]!.accounts[0]!.amount = "1.00";
    expect(statementView(bad)?.balances ?? false).toBe(false);
  });

  it("shows only figures from the record", () => {
    const v = statementView(file)!;
    const allowed = new Set([
      ...[...v.assets, ...v.liabilities, ...v.equity, ...v.expenses].map((x) => money(x.cents)),
      ...[v.totalAssets, v.totalLiabilities, v.totalEquity, v.result, v.revenue, v.totalExpenses, v.totalLiabilities + v.totalEquity].map(money),
      ...(file.cash ?? []).map((c) => money(c.balance_cents)),
      ...v.sorted.map((s) => s.total),
      ...file.balance.slice(1).flatMap((b) => [...b.accounts.map((a) => money(centsOf(a.amount) ?? 0)), money(centsOf(file.pnl.find((p) => p.currency === b.currency)?.expense ?? "0.00") ?? 0)]),
      (run.claude.spent_micros / 1e6).toFixed(2),
    ]);
    const main = /<main[\s\S]*<\/main>/.exec(BOOKS_PAGE)![0].replace(/<details[\s\S]*?<\/details>/g, "").replace(/<p class="why">[\s\S]*?<\/p>/g, "");
    const shown = [...main.replace(/<[^>]+>/g, " ").matchAll(/−?\d[\d,]*\.\d{2}\b/g)].map((m) => m[0]);
    expect(shown.length).toBeGreaterThan(10);
    for (const n of shown) expect({ n, ok: allowed.has(n) || allowed.has(n.replace(/^-/, "−")) }).toEqual({ n, ok: true });
    expect(BOOKS_PAGE).toContain(otherCurrencies(file));
  });

  it("tags every sorted invoice 'Sorted by Claude' with Claude's own reason and what happened to it", () => {
    const v = statementView(file)!;
    expect(v.sorted.length).toBe(file.sorted.rows.length);
    expect(BOOKS_PAGE.match(/Sorted by Claude<\/span>/g)!.length).toBe(v.sorted.length);
    for (const r of file.sorted.rows) expect(BOOKS_PAGE).toContain(r.reason!.slice(0, 40).replace(/&/g, "&amp;").replace(/"/g, "&quot;"));
    const states = (BOOKS_PAGE.match(/class="chip ok"/g) ?? []).length + (BOOKS_PAGE.match(/class="chip wait"/g) ?? []).length;
    expect(states).toBe(v.sorted.length);
  });

  it("draws the charts from the record, and serves the PDF the page links to", () => {
    const v = statementView(file)!;
    expect(cashChart([], "EUR")).toBe("");
    expect(spendChart(v.expenses, v.totalExpenses).match(/<li /g)!.length).toBe(v.expenses.filter((e) => e.cents > 0).length);
    expect(BOOKS_PAGE).toContain(`href="assets/${file.pdf}"`);
    expect(LOGOS[file.pdf]?.type).toBe("application/pdf");
    expect(LOGOS[file.pdf]!.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(BOOKS_CSP).toMatch(/script-src 'sha256-/);
  });
});
