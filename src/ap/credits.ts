// Credit notes set against a supplier's open invoices. A credit note is money the supplier owes back: it lowers what is
// open to that supplier in the same currency, down to zero and no further, and is shown as its own line. What it
// cannot be set against (no open invoice, or more credit than invoices) is listed as owed back by that supplier. A
// credit note is never paid out by itself (src/ap/pay.ts refuses it).

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { skeleton } from "../policy/fraudCore.js";
import { cleanText } from "./reading.js";
import { apInvoice, type ApInvoiceRow } from "./store.js";

const MONEY = /^\d+\.\d{2}$/;
/** A credit note that may count once a person accepts it: not blocked (a possible fraud), not rejected, with an amount. */
const creditNote = (i: ApInvoiceRow) => i.doc_kind === "credit_note" && i.status !== "blocked" && i.status !== "rejected" && MONEY.test(i.total) && !!i.currency;
/**
 * A credit note that counts: one a person accepted (red team round 4: anyone who can mail the inbox could write a
 * "credit note" in a supplier's name, and it set that supplier's open invoices to zero). Until then it is listed as an
 * unverified credit, apart, and lowers nothing.
 */
export const creditCounts = (i: ApInvoiceRow) => creditNote(i) && !!i.credit_accepted_at;
/** A credit note no person has accepted yet: shown apart, never set against anything. */
export const creditUnverified = (i: ApInvoiceRow) => creditNote(i) && !i.credit_accepted_at;

/** A person accepts a credit note (checked with the supplier): from now on it is set against that supplier's invoices. */
export function acceptCreditNote(db: DB, id: string, who: string, note: string, now = new Date()): ApInvoiceRow {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  if (inv.doc_kind !== "credit_note") throw new Error(`${id} is not a credit note`);
  if (!creditNote(inv)) throw new Error(`${id} is ${inv.status.replace(/_/g, " ")}${MONEY.test(inv.total) ? "" : " and has no plain amount"}: it cannot be accepted`);
  const by = cleanText(who, 80);
  const why = cleanText(note, 300);
  if (!by || !why) throw new Error("say who accepts the credit note and how it was checked with the supplier");
  if (inv.credit_accepted_at) return inv;
  db.transaction(() => {
    db.prepare("UPDATE ap_invoices SET credit_accepted_at = ?, credit_accepted_by = ?, updated_at = ? WHERE id = ? AND credit_accepted_at IS NULL").run(now.toISOString(), by, now.toISOString(), id);
    audit(db, "human", "ap.credit_accepted", id, { by, note: why, vendor: inv.vendor, amount: `${inv.currency} ${inv.total}` }, now);
  }).immediate();
  return apInvoice(db, id)!;
}

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
