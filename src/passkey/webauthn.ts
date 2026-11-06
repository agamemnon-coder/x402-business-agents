// The WebAuthn checks the runner makes itself before any passkey decision (tier 2 item 5). To approve, a passkey
// signs a challenge that is the 32 raw bytes of the proposal's terms hash, so a signature is valid for those exact
// terms only. Origin and rpId are the relay's host, as pinned when the passkey was enrolled.

import { approvalHashOf } from "../metal/ownersExecute.js";
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
 * Whether the browser ran the ceremony inside a frame on another site. Our pages are never framed (CSP
 * frame-ancestors 'none'), the relay Worker refuses one, and so does the runner, which trusts nothing the relay
 * passes on: @simplewebauthn accepts crossOrigin without a topOrigin (Safari sends none), so it is checked here (A1).
 */
function framed(clientDataJSON: string): boolean {
  try {
    return (JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { crossOrigin?: unknown }).crossOrigin === true;
  } catch {
    return false; // not JSON: the verifier refuses it anyway
  }
}
const FRAMED = "the passkey was used inside a frame on another site (cross-origin)";

/**
 * Verifies a passkey's signature over a proposal's terms hash. `counter` is the last counter seen; offline
 * re-verification passes 0, which accepts any counter a stored signature carries.
 */
export async function verifyApprovalSignature(
  response: AuthenticationResponseJSON, termsSha256: string, pk: PasskeyRow, counter = pk.counter,
): Promise<Verified<{ newCounter: number }>> {
  if (framed(response.response.clientDataJSON)) return { ok: false, reason: FRAMED };
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
  if (framed(response.response.clientDataJSON)) return { ok: false, reason: FRAMED };
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
  const approvals = db.prepare("SELECT proposal_id, decision, approved_sha256, approver FROM approvals WHERE method = 'passkey' ORDER BY approval_id").all() as
    { proposal_id: string; decision: "APPROVED" | "REJECTED"; approved_sha256: string; approver: string }[];
  const checks: Check[] = [];
  for (const a of approvals) {
    const what = `passkey ${a.decision === "APPROVED" ? "approval" : "rejection"} ${a.proposal_id}`;
    // E1: an approval by two people ("max (passkey …) + anna (passkey …)") needs both signatures, from two people.
    const needs = a.decision === "APPROVED" ? a.approver.split(" + ").length : 1;
    const stored = db.prepare("SELECT * FROM passkey_assertions WHERE proposal_id = ? AND outcome = ? ORDER BY verified_at").all(a.proposal_id, a.decision) as
      { assertion_sha256: string; credential_id: string; terms_sha256: string; assertion_json: string; verified_at: string }[];
    const problem = async (s: (typeof stored)[number]): Promise<string | { label: string; id: string }> => {
      const pk = passkeyById(db, s.credential_id);
      if (!pk) return `signed by an unknown passkey ${s.credential_id.slice(0, 8)}`;
      if (s.terms_sha256 !== a.approved_sha256) return "the signed hash is not the approved hash";
      if (Date.parse(pk.enrolled_at) > Date.parse(s.verified_at)) return "signed before the passkey was enrolled";
      const response = JSON.parse(s.assertion_json) as AuthenticationResponseJSON;
      if (assertionSha256(response) !== s.assertion_sha256) return "the stored signature was changed";
      const prop = db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(a.proposal_id) as { kind: string; terms_json: string; terms_sha256: string } | undefined;
      let signed: string;
      try {
        signed = a.decision === "APPROVED" ? (prop ? approvalHashOf(prop) : a.approved_sha256) : rejectionSha256(a.approved_sha256);
      } catch (e) {
        return (e as Error).message;
      }
      const v = await verifyApprovalSignature(response, signed, pk, 0);
      return v.ok ? { label: pk.label, id: pk.credential_id } : v.reason;
    };
    const signers: { label: string; id: string }[] = [];
    let failed: string | null = stored.length === 0 ? "no stored signature" : null;
    for (const s of stored.slice(0, Math.max(needs, 1))) {
      const r = await problem(s);
      if (typeof r === "string") { failed = r; break; }
      signers.push(r);
    }
    if (!failed && new Set(signers.map((x) => x.label)).size < needs) failed = `needs ${needs} different people's signatures, has ${new Set(signers.map((x) => x.label)).size}`;
    if (failed) { checks.push({ ok: false, what, detail: failed }); continue; }
    const over = a.decision === "APPROVED" ? `over ${a.approved_sha256.slice(0, 8)}…` : `rejecting ${a.approved_sha256.slice(0, 8)}…`;
    checks.push({ ok: true, what, detail: `signed by ${signers.map((x) => `${x.label}'s passkey ${x.id.slice(0, 8)}`).join(" and ")} ${over}` });
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
