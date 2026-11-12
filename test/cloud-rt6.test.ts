// Red team 6, the cloud: an owner recovery that leaves no foothold of whoever held the lost passkey, staged exports that
// end with an erasure and record every part fetched, and the platform side (one connected account per opening however
// it is retried, events applied by the documented id field only, the consent kept, the signed account binding).
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { softPasskey } from "../src/metal/softPasskey.js";
import type { NewConnectedAccount, PlatformRail } from "../src/airwallex/platform.js";
import { checkBinding } from "../src/airwallex/binding.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";
import { PLATFORM_PRIVATE_KEY, PLATFORM_PUBLIC_KEY, PURSER_FEE_ACCOUNT } from "./support/platformBinding.js";

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
const issue = (c: TestCloud, tenantId: string, owner: string) =>
  c.req("POST", `/v1/admin/tenants/${tenantId}/recovery`, { key: ADMIN_TOKEN, body: { owner_id: owner, checked_by: "video call" } });
const relative = (u: string) => u.replace(/^https:\/\/cloud\.test/, "");

describe("RT6-R an owner recovery ends what the holder of the lost passkey set up", () => {
  it("keys behind the owner are revoked, invites they started cancelled, and the recovery event lists the new owner, key and webhook", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const atk = await login(c, "acme", t.ownerPasskey);
      const key = await c.req("POST", "/v1/keys", { key: atk.session, body: { name: "backup", scopes: ["read", "sync", "admin"], expires_in_days: 365 } });
      expect(key.status).toBe(201);
      const child = await c.req("POST", "/v1/keys", { key: key.json.api_key as string, body: { name: "child", scopes: ["read"] } });
      const owner2 = await c.req("POST", "/v1/users", { key: atk.session, body: { display_name: "IT helpdesk", role: "owner" } });
      const e2 = await c.req("POST", `/v1/users/${owner2.json.id as string}/enrolment`, { key: atk.session });
      expect((await redeem(c, "acme", e2.json as { enrolment_id: string; token: string })).status).toBe(201);
      const cfo = await c.req("POST", "/v1/users", { key: atk.session, body: { display_name: "cfo", role: "cfo" } });
      const pending = await c.req("POST", `/v1/users/${cfo.json.id as string}/enrolment`, { key: atk.session });
      await c.req("POST", "/v1/webhook", { key: atk.session, body: { url: "https://hooks.attacker.example/in" } });
      const r = await issue(c, t.id, t.owner);
      const e = await c.req("POST", `/v1/users/${t.owner}/enrolment`, { key: r.json.recovery_key as string });
      const fresh = await redeem(c, "acme", e.json as { enrolment_id: string; token: string });
      expect(fresh.status).toBe(201);
      expect((await login(c, "acme", t.ownerPasskey)).status).toBe(401);
      expect((await c.req("GET", "/v1/export", { key: key.json.api_key as string })).status).toBe(401);
      if (child.status === 201) expect((await c.req("GET", "/v1/me", { key: child.json.api_key as string })).status).toBe(401);
      expect((await redeem(c, "acme", pending.json as { enrolment_id: string; token: string })).status).toBe(401);
      // The second owner is the company's call, not code's: the recovery event names it, with the key and the webhook.
      const me = await login(c, "acme", fresh);
      const ev = await c.req("GET", "/v1/security/events", { key: me.session });
      const rec = (ev.json.items as { kind: string; detail: Record<string, unknown> | string }[]).find((x) => x.kind === "recovery.completed")!;
      const detail = JSON.stringify(rec.detail);
      expect(detail).toContain(owner2.json.id as string);
      expect(detail).toContain(key.json.id as string);
      expect(detail).toContain("hooks.attacker.example");
      expect(detail).not.toContain("/in");
    } finally { c.close(); }
  });

  it("a sign-out and sign-in racing the recovery's write does not keep a session (session_gen is incremented at commit)", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const r = await issue(c, t.id, t.owner);
      const e = await c.req("POST", `/v1/users/${t.owner}/enrolment`, { key: r.json.recovery_key as string });
      const sql = c.env.sql as unknown as { batch: (s: { sql: string; params: unknown[] }[]) => Promise<unknown> };
      const orig = sql.batch.bind(sql);
      let atk: { status: number; session: string } | null = null;
      let armed = true;
      sql.batch = async (stmts) => {
        if (armed && stmts.some((s) => /recovery\.completed/.test(s.sql + JSON.stringify(s.params)))) {
          armed = false;
          const s0 = await login(c, "acme", t.ownerPasskey);
          await c.req("POST", "/v1/auth/logout", { key: s0.session });
          atk = await login(c, "acme", t.ownerPasskey);
        }
        return orig(stmts);
      };
      expect((await redeem(c, "acme", e.json as { enrolment_id: string; token: string })).status).toBe(201);
      expect(atk!.status).toBe(200);
      expect((await c.req("GET", "/v1/me", { key: atk!.session })).status).toBe(401);
    } finally { c.close(); }
  });
});

describe("RT6-X staged exports and erasure", () => {
  it("an erasure ends the export staged before it, and every part fetched is on record", async () => {
    const c = testCloud();
    try {
      c.env.exportPartRows = 50;
      const t = await c.tenant("acme");
      const u = await c.req("POST", "/v1/users", { key: t.session, body: { display_name: "Jane Private", email: "jane@private.example", role: "viewer" } });
      const s = await c.req("POST", "/v1/export/staged", { key: t.session });
      expect(s.status).toBe(201);
      const st0 = await c.req("GET", `/v1/export/staged/${s.json.id as string}`, { key: t.key });
      const m0 = await c.req("GET", relative(st0.json.manifest_url as string));
      const part = (m0.json.parts as { table: string; url: string }[]).find((p) => p.table === "users")!;
      expect(await (await c.fetch(part.url)).text()).toContain("jane@private.example");
      await c.fetch(part.url);
      const ev0 = (await c.req("GET", "/v1/security/events", { key: t.key })).json.items as { kind: string }[];
      expect(ev0.filter((x) => x.kind === "export.part_downloaded")).toHaveLength(2);
      expect((await c.req("POST", `/v1/users/${u.json.id as string}/erase`, { key: t.session })).status).toBe(200);
      const st = await c.req("GET", `/v1/export/staged/${s.json.id as string}`, { key: t.key });
      expect(st.json.status).toBe("expired");
      expect(st.json.manifest_url).toBeUndefined();
      expect((await c.fetch(part.url)).status).toBe(404);
    } finally { c.close(); }
  });
});

class FakeRail implements PlatformRail {
  next = 1; hold: Promise<void> | null = null; calls = 0;
  byRequest = new Map<string, string>();
  async createConnectedAccount(a: NewConnectedAccount) {
    const n = ++this.calls;
    let id = this.byRequest.get(a.requestId);
    if (!id) { id = `acct_fake${this.next++}`; this.byRequest.set(a.requestId, id); }
    if (n === 1 && this.hold) await this.hold;
    return { accountId: id, status: "CREATED" };
  }
  async findConnectedAccount(requestId: string) { return null as { accountId: string; status: string } | null; void requestId; }
  async onboardingLink() { return "https://www.airwallex.com/x"; }
  async getAccount(accountId: string) { return { accountId, status: "SUBMITTED" }; }
}
const PLATFORM = (rail: PlatformRail) => ({ rail, template: "t", webhookSecret: "s".repeat(32), bindingKey: PLATFORM_PRIVATE_KEY, feeAccount: PURSER_FEE_ACCOUNT, termsVersion: "airwallex-platform-terms-2026-11" });
const OPEN = { business_name: "Acme", country_code: "NL", email: "f@acme.test", agreed: true };

describe("RT6-P the platform in the cloud", () => {
  it("a slow first opening replaced after 5 minutes: one account at Airwallex, the same on both answers and the row", async () => {
    const c = testCloud();
    try {
      const rail = new FakeRail();
      let release!: () => void;
      rail.hold = new Promise((r) => { release = r; });
      c.env.awxPlatform = PLATFORM(rail);
      const t = await c.tenant("acme");
      const first = c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
      await new Promise((r) => setTimeout(r, 20));
      c.clock.now = new Date(c.clock.now.getTime() + 6 * 60_000);
      const again = await login(c, "acme", t.ownerPasskey);
      const second = await c.req("POST", "/v1/airwallex/account", { key: again.session, body: OPEN });
      release();
      const f = await first;
      expect(rail.next - 1).toBe(1);
      expect(second.json.account).toMatchObject({ account_id: "acct_fake1" });
      expect(f.json.account).toMatchObject({ account_id: "acct_fake1" });
      const row = await c.env.sql.first<{ consent_by: string; consent_at: string; consent_terms: string; request_id: string }>("SELECT consent_by, consent_at, consent_terms, request_id FROM awx_accounts WHERE tenant_id = ?", [t.id]);
      expect(row).toMatchObject({ consent_terms: "airwallex-platform-terms-2026-11" });
      expect(row!.consent_by).toBeTruthy();
      expect(row!.request_id).toMatch(/^[0-9a-f-]{36}$/);
    } finally { c.close(); }
  });

  it("a stale opening that Airwallex did open is adopted, never opened again", async () => {
    const c = testCloud();
    try {
      const rail = new FakeRail();
      rail.findConnectedAccount = async (id: string) => (rail.byRequest.get(id) ? { accountId: rail.byRequest.get(id)!, status: "CREATED" } : null);
      let release!: () => void;
      rail.hold = new Promise((r) => { release = r; });
      c.env.awxPlatform = PLATFORM(rail);
      const t = await c.tenant("acme");
      const first = c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
      await new Promise((r) => setTimeout(r, 20));
      c.clock.now = new Date(c.clock.now.getTime() + 6 * 60_000);
      const again = await login(c, "acme", t.ownerPasskey);
      const second = await c.req("POST", "/v1/airwallex/account", { key: again.session, body: OPEN });
      expect(second.json.account).toMatchObject({ account_id: "acct_fake1" });
      expect(rail.calls).toBe(1);
      release();
      expect((await first).json.account).toMatchObject({ account_id: "acct_fake1" });
    } finally { c.close(); }
  });

  it("an event is applied by the account object's id only; one naming two accounts changes none", async () => {
    const c = testCloud();
    try {
      const SECRET = "s".repeat(32);
      c.env.awxPlatform = PLATFORM(new FakeRail());
      const t = await c.tenant("acme");
      await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
      const send = async (body: unknown) => {
        const text = JSON.stringify(body);
        const ts = String(c.clock.now.getTime());
        return c.req("POST", "/v1/airwallex/webhook", { raw: text, headers: { "x-timestamp": ts, "x-signature": createHmac("sha256", SECRET).update(ts + text).digest("hex") } });
      };
      expect((await send({ name: "account.suspended", data: { object: { id: "acct_someoneelse", account_id: "acct_fake1" } } })).json).toEqual({ applied: false });
      expect((await send({ name: "account.suspended", account_id: "acct_fake1", data: { object: {} } })).json).toEqual({ applied: false });
      expect(((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json.account as { status: string }).status).toBe("created");
      expect((await send({ name: "account.active", data: { object: { id: "acct_fake1" } } })).json).toMatchObject({ applied: true });
    } finally { c.close(); }
  });

  it("the runner's key gets the company's binding, signed for an hour, which the runner checks", async () => {
    const c = testCloud();
    try {
      c.env.awxPlatform = PLATFORM(new FakeRail());
      const t = await c.tenant("acme");
      expect((await c.req("GET", "/v1/airwallex/binding", { key: t.key })).status).toBe(404);
      await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
      const b = await c.req("GET", "/v1/airwallex/binding", { key: t.key });
      expect(b.status).toBe(200);
      const env = { PURSER_PLATFORM_PUBLIC_KEY: PLATFORM_PUBLIC_KEY, PURSER_TENANT_ID: t.id };
      const checked = checkBinding(b.json.binding as string, c.clock.now, env);
      // Signed and for this company; the account is not active yet, so nothing may be paid from it.
      expect(checked).toEqual({ ok: false, reason: expect.stringMatching(/acct_fake1 is created, not active/) });
      expect(checkBinding(b.json.binding as string, c.clock.now, { ...env, PURSER_TENANT_ID: "t_someoneelse" })).toMatchObject({ ok: false, reason: expect.stringMatching(/another company/) });
    } finally { c.close(); }
  });
});
