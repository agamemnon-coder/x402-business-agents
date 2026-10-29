// The WebAuthn checks the runner makes itself before any passkey decision (tier 2 item 5). To approve, a passkey
// signs a challenge that is the 32 raw bytes of the proposal's terms hash, so a signature is valid for those exact
// terms only. Origin and rpId are the relay's host, as pinned when the passkey was enrolled.

import { createHash } from "node:crypto";
import {
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransport, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { DB } from "../db/open.js";
import { rejectionSha256 } from "../lib/terms.js";
import { passkeyById, type EnrolmentWindow, type PasskeyRow } from "./ledger.js";

const HEX64 = /^[0-9a-f]{64}$/;
/** ES256 (every phone passkey) and RS256 (some Windows Hello keys). */
const ALGORITHMS = [-7, -257];

/** base64url of the hash's 32 raw bytes: what the page passes as the challenge, and what the passkey signs. */
export function challengeFor(termsSha256: string): string {
  if (!HEX64.test(termsSha256)) throw new Error("a terms hash is 64 lowercase hex characters");
  return Buffer.from(termsSha256, "hex").toString("base64url");
}

/** One signature's identity: what the authenticator signed and the signature itself. */
export function assertionSha256(r: AuthenticationResponseJSON): string {
  return createHash("sha256").update(`${r.response.clientDataJSON}.${r.response.authenticatorData}.${r.response.signature}`).digest("hex");
}

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240);
const bytes = (b64url: string) => new Uint8Array(Buffer.from(b64url, "base64url"));

export type Verified<T> = ({ ok: true } & T) | { ok: false; reason: string };

/**
 * Verifies a passkey's signature over a proposal's terms hash. `counter` is the last counter seen; offline
 * re-verification passes 0, which accepts any counter a stored signature carries.
 */
export async function verifyApprovalSignature(
  response: AuthenticationResponseJSON, termsSha256: string, pk: PasskeyRow, counter = pk.counter,
): Promise<Verified<{ newCounter: number }>> {
  try {
    const r = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeFor(termsSha256),
      expectedOrigin: pk.origin,
      expectedRPID: pk.rp_id,
      credential: {
        id: pk.credential_id, publicKey: bytes(pk.public_key), counter,
        transports: pk.transports ? (JSON.parse(pk.transports) as AuthenticatorTransport[]) : undefined,
      },
      requireUserVerification: true,
    });
    if (!r.verified || !r.authenticationInfo.userVerified) return { ok: false, reason: "the signature does not verify" };
    return { ok: true, newCounter: r.authenticationInfo.newCounter };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

/** Verifies a new passkey against the enrolment window's challenge, origin and rpId (attestation "none"). */
export async function verifyEnrolmentResponse(
  response: RegistrationResponseJSON, w: EnrolmentWindow,
): Promise<Verified<{ credentialId: string; publicKey: string; counter: number; aaguid: string; transports: string[] | null }>> {
  try {
    const r = await verifyRegistrationResponse({
      response, expectedChallenge: w.challenge, expectedOrigin: w.origin, expectedRPID: w.rp_id,
      requireUserVerification: true, supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!r.verified) return { ok: false, reason: "the new passkey does not verify" };
    const c = r.registrationInfo.credential;
    return {
      ok: true, credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter,
      aaguid: r.registrationInfo.aaguid, transports: c.transports ?? null,
    };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

export interface Check {
  ok: boolean;
  what: string;
  detail: string;
}

/**
 * `npm run verify`: every approval or rejection made with a passkey is checked again from the stored signature and
 * the pinned public key, against the hash the decision records (a rejection: the rejection hash derived from it).
 * Needs no network and trusts no relay.
 */
export async function reverifyPasskeyApprovals(db: DB): Promise<Check[]> {
  const approvals = db.prepare("SELECT proposal_id, decision, approved_sha256 FROM approvals WHERE method = 'passkey' ORDER BY approval_id").all() as
    { proposal_id: string; decision: "APPROVED" | "REJECTED"; approved_sha256: string }[];
  const checks: Check[] = [];
  for (const a of approvals) {
    const what = `passkey ${a.decision === "APPROVED" ? "approval" : "rejection"} ${a.proposal_id}`;
    const fail = (detail: string) => checks.push({ ok: false, what, detail });
    const s = db.prepare("SELECT * FROM passkey_assertions WHERE proposal_id = ? AND outcome = ?").get(a.proposal_id, a.decision) as
      { assertion_sha256: string; credential_id: string; terms_sha256: string; assertion_json: string; verified_at: string } | undefined;
    if (!s) { fail("no stored signature"); continue; }
    const pk = passkeyById(db, s.credential_id);
    if (!pk) { fail(`signed by an unknown passkey ${s.credential_id.slice(0, 8)}`); continue; }
    if (s.terms_sha256 !== a.approved_sha256) { fail("the signed hash is not the approved hash"); continue; }
    if (Date.parse(pk.enrolled_at) > Date.parse(s.verified_at)) { fail("signed before the passkey was enrolled"); continue; }
    const response = JSON.parse(s.assertion_json) as AuthenticationResponseJSON;
    if (assertionSha256(response) !== s.assertion_sha256) { fail("the stored signature was changed"); continue; }
    const signed = a.decision === "APPROVED" ? a.approved_sha256 : rejectionSha256(a.approved_sha256);
    const v = await verifyApprovalSignature(response, signed, pk, 0);
    if (!v.ok) { fail(v.reason); continue; }
    const over = a.decision === "APPROVED" ? `over ${a.approved_sha256.slice(0, 8)}…` : `rejecting ${a.approved_sha256.slice(0, 8)}…`;
    checks.push({ ok: true, what, detail: `signed by ${pk.label}'s passkey ${pk.credential_id.slice(0, 8)} ${over}` });
  }
  return checks;
}

/**
 * `npm run verify`: once a passkey was enrolled, every approval must have been signed with a passkey. Anything else
 * (a typed prefix from the CLI or the local page, or a row written straight into the ledger) fails the check.
 */
export function approvalMethodChecks(db: DB): Check[] {
  const first = (db.prepare("SELECT MIN(enrolled_at) AS at FROM passkeys").get() as { at: string | null }).at;
  if (!first) return [{ ok: true, what: "approval methods", detail: "no passkey enrolled; approvals by typed hash prefix" }];
  const bad = (db.prepare("SELECT proposal_id, method, created_at FROM approvals WHERE decision = 'APPROVED' AND method != 'passkey' ORDER BY approval_id").all() as
    { proposal_id: string; method: string; created_at: string }[]).filter((a) => Date.parse(a.created_at) >= Date.parse(first));
  if (bad.length === 0) return [{ ok: true, what: "approval methods", detail: "every approval since the passkey was enrolled was signed with it" }];
  return bad.map((a) => ({ ok: false, what: `approval ${a.proposal_id}`, detail: `approved by ${a.method} after a passkey was enrolled; only the passkey may approve` }));
}
