// /books (owner, 12 Nov): Purser's bookkeeping, done with AI agents, told from the run records and evals alone.
//   1. The journal: the main run's books of 3 November as posted to T:0 on 10 November, per account, debit and credit,
//      the totals computed here from the record's own rows (src/redesign/t0Page.ts t0Journal reads them).
//   2. The Coder agent: one invoice line of the 12 November eval, coded by Claude to an account, a VAT code and a cost
//      centre, as code let it into the books (docs/evals/coder.json).
//   3. The ledger agents: the Controller, Ask the books and the Treasury schedule, one line each, from the 12 November
//      record's eval table.
//   4. The outside books: Moneybird's sandbox administration (12 Nov) and T:0 (10 Nov), as their records state.
// A record that is missing or changed leaves its block out; nothing here is typed in as a figure.
import { readFileSync } from "node:fs";
import { COST_CENTRE_NAMES } from "../config/gl.js";
import { LEDGER_ACCOUNTS } from "../ledger/accounts.js";
import { VAT_CODES } from "../ledger/vat.js";
import { REPO_BLOB } from "./metalStory.js";
import { T0_JOURNAL_RECORD, t0Journal, type T0Journal } from "./t0Page.js";
import { esc, icon } from "./ui.js";

export const CODER_EVAL = "docs/evals/coder.json";
export const LEDGER_AGENTS_RECORD = "docs/runs/2026-11-12-ledger-agents.md";
export const MONEYBIRD_RECORD = "docs/runs/2026-11-12-moneybird-sandbox.md";
/** The hands-on demo, whose end screen shows the books of the visitor's own invoice. */
export const BOOKS_LIVE_URL = "https://purser-try.max-31b.workers.dev/try";
/** The coder eval's case shown: one line, coded right on account, VAT code and cost centre. */
export const CODER_CASE = "nl-software-21";

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

/** "11,144,700.05" or "-21,140,636.23" (or "-2.05 + 0.15") to cents; null when it is not one amount. */
export function centsOf(s: string): number | null {
  const m = /^(-?)([\d,]+)\.(\d{2})$/.exec(s.trim().replace(/−/g, "-"));
  if (!m) return null;
  return (m[1] ? -1 : 1) * (Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3]));
}
export const money = (cents: number): string => { const a = Math.abs(cents); return `${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`; };

export interface JournalTable { day: string; posted: number; differences: number; rows: { account: string; debit: number; credit: number; equal: boolean }[]; debit: number; credit: number }
/** The record's per-account net debits, split into a debit and a credit column; the totals summed here. */
export function journalTable(j: T0Journal | null): JournalTable | null {
  if (!j || !j.accounts.length) return null;
  const rows: JournalTable["rows"] = [];
  for (const a of j.accounts) {
    const ours = centsOf(a.ours), t0 = centsOf(a.t0);
    if (ours === null) return null;
    rows.push({ account: a.account, debit: ours > 0 ? ours : 0, credit: ours < 0 ? -ours : 0, equal: t0 === ours });
  }
  return { day: j.day, posted: j.posted, differences: j.differences, rows, debit: rows.reduce((n, r) => n + r.debit, 0), credit: rows.reduce((n, r) => n + r.credit, 0) };
}

export interface CoderExample { model: string; lines: { account: string; accountName: string; vat: string; vatLabel: string; cc: string; ccName: string }[]; allRight: boolean; cents: number; ms: number; invoices: number; ranAt: string }
/** The eval's row for CODER_CASE (the cheaper model first), as code let it into the books. */
export function coderExample(json: string | null): CoderExample | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as { ran_at: string; models: string[]; rows: { case: string; model: string; enforced: { source: string; lines: { account: string; vat_code: string | null; cost_centre: string | null }[] } | null; correct: Record<string, boolean> | null; cost_usd_micros: number; latency_ms: number }[] };
    const rows = d.rows.filter((r) => r.case === CODER_CASE && r.enforced?.source === "claude");
    const r = rows.find((x) => x.model.includes("haiku")) ?? rows[0];
    if (!r?.enforced) return null;
    return {
      model: r.model,
      lines: r.enforced.lines.map((l) => ({ account: l.account, accountName: LEDGER_ACCOUNTS[l.account] ?? "", vat: l.vat_code ?? "none", vatLabel: l.vat_code ? VAT_CODES[l.vat_code]?.label ?? "" : "", cc: l.cost_centre ?? "", ccName: l.cost_centre ? COST_CENTRE_NAMES[l.cost_centre] ?? "" : "" })),
      allRight: !!r.correct && Object.values(r.correct).every(Boolean),
      cents: r.cost_usd_micros / 10_000, ms: r.latency_ms,
      invoices: d.rows.filter((x) => x.model === r.model).length,
      ranAt: d.ran_at.slice(0, 10),
    };
  } catch { return null; }
}

export interface LedgerAgent { name: string; job: string; passed: string; byClaude: string; model: string }
const JOBS: Record<string, string> = {
  Controller: "reviewed the month's supplier invoices and proposed corrections; a person approves before anything is posted",
  "Ask the books": "answered the CFO's questions with figures code checked against the ledger",
  "Treasury schedule": "timed the open supplier invoices within the CFO's signed cash floors",
};
/** The record's eval table, Claude's rows only: each agent, its passed cases and how many Claude decided. */
export function ledgerAgents(md: string | null): LedgerAgent[] {
  if (!md) return [];
  const out: LedgerAgent[] = [];
  for (const m of md.matchAll(/^\| (Controller|Ask the books|Treasury schedule) \| (claude-[\w-]+) \| (\d+\/\d+) \| (\d+\/\d+) \| [\d.]+ \|$/gm)) {
    if (!out.some((a) => a.name === m[1])) out.push({ name: m[1]!, model: m[2]!, passed: m[3]!, byClaude: m[4]!, job: JOBS[m[1]!]! });
  }
  return out;
}

export interface Outside { moneybird: { invoices: number; differences: number } | null }
export function moneybird(md: string | null): Outside["moneybird"] {
  const m = /all (\d+) purchase invoices in Moneybird equal Purser's ledger to the cent:\s*(\d+) differences/.exec((md ?? "").replace(/\s+/g, " "));
  return m ? { invoices: Number(m[1]), differences: Number(m[2]) } : null;
}

export interface BooksData { journal: JournalTable | null; coder: CoderExample | null; agents: LedgerAgent[]; moneybird: Outside["moneybird"] }
export const booksData = (): BooksData => ({
  journal: journalTable(t0Journal(read(T0_JOURNAL_RECORD))),
  coder: coderExample(read(CODER_EVAL)),
  agents: ledgerAgents(read(LEDGER_AGENTS_RECORD)),
  moneybird: moneybird(read(MONEYBIRD_RECORD)),
});

export const BOOKS_CSS = `.bk { padding: 16px 18px; display: grid; gap: 8px; }
.bk h2 { font-size: 19px; line-height: 1.25; margin: 0; display: flex; gap: 8px; align-items: center; }
.bk .sub { margin: 0; color: var(--muted); font-size: 15px; }
table.bkt { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; table-layout: fixed; }
table.bkt th, table.bkt td { padding: 6px 0; border-top: 1px solid var(--border); text-align: right; overflow-wrap: anywhere; }
table.bkt th:first-child, table.bkt td:first-child { text-align: left; width: 34%; }
table.bkt td + td, table.bkt th + th { white-space: nowrap; }
table.bkt thead th { border-top: 0; color: var(--muted); font-weight: 600; font-size: 12.5px; }
table.bkt tfoot td { font-weight: 700; border-top: 2px solid var(--fg); }
.bk .ok { color: var(--good, #157f3b); font-weight: 650; }
.bk .code { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.bk .code div { border: 1px solid var(--border); border-radius: 12px; padding: 10px; display: grid; gap: 2px; }
.bk .code b { font-size: 18px; font-variant-numeric: tabular-nums; }
.bk .code span { color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
.bk ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.bk li { padding: 6px 0; border-top: 1px solid var(--border); font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.bk li:first-child { border-top: 0; }
.bk a.pf { font-size: 13.5px; }
.bkgo { display: flex; justify-content: center; margin: 6px 0 0; }
@media (max-width: 700px) { .bk .code { grid-template-columns: 1fr; } table.bkt { font-size: 11.5px; } .bk { padding: 14px 12px; } }`;

const rec = (file: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc("record")} ↗</a>`;

/** The body: one card per block, one line each, the record linked at its end. */
export function booksBody(d: BooksData): string {
  const j = d.journal, c = d.coder;
  const journal = j ? `<section class="bk card" aria-labelledby="bk-j"><h2 id="bk-j">${icon("database", 20)}${esc("The journal")}</h2>
<p class="sub">${esc(`${j.posted} entries of the 3 Nov books, posted to T:0 on ${j.day}: debits = credits, ${j.differences} differences.`)} ${rec(T0_JOURNAL_RECORD)}</p>
<table class="bkt"><thead><tr><th scope="col">${esc("Account (T:0, ours)")}</th><th scope="col">${esc("Debit")}</th><th scope="col">${esc("Credit")}</th></tr></thead>
<tbody>${j.rows.map((r) => `<tr><td>${esc(r.account)}</td><td>${r.debit ? esc(money(r.debit)) : ""}</td><td>${r.credit ? esc(money(r.credit)) : ""}</td></tr>`).join("")}</tbody>
<tfoot><tr><td>${esc("Total, USD (test money)")}</td><td>${esc(money(j.debit))}</td><td>${esc(money(j.credit))}</td></tr></tfoot></table>
${j.debit === j.credit && j.rows.every((r) => r.equal) ? `<p class="ok">${esc("Balances, and T:0 holds the same per account.")}</p>` : ""}</section>` : "";
  const coder = c ? `<section class="bk card" aria-labelledby="bk-c"><h2 id="bk-c">${icon("sparkles", 20)}${esc("Coder agent (Claude)")}</h2>
<p class="sub">${esc(`A helpdesk software line, coded by ${c.model} in the ${c.ranAt} eval${c.allRight ? ", all three as a bookkeeper expects" : ""}.`)} ${rec(CODER_EVAL)}</p>
${c.lines.map((l) => `<div class="code"><div><b>${esc(l.account)}</b><span>${esc(l.accountName)}</span></div><div><b>${esc(l.vat)}</b><span>${esc(l.vatLabel)}</span></div><div><b>${esc(l.cc)}</b><span>${esc(l.ccName)}</span></div></div>`).join("")}
<p class="sub">${esc(`USD ${(c.cents / 100).toFixed(4)} and ${(c.ms / 1000).toFixed(1)} s for this invoice; ${c.invoices} invoices in the eval.`)}</p></section>` : "";
  const agents = d.agents.length ? `<section class="bk card" aria-labelledby="bk-a"><h2 id="bk-a">${icon("feather", 20)}${esc("Ledger agents (Claude)")}</h2>
<ul>${d.agents.map((a) => `<li><b>${esc(a.name)}</b>${esc(`: ${a.job}. ${a.passed} cases passed, ${a.byClaude} decided by Claude.`)}</li>`).join("")}</ul>
<p class="sub">${esc("Each behind a flag, off by default; none can post or pay. Eval of 12 Nov.")} ${rec(LEDGER_AGENTS_RECORD)}</p></section>` : "";
  const outside = [
    d.moneybird ? `<li><b>${esc("Moneybird")}</b>${esc(` (sandbox administration): ${d.moneybird.invoices} purchase invoices equal to the cent, ${d.moneybird.differences} differences.`)} ${rec(MONEYBIRD_RECORD)}</li>` : "",
    j ? `<li><b>${esc("T:0")}</b>${esc(` (sandbox): ${j.posted} journal entries, read back with ${j.differences} differences.`)} ${rec(T0_JOURNAL_RECORD)}</li>` : "",
  ].filter(Boolean);
  const synced = outside.length ? `<section class="bk card" aria-labelledby="bk-s"><h2 id="bk-s">${icon("check", 20)}${esc("Synced to outside books")}</h2><ul>${outside.join("")}</ul></section>` : "";
  return `<main class="pp bkp"><div class="wrap">
  <div class="phd"><span class="pill run">${esc("Run records and evals")}</span><h1>${esc("The books, kept by AI agents")}</h1></div>
  <p class="line">${esc("Claude codes and checks; code enforces; the books balance.")}</p>
  ${journal}${coder}${agents}${synced}
  <p class="bkgo"><a class="btn primary big" href="${esc(BOOKS_LIVE_URL)}">${esc("See it happen live")}${icon("arrow-right", 18)}</a></p>
  <a class="open" href="proof">All the proof</a>
</div></main>`;
}
