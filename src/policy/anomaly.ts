// The anomaly hold (governance, 26 Nov: "people approve what is sensitive"). A supplier payment far outside what its payee
// normally receives goes to the CFO, even within the limit the agent may pay alone up to. CFO policy (src/policy/rules.ts),
// changed only through a policy change approved with Face ID, loosening judged by src/policy/loosens.ts:
//   approval.anomaly_multiple   more than this many times the median of the payee's last paid invoices (default 3; off)
//   approval.anomaly_history    the median is over the payee's last this many paid invoices (default 5)
//   approval.anomaly_first_eur  a first payment to a payee above this many euros (default off)
// What this adds to the Checker's unusual_amount (src/ap/checkerCore.ts, invoices received, fixed factors): it reads
// what was actually PAID (executed payments, as the second key's new-payee rule does: src/policy/secondKey.ts), its
// thresholds are the CFO's, it covers a payee's first payment, and it is enforced where code approves a payment alone
// (approveWithinLimit, src/policy/approvals.ts), whichever path filed it. It holds nothing the CFO signs.

import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { supplierPaymentEur } from "./fourEyes.js";
import { policyValue } from "./rules.js";
import { paidBefore, samePayee, type Paid, type PaymentTerms } from "./secondKey.js";
import { plainCents } from "./withinLimit.js";

export const ANOMALY_HELD = "payment.anomaly_held";

/** The thresholds in force (the rules' fallbacks are the defaults): a multiple (null: off), how many paid invoices, a first-payment amount in cents (null: off). */
export function anomalyThresholds(db: DB): AnomalyThresholds {
  return anomalyThresholdsFrom((key) => policyValue(db, key));
}
export interface AnomalyThresholds { multiple: number | null; history: number; firstEurCents: number | null }

/** The thresholds from any policy lookup: the one in force, or one proposed (the policy simulator, src/policy/simulate.ts). */
export function anomalyThresholdsFrom(value: (key: string) => string): AnomalyThresholds {
  const m = Number(value("approval.anomaly_multiple"));
  const h = Number(value("approval.anomaly_history"));
  return { multiple: m >= 2 ? m : null, history: h >= 1 ? h : 5, firstEurCents: plainCents(value("approval.anomaly_first_eur")) || null };
}

/**
 * Why a supplier payment is unusual for its payee, in words; empty when it is not (or the rule is off). The payee's
 * history is its executed payments (by beneficiary, else by vendor); the payment itself is not executed yet.
 */
export function anomalyReasons(db: DB, p: { kind: string; terms_json: string }): string[] {
  return anomalyReasonsFrom(anomalyThresholds(db), p, paidBefore(db));
}

/**
 * The same rule over given thresholds and a given history of paid payments (oldest first): pure. The simulator replays a
 * past payment with the history as it stood then (src/policy/simulate.ts).
 */
export function anomalyReasonsFrom(th: AnomalyThresholds, p: { kind: string; terms_json: string }, paid: Paid[]): string[] {
  const t = JSON.parse(p.terms_json) as PaymentTerms & { beneficiary_name?: string };
  const amount = plainCents(String(t.amount));
  // Not a plain amount: no history can explain it.
  if (amount === null) return ["amount unreadable"];
  const mine = paid.filter((x) => samePayee(x, t));
  const who = t.beneficiary_name || t.vendor;
  const out: string[] = [];
  if (!mine.length && th.firstEurCents) {
    const eur = supplierPaymentEur(p.terms_json);
    // No euro value in the terms counts as over, as four eyes does.
    if (eur === null || plainCents(eur)! > th.firstEurCents) out.push(`first payment to ${who} above EUR ${fromCents(th.firstEurCents)}`);
  }
  const same = mine.filter((x) => x.currency === t.currency).map((x) => plainCents(String(x.amount))).filter((c): c is number => c !== null).slice(-th.history).sort((a, b) => a - b);
  if (th.multiple && same.length) {
    // Twice the median, so no half cent is rounded away.
    const mid = same.length >> 1;
    const med2 = same.length % 2 ? 2 * same[mid]! : same[mid - 1]! + same[mid]!;
    if (2 * amount > th.multiple * med2) out.push(`unusual amount: over ${th.multiple}x ${who}'s median of ${t.currency} ${fromCents(med2 >> 1)} (last ${same.length} paid)`);
  }
  return out;
}
