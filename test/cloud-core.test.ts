// Purser Cloud: the schema, creating a company, API keys and their scopes, rate limits, and the OpenAPI document held
// to the route table. The Worker's own handler runs here over better-sqlite3 (test/support/cloud.ts).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { SCHEMA } from "../cloud/src/schema.js";
import { splitScript } from "../cloud/src/store.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(() => { c = testCloud(); });
afterEach(() => c.close());

describe("the schema", () => {
  it("is the D1 migration word for word, and splits into statements D1 can run one by one", () => {
    expect(SCHEMA).toBe(readFileSync("cloud/migrations/0001_init.sql", "utf8"));
    const parts = splitScript(SCHEMA);
    expect(parts.length).toBeGreaterThan(15);
    expect(parts.every((p) => /^CREATE (TABLE|INDEX)/.test(p))).toBe(true);
  });
});

describe("a company", () => {
  it("is created only with the platform admin token, and gets an owner and one key, shown once", async () => {
    expect((await c.req("POST", "/v1/admin/tenants", { body: { slug: "acme", name: "Acme", owner: { display_name: "Owner" } } })).status).toBe(401);
    expect((await c.req("POST", "/v1/admin/tenants", { key: "wrong", body: { slug: "acme", name: "Acme", owner: { display_name: "Owner" } } })).status).toBe(401);
    const t = await c.tenant("acme");
    expect(t.key).toMatch(/^pck_k[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    const stored = await c.env.sql.all<{ secret_sha256: string }>("SELECT secret_sha256 FROM api_keys");
    // The secret is everything after the second underscore (it may itself contain "_": the test was flaky).
    expect(JSON.stringify(stored)).not.toContain(t.key.split("_").slice(2).join("_"));
    expect((await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug: "acme", name: "Again", owner: { display_name: "O" } } })).status).toBe(409);
    const me = await c.req("GET", "/v1/me", { key: t.key });
    expect(me.json).toMatchObject({ tenant: { id: t.id, slug: "acme" }, kind: "key", scopes: ["read", "sync", "admin"] });
  });
});

describe("API keys", () => {
  it("refuse an unknown, malformed or revoked key, and a scope the key does not have", async () => {
    const t = await c.tenant("acme");
    expect((await c.req("GET", "/v1/invoices")).status).toBe(401);
    expect((await c.req("GET", "/v1/invoices", { key: "pck_kAAAAAAAAAAAA_" + "a".repeat(43) })).status).toBe(401);
    expect((await c.req("GET", "/v1/invoices", { key: t.key.slice(0, -1) + (t.key.endsWith("a") ? "b" : "a") })).status).toBe(401);
    const made = await c.req("POST", "/v1/keys", { key: t.key, body: { name: "accountant export", scopes: ["read"] } });
    expect(made.status).toBe(201);
    const readOnly = made.json.api_key as string;
    expect((await c.req("GET", "/v1/invoices", { key: readOnly })).status).toBe(200);
    expect((await c.req("POST", "/v1/sync", { key: readOnly, body: {} })).status).toBe(403);
    expect((await c.req("GET", "/v1/keys", { key: readOnly })).status).toBe(403);
    const list = await c.req("GET", "/v1/keys", { key: t.key });
    expect(JSON.stringify(list.json)).not.toMatch(/secret_sha256/);
    const used = (list.json.items as { id: string; last_used_at: string | null }[]).find((k) => k.id === made.json.id);
    expect(used?.last_used_at).toBeTruthy();
    expect((await c.req("DELETE", `/v1/keys/${made.json.id as string}`, { key: t.key })).status).toBe(200);
    expect((await c.req("GET", "/v1/invoices", { key: readOnly })).status).toBe(401);
  });

  it("are rate limited per key", async () => {
    const limited = testCloud({ rate: { perMinute: 3, signInPerMinute: 2 } });
    try {
      const t = await limited.tenant("acme");
      for (let i = 0; i < 3; i++) expect((await limited.req("GET", "/v1/invoices", { key: t.key })).status).toBe(200);
      expect((await limited.req("GET", "/v1/invoices", { key: t.key })).status).toBe(429);
      limited.clock.now = new Date(limited.clock.now.getTime() + 61_000);
      expect((await limited.req("GET", "/v1/invoices", { key: t.key })).status).toBe(200);
      for (let i = 0; i < 2; i++) await limited.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } });
      expect((await limited.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).status).toBe(429);
    } finally { limited.close(); }
  });
});

describe("the routes", () => {
  it("answer 404 for an unknown path, 405 for a wrong method, 400 for a body that does not fit, and never leak an internal error", async () => {
    const t = await c.tenant("acme");
    expect((await c.req("GET", "/v1/nothing", { key: t.key })).status).toBe(404);
    expect((await c.req("PUT", "/v1/invoices", { key: t.key })).status).toBe(405);
    expect((await c.req("POST", "/v1/keys", { key: t.key, raw: "{not json" })).status).toBe(400);
    expect((await c.req("POST", "/v1/keys", { key: t.key, body: { name: "x", scopes: ["root"] } })).status).toBe(400);
    expect((await c.req("GET", "/v1/reports/vat?quarter=2026Q9", { key: t.key })).status).toBe(400);
    expect((await c.req("GET", "/v1/reports/secret", { key: t.key })).status).toBe(400);
  });

  it("are described by the OpenAPI document, route for route, each with what it needs", async () => {
    const doc = (await c.req("GET", "/v1/openapi.json")).json as { openapi: string; paths: Record<string, Record<string, { "x-purser-needs": string }>> };
    expect(doc.openapi).toBe("3.1.0");
    const listed = Object.entries(doc.paths).flatMap(([p, ms]) => Object.entries(ms).map(([m, o]) => `${m.toUpperCase()} ${p} ${o["x-purser-needs"]}`)).sort();
    expect(listed).toEqual(ROUTES.map((r) => `${r.method} ${r.path} ${r.need}`).sort());
    // Every documented route exists: a call reaches a handler (never "no such route").
    const t = await c.tenant("acme");
    for (const r of ROUTES) {
      const res = await c.req(r.method, r.path.replace(/\{\w+\}/g, "x"), { key: t.key });
      expect(res.json.error ?? "", `${r.method} ${r.path}`).not.toBe("no such route");
    }
  });
});

describe("the tenant data layer", () => {
  it("cannot be built without a well-formed tenant, names only known columns, and deletes only what may be deleted", async () => {
    expect(() => new TenantDb(c.env.sql, "")).toThrow();
    expect(() => new TenantDb(c.env.sql, "t_abc' OR 1=1 --")).toThrow();
    const db = new TenantDb(c.env.sql, "t_abcdefgh");
    await expect(db.select("invoices", { "1=1 OR id": "x" })).rejects.toThrow(/no column/);
    expect(() => db.delete("ledger_entries", { entry_id: 1 })).toThrow(/never deleted/);
    expect(() => db.delete("audit_rows", { seq: 1 })).toThrow(/never deleted/);
    expect(db.insert("invoices", { id: "x" }).sql).toMatch(/^INSERT INTO invoices \(tenant_id, id\)/);
    expect(db.update("invoices", { id: "x" }, { status: "paid" }).sql).toMatch(/WHERE tenant_id = \? AND id = \?$/);
  });
});
