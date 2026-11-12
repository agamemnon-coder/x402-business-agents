// Airwallex Issuing (K2): a virtual Visa card per agent. The port says what the card code needs in our own terms
// (integer cents, our names); the REST adapter maps it onto the sandbox API (docs read 2026-10-29, shapes checked
// live the same day). The card number never leaves Airwallex: no call here asks for the full number or the CVV.

import { randomUUID } from "node:crypto";
import { Airwallex, AirwallexAmbiguous, fromEnv } from "./client.js";
import { cents } from "./adapter.js";
import { fromCents } from "../lib/money.js";
import { controlsUpdateBody, createControlsBody, limitsUpdateBody, type CardControls, type CardLimits } from "./cardBody.js";
import { checkCardAccount } from "./binding.js";
import { platformOn } from "./platform.js";
import type { DB } from "../db/open.js";

export type { CardControls, CardLimits } from "./cardBody.js";

export interface Card {
  cardId: string;
  cardholderId: string;
  /** The last four digits, from Airwallex's masked number. */
  last4: string;
  status: string;
  nickname: string;
  limits: CardLimits | null;
  /** What the card may pay at all (Airwallex declines the rest): merchant categories, currencies, an end date. */
  controls?: CardControls | null;
}

export interface CardTransaction {
  /** Airwallex's card transaction id when it has one, otherwise its older transaction id. */
  transactionId: string;
  /** The older transaction id, where Airwallex gives it (its transaction list does). The list may show a fresh
   *  authorisation under this id alone before its card transaction id is filled in. */
  legacyId?: string;
  cardId: string;
  /** Always positive: what the merchant asked for. */
  amountCents: number;
  currency: string;
  /** Airwallex's own word (PENDING, CLEARED, FAILED, ...). */
  status: string;
  approved: boolean;
  failureReason: string | null;
  merchant: string;
  mcc: string | null;
  type: string;
  occurredAt: string;
}

export interface Cardholder {
  id: string;
  email: string;
  status: string;
}

export interface IssuingRail {
  findCardholderByEmail(email: string): Promise<Cardholder | undefined>;
  createCardholder(a: { email: string; firstName: string; lastName: string }): Promise<Cardholder>;
  findCard(cardholderId: string, nickname: string): Promise<Card | undefined>;
  createCard(a: { cardholderId: string; nickname: string; createdBy: string; limits: CardLimits; controls?: CardControls }): Promise<Card>;
  getCard(cardId: string): Promise<Card>;
  /** Sets which merchant categories and currencies the card may pay (its end date stays). */
  setCardControls(cardId: string, controls: Pick<CardControls, "mccs" | "currencies">): Promise<Card>;
  setCardLimits(cardId: string, limits: CardLimits): Promise<Card>;
  /** INACTIVE freezes the card (Airwallex declines with CARD_INACTIVE); ACTIVE thaws it. */
  setCardStatus(cardId: string, status: "ACTIVE" | "INACTIVE"): Promise<Card>;
  /** The card's transactions, in whatever order Airwallex lists them. */
  listCardTransactions(cardId: string): Promise<CardTransaction[]>;
}

/** Sandbox only: a merchant charging the card. In production the merchant does this, not us. */
export interface IssuingSim {
  simulateCardCharge(a: { cardId: string; amountCents: number; currency: "EUR"; merchant: string; mcc: string }): Promise<CardTransaction>;
}

type AwxLimits = { currency: string; limits: { amount: number; interval: string }[] };
type AwxCard = {
  card_id: string; cardholder_id: string; card_number?: string; card_status: string; nick_name?: string;
  authorization_controls?: { transaction_limits?: AwxLimits; allowed_merchant_categories?: string[]; allowed_currencies?: string[]; active_to?: string | null; allowed_transaction_count?: string };
};
/**
 * A transaction in either of the two shapes Airwallex uses: the transaction list (legacy, with `status`) and a card
 * transaction event (the simulation's answer and the newer webhooks, with `process_result`). Both carry the card
 * transaction id, which is what we key on.
 */
type AwxTx = {
  card_id: string; transaction_amount: number; transaction_currency: string;
  transaction_id?: string; card_transaction_id?: string; card_transaction_data?: { card_transaction_id?: string };
  status?: string; process_result?: string; failure_reason?: string | null; created_at?: string;
  merchant?: { name?: string; category_code?: string };
  transaction_type?: string; type?: string; transaction_date?: string; transacted_at?: string;
};

/** The words Airwallex uses for a refused authorisation. Anything else went through (PENDING, APPROVED, CLEARED, ...). */
const DECLINED = new Set(["FAILED", "DECLINED", "REVERSED", "EXPIRED"]);
/** The results that mean money was (or will be) taken from the card. Anything else is refused, never guessed. */
const APPROVED = new Set(["APPROVED", "PENDING", "CLEARED", "SETTLED"]);

/**
 * A card amount as Airwallex sends it: a JSON number or a plain decimal string, signed from the card's side. A boolean,
 * null, an array, hex, an exponent or an empty string is not an amount (security review HF8).
 */
function cardAmountCents(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return cents(Math.abs(v));
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return cents(v.replace(/^-/, ""));
  throw new Error(`not a card amount: ${JSON.stringify(v)?.slice(0, 40)}`);
}

export function toLimits(l: AwxLimits | undefined): CardLimits | null {
  if (!l || l.currency !== "EUR") return null;
  const per = l.limits.find((x) => x.interval === "PER_TRANSACTION");
  const month = l.limits.find((x) => x.interval === "MONTHLY");
  if (!per || !month) return null;
  return { currency: "EUR", perTxCents: cents(per.amount), monthlyCents: cents(month.amount) };
}

export function toCard(c: AwxCard): Card {
  return {
    cardId: c.card_id, cardholderId: c.cardholder_id, last4: (c.card_number ?? "").replace(/\D/g, "").slice(-4),
    status: c.card_status, nickname: c.nick_name ?? "", limits: toLimits(c.authorization_controls?.transaction_limits),
    controls: c.authorization_controls ? {
      mccs: [...(c.authorization_controls.allowed_merchant_categories ?? [])].sort(),
      currencies: [...(c.authorization_controls.allowed_currencies ?? [])].sort(),
      activeTo: c.authorization_controls.active_to ? new Date(c.authorization_controls.active_to).toISOString() : null,
      ...(c.authorization_controls.allowed_transaction_count === "SINGLE" ? { singleUse: true } : {}),
    } : null,
  };
}

export function toCardTransaction(t: AwxTx): CardTransaction {
  const id = t.card_transaction_data?.card_transaction_id ?? t.card_transaction_id ?? t.transaction_id;
  // A card transaction event webhook carries neither status nor process_result: a failure reason means declined.
  const status = t.status ?? t.process_result ?? (t.failure_reason ? "DECLINED" : t.card_transaction_id ? "APPROVED" : undefined);
  const when = t.transaction_date ?? t.transacted_at ?? t.created_at;
  if (typeof id !== "string" || !id || typeof status !== "string" || !when) throw new Error("an Airwallex card transaction without an id, a result or a date");
  if (!APPROVED.has(status) && !DECLINED.has(status)) throw new Error(`an unknown card transaction result: ${status.slice(0, 40)}`);
  if (typeof t.card_id !== "string" || typeof t.transaction_currency !== "string" || !/^[A-Z]{3}$/.test(t.transaction_currency)) {
    throw new Error("an Airwallex card transaction without a card or a currency");
  }
  if (Number.isNaN(new Date(when).getTime())) throw new Error("an Airwallex card transaction with a date that is not a date");
  return {
    transactionId: id, ...(t.transaction_id ? { legacyId: t.transaction_id } : {}), cardId: t.card_id,
    // Airwallex signs amounts from the card's side (a purchase is negative).
    amountCents: cardAmountCents(t.transaction_amount), currency: t.transaction_currency,
    status, approved: !DECLINED.has(status), failureReason: t.failure_reason ?? null,
    // The sandbox pads merchant names with underscores.
    merchant: (t.merchant?.name ?? "").replace(/_+$/, "").trim(), mcc: t.merchant?.category_code ?? null,
    type: t.transaction_type ?? t.type ?? "AUTHORIZATION", occurredAt: new Date(when).toISOString(),
  };
}

/** Run before every card call; throws (nothing reaches Airwallex) when the call may not run for this account. */
export type CardAccountGuard = () => void;

/**
 * With Purser as a platform, or a client that acts for a connected account, a card call needs the company's binding
 * checked (red team 6), which needs the company's database: a rail made without one refuses every call.
 */
const unbound = (api: Airwallex): CardAccountGuard => () => {
  if (platformOn() || api.onBehalfOf) throw new Error("card calls for a connected account need the company's account binding checked, and this card rail has none; nothing is done at Airwallex");
};

export class IssuingRest implements IssuingRail, IssuingSim {
  private readonly guard: CardAccountGuard;
  private readonly api: Pick<Airwallex, "call">;

  constructor(api: Airwallex, guard?: CardAccountGuard) {
    this.guard = guard ?? unbound(api);
    // Every card call goes through the guard first: the binding is checked at each call, not once, so a binding that
    // turns non-active or expires stops the next call.
    this.api = { call: ((...a: Parameters<Airwallex["call"]>) => { this.guard(); return api.call(...a); }) as Airwallex["call"] };
  }

  async findCardholderByEmail(email: string): Promise<Cardholder | undefined> {
    type H = { cardholder_id: string; email: string; status: string };
    for (let page = 0; ; page++) {
      const r = await this.api.call<{ has_more: boolean; items: H[] }>("GET", "/issuing/cardholders", undefined, { page_num: String(page), page_size: "100" });
      const hit = r.items.find((h) => h.email === email);
      if (hit) return { id: hit.cardholder_id, email: hit.email, status: hit.status };
      if (!r.has_more) return undefined;
    }
  }

  async createCardholder(a: { email: string; firstName: string; lastName: string }): Promise<Cardholder> {
    // A DELEGATE cardholder: someone (here an agent) the business lets spend on its behalf. The address is the
    // business's, made up for the sandbox.
    const h = await this.api.call<{ cardholder_id: string; email: string; status: string }>("POST", "/issuing/cardholders/create", {
      type: "DELEGATE", email: a.email,
      individual: {
        name: { first_name: a.firstName, last_name: a.lastName }, date_of_birth: "1990-01-01", express_consent_obtained: "yes",
        address: { line1: "Musterstrasse 1", city: "Berlin", postcode: "10115", country: "DE" },
      },
    });
    return { id: h.cardholder_id, email: h.email, status: h.status };
  }

  async findCard(cardholderId: string, nickname: string): Promise<Card | undefined> {
    for (let page = 0; ; page++) {
      const r = await this.api.call<{ has_more: boolean; items: AwxCard[] }>("GET", "/issuing/cards", undefined, { cardholder_id: cardholderId, page_num: String(page), page_size: "100" });
      const hit = r.items.find((c) => c.nick_name === nickname && c.card_status !== "CLOSED");
      // The list may leave out the controls; the card itself has them.
      if (hit) return this.getCard(hit.card_id);
      if (!r.has_more) return undefined;
    }
  }

  async createCard(a: { cardholderId: string; nickname: string; createdBy: string; limits: CardLimits; controls?: CardControls }): Promise<Card> {
    try {
      const c = await this.api.call<AwxCard>("POST", "/issuing/cards/create", {
        request_id: randomUUID(), cardholder_id: a.cardholderId, created_by: a.createdBy, form_factor: "VIRTUAL", is_personalized: false,
        program: { purpose: "COMMERCIAL" }, nick_name: a.nickname,
        authorization_controls: createControlsBody(a.limits, a.controls),
      });
      return toCard(c);
    } catch (e) {
      // The answer was lost: the nickname is ours and unique per agent, so look before anyone retries.
      if (e instanceof AirwallexAmbiguous) {
        const found = await this.findCard(a.cardholderId, a.nickname);
        if (found) return found;
      }
      throw e;
    }
  }

  async getCard(cardId: string): Promise<Card> {
    return toCard(await this.api.call<AwxCard>("GET", `/issuing/cards/${encodeURIComponent(cardId)}`));
  }

  async setCardLimits(cardId: string, limits: CardLimits): Promise<Card> {
    // Setting the same limits twice is harmless, so an ambiguous answer is settled by reading the card back.
    try {
      await this.api.call("POST", `/issuing/cards/${encodeURIComponent(cardId)}/update`, limitsUpdateBody(limits));
    } catch (e) {
      if (!(e instanceof AirwallexAmbiguous)) throw e;
    }
    return this.getCard(cardId);
  }

  async setCardControls(cardId: string, controls: Pick<CardControls, "mccs" | "currencies">): Promise<Card> {
    // Setting the same controls twice is harmless, so an ambiguous answer is settled by reading the card back.
    try {
      await this.api.call("POST", `/issuing/cards/${encodeURIComponent(cardId)}/update`, controlsUpdateBody(controls));
    } catch (e) {
      if (!(e instanceof AirwallexAmbiguous)) throw e;
    }
    return this.getCard(cardId);
  }

  async setCardStatus(cardId: string, status: "ACTIVE" | "INACTIVE"): Promise<Card> {
    try {
      await this.api.call("POST", `/issuing/cards/${encodeURIComponent(cardId)}/update`, { card_status: status });
    } catch (e) {
      if (!(e instanceof AirwallexAmbiguous)) throw e;
    }
    return this.getCard(cardId);
  }

  async listCardTransactions(cardId: string): Promise<CardTransaction[]> {
    const out: CardTransaction[] = [];
    for (let page = 0; page < 20; page++) {
      const r = await this.api.call<{ has_more: boolean; items: AwxTx[] }>("GET", "/issuing/transactions", undefined, { card_id: cardId, page_num: String(page), page_size: "100" });
      out.push(...r.items.map(toCardTransaction));
      if (!r.has_more) break;
    }
    return out;
  }

  async simulateCardCharge(a: { cardId: string; amountCents: number; currency: "EUR"; merchant: string; mcc: string }): Promise<CardTransaction> {
    const t = await this.api.call<AwxTx>("POST", "/simulation/issuing/create", {
      card_id: a.cardId, transaction_amount: Number(fromCents(a.amountCents)), transaction_currency: a.currency,
      merchant_category_code: a.mcc, merchant_info: a.merchant,
    });
    return toCardTransaction(t);
  }
}

/**
 * The card rail for this client, checked against the company's binding before each call (src/airwallex/binding.ts),
 * the same check the payout executors run. Without the company's database it refuses every call for a connected account.
 */
export function issuingFor(api: Airwallex, db?: DB, env: Record<string, string | undefined> = process.env): IssuingRest {
  return new IssuingRest(api, db ? () => checkCardAccount(db, { payingAccount: api.onBehalfOf }, new Date(), env) : undefined);
}

/** The Issuing adapter when the sandbox keys are set; null otherwise, so callers stop instead of pretending. */
export function issuingFromEnv(db?: DB, env: Record<string, string | undefined> = process.env): { rail: IssuingRail; sim: IssuingSim } | null {
  const cfg = fromEnv(env);
  if (!cfg) return null;
  const rest = issuingFor(new Airwallex(cfg), db, env);
  return { rail: rest, sim: rest };
}
