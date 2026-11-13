// Code review 13 Nov: removing a passkey ends the person's sessions by bumping session_gen. It was set from a value read
// before the write (read + 1), so a sign-out and a new sign-in between that read and the commit left a session at the
// same generation: it survived the removal. As enrolPasskey's recovery does, the bump is now done in SQL at commit.
import { describe, expect, it } from "vitest";
import { softPasskey } from "../src/metal/softPasskey.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
type Pk = { pk: ReturnType<typeof softPasskey>; credential_id: string };
async function redeem(c: TestCloud, slug: string, e: { enrolment_id: string; token: string }): Promise<{ status: number } & Pk> {
  const pk = softPasskey();
  const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url");
  const y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
  const a = pk.assert("0x00", { challenge: e.token, origin: ORIGIN, rpId: RP });
  const r = await c.req("POST", "/v1/auth/enrol", { body: { tenant: slug, enrolment_id: e.enrolment_id, token: e.token, credential_id, x, y,
    assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
  return { status: r.status, pk, credential_id };
}
async function login(c: TestCloud, slug: string, p: Pk): Promise<{ status: number; session: string }> {
  const ch = await c.req("POST", "/v1/auth/challenge", { body: { tenant: slug } });
  const a = p.pk.assert("0x00", { challenge: ch.json.challenge as string, origin: ORIGIN, rpId: RP });
  const r = await c.req("POST", "/v1/auth/login", { body: { tenant: slug, challenge_id: ch.json.challenge_id, credential_id: p.credential_id,
    assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
  return { status: r.status, session: r.json.session as string };
}

describe("removing a passkey ends every session of the person, even one made while the removal is being written", () => {
  it("a sign-out and sign-in racing the removal's write does not keep a session (session_gen is incremented at commit)", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Fleur", role: "cfo" } });
      const uid = u.json.id as string;
      const e = await c.req("POST", `/v1/users/${uid}/enrolment`, { key: t.key });
      const cfo = await redeem(c, "acme", e.json as { enrolment_id: string; token: string });
      expect(cfo.status).toBe(201);
      const sql = c.env.sql as unknown as { batch: (s: { sql: string; params: unknown[] }[]) => Promise<unknown> };
      const orig = sql.batch.bind(sql);
      let raced: { status: number; session: string } | null = null;
      let armed = true;
      sql.batch = async (stmts) => {
        if (armed && stmts.some((s) => /DELETE FROM credentials/i.test(s.sql) && s.params.includes(cfo.credential_id))) {
          armed = false;
          // After the route read session_gen, before its write commits: the person signs out (gen + 1) and in again.
          const s0 = await login(c, "acme", cfo);
          await c.req("POST", "/v1/auth/logout", { key: s0.session });
          raced = await login(c, "acme", cfo);
        }
        return orig(stmts);
      };
      expect((await c.req("DELETE", `/v1/users/${uid}/passkeys/${cfo.credential_id}`, { key: t.session })).status).toBe(200);
      expect(armed).toBe(false);
      expect(raced!.status).toBe(200);
      expect((await c.req("GET", "/v1/me", { key: raced!.session })).status).toBe(401);
    } finally { c.close(); }
  });
});
