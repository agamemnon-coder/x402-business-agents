// Offers as signed, structured messages (26 Nov, negotiation upgraded). Every turn of /try/negotiate becomes an offer:
// the invoice, the amount, the discount, the pay-by day, the payee (the account on file, or the other account a turn
// named, masked), whether it accepts, the SHA-256 of its words, and the SHA-256 of the offer before it, so the offers
// form a chain and the last one's hash names them all. The agreement carries that hash (rails.ts transcript_sha256),
// so the terms the CFO signs name the whole negotiation.
//
// Each offer is signed by the agent that made it, in the agent identity scheme of src/policy/agentIdentity.ts: an
// Ed25519 signature over the JCS of the same envelope { v, agent, key_id, method, target, body_sha256, ts, nonce }, the
// key's id "aik_" + 16 hex of the SHA-256 of its public key (SPKI DER), body_sha256 the SHA-256 of the offer's JCS (as
// bodyHash hashes a parsed body). That module runs on Node with the ledger; this one runs in the cloud Worker too
// (WebCrypto), so the scheme is reimplemented here and test/negotiate-offers.test.ts holds the two byte for byte (an
// Ed25519 signature is deterministic: the same key and envelope give the same signature through either).
// Purser's Sourcing agent signs with a key made for the negotiation. The supplier's agent is simulated: its key is
// made by the simulation, and every place that shows it says so. Public keys go out with the negotiation; the page
// checks every signature in the visitor's browser.
import { createHash } from "node:crypto";
import { jcs, type Json, type JsonObject } from "@metalntwx/metal-pay/mandates";
import { sha256Hex } from "../lib/terms.js";

export const OFFER_SCHEMA = "purser.offer/v1" as const;
export const OFFER_METHOD = "negotiate/offer";

/** One offer. Strings and booleans only (money as two-decimal strings, as the approval terms). */
export interface Offer extends JsonObject {
  schema: typeof OFFER_SCHEMA;
  negotiation: string;
  n: string;
  from: "sourcing" | "supplier";
  invoice_no: string;
  currency: "EUR";
  invoice_amount: string;
  amount: string;
  discount: string;
  pay_by: string;
  /** "account on file", or the other account a turn named (masked). */
  payee: string;
  accept: boolean;
  message_sha256: string;
  /** The offer before it, by SHA-256; null for the first. */
  prev: string | null;
}

/** agentIdentity.ts's IdentityEnvelope and IdentityProof, field for field. */
export interface OfferEnvelope { v: 1; agent: string; key_id: string; method: string; target: string; body_sha256: string; ts: string; nonce: string }
export interface OfferSignature extends OfferEnvelope { sig: string }
/** An agent's signing key: its public half goes out with the negotiation; the private half never leaves the server. */
export interface AgentKey { agent: string; key_id: string; public_key: string; label: string }
export interface SigningKey extends AgentKey { private: CryptoKey }

export const offerSha256 = (o: Offer): string => sha256Hex(jcs(o));
export const offerTarget = (o: Offer): string => `negotiation/${o.negotiation}/offer/${o.n}`;

const b64u = (b: Uint8Array): string => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64u = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
/** agentIdentity.ts keyIdOf: from the public key's SPKI DER. */
export const keyIdOf = (spki: Uint8Array): string => `aik_${createHash("sha256").update(spki).digest("hex").slice(0, 16)}`;

/** A fresh Ed25519 key for one agent in one negotiation (WebCrypto: Node and the Worker alike). */
export async function newAgentKey(agent: string, label: string): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return keyFrom(agent, label, pair.privateKey, new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer));
}
export const keyFrom = (agent: string, label: string, priv: CryptoKey, spki: Uint8Array): SigningKey => ({ agent, label, key_id: keyIdOf(spki), public_key: b64u(spki), private: priv });

/** The agent signs its offer (the envelope's ts and nonce fresh unless given). */
export async function signOffer(k: SigningKey, offer: Offer, o: { now?: Date; nonce?: string } = {}): Promise<OfferSignature> {
  const env: OfferEnvelope = {
    v: 1, agent: k.agent, key_id: k.key_id, method: OFFER_METHOD, target: offerTarget(offer), body_sha256: offerSha256(offer),
    ts: (o.now ?? new Date()).toISOString(), nonce: o.nonce ?? b64u(crypto.getRandomValues(new Uint8Array(18))),
  };
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", k.private, new TextEncoder().encode(jcs(env as unknown as Json))));
  return { ...env, sig: b64u(sig) };
}

/** Whether a signature is this offer's, by this key: the envelope names the offer (hash and target) and the key, and the signature holds. */
export async function verifyOffer(offer: Offer, s: OfferSignature, key: AgentKey): Promise<boolean> {
  if (s.v !== 1 || s.method !== OFFER_METHOD || s.agent !== key.agent || s.key_id !== key.key_id || s.target !== offerTarget(offer) || s.body_sha256 !== offerSha256(offer)) return false;
  if (keyIdOf(fromB64u(key.public_key)) !== key.key_id) return false;
  const { sig, ...env } = s;
  try {
    const pub = await crypto.subtle.importKey("spki", fromB64u(key.public_key), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", pub, fromB64u(sig), new TextEncoder().encode(jcs(env as unknown as Json)));
  } catch { return false; }
}

/** Whether offers form one chain: each names the one before it, the first none. */
export const chained = (offers: Offer[]): boolean => offers.every((o, i) => o.prev === (i === 0 ? null : offerSha256(offers[i - 1]!)) && o.n === String(i + 1));

/**
 * The agreed deal written in the style of the Agent Payments Protocol's intent and cart mandates, as a reading aid
 * only: the field names follow AP2's IntentMandate and CartMandate, the values are this negotiation's. It is not AP2's
 * schema, it is not signed as AP2 signs mandates, and nothing claims AP2 compatibility.
 */
export function ap2Style(x: { supplier: string; invoice_no: string; currency: string; invoice_amount: string; amount: string; discount: string; pay_by: string; latest: string; reference: string; offer_sha256: string | null; policy: string }): JsonObject {
  return {
    note: "A mapping in the style of AP2's intent and cart mandates, for reading only. Not AP2's schema; not AP2-compatible.",
    intent_mandate: { natural_language_description: `Pay ${x.supplier}'s invoice ${x.invoice_no} early for a discount, within the CFO's policy`, merchants: [x.supplier], user_cart_confirmation_required: true, requires_refundability: false, intent_expiry: x.latest },
    cart_mandate: {
      contents: { id: x.reference, merchant_name: x.supplier, cart_expiry: x.pay_by, payment_request: { total: { label: "Agreed amount", amount: { currency: x.currency, value: x.amount } }, display_items: [{ label: `Invoice ${x.invoice_no}`, amount: { currency: x.currency, value: x.invoice_amount } }, { label: "Early-payment discount", amount: { currency: x.currency, value: `-${x.discount}` } }] } },
      merchant_authorization: x.offer_sha256 ? `the supplier agent's signed offer ${x.offer_sha256} (a simulated supplier)` : null,
      user_authorization: `the CFO's passkey over the payment terms, on signing (${x.policy})`,
    },
  };
}
