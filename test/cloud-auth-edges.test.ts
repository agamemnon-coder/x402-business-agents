// Purser Cloud's sign-in and keys (cloud/src/auth.ts), the edges test/cloud-auth.test.ts leaves: a company's first key
// with no scope or an unknown one, a key that lives the default term, too many sign-ins open at once, a passkey enrolled
// twice, and the platform admin's token given in any other form than a Bearer header.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError, firstApiKey, isPlatformAdmin, MAX_OPEN_CHALLENGES, newChallenge } from "../cloud/src/auth.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { ADMIN_TOKEN, addPerson, cloudAssertion, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(() => { c = testCloud(); });
afterEach(() => { c.close(); });
const NOW = new Date("2026-11-08T12:00:00Z");

describe("a company's first key", () => {
  it("needs at least one known scope", async () => {
    const t = await c.tenant("keys", { bare: true });
    const db = new TenantDb(c.env.sql, t.id);
    for (const scopes of [[], ["read", "everything"]]) {
      await expect(firstApiKey(db, { name: "k", scopes: scopes as never, createdBy: "platform", createdByUser: null, now: NOW })).rejects.toMatchObject({ status: 403, message: "scopes must be some of read, sync, admin, propose" });
    }
  });
  it("lives the default term when none is asked, and is a usable key", async () => {
    const t = await c.tenant("keys2", { bare: true });
    const k = await firstApiKey(new TenantDb(c.env.sql, t.id), { name: "k", scopes: ["read"], createdBy: "platform", createdByUser: null, now: NOW });
    expect(Date.parse(k.expires_at)).toBeGreaterThan(NOW.getTime() + 30 * 86_400_000);
    expect((await c.req("GET", "/v1/invoices", { key: k.key })).status).toBe(200);
  });
});

describe("sign-in challenges", () => {
  it("a company has a bounded number open: one more is refused until some expire", async () => {
    const t = await c.tenant("busy", { bare: true });
    for (let i = 0; i < MAX_OPEN_CHALLENGES; i++) await newChallenge(c.env.sql, t.id, NOW);
    await expect(newChallenge(c.env.sql, t.id, NOW)).rejects.toMatchObject({ status: 429, message: "too many sign-ins are open for this company; try again in a few minutes" });
    // Past their life the challenges go at once, and a new one is given.
    await expect(newChallenge(c.env.sql, t.id, new Date(NOW.getTime() + 24 * 3_600_000))).resolves.toMatchObject({ challenge_id: expect.stringMatching(/^c/) });
  });
});

describe("enrolment", () => {
  it("a passkey already enrolled cannot be enrolled again for another person", async () => {
    const t = await c.tenant("enrol");
    const viewer = await addPerson(c, "enrol", t.session, "viewer");
    const e = await c.req("POST", `/v1/users/${viewer.id}/enrolment`, { key: t.session });
    expect(e.status).toBe(201);
    const pk = t.ownerPasskey.pk;
    const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
    const r = await c.req("POST", "/v1/auth/enrol", { body: { tenant: "enrol", enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id: t.ownerPasskey.credential_id, x, y, assertion: cloudAssertion(t.ownerPasskey, e.json.token as string) } });
    expect(r).toMatchObject({ status: 401, json: { error: "this passkey is already enrolled" } });
  });
});

describe("the platform admin's token", () => {
  it("is taken only as a Bearer header, and never when no token is configured", async () => {
    const sha = c.env.adminTokenSha256;
    expect(await isPlatformAdmin(sha, `Bearer ${ADMIN_TOKEN}`)).toBe(true);
    expect(await isPlatformAdmin(sha, ADMIN_TOKEN)).toBe(false);
    expect(await isPlatformAdmin(sha, `Basic ${ADMIN_TOKEN}`)).toBe(false);
    expect(await isPlatformAdmin(sha, null)).toBe(false);
    expect(await isPlatformAdmin("", `Bearer ${ADMIN_TOKEN}`)).toBe(false);
    expect(new AuthError(401, "x")).toBeInstanceOf(Error);
  });
});
