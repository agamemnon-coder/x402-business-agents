// /books (owner, 13 Nov): the statement ties, every figure on the page is the statement file's, every sorted invoice
// carries the "Sorted by Claude" tag and Claude's own reason, and the PDF is served. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cashChart, money, spendChart, STATEMENT_FILE } from "../src/redesign/booksPage.js";
import { centsOf, statementView, type BooksStatementFile } from "../src/vault/statementPdf.js";
import { BOOKS_CSP, BOOKS_PAGE, LOGOS } from "../src/servers/dashboard.js";

const file = JSON.parse(readFileSync(STATEMENT_FILE, "utf8")) as BooksStatementFile;

describe("/books", () => {
  it("ties: assets = liabilities + equity, the result is the P&L's, and expenses add up", () => {
    const v = statementView(file)!;
    expect(v.balances).toBe(true);
    expect(v.totalAssets).toBe(centsOf(file.balance[0]!.assets));
    expect(v.totalAssets).toBe(v.totalLiabilities + v.totalEquity);
    expect(v.revenue - v.totalExpenses).toBe(centsOf(file.balance[0]!.result));
  });

  it("refuses a statement that does not tie", () => {
    const bad = structuredClone(file);
    bad.balance[0]!.accounts[0]!.amount = "1.00";
    const v = statementView(bad);
    expect(v?.balances ?? false).toBe(false);
  });

  it("shows only figures from the file: the statement, the cash points and the expenses", () => {
    const v = statementView(file)!;
    const allowed = new Set([
      ...[...v.assets, ...v.liabilities, ...v.equity, ...v.expenses].map((x) => money(x.cents)),
      ...[v.totalAssets, v.totalLiabilities, v.totalEquity, v.result, v.revenue, v.totalExpenses, v.totalLiabilities + v.totalEquity].map(money),
      ...(file.cash ?? []).map((c) => money(c.balance_cents)),
      ...v.sorted.map((s) => s.total),
    ]);
    const main = /<main[\s\S]*<\/main>/.exec(BOOKS_PAGE)![0].replace(/<details[\s\S]*?<\/details>/g, "").replace(/<p class="why">[\s\S]*?<\/p>/g, "");
    const shown = [...main.replace(/<[^>]+>/g, " ").matchAll(/−?\d[\d,]*\.\d{2}\b/g)].map((m) => m[0]);
    expect(shown.length).toBeGreaterThan(10);
    for (const n of shown) expect({ n, ok: allowed.has(n) || allowed.has(n.replace(/^-/, "−")) }).toEqual({ n, ok: true });
  });

  it("tags every sorted invoice 'Sorted by Claude' with Claude's own reason", () => {
    const v = statementView(file)!;
    expect(v.sorted.length).toBe(file.sorted.rows.length);
    expect(BOOKS_PAGE.match(/Sorted by Claude/g)!.length).toBe(v.sorted.length);
    for (const r of file.sorted.rows) expect(BOOKS_PAGE).toContain(r.reason!.slice(0, 40).replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
  });

  it("draws the charts from the data, and serves the PDF the page links to", () => {
    const v = statementView(file)!;
    expect(cashChart([], "EUR")).toBe("");
    expect(spendChart(v.expenses, v.totalExpenses).match(/<li /g)!.length).toBe(v.expenses.filter((e) => e.cents > 0).length);
    expect(BOOKS_PAGE).toContain(`href="assets/${file.pdf}"`);
    expect(LOGOS[file.pdf]?.type).toBe("application/pdf");
    expect(LOGOS[file.pdf]!.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(BOOKS_CSP).toMatch(/script-src 'sha256-/);
  });
});
