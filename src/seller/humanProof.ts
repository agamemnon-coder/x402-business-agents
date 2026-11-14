// "Signed by a real person", as far as it can be proven. Alta proves that the customer's mandate was bound on its
// account by the account's owner key; it does not prove that a person holds that key. This is Purser's optional
// addition, not enforced by Alta: the customer's owner registers a passkey with the seller once, and confirms each
// mandate with it (user verification, such as Face ID). The seller checks the signature itself, over a challenge
// derived from the mandate's reference, so a confirmation of one mandate never counts for another.

import { createHash } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { DB } from "../db/open.js";
import type { PasskeyRow } from "../passkey/ledger.js";
import { verifyApprovalSignature, verifyEnrolmentResponse } from "../passkey/webauthn.js";
import type { PasskeyLookup } from "./evidence.js";

const SCHEMA = `CREATE TABLE IF NOT EXISTS customer_passkeys (
  credential_id TEXT PRIMARY KEY, label TEXT NOT NULL, public_key TEXT NOT NULL, rp_id TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mandate_confirmations (
  mandate_ref TEXT PRIMARY KEY, credential_id TEXT NOT NULL REFERENCES customer_passkeys(credential_id), assertion_json TEXT NOT NULL, verified_at TEXT NOT NULL);`;

/** The challenge a customer's passkey signs to confirm one mandate (hex SHA-256). */
export const confirmationChallenge = (mandateRef: string) => createHash("sha256").update(`purser mandate confirm v1 ${mandateRef.toLowerCase()}`, "utf8").digest("hex");

/** Registers the customer owner's passkey with the seller (once). */
export async function registerCustomerPasskey(
  db: DB, w: { label: string; rpId: string; origin: string; challenge: string }, response: RegistrationResponseJSON, now = new Date(),
): Promise<{ ok: true; credentialId: string } | { ok: false; reason: string }> {
  db.exec(SCHEMA);
  const v = await verifyEnrolmentResponse(response, { challenge: w.challenge, origin: w.origin, rp_id: w.rpId } as Parameters<typeof verifyEnrolmentResponse>[1]);
  if (!v.ok) return v;
  db.prepare("INSERT OR REPLACE INTO customer_passkeys (credential_id, label, public_key, rp_id, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(v.credentialId, w.label, v.publicKey, w.rpId, w.origin, now.toISOString());
  return { ok: true, credentialId: v.credentialId };
}

/** Records a mandate confirmation only if a registered passkey signed this mandate's challenge with user verification. */
export async function recordMandateConfirmation(
  db: DB, mandateRef: string, assertion: AuthenticationResponseJSON, now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  db.exec(SCHEMA);
  const pk = db.prepare("SELECT credential_id, label, public_key, rp_id, origin FROM customer_passkeys WHERE credential_id = ?").get(assertion.id) as
    { credential_id: string; label: string; public_key: string; rp_id: string; origin: string } | undefined;
  if (!pk) return { ok: false, reason: "this passkey is not registered with the seller" };
  const row = { ...pk, counter: 0, transports: null } as unknown as PasskeyRow;
  const v = await verifyApprovalSignature(assertion, confirmationChallenge(mandateRef), row, 0);
  if (!v.ok) return v;
  db.prepare("INSERT OR REPLACE INTO mandate_confirmations (mandate_ref, credential_id, assertion_json, verified_at) VALUES (?, ?, ?, ?)")
    .run(mandateRef.toLowerCase(), pk.credential_id, JSON.stringify(assertion), now.toISOString());
  return { ok: true };
}

/** For the evidence pack: the confirmation of a mandate, if the customer gave one. */
export function mandatePasskey(db: DB): PasskeyLookup {
  db.exec(SCHEMA);
  return (ref) => {
    const r = db.prepare("SELECT p.label FROM mandate_confirmations m JOIN customer_passkeys p USING (credential_id) WHERE m.mandate_ref = ?").get(ref.toLowerCase()) as { label: string } | undefined;
    return r ? { label: r.label, verified: true } : null;
  };
}
