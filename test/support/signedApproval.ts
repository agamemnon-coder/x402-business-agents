// A genuine passkey approval for tests that approve directly with decide(), synchronously (security review, 20 November,
// finding 1): since the execution guard re-verifies the stored signature behind a passkey approval, an approval made
// with a made-up credential and assertion no longer runs. This enrols a software passkey (src/redteam/authenticator.ts)
// for the approver once per ledger, signs the proposal's exact terms with it, and records the decision and the stored
// signature together, as src/passkey/process.ts does after verifying one.

import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { DB } from "../../src/db/open.js";
import { approvalHashOf } from "../../src/metal/ownersExecute.js";
import { openEnrolment, recordPasskey } from "../../src/passkey/ledger.js";
import { assertionSha256, challengeFor } from "../../src/passkey/webauthn.js";
import { decide, type ProposalStatus } from "../../src/policy/approvals.js";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";

export const TEST_RP = "purser.test";
export const TEST_ORIGIN = `https://${TEST_RP}`;

const keys = new WeakMap<DB, Map<string, FakeAuthenticator>>();
let counter = 0;

/** The COSE public key a software passkey registers, base64url, as enrolment stores it. */
export function cosePublicKeyOf(auth: FakeAuthenticator): string {
  const reg = auth.register({ challenge: "x", origin: TEST_ORIGIN, rpId: TEST_RP });
  const att = isoCBOR.decodeFirst<Map<string, Uint8Array>>(new Uint8Array(Buffer.from(reg.response.attestationObject, "base64url")));
  const auth_ = Buffer.from(att.get("authData")!);
  return Buffer.from(auth_.subarray(55 + auth_.readUInt16BE(53))).toString("base64url");
}

/** The software passkey of `label` in this ledger, enrolled on first use (beside anyone already enrolled). */
export function testPasskey(db: DB, label: string, now: Date): FakeAuthenticator {
  const mine = keys.get(db) ?? new Map<string, FakeAuthenticator>();
  keys.set(db, mine);
  const known = mine.get(label);
  if (known) return known;
  const auth = new FakeAuthenticator();
  const others = db.prepare("SELECT 1 FROM passkeys WHERE status = 'ACTIVE' LIMIT 1").get();
  const { window } = openEnrolment(db, { rpId: TEST_RP, origin: TEST_ORIGIN, ...(others ? { addPerson: label } : {}) }, now);
  recordPasskey(db, { window, credentialId: auth.credentialId, publicKey: cosePublicKeyOf(auth), counter: 0, transports: null, aaguid: null, registrationJson: "{}", label }, now);
  mine.set(label, auth);
  return auth;
}

/**
 * `label`'s passkey signs the exact terms of `proposalId`; the approval and the signature are recorded together.
 * `approver`: the name decide() records (by default the label).
 */
export function approveSigned(db: DB, proposalId: string, now: Date, label = "cfo", approver = label): ProposalStatus {
  const auth = testPasskey(db, label, now);
  const p = db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string; terms_sha256: string };
  const signed = approvalHashOf(p);
  const response = auth.sign({ challenge: challengeFor(signed), origin: TEST_ORIGIN, rpId: TEST_RP, counter: ++counter });
  const sha = assertionSha256(response);
  return db.transaction((): ProposalStatus => {
    const r = decide(db, { proposalId, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver, method: "passkey", signedSha256: signed, passkey: { credentialId: auth.credentialId, assertionSha256: sha } }, now);
    db.prepare("INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sha, proposalId, auth.credentialId, p.terms_sha256, JSON.stringify(response), counter, r === "EXPIRED" ? "TOO_LATE" : "APPROVED", now.toISOString());
    return r;
  })();
}
