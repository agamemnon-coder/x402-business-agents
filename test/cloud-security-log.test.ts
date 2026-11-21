// ASVS 4.0.3 V7.1.3, V7.1.4, V7.2.1, V7.2.2, V8.1.4, V11.1.8, V2.2.3, V2.5.5 (docs/security/asvs-l2.md): Purser Cloud's
// security event log (cloud/src/securityLog.ts, cloud/src/securityAudit.ts). Each failed or successful sign-in, each
// refusal, each limit hit, the platform admin's actions, key and passkey changes and tamper alarms are one row, with who
// (an id) and from where (the network, never the full address), and never a secret. The table is append-only in the
// database itself. Crossing a threshold raises one alarm, counted on /v1/health. Passkey and key changes are told to the
// company's owners.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_TOKEN, ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { cleanDetail, truncatedIp, alarmRules } from "../src/lib/securityEvents.js";
import { readFileSync } from "node:fs";
import { pruneSecurityLog, SECURITY_LOG_SCHEMA } from "../cloud/src/securityLog.js";

type Row = { seq: number; at: string; kind: string; tenant_id: string | null; actor: string | null; ip: string; route: string | null; status: number | null; detail_json: string };

let c: TestCloud;
let t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => { c.close(); vi.restoreAllMocks(); });

const rows = async (kind?: string) => c.env.sql.all<Row>(`SELECT * FROM security_log${kind ? " WHERE kind = ?" : ""} ORDER BY seq`, kind ? [kind] : []);
const from = (ip: string) => ({ "cf-connecting-ip": ip });

describe("the shared rules (src/lib/securityEvents.ts)", () => {
  it("cut an address to its network, IPv4 and IPv6, and say unknown for anything else", () => {
    expect(truncatedIp("203.0.113.77")).toBe("203.0.113.0/24");
    expect(truncatedIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:85a3::/48");
    expect(truncatedIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0::/48");
    for (const x of ["", null, "999.1.1.1", "evil<script>", "::g"]) expect(truncatedIp(x)).toBe("unknown");
  });

  it("keep a detail's short plain values only, and nothing that names or looks like a secret", () => {
    const d = cleanDetail({ route: "POST /v1/keys", token: "pck_kabc_xyz", api_key: "x", session: "y", key_id: "kAbCdEfGhIjKl", reason: "Bearer pcs.abcdefgh.ijk from max@example.com, IBAN NL91ABNA0417164300",
      nested: { a: 1 }, n: 3, ok: true, "Bad Name": "z" });
    expect(d).toEqual({ route: "POST /v1/keys", key_id: "kAbCdEfGhIjKl", reason: "[redacted] from [redacted], IBAN [redacted]", n: 3, ok: true });
  });

  it("read thresholds from a setting, keeping the defaults for anything else", () => {
    const r = alarmRules("auth_failures=3, window=60, nonsense=5, rate_limited=-1");
    expect(r.find((x) => x.name === "auth_failures")).toMatchObject({ threshold: 3, windowSec: 60 });
    expect(r.find((x) => x.name === "rate_limited")).toMatchObject({ threshold: 200, windowSec: 60 });
  });
});

describe("authentication decisions (V7.2.1)", () => {
  it("a refused API key: auth.failure with its key id, the network and the route; never the key", async () => {
    const forged = `${t.key.slice(0, -4)}AAAA`;
    expect((await c.req("GET", "/v1/me", { key: forged, headers: from("203.0.113.77") })).status).toBe(401);
    const [r] = await rows("auth.failure");
    expect(r).toMatchObject({ ip: "203.0.113.0/24", route: "GET /v1/me", status: 401 });
    expect(JSON.parse(r!.detail_json)).toMatchObject({ credential_kind: "api_key", key_id: forged.split("_")[1], reason: "unknown API key" });
    // The secret is base64url and may itself hold "_" (or start with it): everything after the key id.
    expect(JSON.stringify(await rows())).not.toContain(forged.split("_").slice(2).join("_"));
  });

  it("a passkey sign-in that verifies: passkey.success with the person and the company; one that does not: passkey.failure", async () => {
    const { pk, credential_id } = t.ownerPasskey;
    const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
    const ch = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string; challenge: string };
    const a = pk.assert("0x00", { challenge: ch.challenge, origin: ORIGIN, rpId: "cloud.test" });
    const ok = await c.req("POST", "/v1/auth/login", { headers: from("198.51.100.4"), body: { tenant: "acme", challenge_id: ch.challenge_id, credential_id, assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
    expect(ok.status).toBe(200);
    const again = await c.req("POST", "/v1/auth/login", { headers: from("198.51.100.4"), body: { tenant: "acme", challenge_id: ch.challenge_id, credential_id, assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
    expect(again.status).toBe(401);
    const success = (await rows("passkey.success")).at(-1)!;
    expect(success).toMatchObject({ tenant_id: t.id, actor: t.owner, ip: "198.51.100.0/24", route: "POST /v1/auth/login", status: 200 });
    expect((await rows("passkey.failure")).at(-1)).toMatchObject({ tenant_id: t.id, route: "POST /v1/auth/login", status: 401 });
    expect(JSON.stringify(await rows())).not.toContain(ok.json.session as string);
  });
});

describe("access control decisions (V7.2.2)", () => {
  it("a key that may not: access.denied with the key's id and why", async () => {
    const read = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "reader", scopes: ["read"] } })).json as { id: string; api_key: string };
    expect((await c.req("POST", "/v1/keys", { key: read.api_key, body: { name: "x", scopes: ["admin"] } })).status).toBe(403);
    const [r] = await rows("access.denied");
    expect(r).toMatchObject({ tenant_id: t.id, actor: read.id, route: "POST /v1/keys", status: 403 });
    expect(JSON.parse(r!.detail_json).reason).toMatch(/may not manage this company/);
  });

  it("a request turned away by a limit: rate.limited", async () => {
    c.env.rate = { perMinute: 2, signInPerMinute: 100, failedAuthPerMinute: 100 };
    for (let i = 0; i < 3; i++) await c.req("GET", "/v1/me", { key: t.key });
    expect(await rows("rate.limited")).toHaveLength(1);
  });
});

describe("the platform admin, keys and passkeys (V7.1.3; V2.2.3, V2.5.5)", () => {
  it("the admin's actions and the admin's refused credentials", async () => {
    expect((await c.req("GET", "/v1/admin/companies", { key: ADMIN_TOKEN })).status).toBe(200);
    expect((await c.req("GET", "/v1/admin/companies", { key: "not-the-admin-token" })).status).toBe(401);
    expect((await rows("admin.action")).at(-1)).toMatchObject({ actor: "platform:legacy", route: "GET /v1/admin/companies", status: 200 });
    expect((await rows("admin.auth_failure")).at(-1)).toMatchObject({ route: "GET /v1/admin/companies", status: 401 });
    const log = await c.req("GET", "/v1/admin/security-log?kind=admin.action", { key: ADMIN_TOKEN });
    expect(log.status).toBe(200);
    expect((log.json.items as { kind: string }[]).every((x) => x.kind === "admin.action")).toBe(true);
    expect((await c.req("GET", "/v1/admin/security-log", { key: t.key })).status).toBe(401);
  });

  it("a key made and revoked: logged, a security event the owners read, and an event to the company's webhook", async () => {
    await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://hooks.example/purser" } });
    const sent: { type: string; data: Record<string, string> }[] = [];
    c.env.outbound = async (_url, init) => { sent.push(JSON.parse(String(init.body)) as { type: string; data: Record<string, string> }); return new Response("", { status: 200 }); };
    c.env.retryDelayMs = 0;
    const k = (await c.req("POST", "/v1/keys", { key: t.session, body: { name: "ci", scopes: ["read"] } })).json as { id: string; api_key: string };
    expect((await c.req("DELETE", `/v1/keys/${k.id}`, { key: t.session })).status).toBe(200);
    expect((await rows("key.created")).at(-1)).toMatchObject({ tenant_id: t.id, actor: t.owner, route: "POST /v1/keys" });
    expect((await rows("key.revoked")).at(-1)).toMatchObject({ tenant_id: t.id, actor: t.owner, route: "DELETE /v1/keys/{id}" });
    const events = (await c.req("GET", "/v1/security/events", { key: t.key })).json.items as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["key.created", "key.revoked"]));
    expect(sent.map((s) => s.type)).toEqual(["security.key.created", "security.key.revoked"]);
    expect(JSON.stringify(sent)).not.toContain(k.api_key);
  });

  it("a passkey enrolled (the owner's first, in the test company's setup) is told to the owners too", async () => {
    expect((await rows("passkey.enrolled")).at(-1)).toMatchObject({ tenant_id: t.id, actor: t.owner, route: "POST /v1/auth/enrol", status: 201 });
    const events = (await c.req("GET", "/v1/security/events", { key: t.key })).json.items as { kind: string }[];
    expect(events.map((e) => e.kind)).toContain("passkey.enrolled");
  });
});

describe("the request line carries who and from where (V7.1.4)", () => {
  it("the caller's id and the network, never the token", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => { lines.push(String(l)); });
    await c.req("GET", "/v1/me", { key: t.key, headers: from("203.0.113.9") });
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "request")!;
    expect(line).toMatchObject({ route: "/v1/me", status: 200, tenant: t.id, caller: t.key.split("_")[1], ip: "203.0.113.0/24" });
    expect(lines.join("\n")).not.toContain(t.key);
  });
});

describe("append-only (V7.3.3-style integrity of the log itself)", () => {
  it("refuses an update, and the deletion of a row younger than a year; the daily prune removes only older rows", async () => {
    await c.req("GET", "/v1/me", { key: "pck_kAAAAAAAAAAAA_" + "A".repeat(43) });
    const [r] = await rows("auth.failure");
    await expect(c.env.sql.run("UPDATE security_log SET kind = 'auth.success' WHERE seq = ?", [r!.seq])).rejects.toThrow(/append-only/);
    await expect(c.env.sql.run("DELETE FROM security_log WHERE seq = ?", [r!.seq])).rejects.toThrow(/kept a year/);
    await c.env.sql.run("INSERT INTO security_log (at, kind, ip, detail_json) VALUES ('2020-01-01T00:00:00.000Z', 'auth.failure', 'unknown', '{}')");
    expect(await pruneSecurityLog(c.env.sql, new Date())).toBe(1);
    expect((await rows("auth.failure")).length).toBe(1);
  });
});

describe("the D1 migration", () => {
  it("is the table, index and triggers the module makes, word for word", () => {
    const statements = readFileSync("cloud/migrations/0006_security_log.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(statements).toEqual(SECURITY_LOG_SCHEMA);
  });
});

describe("alarms (V8.1.4, V11.1.8)", () => {
  it("raise once per window when failures cross the threshold, and show on /v1/health as a count", async () => {
    c.env.securityAlarms = "auth_failures=3";
    expect((await c.req("GET", "/v1/health")).json.security).toEqual({ alarms_24h: 0, rules: {} });
    for (let i = 0; i < 5; i++) await c.req("GET", "/v1/me", { key: "pck_kAAAAAAAAAAAA_" + "A".repeat(43), headers: from(`192.0.2.${i}`) });
    const alarms = await rows("alarm.raised");
    expect(alarms).toHaveLength(1);
    expect(JSON.parse(alarms[0]!.detail_json)).toMatchObject({ rule: "auth_failures", threshold: 3 });
    const h = await c.req("GET", "/v1/health");
    expect(h.status).toBe(200);
    expect(h.json.security).toEqual({ alarms_24h: 1, rules: { auth_failures: 1 } });
    expect(JSON.stringify(h.json)).not.toMatch(/acme|192\.0\.2/);
  });

  it("a runner newly reporting tampered terms is a tamper alarm, raised at once (threshold 1)", async () => {
    const sk = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "runner", scopes: ["sync"] } })).json.api_key as string;
    const report = () => c.req("POST", "/v1/health/report", { key: sk, body: { at: c.clock.now.toISOString(), status: "alert", alerts: [{ code: "passkey_terms_tampered", severity: "critical" }] } });
    expect((await report()).status).toBe(200);
    expect((await report()).status).toBe(200);
    expect(await rows("tamper.alarm")).toHaveLength(1);
    expect((await rows("alarm.raised")).map((r) => JSON.parse(r.detail_json).rule)).toEqual(["tamper"]);
  });
});
