// /books (owner, 13 Nov; merged with /t0 on 21 Nov, the owner: "the books page, with T:0 in it, explained well with
// visuals, architecture and animations"; /t0 answers 301 here). A month of a test company's books, read from one run
// record, docs/runs/2026-11-13-books-month.json, which npm run books:month writes (scripts/books-month.ts: twenty supplier
// invoices through the hands-on demo's engine on its simulated bank, each read and booked by Claude live, each approved
// with the CFO's test passkey). Top to bottom:
//   1. The heading and the PDF (the same record, the same view: src/vault/statementPdf.ts), then four key figures.
//   2. The balance sheet (assets, liabilities, equity, the balance check computed here) beside the P&L.
//   3. "Change one cent" (./booksLedger.ts): the same balance sheet, one line changed by a cent in the browser, the checks red.
//   4. How a payment reaches the books: rail → PURPAY- journal entry in T:0 at payment time → reconcile (./booksLedger.ts,
//      the partner-rails run of 20 Nov), then T:0's section with its independent close check (./t0Page.ts).
//   5. Two small charts, the invoices Claude sorted, and the details folded.
// A record that is missing or does not balance leaves its block out; nothing here is typed in as a figure.
import { readFileSync } from "node:fs";
import { COUNT_JS } from "./stats.js";
import { DEMO_JS, LEDGER_CSS, demoHtml } from "./booksLedger.js";
import { REPO_BLOB } from "./metalStory.js";
import { T0_JOURNAL_RECORD, t0Journal, type T0Journal } from "./t0Page.js";
import { countOf, esc, icon } from "./ui.js";
import { inBaseCurrency, statementView, type BooksStatementFile, type StatementLine, type StatementView } from "../vault/statementPdf.js";

import { centsOf, REVERSE_CHARGE_LINE } from "../vault/statementPdf.js";
export { centsOf, plainName } from "../vault/statementPdf.js";
/** The run record /books is drawn from (npm run books:month). */
export const RUN_FILE = "docs/runs/2026-11-13-books-month.json";
export const MONEYBIRD_RECORD = "docs/runs/2026-11-12-moneybird-sandbox.md";
/** The hands-on demo, whose end screen shows the books of the visitor's own invoice. */
export const BOOKS_LIVE_URL = "https://purser-try.max-31b.workers.dev/try";
/** The page's own script: the key figures count up once (src/redesign/stats.ts), and the one-cent demo. */
export const BOOKS_JS = `${COUNT_JS}\n${DEMO_JS}`;

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

/** 1234.5 → "1,234.50", with a true minus sign. */
export const money = (cents: number): string => { const a = Math.abs(cents); return `${cents < 0 ? "−" : ""}${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`; };
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export interface CashPoint { day: string; label: string; cents: number }
/** What the run record holds beside the books: each invoice's outcome, and Claude's part. */
export interface RunInvoice { id: string; supplier: string; number: string; currency: string; total: string; status: string; findings: { level: string; code: string }[]; payment: { invoice_status: string | null; transfer: { status: string } | null } | null }
export interface RunRecord { company: string; run_day: string; started_at: string; claude: { on: boolean; spent_micros: number; caps: { cap_company_micros: number }; stopped: string | null }; invoices: RunInvoice[]; checks: { paid: number; invoices: number; coded_by_claude: number; balanced: boolean }; books: BooksStatementFile }
export interface BooksData {
  run: RunRecord | null; file: BooksStatementFile | null; view: StatementView | null; cash: CashPoint[];
  folders: { path: string[]; supplier: string }[];
  synced: { moneybird: { invoices: number; differences: number } | null; t0: T0Journal | null };
}

export function moneybird(md: string | null): BooksData["synced"]["moneybird"] {
  const m = /all (\d+) purchase invoices in Moneybird equal Purser's ledger to the cent:\s*(\d+) differences/.exec((md ?? "").replace(/\s+/g, " "));
  return m ? { invoices: Number(m[1]), differences: Number(m[2]) } : null;
}

/** The bank balance after each entry, from the file; the first is the opening balance, the others named by their entry. */
export function cashPoints(f: BooksStatementFile | null): CashPoint[] {
  return (f?.cash ?? []).map((c, i) => ({ day: c.day, cents: c.balance_cents, label: i === 0 ? "Opening balance" : (c.what.split(" · ")[1] ?? c.what).trim() }));
}

export function booksOf(json: string | null, md: { moneybird: string | null; t0: string | null }): BooksData {
  let run: RunRecord | null;
  try { run = json ? (JSON.parse(json) as RunRecord) : null; } catch { run = null; }
  const file = run?.books ?? null;
  const view = file ? statementView(file) : null;
  return {
    run, file, view: view && view.balances ? view : null, cash: cashPoints(file),
    folders: (file?.sorted.rows ?? []).filter((r) => r.path.length === 5).map((r) => ({ path: r.path, supplier: r.supplier ?? r.path[3]! })),
    synced: { moneybird: moneybird(md.moneybird), t0: t0Journal(md.t0) },
  };
}
export const booksData = (): BooksData => booksOf(read(RUN_FILE), { moneybird: read(MONEYBIRD_RECORD), t0: read(T0_JOURNAL_RECORD) });

export const BOOKS_CSS = `.bkp .wrap { gap: 16px; }
.bkp .wrap > * { animation: bk-in .5s cubic-bezier(.2,.7,.2,1) both; }
.bkp .wrap > :nth-child(2) { animation-delay: .06s; } .bkp .wrap > :nth-child(3) { animation-delay: .12s; } .bkp .wrap > :nth-child(4) { animation-delay: .18s; }
.bkp .wrap > :nth-child(5) { animation-delay: .24s; } .bkp .wrap > :nth-child(n+6) { animation-delay: .3s; }
@keyframes bk-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.bk-hd { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: end; }
.bk-hd-t { display: grid; gap: 8px; justify-items: start; min-width: 0; }
.bk-hd h1 { margin: 0; font-size: clamp(34px, 4.4vw, 54px); font-weight: 800; letter-spacing: -.035em; }
.bk-hd .line { margin: 0; max-width: 34em; }
.bk-acts { display: flex; gap: 10px; flex-wrap: wrap; }
.bk-doc { display: flex; gap: 16px; align-items: center; padding: 16px 18px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 10px 30px -18px rgba(15, 23, 42, .35); }
.bk-page { position: relative; width: 70px; height: 92px; flex: none; border-radius: 6px; background: #fff; border: 1px solid #d7dce5; box-shadow: 0 6px 14px -8px rgba(15, 23, 42, .45); display: grid; align-content: start; gap: 7px; padding: 14px 10px; transform: rotate(-4deg); }
.bk-page i { display: block; height: 4px; border-radius: 2px; background: #cfd6e2; } .bk-page i.s { width: 60%; }
.bk-page em { position: absolute; left: -6px; bottom: 10px; font: 800 11px/1 system-ui, sans-serif; font-style: normal; color: #fff; background: #d92d20; border-radius: 4px; padding: 4px 6px; letter-spacing: .04em; }
.bk-doc-t { display: grid; gap: 4px; justify-items: start; }
.bk-doc-t b { font-size: 16px; } .bk-doc-t small { color: var(--muted); font-size: 13.5px; } .bk-doc-t .btn { margin-top: 6px; }
@media (prefers-reduced-motion: no-preference) { .bk-page { animation: bk-doc 1s .4s cubic-bezier(.2,.7,.2,1) both; } }
@keyframes bk-doc { from { transform: rotate(-12deg) translateY(8px); opacity: 0; } to { transform: rotate(-4deg); opacity: 1; } }
.bk-folds { padding: 6px 20px 10px; gap: 0; }
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
table.bk-st tr.grp td { border-top: 0; padding: 12px 0 2px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
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
.bk-more > ul.bk-inv > li:first-child { border-top: 1px solid var(--border); padding-top: 14px; }
.bk-inv .chip.ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; font-weight: 700; display: inline-flex; gap: 4px; align-items: center; }
.bk-inv .chip.wait { background: var(--sunken); color: var(--text); font-weight: 650; }
.bk-kpi b .of { margin: 0 0 0 4px; }
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
a.bk-rec { font-size: 13px; white-space: nowrap; display: inline-flex; align-items: center; min-height: 24px; vertical-align: middle; }
ul.bk-codes { margin: 0; padding-left: 18px; font-size: 13.5px; }
.bk-tree { margin: 0; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
table.bk-t0 { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
table.bk-t0 td, table.bk-t0 th { padding: 4px 0; border-top: 1px solid var(--border); text-align: right; }
table.bk-t0 td:first-child, table.bk-t0 th:first-child { text-align: left; }
@media (max-width: 860px) { .bk-two { grid-template-columns: 1fr; } .bk-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bk-hd { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) {
  .bk-card { padding: 14px 14px; } .bk-kpi b { font-size: 21px; }
  ul.bk-inv > li { grid-template-columns: minmax(0, 1fr) auto; } .bk-inv .d { grid-column: 1 / -1; order: -1; } .bk-inv .bk-b, .bk-inv .why { grid-column: 1 / -1; }
  .bk-acts { width: 100%; } .bk-acts .btn { flex: 1 1 auto; justify-content: center; }
  .bk-doc { padding: 14px; gap: 14px; } .bk-page { width: 56px; height: 74px; padding: 10px 8px; gap: 5px; }
  .bkp a.bk-rec, .bkp a.bl-rec, .bkp a.pf, .bkp a.open { min-height: 44px; display: inline-flex; align-items: center; vertical-align: middle; }
}
@media (prefers-reduced-motion: reduce) { .bkp .wrap > *, .bk-chart .ln, .bk-bar .bar { animation: none; } }
${LEDGER_CSS}`;

const rec = (file: string, label = "record") => `<a class="bk-rec" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const tr = (cls: string, name: string, cents: number | null) => `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(name)}</td><td class="r">${cents === null ? "" : esc(money(cents))}</td></tr>`;
const lines = (xs: StatementLine[]) => xs.map((x) => tr("ln", x.name, x.cents)).join("");
const gb = (cents: number) => (cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A key figure; the HTML holds the final value, the script counts up to it (src/redesign/stats.ts COUNT_JS). */
const kpi = (label: string, cents: number, cur: string, hint: string) => `<li><small>${esc(label)}</small><b><span class="cur">${esc(cur)}\u00a0</span><span data-count="${cents / 100}" data-dec="2">${esc(gb(cents))}</span></b><span class="hint">${esc(hint)}</span></li>`;
const kpiCount = (label: string, n: number, of: number, hint: string) => `<li><small>${esc(label)}</small><b><span data-count="${n}" data-dec="0">${esc(String(n))}</span><span class="cur of">${esc(` of ${of}`)}</span></b><span class="hint">${esc(hint)}</span></li>`;
/** Plain words for why an invoice waits for a person: the Checker's own finding codes. */
const WAIT_WORDS: Record<string, string> = { country_not_paid: "Purser does not pay to this country: a person pays it", currency_not_paid: "Purser does not pay this currency: a person pays it" };

/** The ledger's other currencies, each balancing on its own: what is in them, from the record. */
export function otherCurrencies(f: BooksStatementFile): string {
  const out = f.balance.slice(1).map((b) => {
    const p = f.pnl.find((x) => x.currency === b.currency);
    const exp = p && centsOf(p.expense) ? `expenses ${b.currency} ${money(centsOf(p.expense)!)}` : "";
    const bank = b.accounts.filter((a) => a.type === "asset" && /^Bank/.test(a.name)).map((a) => `bank ${b.currency} ${money(centsOf(a.amount) ?? 0)}`).join("");
    return `${b.currency} (${[exp, bank].filter(Boolean).join(", ") || "no balance"})`;
  });
  return out.length ? `The ledger also keeps ${out.join(" and ")}; each currency balances on its own and is not converted here.` : "";
}

function statementCards(v: StatementView, f: BooksStatementFile): string {
  // A currency translated into the statement's own (inBaseCurrency) is not listed again as kept apart.
  const others = otherCurrencies(inBaseCurrency(f).file);
  const balance = `<section class="bk-card" aria-labelledby="bk-bs"><h2 id="bk-bs">${icon("database", 19)}${esc("Balance sheet")}<span class="tag">${esc(`at ${dayShort(v.asOf)} · ${v.currency}`)}</span></h2>
<table class="bk-st"><tbody>
${tr("grp", "Assets", null)}${lines(v.assets)}${tr("sub", "Total assets", v.totalAssets)}
${tr("grp", "Liabilities", null)}${lines(v.liabilities)}${tr("sub", "Total liabilities", v.totalLiabilities)}
${tr("grp", "Equity", null)}${lines(v.equity)}${tr("ln", "Result this year", v.result)}${tr("sub", "Total equity", v.totalEquity)}
${tr("tot", "Total liabilities and equity", v.totalLiabilities + v.totalEquity)}</tbody></table>
<p class="bk-ok">${icon("check", 17)}${esc(`Balances: ${money(v.totalAssets)} = ${money(v.totalLiabilities + v.totalEquity)}`)}</p>${v.reverseCharge ? `<p class="sub">${esc(REVERSE_CHARGE_LINE)}</p>` : ""}${v.translated ? `<p class="sub">${esc(v.translated)}</p>` : ""}${others ? `<p class="sub">${esc(others)}</p>` : ""}</section>`;
  const pnl = `<section class="bk-card" aria-labelledby="bk-pl"><h2 id="bk-pl">${icon("trending-up", 19)}${esc("Profit and loss")}<span class="tag">${esc(`2026 · ${v.currency}`)}</span></h2>
<table class="bk-st"><tbody>
${tr("", "Revenue", v.revenue)}${tr("grp", "Expenses", null)}${lines(v.expenses)}${tr("sub", "Total expenses", v.totalExpenses)}
${tr("tot", "Result", v.revenue - v.totalExpenses)}</tbody></table>
<p class="sub">${esc("No sales in the run: the test company only bought. Bank fees are the simulated bank's.")}</p></section>`;
  return `<div class="bk-two">${balance}${pnl}</div>`;
}

/** The bank balance after each entry, as a step line: one series, one axis, a dot and a tooltip per entry. */
export function cashChart(points: CashPoint[], currency: string): string {
  if (points.length < 2) return "";
  const W = 380, H = 170, L = 44, R = 368, T = 22, B = 138;
  const vals = points.map((p) => p.cents), lo0 = Math.min(...vals), hi0 = Math.max(...vals);
  // Round ticks: the axis runs from a round figure below the lowest point to one above the highest, in steps of 1, 2 or 5.
  const span = Math.max(100, hi0 - lo0), raw = span / 2, mag = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].map((k) => k * mag).find((u) => u >= raw) ?? 10 * mag;
  const lo = Math.floor(lo0 / unit) * unit - (lo0 % unit === 0 ? unit : 0), hi = Math.ceil(hi0 / unit) * unit + (hi0 % unit === 0 ? unit / 2 : 0);
  const x = (i: number) => L + ((R - L) * i) / (points.length - 1), y = (c: number) => B - ((B - T) * (c - lo)) / (hi - lo);
  let d = `M${x(0)} ${y(points[0]!.cents).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` H${x(i)} V${y(points[i]!.cents).toFixed(1)}`;
  const area = `${d} V${B} H${x(0)} Z`;
  const ticks = Array.from({ length: Math.floor((hi - lo) / unit) + 1 }, (_, k) => lo + k * unit);
  const grid = ticks.map((t) => `<line class="grid" x1="${L}" x2="${R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(money(Math.round(t)).replace(/\.00$/, ""))}</text>`).join("");
  const dots = points.map((p, i) => `<g class="hit"><title>${esc(`${dayShort(p.day)} · ${p.label} · ${currency} ${money(p.cents)}`)}</title><rect x="${x(i) - 18}" y="${T}" width="36" height="${B - T}" fill="transparent"/><circle class="pt" cx="${x(i)}" cy="${y(p.cents).toFixed(1)}" r="${points.length > 8 ? 3.5 : 5}"/></g>`).join("");
  const last = points.at(-1)!, first = points[0]!;
  const vals2 = `<text class="val" x="${x(0) + 8}" y="${(y(first.cents) - 9).toFixed(1)}">${esc(money(first.cents))}</text><text class="val" x="${x(points.length - 1)}" y="${(last.cents < first.cents ? y(last.cents) + 18 : y(last.cents) - 10).toFixed(1)}" text-anchor="end">${esc(money(last.cents))}</text>`;
  const xs = `<text class="ax" x="${x(0)}" y="${B + 18}" text-anchor="start">${esc("Opening")}</text><text class="ax" x="${x(points.length - 1)}" y="${B + 18}" text-anchor="end">${esc(`after ${points.length - 1} entries`)}</text>`;
  return `<svg class="bk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Cash at bank after each entry, ${currency}: ${points.map((p) => `${p.label} ${money(p.cents)}`).join(", ")}`)}">${grid}<path class="area" d="${area}"/><path class="ln" d="${d}" pathLength="1"/>${dots}${vals2}${xs}</svg>`;
}

/** Spend by category: the P&L's expense accounts, largest first; names and amounts as text, each bar a small SVG on a shared track. */
export function spendChart(expenses: StatementLine[], total: number): string {
  const rows = [...expenses].filter((e) => e.cents > 0).sort((a, b) => b.cents - a.cents);
  if (!rows.length || total <= 0) return "";
  const max = rows[0]!.cents;
  return `<ul class="bk-bars" role="list">${rows.map((r, i) => `<li title="${esc(`${r.name}: ${money(r.cents)} (${Math.round((100 * r.cents) / total)}% of expenses)`)}"><span class="n">${esc(r.name)}</span><b>${esc(money(r.cents))}</b><span class="pc">${esc((100 * r.cents) / total < 1 ? "<1%" : `${Math.round((100 * r.cents) / total)}%`)}</span>
<svg class="bk-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="bar b${i + 1}" x="0" y="0" width="${Math.max(1, (100 * r.cents) / max).toFixed(2)}" height="10"/></svg></li>`).join("")}</ul>`;
}

function chartCards(d: BooksData, v: StatementView): string {
  const cash = cashChart(d.cash, v.currency), spend = spendChart(v.expenses, v.totalExpenses);
  if (!cash && !spend) return "";
  const cashCard = cash ? `<section class="bk-card" aria-labelledby="bk-cash"><h2 id="bk-cash">${icon("coins", 19)}${esc("Cash at bank")}<span class="tag">${esc(`after each entry · ${v.currency}`)}</span></h2>${cash}
<details class="fold"><summary>${esc(`Every entry (${d.cash.length})`)}</summary><ul class="bk-pts">${d.cash.map((p) => `<li>${esc(`${dayShort(p.day)} · ${p.label}: `)}<b>${esc(money(p.cents))}</b></li>`).join("")}</ul></details></section>` : "";
  const spendCard = spend ? `<section class="bk-card" aria-labelledby="bk-sp"><h2 id="bk-sp">${icon("package", 19)}${esc("Spend by category")}<span class="tag">${esc(`2026 · ${v.currency}`)}</span></h2>${spend}
<p class="sub">${esc(`Total expenses ${money(v.totalExpenses)}, from the P&L.`)}</p></section>` : "";
  return `<div class="bk-two">${cashCard}${spendCard}</div>`;
}

function invoicesCard(d: BooksData, v: StatementView, f: BooksStatementFile): string {
  if (!v.sorted.length) return "";
  const model = f.sorted.rows[0]?.model ?? "";
  const byNo = new Map((d.run?.invoices ?? []).map((r) => [r.number, r]));
  const items = [...v.sorted].sort((a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier)).map((s) => {
    const [acct, vat, cc] = s.booking.split("  ·  ");
    const r = byNo.get(s.number);
    const paid = r?.payment?.invoice_status === "paid" || r?.status === "paid";
    const wait = r && !paid ? r.findings.map((x) => WAIT_WORDS[x.code]).find(Boolean) ?? "Waiting for a person" : "";
    const state = r ? (paid ? `<span class="chip ok">${icon("check", 13)}${esc("Paid")}</span>` : `<span class="chip wait" title="${esc(wait)}">${esc("Waiting")}</span>`) : "";
    return `<li><span class="d">${esc(dayShort(s.date))}</span><span class="who">${esc(s.supplier)}<span class="no">${esc(s.number)}</span></span><span class="amt">${esc(`${s.currency} ${s.total}`)}</span>
<span class="bk-b"><span class="chip ai">${icon("sparkles", 13)}${esc("Sorted by Claude")}</span>${[acct, vat, cc].filter(Boolean).map((c) => `<span class="chip">${esc(c!)}</span>`).join("")}${state}</span>
<p class="why"><b>${esc("Why: ")}</b>${esc(s.reason)}${wait ? ` <b>${esc(`${wait}.`)}</b>` : ""}</p></li>`;
  });
  // The first few in full; the rest one tap away, so the page stays readable on a phone.
  const SHOWN = 3;
  const rows = items.slice(0, SHOWN).join("");
  const more = items.length > SHOWN ? `<details class="fold bk-more"><summary>${esc(`All ${items.length} invoices`)}</summary><ul class="bk-inv">${items.slice(SHOWN).join("")}</ul></details>` : "";
  const run = d.run;
  return `<section class="bk-card" aria-labelledby="bk-inv"><h2 id="bk-inv">${icon("sparkles", 19)}${esc("Invoices, sorted by Claude")}<span class="tag">${esc(`${countOf(v.sorted.length, run?.checks.invoices ?? v.sorted.length)} invoices`)}</span></h2>
<p class="sub">${esc(`Claude (${model}) read each invoice and chose its account, VAT code and cost centre, live in this run; code checked every choice before it was booked.${run ? ` Claude's cost for the month: USD ${(run.claude.spent_micros / 1e6).toFixed(2)}.` : ""}`)} ${rec(RUN_FILE)}</p>
<ul class="bk-inv">${rows}</ul>${more}</section>`;
}

/** The PDF, in the header beside the heading: a drawn page, what is in it and the button (owner, 21 Nov: "a PDF"). */
function pdfTile(f: BooksStatementFile, v: StatementView): string {
  return `<div class="bk-doc"><span class="bk-page" aria-hidden="true"><i></i><i></i><i class="s"></i><i></i><i class="s"></i><em>PDF</em></span>
<span class="bk-doc-t"><b>${esc("Balance sheet, P&L, invoices")}</b><small>${esc(`${v.company.replace(/\s*\(test company\)$/, "")} · ${dayShort(v.asOf)} · test money`)}</small>
<a class="btn primary" href="assets/${esc(f.pdf)}" download>${icon("download", 18)}${esc("Download PDF")}</a></span></div>`;
}

/** The rest, folded: the Moneybird sync of an earlier run, the account codes and where the sorted invoices are filed. */
function detailsCard(d: BooksData): string {
  const m = d.synced.moneybird, f = d.file!;
  const codes = [...f.balance[0]!.accounts, ...(f.pnl[0]?.accounts ?? [])].map((a) => `<li>${esc(`${a.account} ${a.name}`)}</li>`).join("");
  const tree = d.folders.map((x) => x.path.join(" / ")).join("\n");
  return `<section class="bk-card bk-folds" aria-label="${esc("Details")}">
${m ? `<details class="fold"><summary>${esc("Moneybird, an earlier run")}</summary><p class="sub">${esc(`Sandbox: ${m.invoices} purchase invoices equal to the cent, ${m.differences} differences.`)} ${rec(MONEYBIRD_RECORD)}</p></details>` : ""}
<details class="fold"><summary>${esc("Account codes")}</summary><ul class="bk-codes">${codes}</ul></details>
${tree ? `<details class="fold"><summary>${esc("Where the sorted invoices are filed")}</summary><pre class="bk-tree">${esc(tree)}</pre></details>` : ""}</section>`;
}

/**
 * The body (owner, 21 Nov): the heading with the PDF; the key figures; the balance sheet and P&L; the one-cent demo;
 * how a payment reaches the books (rail → PURPAY- entry in T:0 → reconcile); T:0's section with its close check; the
 * charts; the invoices Claude sorted; the details folded.
 */
export function booksBody(d: BooksData, o: { rails?: string; t0?: string } = {}): string {
  const v = d.view, f = d.file;
  const head = `<div class="bk-hd"><div class="bk-hd-t"><span class="pill run">${esc("Test company · test money")}</span><h1>${esc("Books")}</h1>
<p class="line">${esc(v && d.run ? `${v.company.replace(/\s*\(test company\)$/, "")}: ${d.run.checks.invoices} supplier invoices sorted by Claude into the balance sheet, paid on a simulated bank.` : "The books Purser's agents keep.")}</p>
<div class="bk-acts"><a class="btn" href="#cent">${esc("Change one cent")}</a><a class="btn" href="#how">${esc("How it works")}</a></div></div>
${v && f ? pdfTile(f, v) : ""}</div>`;
  if (!v || !f) return `<main class="pp bkp"><div class="wrap">${head}${o.rails ?? ""}${o.t0 ?? ""}<a class="open" href="proof">All the proof</a></div></main>`;
  const cash = v.assets.find((a) => a.name === "Cash at bank");
  const owed = v.liabilities.find((a) => a.name === "Creditors");
  const kpis = `<ul class="bk-kpi">${[
    cash ? kpi("Cash at bank", cash.cents, v.currency, `at ${dayShort(v.asOf)}`) : "",
    d.run ? kpiCount("Invoices paid", d.run.checks.paid, d.run.checks.invoices, "approved with a test passkey") : "",
    kpi("Expenses", v.totalExpenses, v.currency, "invoices and fees"),
    owed ? kpi("Owed to suppliers", owed.cents, v.currency, "waiting for a person") : "",
  ].join("")}</ul>`;
  return `<main class="pp bkp"><div class="wrap">
  ${head}
  ${kpis}
  ${statementCards(v, f)}
  ${demoHtml(v)}
  ${o.rails ?? ""}
  ${o.t0 ?? ""}
  ${chartCards(d, v)}
  ${invoicesCard(d, v, f)}
  ${detailsCard(d)}
  <a class="open" href="proof">All the proof</a>
</div></main>`;
}
