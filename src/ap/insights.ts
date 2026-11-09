// Payables, part 4: the insight panel (the "BI"), every figure from the ledger: what is open per currency, what falls
// due in 7 and 30 days, what is overdue, what is blocked and why, what waits, spend per supplier over 90 days, a
// supplier whose price rose, how long payment takes, and the SWIFT fees and FX Airwallex actually charged.

import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { skeleton } from "../policy/fraudCore.js";
import { bookable } from "./books.js";
import { asAmounts, creditUnverified, net } from "./credits.js";
import { ledgerInvoiceNo } from "./ledgerKey.js";
import { apInvoices, type ApInvoiceRow } from "./store.js";

export interface Amounts { currency: string; total: string; count: number }
export interface Insights {
  as_of: string;
  open: Amounts[];
  /** Credit notes set against open invoices of the same supplier and currency (its own line, never folded in). */
  credits: Amounts[];
  /** What is open after those credits. */
  open_net: Amounts[];
  /** Credit with no open invoice to set it against: owed back by the supplier. */
  credits_left: { vendor: string; currency: string; total: string }[];
  /** Credit notes no person has accepted yet: shown apart, never set against anything (red team round 4). */
  credits_unverified: Amounts[];
  due_7: Amounts[];
  due_30: Amounts[];
  overdue: Amounts[];
  waiting: { needs_vendor: number; needs_review: number; waiting_cfo: number };
  blocked: { count: number; reasons: { code: string; count: number }[] };
  spend_90d: { vendor: string; currency: string; total: string; count: number }[];
  price_rises: { vendor: string; currency: string; last: string; usual: string; change_pct: number }[];
  time_to_pay: { paid: number; median_hours: number | null };
  costs: { swift_fees: Amounts[]; fx: { conversions: number; bought: string; sold: string } };
}

/** A rise smaller than this is noise. */
export const PRICE_RISE_MIN_PCT = 5;

const MONEY = /^\d+\.\d{2}$/;
const OPEN = new Set(["ready", "waiting_cfo", "needs_vendor", "needs_review"]);

function byCurrency(invs: { currency: string; total: string }[]): Amounts[] {
  const m = new Map<string, { cents: number; count: number }>();
  for (const i of invs) {
    if (!MONEY.test(i.total) || !i.currency) continue;
    const x = m.get(i.currency) ?? { cents: 0, count: 0 };
    m.set(i.currency, { cents: x.cents + toCents(i.total), count: x.count + 1 });
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, x]) => ({ currency, total: fromCents(x.cents), count: x.count }));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function insights(db: DB, asOf = new Date()): Insights {
  // A credit note is money the supplier owes back, never an amount open to pay (screenshot pass S2): left out here; a
  // person sets it against the supplier's invoices.
  const every = apInvoices(db);
  const all = every.filter((i) => i.doc_kind !== "credit_note");
  const today = asOf.toISOString().slice(0, 10);
  const open = all.filter((i) => OPEN.has(i.status));
  const netting = net(open, every);
  const due = (to: string) => open.filter((i) => i.due_date && i.due_date >= today && i.due_date <= to);

  const reasons = new Map<string, number>();
  const blocked = all.filter((i) => i.status === "blocked");
  for (const i of blocked) for (const f of i.findings.filter((x) => x.level === "block")) reasons.set(f.code, (reasons.get(f.code) ?? 0) + 1);

  const since = addDays(asOf, -90);
  const spend = new Map<string, { vendor: string; currency: string; cents: number; count: number }>();
  for (const i of all.filter((x) => bookable(x) && x.received_at.slice(0, 10) >= since)) {
    const k = `${skeleton(i.vendor)}|${i.currency}`;
    const x = spend.get(k) ?? { vendor: i.vendor, currency: i.currency, cents: 0, count: 0 };
    spend.set(k, { ...x, cents: x.cents + toCents(i.total), count: x.count + 1 });
  }

  const rises: Insights["price_rises"] = [];
  const byVendor = new Map<string, ApInvoiceRow[]>();
  for (const i of all.filter((x) => x.status !== "blocked" && x.status !== "rejected" && x.doc_kind === "invoice" && MONEY.test(x.total))) {
    const k = `${skeleton(i.vendor)}|${i.currency}`;
    byVendor.set(k, [...(byVendor.get(k) ?? []), i]);
  }
  for (const list of byVendor.values()) {
    if (list.length < 3) continue;
    const last = list.at(-1)!;
    const usual = median(list.slice(0, -1).map((i) => toCents(i.total)));
    const pct = Math.round(((toCents(last.total) - usual) / usual) * 100);
    if (usual > 0 && pct >= PRICE_RISE_MIN_PCT) rises.push({ vendor: last.vendor, currency: last.currency, last: last.total, usual: fromCents(usual), change_pct: pct });
  }

  const paid = all.filter((i) => i.status === "paid" && i.paid_at);
  const hours = paid.map((i) => (Date.parse(i.paid_at!) - Date.parse(i.received_at)) / 3_600_000);

  // What Airwallex charged for the payables it paid: the SWIFT fee on each transfer, and the FX bought for the shortfall.
  const paidNos = new Set(paid.map((i) => ledgerInvoiceNo(i.invoice_no, i.vendor)));
  const fees = (db.prepare("SELECT invoice_no, fee_actual FROM transfers WHERE status = 'PAID' AND fee_actual IS NOT NULL").all() as { invoice_no: string; fee_actual: string }[])
    .filter((t) => paidNos.has(t.invoice_no) && /^[A-Z]{3} \d+\.\d{2}$/.test(t.fee_actual))
    .map((t) => ({ currency: t.fee_actual.slice(0, 3), total: t.fee_actual.slice(4) }));
  let conversions = 0;
  let bought = 0;
  let sold = 0;
  for (const i of paid) {
    if (!i.proposal_id) continue;
    const p = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ? AND status = 'EXECUTED'").get(i.proposal_id) as { terms_json: string } | undefined;
    const c = p ? (JSON.parse(p.terms_json) as { conversion?: { buy_amount: string; sell_amount: string } | null }).conversion : null;
    if (!c) continue;
    conversions += 1;
    bought += toCents(c.buy_amount);
    sold += toCents(c.sell_amount);
  }

  return {
    as_of: asOf.toISOString(),
    open: byCurrency(open),
    credits: asAmounts(netting.applied),
    open_net: asAmounts(netting.net),
    credits_left: netting.left.map((x) => ({ vendor: x.vendor, currency: x.currency, total: fromCents(x.cents) })),
    credits_unverified: byCurrency(every.filter(creditUnverified)),
    due_7: byCurrency(due(addDays(asOf, 7))),
    due_30: byCurrency(due(addDays(asOf, 30))),
    overdue: byCurrency(open.filter((i) => i.due_date && i.due_date < today)),
    waiting: {
      needs_vendor: all.filter((i) => i.status === "needs_vendor").length,
      needs_review: all.filter((i) => i.status === "needs_review").length,
      waiting_cfo: all.filter((i) => i.status === "waiting_cfo").length,
    },
    blocked: { count: blocked.length, reasons: [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })) },
    spend_90d: [...spend.values()].sort((a, b) => b.cents - a.cents).map((x) => ({ vendor: x.vendor, currency: x.currency, total: fromCents(x.cents), count: x.count })),
    price_rises: rises,
    time_to_pay: { paid: paid.length, median_hours: hours.length ? Math.round(median(hours.map((h) => Math.round(h * 10)))) / 10 : null },
    costs: { swift_fees: byCurrency(fees), fx: { conversions, bought: `EUR ${fromCents(bought)}`, sold: `USD ${fromCents(sold)}` } },
  };
}
