// ASVS 4.0.3 V3.3.4 (docs/security/asvs-l2.md): a signed-in person sees their active sessions (when each began, until
// when, the browser and the network it signed in from) and ends any one of them, which stops that token at once while the
// others keep working (cloud/src/sessions.ts; GET /v1/sessions, DELETE /v1/sessions/{id}). Sign-out still ends all.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { SESSIONS_SCHEMA } from "../cloud/src/sessions.js";

let c: TestCloud;
let t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
async function signIn(ua: string, ip: string): Promise<string> {
  const { pk, credential_id } = t.ownerPasskey;
  const ch = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string; challenge: string };
  const a = pk.assert("0x00", { challenge: ch.challenge, origin: ORIGIN, rpId: "cloud.test" });
  const r = await c.req("POST", "/v1/auth/login", { headers: { "user-agent": ua, "cf-connecting-ip": ip }, body: { tenant: "acme", challenge_id: ch.challenge_id, credential_id, assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
  expect(r.status).toBe(200);
  return r.json.session as string;
}
type Item = { id: string; created_at: string; expires_at: string; user_agent: string; ip: string; current: boolean };

describe("active sessions (V3.3.4)", () => {
  it("lists the person's live sessions with when, the browser and the network, marking the current one", async () => {
    const phone = await signIn("Mozilla/5.0 (iPhone)", "198.51.100.7");
    const laptop = await signIn("Mozilla/5.0 (Macintosh)", "203.0.113.9");
    const r = await c.req("GET", "/v1/sessions", { key: laptop });
    expect(r.status).toBe(200);
    const items = r.json.items as Item[];
    expect(items.length).toBeGreaterThanOrEqual(3); // the test setup's own sign-in, the phone and the laptop
    const mine = items.find((i) => i.current)!;
    expect(mine).toMatchObject({ user_agent: "Mozilla/5.0 (Macintosh)", ip: "203.0.113.0/24" });
    expect(items.find((i) => i.user_agent === "Mozilla/5.0 (iPhone)")).toMatchObject({ ip: "198.51.100.0/24", current: false });
    expect(JSON.stringify(r.json)).not.toContain(phone.split(".")[2]!);
  });

  it("ends one session: that token stops at once, the others keep working", async () => {
    const phone = await signIn("Mozilla/5.0 (iPhone)", "198.51.100.7");
    const laptop = await signIn("Mozilla/5.0 (Macintosh)", "203.0.113.9");
    const items = (await c.req("GET", "/v1/sessions", { key: laptop })).json.items as Item[];
    const target = items.find((i) => i.user_agent === "Mozilla/5.0 (iPhone)")!;
    expect((await c.req("DELETE", `/v1/sessions/${target.id}`, { key: laptop })).status).toBe(200);
    expect((await c.req("GET", "/v1/me", { key: phone })).status).toBe(401);
    expect((await c.req("GET", "/v1/me", { key: laptop })).status).toBe(200);
    expect(((await c.req("GET", "/v1/sessions", { key: laptop })).json.items as Item[]).some((i) => i.id === target.id)).toBe(false);
    // An access change in the security log.
    expect(await c.env.sql.all("SELECT kind FROM security_log WHERE route = 'DELETE /v1/sessions/{id}'")).toEqual([{ kind: "access.change" }]);
  });

  it("another person's session, an unknown one, or a key asking: refused", async () => {
    const laptop = await signIn("Mozilla/5.0 (Macintosh)", "203.0.113.9");
    expect((await c.req("DELETE", "/v1/sessions/ses_nosuchsession0", { key: laptop })).status).toBe(404);
    expect((await c.req("GET", "/v1/sessions", { key: t.key })).status).toBe(403);
    const other = await c.tenant("other");
    const theirs = ((await c.req("GET", "/v1/sessions", { key: other.session })).json.items as Item[])[0]!;
    expect((await c.req("DELETE", `/v1/sessions/${theirs.id}`, { key: laptop })).status).toBe(404);
    expect((await c.req("GET", "/v1/me", { key: other.session })).status).toBe(200);
  });

  it("sign-out ends them all, and they leave the list", async () => {
    const laptop = await signIn("Mozilla/5.0 (Macintosh)", "203.0.113.9");
    expect((await c.req("POST", "/v1/auth/logout", { key: laptop })).status).toBe(200);
    const again = await signIn("Mozilla/5.0 (Macintosh)", "203.0.113.9");
    const items = (await c.req("GET", "/v1/sessions", { key: again })).json.items as Item[];
    expect(items).toHaveLength(1);
  });

  it("the table the module makes is the D1 migration's", () => {
    const sql = readFileSync("cloud/migrations/0011_sessions.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(sql).toEqual(SESSIONS_SCHEMA);
  });
});

describe("the console shows them (V3.3.4)", () => {
  it("Settings has a card listing the person's sessions with an End button each, in both languages", async () => {
    const page = await (await import("../cloud/src/app.js")).handle(new Request("https://cloud.test/"), c.env);
    const html = await page.text();
    expect(html).toContain("async function sessionsCard()");
    expect(html).toContain("api('/v1/sessions/'+encodeURIComponent(s.id),{method:'DELETE'})");
    const { MESSAGES } = await import("../src/ui/i18n.js");
    for (const lang of ["en", "nl"] as const) for (const k of ["cs.ses.title", "cs.ses.lede", "cs.ses.this", "cs.ses.end", "cs.ses.ended"] as const) expect(MESSAGES[lang][k], `${lang} ${k}`).toMatch(/\w/);
  });
});
