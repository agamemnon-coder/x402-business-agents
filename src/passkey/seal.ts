// The enrolment seal (outside audit, finding 1.3, 20 November): a passkey counts only when the runner sealed its
// enrolment. Until now a passkey was whatever row the passkeys table held, so whoever could write the ledger file could
// add a public key of their own there and sign approvals with it; the execution guard re-verified those signatures
// against that very row and let them through. Now the ceremony (recordPasskey, src/passkey/ledger.ts: the window, the
// code, the fingerprint confirmed on the runner) writes an HMAC-SHA256 of the passkey's identity with a key that is not
// in the ledger: PURSER_ENROLMENT_SEAL_KEY, or the key file the runner keeps beside its other keys
// (src/passkey/sealKeyFile.ts, KIT11_KEYS_DIR). Every check that lets a passkey decide (the intake of a signature,
// the execution guard, a card raise, an endorsement of a new key, npm run verify) refuses a passkey whose seal is
// missing or does not match. A row written straight into the database, or a sealed row changed afterwards (another
// public key, another person's name, an earlier enrolment time), has no valid seal.
//
// The seal binds the credential id, the SHA-256 of the public key, the RP id and origin, the person (label) and the
// enrolment time. No seal key configured (Purser Cloud's engine, where the Durable Object's storage is written by the
// engine's own code only, and the test suite unless a test sets one): sealing is off and nothing changes. Nothing here
// reads a file or the network; nothing runs at import.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";

/** The environment variable that holds the seal key (at least 32 characters); the runner's key file is the fallback. */
export const SEAL_KEY_ENV = "PURSER_ENROLMENT_SEAL_KEY";
/** The shortest key accepted. */
export const SEAL_KEY_MIN = 32;
/** Why a passkey with no valid seal is refused, in the refusal and the audit log. */
export const UNSEALED = "this passkey was not enrolled through the enrolment ceremony on this runner (its enrolment seal is missing or does not match): it approves nothing";

let configured: string | null | undefined;

/** Sets the seal key for this process (null: sealing off; undefined: back to the environment). */
export function useEnrolmentSealKey(key: string | null | undefined): void {
  if (typeof key === "string" && key.length < SEAL_KEY_MIN) throw new Error(`the enrolment seal key must be at least ${SEAL_KEY_MIN} characters`);
  configured = key;
}

/** The seal key in force: the one set for this process, else PURSER_ENROLMENT_SEAL_KEY, else none (sealing off). */
export function enrolmentSealKey(): string | null {
  if (configured !== undefined) return configured;
  const env = typeof process !== "undefined" ? process.env?.[SEAL_KEY_ENV] : undefined;
  return env && env.length >= SEAL_KEY_MIN ? env : null;
}

/** What the seal covers of a passkey row. */
export interface SealedFields { credential_id: string; public_key: string; rp_id: string; origin: string; label: string; enrolled_at: string }

/** The seal of a passkey's identity under `key`: HMAC-SHA256 over a fixed, versioned text, hex. */
export function sealOf(key: string, p: SealedFields): string {
  const text = ["purser.passkey-enrolment/v1", p.credential_id, sha256Hex(p.public_key), p.rp_id, p.origin, p.label, p.enrolled_at].join("\n");
  return createHmac("sha256", key).update(text).digest("hex");
}

const TABLE = "CREATE TABLE IF NOT EXISTS passkey_seals (credential_id TEXT PRIMARY KEY, seal TEXT NOT NULL, sealed_at TEXT NOT NULL)";

/** Seals a passkey row the ceremony has just written (inside its transaction). Sealing off: nothing is written. */
export function sealPasskey(db: DB, p: SealedFields, now = new Date()): boolean {
  const key = enrolmentSealKey();
  if (!key) return false;
  db.exec(TABLE);
  db.prepare("INSERT INTO passkey_seals (credential_id, seal, sealed_at) VALUES (?, ?, ?) ON CONFLICT(credential_id) DO UPDATE SET seal = excluded.seal, sealed_at = excluded.sealed_at")
    .run(p.credential_id, sealOf(key, p), now.toISOString());
  return true;
}

/** Why this passkey may not decide anything (its seal is missing or wrong), or null: sealed, or sealing off. */
export function sealRefusal(db: DB, p: SealedFields): string | null {
  const key = enrolmentSealKey();
  if (!key) return null;
  let row: { seal: string } | undefined;
  try {
    row = db.prepare("SELECT seal FROM passkey_seals WHERE credential_id = ?").get(p.credential_id) as { seal: string } | undefined;
  } catch {
    row = undefined; // no table: nothing was ever sealed in this ledger
  }
  if (!row || !/^[0-9a-f]{64}$/.test(row.seal)) return UNSEALED;
  const want = Buffer.from(sealOf(key, p), "hex");
  return timingSafeEqual(want, Buffer.from(row.seal, "hex")) ? null : UNSEALED;
}

/** The active passkeys whose seal is missing or wrong (sealing on), for health and npm run passkey. */
export function unsealedPasskeys(db: DB): (SealedFields & { status: string })[] {
  if (!enrolmentSealKey()) return [];
  const rows = db.prepare("SELECT credential_id, public_key, rp_id, origin, label, enrolled_at, status FROM passkeys WHERE status = 'ACTIVE' ORDER BY enrolled_at").all() as (SealedFields & { status: string })[];
  return rows.filter((r) => sealRefusal(db, r) !== null);
}
