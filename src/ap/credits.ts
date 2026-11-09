// Credit notes set against a supplier's open invoices. A credit note is money the supplier owes back: it lowers what is
// open to that supplier in the same currency, down to zero and no further, and is shown as its own line. What it
// cannot be set against (no open invoice, or more credit than invoices) is listed as owed back by that supplier. A
// credit note is never paid out by itself (src/ap/pay.ts refuses it).

import { fromCents, toCents } from "../lib/money.js";
import { skeleton } from "../policy/fraudCore.js";
import type { ApInvoiceRow } from "./store.js";

const MONEY = /^\d+\.\d{2}$/;
/** A credit note that still counts: not blocked (a possible fraud) and not rejected by a person. */
export const creditCounts = (i: ApInvoiceRow) => i.doc_kind === "credit_note" && i.status !== "blocked" && i.status !== "rejected" && MONEY.test(i.total) && !!i.currency;

export interface Netting {
  /** Per currency: the credit set against open invoices (count: credit notes that took part). */
  applied: { currency: string; cents: number; count: number }[];
  /** Per currency: what is open after the credits (count: open invoices). */
  net: { currency: string; cents: number; count: number }[];
  /** Per supplier and currency: credit with no open invoice left to set it against, owed back. */
  left: { vendor: string; currency: string; cents: number }[];
}

/** Sets `credits` against `open` invoices, per supplier (by its name's skeleton) and currency. */
export function net(open: ApInvoiceRow[], credits: ApInvoiceRow[]): Netting {
  const key = (i: ApInvoiceRow) => `${skeleton(i.vendor)}|${i.currency}`;
  const owed = new Map<string, { currency: string; cents: number; count: number }>();
  for (const i of open.filter((x) => MONEY.test(x.total) && x.currency)) {
    const x = owed.get(key(i)) ?? { currency: i.currency, cents: 0, count: 0 };
    owed.set(key(i), { ...x, cents: x.cents + toCents(i.total), count: x.count + 1 });
  }
  const credit = new Map<string, { vendor: string; currency: string; cents: number; count: number }>();
  for (const c of credits.filter(creditCounts)) {
    const x = credit.get(key(c)) ?? { vendor: c.vendor, currency: c.currency, cents: 0, count: 0 };
    credit.set(key(c), { ...x, cents: x.cents + toCents(c.total), count: x.count + 1 });
  }
  const applied = new Map<string, { cents: number; count: number }>();
  const netBy = new Map<string, { cents: number; count: number }>();
  const left: Netting["left"] = [];
  for (const [k, o] of owed) {
    const c = credit.get(k);
    const used = Math.min(o.cents, c?.cents ?? 0);
    if (used > 0) {
      const a = applied.get(o.currency) ?? { cents: 0, count: 0 };
      applied.set(o.currency, { cents: a.cents + used, count: a.count + c!.count });
    }
    const n = netBy.get(o.currency) ?? { cents: 0, count: 0 };
    netBy.set(o.currency, { cents: n.cents + o.cents - used, count: n.count + o.count });
  }
  for (const [k, c] of credit) {
    const rest = c.cents - Math.min(owed.get(k)?.cents ?? 0, c.cents);
    if (rest > 0) left.push({ vendor: c.vendor, currency: c.currency, cents: rest });
  }
  const list = (m: Map<string, { cents: number; count: number }>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, x]) => ({ currency, ...x }));
  return { applied: list(applied), net: list(netBy), left: left.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.currency.localeCompare(b.currency)) };
}

export const asAmounts = (xs: { currency: string; cents: number; count: number }[]) => xs.map((x) => ({ currency: x.currency, total: fromCents(x.cents), count: x.count }));
