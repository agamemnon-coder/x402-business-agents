// The platform admin as named, scoped, expiring keys (cloud/src/adminKeys.ts; ASVS 4.0.3 V2.5.4, V4.3.1, V1.2.4 in
// docs/security/asvs-l2.md): ADMIN_KEYS holds one entry per person (an id, the SHA-256 of the key, its scopes, its last
// day), never a key itself. A key does only what its scopes say, stops on its day, is compared in constant time, and
// every use and every refusal is in the security log under the key's id. The old single token (ADMIN_TOKEN_SHA256) still
// works while it is set, logged as "legacy", so the owner can move over without being locked out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminKeyEntry, newAdminKey, parseAdminKeys, ADMIN_KEY_MAX_DAYS } from "../cloud/src/adminKeys.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(() => { c = testCloud(); });
afterEach(() => { c.close(); vi.restoreAllMocks(); });

const NOW = new Date("2026-11-08T12:00:00Z");
const log = (kind: string) => c.env.sql.all<{ actor: string | null; route: string; status: number; detail_json: string }>("SELECT actor, route, status, detail_json FROM security_log WHERE kind = ? ORDER BY seq", [kind]);
const newCompany = (key: string, slug = "acme") => c.req("POST", "/v1/admin/tenants", { key, body: { slug, name: "Acme", owner: { display_name: "Owner" } } });

describe("a new admin key (npm run cloud:admin-key)", () => {
  it("is pak_<id>_<43 random characters>; its entry holds the id, the SHA-256 of the key, the scopes and the last day, never the key", async () => {
    const k = await newAdminKey({ id: "max-ops", scopes: ["tenants", "read"], days: 30, now: NOW });
    expect(k.key).toMatch(/^pak_max-ops_[A-Za-z0-9_-]{43}$/);
    expect(k.entry).toMatch(/^max-ops:[0-9a-f]{64}:tenants\+read:2026-12-08$/);
    expect(k.entry).not.toContain(k.key.slice(12));
    const again = await newAdminKey({ id: "max-ops", scopes: ["tenants"], days: 30, now: NOW });
    expect(again.key).not.toBe(k.key);
  });

  it("refuses an id that is not a plain name, an unknown scope, no scope, and a life of more than 90 days", async () => {
    for (const bad of [{ id: "Max!", scopes: ["read"], days: 30 }, { id: "max", scopes: ["root"], days: 30 }, { id: "max", scopes: [], days: 30 }, { id: "max", scopes: ["read"], days: ADMIN_KEY_MAX_DAYS + 1 }, { id: "max", scopes: ["read"], days: 0 }]) {
      await expect(newAdminKey({ ...bad, now: NOW } as Parameters<typeof newAdminKey>[0])).rejects.toThrow();
    }
  });

  it("parses entries separated by commas, spaces or lines, and skips a malformed one by its position (never its text)", () => {
    const one = adminKeyEntry({ id: "max", sha256: "a".repeat(64), scopes: ["read"], expires: "2027-01-01" });
    const two = adminKeyEntry({ id: "ops-2", sha256: "b".repeat(64), scopes: ["tenants", "recovery"], expires: "2027-02-01" });
    const { keys, skipped } = parseAdminKeys(`${one},\n  ${two} nonsense:zz`);
    expect(keys.map((k) => [k.id, [...k.scopes].join(" "), k.expires])).toEqual([["max", "read", "2027-01-01"], ["ops-2", "tenants recovery", "2027-02-01"]]);
    expect(skipped).toEqual([3]);
  });
});

describe("the platform routes with ADMIN_KEYS", () => {
  async function withKeys(...specs: { id: string; scopes: string[]; days?: number }[]) {
    const made = await Promise.all(specs.map((s) => newAdminKey({ id: s.id, scopes: s.scopes as never, days: s.days ?? 30, now: c.clock.now })));
    c.env.adminKeys = made.map((m) => m.entry).join("\n");
    return made.map((m) => m.key);
  }

  it("a key with the scope works, and its use is logged under its id", async () => {
    const [k] = await withKeys({ id: "max", scopes: ["tenants", "read"] });
    expect((await newCompany(k!)).status).toBe(201);
    expect((await c.req("GET", "/v1/admin/companies", { key: k! })).status).toBe(200);
    expect((await log("admin.action")).map((r) => [r.actor, r.route])).toEqual([["platform:max", "POST /v1/admin/tenants"], ["platform:max", "GET /v1/admin/companies"]]);
  });

  it("a key without the scope: 403 and access.denied (read cannot make a company or issue a recovery)", async () => {
    const [k] = await withKeys({ id: "viewer", scopes: ["read"] });
    expect((await newCompany(k!)).status).toBe(403);
    expect((await c.req("POST", "/v1/admin/tenants/t_xxxxxxxxxxxx/recovery", { key: k!, body: { owner_id: "u_x", check: "video_call" } })).status).toBe(403);
    expect((await c.req("POST", "/v1/try/admin", { key: k!, body: { op: "get" } })).status).toBe(403);
    expect((await log("access.denied")).map((r) => r.actor)).toEqual(["platform:viewer", "platform:viewer", "platform:viewer"]);
  });

  it("an expired key, a changed key and an unknown id: 401, logged as admin.auth_failure with the id the token names", async () => {
    const [k] = await withKeys({ id: "max", scopes: ["tenants"], days: 1 });
    const changed = `${k!.slice(0, -1)}${k!.endsWith("A") ? "B" : "A"}`;
    expect((await newCompany(changed)).status).toBe(401);
    expect((await newCompany(`pak_nobody_${"A".repeat(43)}`)).status).toBe(401);
    c.clock.now = new Date(c.clock.now.getTime() + 2 * 86_400_000);
    const expired = await newCompany(k!);
    expect(expired.status).toBe(401);
    expect(expired.json.error).toMatch(/expired/);
    const failures = await log("admin.auth_failure");
    expect(failures.map((r) => JSON.parse(r.detail_json).admin_key_id)).toEqual(["max", "nobody", "max"]);
    expect(JSON.stringify(failures)).not.toContain(k!.slice(9));
  });

  it("the legacy token still works while ADMIN_TOKEN_SHA256 is set, logged as legacy with a warning; removed, it does not", async () => {
    await withKeys({ id: "max", scopes: ["read"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await newCompany(ADMIN_TOKEN)).status).toBe(201);
    expect((await log("admin.action")).at(-1)?.actor).toBe("platform:legacy");
    expect(warn.mock.calls.map((x) => String(x[0])).some((l) => l.includes("admin.legacy_token_used"))).toBe(true);
    c.env.adminTokenSha256 = "";
    expect((await newCompany(ADMIN_TOKEN, "acme-2")).status).toBe(401);
  });

  it("wrong admin credentials never lock the right one out, but each is logged and a burst raises the alarm", async () => {
    c.env.securityAlarms = "auth_failures=3";
    for (let i = 0; i < 5; i++) expect((await newCompany(`pak_max_${"A".repeat(43)}`)).status).toBe(401);
    expect((await newCompany(ADMIN_TOKEN)).status).toBe(201);
    expect(await log("admin.auth_failure")).toHaveLength(5);
    expect((await log("alarm.raised")).map((r) => JSON.parse(r.detail_json).rule)).toEqual(["auth_failures"]);
  });
});
