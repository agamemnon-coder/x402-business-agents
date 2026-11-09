// Purser Cloud's HTTP API. One route table: it routes the requests, says what each route needs, and is the source of
// the OpenAPI document (/v1/openapi.json), so the two cannot disagree. Every tenant route works through the caller's
// TenantDb; a route never names a tenant itself.

import { z } from "zod";
import { AuthError, callerOf, endSessions, enrolPasskey, failedAuthBlocked, isPlatformAdmin, KEY_MAX_DAYS, keyIdOf, need, newApiKey, newChallenge, noteFailedAuth, passkeyLogin, ROLES, SCOPES, startEnrolment, withinRate, type Caller, type Role, type Scope, firstApiKey, descendantKeys } from "./auth.js";
import { randomToken } from "./crypto.js";
import { allTransactions, BadRequest, insights, invoiceDocument, ledgerEntries, listInvoices, listPayments, listTransactions, listVendors, oneInvoice, oneTransaction, paged, report, transactionSummary } from "./read.js";
import { registerCsv } from "../../src/money/registerShape.js";
import { SCHEMA } from "./schema.js";
import type { Blobs, Sql } from "./store.js";
import { applySync, SyncBatch, SyncRefused } from "./sync.js";
import { WriteConflict } from "./tenant.js";
import { TenantDb } from "./tenant.js";
import { closeTenant, eraseUser, exportTenant, PrivacyRefused } from "./privacy.js";
import { consoleResponse } from "./console.js";
import { qrSvg } from "./qr.js";

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
  /** Requests per minute per key or session; per address on the sign-in routes; failed authentications per address. */
  rate?: { perMinute: number; signInPerMinute: number; failedAuthPerMinute?: number };
}

interface Ctx { env: CloudEnv; req: Request; url: URL; now: Date; params: string[]; caller: Caller | null; db: TenantDb | null }
type Need = "public" | "platform" | Scope;
interface Route { method: "GET" | "POST" | "DELETE"; path: string; summary: string; need: Need; run: (c: Ctx) => Promise<Response> }

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
/** Every error has one shape: a sentence for a person and a stable code for a program. */
const CODES: Record<number, string> = { 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 409: "conflict", 413: "too_large", 422: "unprocessable", 429: "rate_limited", 500: "internal" };
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
const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "a slug is lowercase letters, digits and dashes");

export const ROUTES: Route[] = [
  { method: "GET", path: "/v1/health", summary: "Liveness.", need: "public", run: async () => json(200, { ok: true }) },
  { method: "GET", path: "/v1/openapi.json", summary: "This API, as OpenAPI 3.1.", need: "public", run: async (c) => json(200, openApi(c.env.origin)) },

  { method: "POST", path: "/v1/admin/tenants", summary: "Create a company and its first owner; returns the owner's API key once.", need: "platform", run: async (c) => {
    const b = await body(c, z.object({ slug: SLUG, name: z.string().min(1).max(200), owner: z.object({ display_name: z.string().min(1).max(120), email: z.string().email().max(200).optional() }).strict() }).strict());
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
    const key = await firstApiKey(t, { name: "owner (first key)", scopes: ["read", "sync", "admin"], createdBy: ownerId, createdByUser: ownerId, now: c.now });
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
    return json(200, { tenant: { id: c.caller!.tenantId, ...t, language: companyLanguage }, kind: c.caller!.kind, principal: c.caller!.principal, scopes: [...c.caller!.scopes], role: c.caller!.role ?? null,
      user: c.caller!.user ? { id: c.caller!.user, display_name: person?.display_name ?? null, role: person?.role ?? null, language: person?.language ?? null } : null,
      language: person?.language === "en" || person?.language === "nl" ? person.language : companyLanguage,
      owner_has_passkey: ownerPasskey, inbox: c.env.mailDomain && t ? `${t.slug}@${c.env.mailDomain}` : null });
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
  { method: "GET", path: "/v1/sync/state", summary: "Where the cloud's copy stands: the heads of the audit and ledger chains, and the documents it holds.", need: "sync", run: async (c) => {
    const t = db(c);
    const a = (await t.select<{ seq: number; row_hash: string }>("audit_rows", {}, { order: ["seq"], desc: true, limit: 1 }))[0];
    const l = (await t.select<{ entry_id: number; entry_hash: string }>("ledger_entries", {}, { order: ["entry_id"], desc: true, limit: 1 }))[0];
    const docs = await t.select<{ sha256: string }>("documents", {}, { order: ["sha256"] });
    return json(200, { audit: { seq: a?.seq ?? 0, hash: a?.row_hash ?? null }, ledger: { entry_id: l?.entry_id ?? 0, hash: l?.entry_hash ?? null }, documents: docs.map((d) => d.sha256) });
  } },
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
    await t.apply([...(k.revoked_at ? [] : [t.update("api_keys", { id: c.params[0]! }, { revoked_at: iso })]),
      ...(children.length ? [t.update("api_keys", { id: { in: children }, revoked_at: null }, { revoked_at: iso })] : [])]);
    return json(200, { id: c.params[0], revoked: true, also_revoked: children });
  } },
  { method: "GET", path: "/v1/users", summary: "The company's people and their roles; paginated (limit, cursor).", need: "admin", run: async (c) => json(200, await paged<Record<string, unknown>>(db(c), "users", "id", {}, c.url.searchParams, (r) => r)) },
  { method: "POST", path: "/v1/users/{id}/enrolment", summary: "Start a person's passkey enrolment: a single-use secret for 30 minutes (an owner's passkey: a signed-in owner only, once any owner has one). Also returns the invite link (the secret after the #, so opening it sends the secret to no server) and its QR code as SVG.", need: "admin", run: async (c) => {
    const e = await startEnrolment(db(c), c.caller!, c.params[0]!, c.now);
    const t = await c.env.sql.first<{ slug: string }>("SELECT slug FROM tenants WHERE id = ?", [c.caller!.tenantId]);
    const u = await db(c).one<{ display_name: string }>("users", { id: c.params[0]! });
    const link = `${c.env.origin}/#/enrol?${new URLSearchParams({ t: t!.slug, e: e.enrolment_id, k: e.token, n: u?.display_name ?? "" }).toString()}`;
    return json(201, { ...e, link, qr_svg: qrSvg(link) });
  } },
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
        if (e instanceof AuthError) await noteFailedAuth(env.sql, ip, keyIdOf(/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]), now);
        throw e;
      }
      need(caller, hit.r.need);
      if (!(await withinRate(env.sql, `${caller.kind}:${caller.principal}`, now, { windowSec: 60, max: rate.perMinute }))) return err(429, "too many requests; wait a minute");
      ctx.caller = caller;
      ctx.db = new TenantDb(env.sql, caller.tenantId);
    }
    return await hit.r.run(ctx);
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    if (e instanceof SyncRefused) return err(e.status, e.message);
    if (e instanceof BadRequest) return err(400, e.message);
    if (e instanceof PrivacyRefused) return err(409, e.message);
    // A write that lost a race with another request for the same company: nothing of it was written.
    if (e instanceof WriteConflict) return err(409, "another change for this company landed at the same time; nothing of this request was written: send it again");
    // Nothing internal leaks: the caller gets a reference, the log gets the error.
    const ref = randomToken(6);
    console.error(`cloud error ${ref}`, e);
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
