// /books (owner, 13 Nov: "enterprise, white, clear"): the books Purser's agents kept for a test company, read from one
// file, docs/assets/books/statement-<day>.json, which npm run books:statement writes (scripts/books-statement.ts: the
// Moneybird sandbox run's test company rebuilt with the run's own code and checked against its record, invoice by
// invoice, to the cent). Top to bottom:
//   1. Four key figures that count up (cash, assets, expenses, result).
//   2. The balance sheet (assets, liabilities, equity, sub-totals, the balance check computed here) beside the P&L.
//   3. Two small charts, inline SVG: the bank balance after each entry, and spend by category (the P&L's expenses).
//   4. The invoices Claude sorted (the Coder eval's test invoices): each row tagged "Sorted by Claude", with Claude's
//      booking and its own reason.
//   5. "Download PDF" (the same file, the same view: src/vault/statementPdf.ts), the Moneybird and T:0 sync, the live demo,
//      and the details folded (account codes, the vault's folders, the T:0 journal per account).
// A file that is missing or does not balance leaves its block out; nothing here is typed in as a figure.
import { readFileSync } from "node:fs";
import { COUNT_JS } from "./stats.js";
import { REPO_BLOB } from "./metalStory.js";
import { T0_JOURNAL_RECORD, t0Journal, type T0Journal } from "./t0Page.js";
import { esc, icon } from "./ui.js";
import { statementView, type BooksStatementFile, type StatementLine, type StatementView } from "../vault/statementPdf.js";

export { centsOf, plainName } from "../vault/statementPdf.js";
export const STATEMENT_FILE = "docs/assets/books/statement-2026-11-12.json";
export const CODER_EVAL = "docs/evals/coder.json";
export const MONEYBIRD_RECORD = "docs/runs/2026-11-12-moneybird-sandbox.md";
/** The hands-on demo, whose end screen shows the books of the visitor's own invoice. */
export const BOOKS_LIVE_URL = "https://purser-try.max-31b.workers.dev/try";
/** The page's script: the key figures count up once (src/redesign/stats.ts); nothing else runs. */
export const BOOKS_JS = COUNT_JS;

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

/** 1234.5 → "1,234.50", with a true minus sign. */
export const money = (cents: number): string => { const a = Math.abs(cents); return `${cents < 0 ? "−" : ""}${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`; };
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export interface CashPoint { day: string; label: string; cents: number }
export interface BooksData {
  file: BooksStatementFile | null; view: StatementView | null; cash: CashPoint[];
  folders: { path: string[]; supplier: string }[];
  synced: { moneybird: { invoices: number; differences: number } | null; t0: T0Journal | null };
}

export function moneybird(md: string | null): BooksData["synced"]["moneybird"] {
  const m = /all (\d+) purchase invoices in Moneybird equal Purser's ledger to the cent:\s*(\d+) differences/.exec((md ?? "").replace(/\s+/g, " "));
  return m ? { invoices: Number(m[1]), differences: Number(m[2]) } : null;
}

/** The bank balance after each entry, from the file; the first is the opening balance, the others named by their entry. */
export function cashPoints(f: BooksStatementFile | null): CashPoint[] {
  return (f?.cash ?? []).map((c, i) => ({ day: c.day, cents: c.balance_cents, label: i === 0 ? "Opening balance" : c.what.split(/[:·]/)[0]!.trim() }));
}

export function booksOf(json: string | null, md: { moneybird: string | null; t0: string | null }): BooksData {
  let file: BooksStatementFile | null;
  try { file = json ? (JSON.parse(json) as BooksStatementFile) : null; } catch { file = null; }
  const view = file ? statementView(file) : null;
  return {
    file, view: view && view.balances ? view : null, cash: cashPoints(file),
    folders: (file?.sorted.rows ?? []).filter((r) => r.path.length === 5).map((r) => ({ path: r.path, supplier: r.supplier ?? r.path[3]! })),
    synced: { moneybird: moneybird(md.moneybird), t0: t0Journal(md.t0) },
  };
}
export const booksData = (): BooksData => booksOf(read(STATEMENT_FILE), { moneybird: read(MONEYBIRD_RECORD), t0: read(T0_JOURNAL_RECORD) });

export const BOOKS_CSS = `.bkp .wrap { gap: 16px; }
.bkp .wrap > * { animation: bk-in .5s cubic-bezier(.2,.7,.2,1) both; }
.bkp .wrap > :nth-child(2) { animation-delay: .06s; } .bkp .wrap > :nth-child(3) { animation-delay: .12s; } .bkp .wrap > :nth-child(4) { animation-delay: .18s; }
.bkp .wrap > :nth-child(5) { animation-delay: .24s; } .bkp .wrap > :nth-child(n+6) { animation-delay: .3s; }
@keyframes bk-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.bk-hd { display: flex; gap: 16px; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; }
.bk-hd h1 { margin: 6px 0 4px; }
.bk-hd .line { margin: 0; }
.bk-acts { display: flex; gap: 10px; flex-wrap: wrap; }
.bk-kpi { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.bk-kpi li { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px; display: grid; gap: 4px; }
.bk-kpi small { color: var(--muted); font-size: 13px; font-weight: 600; }
.bk-kpi b { font-size: 25px; line-height: 1.15; font-weight: 750; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bk-kpi b .cur { font-size: 14px; font-weight: 600; color: var(--muted); margin-right: 4px; }
.bk-kpi .hint { color: var(--muted); font-size: 12.5px; }
.bk-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.bk-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 18px 20px; display: grid; gap: 10px; min-width: 0; }
.bk-card h2 { font-size: 17px; line-height: 1.3; margin: 0; display: flex; gap: 8px; align-items: center; }
.bk-card h2 .tag, .bk-tag { margin-left: auto; font-size: 12px; font-weight: 650; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
.bk-card .sub { margin: 0; color: var(--muted); font-size: 14px; }
table.bk-st { width: 100%; border-collapse: collapse; font-size: 14.5px; font-variant-numeric: tabular-nums; }
table.bk-st td { padding: 6px 0; border-top: 1px solid var(--border); }
table.bk-st td.r { text-align: right; white-space: nowrap; padding-left: 12px; }
table.bk-st tr.grp td { border-top: 0; padding: 12px 0 2px; font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
table.bk-st tr.ln td:first-child { padding-left: 12px; }
table.bk-st tr.sub td { font-weight: 650; border-top: 1px solid var(--text); }
table.bk-st tr.tot td { font-weight: 800; border-top: 3px double var(--text); }
.bk-ok { margin: 0; display: flex; gap: 6px; align-items: center; color: var(--ok); font-weight: 700; font-size: 14px; }
.bk-chart { width: 100%; height: auto; display: block; overflow: visible; }
.bk-chart .grid { stroke: var(--border); stroke-width: 1; }
.bk-chart .ax { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.bk-chart .val { fill: var(--text); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.bk-chart .area { fill: var(--accent-soft); }
.bk-chart .ln { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 0; animation: bk-draw 1.1s .3s ease-out both; }
.bk-chart .pt { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
.bk-bar .bar { fill: var(--accent); transform-box: fill-box; transform-origin: left center; animation: bk-grow .8s cubic-bezier(.2,.7,.2,1) both; }
.bk-bar .bar.b2 { animation-delay: .08s; } .bk-bar .bar.b3 { animation-delay: .16s; } .bk-bar .bar.b4 { animation-delay: .24s; }
.bk-chart g.hit:hover .pt { opacity: .8; }
@keyframes bk-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes bk-grow { from { transform: scaleX(0); } to { transform: none; } }
ul.bk-bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
ul.bk-bars li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px 10px; align-items: baseline; font-size: 14px; }
ul.bk-bars b { font-variant-numeric: tabular-nums; font-weight: 700; }
ul.bk-bars .pc { color: var(--muted); font-size: 12.5px; min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
ul.bk-bars svg.bk-bar { grid-column: 1 / -1; display: block; height: 10px; width: 100%; border-radius: 5px; overflow: hidden; background: var(--sunken); }
.bk-pts { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 13px; color: var(--muted); }
.bk-pts b { color: var(--text); font-variant-numeric: tabular-nums; font-weight: 650; }
ul.bk-inv { list-style: none; margin: 0; padding: 0; }
ul.bk-inv > li { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 4px 16px; padding: 14px 0; border-top: 1px solid var(--border); }
ul.bk-inv > li:first-child { border-top: 0; padding-top: 4px; }
.bk-inv .d { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.bk-inv .who { font-weight: 700; }
.bk-inv .no { color: var(--muted); font-weight: 400; font-size: 13px; margin-left: 6px; }
.bk-inv .amt { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bk-inv .bk-b { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.bk-inv .chip { font-size: 12px; border-radius: 999px; padding: 2px 9px; border: 1px solid var(--border); background: var(--surface); }
.bk-inv .chip.ai { background: var(--claude-soft); color: var(--claude); border-color: transparent; font-weight: 700; display: inline-flex; gap: 4px; align-items: center; }
.bk-inv .why { grid-column: 2 / -1; margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.45; }
.bk-inv .why b { color: var(--text); font-weight: 650; }
.bk-pdf { display: flex; gap: 14px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.bk-pdf .ic { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.bk-pdf .t { display: flex; gap: 12px; align-items: center; min-width: 0; }
.bk-pdf .t span { display: grid; gap: 2px; } .bk-pdf .t small { color: var(--muted); font-size: 13px; }
ul.bk-sync { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
ul.bk-sync li { display: flex; gap: 10px; align-items: center; font-size: 14.5px; overflow-wrap: anywhere; }
.bk-sync .lg { flex: none; min-width: 84px; text-align: center; font-weight: 800; font-size: 13px; border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; }
a.bk-rec { font-size: 13px; white-space: nowrap; }
ul.bk-codes { margin: 0; padding-left: 18px; font-size: 13.5px; }
.bk-tree { margin: 0; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
table.bk-t0 { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
table.bk-t0 td, table.bk-t0 th { padding: 4px 0; border-top: 1px solid var(--border); text-align: right; }
table.bk-t0 td:first-child, table.bk-t0 th:first-child { text-align: left; }
@media (max-width: 860px) { .bk-two { grid-template-columns: 1fr; } .bk-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) {
  .bk-card { padding: 14px 14px; } .bk-kpi b { font-size: 21px; }
  ul.bk-inv > li { grid-template-columns: minmax(0, 1fr) auto; } .bk-inv .d { grid-column: 1 / -1; order: -1; } .bk-inv .bk-b, .bk-inv .why { grid-column: 1 / -1; }
  .bk-acts { width: 100%; } .bk-acts .btn { flex: 1 1 auto; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .bkp .wrap > *, .bk-chart .ln, .bk-bar .bar { animation: none; } }`;

const rec = (file: string, label = "record") => `<a class="bk-rec" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const tr = (cls: string, name: string, cents: number | null) => `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(name)}</td><td class="r">${cents === null ? "" : esc(money(cents))}</td></tr>`;
const lines = (xs: StatementLine[]) => xs.map((x) => tr("ln", x.name, x.cents)).join("");
const gb = (cents: number) => (cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A key figure; the HTML holds the final value, the script counts up to it (src/redesign/stats.ts COUNT_JS). */
const kpi = (label: string, cents: number, cur: string, hint: string) => `<li><small>${esc(label)}</small><b><span class="cur">${esc(cur)}</span><span data-count="${cents / 100}" data-dec="2">${esc(gb(cents))}</span></b><span class="hint">${esc(hint)}</span></li>`;

function statementCards(v: StatementView): string {
  const balance = `<section class="bk-card" aria-labelledby="bk-bs"><h2 id="bk-bs">${icon("database", 19)}${esc("Balance sheet")}<span class="tag">${esc(`at ${dayShort(v.asOf)} · ${v.currency}`)}</span></h2>
<table class="bk-st"><tbody>
${tr("grp", "Assets", null)}${lines(v.assets)}${tr("sub", "Total assets", v.totalAssets)}
${tr("grp", "Liabilities", null)}${lines(v.liabilities)}${tr("sub", "Total liabilities", v.totalLiabilities)}
${tr("grp", "Equity", null)}${lines(v.equity)}${tr("ln", "Result this year", v.result)}${tr("sub", "Total equity", v.totalEquity)}
${tr("tot", "Total liabilities and equity", v.totalLiabilities + v.totalEquity)}</tbody></table>
<p class="bk-ok">${icon("check", 17)}${esc(`Balances: ${money(v.totalAssets)} = ${money(v.totalLiabilities + v.totalEquity)}`)}</p></section>`;
  const pnl = `<section class="bk-card" aria-labelledby="bk-pl"><h2 id="bk-pl">${icon("trending-up", 19)}${esc("Profit and loss")}<span class="tag">${esc(`2026 · ${v.currency}`)}</span></h2>
<table class="bk-st"><tbody>
${tr("", "Revenue", v.revenue)}${tr("grp", "Expenses", null)}${lines(v.expenses)}${tr("sub", "Total expenses", v.totalExpenses)}
${tr("tot", "Result", v.revenue - v.totalExpenses)}</tbody></table>
<p class="sub">${esc("No sales yet: the test company has only bought. The result is its costs so far.")}</p></section>`;
  return `<div class="bk-two">${balance}${pnl}</div>`;
}

/** The bank balance after each entry, as a step line: one series, one axis, a dot and a tooltip per entry. */
export function cashChart(points: CashPoint[], currency: string): string {
  if (points.length < 2) return "";
  const W = 380, H = 170, L = 44, R = 368, T = 22, B = 138;
  const vals = points.map((p) => p.cents), lo0 = Math.min(...vals), hi0 = Math.max(...vals);
  const pad = Math.max(100, Math.round((hi0 - lo0) * 0.35));
  const lo = Math.floor((lo0 - pad) / 1000) * 1000, hi = Math.ceil((hi0 + pad) / 1000) * 1000;
  const x = (i: number) => L + ((R - L) * i) / (points.length - 1), y = (c: number) => B - ((B - T) * (c - lo)) / (hi - lo);
  let d = `M${x(0)} ${y(points[0]!.cents).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(i)} V${y(points[i]!.cents).toFixed(1)}`;
  const area = `${d} V${B} H${x(0)} Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const grid = ticks.map((t) => `<line class="grid" x1="${L}" x2="${R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(money(Math.round(t)).replace(/\.00$/, ""))}</text>`).join("");
  const dots = points.map((p, i) => `<g class="hit"><title>${esc(`${dayShort(p.day)} · ${p.label} · ${currency} ${money(p.cents)}`)}</title><rect x="${x(i) - 18}" y="${T}" width="36" height="${B - T}" fill="transparent"/><circle class="pt" cx="${x(i)}" cy="${y(p.cents).toFixed(1)}" r="5"/></g>`).join("");
  const last = points.at(-1)!, first = points[0]!;
  const vals2 = `<text class="val" x="${x(0) + 8}" y="${(y(first.cents) - 9).toFixed(1)}">${esc(money(first.cents))}</text><text class="val" x="${x(points.length - 1)}" y="${(y(last.cents) - 10).toFixed(1)}" text-anchor="end">${esc(money(last.cents))}</text>`;
  const xs = points.map((p, i) => `<text class="ax" x="${x(i)}" y="${B + 18}" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${esc(dayShort(p.day))}</text>`).join("");
  return `<svg class="bk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Cash at bank after each entry, ${currency}: ${points.map((p) => `${p.label} ${money(p.cents)}`).join(", ")}`)}">${grid}<path class="area" d="${area}"/><path class="ln" d="${d}" pathLength="1"/>${dots}${vals2}${xs}</svg>`;
}

/** Spend by category: the P&L's expense accounts, largest first; names and amounts as text, each bar a small SVG on a shared track. */
export function spendChart(expenses: StatementLine[], total: number): string {
  const rows = [...expenses].filter((e) => e.cents > 0).sort((a, b) => b.cents - a.cents);
  if (!rows.length || total <= 0) return "";
  const max = rows[0]!.cents;
  return `<ul class="bk-bars" role="list">${rows.map((r, i) => `<li title="${esc(`${r.name}: ${money(r.cents)} (${Math.round((100 * r.cents) / total)}% of expenses)`)}"><span class="n">${esc(r.name)}</span><b>${esc(money(r.cents))}</b><span class="pc">${esc(`${Math.round((100 * r.cents) / total)}%`)}</span>
<svg class="bk-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="bar b${i + 1}" x="0" y="0" width="${Math.max(1, (100 * r.cents) / max).toFixed(2)}" height="10"/></svg></li>`).join("")}</ul>`;
}

function chartCards(d: BooksData, v: StatementView): string {
  const cash = cashChart(d.cash, v.currency), spend = spendChart(v.expenses, v.totalExpenses);
  if (!cash && !spend) return "";
  const cashCard = cash ? `<section class="bk-card" aria-labelledby="bk-cash"><h2 id="bk-cash">${icon("coins", 19)}${esc("Cash at bank")}<span class="tag">${esc(`after each entry · ${v.currency}`)}</span></h2>${cash}
<ul class="bk-pts">${d.cash.map((p) => `<li>${esc(`${dayShort(p.day)} · ${p.label}: `)}<b>${esc(money(p.cents))}</b></li>`).join("")}</ul></section>` : "";
  const spendCard = spend ? `<section class="bk-card" aria-labelledby="bk-sp"><h2 id="bk-sp">${icon("package", 19)}${esc("Spend by category")}<span class="tag">${esc(`2026 · ${v.currency}`)}</span></h2>${spend}
<p class="sub">${esc(`Total expenses ${money(v.totalExpenses)}, from the P&L.`)}</p></section>` : "";
  return `<div class="bk-two">${cashCard}${spendCard}</div>`;
}

function invoicesCard(v: StatementView, f: BooksStatementFile): string {
  if (!v.sorted.length) return "";
  const model = f.sorted.rows[0]?.model ?? "";
  const rows = v.sorted.map((s) => {
    const [acct, vat, cc] = s.booking.split("  ·  ");
    return `<li><span class="d">${esc(dayShort(s.date))}</span><span class="who">${esc(s.supplier)}<span class="no">${esc(s.number)}</span></span><span class="amt">${esc(`${s.currency} ${s.total}`)}</span>
<span class="bk-b"><span class="chip ai">${icon("sparkles", 13)}${esc("Sorted by Claude")}</span>${[acct, vat, cc].filter(Boolean).map((c) => `<span class="chip">${esc(c!)}</span>`).join("")}</span>
<p class="why"><b>${esc("Why: ")}</b>${esc(s.reason)}</p></li>`;
  }).join("");
  return `<section class="bk-card" aria-labelledby="bk-inv"><h2 id="bk-inv">${icon("sparkles", 19)}${esc("Invoices, sorted by Claude")}<span class="tag">${esc(`${v.sorted.length} test invoices`)}</span></h2>
<p class="sub">${esc(`The Coder agent (${model}) chose account, VAT code and cost centre for each; all three right in the ${f.sorted.ran_at.slice(0, 10)} eval. Code checks every choice before it is booked.`)} ${rec(CODER_EVAL, "eval")}</p>
<ul class="bk-inv">${rows}</ul></section>`;
}

function pdfCard(f: BooksStatementFile): string {
  return `<section class="bk-card bk-pdf" aria-label="${esc("Download")}"><span class="t"><span class="ic">${icon("file-text", 22)}</span><span><b>${esc("Balance sheet, P&L and sorted invoices")}</b><small>${esc("PDF · test company · test money")}</small></span></span>
<a class="btn primary" href="assets/${esc(f.pdf)}" download>${icon("download", 18)}${esc("Download PDF")}</a></section>`;
}

function detailsCard(d: BooksData): string {
  const t = d.synced.t0, m = d.synced.moneybird, f = d.file!;
  const sync = [
    m ? `<li><span class="lg">Moneybird</span><span>${esc(`Sandbox: ${m.invoices} purchase invoices equal to the cent, ${m.differences} differences.`)} ${rec(MONEYBIRD_RECORD)}</span></li>` : "",
    t ? `<li><span class="lg">T:0</span><span>${esc(`Sandbox: the 3 Nov books, ${t.posted} journal entries, ${t.differences} differences.`)} ${rec(T0_JOURNAL_RECORD)}</span></li>` : "",
  ].join("");
  const codes = [...f.balance[0]!.accounts, ...(f.pnl[0]?.accounts ?? [])].map((a) => `<li>${esc(`${a.account} ${a.name}`)}</li>`).join("");
  const tree = d.folders.map((x) => x.path.join(" / ")).join("\n");
  const journal = t && t.accounts.length ? `<details class="fold"><summary>${esc("The 3 Nov books in T:0, per account (USD, test money)")}</summary><table class="bk-t0"><thead><tr><th>${esc("Account")}</th><th>${esc("Ours, net debit")}</th><th>T:0</th></tr></thead><tbody>${t.accounts.map((a) => `<tr><td>${esc(a.account)}</td><td>${esc(a.ours)}</td><td>${esc(a.t0)}</td></tr>`).join("")}</tbody></table></details>` : "";
  return `<section class="bk-card" aria-labelledby="bk-sy"><h2 id="bk-sy">${icon("check", 19)}${esc("Synced to outside books")}</h2>${sync ? `<ul class="bk-sync">${sync}</ul>` : ""}
<details class="fold"><summary>${esc("Account codes")}</summary><ul class="bk-codes">${codes}</ul></details>
${tree ? `<details class="fold"><summary>${esc("Where the sorted invoices are filed")}</summary><pre class="bk-tree">${esc(tree)}</pre></details>` : ""}
${journal}</section>`;
}

/** The body: header and key figures, the statements, the charts, the invoices Claude sorted, the PDF, the details. */
export function booksBody(d: BooksData): string {
  const v = d.view, f = d.file;
  const head = `<div class="bk-hd"><div><span class="pill run">${esc("Test company · test money")}</span><h1>${esc("Books")}</h1>
<p class="line">${esc(v ? `${v.company}: the books Purser's agents kept, 2026 to ${dayShort(v.asOf)}, checked to the cent against the run's record.` : "The books Purser's agents keep.")}</p></div>
<div class="bk-acts">${v && f ? `<a class="btn primary" href="assets/${esc(f.pdf)}" download>${icon("download", 18)}${esc("Download PDF")}</a>` : ""}<a class="btn" href="${esc(BOOKS_LIVE_URL)}">${esc("See it happen live")}${icon("arrow-right", 18)}</a></div></div>`;
  if (!v || !f) return `<main class="pp bkp"><div class="wrap">${head}<a class="open" href="proof">All the proof</a></div></main>`;
  const cash = v.assets.find((a) => a.name === "Cash at bank");
  const kpis = `<ul class="bk-kpi">${[
    cash ? kpi("Cash at bank", cash.cents, v.currency, `at ${dayShort(v.asOf)}`) : "",
    kpi("Total assets", v.totalAssets, v.currency, "balance sheet"),
    kpi("Expenses", v.totalExpenses, v.currency, "2026 so far"),
    kpi("Result", v.revenue - v.totalExpenses, v.currency, "2026 so far"),
  ].join("")}</ul>`;
  return `<main class="pp bkp"><div class="wrap">
  ${head}
  ${kpis}
  ${statementCards(v)}
  ${chartCards(d, v)}
  ${invoicesCard(v, f)}
  ${pdfCard(f)}
  ${detailsCard(d)}
  <a class="open" href="proof">All the proof</a>
</div></main>`;
}
