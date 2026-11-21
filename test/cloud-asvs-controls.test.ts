// ASVS 4.0.3 Level 2 controls added on branch asvs2 (docs/security/asvs-l2.md):
// - V2.3.3: a key's renewal instructions before it expires: on every call it makes in its last 14 days (a header), and
//   to the company's owners 14 and 3 days before (a security event and the alert webhook), once each (cloud/src/keyExpiry.ts).
// - V12.1.3: a storage quota per company for uploaded files (cloud/src/storageQuota.ts).
// - V8.3.5: each read of personal or financial data is a data.access event in the security log: who, which route, from
//   which network; never the data (cloud/src/securityAudit.ts SENSITIVE_READS).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { KEY_RENEWAL_HEADER, warnExpiringKeys } from "../cloud/src/keyExpiry.js";
import { STORAGE_QUOTA_SCHEMA } from "../cloud/src/storageQuota.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

let c: TestCloud;
let t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => { c.close(); });

const DAY = 86_400_000;
const later = (days: number) => { c.clock.now = new Date(c.clock.now.getTime() + days * DAY); };
type Ev = { kind: string; actor: string; detail_json: string };
const ownerEvents = (kind: string) => c.env.sql.all<Ev>("SELECT kind, actor, detail_json FROM security_events WHERE tenant_id = ? AND kind = ? ORDER BY at", [t.id, kind]);

describe("renewal instructions before a key expires (V2.3.3)", () => {
  it("a key's calls carry no renewal header while it has more than 14 days left, and one with the date and what to do after", async () => {
    const fresh = await c.req("GET", "/v1/me", { key: t.key });
    expect(fresh.status).toBe(200);
    expect(fresh.res.headers.get(KEY_RENEWAL_HEADER)).toBeNull();
    // A session is not a key: nothing to renew.
    expect((await c.req("GET", "/v1/me", { key: t.session })).res.headers.get(KEY_RENEWAL_HEADER)).toBeNull();
    later(80); // the owner's key was made for 90 days
    const late = await c.req("GET", "/v1/me", { key: t.key });
    expect(late.status).toBe(200);
    const h = late.res.headers.get(KEY_RENEWAL_HEADER) ?? "";
    expect(h).toMatch(/expires=2027-02-0\dT/);
    expect(h).toMatch(/days=10/);
    expect(h).toMatch(/POST \/v1\/keys/);
  });

  it("the owners are told 14 and 3 days before, once each, with the key's id and never its secret", async () => {
    expect(await warnExpiringKeys(c.env.sql, c.clock.now)).toBe(0);
    later(76.5); // 13.5 days left
    expect(await warnExpiringKeys(c.env.sql, c.clock.now)).toBeGreaterThanOrEqual(1);
    expect(await warnExpiringKeys(c.env.sql, c.clock.now)).toBe(0); // the hourly job runs again: no second notice
    let ev = await ownerEvents("key.expiring");
    const ownersKey = t.key.split("_")[1]!;
    expect(ev.some((e) => JSON.parse(e.detail_json).key_id === ownersKey && JSON.parse(e.detail_json).days_left === 14)).toBe(true);
    later(11); // 2.5 days left
    expect(await warnExpiringKeys(c.env.sql, c.clock.now)).toBeGreaterThanOrEqual(1);
    ev = await ownerEvents("key.expiring");
    expect(ev.filter((e) => JSON.parse(e.detail_json).key_id === ownersKey).map((e) => JSON.parse(e.detail_json).days_left)).toEqual([14, 3]);
    expect(JSON.stringify(ev)).not.toContain(t.key.split("_").slice(2).join("_"));
    // The owners read it in the console's security events.
    const list = await c.req("GET", "/v1/security/events", { key: t.key });
    expect((list.json.items as { kind: string }[]).some((i) => i.kind === "key.expiring")).toBe(true);
  });

  it("a revoked or already expired key is not warned about", async () => {
    const k = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "short", scopes: ["read"], expires_in_days: 10 } })).json as { id: string };
    expect((await c.req("DELETE", `/v1/keys/${k.id}`, { key: t.key })).status).toBe(200);
    await warnExpiringKeys(c.env.sql, c.clock.now);
    expect((await ownerEvents("key.expiring")).some((e) => JSON.parse(e.detail_json).key_id === k.id)).toBe(false);
  });
});

describe("reads of personal and financial data are audited (V8.3.5)", () => {
  type Row = { kind: string; tenant_id: string | null; actor: string | null; ip: string; route: string | null; status: number | null; detail_json: string };
  const access = () => c.env.sql.all<Row>("SELECT kind, tenant_id, actor, ip, route, status, detail_json FROM security_log WHERE kind = 'data.access' ORDER BY seq");

  it("a list of suppliers, payments, invoices or people is a data.access event with who and from where", async () => {
    for (const p of ["/v1/vendors", "/v1/payments", "/v1/invoices", "/v1/users", "/v1/transactions", "/v1/ledger/entries"]) {
      expect((await c.req("GET", p, { key: t.key, headers: { "cf-connecting-ip": "203.0.113.9" } })).status, p).toBe(200);
    }
    const rows = await access();
    expect(rows.map((r) => r.route)).toEqual(["GET /v1/vendors", "GET /v1/payments", "GET /v1/invoices", "GET /v1/users", "GET /v1/transactions", "GET /v1/ledger/entries"]);
    for (const r of rows) expect(r).toMatchObject({ tenant_id: t.id, actor: t.key.split("_")[1], ip: "203.0.113.0/24", status: 200 });
  });

  it("a read that holds no personal data (who am I, the health check) is not, and a refused read is a refusal, not an access", async () => {
    await c.req("GET", "/v1/me", { key: t.key });
    await c.req("GET", "/v1/health");
    await c.req("GET", "/v1/vendors", { key: "pck_kAAAAAAAAAAAA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(await access()).toEqual([]);
  });
});

describe("the audited reads name real routes", () => {
  it("each data.access route is one the API serves", async () => {
    const { SECURITY_ROUTES } = await import("../cloud/src/securityAudit.js");
    const { ROUTES } = await import("../cloud/src/app.js");
    const served = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    const audited = Object.entries(SECURITY_ROUTES).filter(([, k]) => k === "data.access").map(([r]) => r);
    expect(audited.length).toBeGreaterThan(20);
    expect(audited.filter((r) => !served.has(r))).toEqual([]);
  });
});

describe("a storage quota per company for uploaded files (V12.1.3)", () => {
  const doc = (n: number, size = 1000) => {
    const bytes = Buffer.alloc(size, n);
    return { sha256: createHash("sha256").update(bytes).digest("hex"), filename: `doc-${n}.pdf`, mime: "application/pdf", base64: bytes.toString("base64") };
  };
  const push = (documents: ReturnType<typeof doc>[], key = t.key) => c.req("POST", "/v1/sync", { key, body: { documents } });

  it("the runner's pushed documents count toward it; past it the push is refused with 413 and stores nothing", async () => {
    c.env.storageQuota = { bytes: 10_000, files: 3 };
    expect((await push([doc(1), doc(2)])).status).toBe(200);
    expect((await push([doc(1), doc(2)])).status).toBe(200); // the same files again take no more room
    const full = await push([doc(3), doc(4)]);
    expect(full.status).toBe(413);
    expect(full.json.error).toMatch(/storage is full/);
    expect(await c.env.sql.all("SELECT sha256 FROM documents WHERE tenant_id = ?", [t.id])).toHaveLength(2);
    expect((await push([doc(3)])).status).toBe(200); // the third fits
    expect((await push([doc(5, 100)])).status).toBe(413); // a fourth file does not, however small
  });

  it("counts bytes as well as files, per company", async () => {
    c.env.storageQuota = { bytes: 2500, files: 100 };
    expect((await push([doc(1), doc(2)])).status).toBe(200);
    expect((await push([doc(3)])).status).toBe(413);
    const other = await c.tenant("other");
    expect((await push([doc(3)], other.key)).status).toBe(200);
  });

  it("the table the module makes is the D1 migration's", () => {
    const sql = readFileSync("cloud/migrations/0008_storage_quota.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(sql).toEqual([STORAGE_QUOTA_SCHEMA]);
  });
});

describe("the engine's uploads count toward the same quota (V12.1.3)", () => {
  it("a file over the quota is refused before the engine sees it; one the engine refuses gives its room back", async () => {
    const e = testCloud({ engine: true });
    try {
      const a = await e.tenant("alpha");
      e.env.storageQuota = { bytes: 100, files: 5 };
      const big = await e.req("POST", "/v1/engine/documents", { key: a.key, body: { filename: "big.pdf", mime: "application/pdf", base64: Buffer.alloc(1000, 0x25).toString("base64") } });
      expect(big.status).toBe(413);
      e.env.storageQuota = { bytes: 10_000, files: 5 };
      const words = await e.req("POST", "/v1/engine/documents", { key: a.key, body: { filename: "notes.txt", base64: Buffer.from("just some words").toString("base64") } });
      expect(words.status).toBe(400);
      expect(await e.env.sql.first("SELECT bytes, files FROM storage_use WHERE tenant_id = ?", [a.id])).toEqual({ bytes: 0, files: 0 });
    } finally { e.close(); }
  }, 60_000);
});
