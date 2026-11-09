// Purser as an Airwallex platform, the runner's side of the account binding (docs/airwallex-platform.md, red team 6).
// The account a company's payouts run from is never a local setting: Purser Cloud signs a short-lived binding of the
// company (tenant) to its own connected account (id, status, the display name the cloud holds) and to Purser's own
// platform account for fees, with the platform's Ed25519 key. The runner keeps the latest binding it fetched
// (setting platform.binding, refreshed on every cloud sync) and checks it, with the platform's public key and its own
// tenant id from the environment, before it plans a payment and again before it pays one. A binding for another
// company, an account that is not active, an expired or unsigned binding: nothing is planned or paid.

import { createPublicKey, verify } from "node:crypto";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { getSetting, setSetting } from "../world/settings.js";
import { policyValue } from "../policy/rules.js";
import { ACCOUNT_ID, BINDING_VERSION, FEE_BPS_CAP, platformFeeOn, platformOn, type AccountBinding } from "./platform.js";

export { FEE_BPS_CAP } from "./platform.js";

type Env = Record<string, string | undefined>;

/** What a binding check found: the binding, or why there is none Purser may pay from. */
export type BindingCheck = { ok: true; binding: AccountBinding } | { ok: false; reason: string };

const B64U = /^[A-Za-z0-9_-]+$/;

/**
 * Checks a binding token (`<base64url JSON>.<base64url Ed25519 signature over the first part>`) against the platform
 * key in PURSER_PLATFORM_PUBLIC_KEY (base64 SPKI) and this runner's tenant in PURSER_TENANT_ID.
 */
export function checkBinding(token: string, now: Date, env: Env = process.env): BindingCheck {
  const keyB64 = env.PURSER_PLATFORM_PUBLIC_KEY ?? "";
  const tenant = env.PURSER_TENANT_ID ?? "";
  if (!keyB64) return { ok: false, reason: "PURSER_PLATFORM_PUBLIC_KEY is not set, so no account binding from Purser Cloud can be checked" };
  if (!/^t_[A-Za-z0-9_-]{6,64}$/.test(tenant)) return { ok: false, reason: "PURSER_TENANT_ID is not set to this company's Purser Cloud id" };
  if (!token) return { ok: false, reason: "no account binding from Purser Cloud yet; sync with the cloud first (npm run cloud -- sync)" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || !B64U.test(body) || !B64U.test(sig)) return { ok: false, reason: "the account binding is not a signed binding" };
  let good: boolean;
  try {
    const key = createPublicKey({ key: Buffer.from(keyB64, "base64"), format: "der", type: "spki" });
    good = key.asymmetricKeyType === "ed25519" && verify(null, Buffer.from(body, "ascii"), key, Buffer.from(sig, "base64url"));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "the account binding's signature does not check against Purser's platform key" };
  let b: AccountBinding;
  try {
    b = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccountBinding;
  } catch {
    return { ok: false, reason: "the account binding is not readable" };
  }
  if (b.v !== BINDING_VERSION || typeof b.account_id !== "string" || !ACCOUNT_ID.test(b.account_id) || typeof b.fee_account !== "string" || !ACCOUNT_ID.test(b.fee_account)
    || typeof b.name !== "string" || typeof b.issued_at !== "number" || typeof b.expires_at !== "number") return { ok: false, reason: "the account binding is incomplete" };
  if (b.tenant !== tenant) return { ok: false, reason: "the account binding is for another company; nothing is paid from its account" };
  if (b.expires_at <= now.getTime()) return { ok: false, reason: `the account binding expired at ${new Date(b.expires_at).toISOString()}; sync with Purser Cloud for a fresh one` };
  if (b.issued_at > now.getTime() + 5 * 60_000) return { ok: false, reason: "the account binding is dated in the future" };
  if (b.status !== "active") return { ok: false, reason: `the company's Airwallex account ${b.account_id} is ${b.status}, not active; nothing is paid from it` };
  return { ok: true, binding: b };
}

/** The binding this runner holds (from its last cloud sync), checked now. */
export function currentBinding(db: DB, now: Date, env: Env = process.env): BindingCheck {
  return checkBinding(getSetting(db, "platform.binding", ""), now, env);
}

/**
 * Keeps the binding the cloud just gave (or none: "" when the cloud has no account for the company). Kept only when its
 * signature and company check, whatever its status; the status is judged when a payment is planned or paid.
 */
export function storeBinding(db: DB, token: string | null, now = new Date(), env: Env = process.env): BindingCheck | null {
  if (!token) {
    if (getSetting(db, "platform.binding", "")) setSetting(db, "system", "platform.binding", "", now);
    return null;
  }
  const c = checkBinding(token, now, env);
  const signedForUs = c.ok || / is (created|pending|action_required|refused|dormant|closed), not active/.test(c.reason);
  if (signedForUs && getSetting(db, "platform.binding", "") !== token) setSetting(db, "system", "platform.binding", token, now);
  return c;
}

/** The paying account and Purser's fee for a payment planned now: off, or from a valid binding and the CFO policy. */
export type PlatformPlan =
  | { ok: true; paying: { id: string; name: string } | null; feeBps: number; feeTo: string | null }
  | { ok: false; reason: string };

/** Purser's fee in basis points from the CFO policy (platform.fee_bps, Face ID to change), at most FEE_BPS_CAP. */
export function feeBpsOf(db: DB): number | null {
  const v = policyValue(db, "platform.fee_bps") || "0";
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n <= FEE_BPS_CAP ? n : null;
}

export function platformPlan(db: DB, now: Date, env: Env = process.env): PlatformPlan {
  if (!platformOn(env)) return { ok: true, paying: null, feeBps: 0, feeTo: null };
  const b = currentBinding(db, now, env);
  if (!b.ok) return { ok: false, reason: b.reason };
  const paying = { id: b.binding.account_id, name: `${b.binding.name.slice(0, 100)} (Airwallex, through Purser)` };
  if (!platformFeeOn(env)) return { ok: true, paying, feeBps: 0, feeTo: null };
  const feeBps = feeBpsOf(db);
  if (feeBps === null) return { ok: false, reason: `Purser's fee in the policy (platform.fee_bps) is not a whole number from 0 to ${FEE_BPS_CAP} basis points; nothing is planned` };
  return { ok: true, paying, feeBps, feeTo: feeBps > 0 ? b.binding.fee_account : null };
}

/** Purser's fee on an amount, in cents. */
export const platformFeeCents = (amountCents: number, bps: number) => Math.round((amountCents * bps) / 10_000);

interface PlatformTerms {
  amount?: unknown;
  currency?: unknown;
  paying_account?: { id?: unknown } | null;
  platform_fee?: { amount?: unknown; currency?: unknown; bps?: unknown; to_account?: unknown } | null;
}

/**
 * The one check every executor that moves Airwallex money runs before it moves any (red team 6): the account the
 * terms were signed for is the account this runner's rail acts for, and both are the company's own account in a valid
 * binding (or, with the platform off, neither names one); a fee in the terms is within the cap, goes to Purser's
 * account in the binding and is the signed share of the amount. Throws with the reason; nothing is paid.
 */
export function checkPayingAccount(db: DB, t: PlatformTerms, rail: { payingAccount?: string | null }, now: Date, env: Env = process.env): void {
  const signed = typeof t.paying_account?.id === "string" ? t.paying_account.id : null;
  const acting = rail.payingAccount ?? null;
  let bound: AccountBinding | null = null;
  if (platformOn(env)) {
    const b = currentBinding(db, now, env);
    if (!b.ok) throw new Error(`${b.reason}; nothing is paid`);
    bound = b.binding;
  }
  const own = "the company's own Airwallex account";
  const expected = bound?.account_id ?? null;
  if (signed !== expected) throw new Error(`the terms were signed for payment from ${signed ?? own}, but the company's bound account is ${expected ?? own}; nothing is paid`);
  if (acting !== expected) throw new Error(`the terms were signed for payment from ${signed ?? own}, but this runner pays from ${acting ?? own}; nothing is paid`);
  const fee = t.platform_fee;
  if (fee) {
    if (!bound || !platformFeeOn(env)) throw new Error("the terms carry a Purser fee, but Purser's fee is switched off; nothing is paid");
    const bps = Number(fee.bps);
    if (!Number.isInteger(bps) || bps < 1 || bps > FEE_BPS_CAP) throw new Error(`the Purser fee in the terms (${String(fee.bps)} basis points) is above the cap of ${FEE_BPS_CAP}; nothing is paid`);
    if (fee.to_account !== bound.fee_account) throw new Error(`the Purser fee in the terms goes to ${String(fee.to_account)}, not to Purser's platform account in the binding; nothing is paid`);
    const amount = typeof t.amount === "string" && /^\d+\.\d{2}$/.test(t.amount) ? toCents(t.amount) : NaN;
    if (fee.currency !== t.currency || fee.amount !== fromCents(platformFeeCents(amount, bps))) throw new Error("the Purser fee in the terms is not its share of the amount; nothing is paid");
  }
}
