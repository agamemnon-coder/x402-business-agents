// Red team round 4 (cloud, 9 November): API keys. A key a key made is bounded by it and dies with it; a key minted
// while its person is erased never outlives them; an owner enrolment racing an owner's erasure is checked at commit.
import { describe, expect, it } from "vitest";
import type { Sql, SqlValue } from "../cloud/src/store.js";
import { testCloud } from "./support/cloud.js";

describe("red team 4, cloud keys", () => {
  it("2: a key a key made has no more scope and no later expiry than its maker, and is revoked with it", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const short = await c.req("POST", "/v1/keys", { key: t.key, body: { name: "erp, 1 day, admin only", scopes: ["admin"], expires_in_days: 1 } });
      const sk = short.json.api_key as string;
      expect((await c.req("POST", "/v1/keys", { key: sk, body: { name: "wider", scopes: ["read", "sync", "admin"], expires_in_days: 365 } })).status).toBe(403);
      const child = await c.req("POST", "/v1/keys", { key: sk, body: { name: "child", scopes: ["admin"], expires_in_days: 365 } });
      expect(child.status).toBe(201);
      expect(child.json.expires_at).toBe(short.json.expires_at);
      const ck = child.json.api_key as string;
      const grand = await c.req("POST", "/v1/keys", { key: ck, body: { name: "grandchild", scopes: ["admin"] } });
      expect(grand.status).toBe(201);
      const rev = await c.req("DELETE", `/v1/keys/${short.json.id}`, { key: t.key });
      expect(rev.json.also_revoked).toEqual(expect.arrayContaining([child.json.id, grand.json.id]));
      expect((await c.req("GET", "/v1/me", { key: ck })).status).toBe(401);
      expect((await c.req("GET", "/v1/me", { key: grand.json.api_key as string })).status).toBe(401);
    } finally { c.close(); }
  });

  it("2b: a child key stops working when its maker is revoked, even with no cascade (rows from before it)", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const parent = await c.req("POST", "/v1/keys", { key: t.key, body: { name: "p", scopes: ["read", "admin"] } });
      const child = await c.req("POST", "/v1/keys", { key: parent.json.api_key as string, body: { name: "c", scopes: ["read"] } });
      await c.env.sql.run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", [c.clock.now.toISOString(), parent.json.id as string]);
      expect((await c.req("GET", "/v1/invoices", { key: child.json.api_key as string })).status).toBe(401);
    } finally { c.close(); }
  });

  for (const mode of ["natural", "gated"] as const) {
    it(`1 (${mode}): a key minted while its person is erased never works, and no owner passkey can be had with it`, async () => {
      const c = testCloud();
      try {
        // The owner has a passkey (the test company's first run made it); t.key is a key the owner made.
        const t = await c.tenant("acme");
        const o2 = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "made by the key", role: "owner" } });
        let release: () => void = () => {};
        if (mode === "gated") {
          const sql = c.env.sql; const held = new Promise<void>((r) => { release = r; });
          const wrapped: Sql = { ...sql, all: (s, p) => sql.all(s, p), first: (s, p) => sql.first(s, p), run: (s, p) => sql.run(s, p), exec: (s) => sql.exec(s),
            batch: async (st) => { if (st.some((x) => x.sql.startsWith("INSERT INTO api_keys"))) await held; return sql.batch(st); } };
          c.env.sql = wrapped;
        }
        const pMint = c.req("POST", "/v1/keys", { key: t.key, body: { name: "survivor", scopes: ["read", "sync", "admin"], expires_in_days: 365 } });
        const pErase = c.req("POST", `/v1/users/${t.owner}/erase`, { key: t.key }).then((r) => { release(); return r; });
        const [mint, erase] = await Promise.all([pMint, pErase]);
        expect(erase.status).toBe(200);
        if (mint.status === 201) {
          const k2 = mint.json.api_key as string;
          expect((await c.req("GET", "/v1/me", { key: k2 })).status).toBe(401);
          expect((await c.req("POST", `/v1/users/${o2.json.id}/enrolment`, { key: k2 })).status).toBe(401);
        } else expect(mint.status).toBe(401);
      } finally { c.close(); }
    });
  }

  it("3: an owner enrolment counted while no owner had a passkey is refused if one has by commit time", async () => {
    const c = testCloud();
    try {
      // A new company: the starter key starts the first owner's enrolment while no owner has a passkey (red team round 5:
      // the starter key enrols its own owner only).
      const t = await c.tenant("acme", { bare: true });
      const sql = c.env.sql;
      let release: () => void = () => {};
      let counted: () => void = () => {};
      const held = new Promise<void>((r) => { release = r; });
      const reached = new Promise<void>((r) => { counted = r; });
      // The enrolment counts owner passkeys (none yet), then waits; meanwhile the first owner enrols one.
      c.env.sql = { ...sql, all: (s, p) => sql.all(s, p), run: (s, p) => sql.run(s, p), exec: (s) => sql.exec(s), batch: (s) => sql.batch(s),
        first: (async (s: string, p?: SqlValue[]) => { const r = await sql.first(s, p); if (s.includes("FROM credentials") && s.includes(" IN (")) { counted(); await held; } return r; }) as Sql["first"] };
      const pEnr = c.req("POST", `/v1/users/${t.owner}/enrolment`, { key: t.key });
      await reached;
      await sql.run("INSERT INTO credentials (tenant_id, credential_id, user_id, x, y, counter, created_at) VALUES ((SELECT id FROM tenants WHERE slug = 'acme'), 'cred-o1', ?, 'x', 'y', 0, ?)", [t.owner, c.clock.now.toISOString()]);
      release();
      expect((await pEnr).status).toBe(403);
    } finally { c.close(); }
  });
});
