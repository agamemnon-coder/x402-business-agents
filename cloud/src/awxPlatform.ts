// Purser as an Airwallex platform, the cloud side (docs/airwallex-platform.md): an owner opens the company's Airwallex
// account through Purser (a connected account), gets Airwallex's hosted onboarding link for the company's checks, and
// the account's status follows Airwallex's account.* webhooks. The cloud keeps the account's id and status only: never
// a key, never the onboarding link (it is short-lived and made when asked for). Payments do not run here: the runner
// pays on behalf of the account, after the CFO's Face ID over terms that name it.
//
// Off unless the cloud is given a platform rail (CloudEnv.awxPlatform); no call has been made to Airwallex for this yet.

import { ACCOUNT_ID, BINDING_TTL_MS, BINDING_VERSION, statusFromAccount, statusFromWebhook, type AccountBinding, type PlatformRail, type PlatformStatus } from "../../src/airwallex/platform.js";
import { logEvent } from "./log.js";
import type { Sql } from "./store.js";

export interface AwxPlatformEnv {
  rail: PlatformRail;
  /** The hosted onboarding flow template id Airwallex provides for the platform. */
  template: string;
  /** The secret Airwallex signs the platform's webhooks with. */
  webhookSecret: string;
  /**
   * Purser's platform signing key (Ed25519, PKCS#8, base64): it signs each company's binding to its own connected
   * account, which the runner checks with the public half before it plans or pays (red team 6). A secret of the Worker.
   */
  bindingKey: string;
  /** Purser's own platform account, where a Purser fee goes (in every binding; never a company's setting). */
  feeAccount: string;
  /** The version of Airwallex's terms the console shows before an owner agrees; kept with the consent record. */
  termsVersion: string;
}

export class PlatformRefused extends Error {
  constructor(readonly status: 401 | 404 | 409 | 502, message: string) { super(message); }
}

/** What the cloud keeps and shows: "opening" while Purser's request to Airwallex is under way. */
export type AccountStatus = PlatformStatus | "opening";
export interface AwxAccount { account_id: string | null; status: AccountStatus; business_name: string; country_code: string; created_at: string; updated_at: string }

/** How long a request to Airwallex may stay "opening" before a new one may replace it (it never answered). */
const OPENING_STALE_MS = 5 * 60_000;
/** How far Airwallex's x-timestamp may be from the cloud's clock (an old event is refused). */
const HOOK_TOLERANCE_MS = 5 * 60_000;

export async function accountOf(sql: Sql, tenantId: string): Promise<AwxAccount | null> {
  return sql.first<AwxAccount>("SELECT account_id, status, business_name, country_code, created_at, updated_at FROM awx_accounts WHERE tenant_id = ? AND id = 'main'", [tenantId]);
}

/**
 * Open the company's Airwallex account (POST /api/v1/accounts/create through the rail). One per company: a row is
 * written first, so two requests at once open one account; if Airwallex refuses, the row goes and the owner can try again.
 * Red team 6: every attempt of one opening sends the same idempotency id, so Airwallex opens one account however often
 * it is retried; a stale opening is first looked up at Airwallex under that id and adopted when it exists; a failed
 * attempt removes the row only while it is still its own (its nonce), and an answer with another account than the one
 * on file is never written over it. The owner's agreement to
 * Airwallex's terms is kept with the row: who, when and which version.
 */
export async function openAccount(sql: Sql, tenantId: string, p: AwxPlatformEnv, a: { business_name: string; country_code: string; email: string }, by: string, now: Date): Promise<AwxAccount> {
  const iso = now.toISOString();
  const existing = await sql.first<AwxAccount & { request_id: string | null; attempt: string | null }>("SELECT account_id, status, business_name, country_code, created_at, updated_at, request_id, attempt FROM awx_accounts WHERE tenant_id = ? AND id = 'main'", [tenantId]);
  if (existing && !(existing.status === "opening" && now.getTime() - Date.parse(existing.updated_at) > OPENING_STALE_MS)) {
    throw new PlatformRefused(409, existing.status === "opening" ? "Purser is opening the account right now; wait a minute" : "the company already has an Airwallex account through Purser");
  }
  const attempt = crypto.randomUUID();
  let requestId: string;
  if (existing) {
    // A stale opening: did Airwallex open it after all? Then it is the company's account; nothing is opened again.
    requestId = existing.request_id ?? crypto.randomUUID();
    let found: { accountId: string; status: string } | null;
    try {
      found = existing.request_id ? await p.rail.findConnectedAccount(existing.request_id) : null;
    } catch {
      throw new PlatformRefused(502, "Purser cannot tell yet whether Airwallex opened the account it asked for earlier; nothing is opened again until it can (try again in a few minutes)");
    }
    if (found && ACCOUNT_ID.test(found.accountId)) {
      await sql.run("UPDATE awx_accounts SET account_id = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = 'main' AND status = 'opening' AND updated_at = ?",
        [found.accountId, statusFromAccount(found.status) ?? "created", iso, tenantId, existing.updated_at]);
      logEvent("info", "awx_platform_adopted", { tenant: tenantId }, now);
      return (await accountOf(sql, tenantId))!;
    }
    // None yet: this attempt takes the row over (same idempotency id), the slow one can no longer finish it.
    const took = await sql.run("UPDATE awx_accounts SET attempt = ?, updated_at = ?, consent_by = ?, consent_at = ?, consent_terms = ? WHERE tenant_id = ? AND id = 'main' AND status = 'opening' AND updated_at = ?",
      [attempt, iso, by, iso, p.termsVersion, tenantId, existing.updated_at]);
    if (took.changes !== 1) throw new PlatformRefused(409, "Purser is opening the account right now; wait a minute");
  } else {
    requestId = crypto.randomUUID();
    try {
      await sql.run(`INSERT INTO awx_accounts (tenant_id, id, account_id, status, business_name, country_code, created_at, created_by, updated_at, event_at, request_id, attempt, consent_by, consent_at, consent_terms)
        VALUES (?, 'main', NULL, 'opening', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [tenantId, a.business_name, a.country_code, iso, by, iso, requestId, attempt, by, iso, p.termsVersion]);
    } catch (e) {
      if (/constraint failed/i.test(String((e as Error).message ?? e))) throw new PlatformRefused(409, "Purser is opening the account right now; wait a minute");
      throw e;
    }
  }
  let opened: { accountId: string; status: string };
  try {
    opened = await p.rail.createConnectedAccount({ businessName: a.business_name, countryCode: a.country_code, email: a.email, requestId });
    if (!ACCOUNT_ID.test(opened.accountId)) throw new Error("no account id");
  } catch (e) {
    await sql.run("DELETE FROM awx_accounts WHERE tenant_id = ? AND id = 'main' AND status = 'opening' AND attempt = ?", [tenantId, attempt]);
    // The reason goes to the log (it may name the company); the person gets a sentence.
    logEvent("warn", "awx_platform_open_failed", { tenant: tenantId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, now);
    throw new PlatformRefused(502, "Airwallex did not open the account; nothing is stored, and you can try again");
  }
  const status: AccountStatus = statusFromAccount(opened.status) ?? "created";
  // Any attempt of this opening (the same idempotency id, so the same account) may finish the row while it is opening.
  const done = await sql.run("UPDATE awx_accounts SET account_id = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = 'main' AND status = 'opening' AND request_id = ?", [opened.accountId, status, iso, tenantId, requestId]);
  const row = await accountOf(sql, tenantId);
  if (done.changes !== 1 && row?.account_id !== opened.accountId) {
    // Another attempt finished the row with another account: Airwallex did not honour the idempotency id. A person
    // closes the extra account; the company keeps the one on its row.
    logEvent("error", "awx_platform_extra_account", { tenant: tenantId }, now);
    throw new PlatformRefused(409, "Airwallex answered this request with another account than the one on file; Purser keeps the one on file and a person looks into the other");
  }
  logEvent("info", "awx_platform_opened", { tenant: tenantId, status }, now);
  return row!;
}

/** Airwallex's hosted onboarding link for the signed-in person (hosted_flows/create + authorize); never stored. */
export async function onboardingLink(sql: Sql, tenantId: string, p: AwxPlatformEnv, identity: string, returnUrl: string): Promise<string> {
  const a = await accountOf(sql, tenantId);
  if (!a || !a.account_id) throw new PlatformRefused(404, "the company has no Airwallex account through Purser yet");
  if (a.status === "active") throw new PlatformRefused(409, "the account is active; there is nothing left to verify");
  if (a.status === "refused" || a.status === "closed") throw new PlatformRefused(409, `the account is ${a.status}; ask Airwallex why`);
  try {
    return await p.rail.onboardingLink({ accountId: a.account_id, template: p.template, returnUrl, identity });
  } catch {
    throw new PlatformRefused(502, "Airwallex did not give an onboarding link; try again in a minute");
  }
}

/**
 * The account's status read from Airwallex now (GET /api/v1/accounts/{id}), for when a webhook is late or was missed
 * (docs/real-customers.md). Only the id and the status are read and kept; the account's details (which can hold the
 * company's people and identity data, `view_type`) are never stored. The poll counts as the newest word on the status:
 * an older webhook arriving after it changes nothing.
 */
export async function refreshAccount(sql: Sql, tenantId: string, p: AwxPlatformEnv, now: Date): Promise<AwxAccount> {
  const a = await accountOf(sql, tenantId);
  if (!a || !a.account_id) throw new PlatformRefused(404, "the company has no Airwallex account through Purser yet");
  let r: { accountId: string; status: string };
  try {
    r = await p.rail.getAccount(a.account_id);
  } catch {
    throw new PlatformRefused(502, "Airwallex did not answer about the account; try again in a minute");
  }
  if (r.accountId !== a.account_id) throw new PlatformRefused(502, "Airwallex answered about another account; nothing is changed");
  const status = statusFromAccount(r.status);
  if (!status) return a; // an unknown status is left as it was (Airwallex: "handle unknown values gracefully")
  await sql.run("UPDATE awx_accounts SET status = ?, updated_at = ?, event_at = ? WHERE tenant_id = ? AND id = 'main' AND account_id = ? AND event_at <= ?",
    [status, now.toISOString(), now.getTime(), tenantId, a.account_id, now.getTime()]);
  if (status !== a.status) logEvent("info", "awx_platform_status", { status, via: "poll" }, now);
  return (await accountOf(sql, tenantId))!;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * The one account an event is about: the account object's own id (data.object.id, the shape Airwallex documents for
 * account.* events; that the platform's events carry it there is UNCONFIRMED, see the doc). Red team 6: any of six
 * fields used to count, so one signed event naming two accounts changed the second. An envelope account_id that names
 * another account makes the event about none.
 */
function accountIdOf(e: Record<string, unknown>): string | null {
  const data = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
  const obj = (data.object && typeof data.object === "object" ? data.object : {}) as Record<string, unknown>;
  const id = typeof obj.id === "string" && ACCOUNT_ID.test(obj.id) ? obj.id : null;
  if (!id) return null;
  for (const other of [obj.account_id, data.id, data.account_id, e.account_id, e.accountId]) if (other !== undefined && other !== id) return null;
  return id;
}

/**
 * An Airwallex account.* webhook: x-signature must be HMAC-SHA256(secret, x-timestamp + raw body), the same scheme as
 * Purser's other Airwallex webhooks (that the platform's events use it too is unconfirmed; see the doc). Only an
 * account a company opened through Purser changes, and only to a newer event's status.
 */
export async function receiveAccountEvent(sql: Sql, p: AwxPlatformEnv, headers: Headers, text: string, now: Date): Promise<{ applied: boolean; status?: PlatformStatus }> {
  const ts = headers.get("x-timestamp") ?? "";
  const sig = (headers.get("x-signature") ?? "").toLowerCase();
  const at = Number(ts);
  if (!/^\d{10,16}$/.test(ts) || !(Math.abs(now.getTime() - at) <= HOOK_TOLERANCE_MS) || !/^[0-9a-f]{64}$/.test(sig) || !sameHex(sig, await hmacHex(p.webhookSecret, ts + text))) {
    throw new PlatformRefused(401, "bad or missing webhook signature");
  }
  let e: Record<string, unknown>;
  try { e = JSON.parse(text) as Record<string, unknown>; } catch { return { applied: false }; }
  const status = typeof e.name === "string" ? statusFromWebhook(e.name) : null;
  if (!status) return { applied: false };
  const id = accountIdOf(e);
  if (!id) return { applied: false };
  // A webhook never makes a refused (suspended) or closed account active again: x-timestamp orders deliveries, and a late
  // or re-signed retry of an old account.active must not switch payments back on. Reactivation is read by a poll
  // (refreshAccount), which asks Airwallex for the account as it is now.
  const r = await sql.run("UPDATE awx_accounts SET status = ?, updated_at = ?, event_at = ? WHERE account_id = ? AND event_at <= ? AND NOT (? = 'active' AND status IN ('refused', 'closed'))", [status, now.toISOString(), at, id, at, status]);
  if (r.changes > 0) { logEvent("info", "awx_platform_status", { status }, now); return { applied: true, status }; }
  return { applied: false };
}

const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Signs a binding: `<base64url JSON>.<base64url Ed25519 signature over the first part>` (src/airwallex/binding.ts checks it). */
export async function signBinding(pkcs8B64: string, b: AccountBinding): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", fromB64(pkcs8B64), { name: "Ed25519" }, false, ["sign"]);
  const body = b64u(new TextEncoder().encode(JSON.stringify(b)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(body)));
  return `${body}.${b64u(sig)}`;
}

/**
 * The company's binding to its own connected account, signed now for an hour (red team 6): the runner pays only from
 * the account in it, only while it is active, and any Purser fee only to Purser's account in it. None while the
 * account is still being opened, or for a company without one.
 */
export async function bindingOf(sql: Sql, tenantId: string, p: AwxPlatformEnv, now: Date): Promise<{ binding: string; expires_at: string } | null> {
  const a = await accountOf(sql, tenantId);
  if (!a || !a.account_id || a.status === "opening") return null;
  if (!ACCOUNT_ID.test(p.feeAccount)) throw new PlatformRefused(502, "Purser's platform account is not configured; no binding is signed");
  const b: AccountBinding = { v: BINDING_VERSION, tenant: tenantId, account_id: a.account_id, status: a.status, name: a.business_name.slice(0, 120), fee_account: p.feeAccount, issued_at: now.getTime(), expires_at: now.getTime() + BINDING_TTL_MS };
  return { binding: await signBinding(p.bindingKey, b), expires_at: new Date(b.expires_at).toISOString() };
}
