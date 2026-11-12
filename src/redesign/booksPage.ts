// /books (owner, 12 Nov, second round): Purser's bookkeeping, readable, from the run records alone.
//   1. The balance sheet and P&L of the Moneybird sandbox run's test company, in plain account names, with the balance
//      check computed here; the account codes in a fold. Written by npm run books:statement (scripts/books-statement.ts),
//      which rebuilds the company's books with the run's own code and checks every invoice against the record first.
//   2. "Download PDF": the vault's own year report of those books (src/vault/pdf.ts), served as /assets/<name>.
//   3. "Invoices, sorted by Claude": the Coder agent's codings from the 12 November eval, each in its vault folder
//      (Year, Quarter, Purchase invoices, Supplier, file), with the account, VAT code and cost centre Claude chose.
//   4. Synced to Moneybird and T:0, one line each, and "See it happen live" on the hands-on demo.
//   5. The 3 November books in T:0, per account, in a fold.
// A file that is missing or changed leaves its block out; nothing here is typed in as a figure.
import { readFileSync } from "node:fs";
import { COST_CENTRE_NAMES } from "../config/gl.js";
import { LEDGER_ACCOUNTS } from "../ledger/accounts.js";
import { VAT_CODES } from "../ledger/vat.js";
import { REPO_BLOB } from "./metalStory.js";
import { T0_JOURNAL_RECORD, t0Journal, type T0Journal } from "./t0Page.js";
import { esc, icon } from "./ui.js";

export const STATEMENT_FILE = "docs/assets/books/statement-2026-11-12.json";
export const CODER_EVAL = "docs/evals/coder.json";
export const MONEYBIRD_RECORD = "docs/runs/2026-11-12-moneybird-sandbox.md";
export const LEDGER_AGENTS_RECORD = "docs/runs/2026-11-12-ledger-agents.md";
/** The hands-on demo, whose end screen shows the books of the visitor's own invoice. */
export const BOOKS_LIVE_URL = "https://purser-try.max-31b.workers.dev/try";

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

/** "977.59" or "-33.99" to cents; null when it is not an amount. */
export function centsOf(s: string): number | null {
  const m = /^(-?)([\d,]+)\.(\d{2})$/.exec(String(s).trim().replace(/−/g, "-"));
  return m ? (m[1] ? -1 : 1) * (Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3])) : null;
}
export const money = (cents: number): string => { const a = Math.abs(cents); return `${cents < 0 ? "−" : ""}${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`; };

/** The plain names the statement shows; every other account keeps its chart name (the codes are in the fold). */
const PLAIN: Record<string, string> = { "1200": "Bank", "1510": "VAT receivable", "2100": "Creditors", "3000": "Owner's equity" };
export const plainName = (account: string, name: string): string => PLAIN[account] ?? name.replace(/\s*\(.*\)$/, "");

export interface StatementFile {
  company: string; day: string; record: string; pdf: string; invoices_checked: number;
  balance: { currency: string; assets: string; liabilities: string; equity: string; result: string; balanced: boolean; accounts: { account: string; name: string; type: string; amount: string }[] }[];
  pnl: { currency: string; revenue: string; expense: string; result: string; accounts: { account: string; name: string; amount: string }[] }[];
  sorted: { eval: string; ran_at: string; rows: { case: string; model: string; path: string[]; account: string; vat: string | null; cost_centre: string | null }[] };
}

export interface Statement {
  company: string; day: string; currency: string; pdf: string; invoicesChecked: number;
  assets: { account: string; name: string; cents: number }[]; liabilities: { account: string; name: string; cents: number }[]; equity: { account: string; name: string; cents: number }[];
  result: number; totalAssets: number; totalLiabilities: number; totalEquity: number; balances: boolean;
  pnl: { account: string; name: string; cents: number }[]; revenue: number; expense: number;
  codes: { account: string; name: string }[];
}
/** The statement from the file; the balance check is recomputed here: assets = liabilities + equity + this year's result. */
export function statementOf(json: string | null): Statement | null {
  if (!json) return null;
  let f: StatementFile;
  try { f = JSON.parse(json) as StatementFile; } catch { return null; }
  const b = f.balance[0], p = f.pnl.find((x) => x.currency === b?.currency);
  if (!b || !p) return null;
  const rows = (type: string) => b.accounts.filter((a) => a.type === type).map((a) => ({ account: a.account, name: plainName(a.account, a.name), cents: centsOf(a.amount) ?? NaN }));
  const assets = rows("asset"), liabilities = rows("liability"), equity = rows("equity");
  const sum = (xs: { cents: number }[]) => xs.reduce((n, x) => n + x.cents, 0);
  const result = centsOf(b.result), revenue = centsOf(p.revenue), expense = centsOf(p.expense);
  if (result === null || revenue === null || expense === null || [...assets, ...liabilities, ...equity].some((x) => !Number.isFinite(x.cents))) return null;
  const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = sum(equity) + result;
  return {
    company: f.company, day: f.day, currency: b.currency, pdf: f.pdf, invoicesChecked: f.invoices_checked,
    assets, liabilities, equity, result, totalAssets, totalLiabilities, totalEquity,
    balances: b.balanced && totalAssets === totalLiabilities + totalEquity && result === revenue - expense,
    pnl: p.accounts.map((a) => ({ account: a.account, name: plainName(a.account, a.name), cents: centsOf(a.amount) ?? 0 })), revenue, expense,
    codes: [...b.accounts, ...p.accounts].map((a) => ({ account: a.account, name: a.name })),
  };
}

export interface SortedRow { path: string[]; account: string; accountName: string; vat: string; vatLabel: string; cc: string; ccName: string }
export function sortedOf(json: string | null): { ranAt: string; model: string; rows: SortedRow[] } | null {
  if (!json) return null;
  try {
    const f = JSON.parse(json) as StatementFile;
    const rows = f.sorted.rows.filter((r) => r.path.length === 5).map((r) => ({ path: r.path, account: r.account, accountName: (LEDGER_ACCOUNTS[r.account] ?? "").replace(/\s*\(.*\)$/, ""), vat: r.vat ?? "none", vatLabel: r.vat ? VAT_CODES[r.vat]?.label ?? "" : "", cc: r.cost_centre ?? "", ccName: r.cost_centre ? COST_CENTRE_NAMES[r.cost_centre] ?? "" : "" }));
    return rows.length ? { ranAt: f.sorted.ran_at.slice(0, 10), model: f.sorted.rows[0]!.model, rows } : null;
  } catch { return null; }
}

export interface Synced { moneybird: { invoices: number; differences: number } | null; t0: T0Journal | null }
export function moneybird(md: string | null): Synced["moneybird"] {
  const m = /all (\d+) purchase invoices in Moneybird equal Purser's ledger to the cent:\s*(\d+) differences/.exec((md ?? "").replace(/\s+/g, " "));
  return m ? { invoices: Number(m[1]), differences: Number(m[2]) } : null;
}

export interface BooksData { statement: Statement | null; sorted: ReturnType<typeof sortedOf>; synced: Synced }
export const booksData = (): BooksData => {
  const s = read(STATEMENT_FILE);
  return { statement: statementOf(s), sorted: sortedOf(s), synced: { moneybird: moneybird(read(MONEYBIRD_RECORD)), t0: t0Journal(read(T0_JOURNAL_RECORD)) } };
};
/** The PDF's file name, for the site's /assets map (src/servers/dashboard.ts); null without the statement. */
export const booksPdfName = (): string | null => { try { return (JSON.parse(read(STATEMENT_FILE) ?? "") as StatementFile).pdf; } catch { return null; } };

export const BOOKS_CSS = `.bk { padding: 16px 18px; display: grid; gap: 10px; }
.bk h2 { font-size: 19px; line-height: 1.25; margin: 0; display: flex; gap: 8px; align-items: center; }
.bk .sub { margin: 0; color: var(--muted); font-size: 14.5px; }
.bk .tag { font-size: 12px; font-weight: 650; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
.bk .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.bk h3 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
table.st { width: 100%; border-collapse: collapse; font-size: 15px; font-variant-numeric: tabular-nums; }
table.st td { padding: 5px 0; border-top: 1px solid var(--border); }
table.st td.r { text-align: right; white-space: nowrap; }
table.st tr.grp td { border-top: 0; padding-top: 10px; font-weight: 700; }
table.st tr.sub td { font-weight: 650; border-top: 1px solid var(--fg); }
table.st tr.tot td { font-weight: 800; border-top: 2px solid var(--fg); }
.bk .ok { color: var(--good, #157f3b); font-weight: 700; display: flex; gap: 6px; align-items: center; margin: 0; }
.bk .acts { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.tree { list-style: none; margin: 0; padding: 0; font-size: 14px; }
.tree ul { list-style: none; margin: 0; padding: 0 0 0 16px; border-left: 1px dashed var(--border); }
.tree li { padding: 3px 0; }
.tree .fo { font-weight: 650; display: inline-flex; gap: 6px; align-items: center; }
.tree .fi { display: grid; gap: 4px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 10px; margin: 2px 0 4px; }
.tree .fn { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
.tree .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tree .chip { font-size: 12px; border-radius: 999px; padding: 2px 8px; border: 1px solid var(--border); }
.tree .chip.ai { background: var(--accent-soft, #eef); border-color: transparent; font-weight: 700; }
.bk ul.sync { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.bk ul.sync li { display: flex; gap: 10px; align-items: center; font-size: 15px; overflow-wrap: anywhere; }
.bk .lg { flex: none; min-width: 74px; text-align: center; font-weight: 800; font-size: 13px; border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; }
.bk a.pf { font-size: 13.5px; }
table.bkt { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
table.bkt td, table.bkt th { padding: 4px 0; border-top: 1px solid var(--border); text-align: right; }
table.bkt td:first-child, table.bkt th:first-child { text-align: left; }
.bkgo { display: flex; justify-content: center; margin: 6px 0 0; }
@media (max-width: 760px) { .bk .two { grid-template-columns: 1fr; } .bk { padding: 14px 12px; } }`;

const rec = (file: string, label = "record") => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const tr = (cls: string, name: string, cents: number | null) => `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(name)}</td><td class="r">${cents === null ? "" : esc(money(cents))}</td></tr>`;

function statementHtml(s: Statement): string {
  const lines = (xs: { name: string; cents: number }[]) => xs.map((x) => tr("", x.name, x.cents)).join("");
  const balance = `<div><h3>${esc(`Balance sheet, ${s.day}`)}</h3><table class="st"><tbody>
${tr("grp", "Assets", null)}${lines(s.assets)}${tr("sub", "Total assets", s.totalAssets)}
${tr("grp", "Liabilities", null)}${lines(s.liabilities)}${tr("sub", "Total liabilities", s.totalLiabilities)}
${tr("grp", "Equity", null)}${lines(s.equity)}${tr("", "Result this year", s.result)}${tr("sub", "Total equity", s.totalEquity)}
${tr("tot", "Liabilities and equity", s.totalLiabilities + s.totalEquity)}</tbody></table></div>`;
  const pnl = `<div><h3>${esc("Profit and loss, 2026")}</h3><table class="st"><tbody>
${tr("", "Revenue", s.revenue)}${tr("grp", "Expenses", null)}${lines(s.pnl)}${tr("sub", "Total expenses", s.expense)}
${tr("tot", "Result", s.revenue - s.expense)}</tbody></table></div>`;
  return `<section class="bk card" aria-labelledby="bk-b"><h2 id="bk-b">${icon("database", 20)}${esc("Balance sheet")}<span class="tag">${esc("test company · test money")}</span></h2>
<p class="sub">${esc(`${s.company}, the test company of the Moneybird sandbox run: its books, ${s.currency}. Each of its purchase invoices checked against the run's record to the cent.`)} ${rec(MONEYBIRD_RECORD)}</p>
<div class="two">${balance}${pnl}</div>
${s.balances ? `<p class="ok">${icon("check", 18)}${esc("Balances: assets = liabilities + equity.")}</p>` : ""}
<div class="acts"><a class="btn primary" href="assets/${esc(s.pdf)}" download>${icon("download", 18)}${esc("Download PDF")}</a><span class="sub">${esc("The vault's own year report of these books.")}</span></div>
<details class="fold"><summary>${esc("Account codes")}</summary><ul class="pl">${s.codes.map((c) => `<li>${esc(`${c.account} ${c.name}`)}</li>`).join("")}</ul></details></section>`;
}

function sortedHtml(x: NonNullable<ReturnType<typeof sortedOf>>): string {
  // Year → Quarter → Purchase invoices → Supplier → file: one nested list, folders merged where they repeat.
  type Node = { name: string; kids: Map<string, Node>; files: SortedRow[] };
  const root: Node = { name: "", kids: new Map(), files: [] };
  for (const r of x.rows) {
    let n = root;
    for (const seg of r.path.slice(0, 4)) { if (!n.kids.has(seg)) n.kids.set(seg, { name: seg, kids: new Map(), files: [] }); n = n.kids.get(seg)!; }
    n.files.push(r);
  }
  const file = (r: SortedRow) => `<li><div class="fi"><span class="fn">${icon("file-text", 14)} ${esc(r.path[4]!)}</span><span class="chips"><span class="chip ai">${esc("Claude")}</span><span class="chip" title="${esc(r.accountName)}">${esc(`${r.account} ${r.accountName}`)}</span><span class="chip" title="${esc(r.vatLabel)}">${esc(`VAT ${r.vat}`)}</span><span class="chip" title="${esc(r.ccName)}">${esc(r.cc)}</span></span></div></li>`;
  const walk = (n: Node): string => [...n.kids.values()].map((k) => `<li><span class="fo">${icon("folder", 15)}${esc(k.name)}</span><ul>${walk(k)}${k.files.map(file).join("")}</ul></li>`).join("");
  return `<section class="bk card" aria-labelledby="bk-s"><h2 id="bk-s">${icon("sparkles", 20)}${esc("Invoices, sorted by Claude")}</h2>
<p class="sub">${esc(`The Coder agent (${x.model}) chose account, VAT code and cost centre; each right, in the ${x.ranAt} eval of test invoices. The folders are Purser's vault.`)} ${rec(CODER_EVAL, "eval")}</p>
<ul class="tree">${walk(root)}</ul></section>`;
}

/** The body: the statement first, then the invoices Claude sorted, the sync, and the live demo. */
export function booksBody(d: BooksData): string {
  const s = d.statement, t = d.synced.t0, m = d.synced.moneybird;
  const sync = [
    m ? `<li><span class="lg">Moneybird</span><span>${esc(`Sandbox administration: ${m.invoices} purchase invoices equal to the cent, ${m.differences} differences.`)} ${rec(MONEYBIRD_RECORD)}</span></li>` : "",
    t ? `<li><span class="lg">T:0</span><span>${esc(`Sandbox: the 3 Nov books, ${t.posted} journal entries, ${t.differences} differences.`)} ${rec(T0_JOURNAL_RECORD)}</span></li>` : "",
  ].filter(Boolean);
  const journal = t && t.accounts.length ? `<details class="fold"><summary>${esc(`The 3 Nov books in T:0, per account (USD, test money)`)}</summary><table class="bkt"><thead><tr><th>${esc("T:0 account (ours)")}</th><th>${esc("Ours, net debit")}</th><th>T:0</th></tr></thead><tbody>${t.accounts.map((a) => `<tr><td>${esc(a.account)}</td><td>${esc(a.ours)}</td><td>${esc(a.t0)}</td></tr>`).join("")}</tbody></table></details>` : "";
  return `<main class="pp bkp"><div class="wrap">
  <div class="phd"><span class="pill run">${esc("Run records and evals")}</span><h1>${esc("The books, kept by AI agents")}</h1></div>
  <p class="line">${esc("Claude reads and codes each invoice; code checks; the books balance.")}</p>
  ${s ? statementHtml(s) : ""}
  ${d.sorted ? sortedHtml(d.sorted) : ""}
  ${sync.length ? `<section class="bk card" aria-labelledby="bk-y"><h2 id="bk-y">${icon("check", 20)}${esc("Synced to outside books")}</h2><ul class="sync">${sync.join("")}</ul>${journal}</section>` : ""}
  <p class="bkgo"><a class="btn primary big" href="${esc(BOOKS_LIVE_URL)}">${esc("See it happen live")}${icon("arrow-right", 18)}</a></p>
  <a class="open" href="proof">All the proof</a>
</div></main>`;
}
