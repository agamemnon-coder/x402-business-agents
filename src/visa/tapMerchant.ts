// D25: our merchant layer behind Visa's reference proxy (which, unchanged, checks only that the key exists and is
// active in its registry, the timing loosely, its in-memory nonce, and an Ed25519 signature over @authority and @path,
// and only on paths under /product/). It adds no header we could trust and a request could bypass it, so this layer
// checks everything itself, on the request exactly as received (raw header lines, body bytes):
//   1. one field line each of Signature, Signature-Input, Content-Digest and every Purser-* header;
//   2. POST to the configured checkout path (under /product/), no query string;
//   3. both signatures parse strictly; Content-Digest holds exactly one sha-256, equal to the body's;
//   4. signature 1's keyId equals signature 2's keyid (case-sensitive), and their nonces are equal;
//   5. the tag is this checkout's (agent-payer-auth), both windows at most 480 s and now inside them (one shared skew);
//   6. the key is in our own pinned tap_agents list (never Visa's registry): not revoked, before its end date, pinned
//      for this merchant's configured public authority (not the Host header, which the proxy rewrites);
//   7. signature 1 verifies over the base the proxy builds (that authority, the request target), signature 2 over its
//      RFC 9421 base, which covers TAP's two headers as received;
//   8. the order in the signed body (plan, amount, currency) is one this merchant sells, at its price, when the
//      merchant is configured with its name (review, 2 November: the payment check is ours too);
//   9. only then the nonce is stored, per key; a nonce seen before is a replay.
// Each refusal names its reason; sig1 and sig2 say how far each signature got. Never throws: an error is a refusal.

import { createHash, createPublicKey, timingSafeEqual } from "node:crypto";
import { PLANS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import {
  parseContentDigest, parseSig1, parseSig2, sig1Base, sig2Base, splitTarget, TAP_CLOCK_SKEW_S, TAP_MAX_WINDOW_S, verifyEd25519, windowProblem,
  type TapTag,
} from "./tapSig.js";

export interface TapMerchantConfig {
  /** The authority agents sign for: this merchant's public host (and port), as the proxy's clients address it. */
  authority: string;
  /** The checkout path, under /product/ (the only paths the reference proxy checks at all). */
  checkoutPath: string;
  tag: TapTag;
  skew: number;
  /** When set, the signed body must be an order for one of this merchant's plans (PLANS), at its price, in EUR. */
  merchantName?: string;
}

export function tapMerchantConfig(c: { authority: string; checkoutPath: string; tag?: TapTag; skew?: number; merchantName?: string }): TapMerchantConfig {
  if (!c.checkoutPath.startsWith("/product/") || c.checkoutPath.includes("?")) throw new Error("the checkout must be a path under /product/ without a query: the reference proxy checks no other path");
  if (!c.authority || /[/\s]/.test(c.authority)) throw new Error("the authority is a host (and port), nothing else");
  return { authority: c.authority.toLowerCase(), checkoutPath: c.checkoutPath, tag: c.tag ?? "agent-payer-auth", skew: c.skew ?? TAP_CLOCK_SKEW_S, ...(c.merchantName ? { merchantName: c.merchantName } : {}) };
}

/** The request as received: Node's req.method, req.url and req.rawHeaders (name, value, name, value…), and the body. */
export interface ReceivedCheckout { method: string; target: string; rawHeaders: readonly string[]; body: Uint8Array }

/** Raw header lines from a plain map (one line each), for requests built in-process. */
export function rawHeadersOf(h: Record<string, string>): string[] {
  return Object.entries(h).flat();
}

export type SigVerdict = "verified" | "not checked" | `refused: ${string}`;

/** The order the merchant checked: what the card may be charged, and nothing else. */
export interface TapOrder { plan: string; amount: string; currency: "EUR"; amountCents: number }

/** The signed body as an order for one of this merchant's plans, at its price; or why not. */
export function orderProblem(body: Uint8Array, merchantName: string): { order: TapOrder } | { problem: string } {
  let o: unknown;
  try { o = JSON.parse(Buffer.from(body).toString("utf8")); } catch { return { problem: "the body is not an order (not JSON)" }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { problem: "the body is not an order" };
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "amount,currency,plan") return { problem: "the order must name exactly plan, amount and currency" };
  const { plan, amount, currency } = o as Record<string, unknown>;
  const p = typeof plan === "string" ? PLANS[plan] : undefined;
  if (!p || p.merchant !== merchantName) return { problem: `${merchantName} sells no plan ${String(plan)}` };
  if (currency !== "EUR") return { problem: `the order's currency ${String(currency)} is not EUR` };
  if (typeof amount !== "string") return { problem: "the order's amount must be a decimal string, as the price is written" };
  if (amount !== fromCents(p.amountCents)) return { problem: `the order's amount ${String(amount)} is not ${fromCents(p.amountCents)}, the price of ${plan as string}` };
  return { order: { plan: plan as string, amount: amount as string, currency: "EUR", amountCents: p.amountCents } };
}

export type TapMerchantVerdict =
  | { ok: true; agent: string; keyId: string; nonce: string; created: number; expires: number; sig1: "verified"; sig2: "verified"; order?: TapOrder }
  | { ok: false; reason: string; sig1: SigVerdict; sig2: SigVerdict; keyId?: string; nonce?: string };

const GUARDED = (name: string) => name === "signature" || name === "signature-input" || name === "content-digest" || name.startsWith("purser-");
const REQUIRED = ["signature-input", "signature", "content-digest", "purser-signature-input", "purser-signature"] as const;

interface PinnedKey { agent: string; public_jwk: string; domains_json: string; not_after: number; revoked_at: string | null }

/** How long a nonce is kept: after this no signature carrying it can be inside its window, with this skew either way. */
export function nonceKeepSeconds(skew: number): number {
  return TAP_MAX_WINDOW_S + 2 * skew;
}

export function verifyTapCheckout(db: DB, req: ReceivedCheckout, cfg: TapMerchantConfig, now = Math.floor(Date.now() / 1000)): TapMerchantVerdict {
  try {
    return check(db, req, cfg, now);
  } catch (e) {
    // A busy or broken ledger, an unreadable pinned row: refused, never thrown, nothing stored.
    return { ok: false, reason: `the merchant could not check it: ${(e as Error).message.slice(0, 200)}`, sig1: "not checked", sig2: "not checked" };
  }
}

function check(db: DB, req: ReceivedCheckout, cfg: TapMerchantConfig, now: number): TapMerchantVerdict {
  let sig1: SigVerdict = "not checked", sig2: SigVerdict = "not checked";
  let ids: { keyId?: string; nonce?: string } = {};
  const no = (reason: string): TapMerchantVerdict => ({ ok: false, reason, sig1, sig2, ...ids });

  // 1. One field line each, from the raw lines (Node would join duplicates with ", " and the proxy would sign the join).
  const lines = new Map<string, string[]>();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]!.toLowerCase();
    lines.set(name, [...(lines.get(name) ?? []), req.rawHeaders[i + 1]!.trim()]);
  }
  for (const [name, values] of lines) if (GUARDED(name) && values.length > 1) return no(`duplicate header ${name}: one field line only`);
  for (const name of REQUIRED) if (!lines.has(name)) return no(`missing header ${name}`);
  const h = (name: (typeof REQUIRED)[number]) => lines.get(name)![0]!;

  // 2. The checkout, exactly.
  if (req.method !== "POST") return no(`checkout takes POST, not ${req.method}`);
  if (req.target.includes("?")) return no("a query string on the checkout: refused (the proxy's @path would carry it; checkout URLs carry none)");
  const { path, query } = splitTarget(req.target);
  if (path !== cfg.checkoutPath) return no(`path ${path} is not this merchant's checkout ${cfg.checkoutPath}`);

  // 3. Parse both, and the body against its digest.
  const s1 = parseSig1(h("signature-input"), h("signature"));
  if (!s1.ok) { sig1 = `refused: ${s1.reason}`; return no(s1.reason); }
  ids = { keyId: s1.value.keyId, nonce: s1.value.nonce };
  const s2 = parseSig2(h("purser-signature-input"), h("purser-signature"));
  if (!s2.ok) { sig2 = `refused: ${s2.reason}`; return no(s2.reason); }
  const digest = parseContentDigest(h("content-digest"));
  if (!digest.ok) return no(digest.reason);
  if (!timingSafeEqual(digest.value, createHash("sha256").update(req.body).digest())) return no("Content-Digest does not match the body received");

  // 4. One key, one nonce.
  const a = s1.value, b = s2.value;
  if (a.keyId !== b.keyid) return no(`signature 1's keyId ${a.keyId} and signature 2's keyid ${b.keyid} differ`);
  if (a.nonce !== b.nonce) return no("the nonces of signature 1 and signature 2 differ: signature 2 belongs to another request");

  // 5. Tag and windows.
  if (a.tag !== cfg.tag) { sig1 = `refused: wrong tag ${a.tag}`; return no(`wrong tag ${a.tag}: this checkout needs ${cfg.tag}`); }
  const w1 = windowProblem(a.created, a.expires, now, cfg.skew);
  if (w1) { sig1 = `refused: ${w1}`; return no(`signature 1: ${w1}`); }
  const w2 = windowProblem(b.created, b.expires, now, cfg.skew);
  if (w2) { sig2 = `refused: ${w2}`; return no(`signature 2: ${w2}`); }

  // 6. Our pinned key.
  const row = db.prepare("SELECT agent, public_jwk, domains_json, not_after, revoked_at FROM tap_agents WHERE keyid = ?").get(a.keyId) as PinnedKey | undefined;
  if (!row) return no(`unknown key ${a.keyId}: not in our pinned tap_agents list`);
  if (row.revoked_at) return no(`key ${a.keyId} revoked at ${row.revoked_at}`);
  if (row.not_after < now) return no(`key ${a.keyId} is past its end date`);
  let domains: unknown;
  try { domains = JSON.parse(row.domains_json); } catch { domains = null; }
  if (!Array.isArray(domains)) return no(`key ${a.keyId}: its pinned domains are not readable`);
  if (!domains.includes(cfg.authority)) return no(`key ${a.keyId} is not pinned for ${cfg.authority}`);
  let publicKey;
  try {
    publicKey = createPublicKey({ key: JSON.parse(row.public_jwk) as import("node:crypto").JsonWebKey, format: "jwk" });
  } catch {
    return no(`key ${a.keyId}: the pinned public key is not readable`);
  }

  // 7. Both signatures, over the bases rebuilt from what was received and this merchant's configuration.
  if (!verifyEd25519(publicKey, sig1Base(cfg.authority, req.target, a.paramsText), a.signature)) {
    sig1 = "refused: does not verify";
    return no(`signature 1 does not verify for ${cfg.authority}${req.target}`);
  }
  sig1 = "verified";
  const base2 = sig2Base({ method: req.method, authority: cfg.authority, path, query, contentDigest: h("content-digest"), signatureInput: h("signature-input"), signature: h("signature") }, b.paramsText);
  if (!verifyEd25519(publicKey, base2, b.signature)) {
    sig2 = "refused: does not verify";
    return no("signature 2 does not verify (body, digest, method, target or TAP headers changed)");
  }
  sig2 = "verified";

  // 8. The order the agent signed, against what this merchant sells.
  let order: TapOrder | undefined;
  if (cfg.merchantName) {
    const r = orderProblem(req.body, cfg.merchantName);
    if ("problem" in r) return no(`payment check: ${r.problem}`);
    order = r.order;
  }

  // 9. The nonce, last, per key.
  const fresh = db.transaction(() => {
    // Kept for the window plus this merchant's own skew either way (review, 2 November: a fixed retention with a larger
    // configured skew let a replay through).
    db.prepare("DELETE FROM tap_rail_nonces WHERE seen_at < ?").run(now - nonceKeepSeconds(cfg.skew));
    return db.prepare("INSERT OR IGNORE INTO tap_rail_nonces (keyid, nonce, seen_at) VALUES (?, ?, ?)").run(a.keyId, a.nonce, now).changes === 1;
  }).immediate();
  if (!fresh) return no("nonce already accepted for this key: a replay");
  return { ok: true, agent: row.agent, keyId: a.keyId, nonce: a.nonce, created: a.created, expires: a.expires, sig1: "verified", sig2: "verified", ...(order ? { order } : {}) };
}
