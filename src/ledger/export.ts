// The ledger out (bookkeeping core, decision 8): every line as CSV for a spreadsheet or an accountant, and the whole
// ledger as JSON with the result of the chain check, so a copy can be verified anywhere (verifyLedgerRows).

import { LEDGER_ACCOUNTS as CHART } from "./accounts.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { ledgerRows, verifyLedgerRows } from "./core.js";

const COLUMNS = ["entry", "posting_date", "doc_date", "description", "account", "account_name", "debit", "credit", "currency", "cost_centre", "vat_code", "vat", "party", "doc_ref", "due_date", "source_key", "entry_hash"] as const;

/** A text cell a spreadsheet would read as a formula gets a leading apostrophe. */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const signed = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));

export function exportCsv(db: DB): string {
  const rows: string[] = [COLUMNS.join(",")];
  for (const e of ledgerRows(db)) {
    for (const l of e.lines) {
      const amounts = [l.debit_cents ? fromCents(l.debit_cents) : "", l.credit_cents ? fromCents(l.credit_cents) : ""];
      const vat = l.vat_cents === null ? "" : signed(l.vat_cents);
      rows.push([String(e.entry_id), e.posting_date, e.doc_date].map(cell).concat([cell(e.description), cell(l.account), cell(CHART[l.account] ?? "")], amounts,
        [l.currency, l.cost_centre ?? "", l.vat_code ?? ""].map(cell), [vat], [l.party ?? "", l.doc_ref ?? e.doc_ref ?? "", l.due_date ?? "", e.source_key ?? "", e.entry_hash].map(cell)).join(","));
    }
  }
  return rows.join("\n") + "\n";
}

export function exportJson(db: DB): string {
  const entries = ledgerRows(db);
  return JSON.stringify({ chart: CHART, check: verifyLedgerRows(entries), entries }, null, 2) + "\n";
}
