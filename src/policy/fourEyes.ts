// E1, four eyes: which proposals need the Face ID of two different people. Set by the CFO policy
// (approval.four_eyes_eur); off until the CFO sets it. Above the threshold: an invoice payment, a supplier payment (in
// euros: supplierPaymentEur), an FX conversion (in euros: fxConversionEur), and an outside
// agent's card whose monthly limit is above it; at any amount, a supplier's new bank details and a change of the
// agents' on-chain mandates (Kit 11's rebalance within the 20.00 total).

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import type { ProposalRow } from "./approvals.js";
import { sodChanges } from "./policySod.js";
import { policyValue } from "./rules.js";

export const FOUR_EYES_KEY = "approval.four_eyes_eur";

/**
 * A supplier payment in euros, for the threshold (red team round 3: four eyes never applied to supplier payments): what
 * it takes out, its amount and Purser's fee (red team 6: a fee doubled the outflow under the threshold), when it is in
 * EUR; when EUR buys part of it, that outflow at the locked quote's rate (sell / buy), and never less than the EUR the
 * quote sells; null when nothing in the terms states a euro value (another currency, paid from its own balance), which
 * counts as over.
 */
export function supplierPaymentEur(termsJson: string): string | null {
  const c = paymentEurCents(JSON.parse(termsJson) as PaymentTerms);
  return c === null ? null : (c / 100).toFixed(2);
}

/**
 * An FX conversion in euros, for the thresholds (27 Nov, red team, runner finding 3: four eyes and the second key never
 * applied to one, so one person sold USD 300,000 for EUR 250,000): what it buys when it buys EUR, the most it may sell
 * when it sells EUR; null for a pair without EUR or an amount that is not money, which counts as over.
 */
export function fxConversionEur(termsJson: string): string | null {
  const t = JSON.parse(termsJson) as { buy_currency?: string; buy_amount?: string; sell_currency?: string; sell_max?: string };
  const eur = t.buy_currency === "EUR" ? t.buy_amount : t.sell_currency === "EUR" ? t.sell_max : undefined;
  return money(eur) ? eur! : null;
}

interface PaymentTerms { amount?: string; currency?: string; platform_fee?: { amount?: string; currency?: string } | null; conversion?: { sell_currency?: string; sell_amount?: string; buy_amount?: string } | null }
const money = (s: string | undefined) => typeof s === "string" && /^\d+\.\d{2}$/.test(s);

/** One payment's outflow in euro cents (amount and Purser's fee), or null when the terms state no euro value. */
function paymentEurCents(t: PaymentTerms): number | null {
  if (!money(t.amount)) return null;
  const fee = t.platform_fee ? (money(t.platform_fee.amount) && t.platform_fee.currency === t.currency ? toCents(t.platform_fee.amount!) : null) : 0;
  if (fee === null) return null;
  const out = toCents(t.amount!) + fee;
  if (t.currency === "EUR") return out;
  const c = t.conversion;
  if (c?.sell_currency !== "EUR" || !money(c.sell_amount) || !money(c.buy_amount) || toCents(c.buy_amount!) <= 0) return null;
  return Math.max(toCents(c.sell_amount!), Math.ceil((toCents(c.sell_amount!) * out) / toCents(c.buy_amount!)));
}

/** A payment line in euro cents for the threshold: an invoice payment's or a supplier payment's outflow; null: unknown. */
function lineEurCents(kind: string, terms: PaymentTerms): number | null {
  // Purser's fee counts on this route too (9 November): what leaves the EUR balance.
  if (kind === "invoice_payment") return paymentEurCents(terms);
  if (kind === "supplier_payment") return paymentEurCents(terms);
  return null;
}

/** `value`: the policy to read the threshold from; the one in force unless the simulator replays a proposed one (src/policy/simulate.ts). */
export function fourEyes(db: DB, p: Pick<ProposalRow, "kind" | "terms_json">, value: (key: string) => string = (key) => policyValue(db, key), now = new Date()): boolean {
  // Block 1: the account's owners are two passkeys with a threshold of two; Purser asks for both as the chain will.
  if (p.kind === "owners_execute") return true;
  // Segregation of duties (src/policy/policySod.ts): a policy change that loosens above the CFO's threshold for it.
  if (p.kind === "policy_change" && sodChanges(db, p.terms_json, now).length > 0) return true;
  const v = value(FOUR_EYES_KEY);
  // A batch needs two people when any of its lines would on its own (one Face ID never approves what needs two), and
  // when its lines together are above the threshold (red team 6: three lines under it, EUR 4,617.20 in all, one person).
  if (p.kind === "payment_batch") {
    const lines = (JSON.parse(p.terms_json) as { lines?: { kind: string; terms: PaymentTerms }[] }).lines ?? [];
    if (lines.some((l) => fourEyes(db, { kind: l.kind, terms_json: JSON.stringify(l.terms) }, value, now))) return true;
    if (v === "") return false;
    let sum = 0;
    for (const l of lines) {
      const c = lineEurCents(l.kind, l.terms);
      if (c === null) return true;
      sum += c;
    }
    return sum > toCents(v);
  }
  if (v === "") return false;
  const threshold = toCents(v);
  const t = JSON.parse(p.terms_json) as { amount?: string; card?: { monthly?: string } };
  const over = (s: string | undefined) => (s !== undefined && /^\d+\.\d{2}$/.test(s) ? toCents(s) > threshold : false);
  if (p.kind === "invoice_payment") {
    const eur = supplierPaymentEur(p.terms_json);
    return eur === null ? over(t.amount) : over(eur);
  }
  if (p.kind === "supplier_payment") {
    const eur = supplierPaymentEur(p.terms_json);
    return eur === null || over(eur);
  }
  if (p.kind === "fx_conversion") {
    const eur = fxConversionEur(p.terms_json);
    return eur === null || over(eur);
  }
  if (p.kind === "agent_onboard") return over(t.card?.monthly);
  if (p.kind === "task_card") return over(t.amount);
  // 4.2 Resuming a paused agent binds a mandate again: a change of its mandate, so two people. Pausing only takes away.
  if (p.kind === "policy_change") return ((JSON.parse(p.terms_json) as { changes?: { key: string; from: string; to: string }[] }).changes ?? []).some((c) => c.key.startsWith("pause.") && c.from === "on" && c.to !== "on");
  return p.kind === "payee_change" || p.kind === "payee_add" || p.kind === "mandate_replace";
}
