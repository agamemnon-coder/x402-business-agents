// The ledger's read-only page (bookkeeping core, decision 9): `npm run ledger -- serve` shows it on 127.0.0.1. It only
// reads; every amount is a sum of posted lines. One inline stylesheet, allowed by its hash; no scripts.

import { createHash } from "node:crypto";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { verifyLedger } from "./core.js";
import { ageing, balanceSheet, cashByCurrency, profitAndLoss, trialBalance, vatOverview } from "./reports.js";
import { stockOnHand } from "./stock.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));

const CSS = "body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111;background:#fff}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;margin:8px 0}td,th{padding:3px 10px;border-bottom:1px solid #ddd;text-align:left}td.n{text-align:right;font-variant-numeric:tabular-nums}.note{color:#555;max-width:720px}.bad{color:#b00020;font-weight:600}.ok{color:#0a7a3d;font-weight:600}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333}.note{color:#aaa}}";

export const LEDGER_PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(CSS).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

function table(head: string[], rows: string[][], numeric: number[] = []): string {
  if (!rows.length) return "<p class=\"note\">Nothing posted yet.</p>";
  return `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? " class=\"n\"" : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

export function ledgerPage(db: DB, opts: { asOf: string; quarter: string; year: number }): string {
  const check = verifyLedger(db);
  const trial = trialBalance(db, opts.asOf);
  const pl = profitAndLoss(db, { from: `${opts.year}-01-01`, to: opts.asOf });
  const bs = balanceSheet(db, opts.asOf);
  const vat = vatOverview(db, opts.quarter);
  const sections = [
    `<h1>Purser's books</h1><p class="note">Test money only. Every amount is a sum of posted ledger lines, in its own currency. As of ${esc(opts.asOf)}.</p>`,
    `<p class="${check.ok ? "ok" : "bad"}">${check.ok ? `Ledger chain verified: ${check.entries} entries, nothing changed after posting.` : `Ledger chain broken at entry ${check.entry_id}: ${esc(check.reason)}`}</p>`,
    "<h2>Profit and loss</h2>",
    table(["Currency", "Revenue", "Expenses", "Result"], Object.entries(pl).map(([cur, p]) => [cur, money(p.revenue_cents), money(p.expense_cents), money(p.result_cents)]), [1, 2, 3]),
    "<h2>Balance sheet</h2>",
    table(["Currency", "Assets", "Liabilities", "Equity", "Open result", "Balances"], Object.entries(bs).map(([cur, b]) => [cur, money(b.assets_cents), money(b.liabilities_cents), money(b.equity_cents), money(b.result_cents), b.balanced ? "yes" : "NO"]), [1, 2, 3, 4]),
    "<h2>Cash</h2>",
    table(["Account", "Currency", "Balance"], cashByCurrency(db).map((c) => [c.account, c.currency, money(c.balance_cents)]), [2]),
    `<h2>VAT overview ${esc(vat.quarter)}</h2><p class="note">${esc(vat.notice)}</p>`,
    table(["Rubric", "Base", "VAT"], Object.entries(vat.rubrics).map(([r, v]) => [r, money(v.base_cents), money(v.vat_cents)]).concat([["5a owed", "", money(vat.owed_5a_cents)], ["5b input VAT", "", money(vat.input_5b_cents)], ["5c balance", "", money(vat.balance_5c_cents)]]), [1, 2]),
    `<p class="note">Lines with no VAT code yet: ${vat.uncoded_lines}. VAT-coded lines in another currency: ${vat.other_currency_lines}.${vat.foreign_vat.lines ? ` Foreign VAT, outside the Dutch return: ${vat.foreign_vat.lines} line(s), VAT ${money(vat.foreign_vat.vat_cents)} on ${money(vat.foreign_vat.base_cents)}, booked to 1515 (to reclaim through the EU refund).` : ""}</p>`,
    ...(["receivables", "payables"] as const).flatMap((k) => [`<h2>${k === "receivables" ? "Customers owe us" : "We owe suppliers"}</h2>`,
      table(["Party", "Document", "Currency", "Due", "Open", "Overdue (days)"], ageing(db, k, opts.asOf).items.map((i) => [i.party, i.doc_ref, i.currency, i.due_date ?? "", money(i.open_cents), String(i.days_overdue)]), [4, 5])]),
    "<h2>Stock</h2>",
    table(["Item", "Name", "Currency", "On hand", "Value", "Average cost"], stockOnHand(db).map((s) => [s.sku, s.name, s.currency, String(s.qty), money(s.value_cents), money(s.average_cents)]), [3, 4, 5]),
    "<h2>Trial balance</h2>",
    table(["Account", "Name", "Currency", "Debit", "Credit", "Balance"], trial.map((t) => [t.account, t.name, t.currency, money(t.debit_cents), money(t.credit_cents), money(t.balance_cents)]), [3, 4, 5]),
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purser's books</title><style>${CSS}</style></head><body>${sections.join("\n")}</body></html>`;
}
