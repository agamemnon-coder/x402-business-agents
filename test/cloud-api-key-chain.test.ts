// Who a request to Purser Cloud is (cloud/src/auth.ts callerOf), refusal by refusal, with the reason each one gives: a
// key made by a key never holds more scope or lives longer than its maker and dies with it, with its person, with the
// company; a row that claims "approve" never approves; a session ends with a changed role, a sign-out, an ended session
// or a closed company; a connector's access token only for a live connector key. need() says why a caller may not.
// The routes that use these are in test/cloud-route-auth.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessToken, callerOf, descendantKeys, endSessions, inviteInfo, need, newApiKey, sessionToken, type Caller } from "../cloud/src/auth.js";
import { endSession } from "../cloud/src/sessions.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud, t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

const who = (token: string) => callerOf(c.env.sql, c.env.sessionSecret, `Bearer ${token}`, c.clock.now);
const refusal = async (token: string) => who(token).then(() => "accepted", (e: { status: number; message: string }) => `${e.status} ${e.message}`);
const db = () => new TenantDb(c.env.sql, t.id);
const days = (n: number) => new Date(c.clock.now.getTime() + n * 86_400_000);

describe("a key made by a key", () => {
  it("never holds more scope than its maker, never outlives it, and is recorded under it", async () => {
    const owner = await who(t.key);
    const reader = await newApiKey(db(), { name: "reader", scopes: ["read"], caller: owner, expiresInDays: 10, now: c.clock.now });
    const readerCaller = await who(reader.key);
    await expect(newApiKey(db(), { name: "more", scopes: ["read", "admin"], caller: readerCaller, now: c.clock.now }))
      .rejects.toMatchObject({ status: 403, message: "a key cannot make a key with more scope than its own (admin)" });
    await expect(newApiKey(db(), { name: "none", scopes: [], caller: readerCaller, now: c.clock.now })).rejects.toMatchObject({ status: 403, message: "scopes must be some of read, sync, admin, propose" });
    await expect(newApiKey(db(), { name: "approve", scopes: ["approve" as never], caller: owner, now: c.clock.now })).rejects.toMatchObject({ status: 403 });
    // Asked for a year: it gets its maker's ten days.
    const child = await newApiKey(db(), { name: "child", scopes: ["read"], caller: readerCaller, expiresInDays: 365, now: c.clock.now });
    expect(child.expires_at).toBe(reader.expires_at);
    const grandchild = await newApiKey(db(), { name: "grandchild", scopes: ["read"], caller: await who(child.key), expiresInDays: 1, now: c.clock.now });
    expect(grandchild.expires_at).toBe(days(1).toISOString());
    expect((await descendantKeys(db(), readerCaller.principal)).sort()).toEqual([child.id, grandchild.id].sort());
  });

  it("dies with any key up its chain, revoked or expired", async () => {
    const owner = await who(t.key);
    const parent = await newApiKey(db(), { name: "parent", scopes: ["read"], caller: owner, expiresInDays: 30, now: c.clock.now });
    const child = await newApiKey(db(), { name: "child", scopes: ["read"], caller: await who(parent.key), expiresInDays: 30, now: c.clock.now });
    expect(await refusal(child.key)).toBe("accepted");
    await c.env.sql.run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", [c.clock.now.toISOString(), parent.id]);
    expect(await refusal(child.key)).toBe("401 the key that made this API key was revoked or expired; it no longer works");
    await c.env.sql.run("UPDATE api_keys SET revoked_at = NULL, expires_at = ? WHERE id = ?", [c.clock.now.toISOString(), parent.id]);
    expect(await refusal(child.key)).toBe("401 the key that made this API key was revoked or expired; it no longer works");
    expect(await refusal(parent.key)).toBe("401 this API key expired; make a new one");
  });

  it("dies with its person and with the company", async () => {
    const k = await newApiKey(db(), { name: "k", scopes: ["read"], caller: await who(t.key), now: c.clock.now });
    await c.env.sql.run("UPDATE tenants SET closed_at = ? WHERE id = ?", [c.clock.now.toISOString(), t.id]);
    expect(await refusal(k.key)).toBe("401 this company's account is closed");
    await c.env.sql.run("UPDATE tenants SET closed_at = NULL WHERE id = ?", [t.id]);
    await c.env.sql.run("UPDATE users SET erased_at = ? WHERE tenant_id = ? AND id = ?", [c.clock.now.toISOString(), t.id, t.owner]);
    expect(await refusal(k.key)).toBe("401 the person behind this API key was erased; it no longer works");
  });

  it("a row that says approve (by hand, or written before 20 Nov) never approves", async () => {
    const k = await newApiKey(db(), { name: "k", scopes: ["read"], caller: await who(t.key), now: c.clock.now });
    await c.env.sql.run("UPDATE api_keys SET scopes = 'read approve sudo' WHERE id = ?", [k.id]);
    const caller = await who(k.key);
    expect([...caller.scopes]).toEqual(["read"]);
    expect(() => need(caller, "approve")).toThrow("a key never approves: approving is a signed-in CFO's passkey over the exact terms");
  });
});

describe("tokens that are not a live caller", () => {
  it("no bearer, an unknown kind, a malformed key, an unknown key, a wrong secret", async () => {
    await expect(callerOf(c.env.sql, c.env.sessionSecret, null, c.clock.now)).rejects.toMatchObject({ status: 401, message: "sign in, or send an API key as Authorization: Bearer" });
    expect(await refusal("xyz.abc")).toBe("401 unknown token type");
    expect(await refusal("pck_short")).toBe("401 not a Purser API key");
    expect(await refusal(`pck_kAAAAAAAAAAAA_${"A".repeat(43)}`)).toBe("401 unknown API key");
    const [, id] = /^pck_(k[A-Za-z0-9]{12})_/.exec(t.key)!;
    expect(await refusal(`pck_${id}_${"B".repeat(43)}`)).toBe("401 unknown API key");
  });

  it("a session ends with a changed role, a sign-out, an ended session, a closed company; a forged one is bad", async () => {
    expect(await refusal(t.session)).toBe("accepted");
    const s = await who(t.session);
    expect(await refusal(`${t.session.slice(0, -2)}xx`)).toBe("401 bad session");
    // Signed with the cloud's secret but naming a sign-in method that does not exist.
    const odd = await sessionToken(c.env.sessionSecret, { tenantId: t.id, userId: t.owner, role: "owner", gen: 0, via: "saml" as never }, c.clock.now);
    const gen = (await c.env.sql.first<{ session_gen: number }>("SELECT session_gen FROM users WHERE tenant_id = ? AND id = ?", [t.id, t.owner]))!.session_gen;
    const odd2 = await sessionToken(c.env.sessionSecret, { tenantId: t.id, userId: t.owner, role: "owner", gen, via: "saml" as never }, c.clock.now);
    expect(await refusal(odd)).toMatch(/^401 /);
    expect(await refusal(odd2)).toBe("401 bad session");
    await c.env.sql.run("UPDATE users SET role = 'viewer' WHERE tenant_id = ? AND id = ?", [t.id, t.owner]);
    expect(await refusal(t.session)).toBe("401 this sign-in is no longer valid");
    await c.env.sql.run("UPDATE users SET role = 'owner' WHERE tenant_id = ? AND id = ?", [t.id, t.owner]);
    expect(await refusal(t.session)).toBe("accepted");
    // The person ends this one session from their list.
    expect(await endSession(c.env.sql, t.id, t.owner, s.sessionId!, c.clock.now)).toBe(true);
    expect(await refusal(t.session)).toBe("401 this session was ended; sign in again");
    // A fresh token for the same person still works until they sign out everywhere.
    const fresh = await sessionToken(c.env.sessionSecret, { tenantId: t.id, userId: t.owner, role: "owner", gen }, c.clock.now);
    expect(await refusal(fresh)).toBe("accepted");
    await endSessions(c.env.sql, t.id, t.owner);
    expect(await refusal(fresh)).toBe("401 this sign-in is no longer valid");
    c.clock.now = new Date(c.clock.now.getTime() + 16 * 60_000);
    expect(await refusal(fresh)).toBe("401 the session expired; sign in again");
  });

  it("a connector's access token: forged, expired, or for a key that is not a connector's", async () => {
    const plain = await newApiKey(db(), { name: "k", scopes: ["read"], caller: await who(t.key), now: c.clock.now });
    const conn = await newApiKey(db(), { name: "claude", scopes: ["read"], caller: await who(t.key), purpose: "claude", now: c.clock.now });
    const tok = (keyId: string, exp: number, secret = c.env.sessionSecret) => accessToken(secret, { keyId, clientId: "client-1", expiresAt: exp });
    const later = c.clock.now.getTime() + 60_000;
    expect(await refusal(await tok(conn.id, later))).toBe("accepted");
    expect(await refusal(await tok(conn.id, later, "another-secret"))).toBe("401 bad access token");
    expect(await refusal(await tok(conn.id, c.clock.now.getTime()))).toBe("401 the access token expired; connect again");
    expect(await refusal(await tok(plain.id, later))).toBe("401 bad access token");
    await c.env.sql.run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", [c.clock.now.toISOString(), conn.id]);
    expect(await refusal(await tok(conn.id, later))).toBe("401 this API key was revoked");
  });
});

describe("why a caller may not", () => {
  const caller = (o: Partial<Caller>): Caller => ({ tenantId: "t_x", kind: "session", principal: "u", scopes: new Set(["read"]), user: "u", ...o });
  it("says it in the caller's terms", () => {
    expect(() => need(caller({ role: "owner" }), "approve")).toThrow("this company has a CFO: the CFO approves payments, not an owner (separation of duties; docs/security/roles.md)");
    expect(() => need(caller({ role: "accountant" }), "approve")).toThrow("only the CFO approves payments (or an owner, in a company with no CFO)");
    expect(() => need(caller({ kind: "key" }), "sync")).toThrow("this key may not push data");
    expect(() => need(caller({}), "propose")).toThrow("this sign-in may not propose payments");
    expect(() => need(caller({}), "admin")).toThrow("this sign-in may not manage this company");
    expect(() => need(caller({ scopes: new Set() }), "read")).toThrow("this sign-in may not read");
    // admin implies propose.
    expect(() => need(caller({ scopes: new Set(["admin"]) }), "propose")).not.toThrow();
  });
});

describe("an invite's link", () => {
  it("names its company and person only while it is open, its company open and its person not erased", async () => {
    const made = await c.req("POST", "/v1/users", { key: t.session, body: { display_name: "Anna", role: "viewer" } });
    expect(made.status).toBe(201);
    const userId = made.json.id as string;
    const start = await c.req("POST", `/v1/users/${userId}/enrolment`, { key: t.session });
    expect(start.status).toBe(201);
    const { enrolment_id: enrolmentId, token } = start.json as unknown as { enrolment_id: string; token: string };
    expect(await inviteInfo(c.env.sql, { enrolmentId, token, now: c.clock.now })).toMatchObject({ tenant: "acme", person: "Anna" });
    const no = (a: Parameters<typeof inviteInfo>[1]) => expect(inviteInfo(c.env.sql, a)).rejects.toMatchObject({ status: 401, message: "this invite is unknown, used, replaced or expired; ask an owner for a new one" });
    await no({ enrolmentId, token: "wrong", now: c.clock.now });
    await no({ enrolmentId: "e_nothing", token, now: c.clock.now });
    await no({ enrolmentId, token, now: days(2) });
    await c.env.sql.run("UPDATE users SET erased_at = ? WHERE tenant_id = ? AND id = ?", [c.clock.now.toISOString(), t.id, userId]);
    await no({ enrolmentId, token, now: c.clock.now });
    await c.env.sql.run("UPDATE users SET erased_at = NULL WHERE tenant_id = ? AND id = ?", [t.id, userId]);
    await c.env.sql.run("UPDATE tenants SET closed_at = ? WHERE id = ?", [c.clock.now.toISOString(), t.id]);
    await no({ enrolmentId, token, now: c.clock.now });
  });
});
