// The hands-on deployment's lifecycle (cloud/src/try/): a visitor's test company, started through POST /v1/try/start,
// renewed with the visitor's token, held to the try-only route list, limited per address, pool and day in ways one
// script or one sleepy phone cannot turn into a lock-out of others, run by switches that fail closed, and swept after
// its 24 hours. The engine is the Node one (test money, a simulated bank). Nothing reaches the network.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { sessionToken } from "../cloud/src/auth.js";
import { TRY_ROUTES } from "../cloud/src/try/gate.js";
import { addressPrefix, tryScopes } from "../cloud/src/try/start.js";
import { on, readSwitches } from "../cloud/src/try/switches.js";
import { sweepTry } from "../cloud/src/try/sweep.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

const clouds: TestCloud[] = [];
function cloud(): TestCloud {
  const c = testCloud({ engine: true, tryIt: { claude: false } });
  clouds.push(c);
  return c;
}
afterAll(() => { for (const c of clouds) c.close(); });

const admin = (c: TestCloud, body: Record<string, unknown>, key: string | null = ADMIN_TOKEN) => c.req("POST", "/v1/try/admin", { key, body });
const set = async (c: TestCloud, key: string, value: string | number) => {
  const r = await admin(c, { op: "set", key, value });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
};
const start = (c: TestCloud, ip = "198.51.100.7", token?: string) => c.req("POST", "/v1/try/start", { body: token ? { token } : {}, headers: { "cf-connecting-ip": ip } });
interface Started { tenant: string; session: string; visitor_token: string; expires_at: string; session_expires_at: string; company: { name: string }; pool: string; mode: Record<string, string> }
async function started(c: TestCloud, ip?: string, token?: string): Promise<Started> {
  const r = await start(c, ip, token);
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as unknown as Started;
}
const rateRows = async (c: TestCloud, like: string) => (await c.env.sql.all<{ bucket: string; count: number }>("SELECT bucket, count FROM rate_hits WHERE bucket LIKE ?", [like]));

describe("off unless the deployment runs the hands-on demo", () => {
  it("answers 404 on every /v1/try route without tryIt", async () => {
    const c = testCloud({ engine: true });
    clouds.push(c);
    expect((await c.req("POST", "/v1/try/start", { body: {} })).status).toBe(404);
    expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: "t_try_0000000000000000", visitor_token: "x" } })).status).toBe(404);
    expect((await admin(c, { op: "get" })).status).toBe(404);
  });

  it("with no switch rows, everything is off: a start is refused with 503 paused", async () => {
    const c = cloud();
    const r = await start(c);
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: "paused", message: expect.stringMatching(/paused/) });
    const s = await readSwitches(c.env.sql);
    for (const k of ["starts", "claude", "agents", "rail_awx", "rail_metal", "own_upload"]) expect(on(s, k)).toBe(false);
    // And no company was made.
    expect((await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies"))!.n).toBe(0);
  });
});

describe("a visitor's company", () => {
  let c: TestCloud;
  let A: Started;
  let B: Started;
  beforeEach(async () => {
    c = cloud();
    await set(c, "starts", "on");
    A = await started(c);
    B = await started(c, "203.0.113.9");
  });

  it("starts with a session, a visitor token, its pool, its modes from the switches and 24 hours to live", async () => {
    expect(A).toMatchObject({ tenant: expect.stringMatching(/^t_try_[0-9a-f]{16}$/), session: expect.stringMatching(/^pcs\./), visitor_token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      company: { name: expect.stringMatching(/\(test\)$/) }, pool: "public", mode: { claude: "code", agents: "code", rail_awx: "off" } });
    expect(Date.parse(A.expires_at) - c.clock.now.getTime()).toBe(24 * 3_600_000);
    expect(Date.parse(A.session_expires_at) - c.clock.now.getTime()).toBe(15 * 60_000);
    // Only hashes are kept: neither the address nor the visitor token is in the row.
    const row = await c.env.sql.first<Record<string, string>>("SELECT * FROM try_companies WHERE tenant_id = ?", [A.tenant]);
    expect(row).toMatchObject({ pool: "public", addr: expect.stringMatching(/^[0-9a-f]{64}$/), visitor_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), wiped_at: null });
    expect(JSON.stringify(row)).not.toContain("198.51.100.7");
    expect(JSON.stringify(row)).not.toContain(A.visitor_token);
    // The engine is seeded: test money on the simulated bank.
    const e = await c.req("GET", "/v1/engine", { key: A.session });
    expect(e.status).toBe(200);
    expect(Number((e.json.balances as Record<string, string>).EUR)).toBeGreaterThan(0);
    expect(await tryScopes(c.env.sql, A.tenant)).toEqual({ pool: "public", addr: row!.addr });
  });

  it("says claude is live only when the switch is on and the deployment can call Claude", async () => {
    await set(c, "claude", "on");
    await set(c, "agents", "on");
    expect((await started(c, "192.0.2.1")).mode).toEqual({ claude: "code", agents: "code", rail_awx: "off" });
    const d = testCloud({ engine: true, tryIt: { claude: true } });
    clouds.push(d);
    await set(d, "starts", "on");
    await set(d, "claude", "on");
    expect((await started(d)).mode).toEqual({ claude: "live", agents: "code", rail_awx: "off" });
    await set(d, "agents", "on");
    await set(d, "rail_awx", "on");
    // The rail is "on" only once the deployment says the sandbox leg is wired (C9); the switch alone does not.
    expect((await started(d, "192.0.2.2")).mode).toEqual({ claude: "live", agents: "live", rail_awx: "off" });
  });

  it("works on the reads and the engine routes the page needs", async () => {
    for (const path of ["/v1/me", "/v1/invoices", "/v1/payments", "/v1/transactions", "/v1/ledger/entries", "/v1/engine", "/v1/engine/invoices", "/v1/engine/events", "/v1/engine/vault"]) {
      const r = await c.req("GET", path, { key: A.session });
      expect(r.status, `${path} ${JSON.stringify(r.json)}`).toBe(200);
    }
    expect((await c.req("GET", "/v1/me", { key: A.session })).json).toMatchObject({ tenant: { id: A.tenant, language: "en" }, role: "owner", user: { display_name: "You (visitor)" } });
  });

  it("is refused with 403 try_only on every route outside the list", async () => {
    const outside = [["GET", "/v1/keys"], ["POST", "/v1/keys"], ["GET", "/v1/users"], ["POST", "/v1/users"], ["GET", "/v1/export"], ["POST", "/v1/export/staged"], ["POST", "/v1/company"],
      ["GET", "/v1/webhook"], ["POST", "/v1/webhook"], ["POST", "/v1/close"], ["POST", "/v1/sync"], ["GET", "/v1/status"], ["GET", "/v1/reports/trial"], ["GET", "/v1/security/events"],
      ["POST", "/v1/engine/sync"], ["POST", "/v1/engine/documents"], ["GET", "/v1/vendors"], ["GET", "/v1/insights"], ["POST", "/v1/me/language"]] as const;
    for (const [m, p] of outside) {
      const r = await c.req(m, p, { key: A.session, ...(m === "POST" ? { body: {} } : {}) });
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.json.code, `${m} ${p}`).toBe("try_only");
    }
  });

  it("lists every allowed route one by one, each a real route of the table, with no wildcard", () => {
    const table = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    for (const r of TRY_ROUTES) {
      expect(r).not.toMatch(/\*/);
      expect(table.has(r), r).toBe(true);
    }
    expect(TRY_ROUTES).not.toContain("POST /v1/engine/sync");
    expect(TRY_ROUTES).not.toContain("POST /v1/engine/documents");
  });

  it("may upload a file of its own only while own_upload is on; the runner's push never", async () => {
    const doc = { filename: "x.pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.4 not really").toString("base64") };
    expect((await c.req("POST", "/v1/engine/documents", { key: A.session, body: doc })).json.code).toBe("try_only");
    await set(c, "own_upload", "on");
    expect((await c.req("POST", "/v1/engine/documents", { key: A.session, body: doc })).status).not.toBe(403);
    expect((await c.req("POST", "/v1/engine/sync", { key: A.session, body: {} })).json.code).toBe("try_only");
    await set(c, "own_upload", "off");
    expect((await c.req("POST", "/v1/engine/documents", { key: A.session, body: doc })).json.code).toBe("try_only");
  });

  it("cannot read another try company", async () => {
    // Each session reaches its own company's engine only: the other's invoice ids and events are not there.
    const mine = await c.req("GET", "/v1/me", { key: B.session });
    expect((mine.json.tenant as { id: string }).id).toBe(B.tenant);
    expect((await c.req("GET", "/v1/engine/proposals/P-0001", { key: B.session })).status).toBe(404);
  });

  it("cannot be signed in to, enrolled in or mailed: its address is not one the sign-in routes take", async () => {
    expect((await c.req("POST", "/v1/auth/challenge", { body: { tenant: A.tenant } })).status).toBe(400);
    const row = await c.env.sql.first<{ slug: string }>("SELECT slug FROM tenants WHERE id = ?", [A.tenant]);
    expect(row!.slug).toBe(A.tenant);
    expect((await c.req("POST", `/v1/users/${"u_x"}/enrolment`, { key: A.session })).json.code).toBe("try_only");
  });

  it("renews its session with the visitor token; a wrong token is a 401 counted against the company, not the address", async () => {
    const r = await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ session: expect.stringMatching(/^pcs\./), expires_at: expect.any(String), company_expires_at: A.expires_at });
    expect((await c.req("GET", "/v1/engine", { key: r.json.session as string })).status).toBe(200);
    const wrong = await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: B.visitor_token }, headers: { "cf-connecting-ip": "198.51.100.7" } });
    expect(wrong.status).toBe(401);
    expect(await rateRows(c, `trytoken-fail:${A.tenant}`)).toEqual([{ bucket: `trytoken-fail:${A.tenant}`, count: 1 }]);
    expect(await rateRows(c, "authfail:%")).toEqual([]);
  });

  it("limits renewals to 30 a minute per company, never per address", async () => {
    const renew = (s: Started) => c.req("POST", "/v1/try/session", { body: { tenant_id: s.tenant, visitor_token: s.visitor_token }, headers: { "cf-connecting-ip": "198.51.100.7" } });
    for (let i = 0; i < 30; i++) expect((await renew(A)).status).toBe(200);
    expect((await renew(A)).status).toBe(429);
    // Another company at the same address is answered.
    expect((await renew(B)).status).toBe(200);
  });

  it("answers 410 gone once its 24 hours are over, on the session route and on every route", async () => {
    c.clock.now = new Date(c.clock.now.getTime() + 24 * 3_600_000 + 1_000);
    const r = await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token } });
    expect(r.status).toBe(410);
    expect(r.json.code).toBe("gone");
    // A session signed just before the end still works on paper; the gate says gone.
    const late = await sessionToken(c.env.sessionSecret, { tenantId: A.tenant, userId: (await c.env.sql.first<{ id: string }>("SELECT id FROM users WHERE tenant_id = ?", [A.tenant]))!.id, role: "owner", gen: 0 }, c.clock.now);
    const g = await c.req("GET", "/v1/engine", { key: late });
    expect(g.status).toBe(410);
    expect(g.json.code).toBe("gone");
  });

  it("is swept after its 24 hours: its engine wiped, its rows and documents gone, its visitor token answering 410", async () => {
    // A document under the company's prefix, as its archive would have written.
    await c.env.blobs.put(`t/${A.tenant}/vault/x.pdf`, new Uint8Array([1, 2, 3]));
    const wiped: string[] = [];
    const engine = (id: string) => ({ wipe: async () => { wiped.push(id); await c.env.engine!(id).wipe(); } });
    expect((await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine, now: c.clock.now })).swept).toEqual([]);
    c.clock.now = new Date(c.clock.now.getTime() + 24 * 3_600_000 + 1_000);
    const out = await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine, now: c.clock.now });
    expect(out.swept.sort()).toEqual([A.tenant, B.tenant].sort());
    expect(wiped.sort()).toEqual([A.tenant, B.tenant].sort());
    expect(await c.env.blobs.list(`t/${A.tenant}/`)).toEqual([]);
    expect((await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?", [A.tenant]))!.n).toBe(0);
    expect((await c.env.sql.first<{ wiped_at: string | null }>("SELECT wiped_at FROM try_companies WHERE tenant_id = ?", [A.tenant]))!.wiped_at).toBe(c.clock.now.toISOString());
    expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token } })).status).toBe(410);
    // Done once: the next run finds nothing.
    expect((await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine, now: c.clock.now })).swept).toEqual([]);
  });

  it("sweeps at most 50 a run, and leaves a company whose engine will not wipe for the next run", async () => {
    c.clock.now = new Date(c.clock.now.getTime() + 25 * 3_600_000);
    const engine = (id: string) => ({ wipe: async () => { if (id === A.tenant) throw new Error("the object is away"); } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine, now: c.clock.now, batch: 50 });
    spy.mockRestore();
    expect(out.swept).toEqual([B.tenant]);
    expect((await c.env.sql.first<{ wiped_at: string | null }>("SELECT wiped_at FROM try_companies WHERE tenant_id = ?", [A.tenant]))!.wiped_at).toBeNull();
    expect((await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine: () => ({ wipe: async () => {} }), now: c.clock.now, batch: 1 })).swept).toEqual([A.tenant]);
  });
});

describe("limits that one script or one phone cannot turn into a lock-out of others", () => {
  it("refuses the sixth public start from one address in an hour, and the start past the day's limit", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    for (let i = 0; i < 5; i++) await started(c, "198.51.100.20");
    const sixth = await start(c, "198.51.100.20");
    expect(sixth.status).toBe(429);
    expect(sixth.json).toMatchObject({ code: "limit", message: expect.stringMatching(/hour/) });
    // Another address is answered; an hour later this one is too.
    await started(c, "198.51.100.21");
    c.clock.now = new Date(c.clock.now.getTime() + 3_600_000);
    await started(c, "198.51.100.20");
    await set(c, "starts_per_day_public", 8);
    await started(c, "198.51.100.22");
    const over = await start(c, "198.51.100.23");
    expect(over.status).toBe(429);
    expect(over.json.message).toMatch(/today/i);
  });

  it("keys an IPv6 address by its /64: two addresses in one /64 share one limit", async () => {
    expect(addressPrefix("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(addressPrefix("2001:0db8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(addressPrefix("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressPrefix("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(addressPrefix("198.51.100.7")).toBe("198.51.100.7");
    const c = cloud();
    await set(c, "starts", "on");
    await set(c, "starts_per_address_hour", 2);
    await started(c, "2001:db8:1:2::1");
    await started(c, "2001:db8:1:2:ffff:ffff:ffff:ffff");
    expect((await start(c, "2001:db8:1:2:1234::9")).status).toBe(429);
    await started(c, "2001:db8:1:3::1");
  });

  it("a jury token puts the company in the jury pool and skips the address limit, but not the jury's day limit; an expired token does not", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    await set(c, "starts_per_address_hour", 1);
    await set(c, "starts_per_day_jury", 3);
    const until = new Date(c.clock.now.getTime() + 3_600_000).toISOString();
    const t = await admin(c, { op: "token", pool: "jury", until });
    expect(t.status, JSON.stringify(t.json)).toBe(200);
    const token = t.json.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only its hash is stored.
    expect(JSON.stringify(await readSwitches(c.env.sql))).not.toContain(token);
    await started(c, "198.51.100.30");
    for (let i = 0; i < 3; i++) {
      const s = await started(c, "198.51.100.30", token);
      expect(s.pool).toBe("jury");
      expect(await tryScopes(c.env.sql, s.tenant)).toEqual({ pool: "jury", addr: null });
    }
    expect((await start(c, "198.51.100.31", token)).json).toMatchObject({ code: "limit" });
    // Past its end, the token is nothing: the start is public and meets the address limit.
    c.clock.now = new Date(Date.parse(until) + 1_000);
    expect((await started(c, "198.51.100.32", token)).pool).toBe("public");
    expect((await start(c, "198.51.100.32", token)).status).toBe(429);
  });

  it("an unknown token is a public start", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    expect((await started(c, "198.51.100.40", "not-a-token")).pool).toBe("public");
  });

  it("counts 30 expired-session 401s from one address against their company: a fresh session from that address is answered; 30 forged tokens are not", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const A = await started(c, "198.51.100.50");
    const B = await started(c, "198.51.100.51");
    c.clock.now = new Date(c.clock.now.getTime() + 16 * 60_000);
    const ip = { "cf-connecting-ip": "198.51.100.60" };
    for (let i = 0; i < 30; i++) expect((await c.req("GET", "/v1/engine/events", { key: A.session, headers: ip })).status).toBe(401);
    expect(await rateRows(c, "authfail:%")).toEqual([]);
    expect((await rateRows(c, `authfail-tenant:${A.tenant}`))[0]!.count).toBe(30);
    const fresh = await c.req("POST", "/v1/try/session", { body: { tenant_id: B.tenant, visitor_token: B.visitor_token }, headers: ip });
    expect(fresh.status).toBe(200);
    expect((await c.req("GET", "/v1/engine", { key: fresh.json.session as string, headers: ip })).status).toBe(200);

    // Forged tokens are counted per address, as for every caller: past the limit the address waits a minute.
    for (let i = 0; i < 30; i++) await c.req("GET", "/v1/engine", { key: `pcs.forged${i}.sig`, headers: ip });
    expect((await c.req("GET", "/v1/engine", { key: fresh.json.session as string, headers: ip })).status).toBe(429);
  });

  it("leaves the product's own callers as they were: a bad key counts against its address", async () => {
    const c = cloud();
    const T = await c.tenant("product-co");
    const ip = { "cf-connecting-ip": "198.51.100.70" };
    expect((await c.req("GET", "/v1/me", { key: `${T.key}x`, headers: ip })).status).toBe(401);
    expect(await rateRows(c, "authfail:198.51.100.70")).toEqual([{ bucket: "authfail:198.51.100.70", count: 1 }]);
    expect(await rateRows(c, "authfail-tenant:%")).toEqual([]);
    // An expired session of a product company counts against its address, as before.
    const old = T.session;
    c.clock.now = new Date(c.clock.now.getTime() + 16 * 60_000);
    expect((await c.req("GET", "/v1/me", { key: old, headers: ip })).status).toBe(401);
    expect((await rateRows(c, "authfail:198.51.100.70")).reduce((n, r) => n + r.count, 0)).toBe(2);
    expect(await tryScopes(c.env.sql, T.id)).toEqual({ pool: "smoke", addr: null });
    expect(await tryScopes(c.env.sql, "t_nobody")).toBeNull();
    // A product company is not held to the try list.
    expect((await c.req("GET", "/v1/keys", { key: T.key })).status).toBe(200);
  });

  it("writes no rate-bucket row for a try session's event polls", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const A = await started(c);
    const before = await c.env.sql.all("SELECT * FROM rate_hits ORDER BY bucket");
    for (let i = 0; i < 5; i++) expect((await c.req("GET", "/v1/engine/events", { key: A.session })).status).toBe(200);
    expect(await c.env.sql.all("SELECT * FROM rate_hits ORDER BY bucket")).toEqual(before);
    // Other routes still count.
    await c.req("GET", "/v1/engine", { key: A.session });
    expect((await rateRows(c, "session:%")).length).toBe(1);
  });
});

describe("the admin route", () => {
  it("gets the switches and today's counters", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    await started(c);
    const g = await admin(c, { op: "get" });
    expect(g.status).toBe(200);
    expect(g.json).toEqual({
      switches: { starts: "on" },
      today: { day: "2026-11-08", starts_by_pool: { public: 1, event: 0, jury: 0 }, open_companies: 1, spent_micros_by_pool: { public: 0, event: 0, jury: 0, smoke: 0 }, awx_calls: 0, metal_calls: 0 },
      all_time: { spent_micros: 0 },
    });
  });

  it("sets a switch within its ceiling and logs the change, never the token; refuses a value past it and an unknown key", async () => {
    const c = cloud();
    await set(c, "cap_all_micros", 78_000_000);
    const past = await admin(c, { op: "set", key: "cap_all_micros", value: 78_000_001 });
    expect(past.status).toBe(400);
    expect(past.json.message).toMatch(/ceiling/);
    for (const [key, value] of [["max_inflight", "21"], ["starts_per_day_jury", "501"], ["awx_calls_day", "1501"], ["starts", "yes"], ["cap_action_micros", "-1"], ["cap_action_micros", "1e5"]]) {
      expect((await admin(c, { op: "set", key, value })).status, `${key}=${value}`).toBe(400);
    }
    const unknown = await admin(c, { op: "set", key: "free_money", value: "on" });
    expect(unknown.status).toBe(400);
    expect(unknown.json.message).toMatch(/not a switch/);
    expect((await readSwitches(c.env.sql))).toEqual({ cap_all_micros: "78000000" });
    const log = await c.env.sql.all<{ key: string; old: string | null; new: string }>("SELECT key, old, new FROM try_admin_log ORDER BY id");
    expect(log).toEqual([{ key: "cap_all_micros", old: null, new: "78000000" }]);
    expect(JSON.stringify(log)).not.toContain(ADMIN_TOKEN);
  });

  it("is a plain 401 for a wrong token, and a flood of 100 wrong tokens never locks out the right one", async () => {
    const c = cloud();
    const ip = { "cf-connecting-ip": "198.51.100.80" };
    expect((await c.req("POST", "/v1/try/admin", { body: { op: "get" } })).status).toBe(401);
    for (let i = 0; i < 100; i++) expect((await c.req("POST", "/v1/try/admin", { key: `wrong-${i}`, body: { op: "get" }, headers: ip })).status).toBe(401);
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "get" }, headers: ip })).status).toBe(200);
  });

  it("refuses a token whose end is past, and keeps at most eight live ones", async () => {
    const c = cloud();
    expect((await admin(c, { op: "token", pool: "event", until: "2020-01-01T00:00:00Z" })).status).toBe(400);
    const until = new Date(c.clock.now.getTime() + 86_400_000).toISOString();
    for (let i = 0; i < 8; i++) expect((await admin(c, { op: "token", pool: "event", until })).status).toBe(200);
    expect((await admin(c, { op: "token", pool: "event", until })).status).toBe(400);
    const g = await admin(c, { op: "get" });
    expect((g.json.switches as { tokens: unknown[] }).tokens).toHaveLength(8);
    expect(JSON.stringify(g.json)).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("the logs", () => {
  const lines: string[] = [];
  beforeEach(() => {
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("hold no admin token, pool token, visitor token or session", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const t = (await admin(c, { op: "token", pool: "event", until: new Date(c.clock.now.getTime() + 3_600_000).toISOString() })).json.token as string;
    const A = await started(c, "198.51.100.90", t);
    const r = await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token } });
    await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: "wrong" } });
    await c.req("GET", "/v1/keys", { key: A.session });
    await admin(c, { op: "get" }, "wrong-admin-token");
    const all = lines.join("\n");
    expect(lines.length).toBeGreaterThan(5);
    for (const secret of [ADMIN_TOKEN, t, A.visitor_token, A.session, r.json.session as string, "198.51.100.90"]) expect(all).not.toContain(secret);
  });
});

describe("review round C4", () => {
  it("answers a dead session of a test company with 429 past a per-company limit, and it never blocks the company's renewals", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const A = await started(c, "198.51.100.110");
    const at = { "cf-connecting-ip": "198.51.100.111" };
    expect((await c.req("POST", "/v1/auth/logout", { key: A.session, headers: at })).status).toBe(200);
    const codes: number[] = [];
    for (let i = 0; i < 130; i++) codes.push((await c.req("GET", "/v1/engine/invoices", { key: A.session, headers: at })).status);
    expect(codes.slice(0, 120).every((s) => s === 401)).toBe(true);
    expect(codes.slice(120).every((s) => s === 429)).toBe(true);
    // Never against the address, and the visitor still renews.
    expect(await rateRows(c, "authfail:%")).toEqual([]);
    const fresh = await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token }, headers: at });
    expect(fresh.status).toBe(200);
    expect((await c.req("GET", "/v1/engine", { key: fresh.json.session as string, headers: at })).status).toBe(200);
  });

  it("does not let wrong visitor tokens use up a company's renewals; unknown companies count against the address", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const A = await started(c, "198.51.100.120");
    const at = { "cf-connecting-ip": "198.51.100.121" };
    for (let i = 0; i < 40; i++) expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: `wrong-${i}` }, headers: at })).status).toBe(401);
    expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token }, headers: at })).status).toBe(200);
    for (let i = 0; i < 25; i++) await c.req("POST", "/v1/try/session", { body: { tenant_id: `t_try_${String(i).padStart(16, "0")}`, visitor_token: "x" }, headers: at });
    expect((await rateRows(c, "authfail:198.51.100.121")).reduce((n, r) => n + r.count, 0)).toBeGreaterThanOrEqual(20);
    expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: "t_try_ffffffffffffffff", visitor_token: "x" }, headers: at })).status).toBe(429);
    // A known company at that address still renews.
    expect((await c.req("POST", "/v1/try/session", { body: { tenant_id: A.tenant, visitor_token: A.visitor_token }, headers: at })).status).toBe(200);
  });

  it("keeps every live token when two are made at once", async () => {
    const c = cloud();
    const until = new Date(c.clock.now.getTime() + 3_600_000).toISOString();
    const out = await Promise.all(Array.from({ length: 6 }, () => admin(c, { op: "token", pool: "event", until })));
    for (const r of out) expect(r.status).toBe(200);
    await set(c, "starts", "on");
    for (const r of out) expect((await started(c, "198.51.100.130", r.json.token as string)).pool).toBe("event");
  });

  it("deletes a day's salt within 48 hours of the day's start", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    await started(c);
    expect((await c.env.sql.all("SELECT day FROM try_salts")).length).toBe(1);
    // The salt of 2026-11-08 goes once 48 hours have passed since that day began.
    c.clock.now = new Date("2026-11-10T00:30:00Z");
    await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, now: c.clock.now });
    expect(await c.env.sql.all("SELECT day FROM try_salts")).toEqual([]);
  });

  it("does not let companies whose wipe fails hold up the others", async () => {
    const c = cloud();
    await set(c, "starts", "on");
    const A = await started(c, "198.51.100.140");
    c.clock.now = new Date(c.clock.now.getTime() + 60_000);
    const B = await started(c, "198.51.100.141");
    c.clock.now = new Date(c.clock.now.getTime() + 25 * 3_600_000);
    const engine = (id: string) => ({ wipe: async () => { if (id === A.tenant) throw new Error("away"); } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine, now: c.clock.now, batch: 1 })).swept).toEqual([]);
    expect((await sweepTry({ sql: c.env.sql, blobs: c.env.blobs, engine, now: c.clock.now, batch: 1 })).swept).toEqual([B.tenant]);
    spy.mockRestore();
  });
});
