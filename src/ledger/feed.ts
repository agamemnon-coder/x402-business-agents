// The ledger fed from what Purser already records (bookkeeping core, decision 2). Every journal line that
// src/accounting/gl.ts derives (and the opening balances books.ts adds) posts once as a two-line entry: money in debits
// the bank and credits the GL account, money out the other way round, exactly as doubleEntry does. Its source key is
// built from the line's own fields, so a second sync posts nothing new. No VAT code is set: Purser's records do not say
// which VAT applies, and the ledger does not guess.

import { journal, type JournalLine } from "../accounting/gl.js";
import { openingLines } from "../accounting/books.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { postEntry, type LineInput } from "./core.js";

export const FEED_ACTOR = "purser-feed";

const cents = (amount: string) => (amount.startsWith("-") ? -toCents(amount.slice(1)) : toCents(amount));

function keyOf(l: JournalLine): string {
  return [l.source, l.ref, l.date, l.gl_account, l.bank_account, l.currency].join("|");
}

/** Posts every movement not yet in the ledger. `already`: lines that were posted by an earlier sync. */
export function syncLedger(db: DB, now = new Date()): { posted: number; already: number } {
  const moved = journal(db);
  const lines = [...openingLines(db, moved), ...moved];
  const seen = new Map<string, number>();
  let posted = 0;
  let already = 0;
  for (const l of lines) {
    const c = cents(l.amount);
    if (c === 0) continue;
    const base = keyOf(l);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}#${n}`;
    const gl: LineInput = { account: l.gl_account, currency: l.currency, cost_centre: l.cost_centre || undefined, party: l.counterparty || undefined, memo: l.rule || undefined };
    const bank: LineInput = { account: l.bank_account, currency: l.currency };
    const pair: LineInput[] = c > 0 ? [{ ...bank, debit: c }, { ...gl, credit: c }] : [{ ...gl, debit: -c }, { ...bank, credit: -c }];
    const r = postEntry(db, { date: l.date, description: l.description, created_by: FEED_ACTOR, source_key: key, doc_ref: l.proof || l.ref, lines: pair }, now);
    if (r.duplicate) already += 1;
    else posted += 1;
  }
  return { posted, already };
}
