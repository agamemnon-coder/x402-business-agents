// The runner's side of passkey approvals: it verifies every enrolment and every signature itself, so the relay
// (and anything that pretends to be the phone) cannot approve. Signatures come from a software authenticator.
import { describe, expect, it } from "vitest";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { canonicalTerms, sha256Hex, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { activePasskey, openEnrolment, openWindow } from "../src/passkey/ledger.js";
import { processAssertion, processPolicyRequest, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { assertionSha256, challengeFor, reverifyPasskeyApprovals } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "./fakes/authenticator.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-10-30T14:00:00Z");
let tickets = 0;

const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: typeof body === "string" ? body : JSON.stringify(body), received_at: t0.toISOString() });

function propose(db: DB, id: string, total = "0.60", expires = "2026-10-30T14:10:00Z"): string {
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: expires, total };
  createProposal(db, { terms, createdBy: "support" }, t0);
  return termsHash(terms);
}

async function enrolled(auth = new FakeAuthenticator()) {
  const db = openDb(":memory:");
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, item("registration", { code, credential }), { label: "max" }, t0);
  expect(out).toMatchObject({ status: "enrolled", credentialId: auth.credentialId });
  return { db, auth };
}

const approval = (id: string, hash: string, credential: AuthenticationResponseJSON) => item("assertion", { proposal_id: id, terms_sha256: hash, credential }, id);
const count = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

describe("enrolment", () => {
  it("pins a passkey created against the window's challenge, origin and code", async () => {
    const { db, auth } = await enrolled();
    const pk = activePasskey(db)!;
    expect(pk).toMatchObject({ credential_id: auth.credentialId, counter: 0, rp_id: RP, origin: ORIGIN, label: "max", status: "ACTIVE" });
    expect(JSON.parse(pk.transports!)).toEqual(["internal", "hybrid"]);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'passkey.enrolled'")).toBe(1);
  });

  it("refuses the wrong code, another challenge, another origin and a missing Face ID; the window stays open", async () => {
    const db = openDb(":memory:");
    const auth = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
    const good = { challenge: window.challenge, origin: ORIGIN, rpId: RP };
    const cases: [unknown, RegExp][] = [
      [{ code: "AAAA-AAAA", credential: auth.register(good) }, /code/],
      [{ code, credential: auth.register({ ...good, challenge: challengeFor("ab".repeat(32)) }) }, /challenge/],
      [{ code, credential: auth.register({ ...good, origin: "https://evil.example" }) }, /origin/],
      [{ code, credential: auth.register({ ...good, rpId: "evil.example" }) }, /RP ID/i],
      [{ code, credential: auth.register({ ...good, userVerified: false }) }, /verif/i],
      ["{not json", /malformed/],
      [{ code, credential: { id: auth.credentialId } }, /malformed/],
    ];
    for (const [body, reason] of cases) {
      const out = await processRegistration(db, item("registration", body), { label: "max" }, t0);
      expect(out.status, String(reason)).toBe("refused");
      expect(out.message).toMatch(reason);
    }
    expect(activePasskey(db)).toBeNull();
    expect(openWindow(db, t0)?.window_id).toBe(window.window_id);
    // Only submissions that carried the right code reach the audit log; a wrong code or junk is not the approver.
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'passkey.enrol_refused'")).toBe(4);
    const late = new Date("2026-10-30T14:10:00Z");
    const out = await processRegistration(db, item("registration", { code, credential: auth.register(good) }), { label: "max" }, late);
    expect(out).toMatchObject({ status: "refused", message: expect.stringMatching(/no enrolment window/) });
  });
});

describe("approval by passkey", () => {
  it("approves the proposal whose exact hash the passkey signed, and keeps the signature", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const out = await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(out).toMatchObject({ status: "approved", proposalId: "P-0001" });
    expect(db.prepare("SELECT method, approved_sha256, approver FROM approvals").get())
      .toEqual({ method: "passkey", approved_sha256: hash, approver: `max (passkey ${auth.credentialId.slice(0, 8)})` });
    expect(db.prepare("SELECT outcome, terms_sha256, counter FROM passkey_assertions").get()).toEqual({ outcome: "APPROVED", terms_sha256: hash, counter: 1 });
    expect(activePasskey(db)!.counter).toBe(1);
    expect(status(db, "P-0001")).toBe("APPROVED");
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("refuses a signature over another proposal's terms", async () => {
    const { db, auth } = await enrolled();
    const h1 = propose(db, "P-0001");
    const h2 = propose(db, "P-0002", "6.00");
    const out = await processAssertion(db, approval("P-0001", h1, auth.sign({ challenge: challengeFor(h2), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(out).toMatchObject({ status: "refused", message: expect.stringMatching(/challenge/) });
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(0);
    expect([status(db, "P-0001"), status(db, "P-0002")]).toEqual(["PENDING_APPROVAL", "PENDING_APPROVAL"]);
    // Anyone can post a signature that does not verify; it is refused without writing to the audit log.
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'passkey.refused'")).toBe(0);
  });

  it("refuses another origin, another rpId and a signature without Face ID", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const ok = { challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 };
    for (const [bad, reason] of [[{ origin: "https://evil.example" }, /origin/], [{ rpId: "evil.example" }, /RP ID/i], [{ userVerified: false }, /verif/i]] as const) {
      const out = await processAssertion(db, approval("P-0001", hash, auth.sign({ ...ok, ...bad })), t0);
      expect(out.status).toBe("refused");
      expect(out.message).toMatch(reason);
    }
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(0);
  });

  it("refuses a passkey that was never enrolled, and one that was replaced", async () => {
    const first = new FakeAuthenticator();
    const { db } = await enrolled(first);
    const hash = propose(db, "P-0001");
    const stranger = new FakeAuthenticator();
    const s = await processAssertion(db, approval("P-0001", hash, stranger.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(s).toMatchObject({ status: "refused", message: expect.stringMatching(/not enrolled/) });

    const second = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, replace: true }, t0);
    await processRegistration(db, item("registration", { code, credential: second.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, t0);
    const r = await processAssertion(db, approval("P-0001", hash, first.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(r).toMatchObject({ status: "refused", message: expect.stringMatching(/revoked/) });
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(0);
  });

  it("refuses a counter that goes backwards (a cloned key)", async () => {
    const { db, auth } = await enrolled();
    const h1 = propose(db, "P-0001");
    const h2 = propose(db, "P-0002", "6.00");
    expect((await processAssertion(db, approval("P-0001", h1, auth.sign({ challenge: challengeFor(h1), origin: ORIGIN, rpId: RP, counter: 5 })), t0)).status).toBe("approved");
    const out = await processAssertion(db, approval("P-0002", h2, auth.sign({ challenge: challengeFor(h2), origin: ORIGIN, rpId: RP, counter: 3 })), t0);
    expect(out).toMatchObject({ status: "refused", message: expect.stringMatching(/counter/) });
    expect(status(db, "P-0002")).toBe("PENDING_APPROVAL");
    expect(activePasskey(db)!.counter).toBe(5);
  });

  it("refuses when the stored terms no longer match their hash", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    db.prepare("UPDATE proposals SET terms_json = replace(terms_json, '0.60', '6.00') WHERE proposal_id = 'P-0001'").run();
    const out = await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(out).toMatchObject({ status: "refused", message: expect.stringMatching(/terms/) });
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(0);
  });

  it("records a valid signature that arrives after expiry as too late, and approves nothing", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const late = new Date("2026-10-30T14:10:01Z");
    const out = await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), late);
    expect(out).toMatchObject({ status: "too_late", proposalId: "P-0001" });
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(0);
    expect(status(db, "P-0001")).toBe("EXPIRED");
    expect(db.prepare("SELECT outcome FROM passkey_assertions").get()).toEqual({ outcome: "TOO_LATE" });
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'approval.too_late'")).toBe(1);
  });

  it("processes the same assertion once; a second Face ID on an approved proposal changes nothing", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const signed = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
    expect((await processAssertion(db, approval("P-0001", hash, signed), t0)).status).toBe("approved");
    expect(await processAssertion(db, approval("P-0001", hash, signed), t0)).toMatchObject({ status: "already", message: expect.stringMatching(/APPROVED/) });
    const again = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 2 });
    expect(await processAssertion(db, approval("P-0001", hash, again), t0)).toMatchObject({ status: "already" });
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.approved'")).toBe(1);
  });

  it("refuses malformed submissions and unknown proposals", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const signed = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
    for (const body of ["nope", { proposal_id: "P-0001" }, { proposal_id: "P-0001", terms_sha256: hash, credential: { ...signed, type: "other" } }]) {
      expect((await processAssertion(db, item("assertion", body, "P-0001"), t0)).message).toMatch(/malformed/);
    }
    expect(await processAssertion(db, approval("P-0404", hash, signed), t0)).toMatchObject({ status: "refused", message: expect.stringMatching(/no proposal P-0404/) });
    expect(count(db, "SELECT COUNT(*) AS n FROM approvals")).toBe(0);
  });
});

describe("policy change from the phone", () => {
  const change = { key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" };
  const termsOf = (over: Record<string, unknown> = {}) => ({
    schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: "C-0a1b2c3d", expires_at: "2026-10-30T14:10:00Z", changes: [change], reason: "prices rising", ...over,
  });
  const request = (auth: FakeAuthenticator, terms: Record<string, unknown>, signedHash?: string) => {
    const canonical = canonicalTerms(terms as Terms);
    const hash = sha256Hex(canonical);
    return item("policy", { canonical, terms_sha256: hash, credential: auth.sign({ challenge: challengeFor(signedHash ?? hash), origin: ORIGIN, rpId: RP, counter: 1 }) });
  };

  it("creates and approves the change the passkey signed, in one step", async () => {
    const { db, auth } = await enrolled();
    const out = await processPolicyRequest(db, request(auth, termsOf()), t0);
    expect(out).toMatchObject({ status: "approved", proposalId: "C-0a1b2c3d" });
    expect(db.prepare("SELECT kind, status, created_by FROM proposals").get()).toEqual({ kind: "policy_change", status: "APPROVED", created_by: "human" });
    expect(db.prepare("SELECT method FROM approvals").get()).toEqual({ method: "passkey" });
  });

  it("creates nothing for an unsigned, stale, reused, far-off or malformed request", async () => {
    const { db, auth } = await enrolled();
    const cases: [InboxItem, RegExp][] = [
      [request(auth, termsOf(), "ab".repeat(32)), /challenge/],
      [request(auth, termsOf({ changes: [{ ...change, from: "0.05" }] })), /is now/],
      [request(auth, termsOf({ expires_at: "2026-10-30T15:00:00Z" })), /expire/],
      [request(auth, termsOf({ proposal_id: "P-0009" })), /C-/],
      [request(auth, termsOf({ changes: [{ ...change, label: "Something else" }] })), /labelled/],
      [item("policy", { canonical: "{}", terms_sha256: "0".repeat(64), credential: {} }), /malformed/],
    ];
    for (const [it_, reason] of cases) expect((await processPolicyRequest(db, it_, t0)).message).toMatch(reason);
    expect(count(db, "SELECT COUNT(*) AS n FROM proposals")).toBe(0);
    expect((await processPolicyRequest(db, request(auth, termsOf()), t0)).status).toBe("approved");
    expect(await processPolicyRequest(db, request(auth, termsOf({ reason: "again" })), t0)).toMatchObject({ status: "refused", message: expect.stringMatching(/already exists|is now/) });
  });
});

describe("after a restart", () => {
  it("answers a signature it already handled with its first outcome, and runs nothing again", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const signed = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 });
    expect((await processAssertion(db, approval("P-0001", hash, signed), t0)).status).toBe("approved");
    db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = 'P-0001'").run();
    expect(await processAssertion(db, approval("P-0001", hash, signed), t0)).toMatchObject({ status: "already", ack: "executed" });
  });

  it("answers an enrolment it already accepted as enrolled", async () => {
    const db = openDb(":memory:");
    const auth = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
    const body = { code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) };
    expect((await processRegistration(db, item("registration", body), { label: "max" }, t0)).status).toBe("enrolled");
    expect(await processRegistration(db, item("registration", body), { label: "max" }, t0)).toMatchObject({ status: "enrolled", credentialId: auth.credentialId });
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event LIKE 'passkey.enrol%'")).toBe(2);
  });
});

describe("price options", () => {
  const option = (id: string, opt: string, price: string): Terms => ({
    schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: "2026-10-30T15:00:00Z", option: opt, query_price: price,
    steps: [{ order: "1", agent: "treasury", replaces_credential_hash: "0xaa", credential_hash: "0x01" }],
  });

  it("refuses a second option once another option for the same mandates is approved", async () => {
    const { db, auth } = await enrolled();
    const [a, b] = [option("P-0001", "A", "0.05"), option("P-0002", "B", "0.07")];
    createProposal(db, { terms: a, createdBy: "treasury" }, t0);
    createProposal(db, { terms: b, createdBy: "treasury" }, t0);
    const sign = (h: string, counter: number) => auth.sign({ challenge: challengeFor(h), origin: ORIGIN, rpId: RP, counter });
    expect((await processAssertion(db, approval("P-0002", termsHash(b), sign(termsHash(b), 1)), t0)).status).toBe("approved");
    const out = await processAssertion(db, approval("P-0001", termsHash(a), sign(termsHash(a), 2)), t0);
    expect(out).toMatchObject({ status: "refused", message: expect.stringMatching(/another option, P-0002, was already approved/) });
    expect(status(db, "P-0001")).toBe("PENDING_APPROVAL");
  });
});

describe("offline re-verification", () => {
  it("re-verifies every stored passkey approval, and catches a changed signature", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(await reverifyPasskeyApprovals(db)).toEqual([{ ok: true, what: "passkey approval P-0001", detail: expect.stringContaining(auth.credentialId.slice(0, 8)) }]);

    const other = auth.sign({ challenge: challengeFor("cd".repeat(32)), origin: ORIGIN, rpId: RP, counter: 1 });
    const row = db.prepare("SELECT assertion_json FROM passkey_assertions").get() as { assertion_json: string };
    const tampered = JSON.parse(row.assertion_json) as AuthenticationResponseJSON;
    tampered.response.signature = other.response.signature;
    // The table is not append-only, so an edit is possible; verify must notice it.
    db.prepare("UPDATE passkey_assertions SET assertion_json = ?").run(JSON.stringify(tampered));
    const [check] = await reverifyPasskeyApprovals(db);
    expect(check).toMatchObject({ ok: false, what: "passkey approval P-0001" });
  });

  it("catches a stored signature that is consistent with its hash but does not verify", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    const forged = auth.sign({ challenge: challengeFor("cd".repeat(32)), origin: ORIGIN, rpId: RP, counter: 1 });
    db.prepare("UPDATE passkey_assertions SET assertion_json = ?, assertion_sha256 = ?").run(JSON.stringify(forged), assertionSha256(forged));
    expect((await reverifyPasskeyApprovals(db))[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/challenge/) });
  });

  it("flags a passkey approval that has no stored signature", async () => {
    const { db } = await enrolled();
    const hash = propose(db, "P-0001");
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-0001', 'APPROVED', ?, 'max', 'passkey', ?, ?)")
      .run(hash, hash.slice(0, 8), t0.toISOString());
    expect(await reverifyPasskeyApprovals(db)).toEqual([{ ok: false, what: "passkey approval P-0001", detail: "no stored signature" }]);
  });
});
