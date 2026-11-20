// The passkey modules' edges (src/passkey/seal.ts, ledger.ts, failures.ts): the enrolment seal key read from the
// environment (too short is none), set for the process (too short is refused) and switched off (then nothing is
// refused and nothing is listed as unsealed); a ledger with no seal table has nothing sealed; an RS256 key's
// fingerprint is the SHA-256 of its SPKI, and a key of another type is refused; and a burst of refusals names the most
// frequent codes, leaving the benign ones out. No network.
import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { openDb } from "../src/db/open.js";
import { countFailure, failureAlerts, PASSKEY_FAILURE_SPIKE } from "../src/passkey/failures.js";
import { spkiSha256OfCose } from "../src/passkey/ledger.js";
import { enrolmentSealKey, SEAL_KEY_ENV, sealPasskey, sealRefusal, UNSEALED, unsealedPasskeys, useEnrolmentSealKey, type SealedFields } from "../src/passkey/seal.js";

const KEY = "k".repeat(40);
const fields: SealedFields = { credential_id: "cred-1", public_key: "pk", rp_id: "purser.example", origin: "https://purser.example", label: "max", enrolled_at: "2026-11-20T10:00:00.000Z" };
const saved = process.env[SEAL_KEY_ENV];
afterEach(() => {
  useEnrolmentSealKey(undefined);
  if (saved === undefined) delete process.env[SEAL_KEY_ENV]; else process.env[SEAL_KEY_ENV] = saved;
});

describe("the enrolment seal key", () => {
  it("from the environment, at least 32 characters; set for the process, too short is refused", () => {
    useEnrolmentSealKey(undefined);
    process.env[SEAL_KEY_ENV] = "short";
    expect(enrolmentSealKey()).toBeNull();
    process.env[SEAL_KEY_ENV] = KEY;
    expect(enrolmentSealKey()).toBe(KEY);
    delete process.env[SEAL_KEY_ENV];
    expect(enrolmentSealKey()).toBeNull();
    expect(() => useEnrolmentSealKey("short")).toThrow("the enrolment seal key must be at least 32 characters");
  });

  it("switched off: nothing is sealed, refused or listed as unsealed", () => {
    const db = openDb(":memory:");
    useEnrolmentSealKey(null);
    expect(sealPasskey(db, fields)).toBe(false);
    expect(sealRefusal(db, fields)).toBeNull();
    expect(unsealedPasskeys(db)).toEqual([]);
  });

  it("a ledger with no seal table has nothing sealed", () => {
    const db = openDb(":memory:");
    useEnrolmentSealKey(KEY);
    db.exec("DROP TABLE IF EXISTS passkey_seals");
    expect(sealRefusal(db, fields)).toBe(UNSEALED);
    expect(sealPasskey(db, fields)).toBe(true);
    expect(sealRefusal(db, fields)).toBeNull();
    expect(sealRefusal(db, { ...fields, label: "mallory" })).toBe(UNSEALED);
  });
});

describe("a passkey's fingerprint", () => {
  it("an RS256 key's is the SHA-256 of its SPKI; another key type is refused", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 3], [3, -257], [-1, new Uint8Array(Buffer.from(jwk.n, "base64url"))], [-2, new Uint8Array(Buffer.from(jwk.e, "base64url"))]]));
    const spki = publicKey.export({ type: "spki", format: "der" });
    expect(spkiSha256OfCose(Buffer.from(cose).toString("base64url"))).toBe(createHash("sha256").update(spki).digest("hex"));
    const okp = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 1], [3, -8], [-1, 6], [-2, new Uint8Array(32)]]));
    expect(() => spkiSha256OfCose(Buffer.from(okp).toString("base64url"))).toThrow("unsupported passkey key type 1");
  });
});

describe("a burst of refusals", () => {
  it("names the most frequent codes; benign ones are neither counted nor named", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-11-20T10:00:00Z");
    for (let i = 0; i < PASSKEY_FAILURE_SPIKE; i++) countFailure(db, i % 2 ? "bad_signature" : "unknown_passkey", now);
    for (let i = 0; i < 5; i++) countFailure(db, "not_pending", now);
    const spike = failureAlerts(db, now).find((a) => a.code === "passkey_failures_spike")!;
    expect(spike.words).toMatch(/^10 passkey submissions were refused in the last hour \(most: (bad_signature 5, unknown_passkey 5|unknown_passkey 5, bad_signature 5)\)/);
    expect(spike.words).not.toContain("not_pending");
  });
});
