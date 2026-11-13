// /books' "Download PDF" (owner, 13 Nov: "a clean PDF download"): the test company's balance sheet and profit and loss
// as a classic statement, and the invoices Claude sorted, each with the booking Claude chose and its own reason. Every
// figure comes from the statement file npm run books:statement writes (docs/assets/books/statement-<day>.json), which
// /books renders too, so the page and the PDF cannot disagree. Deterministic: the creation date is the statement's day.
import PDFDocument from "pdfkit";
import { COST_CENTRE_NAMES } from "../config/gl.js";
import { LEDGER_ACCOUNTS } from "../ledger/accounts.js";
import { VAT_CODES } from "../ledger/vat.js";

/** The statement file, as scripts/books-statement.ts writes it. */
export interface BooksStatementFile {
  company: string; day: string; record: string; pdf: string; invoices_checked: number;
  balance: { currency: string; assets: string; liabilities: string; equity: string; result: string; balanced: boolean; accounts: { account: string; name: string; type: string; amount: string }[] }[];
  pnl: { currency: string; revenue: string; expense: string; result: string; accounts: { account: string; name: string; amount: string }[] }[];
  cash?: { day: string; what: string; currency: string; balance_cents: number }[];
  sorted: { eval: string; ran_at: string; rows: { case: string; model: string; path: string[]; supplier?: string; number?: string; date?: string; currency?: string; total?: string; account: string; vat: string | null; cost_centre: string | null; reason?: string | null }[] };
}

/** One line of the statement: a name and an amount in cents. */
export interface StatementLine { name: string; cents: number }
export interface StatementView {
  company: string; currency: string; asOf: string;
  assets: StatementLine[]; liabilities: StatementLine[]; equity: StatementLine[];
  totalAssets: number; totalLiabilities: number; totalEquity: number; result: number; balances: boolean;
  revenue: number; expenses: StatementLine[]; totalExpenses: number;
  sorted: { date: string; supplier: string; number: string; total: string; currency: string; booking: string; reason: string }[];
}

/** "977.59" or "-33.99" to cents; null when it is not an amount. */
export function centsOf(s: string): number | null {
  const m = /^(-?)([\d,]+)\.(\d{2})$/.exec(String(s).trim().replace(/\u2212/g, "-"));
  return m ? (m[1] ? -1 : 1) * (Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3])) : null;
}
/** The plain names the statement shows; every other account keeps its chart name, without the bracketed note. */
const PLAIN: Record<string, string> = { "1200": "Cash at bank", "1510": "VAT receivable", "2100": "Creditors", "3000": "Owner's equity" };
export const plainName = (account: string, name: string): string => PLAIN[account] ?? name.replace(/\s*\(.*\)$/, "");
const chartName = (account: string) => (LEDGER_ACCOUNTS[account] ?? "").replace(/\s*\(.*\)$/, "");

/**
 * The statement as both /books and the PDF show it, from the file; null when the file does not hold one. The balance
 * check is recomputed here, from the lines: assets = liabilities + equity + this year's result, and that result equal
 * to the P&L's.
 */
export function statementView(f: BooksStatementFile): StatementView | null {
  const b = f.balance[0], p = f.pnl.find((x) => x.currency === b?.currency);
  if (!b || !p) return null;
  const lines = (type: string) => b.accounts.filter((a) => a.type === type).map((a) => ({ name: plainName(a.account, a.name), cents: centsOf(a.amount) ?? NaN }));
  const assets = lines("asset"), liabilities = lines("liability"), equity = lines("equity");
  const expenses = p.accounts.map((a) => ({ name: plainName(a.account, a.name), cents: centsOf(a.amount) ?? NaN }));
  const result = centsOf(b.result), revenue = centsOf(p.revenue), expense = centsOf(p.expense);
  if (result === null || revenue === null || expense === null || [...assets, ...liabilities, ...equity, ...expenses].some((x) => !Number.isFinite(x.cents))) return null;
  const sum = (xs: StatementLine[]) => xs.reduce((n, x) => n + x.cents, 0);
  const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = sum(equity) + result, totalExpenses = sum(expenses);
  const asOf = f.cash?.length ? f.cash.reduce((d, c) => (c.day > d ? c.day : d), f.day) : f.day;
  return {
    company: f.company, currency: b.currency, asOf, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, result,
    balances: b.balanced && totalAssets === totalLiabilities + totalEquity && result === revenue - expense && totalExpenses === expense,
    revenue, expenses, totalExpenses,
    sorted: f.sorted.rows.filter((r) => r.supplier && r.number && r.date && r.total && r.reason).map((r) => ({
      date: r.date!, supplier: r.supplier!, number: r.number!, total: centsOf(r.total!) === null ? r.total! : fmt(centsOf(r.total!)!), currency: r.currency ?? "EUR", reason: r.reason!,
      booking: [`${r.account} ${chartName(r.account)}`, r.vat ? `VAT ${VAT_CODES[r.vat]?.label ?? r.vat}` : "", r.cost_centre ? `${r.cost_centre} ${COST_CENTRE_NAMES[r.cost_centre] ?? ""}`.trim() : ""].filter(Boolean).join("  ·  "),
    })),
  };
}

const INK = "#0b1220", MUTED = "#586174", LINE = "#e3e6ec", ACCENT = "#4f46e5", OK = "#0b7d43", BAND = "#f1f3f7";
const fmt = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100).toLocaleString("en-US")}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

export function statementPdf(v: StatementView): Promise<Buffer> {
  const at = new Date(`${v.asOf}T00:00:00Z`);
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${v.company}: balance sheet and profit and loss`, Author: "Purser", Creator: "Purser", Producer: "Purser", CreationDate: at, ModDate: at } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  const L = 50, W = 495, R = L + W;

  // Header: the company, the title, the period, and the test-money band.
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`${v.company.toUpperCase()}  ·  TEST COMPANY  ·  TEST MONEY`, L, 50, { characterSpacing: 1 });
  doc.moveDown(0.4).fillColor(INK).font("Helvetica-Bold").fontSize(21).text("Balance sheet and profit and loss");
  doc.font("Helvetica").fontSize(10.5).fillColor(MUTED).text(`2026, books to ${v.asOf}  ·  ${v.currency}`);
  let y = doc.y + 10;
  doc.rect(L, y, W, 26).fill(BAND);
  doc.fillColor(INK).font("Helvetica").fontSize(8.5).text("Test money on a stand-in bank: no real money moved. Every figure is read from the ledger Purser kept for this test company.", L + 10, y + 9, { width: W - 20 });
  y += 40;

  const row = (name: string, cents: number | null, o: { bold?: boolean; indent?: boolean; rule?: "thin" | "total" | "double"; muted?: boolean } = {}) => {
    if (o.rule) {
      doc.moveTo(L, y).lineTo(R, y).strokeColor(o.rule === "thin" ? LINE : INK).lineWidth(o.rule === "thin" ? 0.5 : 0.9).stroke();
      if (o.rule === "double") doc.moveTo(L, y + 2).lineTo(R, y + 2).strokeColor(INK).lineWidth(0.9).stroke();
      y += o.rule === "double" ? 5 : 3;
    }
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(o.muted ? MUTED : INK).text(name, L + (o.indent ? 12 : 0), y, { width: W - 140, lineBreak: false });
    if (cents !== null) doc.text(fmt(cents), R - 130, y, { width: 130, align: "right", lineBreak: false });
    y += 16;
  };
  const heading = (t: string) => {
    y += 8;
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(INK).text(t, L, y);
    y += 18;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(ACCENT).lineWidth(1.4).stroke();
    y += 8;
  };
  const group = (t: string) => { doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text(t.toUpperCase(), L, y, { characterSpacing: 0.8 }); y += 14; };

  heading(`Balance sheet at ${v.asOf}`);
  group("Assets");
  for (const a of v.assets) row(a.name, a.cents, { indent: true });
  row("Total assets", v.totalAssets, { bold: true, rule: "total" });
  y += 6;
  group("Liabilities");
  for (const a of v.liabilities) row(a.name, a.cents, { indent: true });
  row("Total liabilities", v.totalLiabilities, { bold: true, rule: "total" });
  y += 6;
  group("Equity");
  for (const a of v.equity) row(a.name, a.cents, { indent: true });
  row("Result this year", v.result, { indent: true });
  row("Total equity", v.totalEquity, { bold: true, rule: "total" });
  y += 4;
  row("Total liabilities and equity", v.totalLiabilities + v.totalEquity, { bold: true, rule: "double" });
  if (v.balances) {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(OK).text(`Balances: total assets ${fmt(v.totalAssets)} = total liabilities and equity ${fmt(v.totalLiabilities + v.totalEquity)}`, L, y + 2);
    y += 20;
  }

  heading("Profit and loss, 2026");
  row("Revenue", v.revenue);
  y += 4;
  group("Expenses");
  for (const e of v.expenses) row(e.name, e.cents, { indent: true });
  row("Total expenses", v.totalExpenses, { bold: true, rule: "total" });
  y += 4;
  row("Result", v.revenue - v.totalExpenses, { bold: true, rule: "double" });

  if (v.sorted.length) {
    doc.addPage();
    y = 50;
    heading("Invoices, sorted by Claude");
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Test invoices from the Coder eval. Claude chose the account, VAT code and cost centre of each, all three right; code checked them. Its own reason under each.", L, y, { width: W });
    y = doc.y + 10;
    for (const s of v.sorted) {
      if (y > 730) { doc.addPage(); y = 50; }
      doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
      y += 6;
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(s.supplier, L, y, { width: 300, lineBreak: false });
      doc.text(`${s.currency} ${s.total}`, R - 130, y, { width: 130, align: "right", lineBreak: false });
      y += 14;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${s.date}  ·  ${s.number}`, L, y, { lineBreak: false });
      y += 13;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text("Sorted by Claude", L, y, { continued: true }).font("Helvetica").fillColor(INK).text(`   ${s.booking}`);
      y = doc.y + 3;
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text(s.reason, L, y, { width: W });
      y = doc.y + 8;
    }
  }
  if (y > 740) { doc.addPage(); y = 50; }
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Made by Purser (npm run books:statement): the books rebuilt from the Moneybird sandbox run with its own code and checked against its record, invoice by invoice, to the cent.", L, y + 14, { width: W });
  doc.end();
  return done;
}
