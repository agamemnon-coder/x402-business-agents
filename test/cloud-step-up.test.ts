// Step-up for sensitive settings (cloud/src/stepUp.ts). It holds: a session signed in with the passkey less than five
// minutes ago may change a sensitive setting; an older one is refused with code step_up_required until the person
// confirms with their own passkey; the step-up token that check returns lasts five minutes and works with the session
// it was made for only (not next to another session of the same person, not after sign-out); a passkey that is not the
// person's own cannot step up; a key keeps its admin routes but may never set alert targets; and a route that is not sensitive
// needs no step-up.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STEP_UP_HEADER } from "../cloud/src/stepUp.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
let c: TestCloud, t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

const later = (min: number) => { c.clock.now = new Date(c.clock.now.getTime() + min * 60_000); };
const assertion = (challenge: string) => {
  const a = t.ownerPasskey.pk.assert("0x00", { challenge, origin: ORIGIN, rpId: RP });
  return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
};
async function stepUp(session: string, credential = t.ownerPasskey.credential_id): Promise<{ status: number; token: string; json: Record<string, unknown> }> {
  const ch = await c.req("POST", "/v1/auth/step-up/start", { key: session });
  const r = await c.req("POST", "/v1/auth/step-up", { key: session, body: { challenge_id: ch.json.challenge_id, credential_id: credential, assertion: assertion(ch.json.challenge as string) } });
  return { status: r.status, token: r.json.step_up as string, json: r.json };
}
async function signIn(): Promise<string> {
  const ch = await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } });
  const s = await c.req("POST", "/v1/auth/login", { body: { tenant: "acme", challenge_id: ch.json.challenge_id, credential_id: t.ownerPasskey.credential_id, assertion: assertion(ch.json.challenge as string) } });
  return s.json.session as string;
}
const addSlack = (session: string, headers: Record<string, string> = {}) => c.req("POST", "/v1/alerts/targets", { key: session, headers, body: { channel: "slack", target: "https://hooks.slack.com/services/T000/B000/XXXX" } });

describe("step-up", () => {
  it("lets a session signed in under five minutes ago change a sensitive setting", async () => {
    later(4);
    expect((await addSlack(t.session)).status).toBe(201);
  });

  it("refuses an older session with step_up_required, and takes it after the person's own passkey check", async () => {
    later(6);
    const r = await addSlack(t.session);
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("step_up_required");
    // Not sensitive: a read, and the person's own language, need no step-up.
    expect((await c.req("GET", "/v1/alerts", { key: t.session })).status).toBe(200);
    expect((await c.req("POST", "/v1/me/language", { key: t.session, body: { language: "en" } })).status).toBe(200);
    const up = await stepUp(t.session);
    expect(up.status).toBe(200);
    expect(up.json.expires_in).toBe(300);
    expect((await addSlack(t.session, { [STEP_UP_HEADER]: up.token })).status).toBe(201);
    // Five minutes later the step-up is over.
    later(5);
    expect((await c.req("POST", "/v1/keys", { key: t.session, headers: { [STEP_UP_HEADER]: up.token }, body: { name: "late", scopes: ["read"] } })).json.code).toBe("step_up_required");
  });

  it("binds the step-up token to its session: next to another session of the same person, or after sign-out, it fails", async () => {
    later(6);
    const up = await stepUp(t.session);
    const other = await signIn();
    later(6);
    expect((await addSlack(other, { [STEP_UP_HEADER]: up.token })).json.code).toBe("step_up_required");
    // A forged or altered token does not count either.
    const [p, body, sig] = up.token.split(".");
    expect((await addSlack(t.session, { [STEP_UP_HEADER]: `${p}.${body}.${sig!.slice(1)}A` })).json.code).toBe("step_up_required");
    await c.req("POST", "/v1/auth/logout", { key: t.session });
    expect((await addSlack(t.session, { [STEP_UP_HEADER]: up.token })).status).toBe(401);
  });

  it("takes only the signed-in person's own passkey, once per challenge", async () => {
    later(6);
    // A passkey that is not the signed-in person's own cannot step up their session.
    expect((await stepUp(t.session, "bm90LXRoZS1vd25lcnMtcGFzc2tleQ")).status).toBe(403);
    const ch = await c.req("POST", "/v1/auth/step-up/start", { key: t.session });
    const body = { challenge_id: ch.json.challenge_id, credential_id: t.ownerPasskey.credential_id, assertion: assertion(ch.json.challenge as string) };
    expect((await c.req("POST", "/v1/auth/step-up", { key: t.session, body })).status).toBe(200);
    expect((await c.req("POST", "/v1/auth/step-up", { key: t.session, body })).status).toBe(401);
    // A sign-in challenge is not a step-up challenge, nor the other way round (final review S6).
    const signInCh = await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } });
    expect((await c.req("POST", "/v1/auth/step-up", { key: t.session, body: { challenge_id: signInCh.json.challenge_id, credential_id: t.ownerPasskey.credential_id, assertion: assertion(signInCh.json.challenge as string) } })).status).toBe(401);
    const upCh = await c.req("POST", "/v1/auth/step-up/start", { key: t.session });
    expect((await c.req("POST", "/v1/auth/login", { body: { tenant: "acme", challenge_id: upCh.json.challenge_id, credential_id: t.ownerPasskey.credential_id, assertion: assertion(upCh.json.challenge as string) } })).status).toBe(401);
    // A key has no passkey to step up with.
    expect((await c.req("POST", "/v1/auth/step-up/start", { key: t.key })).status).toBe(403);
  });

  it("covers the company's name and language and its Airwallex account (final review S1)", async () => {
    later(6);
    expect((await c.req("POST", "/v1/company", { key: t.session, body: { name: "Renamed" } })).json.code).toBe("step_up_required");
    for (const path of ["/v1/airwallex/account", "/v1/airwallex/onboarding-link"]) expect((await c.req("POST", path, { key: t.session, body: {} })).json.code, path).toBe("step_up_required");
    const up = await stepUp(t.session);
    expect((await c.req("POST", "/v1/company", { key: t.session, headers: { [STEP_UP_HEADER]: up.token }, body: { name: "Renamed" } })).status).toBe(200);
  });

  it("lets an admin key keep its routes, but never set or remove alert targets", async () => {
    later(60);
    expect((await c.req("POST", "/v1/keys", { key: t.key, body: { name: "by key", scopes: ["read"] } })).status).toBe(201);
    const r = await addSlack(t.key);
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/signed-in owner/);
  });

  it("says in the OpenAPI document which routes need it", async () => {
    const o = (await c.req("GET", "/v1/openapi.json")).json as { paths: Record<string, Record<string, Record<string, unknown>>> };
    expect(o.paths["/v1/alerts/targets"]!.post!["x-purser-step-up"]).toMatch(/signed-in owner/);
    expect(o.paths["/v1/keys"]!.post!["x-purser-step-up"]).toMatch(/five minutes/);
    expect(o.paths["/v1/invoices"]!.get!["x-purser-step-up"]).toBeUndefined();
  });
});
