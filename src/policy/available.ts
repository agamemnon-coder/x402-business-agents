// What is available, the same way everywhere (backend review B3): available = limit or balance − held − pending.
//   held:    holds reserved for a payment being made now (src/policy/holds.ts);
//   pending: money that has left or is leaving but is not final (a pull sent or held on chain, a card authorisation
//            under way, a euro payout written but not yet at Airwallex).
// The dashboard, the agents, the sweep, the euro bill and the agent API read these functions, so a screen never shows
// more than a payment could use.

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { cardLimits } from "./rules.js";
import { heldCents, spendLimits } from "./holds.js";

export interface MandateAvailability {
  budgetCents: number | null;
  /** Paid and final. */
  paidCents: number;
  /** Sent, not final: a refund or sweep pending or held on chain. */
  pendingCents: number;
  /** Reserved for a payment being made now. */
  heldCents: number;
  /** budget − paid − pending − held; null when no mandate is bound. */
  availableCents: number | null;
}

const sum = (db: DB, sql: string): number => (db.prepare(sql).get() as { n: number | null }).n ?? 0;

/** One agent's Metal mandate: what its budget still allows. */
export function mandateAvailability(db: DB, agent: string): MandateAvailability {
  const { budgetCents } = spendLimits(db, agent);
  let paid = 0;
  let pending = 0;
  if (agent === "sourcing") paid = sum(db, "SELECT SUM(price_cents) AS n FROM upstream_purchases WHERE outcome = 'PAID'");
  else if (agent === "support") {
    paid = sum(db, "SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome = 'PAID'");
    pending = sum(db, "SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome IN ('PENDING', 'HELD')");
  } else if (agent === "treasury") {
    paid = sum(db, "SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome = 'PAID'");
    pending = sum(db, "SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome IN ('PENDING', 'HELD')");
  } else if (agent === "customer") paid = sum(db, "SELECT SUM(price_cents) AS n FROM sales WHERE status = 'DELIVERED'");
  const held = heldCents(db, agent);
  return { budgetCents, paidCents: paid, pendingCents: pending, heldCents: held, availableCents: budgetCents === null ? null : budgetCents - paid - pending - held };
}

export interface CardAvailability {
  monthlyCents: number;
  /** Approved by Airwallex this calendar month (UTC). */
  spentCents: number;
  /** Authorisations under way (card holds). */
  heldCents: number;
  /** monthly − spent − held. */
  availableCents: number;
}

/** One card's month: what is left of its monthly limit. Airwallex enforces the limit; this shows it. */
export function cardAvailability(db: DB, agent: string, now = new Date()): CardAvailability {
  const { monthlyCents } = cardLimits(db, agent);
  const month = now.toISOString().slice(0, 7);
  const spent = (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM card_transactions WHERE agent = ? AND approved = 1 AND substr(occurred_at, 1, 7) = ?").get(agent, month) as { n: number }).n;
  const held = heldCents(db, agent, "card");
  return { monthlyCents, spentCents: spent, heldCents: held, availableCents: monthlyCents - spent - held };
}

/**
 * Euro payouts written but not yet at Airwallex (SUBMITTING): Airwallex's available balance does not show them
 * yet, so they are subtracted here. One payout can be left out (the one being checked).
 */
export function eurInFlightCents(db: DB, exceptRequestId?: string): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transfers'").get()) return 0;
  const rows = db.prepare("SELECT amount, fee_estimate FROM transfers WHERE status = 'SUBMITTING' AND currency = 'EUR' AND request_id <> ?").all(exceptRequestId ?? "") as { amount: string; fee_estimate: string }[];
  return rows.reduce((s, r) => s + toCents(r.amount) + toCents(r.fee_estimate), 0);
}
