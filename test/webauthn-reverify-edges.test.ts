// The runner's own WebAuthn checks (src/passkey/webauthn.ts), the paths the other files leave: a new passkey whose
// browser named no transports is enrolled with none; and npm run verify re-checks a passkey approval whose proposal is
// gone from the ledger against the approved hash itself, while it fails one whose stored signature is over other terms.
// A virtual test authenticator; no network.
import { describe, expect, it } from "vitest";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration } from "../src/passkey/process.js";
import { assertionSha256, challengeFor, reverifyPasskeyApprovals, verifyEnrolmentResponse } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const now = new Date("2026-11-20T10:00:00Z");

describe("a new passkey", () => {
  it("whose browser named no transports is enrolled with none", async () => {
    const db = openDb(":memory:");
    const { window } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
    const credential = new FakeAuthenticator().register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) as RegistrationResponseJSON;
    delete (credential.response as { transports?: unknown }).transports;
    expect(await verifyEnrolmentResponse(credential, window)).toMatchObject({ ok: true, transports: null, credentialId: credential.id });
  });
});

describe("npm run verify's re-check of a passkey approval", () => {
  async function approved() {
    const db = openDb(":memory:");
    const auth = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
    await processRegistration(db, { ticket: "e", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), received_at: now.toISOString() }, { label: "max" }, now);
    confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
    const terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-20T11:00:00Z", total: "0.10" } as Terms;
    createProposal(db, { terms, createdBy: "support" }, now);
    const hash = termsHash(terms);
    const out = await processAssertion(db, { ticket: "a", kind: "assertion", proposal_id: "P-0001", body: JSON.stringify({ proposal_id: "P-0001", terms_sha256: hash, credential: auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 }) }), received_at: now.toISOString() }, now);
    expect(out.status).toBe("approved");
    return { db, auth, hash };
  }

  it("a proposal gone from the ledger is checked against the approved hash itself", async () => {
    const { db } = await approved();
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM proposals WHERE proposal_id = 'P-0001'").run();
    expect(await reverifyPasskeyApprovals(db)).toEqual([{ ok: true, what: "passkey approval P-0001", detail: expect.stringMatching(/^signed by max's passkey \S+ over [0-9a-f]{8}…$/) }]);
  });

  it("a stored signature over other terms fails", async () => {
    const { db, auth } = await approved();
    const other = auth.sign({ challenge: challengeFor("b".repeat(64)), origin: ORIGIN, rpId: RP, counter: 2 });
    db.prepare("UPDATE passkey_assertions SET assertion_json = ?, assertion_sha256 = ?").run(JSON.stringify(other), assertionSha256(other));
    const [check] = await reverifyPasskeyApprovals(db);
    expect(check).toMatchObject({ ok: false, what: "passkey approval P-0001" });
  });
});
