// SPIKE probe 7: the seams between a per-company Durable Object and Purser Cloud, tried in workerd with real D1 and R2
// bindings. The Worker below IS the cloud Worker (cloud/src/worker.ts, unchanged) with three things added in front:
//   /v1/engine/*  a signed-in console session (or API key) reaches its own company's object, and no other;
//   email()       the cloud's own intake, then the message is handed to the company's object;
//   Engine        the Durable Object: it feeds the read model with applySync straight on the D1 and R2 bindings.
// What the object would compute (the engine's chain on its own SQLite) is the other explorer's probe; here the batches
// are the ones src/cloudsync/client.ts batchesFor() made in Node from a real world (fixtures/sync-batches.json).
import { DurableObject } from "cloudflare:workers";
import cloud, { type Bindings } from "../../../cloud/src/worker.js";
import { ensureSchema } from "../../../cloud/src/app.js";
import { AuthError, callerOf, need, sessionToken } from "../../../cloud/src/auth.js";
import { receiveEmail, type InboundEmail } from "../../../cloud/src/mail.js";
import { d1Sql, r2Blobs, type Blobs, type Sql } from "../../../cloud/src/store.js";
import { applySync, SyncBatch } from "../../../cloud/src/sync.js";
import { TenantDb } from "../../../cloud/src/tenant.js";
import { parseEml } from "../../../src/ap/eml.js";
import { emlWith } from "../../../src/e2e/documents.js";
import fixture from "../fixtures/sync-batches.json";
import invoicePdf from "../fixtures/invoice.pdf";
import node from "../fixtures/node-results.json";
import { json, sha256, steps } from "./_util.js";

interface EngineStub {
  feed(tenantId: string, as?: "engine" | "key"): Promise<unknown>;
  whoAmI(): Promise<{ id: string; name: string | null; tenant: string | null; sqliteBytes: number }>;
  mail(tenantId: string, mailId: string): Promise<unknown>;
  mailSeen(): Promise<unknown[]>;
  say(text: string): Promise<number>;
  arm(ms: number): Promise<void>;
  alarms(): Promise<number>;
  fetch(req: Request): Promise<Response>;
}
interface Env extends Bindings { ENGINE: { idFromName(name: string): { toString(): string }; get(id: unknown): EngineStub } }

/** One company's engine. Its name is the company's tenant id; only Worker code can reach it. */
export class Engine extends DurableObject<Env> {
  private get sql() { return (this.ctx as { storage: { sql: { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] }; databaseSize: number } } }).storage.sql; }

  constructor(ctx: unknown, env: Env) {
    super(ctx, env);
    this.sql.exec("CREATE TABLE IF NOT EXISTS engine_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS engine_mail (id TEXT PRIMARY KEY, attachments TEXT NOT NULL); CREATE TABLE IF NOT EXISTS engine_alarms (at TEXT NOT NULL)");
  }

  /** Pinned on first use: an object serves one company for good. */
  private tenant(tenantId: string): string {
    const held = this.sql.exec("SELECT value FROM engine_meta WHERE key = 'tenant'").toArray()[0]?.value as string | undefined;
    if (held && held !== tenantId) throw new Error("this object belongs to another company");
    if (!held) this.sql.exec("INSERT INTO engine_meta (key, value) VALUES ('tenant', ?)", tenantId);
    return tenantId;
  }

  /** The read model's feed: the cloud's own applySync, called on the D1 and R2 bindings. No HTTP, no sync key. */
  async feed(tenantId: string, as: "engine" | "key" = "engine"): Promise<unknown> {
    // Every D1 round trip is counted: each is a subrequest of this invocation.
    const calls = { d1: 0, d1_statements: 0, r2: 0 };
    const inner = d1Sql(this.env.DB);
    const sql: Sql = {
      all: (q, p) => { calls.d1++; calls.d1_statements++; return inner.all(q, p); }, first: (q, p) => { calls.d1++; calls.d1_statements++; return inner.first(q, p); },
      run: (q, p) => { calls.d1++; calls.d1_statements++; return inner.run(q, p); }, batch: (st) => { calls.d1++; calls.d1_statements += st.length; return inner.batch(st); }, exec: (x) => inner.exec(x),
    };
    const bucket = r2Blobs(this.env.DOCS);
    const blobs: Blobs = { ...bucket, put: (k, b, m) => { calls.r2++; return bucket.put(k, b, m); }, has: (k) => { calls.r2++; return bucket.has!(k); } };
    const db = new TenantDb(sql, this.tenant(tenantId));
    const applied = [];
    const t = performance.now();
    // With no caller named, applySync adds no key guard: the object is not a sync key. ("key" shows what the guard does.)
    for (const b of fixture.batches) applied.push(as === "engine" ? await applySync(db, blobs, SyncBatch.parse(b), new Date(fixture.now)) : await applySync(db, blobs, SyncBatch.parse(b), new Date(fixture.now), { kind: "key", principal: "engine" }));
    return { applied, ms: Math.round(performance.now() - t), calls };
  }

  async whoAmI() {
    const id = (this.ctx as { id: { toString(): string; name?: string } }).id;
    return { id: id.toString(), name: id.name ?? null, tenant: (this.sql.exec("SELECT value FROM engine_meta WHERE key = 'tenant'").toArray()[0]?.value as string | undefined) ?? null, sqliteBytes: this.sql.databaseSize };
  }

  /** An e-mail the cloud queued for this company: its raw bytes from R2, read by the engine's own parser. */
  async mail(tenantId: string, mailId: string): Promise<unknown> {
    const db = new TenantDb(d1Sql(this.env.DB), this.tenant(tenantId));
    const row = await db.one<{ blob_key: string; status: string }>("inbound_mail", { id: mailId });
    if (!row) return { found: false };
    const raw = await r2Blobs(this.env.DOCS).get(row.blob_key);
    if (!raw) return { found: true, bytes: 0 };
    const eml = parseEml(Buffer.from(raw));
    const attachments = await Promise.all(eml.attachments.map(async (a) => ({ filename: a.filename, mime: a.mime, bytes: a.bytes.length, sha256: await sha256(new Uint8Array(a.bytes)) })));
    // Here the engine's ingestEmail(db, deps, bytes) would run on this object's own SQLite, then mark the mail done.
    this.sql.exec("INSERT OR REPLACE INTO engine_mail (id, attachments) VALUES (?, ?)", mailId, JSON.stringify(attachments));
    return { found: true, from: eml.from, subject: eml.subject, attachments };
  }
  async mailSeen() { return this.sql.exec("SELECT id, attachments FROM engine_mail").toArray(); }

  /** Live agent stream: hibernatable WebSockets (the object can sleep while consoles stay connected). */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    (this.ctx as { acceptWebSocket(ws: WebSocket, tags?: string[]): void }).acceptWebSocket(pair[1], ["agent-stream"]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void { ws.send(`echo:${typeof message === "string" ? message : "bytes"}`); }
  webSocketClose(ws: WebSocket, code: number): void { try { ws.close(code, "bye"); } catch { /* already closed */ } }
  async say(text: string): Promise<number> {
    const open = (this.ctx as { getWebSockets(tag?: string): WebSocket[] }).getWebSockets("agent-stream");
    for (const ws of open) ws.send(text);
    return open.length;
  }

  /** The object's own clock: follow payouts, close the month, retry: an alarm wakes it with no request. */
  async arm(ms: number): Promise<void> { await (this.ctx as { storage: { setAlarm(at: number): Promise<void> } }).storage.setAlarm(Date.now() + ms); }
  async alarm(): Promise<void> { this.sql.exec("INSERT INTO engine_alarms (at) VALUES (?)", new Date().toISOString()); }
  async alarms(): Promise<number> { return this.sql.exec("SELECT COUNT(*) AS n FROM engine_alarms").toArray()[0]!.n as number; }
}

const stubFor = (env: Env, tenantId: string) => env.ENGINE.get(env.ENGINE.idFromName(tenantId));

/** /v1/engine/*: the caller is whoever the cloud's own auth says it is; the object is the one named by its tenant. */
let sqlOfIsolate: Sql | null = null;
async function engineRoute(req: Request, env: Env): Promise<Response> {
  // One Sql wrapper per isolate: ensureSchema remembers per wrapper, and a new wrapper per request (as cloud/src/worker.ts
  // envOf makes today) runs the whole schema script again on every request.
  const sql = (sqlOfIsolate ??= d1Sql(env.DB));
  await ensureSchema(sql);
  let caller;
  try { caller = await callerOf(sql, env.SESSION_SECRET, req.headers.get("authorization"), new Date()); }
  catch (e) { return json({ error: (e as Error).message }, e instanceof AuthError ? 401 : 500); }
  const path = new URL(req.url).pathname;
  const engine = stubFor(env, caller.tenantId);
  try {
    if (path === "/v1/engine/whoami") { need(caller, "read"); return json({ tenant: caller.tenantId, ...(await engine.whoAmI()) }); }
    if (path === "/v1/engine/feed" && req.method === "POST") { need(caller, "admin"); return json(await engine.feed(caller.tenantId, new URL(req.url).searchParams.get("as") === "key" ? "key" : "engine")); }
    if (path === "/v1/engine/stream") { need(caller, "read"); return engine.fetch(req); }
  } catch (e) { return json({ error: (e as Error).message }, e instanceof AuthError ? 403 : 500); }
  return json({ error: "no such engine route" }, 404);
}

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/") return scenario(req, env);
    if (path.startsWith("/v1/engine/")) return engineRoute(req, env);
    return cloud.fetch(req, env);
  },
  async email(msg: InboundEmail, env: Env): Promise<void> {
    // The cloud's own intake first (address to company, quota, R2, the inbound_mail row), then the company's object.
    const sql = d1Sql(env.DB);
    await ensureSchema(sql);
    const r = await receiveEmail(sql, r2Blobs(env.DOCS), msg, { domain: env.MAIL_DOMAIN ?? "", now: new Date() });
    if (!r.queued || !r.id) return;
    const row = await sql.first<{ tenant_id: string }>("SELECT tenant_id FROM inbound_mail WHERE id = ?", [r.id]);
    if (row) await stubFor(env, row.tenant_id).mail(row.tenant_id, r.id);
  },
  scheduled: cloud.scheduled,
};
export default worker;

/** The probe: everything below goes through the routes above, as a console or a mail server would. */
async function scenario(req: Request, env: Env): Promise<Response> {
  const { out, step } = steps(req);
  const origin = env.ORIGIN;
  const call = (path: string, init: RequestInit & { token?: string } = {}) => worker.fetch(new Request(`${origin}${path}`, { ...init, headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), origin, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) } }), env);
  const company = async (slug: string) => {
    const res = await call("/v1/admin/tenants", { method: "POST", token: "spike-admin-token", body: JSON.stringify({ slug, name: `${slug} (test)`, owner: { display_name: "Test Owner" } }) });
    const b = (await res.json()) as { tenant: { id: string }; owner: { id: string } };
    if (res.status !== 201) throw new Error(`tenant ${slug}: ${res.status} ${JSON.stringify(b)}`);
    return { slug, tenantId: b.tenant.id, session: await sessionToken(env.SESSION_SECRET, { tenantId: b.tenant.id, userId: b.owner.id, role: "owner", gen: 0 }, new Date()) };
  };
  // The harness's second request: between the two it delivered a real e-mail EVENT to this Worker (workerd's local
  // Email Routing, POST /cdn-cgi/handler/email) for the company "mailprobe"; did that company's object get it?
  if (new URL(req.url).searchParams.get("only") === "second_request") await step("second_request_real_email_event_reached_the_object", async () => {
    const row = await d1Sql(env.DB).first<{ id: string }>("SELECT id FROM tenants WHERE slug = 'mailprobe'");
    if (!row) return { tenant: false };
    const seen = (await stubFor(env, row.id).mailSeen()) as { id: string; attachments: string }[];
    const att = seen[0] ? (JSON.parse(seen[0].attachments) as { filename: string; sha256: string }[]) : [];
    const queued = await d1Sql(env.DB).all<{ id: string; status: string; size: number }>("SELECT id, status, size FROM inbound_mail WHERE tenant_id = ?", [row.id]);
    return { cloud_queue: queued.map((q) => `${q.status} ${q.size} bytes`), object_got_mail: seen.length, attachment: att[0]?.filename ?? null, attachment_is_the_invoice_pdf: att[0]?.sha256 === node.invoice.sha256 };
  });
  if (new URL(req.url).searchParams.get("only") === "second_request") return json(out);
  await step("mailprobe_company_for_the_real_email_event", async () => (await company("mailprobe")).tenantId.slice(0, 6));
  const suffix = crypto.randomUUID().slice(0, 6);
  let a!: Awaited<ReturnType<typeof company>>, b!: Awaited<ReturnType<typeof company>>;
  await step("two_companies_by_the_clouds_own_admin_route", async () => { a = await company(`alpha-${suffix}`); b = await company(`beta-${suffix}`); return { a: a.tenantId.slice(0, 6), b: b.tenantId.slice(0, 6) }; });

  // Routing and auth: session to its own object, never another's; nobody without a session.
  await step("session_reaches_its_own_object", async () => {
    const [ra, rb, anon] = [await call("/v1/engine/whoami", { token: a.session }), await call("/v1/engine/whoami", { token: b.session }), await call("/v1/engine/whoami")];
    const [ja, jb] = [(await ra.json()) as { id: string; tenant: string; name: string | null }, (await rb.json()) as { id: string; tenant: string }];
    return { a_status: ra.status, a_object_is_named_by_tenant: ja.id === env.ENGINE.idFromName(a.tenantId).toString(), ctx_id_name_inside_object: ja.name, different_objects: ja.id !== jb.id, without_session: anon.status, forged: (await call("/v1/engine/whoami", { token: `${a.session.slice(0, -2)}xx` })).status };
  });

  // The feed: the object calls applySync on D1 and R2; the console's own read API then shows it.
  await step("applySync_with_a_made_up_key_is_refused", async () => { const r = await call("/v1/engine/feed?as=key", { method: "POST", token: a.session }); return { status: r.status, ...((await r.json()) as object) }; });
  await step("object_feeds_read_model_with_applySync", async () => { const r = await call("/v1/engine/feed", { method: "POST", token: a.session }); return { status: r.status, ...((await r.json()) as object) }; });
  await step("console_api_shows_what_the_object_fed", async () => {
    const get = async (p: string) => { const r = await call(p, { token: a.session }); return { status: r.status, body: (await r.json()) as { items?: { id: string; status?: string; doc_sha256?: string }[] } & Record<string, unknown> }; };
    const inv = await get("/v1/invoices");
    const first = inv.body.items?.[0];
    const doc = first ? await call(`/v1/invoices/${first.id}/document`, { token: a.session }) : null;
    const docBytes = doc ? new Uint8Array(await doc.arrayBuffer()) : new Uint8Array();
    const trial = await get("/v1/reports/trial"), entries = await get("/v1/ledger/entries"), tx = await get("/v1/transactions"), vendors = await get("/v1/vendors"), payments = await get("/v1/payments");
    return {
      invoices: inv.body.items?.map((i) => `${i.id} ${i.status}`), document: { status: doc?.status, bytes: docBytes.length, is_pdf: new TextDecoder().decode(docBytes.subarray(0, 5)) === "%PDF-", sha_matches_invoice: first ? (await sha256(docBytes)) === first.doc_sha256 : false },
      trial_status: trial.status, trial_keys: Object.keys(trial.body).slice(0, 6), ledger_entries: entries.body.items?.length, transactions: tx.body.items?.length, vendors: vendors.body.items?.length, payments: payments.body.items?.length,
      fixture_had: node.sync.kinds,
    };
  });
  await step("one_cloud_read_request_ms", async () => { const t = performance.now(); await call("/v1/invoices", { token: a.session }); const first = performance.now() - t; const t2 = performance.now(); await call("/v1/engine/whoami", { token: a.session }); return { cloud_route_ms: Math.round(first), engine_route_ms: Math.round(performance.now() - t2) }; });
  await step("other_company_sees_nothing", async () => { const r = await call("/v1/invoices", { token: b.session }); return { status: r.status, invoices: ((await r.json()) as { items: unknown[] }).items.length }; });
  await step("feed_again_changes_nothing", async () => { const r = await call("/v1/engine/feed", { method: "POST", token: a.session }); return (await r.json()) as object; });
  await step("a_viewer_cannot_feed", async () => {
    const sql = d1Sql(env.DB);
    await sql.run("INSERT INTO users (tenant_id, id, display_name, email, role, created_at) VALUES (?, 'u_viewer', 'Viewer', NULL, 'viewer', ?)", [a.tenantId, new Date().toISOString()]);
    const viewer = await sessionToken(env.SESSION_SECRET, { tenantId: a.tenantId, userId: "u_viewer", role: "viewer", gen: 0 }, new Date());
    return { feed: (await call("/v1/engine/feed", { method: "POST", token: viewer })).status, whoami: (await call("/v1/engine/whoami", { token: viewer })).status };
  });

  // Inbound e-mail: the Worker's email handler, to the company's object.
  await step("email_handler_hands_the_mail_to_the_object", async () => {
    const raw = emlWith(Buffer.from(invoicePdf), { filename: "ZV-5001.pdf", from: "boekhouding@zeeland-verpakkingen.example", to: `${a.slug}@${env.MAIL_DOMAIN}`, subject: "Factuur ZV-5001" });
    let rejected: string | null = null;
    await worker.email({ from: "boekhouding@zeeland-verpakkingen.example", to: `${a.slug}@${env.MAIL_DOMAIN}`, raw: new Uint8Array(raw), rawSize: raw.length, setReject: (r: string) => { rejected = r; } }, env);
    let unknownRejected: string | null = null;
    await worker.email({ from: "x@y.example", to: `nobody-${suffix}@${env.MAIL_DOMAIN}`, raw: new Uint8Array(raw), rawSize: raw.length, setReject: (r: string) => { unknownRejected = r; } }, env);
    const seen = (await stubFor(env, a.tenantId).mailSeen()) as { id: string; attachments: string }[];
    const att = seen[0] ? (JSON.parse(seen[0].attachments) as { filename: string; sha256: string; bytes: number }[]) : [];
    return { rejected, object_got_mail: seen.length, attachment: att[0]?.filename, attachment_is_the_invoice_pdf: att[0]?.sha256 === node.invoice.sha256, other_object_got: ((await stubFor(env, b.tenantId).mailSeen()) as unknown[]).length, unknown_address: unknownRejected };
  });

  // Live agent stream: a WebSocket through the route to the object (hibernation API), echo and a push from the object.
  await step("websocket_stream_through_the_route", async () => {
    const res = await call("/v1/engine/stream", { token: a.session, headers: { upgrade: "websocket" } });
    const ws = (res as unknown as { webSocket: WebSocket & { accept(): void } | null }).webSocket;
    if (!ws) return { status: res.status, websocket: false };
    ws.accept();
    const got: string[] = [];
    const two = new Promise<void>((r) => ws.addEventListener("message", (e) => { got.push(String(e.data)); if (got.length === 2) r(); }));
    ws.send("hello");
    const listeners = await stubFor(env, a.tenantId).say("treasury: reading invoice ZV-5001");
    await Promise.race([two, new Promise((r) => setTimeout(r, 3000))]);
    ws.close(1000, "done");
    return { status: res.status, got, listeners_the_object_saw: listeners, without_session: (await call("/v1/engine/stream", { headers: { upgrade: "websocket" } })).status };
  });

  await step("alarm_wakes_the_object", async () => {
    const e = stubFor(env, a.tenantId);
    await e.arm(100);
    await new Promise((r) => setTimeout(r, 700));
    return { fired: await e.alarms() };
  });
  await step("object_identity_after_use", async () => (await (await call("/v1/engine/whoami", { token: a.session })).json()) as object);
  return json(out);
}
