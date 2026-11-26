// Card hours, enforced by Purser (src/policy/cardHours.ts says why Airwallex cannot: its cards have a one-off activity
// range, no recurring time window). The hours that count for a card:
//   - what the card sync last made the card's hours (cards.hours), which is wider than before only on a policy change
//     the CFO signed with the passkey, verified again at the sync (src/policy/cardRaise.ts allowedCardHours); or
//   - the policy's hours when they are narrower than that: a tightening counts at once, before any sync.
// Purser checks them before every card purchase it starts (src/agents/cardBuyer.ts, src/policy/holds.ts
// chargeUnderHold, src/policy/cards.ts chargeInWindow, the agent tokens' check), opens no purchase window outside them,
// and the card sync freezes a card that is thawed when they end (src/policy/cards.ts wantCardStatus).
// Our own agents' cards only: a task card (Ask Purser) is single-use with its own end date, and an outside agent's
// card has no hours rule.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { cardHoursWithin, localWords, parseCardHours, withinCardHours } from "./cardHours.js";
import { policyValue } from "./rules.js";

/** What Purser enforces on this card now (cards.hours; none recorded is any time). */
export function storedCardHours(db: DB, agent: string): string {
  const r = db.prepare("SELECT hours FROM cards WHERE agent = ?").get(agent) as { hours: string | null } | undefined;
  return r?.hours ?? "";
}

/** The hours that count for this card now: the policy's when they are within what the card has, else the card's. */
export function effectiveCardHours(db: DB, agent: string): string {
  if (agent.startsWith("task:")) return "";
  const want = policyValue(db, `card.${agent}.hours`);
  const has = storedCardHours(db, agent);
  return cardHoursWithin(want, has) ? want : has;
}

/**
 * Why this card may not pay at `now` because of its hours (outside_card_hours: ...), or null. Hours that cannot be
 * read refuse (fail closed): a value no rule accepts reached the ledger some other way.
 */
export function cardHoursRefusal(db: DB, agent: string, now: Date): string | null {
  const hours = effectiveCardHours(db, agent);
  let h;
  try {
    h = parseCardHours(hours);
  } catch (e) {
    return `outside_card_hours: ${(e as Error).message.slice(0, 40)} (the ${agent} agent's card pays nothing)`;
  }
  if (withinCardHours(h, now)) return null;
  return `outside_card_hours: the ${agent} agent's card pays ${hours} only (enforced by Purser); now ${localWords(now, h!.tz)}`;
}

/**
 * Before Purser starts a card purchase: outside the card's hours the purchase is refused, recorded, and nothing is sent
 * to Airwallex (throws outside_card_hours: ...). A task card has no hours.
 */
export function refuseOutsideCardHours(db: DB, agent: string, a: { amountCents: number; merchant: string; why?: string }, now: Date): void {
  if (agent.startsWith("task:")) return;
  const why = cardHoursRefusal(db, agent, now);
  if (!why) return;
  audit(db, "system", "card.purchase_refused", agent, {
    agent, reason: why, hours: effectiveCardHours(db, agent), enforced_by: "Purser (Airwallex has no recurring time window)",
    merchant: a.merchant.slice(0, 60), amount: fromCents(a.amountCents), currency: "EUR", ...(a.why ? { purpose: a.why.slice(0, 120) } : {}), airwallex_calls: 0,
  }, now);
  throw new Error(why);
}
