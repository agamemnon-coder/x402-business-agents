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
  /** No revenue, yet the output VAT account holds VAT: reverse charge, shown as such. */
  reverseCharge: boolean;
  /** How another currency's lines came into this statement (inBaseCurrency), in words; null when none did. */
  translated: string | null;
  sorted: { date: string; supplier: string; number: string; total: string; cents: number | null; currency: string; booking: string; account: string; vat: string; costCentre: string; reason: string }[];
}

/** "977.59" or "-33.99" to cents; null when it is not an amount. */
export function centsOf(s: string): number | null {
  const m = /^(-?)([\d,]+)\.(\d{2})$/.exec(String(s).trim().replace(/\u2212/g, "-"));
  return m ? (m[1] ? -1 : 1) * (Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3])) : null;
}
/** The plain names the statement shows; every other account keeps its chart name, without the bracketed note. */
// 5000 is the chart's "Purchased stock data (warehouse …)", Kit 11's data licence; a test company's goods for resale
// read as stock purchases (review, 13 Nov: "Purchased stock data" for mugs confused a visitor).
const PLAIN: Record<string, string> = { "1200": "Cash at bank", "1510": "VAT receivable", "1515": "Foreign VAT to reclaim (EU refund)", "2100": "Creditors", "3000": "Owner's equity", "5000": "Stock purchases" };
export const plainName = (account: string, name: string): string => PLAIN[account] ?? name.replace(/\s*\(.*\)$/, "");
const OUTPUT_VAT_ACCOUNT = "2210";
export const REVERSE_CHARGE_NAME = "VAT payable, reverse charge";
/** One line under the balance sheet when the VAT payable is reverse charge (review, 13 Nov). */
export const REVERSE_CHARGE_LINE = "No sales this month: the VAT payable is reverse charge, the VAT the company owes on services bought from suppliers in other countries; the same amount is reclaimed as input VAT.";
const chartName = (account: string) => plainName(account, LEDGER_ACCOUNTS[account] ?? "");

const TRANSIT_ACCOUNT = "1590";
const cents2 = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

/**
 * The file with another currency's lines brought into the first (the company's) currency, so its P&L holds every
 * expense and nothing is left parked on money in transit (the CFO review, 14 Nov: the GBP 840 of expenses were left
 * out of the EUR P&L and EUR 982.80 sat on 1590). Translated at the rate of the conversion that bought that currency:
 * what money in transit holds on each side (EUR 982.80 for GBP 840.00 is 1.17), the rate on the day it was bought.
 * Only when exactly one other currency has money in transit, of the opposite sign, and the translated statement still
 * balances to the cent; otherwise the file is returned as it is and that currency is shown on its own.
 */
export function inBaseCurrency(f: BooksStatementFile): { file: BooksStatementFile; note: string | null } {
  const base = f.balance[0];
  const transitOf = (b: BooksStatementFile["balance"][number]) => centsOf(b.accounts.find((a) => a.account === TRANSIT_ACCOUNT)?.amount ?? "0.00") ?? 0;
  if (!base) return { file: f, note: null };
  const baseTransit = transitOf(base);
  const others = f.balance.slice(1).filter((b) => transitOf(b) !== 0);
  if (baseTransit === 0 || others.length !== 1 || Math.sign(transitOf(others[0]!)) === Math.sign(baseTransit)) return { file: f, note: null };
  const o = others[0]!, ot = transitOf(o);
  const tr = (c: number) => Math.round((c * baseTransit) / -ot);
  const merge = <T extends { account: string; amount: string }>(into: T[], from: T[]) => {
    const out = into.map((a) => ({ ...a }));
    for (const a of from) {
      const c = tr(centsOf(a.amount) ?? NaN);
      if (!Number.isFinite(c)) return null;
      const had = out.find((x) => x.account === a.account);
      if (had) had.amount = cents2((centsOf(had.amount) ?? 0) + c); else out.push({ ...a, amount: cents2(c) });
    }
    return out.filter((a) => (centsOf(a.amount) ?? 0) !== 0 || a.account !== TRANSIT_ACCOUNT);
  };
  const accounts = merge(base.accounts, o.accounts);
  const bp = f.pnl.find((x) => x.currency === base.currency), op = f.pnl.find((x) => x.currency === o.currency);
  const pnlAccounts = bp && op ? merge(bp.accounts, op.accounts) : bp?.accounts ?? null;
  if (!accounts || !pnlAccounts || !bp) return { file: f, note: null };
  const expense = (centsOf(bp.expense) ?? 0) + (op ? tr(centsOf(op.expense) ?? 0) : 0), revenue = (centsOf(bp.revenue) ?? 0) + (op ? tr(centsOf(op.revenue) ?? 0) : 0);
  const sum = (type: string) => accounts.filter((a) => a.type === type).reduce((n, a) => n + (centsOf(a.amount) ?? 0), 0);
  const result = revenue - expense;
  // Translated line by line, the cents must still add up; when rounding breaks that, nothing is translated.
  if (sum("asset") !== sum("liability") + sum("equity") + result || pnlAccounts.reduce((n, a) => n + (centsOf(a.amount) ?? 0), 0) !== expense) return { file: f, note: null };
  const file: BooksStatementFile = {
    ...f,
    balance: [{ ...base, accounts, assets: cents2(sum("asset")), liabilities: cents2(sum("liability")), equity: cents2(sum("equity")), result: cents2(result), balanced: true }, ...f.balance.slice(1).filter((b) => b !== o)],
    pnl: [{ ...bp, accounts: pnlAccounts, expense: cents2(expense), revenue: cents2(revenue), result: cents2(result) }, ...f.pnl.filter((x) => x !== bp && x !== op)],
  };
  const rate = (baseTransit / -ot).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return { file, note: `${o.currency} translated into ${base.currency} at the rate of the conversion that bought it: ${base.currency} ${cents2(baseTransit)} for ${o.currency} ${cents2(-ot)} (${rate}), so money in transit is cleared.` };
}

/**
 * The statement as both /books and the PDF show it, from the file; null when the file does not hold one. The balance
 * check is recomputed here, from the lines: assets = liabilities + equity + this year's result, and that result equal
 * to the P&L's.
 */
export function statementView(given: BooksStatementFile): StatementView | null {
  const { file: f, note: translated } = inBaseCurrency(given);
  const b = f.balance[0], p = f.pnl.find((x) => x.currency === b?.currency);
  if (!b || !p) return null;
  const result = centsOf(b.result), revenue = centsOf(p.revenue), expense = centsOf(p.expense);
  // Review, 13 Nov: "Output VAT" beside no revenue reads as an error. With no sales, what that account holds is the VAT
  // the company owes itself on reverse-charged purchases (src/ap/books.ts), so it is named for what it is.
  const reverseCharge = revenue === 0 && b.accounts.some((a) => a.account === OUTPUT_VAT_ACCOUNT && (centsOf(a.amount) ?? 0) !== 0);
  const nameOf = (account: string, name: string) => (reverseCharge && account === OUTPUT_VAT_ACCOUNT ? REVERSE_CHARGE_NAME : plainName(account, name));
  const lines = (type: string) => b.accounts.filter((a) => a.type === type).map((a) => ({ name: nameOf(a.account, a.name), cents: centsOf(a.amount) ?? NaN }));
  const assets = lines("asset"), liabilities = lines("liability"), equity = lines("equity");
  const expenses = p.accounts.map((a) => ({ name: plainName(a.account, a.name), cents: centsOf(a.amount) ?? NaN }));
  if (result === null || revenue === null || expense === null || [...assets, ...liabilities, ...equity, ...expenses].some((x) => !Number.isFinite(x.cents))) return null;
  const sum = (xs: StatementLine[]) => xs.reduce((n, x) => n + x.cents, 0);
  const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = sum(equity) + result, totalExpenses = sum(expenses);
  const asOf = f.cash?.length ? f.cash.reduce((d, c) => (c.day > d ? c.day : d), f.day) : f.day;
  return {
    company: f.company, currency: b.currency, asOf, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, result, reverseCharge, translated,
    balances: b.balanced && totalAssets === totalLiabilities + totalEquity && result === revenue - expense && totalExpenses === expense,
    revenue, expenses, totalExpenses,
    sorted: f.sorted.rows.filter((r) => r.supplier && r.number && r.date && r.total && r.reason).map((r) => ({
      date: r.date!, supplier: r.supplier!, number: r.number!, total: centsOf(r.total!) === null ? r.total! : fmt(centsOf(r.total!)!), cents: centsOf(r.total!), currency: r.currency ?? "EUR", reason: r.reason!,
      account: `${r.account} ${chartName(r.account)}`, vat: r.vat ? (VAT_CODES[r.vat]?.label ?? r.vat) : "", costCentre: r.cost_centre ? `${r.cost_centre} ${COST_CENTRE_NAMES[r.cost_centre] ?? ""}`.trim() : "",
      booking: [`${r.account} ${chartName(r.account)}`, r.vat ? `VAT ${VAT_CODES[r.vat]?.label ?? r.vat}` : "", r.cost_centre ? `${r.cost_centre} ${COST_CENTRE_NAMES[r.cost_centre] ?? ""}`.trim() : ""].filter(Boolean).join("  ·  "),
    })),
  };
}

const INK = "#0b1220", MUTED = "#586174", LINE = "#e3e6ec", ACCENT = "#4382e8", OK = "#0b7d43", BAND = "#f1f3f7";
/** Text as drawn: no soft hyphen and no zero-width character, which a viewer may draw as a stray dot (Max, 14 Nov). */
export const clean = (t: string): string => t.normalize("NFC").replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, "");
/** Claude's reason in one short line under its row: about 140 characters, cut at a word; the whole reason is in the appendix. */
export function shortReason(t: string, max = 140): string {
  const c = clean(t).replace(/\s+/g, " ").trim();
  if (c.length <= max) return c;
  const cut = c.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,;:.]+$/, "")}…`;
}
const fmt = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100).toLocaleString("en-US")}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

export function statementPdf(v: StatementView): Promise<Buffer> {
  const at = new Date(`${v.asOf}T00:00:00Z`);
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: `${v.company}: balance sheet and profit and loss`, Author: "Purser", Creator: "Purser", Producer: "Purser", CreationDate: at, ModDate: at } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  const L = 50, W = 495, R = L + W;

  // Header: the company, the title, the period, and the test-money band.
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`${v.company.replace(/\s*\(test company\)$/i, "").toUpperCase()}  ·  TEST COMPANY  ·  TEST MONEY`, L, 50, { characterSpacing: 1 });
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
  if (v.translated) {
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(v.translated, L, y, { width: W });
    y = doc.y + 6;
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
    // "Invoices, sorted by Claude" (Max, 14 Nov: "looks unorganised"): a header block with the totals, then one table
    // (Supplier | Date | Invoice no | Account | VAT | Cost centre | Amount), Claude's reason cut to one short line under
    // each row, and the whole reasons in an appendix. Every figure is the run record's.
    doc.addPage();
    y = 50;
    heading("Invoices, sorted by Claude");
    const days = v.sorted.map((s) => s.date).sort();
    const totals = new Map<string, number>();
    for (const s of v.sorted) if (s.cents !== null) totals.set(s.currency, (totals.get(s.currency) ?? 0) + s.cents);
    const facts: [string, string][] = [["Company", clean(v.company)], ["Period", days[0] === days[days.length - 1] ? days[0]! : `${days[0]} to ${days[days.length - 1]}`],
      ["Invoices", String(v.sorted.length)], ["Total", [...totals].map(([c, n]) => `${c} ${fmt(n)}`).join(", ")]];
    doc.rect(L, y, W, 54).fill(BAND);
    const fws = [150, 130, 55, 160];
    let fx = L + 10;
    facts.forEach(([k, val], i) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(k.toUpperCase(), fx, y + 9, { width: fws[i]! - 12, characterSpacing: 0.6, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(val, fx, y + 22, { width: fws[i]! - 12 });
      fx += fws[i]!;
    });
    y += 60;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#7a4a00").text("Made-up data · test money", L, y);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text("Claude chose the account, VAT code and cost centre of each invoice; Purser's code checked every choice before it was booked.", L, y + 12, { width: W });
    y = doc.y + 10;
    // The columns, in points; the amount right-aligned.
    const cols = [{ k: "Supplier", w: 96 }, { k: "Date", w: 52 }, { k: "Invoice no", w: 64 }, { k: "Account", w: 90 }, { k: "VAT", w: 68 }, { k: "Cost centre", w: 60 }, { k: "Amount", w: 65, right: true }];
    const xs: number[] = [];
    cols.reduce((x, c) => { xs.push(x); return x + c.w; }, L);
    const head = () => {
      doc.rect(L, y, W, 18).fill(INK);
      cols.forEach((c, i) => doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text(c.k.toUpperCase(), xs[i]! + 4, y + 6, { width: c.w - 6, align: c.right ? "right" : "left", characterSpacing: 0.2, lineBreak: false }));
      y += 18;
    };
    head();
    v.sorted.forEach((s, n) => {
      const cells = [clean(s.supplier), clean(s.date), clean(s.number), clean(s.account), clean(s.vat), clean(s.costCentre), `${s.currency} ${s.total}`];
      const hRow = Math.max(...cells.map((c, i) => doc.font(i === 0 || i === 6 ? "Helvetica-Bold" : "Helvetica").fontSize(8).heightOfString(c, { width: cols[i]!.w - 8 }))) + 8;
      const reason = `${shortReason(s.reason)}${clean(s.reason).length > 140 ? ` (A${n + 1})` : ""}`;
      doc.font("Helvetica-Oblique").fontSize(7.5);
      const hReason = doc.heightOfString(reason, { width: W - 12 }) + 6;
      if (y + hRow + hReason > 770) { doc.addPage(); y = 50; head(); }
      if (n % 2 === 1) doc.rect(L, y, W, hRow + hReason).fill("#f7f8fa");
      cells.forEach((c, i) => doc.font(i === 0 || i === 6 ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(INK).text(c, xs[i]! + 4, y + 5, { width: cols[i]!.w - 8, align: cols[i]!.right ? "right" : "left" }));
      y += hRow;
      doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED).text(reason, L + 6, y, { width: W - 12 });
      y += hReason;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
    });
    // Appendix: Claude's whole reason for each invoice whose line above was cut.
    const long = v.sorted.map((s, n) => ({ s, n })).filter(({ s }) => clean(s.reason).length > 140);
    if (long.length) {
      y += 14;
      if (y > 700) { doc.addPage(); y = 50; }
      heading("Appendix: Claude's reasons in full");
      for (const { s, n } of long) {
        const txt = clean(s.reason);
        doc.font("Helvetica").fontSize(8.5);
        const h = doc.heightOfString(txt, { width: W - 30 }) + 18;
        if (y + h > 770) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(ACCENT).text(`A${n + 1}`, L, y, { width: 26, lineBreak: false });
        doc.font("Helvetica-Bold").fillColor(INK).text(`${clean(s.supplier)}, ${clean(s.number)}`, L + 30, y, { width: W - 30 });
        doc.font("Helvetica").fillColor(MUTED).text(txt, L + 30, doc.y + 1, { width: W - 30 });
        y = doc.y + 8;
      }
    }
  }
  if (y > 740) { doc.addPage(); y = 50; }
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Made by Purser from the ledger of a test company; every figure is read from its run record. Fictional company and suppliers, test money.", L, y + 14, { width: W });
  // Page x of y on every page, in the bottom margin.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`Page ${i + 1} of ${pages.count}`, L, doc.page.height - 32, { width: W, align: "right", lineBreak: false });
    doc.text(clean(v.company), L, doc.page.height - 32, { width: W / 2, lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
