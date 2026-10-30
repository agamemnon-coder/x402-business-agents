// The agents' company cards (K2). The CFO policy holds each card's limits (card.<agent>.per_tx / .monthly); this
// code makes the card at Airwallex match them, so Airwallex itself declines anything over the limit, whatever the
// agent does. Every authorisation Airwallex makes on a card is recorded once, from whichever source sees it first.

import { AGENTS, CARDS, type Agent, CARD_ACTIVE_DAYS, OUTSIDE_AGENT_MCCS, PLANS } from "../config/policy.js";
import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import type { Card, CardLimits, CardTransaction, IssuingRail, CardControls } from "../airwallex/issuing.js";
import { cardLimits, frozen } from "./rules.js";
import { stopped, velocityObserve } from "./velocity.js";

export interface CardRow {
  /** An own agent (sourcing, support, treasury) or an outside one (ext:<name>, P1). */
  agent: string;
  cardholder_id: string;
  card_id: string;
  last4: string;
  nickname: string;
  currency: string;
  per_tx_cents: number;
  monthly_cents: number;
  status: string;
  synced_at: string;
  /** What the card may pay at all, as Airwallex has it (comma-separated; empty for any) and its end date. */
  allowed_mccs: string;
  allowed_currencies: string;
  active_to: string | null;
}

export function cardRows(db: DB): CardRow[] {
  return db.prepare("SELECT * FROM cards ORDER BY agent").all() as CardRow[];
}

export function cardOf(db: DB, agent: string): CardRow | undefined {
  return db.prepare("SELECT * FROM cards WHERE agent = ?").get(agent) as CardRow | undefined;
}

const words = (l: { perTxCents: number; monthlyCents: number } | null) => (l ? `${fromCents(l.perTxCents)} / ${fromCents(l.monthlyCents)}` : "none");
const same = (a: CardLimits | null, b: CardLimits) => !!a && a.currency === b.currency && a.perTxCents === b.perTxCents && a.monthlyCents === b.monthlyCents;

export function storeCard(db: DB, agent: string, card: Card, now: Date): void {
  if (!card.limits) throw new Error(`the ${agent} agent's card has no EUR limits at Airwallex`);
  const c = card.controls ?? { mccs: [], currencies: [], activeTo: null };
  db.prepare(
    `INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at, allowed_mccs, allowed_currencies, active_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent) DO UPDATE SET last4 = excluded.last4, per_tx_cents = excluded.per_tx_cents,
       monthly_cents = excluded.monthly_cents, status = excluded.status, synced_at = excluded.synced_at,
       allowed_mccs = excluded.allowed_mccs, allowed_currencies = excluded.allowed_currencies, active_to = excluded.active_to`,
  ).run(agent, card.cardholderId, card.cardId, card.last4, card.nickname, card.limits.currency, card.limits.perTxCents, card.limits.monthlyCents, card.status, now.toISOString(), now.toISOString(),
    c.mccs.join(","), c.currencies.join(","), c.activeTo);
}

/**
 * What a card may pay at all, besides its limits: our agents' cards only the merchant categories of their own plans,
 * an outside agent's card only OUTSIDE_AGENT_MCCS; euros only; for CARD_ACTIVE_DAYS from issue. Airwallex declines the
 * rest (MERCHANT_CATEGORY_NOT_ALLOWED, CURRENCY_NOT_ALLOWED).
 */
export function cardControls(agent: string, now: Date, db?: DB): CardControls {
  if (agent.startsWith("task:")) {
    // A task card (Ask Purser): only its task's merchant categories, in euros, once, until the task's end.
    const t = db?.prepare("SELECT mccs, valid_until FROM task_cards WHERE task_id = ?").get(agent) as { mccs: string; valid_until: string } | undefined;
    if (!t) throw new Error(`no task card ${agent}`);
    return { mccs: t.mccs.split(",").sort(), currencies: ["EUR"], activeTo: t.valid_until, singleUse: true };
  }
  const mccs = agent.startsWith("ext:") ? OUTSIDE_AGENT_MCCS : Object.values(PLANS).filter((p) => p.agent === agent && !/on the .* card$/.test(p.label)).map((p) => p.mcc);
  return { mccs: [...new Set(mccs)].sort(), currencies: ["EUR"], activeTo: new Date(now.getTime() + CARD_ACTIVE_DAYS * 86_400_000).toISOString() };
}

const controlWords = (c: Pick<CardControls, "mccs" | "currencies"> | null | undefined) =>
  !c || (!c.mccs.length && !c.currencies.length) ? "any merchant, any currency" : `${c.mccs.length ? `MCC ${c.mccs.join(", ")}` : "any merchant"}, ${c.currencies.length ? c.currencies.join(", ") : "any currency"}`;
const sameControls = (a: Pick<CardControls, "mccs" | "currencies"> | null | undefined, b: Pick<CardControls, "mccs" | "currencies">) =>
  !!a && a.mccs.join(",") === b.mccs.join(",") && a.currencies.join(",") === b.currencies.join(",");

/** The status the policy wants a card in: frozen by the emergency stop or by its agent's velocity stop, or active. */
export const wantCardStatus = (db: DB, agent: string): "ACTIVE" | "INACTIVE" => (frozen(db) || stopped(db, agent) ? "INACTIVE" : "ACTIVE");

/** Makes one card match the policy (status, then limits). Returns true if Airwallex had something else. */
export async function syncOne(db: DB, rail: IssuingRail, agent: string, card: Card, now: Date): Promise<boolean> {
  let changed = false;
  const status = wantCardStatus(db, agent);
  if (card.status !== status) {
    let after: Card;
    try {
      after = await rail.setCardStatus(card.cardId, status);
    } catch (e) {
      throw new Error(`the ${agent} agent's card was not ${status === "INACTIVE" ? "frozen" : "thawed"} at Airwallex: ${(e as Error).message}`, { cause: e });
    }
    if (after.status !== status) throw new Error(`the ${agent} agent's card is ${after.status} at Airwallex, not ${status}`);
    audit(db, "awx-executor", status === "INACTIVE" ? "card.frozen" : "card.thawed", agent, { agent, last4: after.last4, ...(status === "INACTIVE" ? { why: frozen(db) ? "emergency stop" : "velocity limit" } : {}) }, now);
    card = after;
    changed = true;
  }
  // What the card may pay at all: a card whose merchant categories or currencies differ is brought back to the policy.
  const wantControls = cardControls(agent, now, db);
  if (!sameControls(card.controls, wantControls)) {
    let after: Card;
    try {
      after = await rail.setCardControls(card.cardId, wantControls);
    } catch (e) {
      throw new Error(`the ${agent} agent's card controls were not updated at Airwallex: ${(e as Error).message}`, { cause: e });
    }
    if (!sameControls(after.controls, wantControls)) throw new Error(`the ${agent} agent's card allows ${controlWords(after.controls)} at Airwallex, not ${controlWords(wantControls)}`);
    audit(db, "awx-executor", "card.controls_synced", agent, { agent, last4: after.last4, from: controlWords(card.controls), to: controlWords(wantControls) }, now);
    card = after;
    changed = true;
  }
  const want = cardLimits(db, agent);
  if (same(card.limits, want)) {
    storeCard(db, agent, card, now);
    return changed;
  }
  let after: Card;
  try {
    after = await rail.setCardLimits(card.cardId, want);
  } catch (e) {
    throw new Error(`the ${agent} agent's card was not updated at Airwallex: ${(e as Error).message}`, { cause: e });
  }
  // Trust what Airwallex says the card now has, not what we asked for.
  if (!same(after.limits, want)) throw new Error(`the ${agent} agent's card has ${words(after.limits)} at Airwallex, not ${words(want)}`);
  storeCard(db, agent, after, now);
  audit(db, "awx-executor", "card.limits_synced", agent, { agent, last4: after.last4, from: words(card.limits), to: words(want), currency: want.currency }, now);
  return true;
}

/**
 * The card's name at Airwallex. A world with a business account gets its own cards (the name ends in that account's
 * last six characters), so a fresh demo world never inherits another world's spend against the monthly limit.
 */
export function cardNickname(db: DB, agent: Agent): string {
  const business = db.prepare("SELECT address FROM metal_accounts WHERE role = 'business'").get() as { address: string } | undefined;
  return business ? `${CARDS[agent].nickname} (${business.address.slice(-6).toLowerCase()})` : CARDS[agent].nickname;
}

/** Issues each agent's card, or adopts the one already there, and syncs its limits. Safe to run again. */
export async function setupCards(db: DB, rail: IssuingRail, now = new Date()): Promise<CardRow[]> {
  for (const agent of AGENTS) {
    const known = cardOf(db, agent);
    if (known) {
      await syncOne(db, rail, agent, await rail.getCard(known.card_id), now);
      continue;
    }
    const c = CARDS[agent];
    const holder = (await rail.findCardholderByEmail(c.email)) ?? (await rail.createCardholder({ email: c.email, firstName: c.firstName, lastName: "Agent" }));
    const nickname = cardNickname(db, agent);
    const found = await rail.findCard(holder.id, nickname);
    const card = found ?? (await rail.createCard({ cardholderId: holder.id, nickname, createdBy: "Northwind CFO policy", limits: cardLimits(db, agent), controls: cardControls(agent, now) }));
    // An adopted card is recorded with the limits it has; syncOne then logs any change it makes to them.
    storeCard(db, agent, card, now);
    audit(db, "awx-executor", found ? "card.adopted" : "card.issued", agent, { agent, last4: card.last4, nickname, limits: words(card.limits), currency: "EUR" }, now);
    await syncOne(db, rail, agent, card, now);
  }
  return cardRows(db);
}

/** Reads every card back from Airwallex and fixes any that differs from the policy. Returns the agents changed. */
export async function syncCards(db: DB, rail: IssuingRail, now = new Date()): Promise<string[]> {
  const changed: string[] = [];
  for (const row of cardRows(db)) if (await syncOne(db, rail, row.agent, await rail.getCard(row.card_id), now)) changed.push(row.agent);
  return changed;
}

/** The cheap check the runner makes every few seconds: only a card whose stored limits differ from the policy is touched. */
export async function syncCardsIfChanged(db: DB, rail: IssuingRail, now = new Date()): Promise<string[]> {
  const changed: string[] = [];
  for (const row of cardRows(db)) {
    const want = cardLimits(db, row.agent);
    if (row.per_tx_cents === want.perTxCents && row.monthly_cents === want.monthlyCents && row.status === wantCardStatus(db, row.agent)) continue;
    await syncOne(db, rail, row.agent, await rail.getCard(row.card_id), now);
    changed.push(row.agent);
  }
  return changed;
}

/** After an approved policy change: pushes any card limit it touched to Airwallex. */
export async function syncCardsAfterPolicy(db: DB, proposalId: string, rail: IssuingRail | null, now = new Date()): Promise<string[]> {
  const p = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ? AND kind = 'policy_change'").get(proposalId) as { terms_json: string } | undefined;
  const keys = p ? (JSON.parse(p.terms_json) as { changes: { key: string }[] }).changes.map((c) => c.key) : [];
  if (!keys.some((k) => k.startsWith("card.") || k.startsWith("stop.") || k === "freeze")) return [];
  if (!rail) throw new Error("the policy changed, but the Airwallex sandbox keys are not set, so the card is not updated yet");
  return syncCardsIfChanged(db, rail, now);
}

export type CardTxSource = "simulation" | "poll" | "webhook";

/** Records an Airwallex authorisation once. Returns true if it was new. */
export function ingestCardTransaction(db: DB, t: CardTransaction, source: CardTxSource, now = new Date(), purpose?: string): boolean {
  const card = db.prepare("SELECT agent, last4 FROM cards WHERE card_id = ?").get(t.cardId) as { agent: string; last4: string } | undefined;
  if (!card) throw new Error(`transaction ${t.transactionId} is on ${t.cardId}, which is not an agent's card`);
  return db.transaction(() => {
    // Airwallex names an authorisation by two ids: its card transaction id (webhooks, the simulation) and an older
    // transaction id (its list, which may show a fresh one under that id alone). Where both are known, one row is
    // kept under the card transaction id: a row under the older id is re-keyed, or merged if both were recorded.
    if (t.legacyId && t.legacyId !== t.transactionId) {
      const legacy = db.prepare("SELECT amount_cents FROM card_transactions WHERE transaction_id = ?").get(t.legacyId) as { amount_cents: number } | undefined;
      if (legacy) {
        if (db.prepare("SELECT 1 FROM card_transactions WHERE transaction_id = ?").get(t.transactionId)) {
          db.prepare("DELETE FROM card_transactions WHERE transaction_id = ?").run(t.legacyId);
          audit(db, "system", "card.duplicate_merged", t.legacyId, {
            agent: card.agent, amount: fromCents(legacy.amount_cents), currency: t.currency, kept: t.transactionId,
            reason: "the same authorisation, recorded under its older transaction id and under its card transaction id; recorded once from now on",
          }, now);
        } else {
          db.prepare("UPDATE card_transactions SET transaction_id = ? WHERE transaction_id = ?").run(t.transactionId, t.legacyId);
        }
      }
    }
    // A declined one in the list has only the older id, its webhook the card transaction id: the same card, amount,
    // outcome and moment is the same authorisation.
    const old = (db.prepare("SELECT status, approved FROM card_transactions WHERE transaction_id = ?").get(t.transactionId)
      ?? db.prepare("SELECT status, approved FROM card_transactions WHERE card_id = ? AND amount_cents = ? AND approved = ? AND occurred_at = ?")
        .get(t.cardId, t.amountCents, t.approved ? 1 : 0, t.occurredAt)) as { status: string; approved: number } | undefined;
    if (old) {
      // Later news about the same authorisation (it cleared, or was reversed) updates the row.
      if (old.status !== t.status) db.prepare("UPDATE card_transactions SET status = ?, approved = ? WHERE transaction_id = ?").run(t.status, t.approved ? 1 : 0, t.transactionId);
      if (old.approved === 1 && !t.approved) {
        audit(db, card.agent as Actor, "card.charge_reversed", t.transactionId, { agent: card.agent, last4: card.last4, merchant: t.merchant, amount: fromCents(t.amountCents), currency: t.currency, status: t.status, source }, now);
      }
      return false;
    }
    db.prepare(
      `INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, purpose, source, occurred_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(t.transactionId, t.cardId, card.agent, t.merchant, t.mcc, t.amountCents, t.currency, t.status, t.approved ? 1 : 0, t.failureReason, purpose ?? null, source, t.occurredAt, now.toISOString());
    // Logged under the agent whose card it is; the decision itself is Airwallex's.
    audit(db, card.agent as Actor, t.approved ? "card.charge_approved" : "card.charge_declined", t.transactionId, {
      agent: card.agent, last4: card.last4, merchant: t.merchant, amount: fromCents(t.amountCents), currency: t.currency,
      ...(t.approved ? {} : { reason: t.failureReason ?? t.status }), ...(purpose ? { purpose } : {}), source,
    }, now);
    // Counted against the agent's velocity limits at the moment it happened; a breach stops the agent, and the next
    // card sync (every few seconds on the runner) freezes its card at Airwallex.
    // A refund or reversal from the merchant is money coming back, not spending.
    const at = Number.isFinite(Date.parse(t.occurredAt)) ? new Date(t.occurredAt) : now;
    // A task card (Ask Purser) is not an agent: Airwallex lets it pay once, up to the approved amount, which is
    // stricter than any velocity limit, so it is not counted there.
    if (!/REFUND|REVERSAL|CREDIT/i.test(t.type) && !card.agent.startsWith("task:")) velocityObserve(db, card.agent, t.amountCents, t.approved, at);
    return true;
  }).immediate();
}

const FRESH_LISTING_MS = 2 * 60 * 1000;

/** Asks Airwallex for every card's transactions and records the new ones. Returns how many were new. */
export async function pollCardTransactions(db: DB, rail: IssuingRail, now = new Date()): Promise<number> {
  let fresh = 0;
  for (const row of cardRows(db)) {
    // Oldest first, so the audit log reads in the order things happened (Airwallex's list order is not promised).
    const txs = (await rail.listCardTransactions(row.card_id)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    for (const t of txs) {
      // A fresh approval listed under its older id alone gets its card transaction id within moments (seen live):
      // wait for it rather than record it under an id the webhook will not use.
      if (t.approved && t.legacyId === t.transactionId && now.getTime() - Date.parse(t.occurredAt) < FRESH_LISTING_MS) continue;
      if (ingestCardTransaction(db, t, "poll", now)) fresh++;
    }
  }
  return fresh;
}

/** What the agent's card spent (approved) in the calendar month of `now`, in cents. */
export function cardSpendCents(db: DB, agent: string, now = new Date()): number {
  const month = now.toISOString().slice(0, 7);
  const r = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM card_transactions WHERE agent = ? AND approved = 1 AND substr(occurred_at, 1, 7) = ?").get(agent, month) as { s: number };
  return r.s;
}
