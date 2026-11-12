// The books screen's effect of one invoice (master list line 249): profit and loss and the VAT overview before and
// after the invoice's own entries, computed by the ledger's report code (src/ledger/reports.ts) over the company's
// posted lines, never by hand. "Before" is every entry posted before the invoice's first entry; "after" is every entry
// up to its last one (its accrual on receipt and its payment). The invoice's entries are the ones whose payables line
// names the invoice (src/ledger/feed.ts writes doc_ref on the 2100 line of both).
//
// Plus one T0 row, honestly labelled: this test company sends nothing to T0. The tick it carries refers to the recorded
// run of 10 November (docs/runs/2026-11-10-t0-journal-sandbox.md), and the row says so.
import { profitAndLossFrom, quarterRange, vatOverviewFrom, type PostedLine } from "../ledger/reports.js";

export type EntryLine = PostedLine & { entry_id: number };

export interface PnlFigures { revenue_cents: number; expense_cents: number; result_cents: number }
export interface VatFigures { owed_5a_cents: number; input_5b_cents: number; balance_5c_cents: number; uncoded_lines: number }
export interface BooksEffect {
  currency: string;
  entries: number[];
  period: { from: string; to: string };
  quarter: string;
  pnl: { before: PnlFigures; after: PnlFigures };
  vat: { before: VatFigures; after: VatFigures };
  vat_notice: string;
}

const ZERO_PNL: PnlFigures = { revenue_cents: 0, expense_cents: 0, result_cents: 0 };

/** The quarter a day is in, as the VAT overview names it (2026Q4). */
export const quarterOf = (day: string): string => `${day.slice(0, 4)}Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;

/** The effect of the invoice's entries (those with a line whose doc_ref is one of docRefs); null when the books hold none yet. */
export function booksEffect(lines: EntryLine[], docRefs: string[], today: string, currency = "EUR"): BooksEffect | null {
  const refs = new Set(docRefs.filter(Boolean));
  const mine = [...new Set(lines.filter((l) => l.doc_ref !== null && refs.has(l.doc_ref)).map((l) => l.entry_id))].sort((a, b) => a - b);
  if (!mine.length) return null;
  const first = mine[0]!, last = mine[mine.length - 1]!;
  const before = lines.filter((l) => l.entry_id < first);
  const after = lines.filter((l) => l.entry_id <= last);
  const year = { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  const quarter = quarterOf(today);
  const pnl = (ls: EntryLine[]): PnlFigures => {
    const p = profitAndLossFrom(ls, year)[currency];
    return p ? { revenue_cents: p.revenue_cents, expense_cents: p.expense_cents, result_cents: p.result_cents } : ZERO_PNL;
  };
  const vat = (ls: EntryLine[]): VatFigures => {
    const v = vatOverviewFrom(ls, quarter);
    return { owed_5a_cents: v.owed_5a_cents, input_5b_cents: v.input_5b_cents, balance_5c_cents: v.balance_5c_cents, uncoded_lines: v.uncoded_lines };
  };
  return { currency, entries: mine, period: year, quarter, pnl: { before: pnl(before), after: pnl(after) }, vat: { before: vat(before), after: vat(after) }, vat_notice: vatOverviewFrom([], quarter).notice };
}

/** The quarter's range, for the page's label. */
export const quarterLabel = (q: string): string => { const r = quarterRange(q); return `${q} (${r.from} to ${r.to})`; };

/** The T0 row: not sent from this test company; the tick is the recorded run's, and the words say so. */
export const T0_ROW = {
  text: "T0: not sent from this test company. Real posting on 10 November, recorded run.",
  tick: "recorded" as const,
  href: "https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-t0-journal-sandbox.md",
  record: "docs/runs/2026-11-10-t0-journal-sandbox.md",
};

const eur = (cents: number) => `${cents < 0 ? "−" : ""}EUR ${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The books block for the screen: P&L and VAT before → after, computed; then the T0 row with its label. Plain HTML. */
export function booksEffectHtml(e: BooksEffect | null): string {
  const t0 = `<p class="t0"><span class="tick" aria-label="recorded run">✓</span> ${esc(T0_ROW.text)} <a href="${T0_ROW.href}" target="_blank" rel="noopener">Read the run record</a></p>`;
  if (!e) return `<div class="books-effect"><p>Not in the books yet.</p>${t0}</div>`;
  const row = (label: string, a: number, b: number) => `<tr><th scope="row">${esc(label)}</th><td>${eur(a)}</td><td>${eur(b)}</td></tr>`;
  return `<div class="books-effect">
<table><caption>Profit and loss ${esc(e.period.from.slice(0, 4))}, computed from the ledger</caption><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody>
${row("Expenses", e.pnl.before.expense_cents, e.pnl.after.expense_cents)}
${row("Result", e.pnl.before.result_cents, e.pnl.after.result_cents)}
</tbody></table>
<table><caption>VAT overview ${esc(e.quarter)}, computed from the ledger</caption><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody>
${row("Input VAT (5b)", e.vat.before.input_5b_cents, e.vat.after.input_5b_cents)}
${row("Balance (5c)", e.vat.before.balance_5c_cents, e.vat.after.balance_5c_cents)}
</tbody></table>
<details><summary>About these figures</summary><p>${esc(e.vat_notice)} Entries ${e.entries.map(String).join(", ")}.</p></details>
${t0}</div>`;
}
