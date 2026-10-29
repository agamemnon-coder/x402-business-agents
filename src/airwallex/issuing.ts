// Airwallex Issuing (K2): a virtual Visa card per agent. The port says what the card code needs in our own terms
// (integer cents, our names); the REST adapter maps it onto the sandbox API (docs read 2026-10-29, shapes checked
// live the same day). The card number never leaves Airwallex: no call here asks for the full number or the CVV.

import { randomUUID } from "node:crypto";
import { Airwallex, AirwallexAmbiguous, fromEnv } from "./client.js";
import { cents } from "./adapter.js";
import { fromCents } from "../lib/money.js";

export interface CardLimits {
  currency: "EUR";
  perTxCents: number;
  monthlyCents: number;
}

export interface Card {
  cardId: string;
  cardholderId: string;
  /** The last four digits, from Airwallex's masked number. */
  last4: string;
  status: string;
  nickname: string;
  limits: CardLimits | null;
}

export interface CardTransaction {
  transactionId: string;
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
  createCard(a: { cardholderId: string; nickname: string; createdBy: string; limits: CardLimits }): Promise<Card>;
  getCard(cardId: string): Promise<Card>;
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
  authorization_controls?: { transaction_limits?: AwxLimits };
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
const DECLINED = new Set(["FAILED", "DECLINED", "REVERSED"]);

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
  };
}

export function toCardTransaction(t: AwxTx): CardTransaction {
  const id = t.card_transaction_data?.card_transaction_id ?? t.card_transaction_id ?? t.transaction_id;
  // A card transaction event webhook carries neither status nor process_result: a failure reason means declined.
  const status = t.status ?? t.process_result ?? (t.failure_reason ? "DECLINED" : t.card_transaction_id ? "APPROVED" : undefined);
  const when = t.transaction_date ?? t.transacted_at ?? t.created_at;
  if (!id || !status || !when) throw new Error("an Airwallex card transaction without an id, a result or a date");
  return {
    transactionId: id, cardId: t.card_id,
    // Airwallex signs amounts from the card's side (a purchase is negative).
    amountCents: cents(Math.abs(Number(t.transaction_amount))), currency: t.transaction_currency,
    status, approved: !DECLINED.has(status), failureReason: t.failure_reason ?? null,
    // The sandbox pads merchant names with underscores.
    merchant: (t.merchant?.name ?? "").replace(/_+$/, "").trim(), mcc: t.merchant?.category_code ?? null,
    type: t.transaction_type ?? t.type ?? "AUTHORIZATION", occurredAt: new Date(when).toISOString(),
  };
}

function limitsBody(l: CardLimits) {
  return {
    currency: l.currency,
    limits: [{ amount: Number(fromCents(l.perTxCents)), interval: "PER_TRANSACTION" }, { amount: Number(fromCents(l.monthlyCents)), interval: "MONTHLY" }],
  };
}

export class IssuingRest implements IssuingRail, IssuingSim {
  constructor(private readonly api: Airwallex) {}

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

  async createCard(a: { cardholderId: string; nickname: string; createdBy: string; limits: CardLimits }): Promise<Card> {
    try {
      const c = await this.api.call<AwxCard>("POST", "/issuing/cards/create", {
        request_id: randomUUID(), cardholder_id: a.cardholderId, created_by: a.createdBy, form_factor: "VIRTUAL", is_personalized: false,
        program: { purpose: "COMMERCIAL" }, nick_name: a.nickname,
        authorization_controls: { allowed_transaction_count: "MULTIPLE", transaction_limits: limitsBody(a.limits) },
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
      await this.api.call("POST", `/issuing/cards/${encodeURIComponent(cardId)}/update`, {
        authorization_controls: { transaction_limits: { ...limitsBody(limits), cash_withdrawal_limits: [] } },
      });
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

/** The Issuing adapter when the sandbox keys are set; null otherwise, so callers stop instead of pretending. */
export function issuingFromEnv(): { rail: IssuingRail; sim: IssuingSim } | null {
  const cfg = fromEnv();
  if (!cfg) return null;
  const rest = new IssuingRest(new Airwallex(cfg));
  return { rail: rest, sim: rest };
}
