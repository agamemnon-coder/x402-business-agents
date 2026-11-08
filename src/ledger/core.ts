// Purser's stored general ledger (docs/superpowers/specs/2026-11-08-bookkeeping-core-design.md, decision 1).
// An entry is balanced per currency or refused; once posted it is never changed (the database refuses UPDATE and
// DELETE) and a mistake is corrected by a reversing entry. entry_hash = SHA-256(prev_hash ‖ jcs(entry with its lines)),
// the audit log's pattern, so `verifyLedger` recomputes the whole chain. A closed month is never posted into: a late
// item posts on the first day of the next open month and keeps its document date.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { LEDGER_ACCOUNTS as CHART } from "./accounts.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { VAT_CODES } from "./vat.js";

export const LEDGER_GENESIS = "0".repeat(64);

/** Why the ledger refused an entry: nothing was written. */
export class LedgerRefused extends Error {}

export interface LineInput {
  account: string;
  debit?: number;
  credit?: number;
  currency: string;
  cost_centre?: string;
  vat_code?: string;
  vat_cents?: number;
  party?: string;
  due_date?: string;
  doc_ref?: string;
  memo?: string;
}

export interface EntryInput {
  /** The document's date, YYYY-MM-DD or an ISO timestamp. */
  date: string;
  description: string;
  created_by: string;
  /** Posts once: a second entry with the same key returns the first. */
  source_key?: string;
  doc_ref?: string;
  doc_sha256?: string;
  lines: LineInput[];
}

export interface LedgerLine {
  line_no: number;
  account: string;
  debit_cents: number;
  credit_cents: number;
  currency: string;
  cost_centre: string | null;
  vat_code: string | null;
  vat_cents: number | null;
  party: string | null;
  due_date: string | null;
  doc_ref: string | null;
  memo: string | null;
}

export interface LedgerEntry {
  entry_id: number;
  posting_date: string;
  doc_date: string;
  description: string;
  source_key: string | null;
  doc_ref: string | null;
  doc_sha256: string | null;
  created_by: string;
  reverses: number | null;
  created_at: string;
  prev_hash: string;
  entry_hash: string;
  lines: LedgerLine[];
}

export interface Posted { entry_id: number; posting_date: string; duplicate: boolean }

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCY = /^[A-Z]{3,4}$/;

function dayOf(date: string): string {
  const m = DAY.exec(date);
  const day = m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  // Date.parse rolls 2027-02-31 over to 2027-03-03: a day only counts when it reads back as itself.
  const t = m ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!m || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day) throw new LedgerRefused(`not a date: ${date}`);
  return day;
}

const nextMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export function lockedMonths(db: DB): Set<string> {
  return new Set((db.prepare("SELECT month FROM ledger_locks").all() as { month: string }[]).map((r) => r.month));
}

/**
 * The last closed month, or null. Closing a month closes every month before it (review of PR #108, finding 6): a
 * late item for February must not change the balances already reported at the close of March.
 */
export function closedThrough(db: DB): string | null {
  return (db.prepare("SELECT MAX(month) AS m FROM ledger_locks").get() as { m: string | null }).m;
}

/** The date an entry dated `docDay` posts on: its own, or the first day of the first month after the last closed one. */
export function postingDay(db: DB, docDay: string): string {
  const through = closedThrough(db);
  const month = docDay.slice(0, 7);
  if (through === null || month > through) return docDay;
  return `${nextMonth(through)}-01`;
}

function checkLines(lines: LineInput[]): LedgerLine[] {
  if (lines.length < 2) throw new LedgerRefused("an entry needs at least two lines");
  const out = lines.map((l, i): LedgerLine => {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) throw new LedgerRefused(`line ${i + 1}: amounts are whole cents, never negative`);
    if ((d === 0) === (c === 0)) throw new LedgerRefused(`line ${i + 1}: a line is either a debit or a credit`);
    if (!(l.account in CHART)) throw new LedgerRefused(`line ${i + 1}: account ${l.account} is not in the chart`);
    if (!CURRENCY.test(l.currency)) throw new LedgerRefused(`line ${i + 1}: bad currency ${l.currency}`);
    if (l.vat_code !== undefined && !(l.vat_code in VAT_CODES)) throw new LedgerRefused(`line ${i + 1}: unknown VAT code ${l.vat_code}`);
    if (l.vat_cents !== undefined && !Number.isInteger(l.vat_cents)) throw new LedgerRefused(`line ${i + 1}: VAT is whole cents`);
    if (l.due_date !== undefined) dayOf(l.due_date);
    return {
      line_no: i + 1, account: l.account, debit_cents: d, credit_cents: c, currency: l.currency, cost_centre: l.cost_centre ?? null,
      vat_code: l.vat_code ?? null, vat_cents: l.vat_code === undefined ? null : (l.vat_cents ?? 0), party: l.party ?? null,
      due_date: l.due_date ? dayOf(l.due_date) : null, doc_ref: l.doc_ref ?? null, memo: l.memo ?? null,
    };
  });
  const sums = new Map<string, number>();
  for (const l of out) sums.set(l.currency, (sums.get(l.currency) ?? 0) + l.debit_cents - l.credit_cents);
  const off = [...sums].filter(([, v]) => v !== 0);
  if (off.length) throw new LedgerRefused(`debits and credits differ in ${off.map(([cur, v]) => `${cur} (${v > 0 ? "debits" : "credits"} ${Math.abs(v)} cents higher)`).join(", ")}`);
  return out;
}

function hashOf(e: Omit<LedgerEntry, "entry_hash">): string {
  const { prev_hash, ...body } = e;
  return sha256Hex(prev_hash + jcs(body as unknown as Json));
}

/** Posts one balanced entry, or throws LedgerRefused and writes nothing. */
export function postEntry(db: DB, input: EntryInput, now = new Date()): Posted {
  const docDay = dayOf(input.date);
  const lines = checkLines(input.lines);
  if (!input.description.trim()) throw new LedgerRefused("an entry needs a description");
  return db.transaction((): Posted => {
    if (input.source_key) {
      const had = db.prepare("SELECT entry_id, posting_date FROM ledger_entries WHERE source_key = ?").get(input.source_key) as { entry_id: number; posting_date: string } | undefined;
      if (had) return { ...had, duplicate: true };
    }
    return write(db, { docDay, description: input.description, source_key: input.source_key ?? null, doc_ref: input.doc_ref ?? null, doc_sha256: input.doc_sha256 ?? null, created_by: input.created_by, reverses: null }, lines, now);
  }).immediate();
}

/**
 * The year close only (src/ledger/close.ts): posts on a fixed day, the year's last, even when that month is closed,
 * so the closing entry lands in the year it closes. Every other entry goes through postEntry.
 */
export function postClosingEntry(db: DB, input: EntryInput & { source_key: string }, postingDay: string, now = new Date()): Posted {
  const day = dayOf(postingDay);
  const lines = checkLines(input.lines);
  return db.transaction((): Posted => {
    const had = db.prepare("SELECT entry_id, posting_date FROM ledger_entries WHERE source_key = ?").get(input.source_key) as { entry_id: number; posting_date: string } | undefined;
    if (had) return { ...had, duplicate: true };
    return write(db, { docDay: day, description: input.description, source_key: input.source_key, doc_ref: input.doc_ref ?? null, doc_sha256: input.doc_sha256 ?? null, created_by: input.created_by, reverses: null }, lines, now, day);
  }).immediate();
}

function write(db: DB, h: { docDay: string; description: string; source_key: string | null; doc_ref: string | null; doc_sha256: string | null; created_by: string; reverses: number | null }, lines: LedgerLine[], now: Date, fixedDay?: string): Posted {
  const last = db.prepare("SELECT entry_id, entry_hash FROM ledger_entries ORDER BY entry_id DESC LIMIT 1").get() as { entry_id: number; entry_hash: string } | undefined;
  const entry: Omit<LedgerEntry, "entry_hash"> = {
    entry_id: (last?.entry_id ?? 0) + 1, posting_date: fixedDay ?? postingDay(db, h.docDay), doc_date: h.docDay, description: h.description, source_key: h.source_key,
    doc_ref: h.doc_ref, doc_sha256: h.doc_sha256, created_by: h.created_by, reverses: h.reverses, created_at: now.toISOString(), prev_hash: last?.entry_hash ?? LEDGER_GENESIS, lines,
  };
  const entry_hash = hashOf(entry);
  db.prepare(`INSERT INTO ledger_entries (entry_id, posting_date, doc_date, description, source_key, doc_ref, doc_sha256, created_by, reverses, created_at, prev_hash, entry_hash)
    VALUES (@entry_id, @posting_date, @doc_date, @description, @source_key, @doc_ref, @doc_sha256, @created_by, @reverses, @created_at, @prev_hash, @entry_hash)`).run({ ...entry, lines: undefined, entry_hash });
  const ins = db.prepare(`INSERT INTO ledger_lines (entry_id, line_no, account, debit_cents, credit_cents, currency, cost_centre, vat_code, vat_cents, party, due_date, doc_ref, memo)
    VALUES (@entry_id, @line_no, @account, @debit_cents, @credit_cents, @currency, @cost_centre, @vat_code, @vat_cents, @party, @due_date, @doc_ref, @memo)`);
  for (const l of lines) ins.run({ ...l, entry_id: entry.entry_id });
  return { entry_id: entry.entry_id, posting_date: entry.posting_date, duplicate: false };
}

/** Reverses an entry once: the same lines with debit and credit swapped, naming the entry it reverses. */
export function reverseEntry(db: DB, entryId: number, reason: string, by: string, now = new Date()): Posted {
  if (!reason.trim()) throw new LedgerRefused("a reversal needs a reason");
  return db.transaction((): Posted => {
    const key = `reverse:${entryId}`;
    const had = db.prepare("SELECT entry_id, posting_date FROM ledger_entries WHERE source_key = ?").get(key) as { entry_id: number; posting_date: string } | undefined;
    if (had) return { ...had, duplicate: true };
    const orig = ledgerRows(db).find((e) => e.entry_id === entryId);
    if (!orig) throw new LedgerRefused(`no ledger entry ${entryId}`);
    if (orig.reverses !== null) throw new LedgerRefused(`entry ${entryId} is itself a reversal; post a new entry instead`);
    const lines = orig.lines.map((l) => ({ ...l, debit_cents: l.credit_cents, credit_cents: l.debit_cents, vat_cents: l.vat_cents === null ? null : -l.vat_cents }));
    // Stock moved with the entry moves back with its reversal (review of PR #108, finding 3), or the reversal is refused
    // when the goods are no longer there to take back.
    const moves = db.prepare("SELECT sku, qty_delta, value_delta_cents FROM stock_moves WHERE entry_id = ?").all(entryId) as { sku: string; qty_delta: number; value_delta_cents: number }[];
    for (const m of moves) {
      const h = db.prepare("SELECT COALESCE(SUM(qty_delta), 0) AS qty, COALESCE(SUM(value_delta_cents), 0) AS value FROM stock_moves WHERE sku = ?").get(m.sku) as { qty: number; value: number };
      if (h.qty - m.qty_delta < 0 || h.value - m.value_delta_cents < 0) throw new LedgerRefused(`entry ${entryId} moved ${m.qty_delta} x ${m.sku}; only ${h.qty} are on hand to take back`);
    }
    const posted = write(db, { docDay: now.toISOString().slice(0, 10), description: `Reversal of entry ${entryId}: ${reason}`, source_key: key, doc_ref: orig.doc_ref, doc_sha256: orig.doc_sha256, created_by: by, reverses: entryId }, lines, now);
    const move = db.prepare("INSERT INTO stock_moves (sku, qty_delta, value_delta_cents, entry_id, at) VALUES (?, ?, ?, ?, ?)");
    for (const m of moves) move.run(m.sku, -m.qty_delta, -m.value_delta_cents, posted.entry_id, now.toISOString());
    return posted;
  }).immediate();
}

/** Closes a month for posting. True when it was locked now, false when it already was. */
export function lockMonth(db: DB, month: string, by: string, now = new Date(), kind: "month" | "year" = "month"): boolean {
  if (!MONTH.test(month)) throw new LedgerRefused(`not a month: ${month} (write 2026-11)`);
  return db.prepare("INSERT OR IGNORE INTO ledger_locks (month, kind, locked_by, locked_at) VALUES (?, ?, ?, ?)").run(month, kind, by, now.toISOString()).changes === 1;
}

/** Every entry with its lines, in posting order. */
export function ledgerRows(db: DB): LedgerEntry[] {
  const entries = db.prepare("SELECT * FROM ledger_entries ORDER BY entry_id").all() as Omit<LedgerEntry, "lines">[];
  const lines = db.prepare("SELECT * FROM ledger_lines ORDER BY entry_id, line_no").all() as (LedgerLine & { entry_id: number })[];
  const by = new Map<number, LedgerLine[]>();
  for (const { entry_id, ...l } of lines) (by.get(entry_id) ?? by.set(entry_id, []).get(entry_id)!).push(l);
  return entries.map((e) => ({ ...e, lines: by.get(e.entry_id) ?? [] }));
}

export type LedgerCheck = { ok: true; entries: number; head: string } | { ok: false; entry_id: number; reason: string };

export function verifyLedger(db: DB): LedgerCheck {
  return verifyLedgerRows(ledgerRows(db));
}

/** Recomputes the chain over entries from anywhere (an export included): order, links, hashes and balance. */
export function verifyLedgerRows(rows: LedgerEntry[]): LedgerCheck {
  let prev = LEDGER_GENESIS;
  let expect = 1;
  for (const e of rows) {
    if (e.entry_id !== expect) return { ok: false, entry_id: e.entry_id, reason: `gap: expected entry ${expect}` };
    if (e.prev_hash !== prev) return { ok: false, entry_id: e.entry_id, reason: "prev_hash does not match the previous entry" };
    const { entry_hash, ...rest } = e;
    if (hashOf(rest) !== entry_hash) return { ok: false, entry_id: e.entry_id, reason: "the entry or its lines changed after posting" };
    try { checkLines(e.lines.map((l) => ({ account: l.account, debit: l.debit_cents || undefined, credit: l.credit_cents || undefined, currency: l.currency }))); } catch (err) {
      return { ok: false, entry_id: e.entry_id, reason: (err as Error).message };
    }
    prev = entry_hash;
    expect += 1;
  }
  return { ok: true, entries: rows.length, head: prev };
}
