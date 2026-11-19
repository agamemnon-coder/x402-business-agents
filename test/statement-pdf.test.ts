// /books' "Download PDF" (src/vault/statementPdf.ts): the statement drawn from the same view /books shows. Read back
// with Purser's own PDF reader, the PDF holds the company, both statements with their totals, the balance line only
// when it balances, the translation note, every sorted invoice with Claude's reason (cut in the table, whole in the
// appendix), and "Page x of y" on every page. It is the same bytes every time for the same statement.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pdfText } from "../src/ap/pdfText.js";
import { clean, shortReason, statementPdf, statementView, type BooksStatementFile, type StatementView } from "../src/vault/statementPdf.js";

const FILE = JSON.parse(readFileSync(new URL("../docs/assets/books/statement-2026-11-12.json", import.meta.url), "utf8")) as BooksStatementFile;
/** Text as the reader gives it, with runs of white space as one space. */
const textOf = async (pdf: Buffer) => { const r = await pdfText(new Uint8Array(pdf)); return { text: r.text.replace(/\s+/g, " "), pages: r.pages }; };

describe("the statement as a PDF", () => {
  it("holds the company, both statements with their totals and the balance line, every sorted invoice, and page numbers", async () => {
    const v = statementView(FILE)!;
    expect(v.balances).toBe(true);
    const pdf = await statementPdf(v);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const { text, pages } = await textOf(pdf);
    expect(text).toContain("Balance sheet and profit and loss");
    expect(text).toContain(`Balance sheet at ${v.asOf}`);
    expect(text).toContain("Total assets");
    expect(text).toContain("Total liabilities and equity");
    expect(text).toContain("Balances: total assets");
    expect(text).toContain("Profit and loss, 2026");
    expect(text).toContain("Invoices, sorted by Claude");
    for (const s of v.sorted) expect(text).toContain(clean(s.number));
    // Every reason in the file is long: each is cut in the table and given whole in the appendix.
    expect(v.sorted.every((s) => clean(s.reason).length > 140)).toBe(true);
    expect(text).toContain("Appendix: Claude's reasons in full");
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(pages).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("is the same bytes every time for the same statement (its dates are the statement's own)", async () => {
    const v = statementView(FILE)!;
    const [a, b] = await Promise.all([statementPdf(v), statementPdf(v)]);
    expect(a.equals(b)).toBe(true);
  }, 60_000);

  it("leaves out the balance line when the statement does not balance, the invoices page when none was sorted, and shows the translation note", async () => {
    const v = statementView(FILE)!;
    const off: StatementView = { ...v, balances: false, sorted: [], translated: "GBP translated into EUR at the rate of the conversion that bought it." };
    const { text, pages } = await textOf(await statementPdf(off));
    expect(text).not.toContain("Balances: total assets");
    expect(text).not.toContain("Invoices, sorted by Claude");
    expect(text).toContain("GBP translated into EUR at the rate of the conversion that bought it.");
    expect(pages).toBe(1);
    expect(text).toContain("Page 1 of 1");
  }, 60_000);

  it("short reasons need no appendix; a long table breaks onto new pages with its header again", async () => {
    const v = statementView(FILE)!;
    const one = v.sorted[0]!;
    const many = Array.from({ length: 40 }, (_, i) => ({ ...one, number: `INV-${String(i).padStart(3, "0")}`, reason: "Office supplies, booked as costs.", date: i % 2 ? "2026-11-02" : "2026-11-01" }));
    const { text, pages } = await textOf(await statementPdf({ ...v, sorted: many }));
    expect(text).not.toContain("Appendix");
    expect(text).toContain("INV-039");
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(text).toContain("2026-11-01 to 2026-11-02");
  }, 60_000);
});

describe("the words in the table", () => {
  it("a reason over 140 characters is cut at a word with an ellipsis; a short one is kept whole, soft hyphens removed", () => {
    expect(shortReason("short­reason")).toBe("shortreason");
    const long = `${"word ".repeat(40)}end`;
    const cut = shortReason(long);
    expect(cut.length).toBeLessThanOrEqual(140);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });

  it("a statement without a P&L in its currency, or with an amount that is not one, gives no view", () => {
    expect(statementView({ ...FILE, pnl: [] })).toBeNull();
    const bad = structuredClone(FILE);
    bad.balance[0]!.accounts[0]!.amount = "lots";
    expect(statementView(bad)).toBeNull();
    expect(statementView({ ...FILE, balance: [] })).toBeNull();
  });
});
