// The step-up token and the "fresh passkey" check on their own (cloud/src/stepUp.ts), for the cases a request through the
// app does not reach: a session signed in with Google, Microsoft or Apple was no passkey check; a key has no fresh
// passkey; a step-up token is refused when it is not one, too long, signed with another secret, expired, valid for
// longer than five minutes, or made for another company, person or session. test/cloud-step-up.test.ts runs the gate
// through the app's routes.
import { describe, expect, it } from "vitest";
import { sessionToken, type Caller } from "../cloud/src/auth.js";
import { hmacB64u, toB64u } from "../cloud/src/crypto.js";
import { ALWAYS_STEP_UP_ROUTES, SESSION_ONLY_ROUTES, STEP_UP_HEADER, STEP_UP_ROUTES, STEP_UP_TTL_MS, freshPasskey, requireStepUp, sessionIssuedAt, stepUpAssertion, stepUpToken, StepUpRequired } from "../cloud/src/stepUp.js";
import type { Sql } from "../cloud/src/store.js";

const SECRET = "test-session-secret-0123456789abcdef";
const now = new Date("2026-11-20T09:00:00Z");
const owner: Caller = { tenantId: "t_acme0001", kind: "session", principal: "u_max", scopes: new Set(["read", "admin"]), role: "owner", user: "u_max" };
const key: Caller = { tenantId: "t_acme0001", kind: "key", principal: "kAAAAAAAAAAAA", scopes: new Set(["read", "admin"]), user: "u_max" };
const req = (session: string, up?: string) => new Request("https://cloud.test/v1/keys", { method: "POST", headers: { authorization: `Bearer ${session}`, ...(up !== undefined ? { [STEP_UP_HEADER]: up } : {}) } });
const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
/** A step-up token with any payload, signed as the real ones are. */
const forged = async (payload: Record<string, unknown>, secret = SECRET) => {
  const body = toB64u(new TextEncoder().encode(JSON.stringify(payload)));
  return `pcu.${body}.${await hmacB64u(`step-up:${secret}`, body)}`;
};
/** The SQL a stepUpOn read needs: the company's setting, nothing else. */
const settingSql = (stepUp: 0 | 1 | null): Sql => ({
  first: async () => (stepUp === null ? null : { step_up: stepUp }),
  all: async () => (stepUp === null ? [] : [{ step_up: stepUp }]),
  run: async () => ({ changes: 0 }),
  batch: async () => [],
} as unknown as Sql);

describe("when a session was signed in", () => {
  it("a passkey sign-in is dated by its expiry less the session's life; anything else has no date", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, now);
    expect(await sessionIssuedAt(SECRET, s)).toBe(now.getTime());
    // Signed in with Google, Microsoft or Apple: no passkey check, so no date to be fresh from.
    const oidc = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1, via: "oidc" }, now);
    expect(await sessionIssuedAt(SECRET, oidc)).toBeNull();
    expect(await sessionIssuedAt("another-secret", s)).toBeNull();
    expect(await sessionIssuedAt(SECRET, "pck_kAAAAAAAAAAAA_secret")).toBeNull();
  });
});

describe("a fresh passkey check", () => {
  it("a passkey sign-in under five minutes ago is one; an OIDC sign-in never is", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, now);
    expect(await freshPasskey(SECRET, req(s), owner, minutes(4))).toBe(true);
    expect(await freshPasskey(SECRET, req(s), owner, minutes(5))).toBe(false);
    // A session dated in the future (a clock that went back) is not fresh either.
    expect(await freshPasskey(SECRET, req(s), owner, minutes(-1))).toBe(false);
    const oidc = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1, via: "oidc" }, now);
    expect(await freshPasskey(SECRET, req(oidc), owner, now)).toBe(false);
  });

  it("a key never has one, whatever it sends", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, now);
    const up = (await stepUpToken(SECRET, s, owner, now)).token;
    expect(await freshPasskey(SECRET, req(s, up), key, now)).toBe(false);
  });

  it("a step-up token counts for its own session, company and person, for five minutes", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, minutes(-30));
    const up = await stepUpToken(SECRET, s, owner, now);
    expect(up.expires_at).toBe(minutes(5).toISOString());
    expect(await freshPasskey(SECRET, req(s, up.token), owner, minutes(4))).toBe(true);
    expect(await freshPasskey(SECRET, req(s, up.token), owner, minutes(5))).toBe(false);
    const other = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, minutes(-20));
    expect(await freshPasskey(SECRET, req(other, up.token), owner, now)).toBe(false);
    expect(await freshPasskey(SECRET, req(s, up.token), { ...owner, principal: "u_anna" }, now)).toBe(false);
    expect(await freshPasskey(SECRET, req(s, up.token), { ...owner, tenantId: "t_other0001" }, now)).toBe(false);
  });

  it("refuses a step-up token that is not one, too long, signed with another secret, or made to last longer", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, minutes(-30));
    const real = (await stepUpToken(SECRET, s, owner, now)).token;
    const [, body, sig] = real.split(".");
    for (const up of ["", "pcs." + body + "." + sig, `pcu.${body}`, `pcu.${body}.${sig}${"A".repeat(1000)}`, (await stepUpToken("another-secret", s, owner, now)).token]) {
      expect(await freshPasskey(SECRET, req(s, up), owner, now)).toBe(false);
    }
    const binding = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<string, unknown>;
    // Signed with the right secret, but valid for an hour: never more than five minutes.
    expect(await freshPasskey(SECRET, req(s, await forged({ ...binding, exp: minutes(60).getTime() })), owner, now)).toBe(false);
    expect(await freshPasskey(SECRET, req(s, await forged({ ...binding, exp: String(minutes(4).getTime()) })), owner, now)).toBe(false);
    expect(await freshPasskey(SECRET, req(s, await forged({ ...binding, exp: minutes(5).getTime() })), owner, now)).toBe(true);
    expect(await freshPasskey(SECRET, req(s, await forged({ ...binding, exp: now.getTime() })), owner, now)).toBe(false);
  });
});

describe("the gate on a route", () => {
  it("a route that is not sensitive needs nothing; a key keeps its sensitive routes but never a session-only one", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, minutes(-30));
    await expect(requireStepUp(settingSql(1), SECRET, "GET /v1/invoices", req(s), owner, now)).resolves.toBeUndefined();
    expect(STEP_UP_ROUTES.has("POST /v1/keys")).toBe(true);
    await expect(requireStepUp(settingSql(1), SECRET, "POST /v1/keys", req(""), key, now)).resolves.toBeUndefined();
    for (const route of SESSION_ONLY_ROUTES) {
      await expect(requireStepUp(settingSql(0), SECRET, route, req(""), key, now)).rejects.toMatchObject({ status: 403, message: "only a signed-in owner changes this, with their passkey; a key cannot" });
    }
  });

  it("an old session passes a sensitive route while the company has step-up off, but never the setting itself", async () => {
    const s = await sessionToken(SECRET, { tenantId: owner.tenantId, userId: "u_max", role: "owner", gen: 1 }, minutes(-30));
    for (const off of [settingSql(0), settingSql(null)]) await expect(requireStepUp(off, SECRET, "POST /v1/keys", req(s), owner, now)).resolves.toBeUndefined();
    for (const route of ALWAYS_STEP_UP_ROUTES) await expect(requireStepUp(settingSql(0), SECRET, route, req(s), owner, now)).rejects.toBeInstanceOf(StepUpRequired);
    const e = await requireStepUp(settingSql(1), SECRET, "POST /v1/keys", req(s), owner, now).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StepUpRequired);
    expect((e as StepUpRequired).code).toBe("step_up_required");
    const up = (await stepUpToken(SECRET, s, owner, now)).token;
    await expect(requireStepUp(settingSql(1), SECRET, "POST /v1/keys", req(s, up), owner, now)).resolves.toBeUndefined();
  });
});

describe("the passkey check behind a step-up", () => {
  const assertion = { authenticatorData: "", clientDataJSON: "", signature: "" };
  it("is a signed-in person's: a key has none, and a sign-in challenge is never taken", async () => {
    const touched: string[] = [];
    const sql = { run: async (q: string) => { touched.push(q); return { changes: 0 }; }, first: async () => null } as unknown as Sql;
    await expect(stepUpAssertion(sql, { caller: key, challengeId: "u123", credentialId: "c", assertion, rpId: "cloud.test", origin: "https://cloud.test", now })).rejects.toMatchObject({ status: 403, message: "a step-up is a signed-in person's passkey check; a key has none" });
    await expect(stepUpAssertion(sql, { caller: owner, challengeId: "c123", credentialId: "c", assertion, rpId: "cloud.test", origin: "https://cloud.test", now })).rejects.toMatchObject({ status: 401, message: "the passkey challenge is unknown, used or expired" });
    expect(touched).toEqual([]);
    // A step-up challenge that is unknown, used or expired takes nothing.
    await expect(stepUpAssertion(sql, { caller: owner, challengeId: "u123", credentialId: "c", assertion, rpId: "cloud.test", origin: "https://cloud.test", now })).rejects.toMatchObject({ status: 401 });
    expect(touched).toHaveLength(1);
  });

  it("takes only the person's own passkey", async () => {
    const sql = {
      run: async () => ({ changes: 1 }),
      first: async (q: string) => (q.startsWith("SELECT challenge") ? { challenge: "abc" } : null),
      all: async (q: string) => (q.includes("credentials") ? [{ user_id: "u_anna", x: "x", y: "y", counter: 0 }] : []),
    } as unknown as Sql;
    await expect(stepUpAssertion(sql, { caller: owner, challengeId: "u123", credentialId: "anna-cred", assertion, rpId: "cloud.test", origin: "https://cloud.test", now })).rejects.toMatchObject({ status: 403, message: "a step-up needs your own passkey" });
    expect(STEP_UP_TTL_MS).toBe(5 * 60_000);
  });
});
