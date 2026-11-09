// Planning several payments for one batch (src/ap/batchPay.ts): each payment is planned as on its own, but against the
// money the earlier payments of the same batch will already draw, so a batch the CFO signs fits the balances as a whole
// (each line's executor checks the floors again when it runs). Outside a batch's planning nothing is reserved here.

import { AsyncLocalStorage } from "node:async_hooks";
import { toCents } from "../lib/money.js";

const store = new AsyncLocalStorage<Map<string, number>>();

/** Plans inside fn see what earlier plans in the same fn will draw from each balance. */
export function withBatchPlanning<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(new Map(), fn);
}

/** What the payments already planned in this batch will draw from this currency's balance (0 outside a batch). */
export function batchReservedCents(currency: string): number {
  return store.getStore()?.get(currency) ?? 0;
}

const money = (s: unknown) => (typeof s === "string" && /^\d+\.\d{2}$/.test(s) ? toCents(s) : 0);

/**
 * Adds what a planned payment will draw: its amount and fee reserve from its own currency, less what FX buys for it;
 * the FX sell amount from the currency sold.
 */
export function reserveForBatch(terms: { amount?: unknown; currency?: unknown; fee_reserve?: unknown; fee_max?: unknown; conversion?: { buy_amount?: unknown; sell_currency?: unknown; sell_amount?: unknown } | null }): void {
  const m = store.getStore();
  if (!m || typeof terms.currency !== "string") return;
  const own = money(terms.amount) + money(terms.fee_reserve ?? terms.fee_max) - money(terms.conversion?.buy_amount);
  m.set(terms.currency, (m.get(terms.currency) ?? 0) + Math.max(0, own));
  const c = terms.conversion;
  if (c && typeof c.sell_currency === "string") m.set(c.sell_currency, (m.get(c.sell_currency) ?? 0) + money(c.sell_amount));
}
