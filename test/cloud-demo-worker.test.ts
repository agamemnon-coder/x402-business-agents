// The public demo mode at the Worker's own entry point (cloud/src/worker.ts) and its parts (cloud/src/demo.ts): the
// deployment variables that switch it on, the entry's fetch, e-mail and scheduled handlers, and the in-memory limiter
// and memory the demo uses instead of database writes. With CLOUD_DB=d1 the entry runs on local D1 and R2 themselves.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { demoFromVars, MemoryLimiter, ResponseMemo } from "../cloud/src/demo.js";
import type { InboundEmail } from "../cloud/src/mail.js";
import { SCHEMA } from "../cloud/src/schema.js";
import { splitScript, type D1Like, type R2Like, type SqlValue } from "../cloud/src/store.js";
import worker, { type Bindings } from "../cloud/src/worker.js";
import { ADMIN_TOKEN } from "./support/cloud.js";

/** A D1 binding over better-sqlite3 (the parts the cloud uses), for the plain run. */
function sqliteD1(): D1Like {
  const raw = new Database(":memory:");
  const stmt = (sql: string, params: SqlValue[] = []) => ({
    bind: (...v: SqlValue[]) => stmt(sql, v),
    all: async <T>() => ({ results: raw.prepare(sql).all(...params) as T[] }),
    first: async <T>() => (raw.prepare(sql).get(...params) as T | undefined) ?? null,
    run: async () => ({ meta: { changes: raw.prepare(sql).run(...params).changes } }),
  });
  type Stmt = ReturnType<typeof stmt>;
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (s: unknown[]) => { for (const x of s as Stmt[]) await x.run(); },
    exec: async (script: string) => { raw.exec(script); },
  } as unknown as D1Like;
}

/** An R2 binding in memory, for the plain run. */
function memoryR2(): R2Like {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key, value) => { store.set(key, value); },
    get: async (key) => { const v = store.get(key); return v ? { arrayBuffer: async () => v.slice().buffer } : null; },
    head: async (key) => (store.has(key) ? {} : null),
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix }) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  };
}

/** The storage of one test: local D1 and R2 with CLOUD_DB=d1, else SQLite and memory. Every statement is recorded. */
async function storage(): Promise<{ DB: D1Like; DOCS: R2Like; statements: string[]; blobCalls: string[] }> {
  const db = globalThis.__cloudD1?.next() ?? sqliteD1();
  const r2 = globalThis.__cloudR2 ?? memoryR2();
  for (const part of splitScript(SCHEMA)) await db.prepare(part).run();
  const statements: string[] = [];
  const blobCalls: string[] = [];
  const DB: D1Like = { prepare: (sql) => { statements.push(sql); return db.prepare(sql); }, batch: (s) => db.batch(s), exec: (s) => { statements.push(s); return db.exec(s); } };
  const DOCS: R2Like = {
    put: (k, v, o) => { blobCalls.push(`put ${k}`); return r2.put(k, v, o); }, get: (k) => { blobCalls.push(`get ${k}`); return r2.get(k); },
    head: (k) => { blobCalls.push(`head ${k}`); return r2.head(k); }, delete: (k) => { blobCalls.push(`delete ${k}`); return r2.delete(k); },
    list: (o) => { blobCalls.push(`list ${o.prefix}`); return r2.list(o); },
  };
  return { DB, DOCS, statements, blobCalls };
}

const HOST = "https://demo.purser.test";
/** A seeded test company, as a seed loads it: straight into the database. */
async function seed(DB: D1Like, slug: string): Promise<void> {
  await DB.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, 'en', '2026-11-12T09:00:00.000Z')").bind(`t_${slug.replace(/-/g, "")}00demo`, slug, `${slug} (test company)`).run();
}
const mail = (to: string): InboundEmail & { rejected: string[] } => {
  const raw = new TextEncoder().encode(`From: supplier@example.test\r\nTo: ${to}\r\nSubject: invoice\r\n\r\nSee attached.\r\n`);
  const rejected: string[] = [];
  return { from: "supplier@example.test", to, raw, rawSize: raw.length, setReject: (reason: string) => { rejected.push(reason); }, rejected };
};
const writes = (statements: string[]) => statements.filter((s) => !/^\s*SELECT\b/i.test(s));

describe("the deployment variables", () => {
  it("switch demo mode on only with DEMO_PUBLIC=on and the demo companies' addresses", () => {
    expect(demoFromVars({})).toBeUndefined();
    expect(demoFromVars({ DEMO_SLUGS: "alder,birch" })).toBeUndefined();
    expect(demoFromVars({ DEMO_PUBLIC: "", DEMO_SLUGS: "alder" })).toBeUndefined();
    expect(demoFromVars({ DEMO_PUBLIC: "off", DEMO_SLUGS: "alder" })).toBeUndefined();
    const demo = demoFromVars({ DEMO_PUBLIC: "on", DEMO_SLUGS: " alder, birch\tcedar-3 ,alder " });
    expect(demo?.slugs).toEqual(["alder", "birch", "cedar-3"]);
  });

  it("refuse a value that is neither on nor off, a missing list and an address that is not one, loudly", () => {
    for (const v of ["true", "1", "ON", "yes", "on "]) expect(() => demoFromVars({ DEMO_PUBLIC: v, DEMO_SLUGS: "alder" }), v).toThrow(/DEMO_PUBLIC/);
    expect(() => demoFromVars({ DEMO_PUBLIC: "on" })).toThrow(/DEMO_SLUGS/);
    expect(() => demoFromVars({ DEMO_PUBLIC: "on", DEMO_SLUGS: " , " })).toThrow(/DEMO_SLUGS/);
    for (const bad of ["Alder", "a", "alder/../x", "al der!", "-alder", `a${"b".repeat(60)}`]) expect(() => demoFromVars({ DEMO_PUBLIC: "on", DEMO_SLUGS: `birch,${bad}` }), bad).toThrow(/DEMO_SLUGS/);
    expect(() => demoFromVars({ DEMO_PUBLIC: "on", DEMO_SLUGS: Array.from({ length: 13 }, (_, i) => `co-${i}`).join(",") })).toThrow(/DEMO_SLUGS/);
  });
});

describe("the Worker's entry in demo mode", () => {
  it("serves the demo with no secret at all, reads only, and never runs the schema script", async () => {
    const s = await storage();
    await seed(s.DB, "wk-alder");
    await seed(s.DB, "wk-private");
    s.statements.length = 0;
    const b = { DB: s.DB, DOCS: s.DOCS, RP_ID: "demo.purser.test", ORIGIN: HOST, DEMO_PUBLIC: "on", DEMO_SLUGS: "wk-alder" } as Bindings;
    const list = await worker.fetch(new Request(`${HOST}/v1/demo/companies`), b);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { companies: { slug: string }[] }).companies.map((x) => x.slug)).toEqual(["wk-alder"]);
    const me = await worker.fetch(new Request(`${HOST}/v1/demo/wk-alder/me`), b);
    expect(await me.json()).toMatchObject({ tenant: { slug: "wk-alder", language: "en" }, kind: "demo", inbox: null });
    expect((await worker.fetch(new Request(`${HOST}/v1/demo/wk-private/me`), b)).status).toBe(404);
    const refused = await worker.fetch(new Request(`${HOST}/v1/auth/challenge`, { method: "POST", body: JSON.stringify({ tenant: "wk-alder" }), headers: { "content-type": "application/json" } }), b);
    expect([refused.status, ((await refused.json()) as { code: string }).code]).toEqual([403, "demo_read_only"]);
    const page = await worker.fetch(new Request(`${HOST}/`), b);
    expect([page.status, page.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
    expect(s.statements.length).toBeGreaterThan(0);
    expect(writes(s.statements)).toEqual([]);
  });

  it("keeps the platform's routes off even when the platform token is configured and sent", async () => {
    const s = await storage();
    // The harness's platform token (a test value) and its hash, as a deployment would be configured with it.
    const token = ADMIN_TOKEN;
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const b = { DB: s.DB, DOCS: s.DOCS, RP_ID: "demo.purser.test", ORIGIN: HOST, SESSION_SECRET: "w".repeat(48), ADMIN_TOKEN_SHA256: sha, MAIL_DOMAIN: "in.purser.test", DEMO_PUBLIC: "on", DEMO_SLUGS: "wk-birch" } as Bindings;
    s.statements.length = 0;
    for (const [method, path] of [["GET", "/v1/admin/companies"], ["POST", "/v1/admin/tenants"]] as const) {
      const r = await worker.fetch(new Request(`${HOST}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ slug: "taken-over", name: "X", owner: { display_name: "X" } }) } : {}) }), b);
      expect([r.status, ((await r.json()) as { code: string }).code], path).toEqual([403, "demo_read_only"]);
    }
    expect(s.statements).toEqual([]);
  });

  it("takes no mail: a message is refused at the door, and nothing is stored", async () => {
    const s = await storage();
    await seed(s.DB, "wk-cedar");
    s.statements.length = 0;
    const b = { DB: s.DB, DOCS: s.DOCS, RP_ID: "demo.purser.test", ORIGIN: HOST, MAIL_DOMAIN: "in.purser.test", DEMO_PUBLIC: "on", DEMO_SLUGS: "wk-cedar" } as Bindings;
    const m = mail("wk-cedar@in.purser.test");
    await worker.email(m, b);
    expect(m.rejected).toHaveLength(1);
    expect(m.rejected[0]).toMatch(/demo/);
    expect(s.statements).toEqual([]);
    expect(s.blobCalls).toEqual([]);
  });

  it("runs no scheduled job: nothing is purged, swept or tidied", async () => {
    const s = await storage();
    s.statements.length = 0;
    await worker.scheduled({}, { DB: s.DB, DOCS: s.DOCS, RP_ID: "demo.purser.test", ORIGIN: HOST, DEMO_PUBLIC: "on", DEMO_SLUGS: "wk-dune" } as Bindings);
    expect(s.statements).toEqual([]);
    expect(s.blobCalls).toEqual([]);
  });

  it("fails loudly when the variables do not fit, before anything is served", async () => {
    const s = await storage();
    expect(() => worker.fetch(new Request(`${HOST}/`), { DB: s.DB, DOCS: s.DOCS, RP_ID: "x", ORIGIN: HOST, DEMO_PUBLIC: "on" } as Bindings)).toThrow(/DEMO_SLUGS/);
  });
});

describe("the Worker's entry with the variable unset", () => {
  const base = async () => { const s = await storage(); return { s, b: { DB: s.DB, DOCS: s.DOCS, RP_ID: "cloud.purser.test", ORIGIN: "https://cloud.purser.test", SESSION_SECRET: "w".repeat(48), ADMIN_TOKEN_SHA256: "", MAIL_DOMAIN: "in.purser.test" } as Bindings }; };

  it("still needs its session secret, has no demo routes, and asks for a sign-in", async () => {
    const { s, b } = await base();
    expect(() => worker.fetch(new Request("https://cloud.purser.test/"), { ...b, SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/);
    // DEMO_SLUGS alone switches nothing on.
    const withSlugs = { ...b, DEMO_SLUGS: "wk-alder" } as Bindings;
    await seed(s.DB, "wk-alder");
    for (const env of [b, withSlugs]) {
      const demo = await worker.fetch(new Request("https://cloud.purser.test/v1/demo/companies"), env);
      expect([demo.status, ((await demo.json()) as { error: string }).error]).toEqual([404, "no such route"]);
      expect((await worker.fetch(new Request("https://cloud.purser.test/v1/demo/wk-alder/me"), env)).status).toBe(404);
      expect((await worker.fetch(new Request("https://cloud.purser.test/v1/invoices"), env)).status).toBe(401);
      expect((await worker.fetch(new Request("https://cloud.purser.test/v1/health"), env)).status).toBe(200);
    }
  });

  it("still takes mail for a company and still runs its scheduled job", async () => {
    const { s, b } = await base();
    await seed(s.DB, "wk-elm");
    const m = mail("wk-elm@in.purser.test");
    await worker.email(m, b);
    expect(m.rejected).toEqual([]);
    const rows = await s.DB.prepare("SELECT status FROM inbound_mail").bind().all<{ status: string }>();
    expect(rows.results).toEqual([{ status: "queued" }]);
    expect(s.blobCalls.some((x) => x.startsWith("put t/"))).toBe(true);
    s.statements.length = 0;
    await worker.scheduled({}, b);
    expect(writes(s.statements).some((x) => /^DELETE FROM rate_hits/.test(x))).toBe(true);
  });
});

describe("the demo's in-memory limiter", () => {
  it("lets a key through up to its limit in a minute, then not, and starts again in the next minute", () => {
    const l = new MemoryLimiter();
    const t = Date.UTC(2026, 10, 12, 9, 0, 30);
    for (let i = 0; i < 5; i++) expect(l.take("ip:a", t + i, 5)).toBe(true);
    expect(l.take("ip:a", t + 10, 5)).toBe(false);
    expect(l.take("ip:b", t + 10, 5)).toBe(true);
    expect(l.retryAfterSec(t)).toBe(30);
    expect(l.take("ip:a", t + 30_000, 5)).toBe(true);
  });

  it("stays small under a flood of addresses: old minutes are dropped, and it never grows past its bound", () => {
    const l = new MemoryLimiter(60_000, 100);
    const t = Date.UTC(2026, 10, 12, 9, 0, 0);
    for (let i = 0; i < 1000; i++) l.take(`ip:${i}`, t + i, 5);
    expect(l.size).toBeLessThanOrEqual(100);
    for (let i = 0; i < 50; i++) l.take(`ip:next-${i}`, t + 120_000, 5);
    expect(l.size).toBeLessThanOrEqual(100);
    // An address that is over its limit stays over it while the flood goes on within the minute: the lightest go first.
    const m = new MemoryLimiter(60_000, 100);
    for (let i = 0; i < 4; i++) m.take("ip:heavy", t, 3);
    for (let i = 0; i < 500; i++) m.take(`ip:${i}`, t + 1, 5);
    expect(m.size).toBeLessThanOrEqual(100);
    expect(m.take("ip:heavy", t + 2, 3)).toBe(false);
  });
});

describe("the demo's memory of answers", () => {
  const entry = (n: number) => ({ status: 200, headers: [["content-type", "application/json"]] as [string, string][], body: new Uint8Array(n).fill(1) });

  it("returns what it was given until its time is up", () => {
    const m = new ResponseMemo();
    expect(m.set("a", entry(10), 1000)).toBe(true);
    expect(m.get("a", 999)?.body.length).toBe(10);
    expect(m.get("a", 1000)).toBeUndefined();
    expect(m.size).toBe(0);
    expect(m.get("b", 0)).toBeUndefined();
  });

  it("is bounded in entries and in bytes: the least recently used answer goes first, and a large one is not kept at all", () => {
    const m = new ResponseMemo({ entries: 3, bytes: 100, entryBytes: 60 });
    for (const k of ["a", "b", "c"]) m.set(k, entry(10), 1000);
    m.get("a", 0);
    m.set("d", entry(10), 1000);
    expect([m.get("a", 0), m.get("b", 0), m.get("c", 0), m.get("d", 0)].map((x) => !!x)).toEqual([true, false, true, true]);
    expect(m.set("big", entry(61), 1000)).toBe(false);
    expect(m.get("big", 0)).toBeUndefined();
    m.set("e", entry(60), 1000);
    m.set("f", entry(40), 1000);
    expect(m.bytes).toBeLessThanOrEqual(100);
    expect(m.size).toBeLessThanOrEqual(3);
    expect(m.get("f", 0)).toBeDefined();
    // The same key again replaces its answer and its size.
    m.set("f", entry(5), 1000);
    expect(m.get("f", 0)?.body.length).toBe(5);
    expect(m.bytes).toBeLessThanOrEqual(100);
  });
});
