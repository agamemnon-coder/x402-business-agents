// The approver's passkey in the ledger (tier 2 item 5). The runner opens a short enrolment window with a one-time
// code, the phone creates a passkey against the window's challenge, and the runner pins the verified public key
// here. Only the code's hash is stored, and one passkey is active at a time.

import { randomBytes, randomInt } from "node:crypto";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "./code.js";

export { normalizeCode };

export const ENROLMENT_TTL_MS = 10 * 60 * 1000;

export interface EnrolmentWindow {
  window_id: string;
  /** base64url of 32 random bytes: the WebAuthn challenge the new passkey must sign. */
  challenge: string;
  /**
   * base64url WebAuthn user handle, new for every window: a phone that already holds the pinned passkey keeps it
   * until the runner accepts the new one (the same handle would make the phone overwrite it at creation).
   */
  user_id: string;
  code_sha256: string;
  rp_id: string;
  origin: string;
  opened_at: string;
  expires_at: string;
  status: "OPEN" | "USED" | "EXPIRED" | "CLOSED";
}

export interface PasskeyRow {
  credential_id: string;
  /** base64url of the COSE public key. */
  public_key: string;
  counter: number;
  transports: string | null;
  rp_id: string;
  origin: string;
  label: string;
  aaguid: string | null;
  registration_json: string;
  enrolled_at: string;
  status: "ACTIVE" | "REVOKED";
}

export function codeSha256(input: string): string | null {
  const code = normalizeCode(input);
  return code === null ? null : sha256Hex(code);
}

function newCode(): string {
  const c = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export function activePasskey(db: DB): PasskeyRow | null {
  return (db.prepare("SELECT * FROM passkeys WHERE status = 'ACTIVE'").get() as PasskeyRow | undefined) ?? null;
}

export function passkeyById(db: DB, credentialId: string): PasskeyRow | null {
  return (db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(credentialId) as PasskeyRow | undefined) ?? null;
}

/**
 * Opens a window in which one passkey can be enrolled, closing any earlier open window. Refuses while a passkey
 * is active unless `replace` is set; the old passkey stays active until the new one is enrolled.
 */
export function openEnrolment(db: DB, args: { rpId: string; origin: string; replace?: boolean }, now = new Date()): { window: EnrolmentWindow; code: string } {
  return db.transaction(() => {
    if (activePasskey(db) && !args.replace) throw new Error("a passkey is already enrolled; open the window with replace to enrol a new one (the old one is revoked once the new one is enrolled)");
    db.prepare("UPDATE passkey_enrolments SET status = 'CLOSED' WHERE status = 'OPEN'").run();
    const code = newCode();
    const window: EnrolmentWindow = {
      window_id: `E-${randomBytes(4).toString("hex")}`,
      challenge: randomBytes(32).toString("base64url"),
      user_id: randomBytes(16).toString("base64url"),
      code_sha256: codeSha256(code)!,
      rp_id: args.rpId,
      origin: args.origin,
      opened_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ENROLMENT_TTL_MS).toISOString(),
      status: "OPEN",
    };
    db.prepare(
      `INSERT INTO passkey_enrolments (window_id, challenge, user_id, code_sha256, rp_id, origin, opened_at, expires_at, status)
       VALUES (@window_id, @challenge, @user_id, @code_sha256, @rp_id, @origin, @opened_at, @expires_at, @status)`,
    ).run(window);
    audit(db, "system", "passkey.enrolment_opened", window.window_id, { rp_id: args.rpId, origin: args.origin, expires_at: window.expires_at, replace: Boolean(args.replace) }, now);
    return { window, code };
  }).immediate();
}

/** The open, unexpired window, if any. A window whose time ran out is marked EXPIRED. */
export function openWindow(db: DB, now = new Date()): EnrolmentWindow | null {
  const w = db.prepare("SELECT * FROM passkey_enrolments WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get() as EnrolmentWindow | undefined;
  if (!w) return null;
  if (Date.parse(w.expires_at) <= now.getTime()) {
    db.prepare("UPDATE passkey_enrolments SET status = 'EXPIRED' WHERE window_id = ? AND status = 'OPEN'").run(w.window_id);
    return null;
  }
  return w;
}

export interface NewPasskey {
  window: EnrolmentWindow;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
  aaguid: string | null;
  registrationJson: string;
  label: string;
}

/** Pins a verified passkey: revokes the previous one, uses up the window, all in one transaction. */
export function recordPasskey(db: DB, p: NewPasskey, now = new Date()): void {
  db.transaction(() => {
    const w = db.prepare("SELECT * FROM passkey_enrolments WHERE window_id = ?").get(p.window.window_id) as EnrolmentWindow | undefined;
    if (!w || w.status !== "OPEN" || Date.parse(w.expires_at) <= now.getTime()) throw new Error(`enrolment window ${p.window.window_id} is not open`);
    const old = activePasskey(db);
    if (old) {
      db.prepare("UPDATE passkeys SET status = 'REVOKED' WHERE credential_id = ?").run(old.credential_id);
      audit(db, "system", "passkey.revoked", old.credential_id, { replaced_by: p.credentialId }, now);
    }
    db.prepare(
      `INSERT INTO passkeys (credential_id, public_key, counter, transports, rp_id, origin, label, aaguid, registration_json, enrolled_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    ).run(p.credentialId, p.publicKey, p.counter, p.transports ? JSON.stringify(p.transports) : null, w.rp_id, w.origin, p.label, p.aaguid, p.registrationJson, now.toISOString());
    db.prepare("UPDATE passkey_enrolments SET status = 'USED' WHERE window_id = ?").run(w.window_id);
    audit(db, "human", "passkey.enrolled", p.credentialId,
      { window_id: w.window_id, label: p.label, rp_id: w.rp_id, origin: w.origin, aaguid: p.aaguid, public_key_sha256: sha256Hex(p.publicKey) }, now);
  }).immediate();
}
