// Airi rail, groundwork only (docs/plans/vic-airi.md). What Purser needs from Airwallex's Airi wallet, as the public
// airi-cli README and its airi-get-credential skill describe it (github.com/airwallex/airi-cli, 0.1.0-beta.4, read
// 7 November 2026): list the agent-enabled payment methods, create a mandate for one exact checkout, fetch the
// single-use credential once the wallet owner has approved it with a passkey, report the checkout's result, cancel.
//
// Nothing here calls Airi. There is no real client yet: the only implementation is the stand-in in ./standIn.ts.
// Airwallex's own docs do not use the words "Visa Intelligent Commerce"; nothing in this code says it either.
//
// The credential (tokenized PAN, expiry, CVV, per the README) never passes through this interface: getCredential
// writes it to a 0600 file and returns only the receipt (status, token type, token expiry). Only the checkout port
// reads that file, and the executor deletes it afterwards.

/** The airi-cli release these flags were read from. A real adapter refuses any other version until re-read. */
export const AIRI_CLI_DOCUMENTED_VERSION = "0.1.0-beta.4";

/** `airi-cli mandate result --result`, as documented. */
export type AiriMandateResult = "SUCCEEDED" | "CANCELLED" | "DECLINED";

/** `airi-cli mandate list --status`, as documented. */
export type AiriMandateStatus = "CREATED" | "AUTHENTICATED" | "READY" | "COMPLETED" | "FAILED" | "DENIED";

export interface AiriPaymentMethod {
  paymentMethodId: string;
  /** For people only: brand and last four, never more. */
  display?: string;
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
  /** Where the wallet owner approves this mandate with a passkey. Shown to that person; never written to the log. */
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

export interface AiriClient {
  /** "stand-in" for ./standIn.ts; a real adapter would be "airi-cli". Shown wherever a result is shown. */
  readonly kind: "stand-in" | "airi-cli";
  /** The words shown next to every result this client produced. */
  readonly label: string;
  listPaymentMethods(): Promise<AiriPaymentMethod[]>;
  createMandate(req: AiriMandateRequest): Promise<AiriMandate>;
  /** Waits for the wallet owner's approval, then writes the credential to `file` (0600). Returns the receipt only. */
  getCredential(mandateId: string, file: string): Promise<AiriCredentialReceipt>;
  reportResult(mandateId: string, result: AiriMandateResult, reason?: string): Promise<void>;
  cancelMandate(mandateId: string): Promise<void>;
}

/** The merchant's checkout: the only code that reads the credential file. */
export interface AiriCheckout {
  readonly kind: "stand-in" | "merchant";
  readonly label: string;
  /** Submits the order with the credential in `credentialFile`. Returns the merchant's own reference and outcome. */
  submit(order: { merchantUrl: string; amount: string; currency: string }, credentialFile: string): Promise<{ outcome: AiriMandateResult; reference: string; code?: string }>;
}

// ---- the documented command line, built but never run here -------------------------------------------------------

const SAFE_TEXT = /^[^\p{Cc}]{1,200}$/u;
/** The CLI parses an item as `name:<product>,unit_price:<price>,quantity:<n>`, so a name holding , or : could add fields. */
const ITEM_NAME = /^[^,:\p{Cc}]{1,120}$/u;
const AMOUNT = /^(0|[1-9]\d{0,8})\.\d{2}$/;
const COUNT = /^[1-9]\d{0,3}$/;

/**
 * The argv of `airi-cli mandate create` for this request, exactly as the README documents the flags, with JSON
 * output and telemetry off. Throws on any value the CLI's item syntax or a terminal could misread. Not executed here.
 */
export function mandateCreateArgs(req: AiriMandateRequest): string[] {
  for (const [k, v] of Object.entries({ source: req.source, paymentMethodId: req.paymentMethodId, merchantName: req.merchantName, description: req.description })) {
    if (!SAFE_TEXT.test(v)) throw new Error(`airi mandate: ${k} is empty, too long or holds control characters`);
  }
  const url = new URL(req.merchantUrl);
  if (url.protocol !== "https:") throw new Error("airi mandate: the merchant URL must be https");
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
    "-o", "json", "--no-telemetry",
  ];
}
