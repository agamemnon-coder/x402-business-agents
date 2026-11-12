// Owner recovery (go-live): the only owner who lost their passkey gets back in. The platform admin, after checking who
// is asking out of band, issues a one-time recovery key for one owner of one company: a day long, good only to start
// that owner's passkey enrolment. The old passkeys go only once the new one is enrolled; every step is recorded and
// sent to the company's webhook; a second recovery cannot be issued while one is open.
import { describe, expect, it } from "vitest";
import { softPasskey } from "../src/metal/softPasskey.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
type Pk = { pk: ReturnType<typeof softPasskey>; credential_id: string };

async function redeem(c: TestCloud, slug: string, e: { enrolment_id: string; token: string }): Promise<{ status: number; json: Record<string, unknown> } & Pk> {
  const pk = softPasskey();
  const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url");
  const y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
  const a = pk.assert("0x00", { challenge: e.token, origin: ORIGIN, rpId: RP });
  const r = await c.req("POST", "/v1/auth/enrol", { body: { tenant: slug, enrolment_id: e.enrolment_id, token: e.token, credential_id, x, y,
    assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
  return { status: r.status, json: r.json, pk, credential_id };
}
async function login(c: TestCloud, slug: string, p: Pk): Promise<{ status: number; session: string }> {
  const ch = await c.req("POST", "/v1/auth/challenge", { body: { tenant: slug } });
  const a = p.pk.assert("0x00", { challenge: ch.json.challenge as string, origin: ORIGIN, rpId: RP });
  const r = await c.req("POST", "/v1/auth/login", { body: { tenant: slug, challenge_id: ch.json.challenge_id, credential_id: p.credential_id,
    assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
  return { status: r.status, session: r.json.session as string };
}
const issue = (c: TestCloud, tenantId: string, owner: string, checked_by = "video call with the owner, ID checked against the contract") =>
  c.req("POST", `/v1/admin/tenants/${tenantId}/recovery`, { key: ADMIN_TOKEN, body: { owner_id: owner, checked_by } });
const startEnrol = (c: TestCloud, key: string, user: string) => c.req("POST", `/v1/users/${user}/enrolment`, { key });

function hooks(c: TestCloud): string[] {
  const types: string[] = [];
  c.env.outbound = async (_url, init) => { types.push((JSON.parse(String(init.body)) as { type: string }).type); return new Response("ok", { status: 200 }); };
  c.env.retryDelayMs = 0;
  return types;
}

describe("owner recovery", () => {
  it("a lost passkey: a recovery key enrols a new one, then the old passkeys and sessions end; every step recorded and sent", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const set = await c.req("POST", "/v1/webhook", { key: t.session, body: { url: "https://hooks.example.com/purser" } });
      expect(set.status).toBe(200);
      const sent = hooks(c);
      const r = await issue(c, t.id, t.owner);
      expect(r.status).toBe(201);
      const rk = r.json.recovery_key as string;
      expect(r.json.expires_at).toBe(new Date(c.clock.now.getTime() + 24 * 3_600_000).toISOString());
      // It is good for one thing: its own owner's enrolment.
      expect((await c.req("GET", "/v1/me", { key: rk })).status).toBe(200);
      expect((await c.req("GET", "/v1/invoices", { key: rk })).status).toBe(403);
      expect((await c.req("POST", "/v1/keys", { key: rk, body: { name: "x", scopes: ["read"] } })).status).toBe(403);
      const e = await startEnrol(c, rk, t.owner);
      expect(e.status).toBe(201);
      // Until the new passkey exists, the old one still signs in (a recovery that is never finished changes nothing).
      expect((await login(c, "acme", t.ownerPasskey)).status).toBe(200);
      c.clock.now = new Date(c.clock.now.getTime() + 60_000);
      const fresh = await redeem(c, "acme", e.json as { enrolment_id: string; token: string });
      expect(fresh.status).toBe(201);
      // Now the old passkey is gone, the session from before ends, the recovery key is spent; the new passkey signs in.
      expect((await login(c, "acme", t.ownerPasskey)).status).toBe(401);
      expect((await c.req("GET", "/v1/me", { key: t.session })).status).toBe(401);
      expect((await c.req("GET", "/v1/me", { key: rk })).status).toBe(401);
      const s = await login(c, "acme", fresh);
      expect(s.status).toBe(200);
      const ev = await c.req("GET", "/v1/security/events", { key: s.session });
      expect((ev.json.items as { kind: string }[]).map((x) => x.kind)).toEqual(["recovery.issued", "recovery.completed"]);
      expect(sent).toEqual(["security.recovery_issued", "security.recovery_completed"]);
    } finally { c.close(); }
  });

  it("refuses misuse: no reason given, a non-owner, an erased person, another company, a second while one is open", async () => {
    const c = testCloud();
    try {
      const a = await c.tenant("acme");
      const b = await c.tenant("beta");
      expect((await c.req("POST", `/v1/admin/tenants/${a.id}/recovery`, { key: ADMIN_TOKEN, body: { owner_id: a.owner } })).status).toBe(400);
      expect((await c.req("POST", `/v1/admin/tenants/${a.id}/recovery`, { key: a.key, body: { owner_id: a.owner, checked_by: "x" } })).status).toBe(401);
      const cfo = await c.req("POST", "/v1/users", { key: a.session, body: { display_name: "CFO", role: "cfo" } });
      expect((await issue(c, a.id, (cfo.json.id as string))).status).toBe(409);
      expect((await issue(c, a.id, b.owner)).status).toBe(409);
      const first = await issue(c, a.id, a.owner);
      expect(first.status).toBe(201);
      expect((await issue(c, a.id, a.owner)).status).toBe(409);
      // Another company's recovery key does nothing here, and this one does nothing for anyone but its owner.
      const rb = (await issue(c, b.id, b.owner)).json.recovery_key as string;
      expect((await startEnrol(c, rb, a.owner)).status).toBe(403);
      expect((await startEnrol(c, first.json.recovery_key as string, (cfo.json.id as string))).status).toBe(403);
    } finally { c.close(); }
  });

  it("a recovery key works once and for a day: spent after use, dead after expiry, and then a new one may be issued", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const rk = (await issue(c, t.id, t.owner)).json.recovery_key as string;
      const e = await startEnrol(c, rk, t.owner);
      expect((await redeem(c, "acme", e.json as { enrolment_id: string; token: string })).status).toBe(201);
      // Spent: no second enrolment with it.
      expect((await startEnrol(c, rk, t.owner)).status).toBe(401);
      const again = (await issue(c, t.id, t.owner)).json.recovery_key as string;
      c.clock.now = new Date(c.clock.now.getTime() + 24 * 3_600_000 + 60_000);
      expect((await startEnrol(c, again, t.owner)).status).toBe(401);
      expect((await issue(c, t.id, t.owner)).status).toBe(201);
    } finally { c.close(); }
  });

  it("an enrolment the recovery key started dies with the key: revoked before it is redeemed, the old passkey stays", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const r = await issue(c, t.id, t.owner);
      const e = await startEnrol(c, r.json.recovery_key as string, t.owner);
      // The owner found the passkey after all and revokes the recovery key from a signed-in session.
      expect((await c.req("DELETE", `/v1/keys/${r.json.key_id as string}`, { key: t.session })).status).toBe(200);
      expect((await redeem(c, "acme", e.json as { enrolment_id: string; token: string })).status).toBe(401);
      expect((await login(c, "acme", t.ownerPasskey)).status).toBe(200);
    } finally { c.close(); }
  });

  it("a normal sign-in racing the recovery: a session made before the new passkey lands ends when it lands", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const rk = (await issue(c, t.id, t.owner)).json.recovery_key as string;
      const e = await startEnrol(c, rk, t.owner);
      const before = await login(c, "acme", t.ownerPasskey);
      expect(before.status).toBe(200);
      expect((await redeem(c, "acme", e.json as { enrolment_id: string; token: string })).status).toBe(201);
      expect((await c.req("GET", "/v1/me", { key: before.session })).status).toBe(401);
    } finally { c.close(); }
  });
});
