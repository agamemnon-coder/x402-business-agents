// What Purser writes into an agent's card at Airwallex Issuing, as the JSON it sends: its limits and its authorization
// controls. Pure (no I/O, no Node modules), so the IssuingRest adapter (src/airwallex/issuing.ts) and /try/sign's
// policy step (src/try/policy.ts, which shows the body and sends nothing) build it with the same functions.

import { fromCents } from "../lib/money.js";

export interface CardLimits {
  currency: "EUR";
  perTxCents: number;
  monthlyCents: number;
}

/** A card's authorization controls besides its limits (governance: what, in which currency, until when). */
export interface CardControls {
  /** Merchant category codes (ISO 18245) the card may pay; Airwallex declines others (MERCHANT_CATEGORY_NOT_ALLOWED). */
  mccs: string[];
  /** Transaction currencies the card may pay in (CURRENCY_NOT_ALLOWED otherwise). */
  currencies: string[];
  /** After this moment Airwallex declines every authorisation; null for no end. */
  activeTo: string | null;
  /** A single-use card (Ask Purser's task cards): Airwallex allows one successful debit. Absent for multi-use. */
  singleUse?: boolean;
}

/** The card's limits as Airwallex takes them: an amount per purchase and per month, in the card's currency. */
export function limitsBody(l: CardLimits) {
  return {
    currency: l.currency,
    limits: [{ amount: Number(fromCents(l.perTxCents)), interval: "PER_TRANSACTION" }, { amount: Number(fromCents(l.monthlyCents)), interval: "MONTHLY" }],
  };
}

/** `authorization_controls` of a new card (POST /issuing/cards/create): its limits, and its controls when given. */
export function createControlsBody(limits: CardLimits, controls?: CardControls) {
  return {
    allowed_transaction_count: controls?.singleUse ? "SINGLE" : "MULTIPLE", transaction_limits: limitsBody(limits),
    ...(controls ? { allowed_merchant_categories: controls.mccs, allowed_currencies: controls.currencies, ...(controls.activeTo ? { active_to: controls.activeTo } : {}) } : {}),
  };
}

/** The body that sets a card's limits (POST /issuing/cards/{id}/update). */
export function limitsUpdateBody(limits: CardLimits) {
  return { authorization_controls: { transaction_limits: { ...limitsBody(limits), cash_withdrawal_limits: [] } } };
}

/** The body that sets what a card may pay (POST /issuing/cards/{id}/update); its end date stays. */
export function controlsUpdateBody(controls: Pick<CardControls, "mccs" | "currencies">) {
  return { authorization_controls: { allowed_merchant_categories: controls.mccs, allowed_currencies: controls.currencies } };
}

/**
 * The card's `metadata` at Airwallex (Create a card / Update a card, API reference read 26 November 2026: up to 20 keys,
 * key names up to 20 characters, values up to 150): which agent the card is for, the task it is thawed for, and the CFO
 * policy version behind it, so the card at Airwallex itself names agent, task and policy. Whether Airwallex copies a
 * card's metadata onto its transactions is not documented and not relied on: each transaction is tied to agent, task
 * and policy version in Purser's own ledger (card_transactions, src/policy/cards.ts ingestCardTransaction).
 */
export type CardMetadata = Record<string, string>;
export function cardMetadata(m: { agentId: string; taskId?: string | null; policyVersion?: number | null }): CardMetadata {
  const value = (v: string) => [...v].map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("").slice(0, 150);
  return {
    agent_id: value(m.agentId),
    ...(m.taskId ? { task_id: value(m.taskId) } : {}),
    ...(typeof m.policyVersion === "number" ? { policy_version: `v${m.policyVersion}` } : {}),
  };
}
