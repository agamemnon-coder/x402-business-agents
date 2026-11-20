// Adding a person beside the enrolled ones (src/passkey/ledger.ts openEnrolment with addPerson): a person's name is
// plain lower-case, never an agent's or a part of the system (so "the proposer cannot approve its own proposal" stays
// exact), a second person only after the first passkey, and never a person who already has one (that is a replacement,
// which revokes the old key). A window that adds a person revokes nobody; a window that replaces revokes only that
// person's key. Each refusal leaves the open window and the enrolled keys as they were.
import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { openDb } from "../src/db/open.js";
import { openEnrolment, recordPasskey, spkiSha256OfCose } from "../src/passkey/ledger.js";

const t0 = new Date("2026-11-20T09:00:00Z");
const RP = { rpId: "purser.example", origin: "https://purser.example" };
const keyOf = (db: ReturnType<typeof openDb>, label: string, credentialId: string, addPerson?: string) => {
  const { window } = openEnrolment(db, { ...RP, ...(addPerson ? { addPerson } : { replace: true }) }, t0);
  recordPasskey(db, { window, credentialId, publicKey: `pk-${credentialId}`, counter: 0, transports: null, aaguid: null, registrationJson: "{}", label }, t0);
};
const active = (db: ReturnType<typeof openDb>) => db.prepare("SELECT label, credential_id FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all();
const openWindows = (db: ReturnType<typeof openDb>) => db.prepare("SELECT label, adds FROM passkey_enrolments WHERE status = 'OPEN'").all();

describe("adding a person beside those enrolled", () => {
  it("only after the first passkey", () => {
    const db = openDb(":memory:");
    expect(() => openEnrolment(db, { ...RP, addPerson: "anna" }, t0)).toThrow("enrol the first passkey before adding another person");
    expect(openWindows(db)).toEqual([]);
  });

  it("refuses a name that is not a person's: wrong shape, an agent's, or a part of the system", () => {
    const db = openDb(":memory:");
    keyOf(db, "max", "cred-max");
    for (const name of ["Anna", "a", "1anna", "anna smith", "anna_s", `a${"b".repeat(31)}`]) {
      expect(() => openEnrolment(db, { ...RP, addPerson: name }, t0)).toThrow(`not a person's name: ${JSON.stringify(name)} (lower-case letters, digits and dashes)`);
    }
    for (const name of ["treasury", "sourcing", "support", "claude", "system", "owner-signer", "awx-executor", "external", "ext-auditor"]) {
      expect(() => openEnrolment(db, { ...RP, addPerson: name }, t0)).toThrow(`${name} is the name of an agent or a part of the system, not a person's name`);
    }
    expect(openWindows(db)).toEqual([]);
    expect(active(db)).toEqual([{ label: "max", credential_id: "cred-max" }]);
  });

  it("refuses a person who already has a passkey: that is a replacement, opened with replace", () => {
    const db = openDb(":memory:");
    keyOf(db, "max", "cred-max");
    keyOf(db, "anna", "cred-anna", "anna");
    expect(() => openEnrolment(db, { ...RP, addPerson: "anna" }, t0)).toThrow("anna already has a passkey; to replace it, open the window with replace");
    expect(() => openEnrolment(db, RP, t0)).toThrow(/^a passkey is already enrolled; open the window with replace/);
  });

  it("a window that adds a person revokes nobody, and is labelled with that person whatever the phone sends", () => {
    const db = openDb(":memory:");
    keyOf(db, "max", "cred-max");
    const { window } = openEnrolment(db, { ...RP, addPerson: "anna" }, t0);
    expect(window).toMatchObject({ label: "anna", adds: 1, rp_id: RP.rpId, origin: RP.origin });
    recordPasskey(db, { window, credentialId: "cred-anna", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
    expect(active(db)).toEqual([{ label: "anna", credential_id: "cred-anna" }, { label: "max", credential_id: "cred-max" }]);
  });

  it("a person added while their window was open, by another window, is not added twice", () => {
    const db = openDb(":memory:");
    keyOf(db, "max", "cred-max");
    const { window } = openEnrolment(db, { ...RP, addPerson: "anna" }, t0);
    // Another way in pins anna first (the row a concurrent window would have written).
    db.prepare("INSERT INTO passkeys (credential_id, public_key, counter, transports, rp_id, origin, label, aaguid, registration_json, enrolled_at, status) VALUES ('cred-anna-1', 'pk', 0, NULL, ?, ?, 'anna', NULL, '{}', ?, 'ACTIVE')").run(RP.rpId, RP.origin, t0.toISOString());
    expect(() => recordPasskey(db, { window, credentialId: "cred-anna-2", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "anna" }, t0)).toThrow("anna already has a passkey");
    expect(active(db)).toEqual([{ label: "anna", credential_id: "cred-anna-1" }, { label: "max", credential_id: "cred-max" }]);
  });

  it("a replacement revokes only that person's key", () => {
    const db = openDb(":memory:");
    keyOf(db, "max", "cred-max");
    keyOf(db, "anna", "cred-anna", "anna");
    keyOf(db, "max", "cred-max-2");
    expect(active(db)).toEqual([{ label: "anna", credential_id: "cred-anna" }, { label: "max", credential_id: "cred-max-2" }]);
    expect(db.prepare("SELECT status FROM passkeys WHERE credential_id = 'cred-max'").get()).toEqual({ status: "REVOKED" });
  });
});

describe("a passkey's SPKI fingerprint", () => {
  it("is the same for the same key, and refused for a key type enrolment does not take", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const cose = Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]))).toString("base64url");
    const spki = publicKey.export({ type: "spki", format: "der" });
    expect(spkiSha256OfCose(cose)).toBe(createHash("sha256").update(spki).digest("hex"));
    const okp = Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 1], [3, -8], [-1, 6], [-2, new Uint8Array(32)]]))).toString("base64url");
    expect(() => spkiSha256OfCose(okp)).toThrow("unsupported passkey key type 1");
  });
});
