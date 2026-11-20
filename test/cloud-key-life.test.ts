// The approval key's life in Purser Cloud (review finding 2, 20 Nov): a key added while one is active needs an active
// key's endorsement, a second owner's co-signature or a two-admin recovery; it then cools off before it approves (72
// hours here, never under 24 in the deployed Worker, 0 for a /try test company, labelled). Every new key and every
// refusal is told to the owners (security events and the alert webhook) and the refusals are in the security log.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { coolingOffMs } from "../cloud/src/engine/routes.js";
import { readSecurityLog } from "../cloud/src/securityLog.js";
import { endorsementChallenge } from "../src/engine/host.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { addPerson, cloudAssertion, issueRecovery, ORIGIN, RP, signIn, testCloud, type TestCloud } from "./support/cloud.js";

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

const HOUR = 3_600_000;
/** A cooling-off that ends 72 hours from now, as the engine's clock reads now (it runs on the test's system time). */
const in72h = expect.toSatisfy((iso: unknown) => typeof iso === "string" && Math.abs(Date.parse(iso) - Date.now() - 72 * HOUR) < 60_000, "72 hours from now") as unknown as string;

function hooks(c: TestCloud): string[] {
  const types: string[] = [];
  c.env.outbound = async (_url, init) => { types.push((JSON.parse(String(init.body)) as { type: string }).type); return new Response("ok", { status: 200 }); };
  c.env.retryDelayMs = 0;
  return types;
}
const kinds = async (c: TestCloud, session: string) => ((await c.req("GET", "/v1/security/events", { key: session })).json.items as { kind: string; detail: Record<string, unknown> }[]);

/** Start and finish one approval key for a session; `extra` goes with the finish. */
async function enrol(c: TestCloud, session: string, phone: FakeAuthenticator, extra: (endorse: { challenge: string; keys: string[] } | null) => Record<string, unknown> = () => ({})) {
  const s = await c.req("POST", "/v1/engine/passkey/start", { key: session });
  if (s.status !== 200) throw new Error(JSON.stringify(s.json));
  const credential = phone.register({ challenge: s.json.challenge as string, origin: ORIGIN, rpId: RP });
  const first = await c.req("POST", "/v1/engine/passkey/finish", { key: session, body: { code: s.json.code, credential, ...extra(null) } });
  if (first.status !== 409 || first.json.code !== "endorsement_required") return { first, final: first };
  const endorse = first.json.endorse as { challenge: string; keys: string[] };
  const final = await c.req("POST", "/v1/engine/passkey/finish", { key: session, body: { code: s.json.code, credential, ...extra(endorse) } });
  return { first, final };
}

async function proposal(c: TestCloud, session: string) {
  const up = await c.req("POST", "/v1/engine/documents", { key: session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
  if (up.status !== 200) throw new Error(JSON.stringify(up.json));
  const id = (up.json.invoice as { id: string }).id;
  const filed = await c.req("POST", `/v1/engine/invoices/${id}/pay`, { key: session });
  if (filed.status !== 200) throw new Error(JSON.stringify(filed.json));
  return filed.json.proposal as { id: string; terms_sha256: string; challenge: string };
}

describe("the cooling-off's length", () => {
  it("72 hours by default, as configured otherwise, never under 24 in production; a /try test company waits 0", () => {
    expect(coolingOffMs({}, "t_acme0000000")).toBe(72 * HOUR);
    expect(coolingOffMs({ approvalKeyCoolingHours: 30 }, "t_acme0000000")).toBe(30 * HOUR);
    expect(coolingOffMs({ approvalKeyCoolingHours: 2 }, "t_acme0000000")).toBe(2 * HOUR);
    expect(coolingOffMs({ approvalKeyCoolingHours: 2, production: true }, "t_acme0000000")).toBe(24 * HOUR);
    expect(coolingOffMs({ approvalKeyCoolingHours: 0, production: true }, "t_acme0000000")).toBe(24 * HOUR);
    expect(coolingOffMs({ production: true }, "t_try_abcdef123")).toBe(0);
  });
});

describe("a second approval key", () => {
  it("needs an active key's endorsement; then it cools off for 72 hours, refused with its reason, logged and told to every owner", async () => {
    const c = testCloud({ engine: true });
    try {
      const t = await c.tenant("acme");
      expect((await c.req("POST", "/v1/company", { key: t.session, body: { language: "en" } })).status).toBe(200);
      await c.req("POST", "/v1/webhook", { key: t.session, body: { url: "https://hooks.example.com/purser" } });
      const sent = hooks(c);
      const owner = new FakeAuthenticator();
      // The company's first key: as before.
      const one = await enrol(c, t.session, owner);
      expect(one.final.status, JSON.stringify(one.final.json)).toBe(200);
      expect(one.final.json).toMatchObject({ how: "first", cooling_until: null });

      const cfo = await addPerson(c, "acme", t.session, "cfo", "Carla CFO");
      // (Each try makes a new credential, as a browser does.)
      const phone = new FakeAuthenticator(), first = new FakeAuthenticator(), self = new FakeAuthenticator();
      // No endorsement: 409 with the challenge an active key signs, and nothing enrolled.
      const bare = await enrol(c, cfo.session, first);
      expect(bare.first.status).toBe(409);
      expect(bare.first.json).toMatchObject({ code: "endorsement_required", endorse: { credential_id: first.credentialId, challenge: endorsementChallenge(first.credentialId, first.spkiSha256), keys: [owner.credentialId] } });
      expect(bare.first.json.error).toMatch(/already active/);

      // A forged endorsement (the CFO's own new key signing for itself is not an active key): refused, 403, logged.
      const forged = await enrol(c, cfo.session, self, (e) => (e ? { endorsement: self.sign({ challenge: e.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } : {}));
      expect(forged.final.status).toBe(403);
      expect(forged.final.json.code).toBe("endorsement_refused");

      // The owner's active approval key vouches for it: enrolled, cooling off for 72 hours.
      const ok = await enrol(c, cfo.session, phone, (e) => (e ? { endorsement: owner.sign({ challenge: e.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } : {}));
      expect(ok.final.status, JSON.stringify(ok.final.json)).toBe(200);
      expect(ok.final.json).toMatchObject({ credential_id: phone.credentialId, how: "endorsed", cooling_until: in72h });
      // Every owner hears of it: a security event in the console and the webhook.
      const ev = await kinds(c, t.session);
      expect(ev.find((x) => x.kind === "approval_key.added" && x.detail.how !== "first")!.detail).toMatchObject({ person: cfo.id, how: "endorsed", cooling_until: in72h });
      expect(ev.find((x) => x.kind === "approval_key.refused")!.detail).toMatchObject({ person: cfo.id, code: "endorsement_refused" });
      expect(sent).toEqual(expect.arrayContaining(["security.approval_key_added", "security.approval_key_refused"]));
      // The status says whose key it is and until when it cools off; the CFO's own is marked.
      const st = await c.req("GET", "/v1/engine", { key: cfo.session });
      expect(st.json.my_passkey).toMatchObject({ credential_id: phone.credentialId, cooling_until: in72h });

      // An approval inside the cooling-off: 403 cooling_off, nothing paid, in the security log and told to the owners.
      const p = await proposal(c, t.session);
      const refused = await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: cfo.session, body: { terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } });
      expect(refused.status).toBe(403);
      expect(refused.json).toMatchObject({ code: "cooling_off", status: "refused", cooling_until: in72h });
      expect(refused.json.error).toMatch(/cooling-off until .* Nothing was paid\.$/);
      expect((await c.req("GET", `/v1/engine/proposals/${p.id}`, { key: t.session })).json.proposal).toMatchObject({ status: "PENDING_APPROVAL" });
      const log = (await readSecurityLog(c.env.sql, { kind: "access.denied", limit: 50 })).items as { route: string; detail_json?: string; detail?: Record<string, unknown> }[];
      expect(JSON.stringify(log.filter((r) => r.route === "POST /v1/engine/proposals/{id}/approve"))).toMatch(/cooling-off/);
      expect((await kinds(c, t.session)).some((x) => x.kind === "approval.refused_cooling_off")).toBe(true);
      expect(sent).toContain("security.approval_refused_cooling_off");

      // (That it approves once the cooling-off is over is test/engine-key-life.test.ts, on the engine's clock.)
    } finally { c.close(); }
  });

  it("or a second owner's co-signature with their own passkey; the person enrolling cannot co-sign for themselves, nor can a non-owner", async () => {
    const c = testCloud({ engine: true });
    try {
      const t = await c.tenant("acme");
      const first = new FakeAuthenticator();
      expect((await enrol(c, t.session, first)).final.status).toBe(200);
      const second = await addPerson(c, "acme", t.session, "owner", "Second Owner");
      const viewer = await addPerson(c, "acme", t.session, "viewer", "Vera");
      const phone = new FakeAuthenticator();
      const self = await enrol(c, second.session, new FakeAuthenticator(), (e) => (e ? { cosign: { credential_id: second.passkey.credential_id, assertion: cloudAssertion(second.passkey, e.challenge) } } : {}));
      expect(self.final.status).toBe(403);
      expect(self.final.json.error).toMatch(/another owner/);
      const notOwner = await enrol(c, second.session, new FakeAuthenticator(), (e) => (e ? { cosign: { credential_id: viewer.passkey.credential_id, assertion: cloudAssertion(viewer.passkey, e.challenge) } } : {}));
      expect(notOwner.final.status).toBe(403);
      // Signed over another challenge: refused.
      const wrong = await enrol(c, second.session, new FakeAuthenticator(), (e) => (e ? { cosign: { credential_id: t.ownerPasskey.credential_id, assertion: cloudAssertion(t.ownerPasskey, "b3RoZXItY2hhbGxlbmdl") } } : {}));
      expect(wrong.final.status).toBe(403);
      const ok = await enrol(c, second.session, phone, (e) => (e ? { cosign: { credential_id: t.ownerPasskey.credential_id, assertion: cloudAssertion(t.ownerPasskey, e.challenge) } } : {}));
      expect(ok.final.status, JSON.stringify(ok.final.json)).toBe(200);
      expect(ok.final.json).toMatchObject({ how: "cosigned", cooling_until: in72h });
      expect((await kinds(c, t.session)).find((x) => x.kind === "approval_key.added" && x.detail.how !== "first")!.detail).toMatchObject({ how: "cosigned", by: t.owner });
    } finally { c.close(); }
  });

  it("after a two-admin recovery the recovered owner may enrol one approval key without an endorsement; it cools off, and a second one needs an endorsement again", async () => {
    const c = testCloud({ engine: true });
    try {
      const t = await c.tenant("acme");
      const lost = new FakeAuthenticator();
      expect((await enrol(c, t.session, lost)).final.status).toBe(200);
      // The owner lost both phones: a recovery by two platform admins, then a new sign-in passkey.
      const r = await issueRecovery(c, t.id, t.owner);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      const e = await c.req("POST", `/v1/users/${t.owner}/enrolment`, { key: r.json.recovery_key as string });
      const { softPasskey } = await import("../src/metal/softPasskey.js");
      const pk = softPasskey();
      const credential_id = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
      const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
      expect((await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id, x, y, assertion: cloudAssertion({ pk }, e.json.token as string) } })).status).toBe(201);
      const session = await signIn(c, "acme", { pk, credential_id });
      const phone = new FakeAuthenticator();
      const ok = await enrol(c, session, phone);
      expect(ok.final.status, JSON.stringify(ok.final.json)).toBe(200);
      expect(ok.final.json).toMatchObject({ how: "recovery", cooling_until: in72h });
      // The recovery was good for one key.
      const again = await enrol(c, session, new FakeAuthenticator());
      expect(again.final.status).toBe(409);
    } finally { c.close(); }
  });
});
