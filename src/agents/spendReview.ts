// Card spend per merchant and category (awards item 5): what each agent's Airwallex card paid where, with the
// declines apart, read from the ledger's card transactions. A merchant that charged the same amount again 25 to 35
// days later is flagged as a subscription, and the review suggests how the CFO stops it: lower the card's limit or
// take the merchant's category off the card. Both are tightenings, which the CFO can do on the phone; nothing here
// changes a card.

import type { DB } from "../db/open.js";
import { agentName } from "../config/brand.js";
import { fromCents } from "../lib/money.js";

/** Merchant categories, in words (the ones the agents' cards allow, and the task cards'). */
export const MCC_WORDS: Record<string, string> = {
  "5734": "Software", "7372": "Software services", "7311": "Advertising", "4511": "Airlines", "7011": "Hotels", "4112": "Trains", "8931": "Bookkeeping",
};

export interface SpendRow { agent: string; merchant: string; category: string; currency: string; charges: number; total: string; declined: number; subscription: boolean }
export interface SpendReview { rows: SpendRow[]; suggestions: string[] }

const DAY = 86_400_000;

export function spendReview(db: DB): SpendReview {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_transactions'").get()) return { rows: [], suggestions: [] };
  const txs = db.prepare("SELECT agent, merchant, mcc, currency, amount_cents, approved, occurred_at FROM card_transactions ORDER BY occurred_at").all() as
    { agent: string; merchant: string; mcc: string | null; currency: string; amount_cents: number; approved: number; occurred_at: string }[];
  const groups = new Map<string, typeof txs>();
  for (const t of txs) {
    const k = `${t.agent}|${t.merchant}|${t.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const rows: SpendRow[] = [];
  const suggestions: string[] = [];
  for (const g of groups.values()) {
    const paid = g.filter((t) => t.approved === 1);
    // The same amount again about a month later: a subscription.
    const repeat = paid.find((a, i) => paid.slice(i + 1).some((b) => b.amount_cents === a.amount_cents && Math.abs(Date.parse(b.occurred_at) - Date.parse(a.occurred_at) - 30 * DAY) <= 5 * DAY));
    const first = g[0]!;
    const agent = first.agent.startsWith("task:") ? "a task card" : agentName(first.agent);
    rows.push({
      agent, merchant: first.merchant, category: MCC_WORDS[first.mcc ?? ""] ?? (first.mcc ? `MCC ${first.mcc}` : "unknown"), currency: first.currency,
      charges: paid.length, total: fromCents(paid.reduce((s, t) => s + t.amount_cents, 0)), declined: g.length - paid.length, subscription: !!repeat,
    });
    if (repeat) {
      suggestions.push(`${first.merchant} charges the ${agent}'s card ${fromCents(repeat.amount_cents)} ${first.currency} every month. To stop it, lower the card's monthly limit or take ${MCC_WORDS[first.mcc ?? ""] ?? "its category"} off the card: both are tightenings you can make on the phone.`);
    }
  }
  rows.sort((a, b) => Number(b.total) - Number(a.total) || a.merchant.localeCompare(b.merchant));
  return { rows, suggestions };
}
