// Purser Cloud's people: they enrol a passkey with an enrolment an owner starts, sign in with it (real ES256 assertions
// from a software passkey, test only) and get a 15-minute session. The challenge is used once; another origin, an
// unknown passkey, an expired session, a person erased or demoted since: all refused. Only the owner manages the company.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { softPasskey } from "../src/metal/softPasskey.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

let c: TestCloud;
let t: { id: string; key: string; owner: string };
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

async function person(role: "owner" | "cfo" | "accountant" | "viewer") {
  const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: `A ${role}`, role } });
  const userId = u.json.id as string;
  const pk = softPasskey();
  const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url");
  const y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
  // An owner starts the enrolment; the person's new passkey signs its secret.
  const e = await c.req("POST", `/v1/users/${userId}/enrolment`, { key: t.key });
  expect(e.status).toBe(201);
  const token = e.json.token as string;
  const ea = pk.assert("0x00", { challenge: token, origin: ORIGIN, rpId: RP });
  const enrolled = await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e.json.enrolment_id, token, credential_id, x, y,
    assertion: { authenticatorData: b64u(ea.authenticatorData), clientDataJSON: b64u(ea.clientDataJSON), signature: b64u(ea.signature) } } });
  expect(enrolled.status).toBe(201);
  const login = async (o: { origin?: string; challengeId?: string; challenge?: string } = {}) => {
    const ch = o.challengeId ? { challenge_id: o.challengeId, challenge: o.challenge! } : (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string; challenge: string };
    const a = pk.assert("0x00", { challenge: ch.challenge, origin: o.origin ?? ORIGIN, rpId: RP });
    const r = await c.req("POST", "/v1/auth/login", { body: { tenant: "acme", challenge_id: ch.challenge_id, credential_id, assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
    return { ...r, ch };
  };
  return { userId, login };
}

describe("passkey sign-in", () => {
  it("gives a session that reads the company's data, and never anything to manage it unless the person is an owner", async () => {
    const cfo = await person("cfo");
    const r = await cfo.login();
    expect(r.status).toBe(200);
    const session = r.json.session as string;
    expect(session).toMatch(/^pcs\./);
    expect((await c.req("GET", "/v1/me", { key: session })).json).toMatchObject({ kind: "session", role: "cfo", principal: cfo.userId });
    expect((await c.req("GET", "/v1/invoices", { key: session })).status).toBe(200);
    expect((await c.req("GET", "/v1/keys", { key: session })).status).toBe(403);
    expect((await c.req("POST", "/v1/sync", { key: session, body: {} })).status).toBe(403);
    const owner = await person("owner");
    const os = (await owner.login()).json.session as string;
    expect((await c.req("GET", "/v1/keys", { key: os })).status).toBe(200);
  });

  it("uses each challenge once, and refuses another origin and an unknown passkey", async () => {
    const p = await person("viewer");
    const first = await p.login();
    expect(first.status).toBe(200);
    expect((await p.login({ challengeId: first.ch.challenge_id, challenge: first.ch.challenge })).status).toBe(401);
    const evil = await p.login({ origin: "https://evil.example" });
    expect(evil.status).toBe(401);
    expect(evil.json.error).toMatch(/origin/);
    const ch = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string };
    expect((await c.req("POST", "/v1/auth/login", { body: { tenant: "acme", challenge_id: ch.challenge_id, credential_id: "nope-nope-nope", assertion: { authenticatorData: "AA", clientDataJSON: "AA", signature: "AA" } } })).status).toBe(401);
    expect((await c.req("POST", "/v1/auth/challenge", { body: { tenant: "nobody" } })).status).toBe(404);
  });

  it("ends a session after 15 minutes, and at once for a person erased or given another role", async () => {
    const p = await person("accountant");
    const s = (await p.login()).json.session as string;
    c.clock.now = new Date(c.clock.now.getTime() + 16 * 60_000);
    expect((await c.req("GET", "/v1/invoices", { key: s })).status).toBe(401);
    const s2 = (await p.login()).json.session as string;
    await c.env.sql.run("UPDATE users SET role = 'viewer' WHERE id = ?", [p.userId]);
    expect((await c.req("GET", "/v1/invoices", { key: s2 })).status).toBe(401);
    const q = await person("cfo");
    const s3 = (await q.login()).json.session as string;
    expect((await c.req("POST", `/v1/users/${q.userId}/erase`, { key: t.key })).status).toBe(200);
    expect((await c.req("GET", "/v1/invoices", { key: s3 })).status).toBe(401);
    // The erased person's passkey is gone: no new sign-in.
    expect((await q.login()).status).toBe(401);
  });

  it("refuses a forged session token", async () => {
    const p = await person("viewer");
    const s = (await p.login()).json.session as string;
    const [, body] = s.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString()) as Record<string, unknown>;
    forged.r = "owner";
    const fake = `pcs.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s.split(".")[2]!}`;
    expect((await c.req("GET", "/v1/keys", { key: fake })).status).toBe(401);
  });

  it("will not start an enrolment for a person the company did not add, and a push never brings a passkey", async () => {
    expect((await c.req("POST", "/v1/users/u_nobody/enrolment", { key: t.key })).status).toBe(403);
    const p = await person("viewer");
    const cred = (await c.env.sql.first<{ credential_id: string }>("SELECT credential_id FROM credentials WHERE user_id = ?", [p.userId]))!;
    const swap = await c.req("POST", "/v1/sync", { key: t.key, body: { credentials: [{ credential_id: cred.credential_id, user_id: p.userId, x: "x".repeat(43), y: "y".repeat(43), counter: 0 }] } });
    expect(swap.status).toBe(400);
    expect((await c.env.sql.first<{ x: string }>("SELECT x FROM credentials WHERE credential_id = ?", [cred.credential_id]))!.x).not.toBe("x".repeat(43));
  });
});
