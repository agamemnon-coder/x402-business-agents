// The API checkout for the Airi rail on our own Airwallex sandbox account (AIRI_CHECKOUT=api): a PaymentIntent,
// confirmed over the REST API with the card from Airi's single-use credential. Not the default any more: on 7 November
// (vic-1b) our sandbox refused that confirm with validation_error, and a probe with Airwallex's own test card gave the
// reason, "This account is not enabled for native API access". The default is the hosted page (hostedCheckout.ts),
// which shares this file's PaymentIntent create, state mapping and lookup.
//
// Earlier notes: Our sandbox takes PaymentIntents (probe, 7 November, with Max's ok: create answered
// 201, REQUIRES_PAYMENT_METHOD). Whether a confirm accepts Airi's credential is only known from a live run; whatever
// Airwallex answers is recorded as it is, its own code included.
//
// Endpoints (Airwallex API reference, read 7 November 2026):
//   POST /api/v1/pa/payment_intents/create        request_id, amount, currency, merchant_order_id
//        https://www.airwallex.com/docs/api/payments/payment_intents/create
//   POST /api/v1/pa/payment_intents/{id}/confirm  request_id, payment_method { type: "card", card { number,
//        expiry_month (two digits), expiry_year (four digits), cvc, name } }, payment_method_options.card.auto_capture
//        https://www.airwallex.com/docs/api/payments/payment_intents/confirm
//        https://www.airwallex.com/docs/payments/integration-options/web-checkout/native-api/guest-user-checkout
//   GET  /api/v1/pa/payment_intents/{id}
//        https://www.airwallex.com/docs/api/payments/payment_intents/retrieve
// Status (not exhaustive, per the reference): REQUIRES_PAYMENT_METHOD, REQUIRES_CUSTOMER_ACTION, PENDING_REVIEW,
// REQUIRES_CAPTURE, PENDING, SUCCEEDED, CANCELLED; a failed attempt carries latest_payment_attempt.failure_code and
// provider_original_response_code.
//
// The card lives in memory for the confirm request only: read from the file at that moment, put in the request body,
// and dropped. No error from here carries it: Airwallex's error bodies are not kept (only their code), and an unknown
// outcome is a CheckoutOutcomeUnknown without a cause.

import { z } from "zod";
import { AirwallexAmbiguous, AirwallexError, type Airwallex } from "../airwallex/client.js";
import { AirwallexBudgetSpent } from "../airwallex/callBudget.js";
import { CheckoutOutcomeUnknown, scrubText, type AiriCheckout, type CheckoutAnswer } from "./client.js";
import { CredentialFileError, readCredentialFile, type CardForCheckout } from "./credential.js";

export const Intent = z.object({
  id: z.string().min(1).max(100),
  status: z.string().max(60),
  latest_payment_attempt: z.object({
    status: z.string().max(60).optional(),
    failure_code: z.string().max(100).nullish(),
    provider_original_response_code: z.string().max(100).nullish(),
  }).nullish(),
});
export type Intent = z.infer<typeof Intent>;

export const code = (s: string | null | undefined) => (s ? scrubText(s).slice(0, 100) : undefined);

/** What a PaymentIntent's state means for the order. null: not final yet (PENDING, PENDING_REVIEW, or unknown). */
export function answerOf(i: Intent): CheckoutAnswer | null {
  const a = i.latest_payment_attempt;
  switch (i.status) {
    case "SUCCEEDED":
    case "REQUIRES_CAPTURE": // authorised (with auto_capture the capture follows): accepted
      return { outcome: "SUCCEEDED", reference: i.id, code: i.status };
    case "REQUIRES_CUSTOMER_ACTION": // 3DS or another step for the cardholder, which an agent cannot do: not paid
      return { outcome: "DECLINED", reference: i.id, code: "REQUIRES_CUSTOMER_ACTION" };
    case "REQUIRES_PAYMENT_METHOD":
      // No attempt: the card never reached the network. An attempt: it failed, with Airwallex's own code.
      return a ? { outcome: "DECLINED", reference: i.id, code: code(a.failure_code) ?? code(a.provider_original_response_code) ?? code(a.status) ?? "REQUIRES_PAYMENT_METHOD" }
        : { outcome: "NOT_SUBMITTED", reference: i.id, code: "REQUIRES_PAYMENT_METHOD", reason: "the PaymentIntent has no payment attempt" };
    case "CANCELLED":
      return { outcome: "DECLINED", reference: i.id, code: "CANCELLED" };
    default:
      return null;
  }
}

function errCode(e: AirwallexError): string {
  return code(e.code) ?? `HTTP_${e.status}`;
}

export class AirwallexSandboxCheckout implements AiriCheckout {
  readonly kind: AiriCheckout["kind"] = "airwallex-sandbox";
  readonly label: string = "Airwallex sandbox PaymentIntent, confirmed over the API (our own test shop; test money)";

  constructor(protected readonly api: Pick<Airwallex, "call">, protected readonly readCard: (file: string) => CardForCheckout = readCredentialFile) {}

  /** The create's raw answer, for a subclass that needs more of it than the id (the hosted page: its client_secret). */
  protected created(_id: string, _raw: unknown): void {}

  async prepare(order: { ref: string; amount: string; currency: string; description: string }): ReturnType<AiriCheckout["prepare"]> {
    if (!/^\d+\.\d{2}$/.test(order.amount)) throw new Error("the amount must be a two-decimal string");
    try {
      const raw = await this.api.call("POST", "/pa/payment_intents/create", {
        request_id: `${order.ref}-pi`.slice(0, 64), amount: Number(order.amount), currency: order.currency,
        merchant_order_id: order.ref.slice(0, 64), descriptor: scrubText(order.description).slice(0, 22),
      });
      const i = Intent.parse(raw);
      this.created(i.id, raw);
      return { reference: i.id };
    } catch (e) {
      if (e instanceof AirwallexError) {
        const c = errCode(e);
        const off = e.status === 401 || e.status === 403 || c === "unauthorized" || c === "suspended_from_online_payments";
        return { outcome: "NOT_SUBMITTED", reference: null, code: c, reason: off ? "Airwallex refused to open a PaymentIntent: acquiring is not available on this sandbox account" : "Airwallex refused to open the PaymentIntent" };
      }
      if (e instanceof AirwallexBudgetSpent) return { outcome: "NOT_SUBMITTED", reference: null, code: "CALL_BUDGET_SPENT", reason: "the approved Airwallex call budget is spent; nothing was sent" };
      // No answer: an intent may or may not exist, but no card was sent. Nothing to pay with it.
      if (e instanceof AirwallexAmbiguous) return { outcome: "NOT_SUBMITTED", reference: null, code: "AIRWALLEX_NO_ANSWER", reason: "Airwallex did not answer the PaymentIntent create; no card was sent" };
      if (e instanceof z.ZodError) return { outcome: "NOT_SUBMITTED", reference: null, code: "AIRWALLEX_ANSWER_UNRECOGNISED", reason: "Airwallex's PaymentIntent answer was not in the expected shape" };
      throw e;
    }
  }

  async pay(reference: string, ref: string, credentialFile: string): Promise<CheckoutAnswer> {
    let card: CardForCheckout;
    try {
      card = this.readCard(credentialFile);
    } catch (e) {
      // The error names keys at most, never a value.
      return { outcome: "NOT_SUBMITTED", reference, code: "CREDENTIAL_UNREADABLE", reason: e instanceof CredentialFileError ? e.message : "the credential file could not be read" };
    }
    let raw: unknown;
    try {
      raw = await this.api.call("POST", `/pa/payment_intents/${encodeURIComponent(reference)}/confirm`, {
        request_id: `${ref}-confirm`.slice(0, 64),
        payment_method: { type: "card", card: { number: card.number, expiry_month: card.expiryMonth, expiry_year: card.expiryYear, cvc: card.cvc, ...(card.name ? { name: card.name } : {}) } },
        payment_method_options: { card: { auto_capture: true } },
      });
    } catch (e) {
      // Airwallex refused the confirm: a decline with its own code (the body, which might echo input, is not kept).
      if (e instanceof AirwallexError) return { outcome: "DECLINED", reference, code: errCode(e) };
      if (e instanceof AirwallexBudgetSpent) return { outcome: "NOT_SUBMITTED", reference, code: "CALL_BUDGET_SPENT", reason: "the approved Airwallex call budget is spent; the card was not sent" };
      // No answer: the charge may or may not exist. Never retried here; looked up by the intent's id.
      throw new CheckoutOutcomeUnknown(reference, e instanceof AirwallexAmbiguous ? "Airwallex did not answer the confirm; outcome unknown" : "the confirm failed before an answer; outcome unknown");
    }
    const i = Intent.safeParse(raw);
    if (!i.success) throw new CheckoutOutcomeUnknown(reference, "Airwallex's confirm answer was not in the expected shape; outcome unknown");
    const a = answerOf(i.data);
    if (!a) throw new CheckoutOutcomeUnknown(reference, `the PaymentIntent is ${code(i.data.status) ?? "in an unknown state"}; outcome not final yet`);
    return a;
  }

  async lookup(reference: string): Promise<CheckoutAnswer | null> {
    try {
      const i = Intent.safeParse(await this.api.call("GET", `/pa/payment_intents/${encodeURIComponent(reference)}`));
      return i.success ? answerOf(i.data) : null;
    } catch {
      return null;
    }
  }
}
