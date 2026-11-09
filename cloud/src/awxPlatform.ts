// Purser as an Airwallex platform, the cloud side (docs/airwallex-platform.md): an owner opens the company's Airwallex
// account through Purser (a connected account), gets Airwallex's hosted onboarding link for the company's checks, and
// the account's status follows Airwallex's account.* webhooks. The cloud keeps the account's id and status only: never
// a key, never the onboarding link (it is short-lived and made when asked for). Payments do not run here: the runner
// pays on behalf of the account, after the CFO's Face ID over terms that name it.
//
// Off unless the cloud is given a platform rail (CloudEnv.awxPlatform); no call has been made to Airwallex for this yet.

import { ACCOUNT_ID, statusFromAccount, statusFromWebhook, type PlatformRail, type PlatformStatus } from "../../src/airwallex/platform.js";
import { logEvent } from "./log.js";
import type { Sql } from "./store.js";

export interface AwxPlatformEnv {
  rail: PlatformRail;
  /** The hosted onboarding flow template id Airwallex provides for the platform. */
  template: string;
  /** The secret Airwallex signs the platform's webhooks with. */
  webhookSecret: string;
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
 */
export async function openAccount(sql: Sql, tenantId: string, p: AwxPlatformEnv, a: { business_name: string; country_code: string; email: string }, by: string, now: Date): Promise<AwxAccount> {
  const iso = now.toISOString();
  const existing = await accountOf(sql, tenantId);
  if (existing && !(existing.status === "opening" && now.getTime() - Date.parse(existing.updated_at) > OPENING_STALE_MS)) {
    throw new PlatformRefused(409, existing.status === "opening" ? "Purser is opening the account right now; wait a minute" : "the company already has an Airwallex account through Purser");
  }
  if (existing) await sql.run("DELETE FROM awx_accounts WHERE tenant_id = ? AND id = 'main' AND status = 'opening' AND updated_at = ?", [tenantId, existing.updated_at]);
  try {
    await sql.run("INSERT INTO awx_accounts (tenant_id, id, account_id, status, business_name, country_code, created_at, created_by, updated_at, event_at) VALUES (?, 'main', NULL, 'opening', ?, ?, ?, ?, ?, 0)",
      [tenantId, a.business_name, a.country_code, iso, by, iso]);
  } catch (e) {
    if (/constraint failed/i.test(String((e as Error).message ?? e))) throw new PlatformRefused(409, "Purser is opening the account right now; wait a minute");
    throw e;
  }
  let opened: { accountId: string; status: string };
  try {
    opened = await p.rail.createConnectedAccount({ businessName: a.business_name, countryCode: a.country_code, email: a.email });
    if (!ACCOUNT_ID.test(opened.accountId)) throw new Error("no account id");
  } catch (e) {
    await sql.run("DELETE FROM awx_accounts WHERE tenant_id = ? AND id = 'main' AND status = 'opening'", [tenantId]);
    // The reason goes to the log (it may name the company); the person gets a sentence.
    logEvent("warn", "awx_platform_open_failed", { tenant: tenantId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, now);
    throw new PlatformRefused(502, "Airwallex did not open the account; nothing is stored, and you can try again");
  }
  const status: AccountStatus = statusFromAccount(opened.status) ?? "created";
  await sql.run("UPDATE awx_accounts SET account_id = ?, status = ?, updated_at = ? WHERE tenant_id = ? AND id = 'main' AND status = 'opening'", [opened.accountId, status, iso, tenantId]);
  logEvent("info", "awx_platform_opened", { tenant: tenantId, status }, now);
  return (await accountOf(sql, tenantId))!;
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

/** The account ids an event may be about: the envelope's account_id and the object's id (Airwallex's shapes). */
function accountIdsOf(e: Record<string, unknown>): string[] {
  const data = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
  const obj = (data.object && typeof data.object === "object" ? data.object : {}) as Record<string, unknown>;
  return [obj.id, obj.account_id, data.id, data.account_id, e.account_id, e.accountId].filter((v): v is string => typeof v === "string" && ACCOUNT_ID.test(v));
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
  for (const id of accountIdsOf(e)) {
    const r = await sql.run("UPDATE awx_accounts SET status = ?, updated_at = ?, event_at = ? WHERE account_id = ? AND event_at <= ?", [status, now.toISOString(), at, id, at]);
    if (r.changes > 0) { logEvent("info", "awx_platform_status", { status }, now); return { applied: true, status }; }
  }
  return { applied: false };
}
