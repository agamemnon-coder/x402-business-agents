// Registering a security key (a second WebAuthn credential of a person who already has a passkey), for high-risk
// payments (src/policy/secondKey.ts). It is registered as cross-platform (USB or NFC, such as a YubiKey): the page asks
// with authenticatorAttachment "cross-platform", and a credential the browser reports as a platform authenticator is
// refused. That report comes from the browser, not from an attested statement of the key: Purser keeps attestation
// "none", as for passkeys. A security key never approves on its own (src/policy/approvals.ts).

import { randomBytes } from "node:crypto";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { ensureSecondKeyTables } from "../policy/secondKey.js";
import type { PasskeyRow } from "./ledger.js";
import { verifyEnrolmentResponse } from "./webauthn.js";

const WINDOW_MS = 10 * 60 * 1000;

export function securityKeyById(db: DB, credentialId: string): PasskeyRow | null {
  ensureSecondKeyTables(db);
  return (db.prepare("SELECT * FROM security_keys WHERE credential_id = ?").get(credentialId) as PasskeyRow | undefined) ?? null;
}

/** A person's active security keys (their ids), for the approval page's allowCredentials. */
export function securityKeysOf(db: DB, label: string): string[] {
  ensureSecondKeyTables(db);
  return (db.prepare("SELECT credential_id FROM security_keys WHERE label = ? AND status = 'ACTIVE' ORDER BY enrolled_at").all(label) as { credential_id: string }[]).map((r) => r.credential_id);
}

/** Opens the window in which one security key can be registered for `label`, who must already have an active passkey. */
export function startSecurityKey(db: DB, a: { label: string; rpId: string; origin: string }, now = new Date()): { challenge: string; user_id: string; exclude: string[] } {
  ensureSecondKeyTables(db);
  if (!db.prepare("SELECT 1 FROM passkeys WHERE status = 'ACTIVE' AND label = ?").get(a.label)) throw new Error("add your passkey (Face ID) first: a security key is your second key");
  db.prepare("UPDATE security_key_windows SET status = 'CLOSED' WHERE status = 'OPEN' AND label = ?").run(a.label);
  const w = { window_id: `S-${randomBytes(4).toString("hex")}`, challenge: randomBytes(32).toString("base64url"), user_id: randomBytes(16).toString("base64url"), label: a.label, rp_id: a.rpId, origin: a.origin, expires_at: new Date(now.getTime() + WINDOW_MS).toISOString() };
  db.prepare("INSERT INTO security_key_windows (window_id, challenge, user_id, label, rp_id, origin, expires_at, status) VALUES (@window_id, @challenge, @user_id, @label, @rp_id, @origin, @expires_at, 'OPEN')").run(w);
  // Every credential already known (passkeys and security keys): the authenticator must make a new one.
  const exclude = [...(db.prepare("SELECT credential_id FROM passkeys WHERE status = 'ACTIVE'").all() as { credential_id: string }[]),
    ...(db.prepare("SELECT credential_id FROM security_keys WHERE status = 'ACTIVE'").all() as { credential_id: string }[])].map((r) => r.credential_id);
  return { challenge: w.challenge, user_id: w.user_id, exclude };
}

/** Finishes it: the browser's new credential, verified against the open window, reported as cross-platform, never a passkey already. */
export async function finishSecurityKey(db: DB, a: { label: string; credential: unknown }, now = new Date()): Promise<{ ok: true; credential_id: string } | { ok: false; reason: string }> {
  ensureSecondKeyTables(db);
  const w = db.prepare("SELECT * FROM security_key_windows WHERE label = ? AND status = 'OPEN' ORDER BY expires_at DESC LIMIT 1").get(a.label) as { window_id: string; challenge: string; user_id: string; rp_id: string; origin: string; expires_at: string } | undefined;
  if (!w || Date.parse(w.expires_at) <= now.getTime()) return { ok: false, reason: "no security key registration is open; start again" };
  const r = a.credential as RegistrationResponseJSON;
  if (!r || typeof r !== "object" || typeof r.id !== "string") return { ok: false, reason: "malformed credential" };
  if (r.authenticatorAttachment !== "cross-platform") return { ok: false, reason: "this is not a security key: use a key you plug in or hold to the phone (USB or NFC), not Face ID or Touch ID" };
  const v = await verifyEnrolmentResponse(r, { window_id: w.window_id, challenge: w.challenge, user_id: w.user_id, code_sha256: "", rp_id: w.rp_id, origin: w.origin, opened_at: now.toISOString(), expires_at: w.expires_at, status: "OPEN" });
  if (!v.ok) return { ok: false, reason: `the security key did not verify (${v.reason})` };
  if (db.prepare("SELECT 1 FROM passkeys WHERE credential_id = ?").get(v.credentialId) || db.prepare("SELECT 1 FROM security_keys WHERE credential_id = ?").get(v.credentialId)) {
    return { ok: false, reason: "this credential is already registered: a second key must be a different key" };
  }
  db.transaction(() => {
    db.prepare(`INSERT INTO security_keys (credential_id, public_key, counter, transports, rp_id, origin, label, aaguid, registration_json, enrolled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`).run(v.credentialId, v.publicKey, v.counter, v.transports ? JSON.stringify(v.transports) : null, w.rp_id, w.origin, a.label, v.aaguid, JSON.stringify(r), now.toISOString());
    db.prepare("UPDATE security_key_windows SET status = 'USED' WHERE window_id = ?").run(w.window_id);
    audit(db, "human", "security_key.enrolled", v.credentialId, { label: a.label, rp_id: w.rp_id, origin: w.origin, aaguid: v.aaguid, attachment: "cross-platform (as the browser reported it)", public_key_sha256: sha256Hex(v.publicKey) }, now);
  })();
  return { ok: true, credential_id: v.credentialId };
}
