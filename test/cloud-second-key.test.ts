// A second key for high-risk payments in Purser Cloud's engine (cloud/src/engine/routes.ts, src/policy/secondKey.ts),
// end to end through the cloud's routes, with two software authenticators: the CFO's platform passkey (Face ID) and a
// cross-platform security key. Test money, the stand-in bank; nothing reaches the network.
// It holds: the security key is registered beside the passkey (a platform credential is refused as one); the CFO's
// rule is a policy change the CFO approves with Face ID, and nothing changes before that; a high-risk invoice payment
// then shows why it is high-risk, waits on Face ID alone with the page's sentence, and pays once the security key
// signs the same terms; a security key alone approves nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

interface Proposal { id: string; kind: string; status: string; terms_sha256: string; challenge: string; second_key?: { reasons: string[]; message: string; security_keys: string[]; signed: { passkey: boolean; security_key: boolean } } }
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
let c: TestCloud, A: TestTenant, counter = 0;
const phone = new FakeAuthenticator("platform");
const yubi = new FakeAuthenticator("cross-platform");
const signed = (a: FakeAuthenticator, p: Proposal) => a.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: ++counter });
const approve = (p: Proposal, a: FakeAuthenticator) => c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: A.session, body: { terms_sha256: p.terms_sha256, credential: signed(a, p) } });
const proposal = async (id: string) => (await c.req("GET", `/v1/engine/proposals/${id}`, { key: A.session })).json.proposal as Proposal;

beforeAll(async () => {
  c = testCloud({ engine: true });
  A = await c.tenant("northwind");
  expect((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
  const start = await c.req("POST", "/v1/engine/passkey/start", { key: A.session });
  expect((await c.req("POST", "/v1/engine/passkey/finish", { key: A.session, body: { code: start.json.code, credential: phone.register({ challenge: start.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
});
afterAll(() => c.close());

describe("a second key for high-risk payments, in Purser Cloud's engine", () => {
  it("registers a security key beside the passkey, and refuses a platform credential as one", async () => {
    const s = await c.req("POST", "/v1/engine/security-key/start", { key: A.session });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    expect(s.json.exclude).toEqual([phone.credentialId]);
    const wrong = await c.req("POST", "/v1/engine/security-key/finish", { key: A.session, body: { credential: new FakeAuthenticator("platform").register({ challenge: s.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error).toMatch(/not a security key/);
    const ok = await c.req("POST", "/v1/engine/security-key/finish", { key: A.session, body: { credential: yubi.register({ challenge: s.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    expect(ok.json).toEqual({ credential_id: yubi.credentialId });
    // A key is not a person: it registers no security key.
    expect((await c.req("POST", "/v1/engine/security-key/start", { key: A.key })).status).toBe(403);
  });

  it("switches the rule on only with the CFO's Face ID on the policy change", async () => {
    // As the console sends it: every trigger as it stands on screen; only what changes is proposed.
    const r = await c.req("POST", "/v1/engine/policy/second-key", { key: A.session, body: { changes: [{ key: "approval.second_key_eur", to: "1000.00" }, { key: "approval.second_key_new_payee", to: "off" }, { key: "approval.second_key_bank_changed", to: "off" }, { key: "approval.second_key_new_country", to: "off" }] } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const change = r.json.proposal as Proposal;
    expect(change).toMatchObject({ kind: "policy_change", status: "PENDING_APPROVAL" });
    expect((await c.req("POST", "/v1/engine/policy/second-key", { key: A.session, body: { changes: [{ key: "approval.four_eyes_eur", to: "" }] } })).status).toBe(409);
    expect((await approve(change, phone)).json).toMatchObject({ status: "approved" });
    expect((await proposal(change.id)).status).toBe("EXECUTED");
  });

  it("holds a high-risk payment on Face ID alone, says why, and pays once the security key signs the same terms", async () => {
    expect((await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex.pdf", mime: "application/pdf", base64: b64(await pdfOf(EN)) } })).status).toBe(200);
    const p = (await c.req("POST", "/v1/engine/invoices/AP-0001/pay", { key: A.session })).json.proposal as Proposal;
    expect(p.second_key).toEqual({ reasons: ["amount at or above EUR 1000.00"], message: "High-risk: amount at or above EUR 1000.00. It needs your Face ID and your security key.", security_keys: [yubi.credentialId], signed: { passkey: false, security_key: false } });
    const first = await approve(p, phone);
    expect(first.json).toMatchObject({ status: "second_key", message: "High-risk: amount at or above EUR 1000.00. Touch your security key.", settled: null });
    expect((await proposal(p.id)).status).toBe("PENDING_APPROVAL");
    expect((await proposal(p.id)).second_key!.signed).toEqual({ passkey: true, security_key: false });
    const second = await approve(p, yubi);
    expect(second.json).toMatchObject({ status: "approved" });
    expect(["EXECUTED", "EXECUTING"]).toContain((await proposal(p.id)).status);
    expect(challengeFor(p.terms_sha256)).toBe(p.challenge);
  });
});
