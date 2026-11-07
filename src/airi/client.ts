// Airi rail (docs/plans/vic-airi.md). What Purser needs from Airwallex's Airi wallet, as the public airi-cli README and
// its airi-get-credential skill describe it (github.com/airwallex/airi-cli, 0.1.0-beta.4, read 7 November 2026): list
// the agent-enabled payment methods, create a mandate for one exact checkout, fetch the single-use credential once the
// wallet owner has approved it with a passkey, report the checkout's result, cancel.
//
// Two implementations: the real one runs the pinned airi-cli binary (./cli.ts); the stand-in (./standIn.ts) calls
// nothing. Airwallex's own docs do not use the words "Visa Intelligent Commerce"; nothing in this code says it either.
//
// The credential (tokenized PAN, expiry, CVV, per the README) never passes through AiriClient: getCredential writes it
// to a 0600 file and returns only the receipt (status, token type, token expiry). Only a checkout adapter reads the
// file (./credential.ts), and the executor deletes it and its directory afterwards.

/** The airi-cli release these flags and output shapes were read from. The real client refuses any other version. */
export const AIRI_CLI_DOCUMENTED_VERSION = "0.1.0-beta.4";

/** `airi-cli mandate result --result`, as documented. */
export type AiriMandateResult = "SUCCEEDED" | "CANCELLED" | "DECLINED";

/** `airi-cli mandate list --status`, as documented. */
export type AiriMandateStatus = "CREATED" | "AUTHENTICATED" | "READY" | "COMPLETED" | "FAILED" | "DENIED";

export interface AiriPaymentMethod {
  paymentMethodId: string;
  /** For people only: brand and last four when the CLI gives them, never more. */
  display: string;
  type: string;
}

export interface AiriSession {
  authenticated: boolean;
  sessionExpires: string | null;
}

export interface AiriLineItem {
  name: string;
  /** A two-decimal string, like every amount in Purser. */
  unitPrice: string;
  /** A whole number as a string. */
  quantity: string;
}

/** The flags of `airi-cli mandate create`, all required there. */
export interface AiriMandateRequest {
  source: string;
  paymentMethodId: string;
  merchantName: string;
  merchantUrl: string;
  merchantCountry: string;
  totalAmount: string;
  currency: string;
  items: AiriLineItem[];
  description: string;
}

export interface AiriMandate {
  mandateId: string;
  /** Where the wallet owner approves this mandate with a passkey: a one-time link. Shown to that person on the
   *  operator console only; never written to a log, the audit log, a record, an error or git. */
  passkeyUrl: string;
}

/** What `mandate get-credential --file` prints: no card data. */
export interface AiriCredentialReceipt {
  status: string;
  tokenType: string;
  tokenExpiration: string;
}

/**
 * A refusal with the code its source gave. `by` says who refused: Airi (the CLI's error or a mandate status) or the
 * merchant's checkout. Purser's own refusals are not thrown; they are returned (src/airi/purchase.ts).
 */
export class AiriRefusal extends Error {
  constructor(readonly by: "airi" | "checkout", readonly code: string, message: string) {
    super(message);
    this.name = "AiriRefusal";
  }
}

/** get-credential ran out of time: the wallet owner has not tapped yet. Not a refusal by anyone. */
export class AiriWaitTimeout extends Error {
  constructor(readonly seconds: number) {
    super(`no tap in Airi within ${seconds} s`);
    this.name = "AiriWaitTimeout";
  }
}

export interface AiriClient {
  /** "stand-in" for ./standIn.ts; "airi-cli" for ./cli.ts. Shown wherever a result is shown. */
  readonly kind: "stand-in" | "airi-cli";
  /** The words shown next to every result this client produced. */
  readonly label: string;
  whoami(): Promise<AiriSession>;
  listPaymentMethods(): Promise<AiriPaymentMethod[]>;
  createMandate(req: AiriMandateRequest): Promise<AiriMandate>;
  /** A mandate this purchase may already have (after a crash): looked up by its description, never created twice. */
  findMandate(description: string, createdFrom: string): Promise<{ mandateId: string; status: string } | null>;
  /** Waits for the wallet owner's approval, then writes the credential to `file` (0600). Returns the receipt only.
   *  Throws AiriWaitTimeout when the owner did not tap in time, AiriRefusal when Airi refused. */
  getCredential(mandateId: string, file: string): Promise<AiriCredentialReceipt>;
  reportResult(mandateId: string, result: AiriMandateResult, reason?: string): Promise<void>;
  cancelMandate(mandateId: string): Promise<void>;
}

/** What the checkout said. NOT_SUBMITTED: nothing reached a card network (the mandate is then cancelled, not reported). */
export type CheckoutAnswer =
  | { outcome: "SUCCEEDED" | "DECLINED"; reference: string; code?: string }
  | { outcome: "NOT_SUBMITTED"; reference: string | null; code: string; reason: string };

/** The merchant's checkout: the only code that reads the credential file. */
export interface AiriCheckout {
  readonly kind: "stand-in" | "airwallex-sandbox";
  readonly label: string;
  /** Opens the order at the merchant, without the card (Airwallex: a PaymentIntent). Its reference is recorded
   *  before the card is sent, so a crash can be looked up. NOT_SUBMITTED when the merchant cannot take it. */
  prepare(order: { ref: string; amount: string; currency: string; description: string }): Promise<{ reference: string } | Extract<CheckoutAnswer, { outcome: "NOT_SUBMITTED" }>>;
  /** Pays the prepared order with the card in `credentialFile`. Throws CheckoutOutcomeUnknown only when the outcome
   *  is unknown; no error carries card data. */
  pay(reference: string, ref: string, credentialFile: string): Promise<CheckoutAnswer>;
  /** After a crash: what became of a prepared order, or null when it cannot be told. */
  lookup(reference: string): Promise<CheckoutAnswer | null>;
}

/** The checkout's outcome is not known (no answer, or still pending). Carries no card data and no cause. */
export class CheckoutOutcomeUnknown extends Error {
  constructor(readonly reference: string | null, reason: string) {
    super(reason);
    this.name = "CheckoutOutcomeUnknown";
  }
}

// ---- text that leaves the CLI or the checkout ---------------------------------------------------------------------

/**
 * Text from airi-cli or a checkout, made safe to show or store: no URL (a passkey or device link is a one-time
 * credential), no run of 12 or more digits (a card or token number), no 3–4 digits after cvv/cvc/csc, no e-mail, one
 * line, at most 300 characters.
 */
export function scrubText(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[digits]")
    .replace(/\b(cvv|cvc|csc|cvv2|security[ _-]?code)\b\W{0,3}\d{3,4}/gi, "$1 [digits]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\p{Cc}+/gu, " ")
    .slice(0, 300);
}

// ---- the documented command line ---------------------------------------------------------------------------------

const SAFE_TEXT = /^[^\p{Cc}]{1,200}$/u;
/** The CLI parses an item as `name:<product>,unit_price:<price>,quantity:<n>`, so a name holding , or : could add fields. */
const ITEM_NAME = /^[^,:\p{Cc}]{1,120}$/u;
const AMOUNT = /^(0|[1-9]\d{0,8})\.\d{2}$/;
const COUNT = /^[1-9]\d{0,3}$/;

/**
 * The argv of `airi-cli mandate create` for this request, exactly as the README documents the flags. Throws on any
 * value the CLI's item syntax or a terminal could misread. The global flags (-o json, --no-telemetry) are the client's.
 */
export function mandateCreateArgs(req: AiriMandateRequest): string[] {
  for (const [k, v] of Object.entries({ source: req.source, paymentMethodId: req.paymentMethodId, merchantName: req.merchantName, description: req.description })) {
    if (!SAFE_TEXT.test(v)) throw new Error(`airi mandate: ${k} is empty, too long or holds control characters`);
  }
  if (new URL(req.merchantUrl).protocol !== "https:") throw new Error("airi mandate: the merchant URL must be https");
  if (!/^[A-Z]{2}$/.test(req.merchantCountry)) throw new Error("airi mandate: merchant country is a two-letter code");
  if (!/^[A-Z]{3}$/.test(req.currency)) throw new Error("airi mandate: currency is a three-letter code");
  if (!AMOUNT.test(req.totalAmount)) throw new Error("airi mandate: total is a two-decimal amount");
  if (req.items.length === 0) throw new Error("airi mandate: at least one item");
  const items = req.items.flatMap((i) => {
    if (!ITEM_NAME.test(i.name) || !AMOUNT.test(i.unitPrice) || !COUNT.test(i.quantity)) throw new Error(`airi mandate: item ${JSON.stringify(i.name)} is not name/price/quantity the CLI can parse safely`);
    return ["--item", `name:${i.name},unit_price:${i.unitPrice},quantity:${i.quantity}`];
  });
  return [
    "mandate", "create",
    "--source", req.source,
    "--payment-method-id", req.paymentMethodId,
    "--merchant-name", req.merchantName,
    "--merchant-url", req.merchantUrl,
    "--merchant-country", req.merchantCountry,
    "--total-amount", req.totalAmount,
    "--currency", req.currency,
    ...items,
    "--description", req.description,
  ];
}
