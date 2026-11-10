// Money in by card through Airwallex payment acceptance (sandbox only, test money, test cards; docs/airwallex-approvals.md).
// A customer pays one of Northwind's open invoices by card: Purser creates a PaymentIntent for exactly what the invoice
// says, with the invoice number as merchant_order_id, and books the money only once Airwallex itself reports the
// PaymentIntent SUCCEEDED (read back after the confirm, or by the payment_intent.succeeded webhook). The receivables agent
// matches it like any other receipt (src/agents/receivables.ts): once per PaymentIntent id, anything short, over or in
// another currency is escalated to the CFO, and every step is in the hash-chained audit log, labelled test money.
//
// Off unless AIRWALLEX_PAYMENT_ACCEPTANCE=on. The REST client only talks to the sandbox (src/airwallex/client.ts refuses
// any other base), and a confirm only ever carries a card number from Airwallex's published sandbox test cards
// (airwallex.com/docs/payments/test-and-go-live/test-card-numbers). Nothing here pays anyone out.

import { randomUUID } from "node:crypto";
import { matchReceipt, type ReceiptOutcome } from "../agents/receivables.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { Airwallex, type AirwallexConfig } from "./client.js";

/** Airwallex's documented sandbox card for a successful payment, with any amount. */
export const SANDBOX_TEST_CARD_SUCCESS = "4035501000000008";
/** The only card numbers a confirm may carry: Airwallex's published sandbox test cards. */
const TEST_CARDS = new Set([SANDBOX_TEST_CARD_SUCCESS, "5307837360544518"]);

export const acceptanceOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.AIRWALLEX_PAYMENT_ACCEPTANCE === "on";

export interface PaymentIntent {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  merchantOrderId: string | null;
  last4: string | null;
}
export interface NewPaymentIntent { requestId: string; amountCents: number; currency: string; merchantOrderId: string }

export interface PaymentAcceptance {
  createPaymentIntent(p: NewPaymentIntent): Promise<PaymentIntent>;
  confirmWithTestCard(id: string, c: { requestId: string; number: string }): Promise<PaymentIntent>;
  getPaymentIntent(id: string): Promise<PaymentIntent>;
}

function assertTestCard(number: string): void {
  if (!TEST_CARDS.has(number)) throw new Error("only a documented Airwallex sandbox test card may be used; nothing was sent");
}

type AwxIntent = {
  id: string; status: string; amount: number; currency: string; merchant_order_id?: string | null;
  latest_payment_attempt?: { payment_method?: { card?: { last4?: string } } } | null;
};
const toIntent = (r: AwxIntent): PaymentIntent => ({
  id: r.id, status: r.status, amountCents: toCents(Number(r.amount).toFixed(2)), currency: r.currency,
  merchantOrderId: r.merchant_order_id ?? null, last4: r.latest_payment_attempt?.payment_method?.card?.last4 ?? null,
});

/** Airwallex's Payments API (PaymentIntents), sandbox only. */
export class AcceptanceRest implements PaymentAcceptance {
  private readonly api: Airwallex;
  constructor(cfg: AirwallexConfig) { this.api = new Airwallex(cfg); }

  async createPaymentIntent(p: NewPaymentIntent): Promise<PaymentIntent> {
    return toIntent(await this.api.call<AwxIntent>("POST", "/pa/payment_intents/create", {
      request_id: p.requestId, amount: Number(fromCents(p.amountCents)), currency: p.currency, merchant_order_id: p.merchantOrderId,
    }));
  }

  async confirmWithTestCard(id: string, c: { requestId: string; number: string }): Promise<PaymentIntent> {
    assertTestCard(c.number);
    return toIntent(await this.api.call<AwxIntent>("POST", `/pa/payment_intents/${encodeURIComponent(id)}/confirm`, {
      request_id: c.requestId,
      payment_method: { type: "card", card: { number: c.number, expiry_month: "12", expiry_year: "2030", cvc: "123", name: "Test Shopper" } },
      payment_method_options: { card: { auto_capture: true } },
    }));
  }

  async getPaymentIntent(id: string): Promise<PaymentIntent> {
    return toIntent(await this.api.call<AwxIntent>("GET", `/pa/payment_intents/${encodeURIComponent(id)}`));
  }
}

/** In-memory stand-in for tests: a documented success card succeeds, the documented decline card at 80.51 declines. */
export class FakeAcceptance implements PaymentAcceptance {
  calls: string[] = [];
  private intents = new Map<string, PaymentIntent>();
  private n = 0;
  async createPaymentIntent(p: NewPaymentIntent): Promise<PaymentIntent> {
    this.calls.push("create");
    const pi = { id: `int_${++this.n}`, status: "REQUIRES_PAYMENT_METHOD", amountCents: p.amountCents, currency: p.currency, merchantOrderId: p.merchantOrderId, last4: null };
    this.intents.set(pi.id, pi);
    return { ...pi };
  }
  async confirmWithTestCard(id: string, c: { requestId: string; number: string }): Promise<PaymentIntent> {
    assertTestCard(c.number);
    this.calls.push("confirm");
    const pi = this.intents.get(id)!;
    pi.status = c.number === SANDBOX_TEST_CARD_SUCCESS ? "SUCCEEDED" : "REQUIRES_PAYMENT_METHOD";
    pi.last4 = c.number.slice(-4);
    return { ...pi };
  }
  async getPaymentIntent(id: string): Promise<PaymentIntent> {
    this.calls.push("get");
    return { ...this.intents.get(id)! };
  }
}

export interface Booked { booked: boolean; outcome: ReceiptOutcome | null; invoice_no: string | null; detail: string }

/**
 * Books one PaymentIntent as money in, only when Airwallex reports it SUCCEEDED, once per PaymentIntent id. Never
 * throws for an unbooked status: it records why nothing was booked.
 */
export function bookCardPayment(db: DB, pi: PaymentIntent, now = new Date()): Booked {
  if (pi.status !== "SUCCEEDED") {
    const detail = `card payment ${pi.id} is ${pi.status} at Airwallex: nothing is booked until Airwallex reports it SUCCEEDED`;
    audit(db, "treasury", "payment_acceptance.not_booked", pi.id, { status: pi.status, invoice_no: pi.merchantOrderId, test_money: true }, now);
    return { booked: false, outcome: null, invoice_no: pi.merchantOrderId, detail };
  }
  const seen = db.prepare("SELECT outcome, invoice_no, detail FROM receipts WHERE deposit_id = ?").get(pi.id) as { outcome: ReceiptOutcome; invoice_no: string | null; detail: string } | undefined;
  if (seen) return { booked: false, outcome: seen.outcome, invoice_no: seen.invoice_no, detail: `already booked: ${seen.detail}` };
  const m = matchReceipt(db, {
    deposit_id: pi.id, global_account_id: null, currency: pi.currency, amount_cents: pi.amountCents,
    reference: pi.merchantOrderId, payer: "a customer, by card (Airwallex payment acceptance, sandbox)", received_at: now.toISOString(),
  }, now, "poll");
  audit(db, "treasury", "payment_acceptance.succeeded", pi.id, {
    payment_intent_id: pi.id, amount: fromCents(pi.amountCents), currency: pi.currency, invoice_no: pi.merchantOrderId, last4: pi.last4,
    outcome: m.outcome, test_money: true,
  }, now);
  return { booked: true, outcome: m.outcome, invoice_no: m.invoice_no, detail: m.detail };
}

/**
 * The Kit 11 world's card payment: a customer pays one open Northwind invoice by card. Creates a PaymentIntent for the
 * invoice's open amount, confirms it with Airwallex's documented success test card, reads it back, and books it only
 * from what Airwallex reports. Three calls to Airwallex plus a login.
 */
export async function collectInvoiceByCard(db: DB, pa: PaymentAcceptance, invoiceNo: string, env: NodeJS.ProcessEnv = process.env, now?: Date): Promise<Booked & { payment_intent_id: string; status: string }> {
  if (!acceptanceOn(env)) throw new Error("payment acceptance is off (AIRWALLEX_PAYMENT_ACCEPTANCE=on to use it); nothing was sent");
  const inv = db.prepare("SELECT invoice_no, currency, amount_cents, paid_cents, status FROM receivables WHERE invoice_no = ?").get(invoiceNo) as
    { invoice_no: string; currency: string; amount_cents: number; paid_cents: number; status: string } | undefined;
  if (!inv || !["OPEN", "PARTIAL"].includes(inv.status)) throw new Error(`${invoiceNo} is not an open Northwind invoice; nothing was sent`);
  const created = await pa.createPaymentIntent({ requestId: randomUUID(), amountCents: inv.amount_cents - inv.paid_cents, currency: inv.currency, merchantOrderId: inv.invoice_no });
  audit(db, "treasury", "payment_acceptance.created", created.id, { invoice_no: inv.invoice_no, amount: fromCents(created.amountCents), currency: created.currency, status: created.status, test_money: true }, now ?? new Date());
  await pa.confirmWithTestCard(created.id, { requestId: randomUUID(), number: SANDBOX_TEST_CARD_SUCCESS });
  // The status that counts is the one read back from Airwallex, not the confirm's answer.
  const read = await pa.getPaymentIntent(created.id);
  return { ...bookCardPayment(db, read, now ?? new Date()), payment_intent_id: read.id, status: read.status };
}

/** A payment_intent.* webhook body, mapped; null if it lacks what booking needs. */
export function intentFromEvent(o: Record<string, unknown>): PaymentIntent | null {
  const id = typeof o.id === "string" ? o.id : null;
  const amount = typeof o.amount === "number" ? o.amount : typeof o.amount === "string" ? Number(o.amount) : NaN;
  if (!id || !Number.isFinite(amount) || amount <= 0 || typeof o.currency !== "string" || typeof o.status !== "string") return null;
  return { id, status: o.status.toUpperCase(), amountCents: toCents(amount.toFixed(2)), currency: o.currency, merchantOrderId: typeof o.merchant_order_id === "string" ? o.merchant_order_id : null, last4: null };
}
