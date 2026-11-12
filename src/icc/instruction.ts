// The ICC instruction, built from the CFO's signed terms and from nothing else, and the instruction check
// (docs/visa-icc.md, sections 3 to 5). Pure functions: no database, no network, no clock but the one passed in.
//
// The mapping. The CFO signs the SHA-256 of the exact terms (src/lib/terms.ts): agent, amount, currency, merchant,
// items, description, the card's token and the expiry. From those terms:
//   amount, currency   -> mandates[0].declineThreshold (the cap), sent as signed; compared in integer cents;
//   expires_at         -> mandates[0].effectiveUntilTime, whole UTC seconds as digits (no floating point);
//   merchant.name      -> mandates[0].preferredMerchantName, and later the credential request's merchant name, which
//                         the API limits to 40 characters: a longer name is refused before any call, never cut;
//   agent              -> deviceInformation.applicationName ("Purser <agent> agent"); the API has no agent field;
//   the action's id    -> mandates[0].mandateId and the credential request's reference code;
//   the terms hash     -> appended to mandates[0].description (the description is shortened to make room; the hash
//                         still covers the full text) and written into consumerPrompt.
// Device and assurance data do not come from the terms: they come from the cardholder's passkey step, are passed
// through unchanged at the moment of sending, and are never part of the record kept here.
//
// The instruction check. The documented API has no call that reads an instruction back. So before any credential is
// requested, Purser compares its own record of the instruction it sent, and the three fields of the create answer,
// with the signed terms, and refuses on any difference, on an expired instruction and on an amount above the cap.
// It is a pure function over (the signed terms, the instruction as recorded, the create answer, the purchase to make,
// now), so that a real read call can replace the source of "the instruction as recorded" later.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { toCents } from "../lib/money.js";
import { sha256Hex, termsHash, type Terms } from "../lib/terms.js";

export const ICC_PURCHASE_KIND = "icc_purchase";
/** The words in front of the terms hash wherever a free-text field carries it. */
export const TERMS_HASH_LABEL = "purser-terms-sha256";
/** An instruction that runs out within this time is treated as expired: the time one credential request may take. */
export const ICC_EXPIRY_MARGIN_MS = 60_000;

export type IccTerms = Terms & {
  agent: string; amount: string; currency: string; merchant: { name: string; url: string; country: string };
  items: { name: string; unit_price: string; quantity: string }[]; description: string; payment_method_id: string;
};

/** A signed term that the API's documented limits cannot take. Refused before any call; nothing is ever cut to fit. */
export class IccFieldRefusal extends Error {
  readonly code = "PURSER_ICC_FIELD_NOT_ALLOWED";
  constructor(readonly field: string, why: string) {
    super(`${field}: ${why}`);
    this.name = "IccFieldRefusal";
  }
}

// The documented pattern of most string fields: not only the characters * . , ' # _ / - and no "./"; one line.
const TEXT = /^(?![*.,'#_/-]+$)(?!.*\.\/.*).*$/;
const AMOUNT = /^(0|[1-9]\d{0,8})\.\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;
const INSTRUCTION_ID = /^[A-Za-z0-9-]{36,50}$/;

/** A string within the documented length that fits the documented pattern and has no control character. */
function plain(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== "string") throw new IccFieldRefusal(field, "is not text");
  if (value.length < min || value.length > max) throw new IccFieldRefusal(field, `is ${value.length} characters; the API allows ${min === max ? `exactly ${max}` : `${min} to ${max}`}, and Purser never cuts a signed value`);
  if (/\p{Cc}/u.test(value) || !TEXT.test(value)) throw new IccFieldRefusal(field, "does not fit the API's documented pattern (one line, not only punctuation, no \"./\")");
  return value;
}

const cents = (s: unknown): number | null => (typeof s === "string" && AMOUNT.test(s) ? toCents(s) : null);

/** `expires_at` (UTC ISO-8601 with Z) as whole Unix seconds, in digits. Integer arithmetic only. */
export function expiryEpochSeconds(expiresAt: string): string {
  const m = typeof expiresAt === "string" ? ISO_UTC.exec(expiresAt) : null;
  if (!m) throw new IccFieldRefusal("expires_at", "is not a UTC time with Z");
  const ms = Date.parse(expiresAt);
  // Date.parse gives whole milliseconds or NaN; a date that does not exist (month 13) is NaN.
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new IccFieldRefusal("expires_at", "is not a time that exists");
  const millis = BigInt(ms);
  if (millis % 1000n !== 0n) throw new IccFieldRefusal("expires_at", "has a fraction of a second; the API takes whole seconds and Purser does not round a signed time");
  const seconds = (millis / 1000n).toString(10);
  if (seconds.length > 12) throw new IccFieldRefusal("expires_at", "is too far away for the API's 12 characters");
  return seconds;
}

/** What Purser keeps of an instruction: every field that comes from the terms. No device or assurance data. */
export interface IccInstructionRecord {
  clientCorrelationId: string;
  paymentInformation: { instrumentIdentifier: { id: string } };
  deviceInformation: { applicationName: string };
  mandates: [{
    mandateId: string;
    preferredMerchantName: string;
    declineThreshold: { amount: string; currencyCode: string };
    effectiveUntilTime: string;
    description: string;
  }];
  consumerPrompt: string;
}

export interface IccIds {
  /** One per purchase: the mandate's ID and the credential request's reference code. */
  actionId: string;
  /** Purser's own ID for the calls of this purchase; the service echoes it in every answer. */
  correlationId: string;
}

/** The checks every signed term must pass before any call is made. */
function checkedTerms(t: IccTerms, termsSha256: string, ids: IccIds) {
  if (!SHA256.test(termsSha256)) throw new IccFieldRefusal("terms hash", "is not 64 lower-case hexadecimal characters");
  const amountCents = cents(t.amount);
  if (amountCents === null || amountCents === 0) throw new IccFieldRefusal("amount", "is not a positive two-decimal amount of at most 12 characters");
  if (typeof t.currency !== "string" || !/^[A-Z]{3}$/.test(t.currency)) throw new IccFieldRefusal("currency", "is not a three-letter currency code");
  const merchant = t.merchant ?? { name: "", url: "", country: "" };
  // 40 is the credential request's limit for the merchant name, the tighter of the two fields the name goes to.
  const merchantName = plain(merchant.name, "merchant.name", 40);
  const merchantUrl = plain(merchant.url, "merchant.url", 255);
  let url: URL | null = null;
  try { url = new URL(merchantUrl); } catch { /* refused below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password) throw new IccFieldRefusal("merchant.url", "is not a plain https URL");
  if (typeof merchant.country !== "string" || !/^[A-Z]{2}$/.test(merchant.country)) throw new IccFieldRefusal("merchant.country", "is not a two-letter country code");
  if (typeof t.payment_method_id !== "string" || !/^[A-Za-z0-9]{12,32}$/.test(t.payment_method_id)) throw new IccFieldRefusal("payment_method_id", "is not an instrument identifier of 12 to 32 letters and digits");
  const agent = plain(t.agent, "agent", 64);
  return {
    amount: t.amount, currency: t.currency, merchantName, merchantUrl, merchantCountry: merchant.country, token: t.payment_method_id, agent,
    description: plain(t.description, "description", 4096, 0),
    proposalId: plain(t.proposal_id, "proposal_id", 50),
    actionId: plain(ids.actionId, "action id", 50),
    correlationId: plain(ids.correlationId, "correlation id", 255),
    expiry: expiryEpochSeconds(t.expires_at),
  };
}

/** The first `max` UTF-16 units of a text, never ending inside a character. */
function shortened(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trimEnd();
}

/** The instruction for these terms. Throws IccFieldRefusal when a signed value does not fit the documented limits. */
export function buildInstruction(terms: IccTerms, termsSha256: string, ids: IccIds): IccInstructionRecord {
  const t = checkedTerms(terms, termsSha256, ids);
  const carried = `${TERMS_HASH_LABEL} ${termsSha256}`;
  const description = plain(`${shortened(t.description, 255 - carried.length - 1)} ${carried}`.trimStart(), "description", 255);
  return {
    clientCorrelationId: t.correlationId,
    paymentInformation: { instrumentIdentifier: { id: t.token } },
    deviceInformation: { applicationName: plain(`Purser ${t.agent} agent`, "agent", 255) },
    mandates: [{
      mandateId: t.actionId,
      preferredMerchantName: t.merchantName,
      declineThreshold: { amount: t.amount, currencyCode: t.currency },
      effectiveUntilTime: t.expiry,
      description,
    }],
    consumerPrompt: plain(`The ${t.agent} agent may pay at most ${t.amount} ${t.currency} at ${t.merchantName} until ${terms.expires_at}. Purser proposal ${t.proposalId}; ${carried}.`, "consumerPrompt", 4098),
  };
}

/** The record as it is stored before the instruction is sent: canonical text (RFC 8785) and its SHA-256. */
export function recordOf(record: IccInstructionRecord): { json: string; sha256: string } {
  const json = jcs(record as unknown as Json);
  return { json, sha256: sha256Hex(json) };
}

/** Device and assurance data from the cardholder's passkey step: passed through, never kept. */
export interface IccPassthrough {
  deviceInformation: Record<string, unknown>;
  assuranceData: unknown[];
}

/** The create request: the record plus the passed-through data. The application name stays the one from the terms. */
export function instructionRequestBody(record: IccInstructionRecord, passthrough: IccPassthrough): Record<string, unknown> {
  return {
    clientCorrelationId: record.clientCorrelationId,
    paymentInformation: record.paymentInformation,
    deviceInformation: { ...passthrough.deviceInformation, applicationName: record.deviceInformation.applicationName },
    assuranceData: passthrough.assuranceData,
    mandates: record.mandates,
    consumerPrompt: record.consumerPrompt,
  };
}

/** The purchase a credential is asked for. In the flow it is derived from the terms; the check compares it anyway. */
export interface IccPurchaseToMake {
  actionId: string;
  amount: string;
  currency: string;
  merchantName: string;
  merchantUrl: string;
  merchantCountry: string;
}

export function purchaseFromTerms(t: IccTerms, actionId: string): IccPurchaseToMake {
  return { actionId, amount: t.amount, currency: t.currency, merchantName: t.merchant.name, merchantUrl: t.merchant.url, merchantCountry: t.merchant.country };
}

/** The credential request for one purchase under the instruction's one mandate, in the API reference's shape. */
export function buildCredentialsRequest(terms: IccTerms, termsSha256: string, ids: IccIds, purchase: IccPurchaseToMake): Record<string, unknown> {
  const t = checkedTerms(terms, termsSha256, ids);
  return {
    clientCorrelationId: t.correlationId,
    paymentInformation: { instrumentIdentifier: { id: t.token } },
    transactionData: [{
      clientReferenceInformation: { code: t.actionId },
      mandateReferenceData: [{ mandateId: t.actionId }],
      type: "PURCHASE",
      orderInformation: {
        amountDetail: { totalAmount: purchase.amount, currency: purchase.currency },
        lineItems: [{ items: { additionalInfo: [{ key: TERMS_HASH_LABEL, value: termsSha256 }] } }],
      },
      merchantOrderId: t.proposalId,
      merchantInformation: { merchantName: purchase.merchantName, merchantDescriptor: { url: purchase.merchantUrl, country: purchase.merchantCountry } },
    }],
  };
}

// ---- the instruction check -------------------------------------------------------------------------------------------

export type IccCheckCode =
  | "PURSER_ICC_TERMS_HASH_DIFFERS" | "PURSER_ICC_RECORD_UNREADABLE" | "PURSER_ICC_AMOUNT_DIFFERS" | "PURSER_ICC_ABOVE_CAP"
  | "PURSER_ICC_CURRENCY_DIFFERS" | "PURSER_ICC_MERCHANT_DIFFERS" | "PURSER_ICC_EXPIRY_DIFFERS" | "PURSER_ICC_EXPIRED"
  | "PURSER_ICC_REFERENCE_DIFFERS" | "PURSER_ICC_HASH_NOT_CARRIED" | "PURSER_ICC_RECORD_DIFFERS"
  | "PURSER_ICC_INSTRUCTION_PENDING" | "PURSER_ICC_ANSWER_INVALID";

export interface IccCreateAnswer {
  httpStatus: number;
  clientCorrelationId: string | null;
  instructionId: string | null;
  status: string | null;
  pendingEvents: string[];
}

export interface IccCheckInput {
  /** The terms as stored now. */
  terms: IccTerms;
  /** The hash the CFO approved. */
  approvedSha256: string;
  actionId: string;
  /** Purser's record of the instruction it sent, and the SHA-256 stored with it before sending. */
  recorded: { json: string; sha256: string };
  /** The three fields of the create answer, and its HTTP status. */
  answer: IccCreateAnswer;
  purchase: IccPurchaseToMake;
  now: Date;
}

export type IccCheck = { ok: true } | { ok: false; findings: { code: IccCheckCode; reason: string }[] };

const RECORD = "Purser's record of the instruction it sent";
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** A value for a refusal's text: short and on one line. */
const shown = (v: unknown): string => (typeof v === "string" ? v.replace(/\p{Cc}+/gu, " ").slice(0, 60) : "nothing");

/**
 * The check before any credential is requested. Every difference is reported; one is enough to refuse. What is
 * compared is Purser's own record of what it sent: the documented API has no call that returns an instruction.
 */
export function checkInstruction(i: IccCheckInput): IccCheck {
  const findings: { code: IccCheckCode; reason: string }[] = [];
  const add = (code: IccCheckCode, reason: string) => { findings.push({ code, reason }); };
  const signed = i.terms;

  // The terms hash, again, against what the CFO approved.
  let hash: string | null = null;
  try { hash = termsHash(signed); } catch { /* reported below */ }
  if (hash === null || hash !== i.approvedSha256 || !SHA256.test(i.approvedSha256)) add("PURSER_ICC_TERMS_HASH_DIFFERS", "the stored terms no longer hash to what the CFO approved");

  let parsed: unknown = null;
  try { parsed = JSON.parse(i.recorded.json) as unknown; } catch { /* reported below */ }
  const mandates = isObject(parsed) && Array.isArray(parsed.mandates) ? parsed.mandates : [];
  const mandate = mandates[0];
  if (!isObject(parsed) || !isObject(mandate) || !isObject(mandate.declineThreshold)) {
    add("PURSER_ICC_RECORD_UNREADABLE", `${RECORD} cannot be read`);
    return { ok: false, findings };
  }
  const threshold = mandate.declineThreshold as Record<string, unknown>;
  const merchant = isObject(signed.merchant) ? signed.merchant : { name: "", url: "", country: "" };

  // Amounts in integer cents.
  const signedCents = cents(signed.amount), capCents = cents(threshold.amount), payCents = cents(i.purchase.amount);
  if (signedCents === null || capCents === null || capCents !== signedCents) add("PURSER_ICC_AMOUNT_DIFFERS", `${RECORD} has the cap ${shown(threshold.amount)}; the signed terms say ${shown(signed.amount)}`);
  const lowestCap = Math.min(signedCents ?? 0, capCents ?? 0);
  if (payCents === null || payCents === 0 || payCents > lowestCap) add("PURSER_ICC_ABOVE_CAP", `the amount to pay, ${shown(i.purchase.amount)}, is not a positive amount within the cap`);

  if (threshold.currencyCode !== signed.currency || i.purchase.currency !== signed.currency) add("PURSER_ICC_CURRENCY_DIFFERS", `the currency of ${RECORD} or of the purchase is not the signed ${shown(signed.currency)}`);

  if (mandate.preferredMerchantName !== merchant.name) add("PURSER_ICC_MERCHANT_DIFFERS", `${RECORD} names the merchant ${shown(mandate.preferredMerchantName)}; the signed terms say ${shown(merchant.name)}`);
  else if (i.purchase.merchantName !== merchant.name || i.purchase.merchantUrl !== merchant.url || i.purchase.merchantCountry !== merchant.country) add("PURSER_ICC_MERCHANT_DIFFERS", "the merchant to pay is not the signed merchant (name, URL and country)");

  // The expiry in whole seconds, then the clock.
  let signedExpiry: string | null = null;
  try { signedExpiry = expiryEpochSeconds(signed.expires_at); } catch { /* a difference */ }
  if (signedExpiry === null || mandate.effectiveUntilTime !== signedExpiry) add("PURSER_ICC_EXPIRY_DIFFERS", `${RECORD} ends at ${shown(mandate.effectiveUntilTime)} (Unix seconds); the signed terms end at ${shown(signedExpiry)}`);
  else if (BigInt(i.now.getTime()) + BigInt(ICC_EXPIRY_MARGIN_MS) >= BigInt(signedExpiry) * 1000n) add("PURSER_ICC_EXPIRED", `the instruction ended, or ends within a minute, at ${shown(signed.expires_at)}`);

  const application = isObject(parsed.deviceInformation) ? parsed.deviceInformation.applicationName : undefined;
  if (application !== `Purser ${str(signed.agent)} agent` || mandate.mandateId !== i.actionId || i.purchase.actionId !== i.actionId) add("PURSER_ICC_REFERENCE_DIFFERS", `the agent or the action reference in ${RECORD}, or of the purchase, is not the signed agent and this action`);

  const carried = `${TERMS_HASH_LABEL} ${i.approvedSha256}`;
  const description = str(mandate.description);
  if ((!description.endsWith(` ${carried}`) && description !== carried) || !str(parsed.consumerPrompt).includes(`${carried}.`)) add("PURSER_ICC_HASH_NOT_CARRIED", `${RECORD} does not carry the approved terms hash in its description and its prompt`);

  // The whole record: unchanged since it was stored, and exactly what these terms build.
  let rebuilt: string | null = null;
  try { rebuilt = recordOf(buildInstruction(signed, i.approvedSha256, { actionId: i.actionId, correlationId: str(parsed.clientCorrelationId) })).json; } catch { /* a difference */ }
  if (sha256Hex(i.recorded.json) !== i.recorded.sha256 || rebuilt === null || rebuilt !== i.recorded.json) add("PURSER_ICC_RECORD_DIFFERS", `${RECORD} is not what the signed terms build, or changed after it was stored`);

  // The create answer: 200, an instruction ID of the documented length, the same correlation ID.
  if (i.answer.httpStatus !== 200 || i.answer.status === "PENDING" || i.answer.pendingEvents.length > 0) add("PURSER_ICC_INSTRUCTION_PENDING", "the instruction was not created outright: the answer was pending");
  else if (i.answer.instructionId === null || !INSTRUCTION_ID.test(i.answer.instructionId) || i.answer.clientCorrelationId === null || i.answer.clientCorrelationId !== parsed.clientCorrelationId) add("PURSER_ICC_ANSWER_INVALID", "the create answer has no instruction ID of the documented form, or another correlation ID");

  return findings.length === 0 ? { ok: true } : { ok: false, findings };
}
