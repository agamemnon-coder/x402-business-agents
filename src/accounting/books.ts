// The finance view, double entry light: every GL journal line (src/accounting/gl.ts) becomes a debit and a credit of
// the same amount, in integer cents and in its own currency. Money in: debit the bank account, credit the GL account;
// money out: the other way round. So debits equal credits in every currency, which the tests check for any journal.
// Only movements Purser booked are here: opening balances and anything paid outside Purser are not.

import { CHART, COST_CENTRE_NAMES } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { journal, type JournalLine } from "./gl.js";

export interface Posting {
  entry: string;
  date: string;
  account: string;
  account_name: string;
  debit_cents: number;
  credit_cents: number;
  currency: string;
  cost_centre: string;
  ref: string;
  description: string;
  proof: string;
}

export interface TrialRow { account: string; name: string; currency: string; debit_cents: number; credit_cents: number; balance_cents: number }

const cents = (amount: string) => (amount.startsWith("-") ? -toCents(amount.slice(1)) : toCents(amount));

/** Two postings per journal line: one entry, one debit, one credit, same currency and integer cents. */
export function doubleEntry(lines: JournalLine[]): Posting[] {
  const out: Posting[] = [];
  lines.forEach((l, i) => {
    const c = cents(l.amount);
    if (c === 0) return;
    const entry = `J-${String(i + 1).padStart(5, "0")}`;
    const base = { entry, date: l.date, currency: l.currency, cost_centre: l.cost_centre, ref: l.ref, description: l.description, proof: l.proof };
    const post = (account: string, debit: number, credit: number): Posting => ({ ...base, account, account_name: CHART[account] ?? "", debit_cents: debit, credit_cents: credit });
    // Money in (c > 0): debit the bank, credit the GL account. Money out: debit the GL account, credit the bank.
    if (c > 0) out.push(post(l.bank_account, c, 0), post(l.gl_account, 0, c));
    else out.push(post(l.gl_account, -c, 0), post(l.bank_account, 0, -c));
  });
  return out;
}

/** Per account and currency: debits, credits and the balance (debit minus credit). */
export function trialBalance(postings: Posting[]): TrialRow[] {
  const rows = new Map<string, TrialRow>();
  for (const p of postings) {
    const k = `${p.account}|${p.currency}`;
    const r = rows.get(k) ?? { account: p.account, name: p.account_name, currency: p.currency, debit_cents: 0, credit_cents: 0, balance_cents: 0 };
    r.debit_cents += p.debit_cents;
    r.credit_cents += p.credit_cents;
    r.balance_cents = r.debit_cents - r.credit_cents;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => a.account.localeCompare(b.account) || a.currency.localeCompare(b.currency));
}

export interface Books {
  postings: Posting[];
  trial: TrialRow[];
  /** True when debits equal credits in every currency. */
  balanced: boolean;
  /** What moved through each bank account (12xx), per currency: not a balance, opening balances are not booked. */
  cash: { account: string; name: string; currency: string; moved_cents: number }[];
  /** Expenses per cost centre and currency (accounts 5xxx and 6xxx). */
  spend: { cost_centre: string; name: string; currency: string; cents: number }[];
}

export function books(db: DB): Books {
  const postings = doubleEntry(journal(db));
  const trial = trialBalance(postings);
  const byCur = new Map<string, number>();
  for (const t of trial) byCur.set(t.currency, (byCur.get(t.currency) ?? 0) + t.balance_cents);
  const spend = new Map<string, Books["spend"][number]>();
  for (const p of postings) {
    if (!/^[56]/.test(p.account) || !p.cost_centre) continue;
    const k = `${p.cost_centre}|${p.currency}`;
    const s = spend.get(k) ?? { cost_centre: p.cost_centre, name: COST_CENTRE_NAMES[p.cost_centre] ?? p.cost_centre, currency: p.currency, cents: 0 };
    s.cents += p.debit_cents - p.credit_cents;
    spend.set(k, s);
  }
  return {
    postings, trial, balanced: [...byCur.values()].every((v) => v === 0),
    cash: trial.filter((t) => t.account.startsWith("12")).map((t) => ({ account: t.account, name: t.name, currency: t.currency, moved_cents: t.balance_cents })),
    spend: [...spend.values()].sort((a, b) => a.cost_centre.localeCompare(b.cost_centre) || a.currency.localeCompare(b.currency)),
  };
}

const COLUMNS = ["entry", "date", "account", "account_name", "debit", "credit", "currency", "cost_centre", "ref", "description", "proof"] as const;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The postings as CSV for an ERP or a bookkeeper: amounts with two decimals, empty when zero. */
export function booksCsv(postings: Posting[]): string {
  const rows = postings.map((p) => [p.entry, p.date, p.account, p.account_name, p.debit_cents ? fromCents(p.debit_cents) : "", p.credit_cents ? fromCents(p.credit_cents) : "", p.currency, p.cost_centre, p.ref, p.description, p.proof].map(cell).join(","));
  return [COLUMNS.join(","), ...rows, ""].join("\n");
}

export function booksJson(b: Books): string {
  return JSON.stringify(b, null, 2) + "\n";
}
