// The finance view, double entry light: every GL journal line (src/accounting/gl.ts) becomes a debit and a credit of
// the same amount, in integer cents and in its own currency. Money in: debit the bank account, credit the GL account;
// money out: the other way round. So debits equal credits in every currency, which the tests check for any journal.
// The money that was there before the run is booked first, against owner's equity (3000): the owner's funding of the
// Metal account, and Airwallex's balances as first read (less what Purser booked before that read). Anything paid
// outside Purser is not here.

import { bankAccountFor, CHART, COST_CENTRE_NAMES } from "../config/gl.js";
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
    const entry = l.source === "opening" ? `O-${String(i + 1).padStart(3, "0")}` : `J-${String(i + 1).padStart(5, "0")}`;
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
  /** Each bank account (12xx) per currency: what was there before the run, what moved, and what is there now. */
  cash: { account: string; name: string; currency: string; opening_cents: number; in_cents: number; out_cents: number; moved_cents: number; closing_cents: number }[];
  /** Expenses per cost centre and currency (accounts 5xxx and 6xxx). */
  spend: { cost_centre: string; name: string; currency: string; cents: number }[];
}

const EQUITY = "3000";

/**
 * The money that was there before Purser moved any: one line per bank account and currency, money in against owner's
 * equity. Metal: each funding of the business account by its owner. Airwallex: its available balance at the first
 * read, less the movements Purser booked before that read (they are inside that balance already).
 */
export function openingLines(db: DB, moved: JournalLine[]): JournalLine[] {
  const out: JournalLine[] = [];
  const line = (l: Pick<JournalLine, "date" | "ref" | "description" | "bank_account" | "currency" | "proof" | "rule"> & { cents: number }): JournalLine => ({
    date: l.date, source: "opening", ref: l.ref, description: l.description, counterparty: "owner", agent: "", cost_centre: "", gl_account: EQUITY, gl_name: CHART[EQUITY] ?? "",
    bank_account: l.bank_account, amount: fromCents(l.cents), currency: l.currency, proof: l.proof, approval: "", rule: l.rule,
  });
  for (const f of db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'business.funded' ORDER BY seq").all() as { ts: string; payload_json: string }[]) {
    const p = JSON.parse(f.payload_json) as { amount?: string; tx?: string };
    if (!p.amount || !/^\d+\.\d{2}$/.test(p.amount) || toCents(p.amount) === 0) continue;
    out.push(line({ date: f.ts, ref: "funding", description: "Owner funds the business account on Metal", bank_account: "1210", currency: "USDZ", cents: toCents(p.amount), proof: p.tx ?? "", rule: "owner funding" }));
  }
  const first = db.prepare("SELECT taken_at, label, json FROM balance_snapshots ORDER BY id LIMIT 1").get() as { taken_at: string; label: string; json: string } | undefined;
  if (first) {
    const bal = JSON.parse(first.json) as Record<string, { availableCents?: number } | undefined>;
    // Every currency Airwallex holds, each on its own bank account (EUR 1200, USD 1201, GBP 1202, others 1203).
    for (const cur of Object.keys(bal).filter((c) => /^[A-Z]{3}$/.test(c)).sort()) {
      const bank = bankAccountFor(cur);
      const available = bal[cur]?.availableCents;
      if (typeof available !== "number") continue;
      const before = moved.filter((m) => m.bank_account === bank && m.currency === cur && Date.parse(m.date) < Date.parse(first.taken_at)).reduce((s, m) => s + cents(m.amount), 0);
      const opening = available - before;
      if (opening <= 0) continue;
      out.push(line({ date: first.taken_at, ref: `balance:${first.label}`, description: `Airwallex ${cur} balance before the run (sandbox test money)`, bank_account: bank, currency: cur, cents: opening, proof: `Airwallex balance read ${first.taken_at}`, rule: "opening balance" }));
    }
  }
  return out;
}

export function books(db: DB): Books {
  const moved = journal(db);
  const postings = doubleEntry([...openingLines(db, moved), ...moved]);
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
    cash: trial.filter((t) => t.account.startsWith("12")).map((t) => {
      const mine = postings.filter((p) => p.account === t.account && p.currency === t.currency);
      const opening = mine.filter((p) => p.entry.startsWith("O-")).reduce((s, p) => s + p.debit_cents - p.credit_cents, 0);
      const moves = mine.filter((p) => !p.entry.startsWith("O-"));
      const inCents = moves.reduce((s, p) => s + p.debit_cents, 0);
      const outCents = moves.reduce((s, p) => s + p.credit_cents, 0);
      return { account: t.account, name: t.name, currency: t.currency, opening_cents: opening, in_cents: inCents, out_cents: outCents, moved_cents: inCents - outCents, closing_cents: t.balance_cents };
    }),
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

const signed = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));

/** The Books screen on the dashboard: the trial balance, cash and spend as text amounts, and the latest postings. */
export interface BooksView {
  balanced: boolean;
  /** Debit and credit totals, and the balance on its own side (the bookkeeper's way: no minus signs). */
  trial: { account: string; name: string; currency: string; debit: string; credit: string; balance: string; balance_debit: string; balance_credit: string }[];
  cash: { account: string; name: string; currency: string; opening: string; in: string; out: string; moved: string; closing: string }[];
  spend: { cost_centre: string; name: string; currency: string; amount: string }[];
  /** The latest postings, newest first; the full set is in the CSV export (npm run books -- --csv). */
  postings: { entry: string; date: string; account: string; account_name: string; debit: string; credit: string; currency: string; cost_centre: string; description: string }[];
  total_postings: number;
}

const SCREEN_POSTINGS = 20;

export function booksView(db: DB): BooksView {
  const b = books(db);
  return {
    balanced: b.balanced,
    trial: b.trial.map((t) => ({
      account: t.account, name: t.name, currency: t.currency, debit: fromCents(t.debit_cents), credit: fromCents(t.credit_cents), balance: signed(t.balance_cents),
      balance_debit: t.balance_cents > 0 ? fromCents(t.balance_cents) : "", balance_credit: t.balance_cents < 0 ? fromCents(-t.balance_cents) : "",
    })),
    cash: b.cash.map((c) => ({ account: c.account, name: c.name, currency: c.currency, opening: signed(c.opening_cents), in: fromCents(c.in_cents), out: fromCents(c.out_cents), moved: signed(c.moved_cents), closing: signed(c.closing_cents) })),
    spend: b.spend.map((s) => ({ cost_centre: s.cost_centre, name: s.name, currency: s.currency, amount: signed(s.cents) })),
    postings: b.postings.slice(-SCREEN_POSTINGS).reverse().map((p) => ({
      entry: p.entry, date: p.date, account: p.account, account_name: p.account_name, debit: p.debit_cents ? fromCents(p.debit_cents) : "",
      credit: p.credit_cents ? fromCents(p.credit_cents) : "", currency: p.currency, cost_centre: p.cost_centre, description: p.description,
    })),
    total_postings: b.postings.length,
  };
}
