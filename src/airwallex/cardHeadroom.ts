// An agent card's headroom as Airwallex itself counts it (sandbox only, test money). Purser sets each agent card's
// limits (src/airwallex/issuing.ts); these reads say how much of them is left, in Airwallex's own numbers, so the
// agent's policy and the card network agree before an agent spends:
//   GET /api/v1/issuing/cards/{id}/limits   per interval: the limit, and what remains of it (docs: api/issuing/cards,
//                                           "Get card remaining limits", read 19 November 2026)
//   GET /api/v1/issuing/authorizations     the card's authorisations (holds) in a window: a PENDING one has reserved
//                                           money the merchant has not captured yet (docs: api/issuing/authorizations)
// Reads only: nothing here issues, changes or freezes a card.

import type { Airwallex } from "./client.js";
import { signedCents } from "../finance/awxReconcile.js";
import { fromCents } from "../lib/money.js";

export interface RemainingLimit { interval: string; limitCents: number; remainingCents: number }
export interface CardRemaining { currency: string; limits: RemainingLimit[] }

type RawLimits = { currency?: string; limits?: { amount?: number | string; interval?: string; remaining?: number | string }[] };

export function toRemaining(r: RawLimits): CardRemaining {
  return {
    currency: (r.currency ?? "").toUpperCase(),
    limits: (r.limits ?? []).map((l) => ({ interval: l.interval ?? "", limitCents: signedCents(l.amount ?? 0), remainingCents: signedCents(l.remaining ?? 0) })),
  };
}

export async function cardRemainingLimits(api: Pick<Airwallex, "call">, cardId: string): Promise<CardRemaining> {
  return toRemaining(await api.call<RawLimits>("GET", `/issuing/cards/${encodeURIComponent(cardId)}/limits`));
}

export interface Authorization { id: string; status: string; currency: string; amountCents: number; merchant: string; createdAt: string | null }
type RawAuth = { transaction_id?: string; id?: string; status?: string; billing_currency?: string; billing_amount?: number | string; transaction_currency?: string; transaction_amount?: number | string; merchant?: { name?: string } | null; create_time?: string; created_at?: string };

export function toAuthorization(a: RawAuth): Authorization {
  return {
    id: a.transaction_id ?? a.id ?? "", status: a.status ?? "", currency: (a.billing_currency ?? a.transaction_currency ?? "").toUpperCase(),
    amountCents: Math.abs(signedCents(a.billing_amount ?? a.transaction_amount ?? 0)), merchant: (a.merchant?.name ?? "").replace(/_+$/, "").trim(), createdAt: a.create_time ?? a.created_at ?? null,
  };
}

/** The card's authorisations created in [from, to] (one page of up to 100; more is refused rather than half-read). */
export async function cardAuthorizations(api: Pick<Airwallex, "call">, cardId: string, w: { from: string; to: string }): Promise<Authorization[]> {
  const r = await api.call<{ items?: RawAuth[]; has_more?: boolean }>("GET", "/issuing/authorizations", undefined, { card_id: cardId, from_created_at: w.from, to_created_at: w.to, page_num: "0", page_size: "100" });
  if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's authorisations came without items");
  if (r.has_more === true) throw new Error("more than 100 authorisations on this card in the window; narrow it");
  return r.items.map(toAuthorization);
}

export interface Headroom {
  currency: string;
  /** Per interval: the limit, what Airwallex says remains, and what is used (limit − remaining). */
  intervals: { interval: string; limit: string; remaining: string; used: string }[];
  /** What the agent may still spend in one go: the smallest remaining amount over every interval. */
  spendable: string;
  pendingHolds: { count: number; total: string };
  /** Purser's own limits for the card, where they differ from Airwallex's (empty when they agree). */
  disagreements: string[];
}

const money = (cur: string, c: number) => `${cur} ${fromCents(Math.max(0, c))}`;

/**
 * The agent's headroom from Airwallex's numbers, compared with the limits Purser set on the card (`set`: per
 * transaction and per month, in cents). Any interval where Airwallex's limit is not the one Purser set is a
 * disagreement, named; a remaining amount above its limit is one too.
 */
export function headroom(rem: CardRemaining, auths: readonly Authorization[], set: { perTransactionCents: number; monthlyCents: number } | null): Headroom {
  const cur = rem.currency;
  const intervals = rem.limits.map((l) => ({ interval: l.interval, limit: money(cur, l.limitCents), remaining: money(cur, l.remainingCents), used: money(cur, l.limitCents - l.remainingCents) }));
  const spendable = rem.limits.length ? Math.min(...rem.limits.map((l) => l.remainingCents)) : 0;
  const pending = auths.filter((a) => a.status === "PENDING");
  const disagreements: string[] = [];
  for (const l of rem.limits) if (l.remainingCents > l.limitCents) disagreements.push(`${l.interval}: Airwallex shows ${money(cur, l.remainingCents)} remaining of a ${money(cur, l.limitCents)} limit`);
  if (set) {
    const want: Record<string, number> = { PER_TRANSACTION: set.perTransactionCents, MONTHLY: set.monthlyCents };
    for (const [interval, cents] of Object.entries(want)) {
      const l = rem.limits.find((x) => x.interval === interval);
      if (!l) disagreements.push(`${interval}: Purser set ${money(cur, cents)}; Airwallex shows no such limit`);
      else if (l.limitCents !== cents) disagreements.push(`${interval}: Purser set ${money(cur, cents)}; Airwallex holds ${money(cur, l.limitCents)}`);
    }
  }
  return {
    currency: cur, intervals, spendable: money(cur, spendable),
    pendingHolds: { count: pending.length, total: money(cur, pending.filter((a) => a.currency === cur).reduce((s, a) => s + a.amountCents, 0)) }, disagreements,
  };
}
