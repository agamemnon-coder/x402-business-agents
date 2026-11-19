// Google Sheets export of the paid supplier invoices and the payables journal (docs/integrations/workplace.md,
// "Sheets"). The one Google integration that writes, and only rows, only to the spreadsheet the owner names: the scope
// is spreadsheets, asked for this export alone. What it writes is a copy for reading; the ledger in Purser stays the
// record, and nothing written to the sheet is ever read back into Purser.
//
// Endpoints, each from Sheets API v4's reference (developers.google.com/workspace/sheets/api/reference/rest/v4):
// - spreadsheets.values.get:    GET  /v4/spreadsheets/{id}/values/{range}            (the keys already written)
// - spreadsheets.values.append: POST /v4/spreadsheets/{id}/values/{range}:append?valueInputOption=RAW
//   &insertDataOption=INSERT_ROWS with a ValueRange { range, majorDimension: "ROWS", values }.
// valueInputOption RAW: "The values the user has entered will not be parsed and will be stored as-is", so a supplier
// name that starts with "=" stays text and never becomes a formula in the owner's sheet.
//
// Each row starts with a key; a row whose key is already in the sheet's first column is not appended again, so running
// the export twice adds nothing. Built and tested against a mock (test/workplace-google.test.ts); needs the owner's
// OAuth app to run live.

import { z } from "zod";
import { apJournal, INVOICE_COLUMNS, JOURNAL_COLUMNS, type ApEntry } from "../ap/books.js";
import { apInvoices, type ApInvoiceRow } from "../ap/store.js";
import type { DB } from "../db/open.js";
import { callJson, safeId, type Fetch, type TokenSource } from "./http.js";

export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface SheetsConfig {
  token: TokenSource;
  spreadsheetId: string;
  paidSheet?: string;
  journalSheet?: string;
  fetch?: Fetch;
  base?: string;
}

const ValueRange = z.object({ range: z.string().max(500).optional(), majorDimension: z.string().optional(), values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()])).max(100)).max(1_000_000).optional() });
const AppendAnswer = z.object({ spreadsheetId: z.string().max(200), tableRange: z.string().max(500).optional(), updates: z.object({ updatedRows: z.number().int().nonnegative().optional(), updatedRange: z.string().max(500).optional() }) });

/** A sheet's name in A1 notation: quoted, an apostrophe doubled. */
export const a1 = (sheet: string, cols: string) => `'${sheet.replace(/'/g, "''")}'!${cols}`;
/** A cell as Sheets keeps it: text, at most 1,000 characters (a cell holds 50,000; a ledger line needs far less). */
const cell = (v: string | number | null | undefined) => String(v ?? "").replace(/[\p{Cc}]/gu, " ").slice(0, 1000);

export const PAID_HEADER = ["key", ...INVOICE_COLUMNS] as const;
export const JOURNAL_HEADER = ["key", ...JOURNAL_COLUMNS] as const;

export function paidRows(invs: ApInvoiceRow[]): string[][] {
  return invs.filter((i) => i.status === "paid").map((i) => [cell(i.id), ...INVOICE_COLUMNS.map((k) => cell(i[k] as string | number | null))]);
}

/** Journal lines keyed by invoice, event, date and their place within that event: the same line keeps its key. */
export function journalRows(entries: ApEntry[]): string[][] {
  const n = new Map<string, number>();
  return entries.map((e) => {
    const group = `${e.invoice_id}:${e.event}:${e.date}`;
    const i = n.get(group) ?? 0;
    n.set(group, i + 1);
    return [cell(`${group}:${i}`), ...JOURNAL_COLUMNS.map((k) => cell(e[k]))];
  });
}

export interface SheetExport { sheet: string; appended: number; already: number }

/** Appends the rows whose key is not yet in the sheet's first column; the header first when the sheet is empty. */
export async function appendNewRows(cfg: SheetsConfig, sheet: string, header: readonly string[], rows: string[][]): Promise<SheetExport> {
  const id = safeId("the spreadsheet id", cfg.spreadsheetId, /^[A-Za-z0-9_-]{10,200}$/);
  const base = `${cfg.base ?? SHEETS_API}/${id}/values`;
  const o = { token: cfg.token, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) };
  const existing = await callJson(`${base}/${encodeURIComponent(a1(sheet, "A:A"))}?majorDimension=COLUMNS`, ValueRange, o, 32 * 1024 * 1024);
  const keys = new Set((existing.values?.[0] ?? []).map(String));
  const fresh = rows.filter((r) => !keys.has(r[0]!));
  const values = keys.size === 0 ? [[...header], ...fresh] : fresh;
  if (values.length === 0) return { sheet, appended: 0, already: rows.length };
  const range = a1(sheet, "A1");
  await callJson(`${base}/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, AppendAnswer, {
    ...o, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  return { sheet, appended: fresh.length, already: rows.length - fresh.length };
}

/** The paid invoices and the journal from the ledger, appended to their two sheets; rows already there are left. */
export async function exportToSheets(db: DB, cfg: SheetsConfig): Promise<SheetExport[]> {
  return [
    await appendNewRows(cfg, cfg.paidSheet ?? "Paid invoices", PAID_HEADER, paidRows(apInvoices(db))),
    await appendNewRows(cfg, cfg.journalSheet ?? "Journal", JOURNAL_HEADER, journalRows(apJournal(db))),
  ];
}
