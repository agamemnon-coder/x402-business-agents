// Purser Cloud's HTTP API. One route table: it routes the requests, says what each route needs, and is the source of
// the OpenAPI document (/v1/openapi.json), so the two cannot disagree. Every tenant route works through the caller's
// TenantDb; a route never names a tenant itself.

import { z } from "zod";
import { AuthError, callerOf, endSessions, enrolPasskey, failedAuthBlocked, isPlatformAdmin, KEY_MAX_DAYS, keyIdOf, need, newApiKey, newChallenge, noteFailedAuth, passkeyLogin, ROLES, SCOPES, startEnrolment, withinRate, type Caller, type Role, type Scope } from "./auth.js";
import { randomToken } from "./crypto.js";
import { BadRequest, insights, invoiceDocument, ledgerEntries, listInvoices, listPayments, listVendors, oneInvoice, report } from "./read.js";
import { SCHEMA } from "./schema.js";
import type { Blobs, Sql } from "./store.js";
import { applySync, SyncBatch, SyncRefused } from "./sync.js";
import { TenantDb } from "./tenant.js";
import { closeTenant, eraseUser, exportTenant, PrivacyRefused } from "./privacy.js";

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
  /** Requests per minute per key or session; per address on the sign-in routes; failed authentications per address. */
  rate?: { perMinute: number; signInPerMinute: number; failedAuthPerMinute?: number };
}

interface Ctx { env: CloudEnv; req: Request; url: URL; now: Date; params: string[]; caller: Caller | null; db: TenantDb | null }
type Need = "public" | "platform" | Scope;
interface Route { method: "GET" | "POST" | "DELETE"; path: string; summary: string; need: Need; run: (c: Ctx) => Promise<Response> }

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const notFound = (what: string) => json(404, { error: `no ${what}` });

async function body<T>(c: Ctx, schema: z.ZodType<T>, maxBytes = 1_000_000): Promise<T> {
  const len = Number(c.req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new BadRequest(`the body is larger than ${maxBytes} bytes`);
  const text = await c.req.text();
  if (text.length > maxBytes) throw new BadRequest(`the body is larger than ${maxBytes} bytes`);
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
const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "a slug is lowercase letters, digits and dashes");

export const ROUTES: Route[] = [
  { method: "GET", path: "/v1/health", summary: "Liveness.", need: "public", run: async () => json(200, { ok: true }) },
  { method: "GET", path: "/v1/openapi.json", summary: "This API, as OpenAPI 3.1.", need: "public", run: async (c) => json(200, openApi(c.env.origin)) },

  { method: "POST", path: "/v1/admin/tenants", summary: "Create a company and its first owner; returns the owner's API key once.", need: "platform", run: async (c) => {
    const b = await body(c, z.object({ slug: SLUG, name: z.string().min(1).max(200), owner: z.object({ display_name: z.string().min(1).max(120), email: z.string().email().max(200).optional() }).strict() }).strict());
    if (await c.env.sql.first("SELECT 1 FROM tenants WHERE slug = ?", [b.slug])) return json(409, { error: `the address ${b.slug} is taken` });
    const id = `t_${randomToken(12).replace(/[^A-Za-z0-9]/g, "x")}`;
    const iso = c.now.toISOString();
    await c.env.sql.run("INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)", [id, b.slug, b.name, iso]);
    const t = new TenantDb(c.env.sql, id);
    const ownerId = `u_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
    await t.apply([t.insert("users", { id: ownerId, display_name: b.owner.display_name, email: b.owner.email ?? null, role: "owner", created_at: iso })]);
    const key = await newApiKey(t, { name: "owner (first key)", scopes: ["read", "sync", "admin"], createdBy: ownerId, createdByUser: ownerId, now: c.now });
    return json(201, { tenant: { id, slug: b.slug, name: b.name }, owner: { id: ownerId }, api_key: key.key, expires_at: key.expires_at, note: "the key is shown once; store it in a secret store" });
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
    return json(201, r);
  } },
  { method: "POST", path: "/v1/auth/logout", summary: "Sign out: every session of the signed-in person ends.", need: "read", run: async (c) => {
    if (c.caller!.kind !== "session") return json(400, { error: "only a signed-in person signs out; revoke a key with DELETE /v1/keys/{id}" });
    await endSessions(c.env.sql, c.caller!.tenantId, c.caller!.principal);
    return json(200, { signed_out: true });
  } },

  { method: "GET", path: "/v1/me", summary: "Who is calling: the company, and the key's scopes or the person's role.", need: "read", run: async (c) => {
    const t = await c.env.sql.first<{ slug: string; name: string }>("SELECT slug, name FROM tenants WHERE id = ?", [c.caller!.tenantId]);
    return json(200, { tenant: { id: c.caller!.tenantId, ...t }, kind: c.caller!.kind, principal: c.caller!.principal, scopes: [...c.caller!.scopes], role: c.caller!.role ?? null });
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
  { method: "GET", path: "/v1/ledger/entries", summary: "Ledger entries with their lines; filter by from, to; paginated.", need: "read", run: async (c) => json(200, await ledgerEntries(db(c), c.url.searchParams)) },
  { method: "GET", path: "/v1/reports/{name}", summary: "trial, pnl, balance, vat (?quarter=2026Q4), payables, receivables: computed from the ledger.", need: "read", run: async (c) => json(200, await report(db(c), c.params[0]!, c.url.searchParams)) },
  { method: "GET", path: "/v1/insights", summary: "Payables at a glance: open, due, overdue, waiting, blocked, spend per supplier.", need: "read", run: async (c) => json(200, await insights(db(c), c.now)) },

  { method: "GET", path: "/v1/documents/{sha256}", summary: "A document the company holds, by its SHA-256 (the export lists them).", need: "read", run: async (c) => {
    const d = await db(c).one<{ blob_key: string; filename: string; mime: string }>("documents", { sha256: c.params[0]! });
    const bytes = d && (await c.env.blobs.get(d.blob_key));
    if (!d || !bytes) return notFound("document");
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": d.mime === "application/pdf" ? "application/pdf" : "application/octet-stream", "content-disposition": `attachment; filename="${d.filename.replace(/[^\w.-]+/g, "_")}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } },

  { method: "POST", path: "/v1/sync", summary: "The runner's push: vendors, invoices, documents, payments, ledger entries, audit rows. Idempotent. Never passkeys.", need: "sync", run: async (c) => {
    const b = await body(c, SyncBatch, 50_000_000);
    return json(200, { applied: await applySync(db(c), c.env.blobs, b, c.now) });
  } },
  { method: "GET", path: "/v1/sync/state", summary: "Where the cloud's copy stands: the heads of the audit and ledger chains, and the documents it holds.", need: "sync", run: async (c) => {
    const t = db(c);
    const a = (await t.select<{ seq: number; row_hash: string }>("audit_rows", {}, { order: ["seq"], desc: true, limit: 1 }))[0];
    const l = (await t.select<{ entry_id: number; entry_hash: string }>("ledger_entries", {}, { order: ["entry_id"], desc: true, limit: 1 }))[0];
    const docs = await t.select<{ sha256: string }>("documents", {}, { order: ["sha256"] });
    return json(200, { audit: { seq: a?.seq ?? 0, hash: a?.row_hash ?? null }, ledger: { entry_id: l?.entry_id ?? 0, hash: l?.entry_hash ?? null }, documents: docs.map((d) => d.sha256) });
  } },
  { method: "GET", path: "/v1/mail", summary: "Inbound e-mail waiting for the runner.", need: "sync", run: async (c) => json(200, { items: await db(c).select("inbound_mail", { status: "queued" }, { order: ["received_at"], limit: 100 }) }) },
  { method: "GET", path: "/v1/mail/{id}/raw", summary: "One inbound e-mail, raw (RFC 822).", need: "sync", run: async (c) => {
    const m = await db(c).one<{ blob_key: string }>("inbound_mail", { id: c.params[0]! });
    const bytes = m && (await c.env.blobs.get(m.blob_key));
    return m && bytes ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "message/rfc822", "cache-control": "no-store" } }) : notFound("mail");
  } },
  { method: "POST", path: "/v1/mail/{id}/done", summary: "The runner filed (done) or refused an inbound e-mail.", need: "sync", run: async (c) => {
    const b = await body(c, z.object({ status: z.enum(["done", "refused"]), note: z.string().max(500).optional() }).strict());
    const t = db(c);
    if (!(await t.one("inbound_mail", { id: c.params[0]! }))) return notFound("mail");
    await t.apply([t.update("inbound_mail", { id: c.params[0]! }, { status: b.status, note: b.note ?? null })]);
    return json(200, { id: c.params[0], status: b.status });
  } },

  { method: "GET", path: "/v1/keys", summary: "The company's API keys (never their secrets).", need: "admin", run: async (c) => json(200, { items: (await db(c).select<Record<string, unknown>>("api_keys", {}, { order: ["created_at"] })).map(withoutSecret) }) },
  { method: "POST", path: "/v1/keys", summary: "A new API key; returned once.", need: "admin", run: async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(SCOPES as [Scope, ...Scope[]])).min(1), expires_in_days: z.number().int().min(1).max(KEY_MAX_DAYS).optional() }).strict());
    // The person behind the new key is the person behind the caller (a key made by a key inherits it), so erasing that
    // person revokes the whole chain.
    const k = await newApiKey(db(c), { name: b.name, scopes: b.scopes, createdBy: c.caller!.principal, createdByUser: c.caller!.user, ...(b.expires_in_days ? { expiresInDays: b.expires_in_days } : {}), now: c.now });
    return json(201, { id: k.id, api_key: k.key, expires_at: k.expires_at, note: "shown once" });
  } },
  { method: "DELETE", path: "/v1/keys/{id}", summary: "Revoke an API key.", need: "admin", run: async (c) => {
    const t = db(c);
    const k = await t.one<{ revoked_at: string | null }>("api_keys", { id: c.params[0]! });
    if (!k) return notFound("key");
    if (!k.revoked_at) await t.apply([t.update("api_keys", { id: c.params[0]! }, { revoked_at: c.now.toISOString() })]);
    return json(200, { id: c.params[0], revoked: true });
  } },
  { method: "GET", path: "/v1/users", summary: "The company's people and their roles.", need: "admin", run: async (c) => json(200, { items: await db(c).select("users", {}, { order: ["created_at"] }) }) },
  { method: "POST", path: "/v1/users/{id}/enrolment", summary: "Start a person's passkey enrolment: a single-use secret for 30 minutes (an owner's passkey: a signed-in owner only, once any owner has one).", need: "admin", run: async (c) => json(201, await startEnrolment(db(c), c.caller!, c.params[0]!, c.now)) },
  { method: "POST", path: "/v1/users", summary: "Add a person (owner, cfo, accountant, viewer); they then enrol a passkey with an enrolment an owner starts.", need: "admin", run: async (c) => {
    const b = await body(c, z.object({ display_name: z.string().min(1).max(120), email: z.string().email().max(200).optional(), role: z.enum(ROLES as [Role, ...Role[]]) }).strict());
    const id = `u_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
    const t = db(c);
    await t.apply([t.insert("users", { id, display_name: b.display_name, email: b.email ?? null, role: b.role, created_at: c.now.toISOString() })]);
    return json(201, { id, role: b.role });
  } },
  { method: "POST", path: "/v1/users/{id}/erase", summary: "Erase a person's personal data (bookkeeping records are kept for 7 years).", need: "admin", run: async (c) => json(200, await eraseUser(c.env.sql, c.caller!.tenantId, c.params[0]!, c.caller!.principal, c.now)) },
  { method: "GET", path: "/v1/export", summary: "Everything the cloud holds for the company; documents listed, each fetched from /v1/documents/{sha256}. Needs admin and read.", need: "admin", run: async (c) => {
    need(c.caller!, "read");
    return json(200, await exportTenant(c.env.sql, c.caller!.tenantId));
  } },
  { method: "POST", path: "/v1/close", summary: "Close the company's account: access ends; records are kept until the retention day, then purged.", need: "admin", run: async (c) => json(200, await closeTenant(c.env.sql, c.caller!.tenantId, c.now)) },
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

export async function handle(req: Request, env: CloudEnv): Promise<Response> {
  const now = (env.now ?? (() => new Date()))();
  const url = new URL(req.url);
  try {
    await ensureSchema(env.sql);
    const candidates = ROUTES.map((r) => ({ r, p: match(url.pathname, r.path) })).filter((x) => x.p);
    if (!candidates.length) return json(404, { error: "no such route" });
    const hit = candidates.find((x) => x.r.method === req.method);
    if (!hit) return json(405, { error: `use ${candidates.map((x) => x.r.method).join(" or ")}` });
    const ctx: Ctx = { env, req, url, now, params: hit.p!, caller: null, db: null };
    const rate = env.rate ?? { perMinute: 600, signInPerMinute: 30 };
    // The caller's address: Cloudflare's edge sets cf-connecting-ip and overwrites any value a client sends; behind any
    // other proxy this header must not be trusted (docs/cloud.md).
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    if (hit.r.need === "public") {
      if (hit.r.path.startsWith("/v1/auth/") && !(await withinRate(env.sql, `ip:${ip}`, now, { windowSec: 60, max: rate.signInPerMinute }))) return json(429, { error: "too many sign-in attempts; wait a minute" });
    } else if (hit.r.need === "platform") {
      if (!(await isPlatformAdmin(env.adminTokenSha256, req.headers.get("authorization")))) return json(401, { error: "platform admin only" });
    } else {
      // Failed keys and sessions are counted per address; past the limit the request is turned away before any lookup.
      if (await failedAuthBlocked(env.sql, ip, now, rate.failedAuthPerMinute ?? 20)) return json(429, { error: "too many failed sign-ins from this address; wait a minute" });
      let caller: Caller;
      try {
        caller = await callerOf(env.sql, env.sessionSecret, req.headers.get("authorization"), now);
      } catch (e) {
        if (e instanceof AuthError) await noteFailedAuth(env.sql, ip, keyIdOf(/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]), now);
        throw e;
      }
      need(caller, hit.r.need);
      if (!(await withinRate(env.sql, `${caller.kind}:${caller.principal}`, now, { windowSec: 60, max: rate.perMinute }))) return json(429, { error: "too many requests; wait a minute" });
      ctx.caller = caller;
      ctx.db = new TenantDb(env.sql, caller.tenantId);
    }
    return await hit.r.run(ctx);
  } catch (e) {
    if (e instanceof AuthError) return json(e.status, { error: e.message });
    if (e instanceof SyncRefused) return json(e.status, { error: e.message });
    if (e instanceof BadRequest) return json(400, { error: e.message });
    if (e instanceof PrivacyRefused) return json(409, { error: e.message });
    // Nothing internal leaks: the caller gets a reference, the log gets the error.
    const ref = randomToken(6);
    console.error(`cloud error ${ref}`, e);
    return json(500, { error: `internal error (reference ${ref})` });
  }
}

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
      responses: { 200: { description: "OK" }, 401: { description: "Not signed in" }, 403: { description: "Not allowed" }, 404: { description: "Not found (also: another company's object)" }, 429: { description: "Rate limited" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Purser Cloud API", version: "1.0.0", description: "Everything a company's finance runs on, in one place: invoices, documents, suppliers, payments, the ledger and its reports. Test money only until a company goes live." },
    servers: [{ url: origin }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key (pck_...) or a passkey session (pcs....)" }, platformAdmin: { type: "http", scheme: "bearer" } } },
    paths,
  };
}
