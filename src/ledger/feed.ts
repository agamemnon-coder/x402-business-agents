// The ledger fed from what Purser already records (bookkeeping core, decision 2). Every journal line that
// src/accounting/gl.ts derives (and the opening balances books.ts adds) posts once as a two-line entry: money in debits
// the bank and credits the GL account, money out the other way round, exactly as doubleEntry does. No VAT code is set:
// Purser's records do not say which VAT applies, and the ledger does not guess.
//
// A source line is known by what never changes about it (review of PR #108, finding 1): its source, its reference,
// its accounts and currency, never its date (a payout's moves from SENT to PAID). A card charge is known by the card,
// the moment and the amount, so Airwallex re-keying it under another transaction id is the same charge. Each sync
// reconciles: a line already posted with the same amounts is left alone; a line whose amounts or accounts changed, or
// that is gone (a reversed card charge, a duplicate merged away), is reversed, and the new version posted under the
// same key with a version suffix. The ledger never loses or doubles a movement, and never changes a posted entry.

import { journal } from "../accounting/gl.js";
import { accrualEntries, bookable } from "../ap/books.js";
import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { apInvoices } from "../ap/store.js";
import { openingLines } from "../accounting/books.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { postEntry, reverseEntry, type LineInput } from "./core.js";

export const FEED_ACTOR = "purser-feed";

const cents = (amount: string) => (amount.startsWith("-") ? -toCents(amount.slice(1)) : toCents(amount));
const VERSION = /@v(\d+)$/;

/** What identifies the source line: never its date. A card charge by card, moment and amount, not its transaction id. */
function identityOf(db: DB, l: { source: string; ref: string; gl_account: string; bank_account: string; currency: string }): string {
  if (l.source === "card") {
    const c = db.prepare("SELECT card_id, occurred_at, amount_cents FROM card_transactions WHERE transaction_id = ?").get(l.ref) as { card_id: string; occurred_at: string; amount_cents: number } | undefined;
    if (c) return ["card", c.card_id, c.occurred_at, c.amount_cents, l.gl_account, l.bank_account, l.currency].join("|");
  }
  return [l.source, l.ref, l.gl_account, l.bank_account, l.currency].join("|");
}

const shape = (lines: { account: string; debit: number; credit: number; currency: string }[]) =>
  JSON.stringify(lines.map((l) => [l.account, l.debit, l.credit, l.currency]).sort());

interface Active { entry_id: number; base: string; version: number; shape: string }

/** The feed's postings still standing: posted by the feed, not a reversal, and not reversed since. */
function activeFeed(db: DB): Active[] {
  const rows = db.prepare(`SELECT e.entry_id, e.source_key FROM ledger_entries e WHERE e.created_by = ? AND e.reverses IS NULL AND e.source_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses = e.entry_id) ORDER BY e.entry_id`).all(FEED_ACTOR) as { entry_id: number; source_key: string }[];
  const lines = db.prepare("SELECT account, debit_cents AS debit, credit_cents AS credit, currency FROM ledger_lines WHERE entry_id = ?");
  return rows.map((r) => {
    const m = VERSION.exec(r.source_key);
    return { entry_id: r.entry_id, base: m ? r.source_key.slice(0, m.index) : r.source_key, version: m ? Number(m[1]) : 1, shape: shape(lines.all(r.entry_id) as { account: string; debit: number; credit: number; currency: string }[]) };
  });
}

/** The highest version ever posted under a key, reversed ones included, so a new version never reuses a key. */
function lastVersion(db: DB, base: string): number {
  const keys = (db.prepare("SELECT source_key FROM ledger_entries WHERE created_by = ? AND source_key >= ? AND source_key < ?").all(FEED_ACTOR, base, `${base}￿`) as { source_key: string }[])
    .map((r) => r.source_key).filter((k) => k === base || (k.startsWith(`${base}@v`) && VERSION.test(k.slice(base.length))));
  return keys.reduce((n, k) => Math.max(n, k === base ? 1 : Number(VERSION.exec(k)![1])), 0);
}

/**
 * Brings the ledger in line with Purser's records. `posted`: new postings; `already`: lines posted earlier and
 * unchanged; `reversed`: earlier postings reversed because their source changed or is gone.
 */
const hasAp = (db: DB) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ap_invoices'").get();

/** The Dutch purchase VAT code an invoice's own tax amounts to (21% or 9% of its net, within a cent), or null. */
function dutchVat(netCents: number, vatCents: number): "P21" | "P9" | null {
  if (Math.abs(Math.round((netCents * 21) / 100) - vatCents) <= 1) return "P21";
  if (Math.abs(Math.round((netCents * 9) / 100) - vatCents) <= 1) return "P9";
  return null;
}

export function syncLedger(db: DB, now = new Date()): { posted: number; already: number; reversed: number } {
  const moved = journal(db);
  const lines = [...openingLines(db, moved), ...moved];
  const want = new Map<string, { date: string; description: string; doc_ref: string; pair: LineInput[] }>();
  const seen = new Map<string, number>();
  const invoiceOf = db.prepare("SELECT invoice_no FROM transfers WHERE request_id = ?");
  for (const l of lines) {
    const c = cents(l.amount);
    if (c === 0) continue;
    const base = identityOf(db, l);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    // A payout that settles an inbox payable names the invoice on its 2100 line, as the accrual does, so ageing nets them.
    const settles = l.source === "transfer" && l.gl_account === "2100" ? (invoiceOf.get(l.ref) as { invoice_no: string } | undefined)?.invoice_no : undefined;
    const gl: LineInput = { account: l.gl_account, currency: l.currency, cost_centre: l.cost_centre || undefined, party: l.counterparty || undefined, memo: l.rule || undefined, ...(settles ? { doc_ref: settles } : {}) };
    const bank: LineInput = { account: l.bank_account, currency: l.currency };
    want.set(n === 1 ? base : `${base}#${n}`, { date: l.date, description: l.description, doc_ref: l.proof || l.ref, pair: c > 0 ? [{ ...bank, debit: c }, { ...gl, credit: c }] : [{ ...gl, debit: -c }, { ...bank, credit: -c }] });
  }
  // The payables inbox's invoices the books hold, on receipt: the expense (with its Dutch VAT code when the invoice's
  // tax is 21% or 9% of its net, so it counts in 5b) and input VAT against what is owed (2100), the same entries as the
  // inbox's CSV sink (src/ap/books.ts accrualEntries). One posting per invoice; one that leaves the books (rejected) is
  // reversed like any other source that is gone.
  for (const inv of hasAp(db) ? apInvoices(db).filter((i) => i.doc_kind !== "credit_note" && bookable(i)) : []) {
    const key = ledgerInvoiceNo(inv.invoice_no, inv.vendor);
    const es = accrualEntries(inv);
    const vat = es.find((e) => e.account === "1510");
    const net = es[0]!;
    const code = vat ? dutchVat(toCents(net.debit), toCents(vat.debit)) : null;
    const pair: LineInput[] = es.map((e) => {
      const debit = e.debit ? toCents(e.debit) : 0;
      const credit = e.credit ? toCents(e.credit) : 0;
      const base: LineInput = { account: e.account, currency: e.currency, ...(debit ? { debit } : { credit }), party: inv.vendor, memo: e.memo };
      if (e === net) return { ...base, ...(inv.cost_centre ? { cost_centre: inv.cost_centre } : {}), ...(code ? { vat_code: code, vat_cents: toCents(vat!.debit) } : {}) };
      if (e.account === "2100") return { ...base, doc_ref: key, ...(inv.due_date ? { due_date: inv.due_date } : {}) };
      return base;
    });
    want.set(`ap-accrual|${inv.id}`, { date: net.date, description: `${inv.vendor} invoice ${inv.invoice_no} (received)`, doc_ref: key, pair });
  }

  const standing = new Map<string, Active>();
  const extra: Active[] = [];
  for (const a of activeFeed(db)) {
    const had = standing.get(a.base);
    if (had) extra.push(had);
    standing.set(a.base, a);
  }
  let posted = 0;
  let already = 0;
  let reversed = 0;
  for (const [key, { date, description, doc_ref, pair }] of want) {
    const a = standing.get(key);
    standing.delete(key);
    if (a && a.shape === shape(pair.map((p) => ({ account: p.account, debit: p.debit ?? 0, credit: p.credit ?? 0, currency: p.currency })))) { already += 1; continue; }
    if (a) { reverseEntry(db, a.entry_id, "its source changed", FEED_ACTOR, now); reversed += 1; }
    const v = lastVersion(db, key) + 1;
    const r = postEntry(db, { date, description, created_by: FEED_ACTOR, source_key: v === 1 ? key : `${key}@v${v}`, doc_ref, lines: pair }, now);
    if (r.duplicate) already += 1;
    else posted += 1;
  }
  // What the records no longer show (a card charge reversed, a duplicate merged away) is reversed, never deleted.
  for (const a of [...standing.values(), ...extra]) {
    reverseEntry(db, a.entry_id, "its source no longer shows this movement", FEED_ACTOR, now);
    reversed += 1;
  }
  return { posted, already, reversed };
}
