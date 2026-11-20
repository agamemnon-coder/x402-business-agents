// Outside audit, finding 1.3: "make credential additions, revocations and recovery externally observable and alert all
// owners", and "prove a DB writer alone cannot establish a new payment-authorising identity". In Purser Cloud every
// passkey, approval key and security key added, replaced or removed, and each step of an owner recovery, is a security
// event in the company's log and an event to its alert webhook, and is e-mailed to every owner with an address
// (cloud/src/ownerNotice.ts): the other owners, not only the one who acted. Then the database: a person and a sign-in
// passkey written straight into D1 can sign in, but approve nothing: the approval key lives in the company's engine,
// a new one needs an active key's endorsement or a second owner, waits out its 72-hour cooling-off, and every owner is
// told the moment it is added.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailProvider } from "../cloud/src/alerts.js";
import { NOTICE_WORDS } from "../cloud/src/ownerNotice.js";
import { softPasskey } from "../src/metal/softPasskey.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { addPerson, cloudAssertion, issueRecovery, ORIGIN, RP, signIn, testCloud, type TestCloud, type TestPerson, type TestTenant } from "./support/cloud.js";

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
type Mail = { to: string; subject: string; text: string; idempotencyKey: string };

interface World { c: TestCloud; t: TestTenant; b: TestPerson; d: TestPerson; mails: Mail[]; hooks: { type: string; data: Record<string, string> }[] }

/** A company with three owners, each with an e-mail address, the alert webhook and an e-mail provider that records. */
async function world(): Promise<World> {
  const c = testCloud({ engine: true });
  const t = await c.tenant("acme");
  const b = await addPerson(c, "acme", t.session, "owner", "Bea Owner");
  const d = await addPerson(c, "acme", t.session, "owner", "Dirk Owner");
  for (const [id, email] of ([[t.owner, "anna@acme.test"], [b.id, "bea@acme.test"], [d.id, "dirk@acme.test"]] as [string, string][])) await c.env.sql.run("UPDATE users SET email = ? WHERE tenant_id = ? AND id = ?", [email, t.id, id]);
  expect((await c.req("POST", "/v1/webhook", { key: t.session, body: { url: "https://hooks.example.com/purser" } })).status).toBe(200);
  const hooks: World["hooks"] = [];
  c.env.outbound = async (_url, init) => { hooks.push(JSON.parse(String(init.body)) as World["hooks"][number]); return new Response("ok", { status: 200 }); };
  c.env.retryDelayMs = 0;
  const mails: Mail[] = [];
  const email: EmailProvider = { name: "test", send: async (m) => { mails.push(m); return { ok: true, status: 200, retryable: false }; } };
  c.env.alerts = { email };
  return { c, t, b, d, mails, hooks };
}

const EVERY_OWNER = ["anna@acme.test", "bea@acme.test", "dirk@acme.test"];
/** The notice of `kind`: the security event another owner reads, the webhook event, and one e-mail to each owner. */
async function told(w: World, kind: string, hook: string, reader: string = w.b.session, actor?: string) {
  const items = (await w.c.req("GET", "/v1/security/events", { key: reader })).json.items as { kind: string; actor: string; detail: Record<string, string> }[];
  const event = items.filter((e) => e.kind === kind && (actor === undefined || e.actor === actor)).at(-1);
  expect(event, `a ${kind} security event`).toBeDefined();
  const owners = event!.detail.owners_told?.split(" ").sort();
  expect(owners).toEqual([w.t.owner, w.b.id, w.d.id].sort());
  expect(w.hooks.map((h) => h.type)).toContain(hook);
  // One e-mail to each owner, the one who acted and the others, each with its own idempotency key.
  const mails = w.mails.filter((m) => m.subject === `[Purser] ${NOTICE_WORDS[kind]}` && m.text.includes(` by ${event!.actor}.`));
  expect(mails.map((m) => m.to).sort(), `the e-mails about ${kind}`).toEqual(EVERY_OWNER);
  expect(new Set(mails.map((m) => m.idempotencyKey)).size).toBe(3);
  for (const m of w.mails) expect(m.text).not.toMatch(/https?:\/\/|pck_|pcs\.|token/i);
  return event!;
}

async function approvalKey(c: TestCloud, session: string, phone: FakeAuthenticator, extra: (endorse: { challenge: string } | null) => Record<string, unknown> = () => ({})) {
  const s = await c.req("POST", "/v1/engine/passkey/start", { key: session });
  const credential = phone.register({ challenge: s.json.challenge as string, origin: ORIGIN, rpId: RP });
  const first = await c.req("POST", "/v1/engine/passkey/finish", { key: session, body: { code: s.json.code, credential, ...extra(null) } });
  if (first.status !== 409 || first.json.code !== "endorsement_required") return first;
  return c.req("POST", "/v1/engine/passkey/finish", { key: session, body: { code: s.json.code, credential, ...extra(first.json.endorse as { challenge: string }) } });
}

describe("every credential change is a security event told to every owner (cloud/src/ownerNotice.ts)", () => {
  it("a sign-in passkey added and removed", async () => {
    const w = await world();
    try {
      w.mails.length = 0;
      const cfo = await addPerson(w.c, "acme", w.t.session, "cfo", "Carla CFO");
      const added = await told(w, "passkey.enrolled", "security.passkey.enrolled", w.b.session, cfo.id);
      expect(added.actor).toBe(cfo.id);
      expect((await w.c.req("DELETE", `/v1/users/${cfo.id}/passkeys/${cfo.passkey.credential_id}`, { key: w.t.session })).status).toBe(200);
      const removed = await told(w, "passkey.removed", "security.passkey.removed", w.d.session);
      expect(removed).toMatchObject({ actor: w.t.owner, detail: { route: "/v1/users/{id}/passkeys/{credential}" } });
    } finally { w.c.close(); }
  });

  it("an approval key added (the company's first too), replaced, and removed with its person", async () => {
    const w = await world();
    try {
      const first = new FakeAuthenticator();
      expect((await approvalKey(w.c, w.t.session, first)).json).toMatchObject({ how: "first" });
      expect((await told(w, "approval_key.added", "security.approval_key_added")).detail).toMatchObject({ person: w.t.owner, how: "first" });
      // The same person's new key, vouched for by the old one: added, and the old one replaced.
      w.mails.length = 0;
      const next = new FakeAuthenticator();
      const r = await approvalKey(w.c, w.t.session, next, (e) => (e ? { endorsement: first.sign({ challenge: e.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) } : {}));
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect((await told(w, "approval_key.replaced", "security.approval_key_replaced")).detail).toMatchObject({ person: w.t.owner, replaced: first.credentialId.slice(0, 12), credential: next.credentialId.slice(0, 12) });
      // An owner's approval key goes when the person is erased: removed, told to the remaining owners.
      const ownersKey = new FakeAuthenticator();
      const b = await approvalKey(w.c, w.b.session, ownersKey, (e) => (e ? { cosign: { credential_id: w.d.passkey.credential_id, assertion: cloudAssertion(w.d.passkey, e.challenge) } } : {}));
      expect(b.status, JSON.stringify(b.json)).toBe(200);
      w.mails.length = 0;
      expect((await w.c.req("POST", `/v1/users/${w.b.id}/erase`, { key: w.t.session })).status).toBe(200);
      const items = (await w.c.req("GET", "/v1/security/events", { key: w.d.session })).json.items as { kind: string; detail: Record<string, string> }[];
      const gone = items.filter((e) => e.kind === "approval_key.removed").at(-1)!;
      expect(gone.detail).toMatchObject({ person: w.b.id, reason: "erased", revoked: "1" });
      expect(gone.detail.owners_told!.split(" ").sort()).toEqual([w.t.owner, w.d.id].sort());
      expect(w.mails.filter((m) => m.subject === "[Purser] An approval key was removed").map((m) => m.to).sort()).toEqual(["anna@acme.test", "dirk@acme.test"]);
      expect(w.hooks.map((h) => h.type)).toContain("security.approval_key_removed");
    } finally { w.c.close(); }
  });

  it("a security key added", async () => {
    const w = await world();
    try {
      await approvalKey(w.c, w.t.session, new FakeAuthenticator());
      w.mails.length = 0;
      const s = await w.c.req("POST", "/v1/engine/security-key/start", { key: w.t.session });
      const yubi = new FakeAuthenticator("cross-platform");
      expect((await w.c.req("POST", "/v1/engine/security-key/finish", { key: w.t.session, body: { credential: yubi.register({ challenge: s.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
      expect((await told(w, "security_key.added", "security.security_key_added")).detail).toMatchObject({ person: w.t.owner, credential: yubi.credentialId.slice(0, 12) });
    } finally { w.c.close(); }
  });

  it("an owner recovery: requested, issued and completed, each told to every owner", async () => {
    const w = await world();
    try {
      w.mails.length = 0;
      const r = await issueRecovery(w.c, w.t.id, w.b.id);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect((await told(w, "recovery.requested", "security.recovery_requested", w.d.session)).detail).toMatchObject({ owner: w.b.id });
      expect((await told(w, "recovery.issued", "security.recovery_issued", w.d.session)).detail).toMatchObject({ owner: w.b.id, requested_by: "ops-first", approved_by: "ops-second" });
      // The recovered owner enrols a new passkey with the recovery key: completed, and every owner hears of it.
      w.mails.length = 0;
      const e = await w.c.req("POST", `/v1/users/${w.b.id}/enrolment`, { key: r.json.recovery_key as string });
      const pk = softPasskey();
      const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
      const en = await w.c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id,
        x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url"), assertion: cloudAssertion({ pk }, e.json.token as string) } });
      expect(en.status).toBe(201);
      expect(w.hooks.map((h) => h.type)).toContain("security.recovery_completed");
      expect(w.mails.filter((m) => m.subject === "[Purser] An owner recovery was completed").map((m) => m.to).sort()).toEqual(EVERY_OWNER);
    } finally { w.c.close(); }
  });

  it("telling never fails the change: an e-mail provider that fails is logged, and the event and webhook still go", async () => {
    const w = await world();
    try {
      w.c.env.alerts = { email: { name: "down", send: async () => { throw new Error("provider down"); } } };
      expect((await approvalKey(w.c, w.t.session, new FakeAuthenticator())).status).toBe(200);
      const items = (await w.c.req("GET", "/v1/security/events", { key: w.b.session })).json.items as { kind: string; detail: Record<string, string> }[];
      expect(items.find((e) => e.kind === "approval_key.added")!.detail.owners_told!.split(" ")).toHaveLength(3);
      expect(w.hooks.map((h) => h.type)).toContain("security.approval_key_added");
    } finally { w.c.close(); }
  });
});

describe("a person and passkey written straight into the database approve nothing (finding 1.3)", () => {
  it("a planted CFO signs in, but has no approval key; one they add is told to every owner and cools off 72 hours", async () => {
    const w = await world();
    try {
      // The company's real approval key, as its owner set it up.
      const real = new FakeAuthenticator();
      await approvalKey(w.c, w.t.session, real);
      // The DB writer: a CFO and a second "owner", each with a sign-in passkey of the writer's own, no enrolment, no ceremony.
      const plant = async (id: string, role: string) => {
        const pk = softPasskey();
        const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
        await w.c.env.sql.run("INSERT INTO users (tenant_id, id, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)", [w.t.id, id, `Planted ${role}`, role, "2026-11-01T00:00:00.000Z"]);
        await w.c.env.sql.run("INSERT INTO credentials (tenant_id, credential_id, user_id, x, y, counter, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
          [w.t.id, credential_id, id, Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url"), "2026-11-01T00:00:00.000Z"]);
        return { pk, credential_id };
      };
      const cfoPk = await plant("u_plantedcfo", "cfo");
      const ownerPk = await plant("u_plantedown", "owner");
      const session = await signIn(w.c, "acme", cfoPk); // the D1 row is enough to sign in
      // A proposal waits for the CFO's Face ID.
      const up = await w.c.req("POST", "/v1/engine/documents", { key: w.t.session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
      const p = (await w.c.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: w.t.session })).json.proposal as { id: string; terms_sha256: string };
      // The planted sign-in passkey is no approval key: refused, nothing paid.
      const asIs = await w.c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: session, body: { terms_sha256: p.terms_sha256, credential: { id: cfoPk.credential_id, rawId: cfoPk.credential_id, type: "public-key", clientExtensionResults: {}, response: cloudAssertion(cfoPk, challengeFor(p.terms_sha256)) } } });
      expect(asIs.json.status).not.toBe("approved");
      // An approval key of the writer's own needs an active key or a second owner: the planted owner co-signs.
      w.mails.length = 0;
      const evil = new FakeAuthenticator();
      const added = await approvalKey(w.c, session, evil, (e) => (e ? { cosign: { credential_id: ownerPk.credential_id, assertion: cloudAssertion(ownerPk, e.challenge) } } : {}));
      expect(added.status, JSON.stringify(added.json)).toBe(200);
      expect(added.json).toMatchObject({ how: "cosigned", cooling_until: expect.any(String) });
      // Every real owner hears of it at once, while it still approves nothing.
      expect(w.mails.filter((m) => m.subject === "[Purser] An approval key was added").map((m) => m.to)).toEqual(expect.arrayContaining(EVERY_OWNER));
      const refused = await w.c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: session, body: { terms_sha256: p.terms_sha256, credential: evil.sign({ challenge: challengeFor(p.terms_sha256), origin: ORIGIN, rpId: RP, counter: 1 }) } });
      expect(refused.status).toBe(403);
      expect(refused.json).toMatchObject({ code: "cooling_off" });
      expect((await w.c.req("GET", `/v1/engine/proposals/${p.id}`, { key: w.t.session })).json.proposal).toMatchObject({ status: "PENDING_APPROVAL" });
    } finally { w.c.close(); }
  });
});
