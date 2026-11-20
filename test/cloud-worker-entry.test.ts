// The cloud Worker's entry point (cloud/src/worker.ts) over a D1 stand-in on better-sqlite3: it will not start without
// a session secret, wires alerts and OAuth only when every setting they need is there, counts requests after the
// answer, keeps e-mail queued when no engine runs, and its daily job never lets one failing step skip the others.
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { alertsOf, connectOf, oidcOf, type Bindings } from "../cloud/src/worker.js";
import { ENGINE_MODE } from "../cloud/src/engine/client.js";
import type { D1Like } from "../cloud/src/store.js";
import { RECOVERY_REQUESTS_SCHEMA } from "../cloud/src/recovery.js";

type V = string | number | null;
/** D1's interface over better-sqlite3: bind, all, first, run, a batch in one transaction, exec. */
function d1(db = new Database(":memory:")): D1Like & { db: Database.Database } {
  const stmt = (sql: string, params: V[] = []) => ({
    sql, params,
    bind: (...v: V[]) => stmt(sql, v),
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    first: async <T>() => ((db.prepare(sql).get(...params) as T | undefined) ?? null),
    run: async () => {
      const s = db.prepare(sql);
      return { meta: { changes: s.reader ? (s.all(...params), 0) : s.run(...params).changes } };
    },
  });
  return {
    db,
    prepare: (sql: string) => stmt(sql),
    batch: async (s: unknown[]) => { db.transaction(() => { for (const x of s as { sql: string; params: V[] }[]) db.prepare(x.sql).run(...x.params); })(); return []; },
    exec: async (sql: string) => { db.exec(sql); return {}; },
  } as unknown as D1Like & { db: Database.Database };
}

const SECRET = "s".repeat(48);
const bindings = (over: Partial<Bindings> = {}): Bindings & { DB: ReturnType<typeof d1> } =>
  ({ DB: d1(), SESSION_SECRET: SECRET, ADMIN_TOKEN_SHA256: "0".repeat(64), RP_ID: "cloud.test", ORIGIN: "https://cloud.test", ...over }) as Bindings & { DB: ReturnType<typeof d1> };

afterEach(() => { vi.restoreAllMocks(); });

describe("starting the Worker", () => {
  it("refuses every entry point without a session secret of at least 32 characters", async () => {
    for (const SESSION_SECRET of ["", "short"]) {
      const b = bindings({ SESSION_SECRET });
      await expect(worker.fetch(new Request("https://cloud.test/v1/health"), b)).rejects.toThrow(/SESSION_SECRET is not set/);
      await expect(worker.scheduled({}, b)).rejects.toThrow(/SESSION_SECRET/);
      await expect(worker.queue({ messages: [] }, b)).rejects.toThrow(/SESSION_SECRET/);
    }
  });

  it("answers the health check from D1 with the deployed version, documents kept in D1 when there is no R2", async () => {
    const res = await worker.fetch(new Request("https://cloud.test/v1/health"), bindings({ VERSION: "abc123" }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain("abc123");
  });
});

describe("the day's counters, after the answer", () => {
  it("counts a request through ctx.waitUntil, and not at all with STATS off or without a ctx", async () => {
    const b = bindings();
    const waits: Promise<unknown>[] = [];
    const res = await worker.fetch(new Request("https://cloud.test/v1/health"), b, { waitUntil: (p) => { waits.push(p); } });
    expect(res.status).toBe(200);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    const rows = b.DB.db.prepare("SELECT metric, n FROM daily_counts").all() as { metric: string; n: number }[];
    expect(rows.map((r) => r.metric)).toContain("requests");

    const off = bindings({ STATS: "off" });
    const none: Promise<unknown>[] = [];
    await worker.fetch(new Request("https://cloud.test/v1/health"), off, { waitUntil: (p) => { none.push(p); } });
    expect(none).toHaveLength(0);
  });

  it("a counter that cannot be written is logged and never fails the request", async () => {
    const b = bindings();
    const waits: Promise<unknown>[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The schema is in place after the first request; then the counters' table goes away under the Worker.
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    b.DB.db.exec("DROP TABLE IF EXISTS daily_counts; CREATE TABLE daily_counts (day TEXT CHECK (0), metric TEXT, n INTEGER, PRIMARY KEY (day, metric))");
    const res = await worker.fetch(new Request("https://cloud.test/v1/health"), b, { waitUntil: (p) => { waits.push(p); } });
    expect(res.status).toBe(200);
    await expect(Promise.all(waits)).resolves.toBeDefined();
    expect(b.DB.db.prepare("SELECT COUNT(*) AS n FROM daily_counts").get()).toEqual({ n: 0 });
    log.mockRestore();
  });
});

describe("approval alerts and OAuth, only with every setting they need", () => {
  it("WhatsApp needs the SID, the token and the sender; e-mail the key and the From; live money only when switched on", () => {
    expect(alertsOf(bindings())).toEqual({ testMoney: true });
    expect(alertsOf(bindings({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }))).toEqual({ testMoney: true });
    expect(alertsOf(bindings({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_WHATSAPP_FROM: "+1" })).twilio).toEqual({ accountSid: "AC1", authToken: "t", whatsappFrom: "+1" });
    expect(alertsOf(bindings({ RESEND_API_KEY: "re_1" })).email).toBeUndefined();
    expect(alertsOf(bindings({ RESEND_API_KEY: "re_1", ALERT_EMAIL_FROM: "a@b.c" })).email).toBeDefined();
    expect(alertsOf(bindings({ ALERTS_LIVE_MONEY: "on" })).testMoney).toBe(false);
    expect(alertsOf(bindings({ ALERTS_LIVE_MONEY: "yes" })).testMoney).toBe(true);
  });

  it("OAuth is off unless switched on, refuses to run without its sealing key, and lists only providers with both id and secret", () => {
    expect(connectOf(bindings({ OAUTH_TOKEN_KEY: "k" }))).toBeUndefined();
    expect(() => connectOf(bindings({ PURSER_OAUTH_CONNECT: "on" }))).toThrow(/OAUTH_TOKEN_KEY is not set/);
    const bare = connectOf(bindings({ PURSER_OAUTH_CONNECT: "on", OAUTH_TOKEN_KEY: "k", AIRWALLEX_OAUTH_CLIENT_ID: "id-only" }))!;
    expect(bare.clients).toEqual({});
    expect(bare.airwallexWebhookSecret).toBeUndefined();
    const full = connectOf(bindings({ PURSER_OAUTH_CONNECT: "on", OAUTH_TOKEN_KEY: "k", ORIGIN: "https://cloud.test/",
      AIRWALLEX_OAUTH_CLIENT_ID: "a", AIRWALLEX_OAUTH_CLIENT_SECRET: "as", MONEYBIRD_OAUTH_CLIENT_ID: "m", MONEYBIRD_OAUTH_CLIENT_SECRET: "ms", AIRWALLEX_PARTNER_WEBHOOK_SECRET: "wh" }))!;
    expect(full.tokenKey).toBe("k");
    expect(full.clients.airwallex).toEqual({ clientId: "a", clientSecret: "as", redirectUri: "https://cloud.test/v1/connect/airwallex/callback" });
    expect(full.clients.moneybird?.redirectUri).toBe("https://cloud.test/v1/connect/moneybird/callback");
    expect(full.airwallexWebhookSecret).toBe("wh");
  });
});

describe("e-mail and the inbox queue", () => {
  const mail = (to: string) => {
    const rejected: string[] = [];
    return { rejected, msg: { from: "s@x.test", to, raw: new TextEncoder().encode("Subject: hi\r\n\r\nbody"), rawSize: 22, setReject: (r: string) => { rejected.push(r); } } };
  };

  it("rejects mail when this deployment has no mail domain, and mail for a company that does not exist", async () => {
    const a = mail("acme@in.cloud.test");
    await worker.email(a.msg, bindings());
    expect(a.rejected).toEqual(["this address does not take mail"]);
    const b = mail("nobody@in.cloud.test");
    await worker.email(b.msg, bindings({ MAIL_DOMAIN: "in.cloud.test" }));
    expect(b.rejected).toEqual(["unknown address"]);
  });

  it("stores a company's mail, and without an engine leaves it queued for the runner instead of sending it on", async () => {
    const b = bindings({ MAIL_DOMAIN: "in.cloud.test" });
    const sent: unknown[] = [];
    b.INBOX_QUEUE = { send: async (m) => { sent.push(m); } };
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    b.DB.db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('t_acme01', 'acme', 'Acme', '2026-11-01T00:00:00Z')").run();
    const m = mail("acme@in.cloud.test");
    await worker.email(m.msg, b);
    expect(m.rejected).toEqual([]);
    expect(b.DB.db.prepare("SELECT tenant_id, status FROM inbound_mail").all()).toEqual([{ tenant_id: "t_acme01", status: "queued" }]);
    expect(sent).toEqual([]);
  });

  it("the queue's consumer acknowledges every message when no engine runs here, so none is retried in a loop", async () => {
    const acked: number[] = [];
    const retried: number[] = [];
    const messages = [0, 1, 2].map((i) => ({ body: { mailId: `m_${i}` }, attempts: 1, ack: () => { acked.push(i); }, retry: () => { retried.push(i); } }));
    await worker.queue({ messages }, bindings({ ENGINE_MODE: "test_money" }));
    expect(acked).toEqual([0, 1, 2]);
    expect(retried).toEqual([]);
  });
});

describe("the daily job", () => {
  it("purges, sweeps and writes the day's counters; a failing step is logged and the next still runs", async () => {
    const b = bindings();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => { errors.push(String(line)); });
    vi.spyOn(console, "log").mockImplementation((line: unknown) => { errors.push(String(line)); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    b.DB.db.prepare("INSERT INTO exports (tenant_id, id, status, created_at, expires_at, created_by, parts_json, bytes) VALUES ('t_acme01', 'x1', 'ready', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'u', '[]', 0)").run();
    // An owner recovery request that expired unapproved long ago (docs/privacy/retention.md: it goes a day after).
    b.DB.db.exec(RECOVERY_REQUESTS_SCHEMA);
    b.DB.db.prepare("INSERT INTO recovery_requests (id, tenant_id, owner_id, check_method, requested_by, requested_at, expires_at) VALUES ('rr_1', 't_acme01', 'u_1', 'video_call', 'ops-first', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')").run();
    await worker.scheduled({}, b);
    // A staged export past its day has lost its parts: the sweep ran.
    expect(b.DB.db.prepare("SELECT status FROM exports").get()).toEqual({ status: "expired" });
    // The expired recovery request is gone: the recovery prune ran.
    expect(b.DB.db.prepare("SELECT COUNT(*) AS n FROM recovery_requests").get()).toEqual({ n: 0 });
    // The counters' prune now fails (its table is gone); the job still finishes and says which step failed.
    b.DB.db.exec("DROP TABLE daily_counts; CREATE VIEW daily_counts AS SELECT 'x' AS day, 'y' AS metric, 1 AS n");
    await expect(worker.scheduled({}, b)).resolves.toBeUndefined();
    expect(errors.join("\n")).toMatch(/stats_prune_failed/);
  });
});

describe("sign-in providers", () => {
  it("lists only the OpenID providers whose every setting is there; Microsoft's tenant defaults to common", () => {
    expect(oidcOf(bindings())).toBeUndefined();
    expect(oidcOf(bindings({ OIDC_GOOGLE_CLIENT_ID: "g", OIDC_APPLE_CLIENT_ID: "a", OIDC_APPLE_TEAM_ID: "t", OIDC_APPLE_KEY_ID: "k" }))).toBeUndefined();
    const all = oidcOf(bindings({ OIDC_GOOGLE_CLIENT_ID: "g", OIDC_GOOGLE_CLIENT_SECRET: "gs", OIDC_MICROSOFT_CLIENT_ID: "m", OIDC_MICROSOFT_CLIENT_SECRET: "ms",
      OIDC_APPLE_CLIENT_ID: "a", OIDC_APPLE_TEAM_ID: "t", OIDC_APPLE_KEY_ID: "k", OIDC_APPLE_PRIVATE_KEY: "pem" }))!;
    expect(all.clients).toEqual({ google: { clientId: "g", clientSecret: "gs" }, microsoft: { clientId: "m", clientSecret: "ms", tenant: "common" }, apple: { clientId: "a", apple: { teamId: "t", keyId: "k", privateKeyPem: "pem" } } });
    expect(oidcOf(bindings({ OIDC_MICROSOFT_CLIENT_ID: "m", OIDC_MICROSOFT_CLIENT_SECRET: "ms", OIDC_MICROSOFT_TENANT: "contoso" }))!.clients.microsoft!.tenant).toBe("contoso");
    // Every provider of the connect list is there with both its id and secret.
    const conn = connectOf(bindings({ PURSER_OAUTH_CONNECT: "on", OAUTH_TOKEN_KEY: "k", XERO_OAUTH_CLIENT_ID: "x", XERO_OAUTH_CLIENT_SECRET: "xs", QUICKBOOKS_OAUTH_CLIENT_ID: "q", QUICKBOOKS_OAUTH_CLIENT_SECRET: "qs", EXACT_OAUTH_CLIENT_ID: "e", EXACT_OAUTH_CLIENT_SECRET: "es" }))!;
    expect(Object.keys(conn.clients).sort()).toEqual(["exact", "quickbooks", "xero"]);
  });
});

describe("the Worker with its bindings", () => {
  /** A Durable Object namespace for the engine that records every call and answers a fixed value. */
  const engineNs = (answer: (name: string) => unknown = () => null) => {
    const calls: string[] = [];
    return { calls, ns: { idFromName: (n: string) => n, get: (id: string) => ({ call: async (tenantId: string, name: string) => { calls.push(`${id}:${tenantId}:${name}`); return { ok: true, value: answer(name) }; } }) } };
  };

  it("serves pdf.js from the static assets when the binding is there", async () => {
    const assets = { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`, { headers: { "content-type": "text/javascript" } }) };
    const res = await worker.fetch(new Request("https://cloud.test/assets/pdfjs.mjs"), bindings({ ASSETS: assets as never }));
    expect(await res.text()).toBe("asset /assets/pdfjs.mjs");
  });

  it("the daily job with an engine and the hands-on demo: the try sweep, the autopilot and the inbox requeue run", async () => {
    const { ns } = engineNs();
    const b = bindings({ ENGINE: ns as never, ENGINE_MODE, HANDS_ON: "on", ENGINE_CLAUDE: "on", KIT11_ANTHROPIC_API_KEY: "test-not-a-key", TRY_BOTCHECK_SECRET: "bot", TURNSTILE_SECRET: "ts",
      ADMIN_KEYS: "", SECURITY_ALARMS: "auth.failure:3", APPROVAL_KEY_COOLING_HOURS: "48", AWX_READ: {} as never, AWX_CARDS: {} as never, AWX_GATEWAY: {} as never, DOCS: undefined });
    const sent: unknown[] = [];
    b.INBOX_QUEUE = { send: async (m) => { sent.push(m); } };
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => { errors.push(String(line)); });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    await expect(worker.scheduled({}, b)).resolves.toBeUndefined();
    expect(errors.filter((e) => /_failed/.test(e))).toEqual([]);
    // With AUTOPILOT off, the job still finishes.
    await expect(worker.scheduled({}, { ...b, AUTOPILOT: "off" })).resolves.toBeUndefined();
  });

  it("a try sweep that fails is logged, and the rest of the daily job still runs", async () => {
    const { ns } = engineNs();
    const b = bindings({ ENGINE: ns as never, ENGINE_MODE, HANDS_ON: "on" });
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    b.DB.db.exec("DROP TABLE try_companies; CREATE VIEW try_companies AS SELECT 1 AS nope");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => { errors.push(String(line)); });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await worker.scheduled({}, b).catch(() => undefined);
    expect(errors.join("\n")).toMatch(/try_sweep_failed/);
  });

  it("with an engine, e-mail is put on the queue; a queue that fails is logged and the mail stays stored", async () => {
    const { ns } = engineNs();
    const b = bindings({ MAIL_DOMAIN: "in.cloud.test", ENGINE: ns as never, ENGINE_MODE });
    const sent: unknown[] = [];
    b.INBOX_QUEUE = { send: async (m) => { sent.push(m); } };
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    b.DB.db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('t_acme01', 'acme', 'Acme', '2026-11-01T00:00:00Z')").run();
    const msg = (to: string, body = "body") => ({ from: "s@x.test", to, raw: new TextEncoder().encode(`Subject: hi\r\n\r\n${body}`), rawSize: 18 + body.length, setReject: () => undefined });
    await worker.email(msg("acme@in.cloud.test"), b);
    expect(sent).toHaveLength(1);
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => { warns.push(String(line)); });
    vi.spyOn(console, "log").mockImplementation((line: unknown) => { warns.push(String(line)); });
    b.INBOX_QUEUE = { send: async () => { throw new Error("queue unavailable"); } };
    await worker.email(msg("acme@in.cloud.test", "another body"), b);
    expect(warns.join("\n")).toMatch(/inbox_not_queued/);
    expect((b.DB.db.prepare("SELECT COUNT(*) AS n FROM inbound_mail").get() as { n: number }).n).toBe(2);
  });

  it("with an engine, the queue's consumer files each message, and one it cannot find is not retried forever", async () => {
    const { ns } = engineNs();
    const b = bindings({ ENGINE: ns as never, ENGINE_MODE });
    await worker.fetch(new Request("https://cloud.test/v1/health"), b);
    const acked: number[] = [], retried: number[] = [];
    const messages = [0, 1].map((i) => ({ body: { mailId: `m_missing_${i}`, to: "x@in.cloud.test", domain: "in.cloud.test" }, attempts: 1, ack: () => { acked.push(i); }, retry: () => { retried.push(i); } }));
    await worker.queue({ messages }, b);
    expect(acked.length + retried.length).toBe(2);
  });
});
