// The money loop in short, for Purser Cloud's Cash & FX and Receivables screens (v1.5.1): what the runner's own dashboard
// shows at GET /api/treasury (./view.ts), as the runner reads it from its ledger, in a shape the cloud keeps per company
// (cloud/src/moneyLoop.ts) and pushes with its sync (src/cloudsync/client.ts batchesFor, the first batch), as it pushes
// the authority map and the compliance summary. The cloud never computes it: it holds no receivables table, no floors
// and no FX threshold, so it shows what the runner sent, labelled with the day it was read.
//
// What goes: cash per currency with the CFO's floors, the 13-week forecast in short (per week and currency: in, out and
// the closing balance against its floor), the FX exposure with the advisor's decision per currency, the conversions the
// advisor filed for the CFO's passkey (proposals; their status, never a way to approve them), and the receivables:
// invoices by number and amount, the payments matched to them, the review queue and the reminder steps. What never
// goes: a customer's name or contact address, a payer's name, a reminder's text (src/receivables/ar.ts keeps those on
// the runner); a payment's reference to review goes without the names, accounts and e-mail addresses in it
// (referenceForCloud). Read only; nothing here moves money or files anything.

import type { DB } from "../db/open.js";
import { agedDebtors, AR_BUCKETS, arInvoices, referenceForCloud, reviewQueue, type ArBucket } from "../receivables/ar.js";
import { toCents } from "../lib/money.js";
import { fxThresholdCents, ledgerForecast } from "./advisor.js";
import type { Forecast } from "./forecastCore.js";
import { fxExposure, type FxAdvice } from "./fxCore.js";

/** What the advisor made of a currency's exposure (fxCore's notes, as a word the console says in its own language). */
export type FxDecision = "none" | "proposal" | "below_threshold" | "no_threshold" | "no_rate" | "no_source" | "not_priced";

export interface MoneyLoopSnapshot {
  generated_at: string;
  as_of: string;
  money: string;
  cash: { currency: string; cents: number; floor_cents: number }[];
  forecast: {
    opening_source: string;
    weeks: { week: number; from: string; to: string; rows: { currency: string; in_cents: number; out_cents: number; closing_cents: number; below_floor: boolean }[] }[];
    currencies: { currency: string; opening_cents: number; in_cents: number; out_cents: number; closing_cents: number; min_closing_cents: number; min_week: number; floor_cents: number; below_floor_weeks: number[] }[];
    excluded: { ref: string; currency: string; cents: number; why: string }[];
  };
  fx: {
    threshold_eur_cents: number | null;
    exposures: { currency: string; min_closing_cents: number; min_week: number; floor_cents: number; shortfall_cents: number; spare_cents: number; eur_cents: number | null; decision: FxDecision }[];
    proposals: { proposal_id: string; status: string; buy_currency: string; buy_cents: number; sell_currency: string; sell_max_cents: number; indicative_sell_cents: number; rate: string; rate_at: string; created_at: string; expires_at: string; week: number | null }[];
  };
  receivables: {
    invoices: { invoice_no: string; currency: string; amount_cents: number; paid_cents: number; issue_date: string; due_date: string; status: string; days_overdue: number; bucket: ArBucket; pay_link: boolean }[];
    aged: { currency: string; buckets: Record<ArBucket, number>; not_due_cents: number }[];
    payments: { payment_id: string; currency: string; amount_cents: number; invoice_no: string | null; outcome: string; applied_cents: number; written_off_cents: number; suspense_cents: number; received_at: string }[];
    review: { payment_id: string; currency: string; amount_cents: number; reference: string; reason: string; created_at: string }[];
    dunning: { invoice_no: string; stage: number; due_on: string }[];
  };
}

/** The most of each list the snapshot carries, newest first where there are more (the cloud's schema holds the same). */
export const MONEY_LOOP_LIMITS = { invoices: 200, payments: 200, review: 100, dunning: 300, proposals: 20, excluded: 100 } as const;

const DAY = 86_400_000;
const has = (db: DB, t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Each short currency's decision, from the advisor's advice when the caller priced it, else from what is filed. */
function decisionOf(currency: string, shortfall: number, threshold: number | null, advice: FxAdvice | undefined, filed: Set<string>): { decision: FxDecision; eur: number | null } {
  if (shortfall <= 0) return { decision: "none", eur: null };
  if (filed.has(currency)) {
    const s = advice?.suggestions.find((x) => x.buy_currency === currency);
    return { decision: "proposal", eur: s ? s.eur_cents : currency === "EUR" ? shortfall : null };
  }
  if (threshold === null) return { decision: "no_threshold", eur: currency === "EUR" ? shortfall : null };
  if (!advice) return { decision: "not_priced", eur: currency === "EUR" ? shortfall : null };
  const s = advice.suggestions.find((x) => x.buy_currency === currency);
  if (s) return { decision: "proposal", eur: s.eur_cents };
  const note = advice.notes.find((n) => n.startsWith(`${currency} is short`)) ?? "";
  const eur = /\(about EUR (-?\d+\.\d{2})\)/.exec(note);
  if (/below the CFO's threshold/.test(note)) return { decision: "below_threshold", eur: eur ? toCents(eur[1]!) : currency === "EUR" ? shortfall : null };
  if (/no rate to EUR/.test(note)) return { decision: "no_rate", eur: null };
  if (/funding question/.test(note)) return { decision: "no_source", eur: currency === "EUR" ? shortfall : null };
  return { decision: "not_priced", eur: currency === "EUR" ? shortfall : null };
}

/**
 * The money loop on `now`'s day. `advice` is the advisor's latest, when the caller read indicative rates for it
 * (npm run treasury -- fx); without it a shortfall the CFO has nothing filed for reads "not priced yet".
 */
export function moneyLoopSnapshot(db: DB, now: Date, advice?: FxAdvice, forecast?: Forecast): MoneyLoopSnapshot {
  const asOf = now.toISOString().slice(0, 10);
  const f = forecast ?? ledgerForecast(db, asOf);
  const threshold = fxThresholdCents(db);
  const proposals = (has(db, "proposals") ? db.prepare("SELECT proposal_id, status, terms_json, created_at FROM proposals WHERE kind = 'fx_conversion' ORDER BY created_at DESC, proposal_id DESC LIMIT ?").all(MONEY_LOOP_LIMITS.proposals) as { proposal_id: string; status: string; terms_json: string; created_at: string }[] : [])
    .map((p) => {
      const t = JSON.parse(p.terms_json) as Record<string, string>;
      const week = f.currencies.find((c) => c.currency === t.buy_currency)?.min_week ?? null;
      return { proposal_id: p.proposal_id, status: p.status, buy_currency: t.buy_currency!, buy_cents: toCents(t.buy_amount!), sell_currency: t.sell_currency!, sell_max_cents: toCents(t.sell_max!),
        indicative_sell_cents: toCents(t.indicative_sell!), rate: String(t.indicative_rate), rate_at: String(t.rate_at), created_at: p.created_at, expires_at: String(t.expires_at), week };
    });
  const waiting = new Set(proposals.filter((p) => ["PENDING_APPROVAL", "APPROVED", "EXECUTING"].includes(p.status)).map((p) => p.buy_currency));
  const exposures = fxExposure(f).map((e) => {
    const d = decisionOf(e.currency, e.shortfall_cents, threshold, advice, waiting);
    return { currency: e.currency, min_closing_cents: e.min_closing_cents, min_week: e.min_week, floor_cents: e.floor_cents, shortfall_cents: e.shortfall_cents, spare_cents: e.spare_cents, eur_cents: d.eur, decision: d.decision };
  });
  const aged = agedDebtors(db, asOf);
  const ar = arInvoices(db).sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.invoice_no.localeCompare(a.invoice_no)).slice(0, MONEY_LOOP_LIMITS.invoices);
  const late = (due: string) => Math.max(0, Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY));
  const bucket = (d: number): ArBucket => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
  const payments = (db.prepare(`SELECT payment_id, currency, amount_cents, invoice_no, outcome, applied_cents, written_off_cents, suspense_cents, received_at FROM ar_payments ORDER BY received_at DESC, payment_id DESC LIMIT ?`)
    .all(MONEY_LOOP_LIMITS.payments) as MoneyLoopSnapshot["receivables"]["payments"]);
  const review = reviewQueue(db).slice(-MONEY_LOOP_LIMITS.review).map((r) => ({ payment_id: r.payment_id, currency: r.currency, amount_cents: toCents(r.amount), reference: cut(referenceForCloud(db, r.payment_id, r.reference), 140), reason: cut(r.reason, 300), created_at: r.created_at }));
  const dunning = (db.prepare(`SELECT d.invoice_no, d.stage, d.due_on FROM ar_dunning d JOIN ar_invoices i USING (invoice_no) WHERE i.status IN ('OPEN', 'PARTIAL') ORDER BY d.due_on DESC, d.invoice_no, d.stage LIMIT ?`)
    .all(MONEY_LOOP_LIMITS.dunning) as { invoice_no: string; stage: number; due_on: string }[]).reverse();
  return {
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    as_of: asOf,
    money: "test money (Airwallex sandbox)",
    cash: f.currencies.map((c) => ({ currency: c.currency, cents: c.opening_cents, floor_cents: c.floor_cents })),
    forecast: {
      opening_source: f.opening_source,
      weeks: f.weeks.map((w) => ({ week: w.week, from: w.from, to: w.to, rows: w.rows.map((r) => ({ currency: r.currency, in_cents: r.receivables_cents, out_cents: r.payables_cents + r.card_recurring_cents + r.card_other_cents, closing_cents: r.closing_cents, below_floor: r.below_floor })) })),
      currencies: f.currencies.map((c) => ({ ...c, below_floor_weeks: [...c.below_floor_weeks] })),
      excluded: f.excluded.slice(0, MONEY_LOOP_LIMITS.excluded).map((x) => ({ ...x, why: cut(x.why, 200) })),
    },
    fx: { threshold_eur_cents: threshold, exposures, proposals },
    receivables: {
      invoices: ar.map((i) => {
        const open = i.status === "OPEN" || i.status === "PARTIAL";
        const d = open ? late(i.due_date) : 0;
        return { invoice_no: i.invoice_no, currency: i.currency, amount_cents: i.amount_cents, paid_cents: i.paid_cents, issue_date: i.issue_date, due_date: i.due_date, status: i.status, days_overdue: d, bucket: bucket(d), pay_link: !!(i.link_id && i.link_active) };
      }),
      aged: Object.entries(aged.totals).sort(([a], [b]) => a.localeCompare(b)).map(([currency, t]) => ({ currency, buckets: Object.fromEntries(AR_BUCKETS.map((k) => [k, t[k]])) as Record<ArBucket, number>, not_due_cents: aged.not_due[currency] ?? 0 })),
      payments, review, dunning,
    },
  };
}

