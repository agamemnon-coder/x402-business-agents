// Red team round 5 (cloud console, 9 November). Each test is a repro from the report (scratchpad/redteam5/console.md),
// asserting the safe outcome.
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
async function login(c: TestCloud, slug: string, p: Pk): Promise<{ status: number; session: string; role: string }> {
  const ch = await c.req("POST", "/v1/auth/challenge", { body: { tenant: slug } });
  const a = p.pk.assert("0x00", { challenge: ch.json.challenge as string, origin: ORIGIN, rpId: RP });
  const r = await c.req("POST", "/v1/auth/login", { body: { tenant: slug, challenge_id: ch.json.challenge_id, credential_id: p.credential_id,
    assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
  return { status: r.status, session: r.json.session as string, role: r.json.role as string };
}
const start = async (c: TestCloud, key: string, user: string) => (await c.req("POST", `/v1/users/${user}/enrolment`, { key })).json as { enrolment_id: string; token: string; link: string };

describe("red team 5: the starter key and pending enrolments", () => {
  it("1: an owner enrolment the starter key started is void once the first owner passkey exists; the starter key dies with it", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme", { bare: true });
      const evil = await start(c, t.key, t.owner);
      const good = await start(c, t.key, t.owner);
      const owner = await redeem(c, "acme", good);
      expect(owner.status).toBe(201);
      // The starter key is revoked by the first owner passkey, not by the owner remembering to.
      expect((await c.req("GET", "/v1/me", { key: t.key })).status).toBe(401);
      c.clock.now = new Date(c.clock.now.getTime() + 25 * 60_000);
      const att = await redeem(c, "acme", evil);
      expect(att.status).toBe(401);
      const s = await login(c, "acme", owner);
      expect(s.status).toBe(200);
      const creds = await c.req("GET", `/v1/users/${t.owner}/passkeys`, { key: s.session });
      expect((creds.json.items as unknown[]).length).toBe(1);
    } finally { c.close(); }
  });

  it("7: the starter key is short-lived and good only for the first owner's passkey", async () => {
    const c = testCloud();
    try {
      const r = await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug: "acme", name: "Acme", owner: { display_name: "Owner" } } });
      expect(Date.parse(r.json.expires_at as string) - c.clock.now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
      const key = r.json.api_key as string;
      expect((await c.req("GET", "/v1/me", { key })).status).toBe(200);
      expect((await c.req("GET", "/v1/invoices", { key })).status).toBe(403);
      expect((await c.req("POST", "/v1/sync", { key, body: {} })).status).toBe(403);
      expect((await c.req("POST", "/v1/keys", { key, body: { name: "x", scopes: ["read"] } })).status).toBe(403);
      const cfo = await c.req("POST", "/v1/users", { key, body: { display_name: "Fleur", role: "cfo" } });
      expect(cfo.status).toBe(403);
      expect((await c.req("POST", `/v1/users/${(r.json.owner as { id: string }).id}/enrolment`, { key })).status).toBe(201);
    } finally { c.close(); }
  });
});

describe("red team 5: invites are cancelled", () => {
  it("2: a new invite for a person voids their earlier unused one", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Fleur", role: "cfo" } });
      const first = await start(c, t.key, u.json.id as string);
      const second = await start(c, t.key, u.json.id as string);
      expect((await redeem(c, "acme", first)).status).toBe(401);
      expect((await redeem(c, "acme", second)).status).toBe(201);
    } finally { c.close(); }
  });

  it("2: revoking the key that started an invite voids it", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Fleur", role: "cfo" } });
      const k = await c.req("POST", "/v1/keys", { key: t.key, body: { name: "erp", scopes: ["read", "admin"], expires_in_days: 1 } });
      const inv = await start(c, k.json.api_key as string, u.json.id as string);
      await c.req("DELETE", `/v1/keys/${k.json.id as string}`, { key: t.key });
      expect((await redeem(c, "acme", inv)).status).toBe(401);
    } finally { c.close(); }
  });

  it("2: erasing the person who started an invite voids it", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const o2 = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Second owner", role: "owner" } });
      const o2pk = await redeem(c, "acme", await start(c, t.session, o2.json.id as string));
      const s2 = await login(c, "acme", o2pk);
      const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Fleur", role: "cfo" } });
      const inv = await start(c, s2.session, u.json.id as string);
      expect((await c.req("POST", `/v1/users/${o2.json.id as string}/erase`, { key: t.session })).status).toBe(200);
      expect((await redeem(c, "acme", inv)).status).toBe(401);
    } finally { c.close(); }
  });
});

describe("red team 5: an owner sees and removes passkeys", () => {
  it("1: lists a person's passkeys, removes one (ending that person's sessions), never the last owner's last", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Fleur", role: "cfo" } });
      const cfo = await redeem(c, "acme", await start(c, t.key, u.json.id as string));
      const cs = await login(c, "acme", cfo);
      const list = await c.req("GET", `/v1/users/${u.json.id as string}/passkeys`, { key: t.session });
      expect(list.status).toBe(200);
      expect((list.json.items as { credential_id: string }[]).map((x) => x.credential_id)).toEqual([cfo.credential_id]);
      // A key may list but not remove; only a signed-in owner removes a passkey.
      expect((await c.req("DELETE", `/v1/users/${u.json.id as string}/passkeys/${cfo.credential_id}`, { key: t.key })).status).toBe(403);
      expect((await c.req("DELETE", `/v1/users/${u.json.id as string}/passkeys/${cfo.credential_id}`, { key: t.session })).status).toBe(200);
      expect((await c.req("GET", "/v1/me", { key: cs.session })).status).toBe(401);
      expect((await login(c, "acme", cfo)).status).toBe(401);
      const last = await c.req("DELETE", `/v1/users/${t.owner}/passkeys/${t.ownerPasskey.credential_id}`, { key: t.session });
      expect(last.status).toBe(409);
      expect(String(last.json.error)).toMatch(/last/);
    } finally { c.close(); }
  });
});

describe("red team 5: addresses", () => {
  it("4: mailbox names a certificate authority writes to are refused as a company address", async () => {
    const c = testCloud();
    try {
      for (const slug of ["postmaster", "hostmaster", "webmaster", "admin", "administrator", "abuse", "root", "noreply", "no-reply", "mailer-daemon", "security", "ssl-admin", "info"]) {
        const r = await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug, name: "x", owner: { display_name: "O" } } });
        expect({ slug, status: r.status }).toEqual({ slug, status: 400 });
      }
    } finally { c.close(); }
  });

  it("4: a purged company's address is never given out again", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      expect((await c.req("POST", "/v1/close", { key: t.key })).status).toBe(200);
      const { purgeExpired } = await import("../cloud/src/privacy.js");
      c.clock.now = new Date("2040-01-01T00:00:00Z");
      expect(await purgeExpired(c.env.sql, c.env.blobs, c.clock.now)).toContain(t.id);
      const again = await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug: "acme", name: "x", owner: { display_name: "O" } } });
      expect(again.status).toBe(409);
    } finally { c.close(); }
  });
});

describe("red team 5: invite links", () => {
  it("6: the link carries no company; the server says which company and person the secret is for", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Fleur", role: "cfo" } });
      const inv = await start(c, t.key, u.json.id as string);
      const q = new URLSearchParams(inv.link.split("#/enrol?")[1]);
      expect([...q.keys()].sort()).toEqual(["e", "k"]);
      const info = await c.req("POST", "/v1/auth/invite", { body: { enrolment_id: q.get("e"), token: q.get("k") } });
      expect(info.status).toBe(200);
      expect(info.json).toMatchObject({ tenant: "acme", company: "acme test company", person: "Fleur" });
      expect((await c.req("POST", "/v1/auth/invite", { body: { enrolment_id: q.get("e"), token: "x".repeat(43) } })).status).toBe(401);
      // Another company's invite cannot be redeemed under this company's address.
      const t2 = await c.tenant("other");
      const u2 = await c.req("POST", "/v1/users", { key: t2.key, body: { display_name: "Eve", role: "viewer" } });
      const inv2 = await start(c, t2.key, u2.json.id as string);
      expect((await redeem(c, "acme", inv2)).status).toBe(401);
    } finally { c.close(); }
  });
});
