// Purser Cloud's HTTP API. One route table: it routes the requests, says what each route needs, and is the source of
// the OpenAPI document (/v1/openapi.json), so the two cannot disagree. Every tenant route works through the caller's
// TenantDb; a route never names a tenant itself.

import { z } from "zod";
import { AuthError, callerOf, endSessions, enrolPasskey, failedAuthBlocked, isPlatformAdmin, KEY_MAX_DAYS, keyIdOf, need, newApiKey, newChallenge, noteFailedAuth, passkeyLogin, ROLES, SCOPES, startEnrolment, withinRate, type Caller, type Role, type Scope, firstApiKey, descendantKeys, inviteInfo, STARTER_KEY_DAYS, RECOVERY_KEY_DAYS } from "./auth.js";
import { randomToken } from "./crypto.js";
import { allTransactions, BadRequest, insights, invoiceDocument, ledgerEntries, listInvoices, listPayments, listTransactions, listVendors, oneInvoice, oneTransaction, paged, report, transactionSummary } from "./read.js";
import { registerCsv } from "../../src/money/registerShape.js";
import { SCHEMA } from "./schema.js";
import type { Blobs, Sql } from "./store.js";
import { applySync, SyncBatch, SyncRefused, syncState } from "./sync.js";
import { WriteConflict } from "./tenant.js";
import { TenantDb } from "./tenant.js";
import { closeTenant, eraseUser, exportTenant, PrivacyRefused } from "./privacy.js";
import { download, ExportRefused, exportStatus, purgeEndedExportParts, signedLink, stageExport } from "./exports.js";
import { consoleResponse } from "./console.js";
import { qrSvg } from "./qr.js";
import { logEvent } from "./log.js";
import { integrations } from "./integrations.js";
import { platformCompanies } from "./platformView.js";
import { accountOf, bindingOf, onboardingLink, openAccount, PlatformRefused, receiveAccountEvent, type AwxPlatformEnv } from "./awxPlatform.js";
import { cloudHealth, companyStatus, HealthReport, MonitorRefused, notify, receiveReport, removeWebhook, setWebhook, webhookOf, type Outbound } from "./monitor.js";
import type { EngineApi } from "./engine/api.js";
import { engineRoutes } from "./engine/routes.js";
import { signedTrySession, tryGate } from "./try/gate.js";
import { tryEngineRoutes } from "./try/engineRoutes.js";
import { tryExtraEngineRoutes } from "./try/extraEngineRoutes.js";
import { tryError, tryRoutes } from "./try/routes.js";
import { isTryTenant, noteTryFail, TryRefused, type TryConfig } from "./try/start.js";
import { SwitchRefused } from "./try/switches.js";
import { noteRequest } from "./try/metrics.js";

export interface CloudEnv {
  sql: Sql;
  blobs: Blobs;
  /** HMAC key for session tokens (a Worker secret). */
  sessionSecret: string;
  /** SHA-256 (hex) of the platform admin token (a Worker secret); empty: no tenant can be created. */
  adminTokenSha256: string;
  /** The passkey relying party: the cloud's own host and origin. */
  rpId: string;
  origin: string;
  now?: () => Date;
  /** The domain the company's inbox lives at (<slug>@<mailDomain>), once Email Routing sends it here; empty: none yet. */
  mailDomain?: string;
  /**
   * The bundle's static files (Workers static assets, cloud/public): today only pdf.js, which draws an invoice in the
   * console. Absent (no assets bound): the console offers the download only.
   */
  asset?: (path: string) => Promise<Response | null>;
  /** The deployed version (a Worker var), shown by /v1/health; "dev" when unset. */
  version?: string;
  /** How alert webhooks are sent (the Worker's fetch); absent: none are sent. Tests pass a fake. */
  outbound?: Outbound;
  /** The pause before a webhook's second and third attempt, times the attempt (default 500 ms). */
  retryDelayMs?: number;
  /** Requests per minute per key or session; per address on the sign-in routes; failed authentications per address. */
  rate?: { perMinute: number; signInPerMinute: number; failedAuthPerMinute?: number };
  /** A staged export's rows per part (default 2000) and its size limit in bytes (default 512 MB). */
  exportPartRows?: number;
  exportMaxBytes?: number;
  /**
   * Purser as an Airwallex platform (cloud/src/awxPlatform.ts, docs/airwallex-platform.md): the platform rail, the
   * hosted onboarding template and the webhook secret. Absent (the default): the /v1/airwallex routes answer 404.
   */
  awxPlatform?: AwxPlatformEnv;
  /**
   * A company's engine (cloud/src/engine/api.ts): in the Worker a stub of the company's Durable Object, in tests and
   * local runs an engine in this process. Test money only. Absent (the default): the /v1/engine routes answer 404.
   */
  engine?: (tenantId: string) => EngineApi;
  /**
   * The hands-on deployment (purser-try, HANDS_ON=on; cloud/src/try/): a visitor's test company of their own, for a day,
   * on the engine. Absent (the default): the /v1/try routes answer 404. Needs `engine`.
   */
  tryIt?: TryConfig;
}

interface Ctx { env: CloudEnv; req: Request; url: URL; now: Date; params: string[]; caller: Caller | null; db: TenantDb | null }
type Need = "public" | "platform" | Scope;
interface Route { method: "GET" | "POST" | "DELETE"; path: string; summary: string; need: Need; run: (c: Ctx) => Promise<Response> }

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
/** Every error has one shape: a sentence for a person and a stable code for a program. */
const CODES: Record<number, string> = { 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 409: "conflict", 413: "too_large", 422: "unprocessable", 429: "rate_limited", 500: "internal", 502: "upstream" };
export const err = (status: number, error: string) => json(status, { error, code: CODES[status] ?? "error" });
const notFound = (what: string) => err(404, `no ${what}`);

/**
 * The request's body as text, read with a running byte count and stopped past `maxBytes` (red team round 4: without a
 * content-length the whole body was read before its size was checked; 200 MB on a public route).
 */
async function readCapped(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) { await reader.cancel().catch(() => {}); throw new BadRequest(`the body is larger than ${maxBytes} bytes`); }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}

async function body<T>(c: Ctx, schema: z.ZodType<T>, maxBytes = 1_000_000): Promise<T> {
  const len = Number(c.req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new BadRequest(`the body is larger than ${maxBytes} bytes`);
  const text = await readCapped(c.req, maxBytes);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new BadRequest("the body is not JSON"); }
  const r = schema.safeParse(parsed);
  if (!r.success) throw new BadRequest(`the body does not fit: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`);
  return r.data;
}

const db = (c: Ctx) => c.db!;
/** A key's row without the hash of its secret: secrets never leave, not even hashed. */
export function withoutSecret(r: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...r };
  delete copy.secret_sha256;
  return copy;
}
/** The platform's configuration, or 404: the cloud does not offer Airwallex accounts through Purser. */
function platformOf(c: Ctx): AwxPlatformEnv {
  if (!c.env.awxPlatform) throw new PlatformRefused(404, "opening an Airwallex account through Purser is not switched on");
  return c.env.awxPlatform;
}
/** A signed-in owner only: not a key, not another role. */
function ownerOnly(c: Ctx): void {
  if (c.caller!.kind !== "session" || c.caller!.role !== "owner") throw new AuthError(403, "only a signed-in owner opens or verifies the company's Airwallex account");
}

const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "a slug is lowercase letters, digits and dashes");
/**
 * Addresses no company may have (red team round 5): a company's address is also its inbox (slug@domain), and these are
 * the mailboxes certificate authorities and mail systems write to (RFC 2142, CA/Browser Forum domain validation).
 */
export const RESERVED_SLUGS = new Set(["postmaster", "hostmaster", "webmaster", "admin", "administrator", "abuse", "root", "noreply", "no-reply",
  "mailer-daemon", "security", "ssl-admin", "info", "support", "www", "mail", "dmarc", "dmarc-reports", "bounce", "bounces", "purser", "api", "console"]);
const NEW_SLUG = SLUG.refine((v) => !RESERVED_SLUGS.has(v), "this address is reserved");

export const ROUTES: Route[] = [
  { method: "GET", path: "/v1/health", summary: "For an uptime monitor: whether the database and the document store answer, the version, the mail waiting in all (no company's data); 503 when something is down.", need: "public", run: async (c) => {
    const h = await cloudHealth(c.env.sql, c.env.blobs, c.env.version ?? "dev");
    return json(h.status, h.body);
  } },
  { method: "GET", path: "/v1/status", summary: "Where the company stands, for its owners: the last push from the runner, the mail queue, today's mail quota, the runner's alert codes and the webhook (never its secret).", need: "admin", run: async (c) => json(200, await companyStatus(c.env.sql, c.caller!.tenantId, c.now)) },
  { method: "POST", path: "/v1/health/report", summary: "The runner reports its health: alert codes and severities (their words are dropped). Alerts raised or cleared since the last report go to the company's webhook.", need: "sync", run: async (c) => {
    const r = await body(c, HealthReport, 64_000);
    return json(200, await receiveReport(c.env.sql, c.caller!.tenantId, r, c.now, c.env.outbound, c.env.retryDelayMs));
  } },
  { method: "GET", path: "/v1/integrations", summary: "Where the company's accounting links stand (Moneybird): not_connected, connected or attention, the last sync, what was sent, what failed and what waits for a person; from the runner's ERP sync results in the audit log, never a credential.", need: "admin", run: async (c) => json(200, await integrations(c.env.sql, c.caller!.tenantId)) },
  { method: "GET", path: "/v1/webhook", summary: "The company's alert webhook (its URL and delivery state; never its secret).", need: "admin", run: async (c) => json(200, (await webhookOf(c.env.sql, c.caller!.tenantId)) ?? { url: null }) },
  { method: "POST", path: "/v1/webhook", summary: "Set the alert webhook (https, a public host name); returns the signing secret once. Events are signed: x-purser-signature t=<seconds>,v1=<HMAC-SHA256 hex of t.body>.", need: "admin", run: async (c) => {
    const b = await body(c, z.object({ url: z.string().min(8).max(500) }).strict());
    return json(200, { ...(await setWebhook(c.env.sql, c.caller!.tenantId, b.url, c.caller!.principal, c.now)), note: "the secret is shown once" });
  } },
  { method: "DELETE", path: "/v1/webhook", summary: "Remove the alert webhook.", need: "admin", run: async (c) => json(200, { removed: await removeWebhook(c.env.sql, c.caller!.tenantId) }) },
  { method: "GET", path: "/v1/airwallex/account", summary: "The company's Airwallex account opened through Purser as a platform: its id and onboarding status (created, pending, action_required, active, refused, dormant, closed); whether the cloud offers it at all.", need: "admin", run: async (c) =>
    json(200, { switched_on: Boolean(c.env.awxPlatform), account: c.env.awxPlatform ? await accountOf(c.env.sql, c.caller!.tenantId) : null }) },
  { method: "POST", path: "/v1/airwallex/account", summary: "Open the company's Airwallex account through Purser (a signed-in owner, who agreed to Airwallex's terms first). One per company.", need: "admin", run: async (c) => {
    const p = platformOf(c);
    ownerOnly(c);
    const b = await body(c, z.object({ business_name: z.string().trim().min(1).max(200), country_code: z.string().regex(/^[A-Z]{2}$/, "a two-letter country code (NL, DE, ...)"),
      email: z.string().trim().email().max(200), agreed: z.literal(true, { message: "agree to Airwallex's terms first" }) }).strict(), 8_000);
    return json(201, { account: await openAccount(c.env.sql, c.caller!.tenantId, p, b, c.caller!.principal, c.now) });
  } },
  { method: "GET", path: "/v1/airwallex/binding", summary: "The company's binding to its own Airwallex account, signed by Purser's platform key for an hour: the runner pays only from the account in it, only while it is active. 404 while there is none.", need: "sync", run: async (c) => {
    const b = await bindingOf(c.env.sql, c.caller!.tenantId, platformOf(c), c.now);
    return b ? json(200, b) : notFound("Airwallex account through Purser for this company yet");
  } },
  { method: "POST", path: "/v1/airwallex/onboarding-link", summary: "Airwallex's hosted onboarding link for the company's checks, made for the signed-in owner and short-lived; never stored.", need: "admin", run: async (c) => {
    const p = platformOf(c);
    ownerOnly(c);
    return json(200, { url: await onboardingLink(c.env.sql, c.caller!.tenantId, p, c.caller!.principal, `${c.env.origin}/#/settings`) });
  } },
  { method: "POST", path: "/v1/airwallex/webhook", summary: "Airwallex's account.* webhooks (signed: x-timestamp, x-signature): the onboarding status of an account opened through Purser.", need: "public", run: async (c) => {
    const p = platformOf(c);
    const ip = c.req.headers.get("cf-connecting-ip") ?? "unknown";
    if (await failedAuthBlocked(c.env.sql, ip, c.now, c.env.rate?.failedAuthPerMinute ?? 20)) return err(429, "too many failed signatures from this address; wait a minute");
    const text = await readCapped(c.req, 64_000);
    try {
      return json(200, await receiveAccountEvent(c.env.sql, p, c.req.headers, text, c.now));
    } catch (e) {
      if (e instanceof PlatformRefused && e.status === 401) await noteFailedAuth(c.env.sql, ip, null, c.now);
      throw e;
    }
  } },
  { method: "GET", path: "/v1/openapi.json", summary: "This API, as OpenAPI 3.1.", need: "public", run: async (c) => json(200, openApi(c.env.origin)) },

  { method: "GET", path: "/v1/admin/companies", summary: "The companies on this cloud for the platform operator: each one's Airwallex account and status, the supplier payouts that moved and those waiting, and Purser's fees taken, from what the runners pushed (never a key or an account number).", need: "platform", run: async (c) => json(200, await platformCompanies(c.env.sql)) },
  { method: "POST", path: "/v1/admin/tenants", summary: "Create a company and its first owner; returns the owner's API key once.", need: "platform", run: async (c) => {
    const b = await body(c, z.object({ slug: NEW_SLUG, name: z.string().min(1).max(200), owner: z.object({ display_name: z.string().min(1).max(120), email: z.string().email().max(200).optional() }).strict() }).strict());
    if (await c.env.sql.first("SELECT 1 FROM tenants WHERE slug = ?", [b.slug])) return err(409, `the address ${b.slug} is taken`);
    const id = `t_${randomToken(12).replace(/[^A-Za-z0-9]/g, "x")}`;
    const iso = c.now.toISOString();
    // Two requests for one address can both pass the check above; the unique slug lets one in, the other gets a 409.
    try {
      await c.env.sql.run("INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)", [id, b.slug, b.name, iso]);
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(String((e as Error).message ?? e))) return err(409, `the address ${b.slug} is taken`);
      throw e;
    }
    const t = new TenantDb(c.env.sql, id);
    const ownerId = `u_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
    await t.apply([t.insert("users", { id: ownerId, display_name: b.owner.display_name, email: b.owner.email ?? null, role: "owner", created_at: iso })]);
    // The starter key (red team round 5): good only to make the first owner's passkey, for a week; that passkey revokes it.
    const key = await firstApiKey(t, { name: "starter (first owner's passkey only)", scopes: ["read", "admin"], createdBy: ownerId, createdByUser: ownerId, expiresInDays: STARTER_KEY_DAYS, purpose: "first-owner", now: c.now });
    return json(201, { tenant: { id, slug: b.slug, name: b.name }, owner: { id: ownerId }, api_key: key.key, expires_at: key.expires_at, note: "the starter key is shown once and makes the first owner's passkey only; it stops working once that passkey exists" });
  } },

  { method: "POST", path: "/v1/admin/tenants/{id}/recovery", summary: "An owner lost their passkey: after checking out of band who asks (checked_by says how), issue a one-time recovery key for that owner, good for one day and one passkey enrolment of that owner; redeemed, the owner's old passkeys and sessions end. One open recovery per company; the company's webhook and security events record it.", need: "platform", run: async (c) => {
    const b = await body(c, z.object({ owner_id: z.string().min(1).max(80), checked_by: z.string().min(3).max(200) }).strict());
    const tenantId = c.params[0]!;
    if (!/^t_[A-Za-z0-9_-]{6,64}$/.test(tenantId)) return notFound("company");
    const tenant = await c.env.sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [tenantId]);
    if (!tenant || tenant.closed_at) return notFound("company");
    const t = new TenantDb(c.env.sql, tenantId);
    const owner = await t.one<{ role: Role; erased_at: string | null }>("users", { id: b.owner_id });
    if (!owner || owner.erased_at || owner.role !== "owner") return err(409, "a recovery is for an existing owner of this company");
    const iso = c.now.toISOString();
    const eventId = `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
    let key: { id: string; key: string; expires_at: string };
    try {
      // Checked when it commits: no other recovery key of the company is open (two at once could not be told apart).
      key = await firstApiKey(t, { name: "owner recovery (one passkey enrolment)", scopes: ["read", "admin"], createdBy: "platform", createdByUser: b.owner_id,
        expiresInDays: RECOVERY_KEY_DAYS, purpose: "recovery", before: [t.noOpenRecoveryGuard(iso)], now: c.now });
    } catch (e) {
      if (e instanceof WriteConflict) return err(409, "a recovery is already open for this company; let it expire or revoke it first");
      throw e;
    }
    await t.apply([t.insert("security_events", { id: eventId, at: iso, kind: "recovery.issued", actor: "platform", detail_json: JSON.stringify({ owner: b.owner_id, recovery_key: key.id, checked_by: b.checked_by, expires_at: key.expires_at }) })]);
    await notify(c.env.sql, tenantId, "security.recovery_issued", { owner: b.owner_id, recovery_key: key.id, expires_at: key.expires_at }, c.now, c.env.outbound, c.env.retryDelayMs);
    return json(201, { recovery_key: key.key, key_id: key.id, owner_id: b.owner_id, expires_at: key.expires_at, note: "shown once; good for one day and one passkey enrolment of this owner; give it to the owner over the channel you checked" });
  } },

  { method: "POST", path: "/v1/auth/challenge", summary: "Start a passkey sign-in: a one-time challenge for the company.", need: "public", run: async (c) => {
    const b = await body(c, z.object({ tenant: SLUG }).strict());
    const t = await c.env.sql.first<{ id: string; closed_at: string | null }>("SELECT id, closed_at FROM tenants WHERE slug = ?", [b.tenant]);
    if (!t || t.closed_at) return notFound("company");
    return json(200, await newChallenge(c.env.sql, t.id, c.now));
  } },
  { method: "POST", path: "/v1/auth/login", summary: "Finish a passkey sign-in; returns a 15-minute session token.", need: "public", run: async (c) => {
    const b = await body(c, z.object({ tenant: SLUG, challenge_id: z.string().max(80), credential_id: z.string().max(400),
      assertion: z.object({ authenticatorData: z.string().max(4000), clientDataJSON: z.string().max(8000), signature: z.string().max(400) }).strict() }).strict());
    const t = await c.env.sql.first<{ id: string; closed_at: string | null }>("SELECT id, closed_at FROM tenants WHERE slug = ?", [b.tenant]);
    if (!t || t.closed_at) return notFound("company");
    const s = await passkeyLogin(c.env.sql, { tenantId: t.id, challengeId: b.challenge_id, credentialId: b.credential_id, assertion: b.assertion, rpId: c.env.rpId, origin: c.env.origin, secret: c.env.sessionSecret, now: c.now });
    return json(200, { session: s.token, role: s.role, user_id: s.user_id, expires_in: 900 });
  } },
  { method: "POST", path: "/v1/auth/enrol", summary: "Enrol a person's passkey with the single-use enrolment an owner started: the new passkey signs the enrolment's secret.", need: "public", run: async (c) => {
    const b = await body(c, z.object({ tenant: SLUG, enrolment_id: z.string().max(80), token: z.string().min(40).max(80), credential_id: z.string().min(8).max(400),
      x: z.string().min(40).max(50), y: z.string().min(40).max(50),
      assertion: z.object({ authenticatorData: z.string().max(4000), clientDataJSON: z.string().max(8000), signature: z.string().max(400) }).strict() }).strict());
    const t = await c.env.sql.first<{ id: string; closed_at: string | null }>("SELECT id, closed_at FROM tenants WHERE slug = ?", [b.tenant]);
    if (!t || t.closed_at) return notFound("company");
    const r = await enrolPasskey(c.env.sql, { tenantId: t.id, enrolmentId: b.enrolment_id, token: b.token, credentialId: b.credential_id, x: b.x, y: b.y, assertion: b.assertion, rpId: c.env.rpId, origin: c.env.origin, now: c.now });
    if (r.recovery) await notify(c.env.sql, t.id, "security.recovery_completed", { owner: r.user_id }, c.now, c.env.outbound, c.env.retryDelayMs);
    return json(201, r);
  } },
  { method: "POST", path: "/v1/auth/invite", summary: "What an invite is for, from its secret: the company's address and name and the person; nothing is used up.", need: "public", run: async (c) => {
    const b = await body(c, z.object({ enrolment_id: z.string().max(80), token: z.string().min(40).max(80) }).strict());
    return json(200, await inviteInfo(c.env.sql, { enrolmentId: b.enrolment_id, token: b.token, now: c.now }));
  } },
  { method: "POST", path: "/v1/auth/logout", summary: "Sign out: every session of the signed-in person ends.", need: "read", run: async (c) => {
    if (c.caller!.kind !== "session") return err(400, "only a signed-in person signs out; revoke a key with DELETE /v1/keys/{id}");
    await endSessions(c.env.sql, c.caller!.tenantId, c.caller!.principal);
    return json(200, { signed_out: true });
  } },

  { method: "GET", path: "/v1/me", summary: "Who is calling: the company, and the key's scopes or the person's role.", need: "read", run: async (c) => {
    const t = await c.env.sql.first<{ slug: string; name: string; language: string }>("SELECT slug, name, language FROM tenants WHERE id = ?", [c.caller!.tenantId]);
    // For the console: the person behind the call, whether an owner has a passkey yet (a new company's first run), and
    // the company's inbox address once mail is routed here.
    const owners = (await db(c).select<{ id: string }>("users", { role: "owner", erased_at: null })).map((u) => u.id);
    const ownerPasskey = owners.length > 0 && (await db(c).count("credentials", { user_id: { in: owners } })) > 0;
    const person = c.caller!.user ? await db(c).one<{ display_name: string; role: Role; language: string | null }>("users", { id: c.caller!.user }) : null;
    // The pages' language: the person's own choice, else the company's (codes and the API stay English).
    const companyLanguage = t?.language === "en" ? "en" : "nl";
    // The company's Airwallex account opened through Purser, for the pages' header (its id is no secret; never a key).
    const awx = await c.env.sql.first<{ account_id: string | null; status: string }>("SELECT account_id, status FROM awx_accounts WHERE tenant_id = ? AND id = 'main'", [c.caller!.tenantId]);
    return json(200, { tenant: { id: c.caller!.tenantId, ...t, language: companyLanguage }, kind: c.caller!.kind, principal: c.caller!.principal, scopes: [...c.caller!.scopes], role: c.caller!.role ?? null,
      user: c.caller!.user ? { id: c.caller!.user, display_name: person?.display_name ?? null, role: person?.role ?? null, language: person?.language ?? null } : null,
      language: person?.language === "en" || person?.language === "nl" ? person.language : companyLanguage,
      owner_has_passkey: ownerPasskey, airwallex: awx ? { account_id: awx.account_id, status: awx.status } : null, inbox: c.env.mailDomain && t ? `${t.slug}@${c.env.mailDomain}` : null });
  } },
  { method: "POST", path: "/v1/company", summary: "Change the company's display name (its address, the slug, stays) or the pages' language for everyone (nl or en).", need: "admin", run: async (c) => {
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(200).optional(), language: z.enum(["nl", "en"]).optional() }).strict().refine((x) => x.name !== undefined || x.language !== undefined, "send a name or a language"));
    if (b.name !== undefined) await c.env.sql.run("UPDATE tenants SET name = ? WHERE id = ?", [b.name, c.caller!.tenantId]);
    if (b.language !== undefined) await c.env.sql.run("UPDATE tenants SET language = ? WHERE id = ?", [b.language, c.caller!.tenantId]);
    const t = await c.env.sql.first<{ name: string; language: string }>("SELECT name, language FROM tenants WHERE id = ?", [c.caller!.tenantId]);
    return json(200, { name: t?.name ?? null, language: t?.language ?? "nl" });
  } },
  { method: "POST", path: "/v1/me/language", summary: "The signed-in person's own language for the pages (nl or en), or null to follow the company's.", need: "read", run: async (c) => {
    if (c.caller!.kind !== "session" || !c.caller!.user) return err(400, "only a signed-in person has a language of their own");
    const b = await body(c, z.object({ language: z.enum(["nl", "en"]).nullable() }).strict());
    await c.env.sql.run("UPDATE users SET language = ? WHERE tenant_id = ? AND id = ?", [b.language, c.caller!.tenantId, c.caller!.user]);
    return json(200, { language: b.language });
  } },

  { method: "GET", path: "/v1/invoices", summary: "Supplier invoices; filter by status, due_from, due_to; paginated (limit, cursor).", need: "read", run: async (c) => json(200, await listInvoices(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/invoices/{id}", summary: "One invoice, with its earlier versions.", need: "read", run: async (c) => { const r = await oneInvoice(db(c), c.params[0]!); return r ? json(200, r) : notFound("invoice"); } },
  { method: "GET", path: "/v1/invoices/{id}/document", summary: "The invoice's document, as received.", need: "read", run: async (c) => {
    const d = await invoiceDocument(db(c), c.params[0]!);
    const bytes = d && (await c.env.blobs.get(d.blob_key));
    if (!d || !bytes) return notFound("invoice");
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": d.mime === "application/pdf" ? "application/pdf" : "application/octet-stream", "content-disposition": `attachment; filename="${d.filename.replace(/[^\w.-]+/g, "_")}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } },
  { method: "GET", path: "/v1/vendors", summary: "Suppliers; paginated.", need: "read", run: async (c) => json(200, await listVendors(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/payments", summary: "Payments; paginated.", need: "read", run: async (c) => json(200, await listPayments(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/transactions", summary: "The transactions register: every money movement on every rail, newest first; filter by rail, currency, from, to, reconciliation, moved; paginated (limit, cursor).", need: "read", run: async (c) => json(200, await listTransactions(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/transactions/summary", summary: "Totals per currency (money that moved only) and the checks: unreconciled, without approval, without booking or proof; the same filters.", need: "read", run: async (c) => json(200, await transactionSummary(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/transactions/export.csv", summary: "The register as CSV, the same filters; one line per movement.", need: "read", run: async (c) => new Response(registerCsv(await allTransactions(db(c), c.url.searchParams)), { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="transactions.csv"', "cache-control": "no-store", "x-content-type-options": "nosniff" } }) },
  { method: "GET", path: "/v1/transactions/{id}", summary: "One movement, with its earlier versions.", need: "read", run: async (c) => { const r = await oneTransaction(db(c), c.params[0]!); return r ? json(200, r) : notFound("transaction"); } },
  { method: "GET", path: "/v1/ledger/entries", summary: "Ledger entries with their lines; filter by from, to; paginated.", need: "read", run: async (c) => json(200, await ledgerEntries(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/reports/{name}", summary: "trial, pnl, balance, vat (?quarter=2026Q4), payables, receivables: computed from the ledger.", need: "read", run: async (c) => json(200, await report(db(c), c.params[0]!, c.url.searchParams)) },
  { method: "GET", path: "/v1/insights", summary: "Payables at a glance: open, due, overdue, waiting, blocked, spend per supplier.", need: "read", run: async (c) => json(200, await insights(db(c), c.now)) },

  { method: "GET", path: "/v1/documents/{sha256}", summary: "A document the company holds, by its SHA-256 (the export lists them).", need: "read", run: async (c) => {
    const d = await db(c).one<{ blob_key: string; filename: string; mime: string }>("documents", { sha256: c.params[0]! });
    const bytes = d && (await c.env.blobs.get(d.blob_key));
    if (!d || !bytes) return notFound("document");
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": d.mime === "application/pdf" ? "application/pdf" : "application/octet-stream", "content-disposition": `attachment; filename="${d.filename.replace(/[^\w.-]+/g, "_")}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } },

  { method: "POST", path: "/v1/sync", summary: "The runner's push: vendors, invoices, documents, payments, the transactions register, ledger entries, audit rows. Idempotent. Never passkeys.", need: "sync", run: async (c) => {
    const b = await body(c, SyncBatch, 50_000_000);
    return json(200, { applied: await applySync(db(c), c.env.blobs, b, c.now, { kind: c.caller!.kind, principal: c.caller!.principal }) });
  } },
  { method: "GET", path: "/v1/sync/state", summary: "Where the cloud's copy stands: the heads of the audit and ledger chains, and the documents it holds.", need: "sync", run: async (c) => json(200, await syncState(db(c))) },
  { method: "GET", path: "/v1/mail", summary: "Inbound e-mail waiting for the runner; paginated (limit, cursor).", need: "sync", run: async (c) => json(200, await paged<Record<string, unknown>>(db(c), "inbound_mail", "id", { status: "queued" }, c.url.searchParams, (r) => r)) },
  { method: "GET", path: "/v1/mail/{id}/raw", summary: "One inbound e-mail, raw (RFC 822).", need: "sync", run: async (c) => {
    const m = await db(c).one<{ blob_key: string }>("inbound_mail", { id: c.params[0]! });
    const bytes = m && (await c.env.blobs.get(m.blob_key));
    return m && bytes ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "message/rfc822", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename="${c.params[0]!.replace(/[^A-Za-z0-9_-]/g, "")}.eml"` } }) : notFound("mail");
  } },
  { method: "POST", path: "/v1/mail/{id}/done", summary: "The runner filed (done) or refused an inbound e-mail.", need: "sync", run: async (c) => {
    const b = await body(c, z.object({ status: z.enum(["done", "refused"]), note: z.string().max(500).optional() }).strict());
    const t = db(c);
    const m = await t.one<{ status: string }>("inbound_mail", { id: c.params[0]! });
    if (!m) return notFound("mail");
    // Only a queued message is marked, and only once (two runs filing it at once): the update takes it from queued,
    // so of two at once one changes it. The same answer again is fine; a different one is a conflict.
    const changed = await t.change(t.update("inbound_mail", { id: c.params[0]!, status: "queued" }, { status: b.status, note: b.note ?? null }));
    if (!changed) {
      const now = await t.one<{ status: string }>("inbound_mail", { id: c.params[0]! });
      if (now?.status !== b.status) return err(409, `this e-mail is already ${now?.status ?? "gone"}`);
    }
    return json(200, { id: c.params[0], status: b.status });
  } },

  { method: "GET", path: "/v1/security/events", summary: "What happened to the company's access: owner recoveries, staged exports and their downloads (newest last).", need: "admin", run: async (c) => {
    const rows = await db(c).select<{ id: string; at: string; kind: string; actor: string; detail_json: string }>("security_events", {}, { order: ["at", "id"] });
    return json(200, { items: rows.map((r) => ({ id: r.id, at: r.at, kind: r.kind, actor: r.actor, detail: JSON.parse(r.detail_json) as unknown })) });
  } },
  { method: "GET", path: "/v1/keys", summary: "The company's API keys (never their secrets); paginated (limit, cursor).", need: "admin", run: async (c) => json(200, await paged<Record<string, unknown>>(db(c), "api_keys", "id", {}, c.url.searchParams, withoutSecret)) },
  { method: "POST", path: "/v1/keys", summary: "A new API key; returned once.", need: "admin", run: async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(SCOPES as [Scope, ...Scope[]])).min(1), expires_in_days: z.number().int().min(1).max(KEY_MAX_DAYS).optional() }).strict());
    // The person behind the new key is the person behind the caller (a key made by a key inherits it), so erasing that
    // person revokes the whole chain.
    const k = await newApiKey(db(c), { name: b.name, scopes: b.scopes, caller: c.caller!, ...(b.expires_in_days ? { expiresInDays: b.expires_in_days } : {}), now: c.now });
    return json(201, { id: k.id, api_key: k.key, expires_at: k.expires_at, note: "shown once" });
  } },
  { method: "DELETE", path: "/v1/keys/{id}", summary: "Revoke an API key.", need: "admin", run: async (c) => {
    const t = db(c);
    const k = await t.one<{ revoked_at: string | null }>("api_keys", { id: c.params[0]! });
    if (!k) return notFound("key");
    // The keys it made go with it (red team round 4: they kept working after their maker's revoke).
    const children = await descendantKeys(t, c.params[0]!);
    const iso = c.now.toISOString();
    // So do the invites they started (red team round 5: an invite outlived the key that made it).
    await t.apply([...(k.revoked_at ? [] : [t.update("api_keys", { id: c.params[0]! }, { revoked_at: iso })]),
      ...(children.length ? [t.update("api_keys", { id: { in: children }, revoked_at: null }, { revoked_at: iso })] : []),
      t.update("enrolments", { created_by: { in: [c.params[0]!, ...children] }, used_at: null, cancelled_at: null }, { cancelled_at: iso })]);
    return json(200, { id: c.params[0], revoked: true, also_revoked: children });
  } },
  { method: "GET", path: "/v1/users", summary: "The company's people and their roles; paginated (limit, cursor).", need: "admin", run: async (c) => json(200, await paged<Record<string, unknown>>(db(c), "users", "id", {}, c.url.searchParams, (r) => r)) },
  { method: "POST", path: "/v1/users/{id}/enrolment", summary: "Start a person's passkey enrolment: a single-use secret for 30 minutes (an owner's passkey: a signed-in owner only, once any owner has one). Also returns the invite link (the secret after the #, so opening it sends the secret to no server) and its QR code as SVG.", need: "admin", run: async (c) => {
    const e = await startEnrolment(db(c), c.caller!, c.params[0]!, c.now);
    // The link names no company or person (red team round 5): the page asks the server what the secret is for.
    const link = `${c.env.origin}/#/enrol?${new URLSearchParams({ e: e.enrolment_id, k: e.token }).toString()}`;
    return json(201, { ...e, link, qr_svg: qrSvg(link) });
  } },
  { method: "GET", path: "/v1/users/{id}/passkeys", summary: "A person's passkeys (their ids and when each was enrolled).", need: "admin", run: async (c) => {
    if (!(await db(c).one("users", { id: c.params[0]! }))) return notFound("person");
    const items = await db(c).select<{ credential_id: string; created_at: string }>("credentials", { user_id: c.params[0]! }, { order: ["created_at"] });
    return json(200, { items: items.map((r) => ({ credential_id: r.credential_id, created_at: r.created_at })) });
  } },
  { method: "DELETE", path: "/v1/users/{id}/passkeys/{credential}", summary: "Remove a passkey (a signed-in owner only): it signs in no more, and the person's sessions end. Never the last owner passkey.", need: "admin", run: async (c) => {
    if (!(c.caller!.kind === "session" && c.caller!.role === "owner")) return err(403, "only a signed-in owner removes a passkey");
    const t = db(c);
    const cred = await t.one<{ user_id: string }>("credentials", { credential_id: c.params[1]!, user_id: c.params[0]! });
    if (!cred) return notFound("passkey");
    const person = await t.one<{ role: Role; session_gen: number }>("users", { id: c.params[0]! });
    const iso = c.now.toISOString();
    try {
      // Removed, the person's sessions ended (one made with that passkey ends with it), and checked at commit that some
      // owner still has a passkey: the company is never left without one.
      await t.apply([t.callerGuard(c.caller!, iso), t.delete("credentials", { credential_id: c.params[1]!, user_id: c.params[0]! }),
        t.update("users", { id: c.params[0]! }, { session_gen: (person?.session_gen ?? 0) + 1 }),
        ...(person?.role === "owner" ? [t.ownerPasskeyRemainsGuard(iso)] : [])]);
    } catch (e) {
      if (e instanceof WriteConflict) return err(409, "this is the last owner passkey of the company: enrol another owner passkey first");
      throw e;
    }
    return json(200, { removed: c.params[1], sessions_ended: c.params[0] });
  } },
  { method: "POST", path: "/v1/users", summary: "Add a person (owner, cfo, accountant, viewer); they then enrol a passkey with an enrolment an owner starts.", need: "admin", run: async (c) => {
    const b = await body(c, z.object({ display_name: z.string().min(1).max(120), email: z.string().email().max(200).optional(), role: z.enum(ROLES as [Role, ...Role[]]) }).strict());
    const id = `u_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
    const t = db(c);
    await t.apply([t.insert("users", { id, display_name: b.display_name, email: b.email ?? null, role: b.role, created_at: c.now.toISOString() })]);
    return json(201, { id, role: b.role });
  } },
  { method: "POST", path: "/v1/users/{id}/erase", summary: "Erase a person's personal data (bookkeeping records are kept for 7 years).", need: "admin", run: async (c) => {
    const id = c.params[0]!;
    // A repeat erase finishes what an earlier one could not (the engine's part); the cloud's part is done only once.
    const already = (await db(c).one<{ erased_at: string | null }>("users", { id }))?.erased_at;
    const out = already ? null : await eraseUser(c.env.sql, c.caller!.tenantId, id, c.caller!.principal, c.now);
    // The company's engine knows the passkey a person enrolled by their id (cloud/src/engine/routes.ts): it goes too.
    let engineFailed = false;
    if (c.env.engine) {
      try { await c.env.engine(c.caller!.tenantId).forgetPasskey(id); } catch (e) {
        engineFailed = true;
        logEvent("error", "erase_engine_failed", { error: e instanceof Error ? e.message : String(e) }, c.now);
      }
    }
    await purgeEndedExportParts(c.env.sql, c.env.blobs, c.caller!.tenantId);
    if (engineFailed) return err(502, `${id} is erased, but the engine could not revoke the person's approval passkey yet: erase again to finish`);
    return out ? json(200, out) : err(409, `${id} was already erased`);
  } },
  { method: "GET", path: "/v1/export", summary: "Everything the cloud holds for the company; documents listed, each fetched from /v1/documents/{sha256}. Needs admin and read.", need: "admin", run: async (c) => {
    need(c.caller!, "read");
    return json(200, await exportTenant(c.env.sql, c.caller!.tenantId));
  } },
  { method: "POST", path: "/v1/export/staged", summary: "Build the company's export into the store in parts (one at a time, kept a day); returns a 15-minute signed link to its manifest, which needs no key. Needs admin and read.", need: "admin", run: async (c) => {
    need(c.caller!, "read");
    const x = await stageExport(c.env.sql, c.env.blobs, c.caller!.tenantId, c.caller!.principal, c.now, { ...(c.env.exportPartRows ? { partRows: c.env.exportPartRows } : {}), ...(c.env.exportMaxBytes !== undefined ? { maxBytes: c.env.exportMaxBytes } : {}) });
    const l = await signedLink(c.env.origin, c.env.sessionSecret, c.caller!.tenantId, x.id, "manifest", c.now);
    return json(201, { id: x.id, status: "ready", parts: x.parts.length, bytes: x.bytes, expires_at: x.expires_at, manifest_url: l.url, link_expires_at: l.expires_at });
  } },
  { method: "GET", path: "/v1/export/staged/{id}", summary: "A staged export's state, with a fresh 15-minute link to its manifest while it is ready. Needs admin and read.", need: "admin", run: async (c) => {
    need(c.caller!, "read");
    return json(200, await exportStatus(c.env.sql, c.env.blobs, c.env.origin, c.env.sessionSecret, c.caller!.tenantId, c.params[0]!, c.now));
  } },
  { method: "GET", path: "/v1/export/download/{id}/{part}", summary: "One part (or the manifest) of a staged export, by its signed link (no key); the manifest carries a signed link per part.", need: "public", run: async (c) => {
    const r = await download(c.env.sql, c.env.blobs, c.env.origin, c.env.sessionSecret, c.params[0]!, c.params[1]!, c.url.searchParams, c.now);
    return new Response(typeof r.body === "string" ? r.body : new Uint8Array(r.body), { status: r.status, headers: { ...JSON_HEADERS, ...(r.status === 200 ? { "content-disposition": `attachment; filename="${c.params[0]!}-${c.params[1]!}.json"` } : {}) } });
  } },
  { method: "POST", path: "/v1/close", summary: "Close the company's account: access ends; records are kept until the retention day, then purged.", need: "admin", run: async (c) => json(200, await closeTenant(c.env.sql, c.caller!.tenantId, c.now)) },

  // The company's engine (cloud/src/engine/routes.ts): one block, the caller's own company only, 404 while no engine is wired.
  ...engineRoutes<Ctx>({ json, err, body }),

  // The hands-on demo's engine routes (cloud/src/try/engineRoutes.ts): one block, the caller's own company only.
  ...tryEngineRoutes<Ctx>({ json, err, body }),
  ...tryExtraEngineRoutes<Ctx>({ json, err, body }),

  // The hands-on deployment (cloud/src/try/routes.ts): one block, 404 unless the deployment runs the hands-on demo.
  ...tryRoutes<Ctx>({ json, err, body }),
];

function match(path: string, pattern: string): string[] | null {
  const a = path.split("/"), b = pattern.split("/");
  if (a.length !== b.length) return null;
  const params: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (b[i]!.startsWith("{")) {
      let v: string;
      try { v = decodeURIComponent(a[i]!); } catch { throw new BadRequest("the path is not valid percent-encoding"); }
      if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(v)) return null;
      params.push(v);
    } else if (a[i] !== b[i]) return null;
  }
  return params;
}

const ready = new WeakMap<Sql, Promise<void>>();
/** The schema, applied once per database per isolate (CREATE ... IF NOT EXISTS; production also runs the D1 migration). */
export function ensureSchema(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = sql.exec(SCHEMA).catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

/** The API and the console, with one structured log line per request (the route's pattern, never a token or a body). */
export async function handle(req: Request, env: CloudEnv): Promise<Response> {
  const started = Date.now();
  const res = await route(req, env);
  const path = new URL(req.url).pathname;
  const pattern = path.startsWith("/v1/") ? (ROUTES.find((r) => { try { return match(path, r.path) !== null; } catch { return false; } })?.path ?? "unknown") : "console";
  // The hands-on deployment's own figures for the owner's page (cloud/src/try/metrics.ts): counts and buckets only.
  if (env.tryIt && path.startsWith("/v1/")) await noteRequest(env.sql, pattern, res.status, Date.now() - started, new Date());
  logEvent(res.status >= 500 ? "error" : res.status === 401 || res.status === 403 || res.status === 429 ? "warn" : "info", "request", { method: req.method, route: pattern, status: res.status, ms: Date.now() - started });
  return res;
}

async function route(req: Request, env: CloudEnv): Promise<Response> {
  const now = (env.now ?? (() => new Date()))();
  const url = new URL(req.url);
  try {
    // The console (cloud/src/console.ts): the browser pages, everything outside /v1.
    if (!url.pathname.startsWith("/v1/")) return consoleResponse(req, url, env);
    // A browser request that changes something must come from the console's own origin: a page elsewhere cannot make a
    // signed-in browser post here (the console keeps its session in the tab and sends it as a bearer token, so there is
    // no cookie to ride on either). The runner and other programs send no Origin.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const from = req.headers.get("origin");
      if (from !== null && from !== env.origin) return err(403, "this request came from another site");
    }
    await ensureSchema(env.sql);
    const candidates = ROUTES.map((r) => ({ r, p: match(url.pathname, r.path) })).filter((x) => x.p);
    if (!candidates.length) return err(404, "no such route");
    const hit = candidates.find((x) => x.r.method === req.method);
    if (!hit) return err(405, `use ${candidates.map((x) => x.r.method).join(" or ")}`);
    const ctx: Ctx = { env, req, url, now, params: hit.p!, caller: null, db: null };
    const rate = env.rate ?? { perMinute: 600, signInPerMinute: 30 };
    // The caller's address: Cloudflare's edge sets cf-connecting-ip and overwrites any value a client sends; behind any
    // other proxy this header must not be trusted (docs/cloud.md).
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    if (hit.r.need === "public") {
      if (hit.r.path.startsWith("/v1/auth/") && !(await withinRate(env.sql, `ip:${ip}`, now, { windowSec: 60, max: rate.signInPerMinute }))) return err(429, "too many sign-in attempts; wait a minute");
    } else if (hit.r.need === "platform") {
      if (!(await isPlatformAdmin(env.adminTokenSha256, req.headers.get("authorization")))) return err(401, "platform admin only");
    } else {
      // Failed keys and sessions are counted per address; past the limit the request is turned away before any lookup.
      if (await failedAuthBlocked(env.sql, ip, now, rate.failedAuthPerMinute ?? 20)) return err(429, "too many failed sign-ins from this address; wait a minute");
      let caller: Caller;
      try {
        caller = await callerOf(env.sql, env.sessionSecret, req.headers.get("authorization"), now);
      } catch (e) {
        if (e instanceof AuthError) {
          // A try company's own session that no longer works (expired, or the company was swept) counts against that
          // company, never against the address (cloud/src/try/gate.ts); anything else counts per address, as ever.
          const tryTenant = await signedTrySession(env.sessionSecret, req.headers.get("authorization"));
          if (tryTenant) await noteTryFail(env.sql, tryTenant, now);
          else await noteFailedAuth(env.sql, ip, keyIdOf(/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]), now);
        }
        throw e;
      }
      // A visitor's test company calls only the hands-on demo's routes, while it lives (cloud/src/try/gate.ts).
      const tryCaller = isTryTenant(caller.tenantId);
      if (tryCaller) await tryGate(env.sql, caller.tenantId, req.method, hit.r.path, now);
      need(caller, hit.r.need);
      // The starter key makes the first owner's passkey and nothing else (red team round 5): who it is, the company's
      // name, and an enrolment for its own owner.
      // A recovery key (the platform issued it for one owner who lost their passkey): who it is for, and that owner's
      // passkey enrolment; nothing else.
      if (caller.purpose === "recovery") {
        const ok = (req.method === "GET" && hit.r.path === "/v1/me") || (req.method === "POST" && hit.r.path === "/v1/users/{id}/enrolment" && hit.p![0] === caller.user);
        if (!ok) return err(403, "a recovery key only enrols the owner it was issued for; sign in with the new passkey to do the rest");
      }
      if (caller.purpose === "first-owner") {
        const ok = (req.method === "GET" && hit.r.path === "/v1/me") || (req.method === "POST" && hit.r.path === "/v1/company")
          || (req.method === "POST" && hit.r.path === "/v1/users/{id}/enrolment" && hit.p![0] === caller.user);
        if (!ok) return err(403, "the starter key only makes the first owner's passkey; sign in with that passkey to do the rest");
      }
      // A try session's event polls write no rate bucket: the company's engine limits those reads itself.
      const tryPoll = tryCaller && req.method === "GET" && hit.r.path === "/v1/engine/events";
      if (!tryPoll && !(await withinRate(env.sql, `${caller.kind}:${caller.principal}`, now, { windowSec: 60, max: rate.perMinute }))) return err(429, "too many requests; wait a minute");
      ctx.caller = caller;
      ctx.db = new TenantDb(env.sql, caller.tenantId);
    }
    return await hit.r.run(ctx);
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    if (e instanceof SyncRefused) return err(e.status, e.message);
    if (e instanceof BadRequest) return err(400, e.message);
    if (e instanceof PrivacyRefused) return err(409, e.message);
    if (e instanceof ExportRefused) return err(e.status, e.message);
    if (e instanceof MonitorRefused) return err(400, e.message);
    if (e instanceof PlatformRefused) return err(e.status, e.message);
    if (e instanceof TryRefused) return tryError(json, e.status, e.code, e.message);
    if (e instanceof SwitchRefused) return tryError(json, 400, "bad_request", e.message);
    // A write that lost a race with another request for the same company: nothing of it was written.
    if (e instanceof WriteConflict) return err(409, "another change for this company landed at the same time; nothing of this request was written: send it again");
    // Nothing internal leaks: the caller gets a reference, the log gets the error.
    const ref = randomToken(6);
    logEvent("error", "internal_error", { ref, error: e instanceof Error ? e.message : String(e) }, now);
    return err(500, `internal error (reference ${ref})`);
  }
}

const ERROR = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

/** OpenAPI 3.1, generated from the route table. */
export function openApi(origin: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    (paths[r.path] ??= {})[r.method.toLowerCase()] = {
      summary: r.summary,
      ...(params.length ? { parameters: params } : {}),
      security: r.need === "public" ? [] : r.need === "platform" ? [{ platformAdmin: [] }] : [{ bearer: [r.need] }],
      "x-purser-needs": r.need,
      responses: { 200: { description: "OK" }, 400: ERROR("A request that does not fit"), 401: ERROR("Not signed in"), 403: ERROR("Not allowed"), 404: ERROR("Not found (also: another company's object)"), 429: ERROR("Rate limited") },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Purser Cloud API", version: "1.0.0", description: "Everything a company's finance runs on, in one place: invoices, documents, suppliers, payments, the ledger and its reports. Test money only until a company goes live." },
    servers: [{ url: origin }],
    components: { schemas: { Error: { type: "object", required: ["error", "code"], properties: { error: { type: "string", description: "What went wrong, for a person" }, code: { type: "string", enum: Object.values(CODES), description: "Stable, for a program" } } } }, securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key (pck_...) or a passkey session (pcs....)" }, platformAdmin: { type: "http", scheme: "bearer" } } },
    paths,
  };
}
