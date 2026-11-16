// Security sweep 2, 15 Nov (docs/audit/security-sweep-2026-11-15.md, N1): each test failed before its fix.
import { describe, expect, it } from "vitest";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

describe("N1: public /try starts count per IPv6 /64 and per /48, an IPv4 address whole", async () => {
  const { addressPrefix, addressPrefix48 } = await import("../cloud/src/try/start.js");
  const tryCloud = () => testCloud({ engine: true, tryIt: { claude: false } });
  const start = (t: TestCloud, ip: string) => t.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": ip } });
  const set = async (t: TestCloud, key: string, value: string | number) => {
    const r = await t.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  };

  it("keys the address: an IPv6 /64 and /48, an IPv4 address whole (no /48)", () => {
    expect(addressPrefix("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(addressPrefix48("2001:db8:1:2::1")).toBe("2001:db8:1::/48");
    expect(addressPrefix48("2001:db8:1:ffff:1:2:3:4")).toBe("2001:db8:1::/48");
    expect(addressPrefix48("198.51.100.7")).toBeNull();
    expect(addressPrefix48("::ffff:198.51.100.7")).toBeNull();
  });

  it("stops rotating through the /64s of one /48 at the /48's limit; a real visitor's first start elsewhere still works", async () => {
    const t = tryCloud();
    try {
      await set(t, "starts", "on");
      await set(t, "starts_per_address_hour", 5);
      await set(t, "starts_per_48_hour", 3);
      // Each start from a fresh /64 of the same /48: the per-/64 limit never trips, the /48's does.
      for (let i = 1; i <= 3; i++) expect((await start(t, `2001:db8:aa:${i}::1`)).status, `start ${i}`).toBe(201);
      expect((await start(t, "2001:db8:aa:4::1")).status).toBe(429);
      // Another /48, and an IPv4 visitor: their first start works.
      expect((await start(t, "2001:db8:bb:1::1")).status).toBe(201);
      expect((await start(t, "198.51.100.7")).status).toBe(201);
      // An hour later the /48 may start again.
      t.clock.now = new Date(t.clock.now.getTime() + 3_600_000);
      expect((await start(t, "2001:db8:aa:5::1")).status).toBe(201);
      // Only the salted hash of the /48 is kept, never the address.
      const rows = await t.env.sql.all<{ bucket: string }>("SELECT bucket FROM rate_hits WHERE bucket LIKE 'trystart-48:%'");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.bucket).toMatch(/^trystart-48:[0-9a-f]{64}$/);
    } finally { t.close(); }
  });

  it("has a default of 20 and a ceiling of 200", async () => {
    const { NUMBERS } = await import("../cloud/src/try/switches.js");
    expect(NUMBERS.starts_per_48_hour).toEqual({ ceiling: 200, fallback: 20 });
  });
});

// Security review, 16 Nov: the event and jury pools had no per-address start limit, and the event token is in the stage
// QR, so one script could use up the room's starts. They now have their own, looser limit: a venue's Wi-Fi puts a whole
// room behind one address, so the public pool's 5 an hour would lock the audience out.
describe("event and jury starts count per address too, under their own looser limit", () => {
  it("one address stops at starts_per_address_hour_pooled; another address and the next hour still start", async () => {
    const t = testCloud({ engine: true, tryIt: { claude: false } });
    t.clock.now = new Date("2026-11-19T10:00:00Z");
    const admin = async (body: Record<string, unknown>) => { const r = await t.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body }); expect(r.status, JSON.stringify(r.json)).toBe(200); return r.json; };
    try {
      await admin({ op: "set", key: "starts", value: "on" });
      await admin({ op: "set", key: "starts_per_address_hour_pooled", value: 3 });
      const token = (await admin({ op: "token", pool: "event", until: "2026-11-19T18:00:00Z" })).token as string;
      const start = (ip: string) => t.req("POST", "/v1/try/start", { body: { token }, headers: { "cf-connecting-ip": ip } });
      for (let i = 1; i <= 3; i++) {
        const r = await start("198.51.100.20");
        expect(r.status, `start ${i}`).toBe(201);
        expect(r.json.pool).toBe("event");
      }
      expect((await start("198.51.100.20")).status).toBe(429);
      expect((await start("198.51.100.21")).status).toBe(201);
      t.clock.now = new Date(t.clock.now.getTime() + 3_600_000);
      expect((await start("198.51.100.20")).status).toBe(201);
      // The company still keeps no address (event and jury companies never did).
      const rows = await t.env.sql.all<{ addr: string | null }>("SELECT addr FROM try_companies WHERE pool = 'event'");
      expect(rows.every((r) => r.addr === null)).toBe(true);
    } finally {
      t.close();
    }
  });

  it("has a default of 60 and a ceiling of 500", async () => {
    const { NUMBERS } = await import("../cloud/src/try/switches.js");
    expect(NUMBERS.starts_per_address_hour_pooled).toEqual({ ceiling: 500, fallback: 60 });
  });
});
