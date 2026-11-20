// Outside audit, finding 1.3: "someone with database-write access can enrol a passkey of their own; prove a DB writer
// alone cannot establish a new payment-authorising identity". Before the enrolment seal (src/passkey/seal.ts) this was
// an accepted risk: a public key written into the passkeys table was "enrolled", and the execution guard verified
// signatures against it. These tests write the attacker's key straight into the ledger, as a DB writer would, and show
// it authorises nothing: not at the intake of a signature, not at execution with a forged approval and a genuine stored
// signature, not as the second person of four eyes, not as an endorser of a new key; npm run verify fails it and health
// raises a critical alarm. They also show the seal does not stop the genuine ceremony, and that sealing an older key
// takes the runner, which holds the key.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { health } from "../src/ops/health.js";
import { confirmPasskey, fingerprintOf, openEnrolment, sealEnrolledPasskey } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { enrolmentSealKey, SEAL_KEY_ENV, sealRefusal, unsealedPasskeys, UNSEALED, useEnrolmentSealKey } from "../src/passkey/seal.js";
import { loadRunnerSealKey } from "../src/passkey/sealKeyFile.js";
import { assertionSha256, challengeFor, reverifyPasskeyApprovals } from "../src/passkey/webauthn.js";
import { beginExecution, createProposal, nextProposalId } from "../src/policy/approvals.js";
import { hashFirst } from "../src/policy/hashFirst.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
const KEY = "test-seal-key-0123456789abcdef-0123456789";
let tickets = 0;
let counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });

async function enrol(db: DB, label: string, add: boolean): Promise<FakeAuthenticator> {
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, ...(add ? { addPerson: label } : {}) }, NOW);
  expect((await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label }, NOW)).status).toBe("pending");
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
  return phone;
}

/** The attacker's own key, written into the passkeys table as a DB writer would: no window, no code, no confirmation. */
function plant(db: DB, label: string): FakeAuthenticator {
  const eve = new FakeAuthenticator();
  const cose = Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(eve.publicJwk.x, "base64url")], [-3, Buffer.from(eve.publicJwk.y, "base64url")]]))).toString("base64url");
  db.prepare("INSERT INTO passkeys (credential_id, public_key, counter, transports, rp_id, origin, label, aaguid, registration_json, enrolled_at, status) VALUES (?, ?, 0, NULL, ?, ?, ?, NULL, '{}', ?, 'ACTIVE')")
    .run(eve.credentialId, cose, RP, ORIGIN, label, "2026-11-01T00:00:00.000Z");
  audit(db, "human", "passkey.enrolled", eve.credentialId, { label, rp_id: RP, origin: ORIGIN }, NOW); // the unkeyed chain takes it
  return eve;
}

function payment(db: DB, amount: string): { id: string; hash: string } {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor: "Bergtex Textil GmbH", invoice_no: `BTX-${id}` } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return { id, hash: termsHash(terms) };
}

const signed = (phone: FakeAuthenticator, hash: string) => phone.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
const submit = (db: DB, phone: FakeAuthenticator, p: { id: string; hash: string }) =>
  processAssertion(db, item("assertion", { proposal_id: p.id, terms_sha256: p.hash, credential: signed(phone, p.hash) }, p.id), NOW);
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const message = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as Error).message; } };

/** The DB writer goes all the way: an approval row, the status, an audit row, and the attacker's genuine signature stored. */
function forgeApprovalWith(db: DB, p: { id: string; hash: string }, phone: FakeAuthenticator, approver: string): void {
  const r = signed(phone, p.hash);
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, ?, 'passkey', ?, ?)").run(p.id, p.hash, approver, p.hash.slice(0, 8), NOW.toISOString());
  db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(p.id);
  db.prepare("INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?)")
    .run(assertionSha256(r), p.id, phone.credentialId, p.hash, JSON.stringify(r), counter, NOW.toISOString());
  audit(db, "human", "proposal.approved", p.id, { terms_sha256: p.hash, approver, method: "passkey" }, NOW);
}

describe("the enrolment seal: a passkey written into the ledger authorises nothing (finding 1.3)", () => {
  beforeEach(() => useEnrolmentSealKey(KEY));
  afterEach(() => useEnrolmentSealKey(undefined));

  it("the ceremony seals the passkey it pins, and that passkey approves and runs as before", async () => {
    const db = openDb(":memory:");
    const max = await enrol(db, "max", false);
    const row = db.prepare("SELECT * FROM passkeys WHERE status = 'ACTIVE'").get() as Parameters<typeof sealRefusal>[1];
    expect(sealRefusal(db, row)).toBeNull();
    const p = payment(db, "120.00");
    expect((await submit(db, max, p)).status).toBe("approved");
    expect(message(() => beginExecution(db, p.id, () => {}, NOW))).toBeNull();
    expect(unsealedPasskeys(db)).toEqual([]);
    expect(health(db, NOW).alerts.map((a) => a.code)).not.toContain("passkey_unsealed");
  });

  it("a planted passkey's signature is refused at intake: nothing is approved", async () => {
    const db = openDb(":memory:");
    await enrol(db, "max", false);
    const eve = plant(db, "eve");
    const p = payment(db, "9999.00");
    const out = await submit(db, eve, p);
    expect(out).toMatchObject({ status: "refused", message: UNSEALED });
    expect(status(db, p.id)).toBe("PENDING_APPROVAL");
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
  });

  it("a DB writer who also forges the approval row and stores the planted key's genuine signature: execution refuses it", async () => {
    const db = openDb(":memory:");
    await enrol(db, "max", false);
    const eve = plant(db, "eve");
    const p = payment(db, "9999.00");
    forgeApprovalWith(db, p, eve, `eve (passkey ${eve.credentialId.slice(0, 8)})`);
    expect(message(() => beginExecution(db, p.id, () => {}, NOW))).toMatch(/enrolment seal is missing or does not match/);
    expect(message(() => hashFirst(db, p.id))).toMatch(/enrolment seal/);
    expect(status(db, p.id)).toBe("APPROVED"); // never EXECUTING: no money moved
    // npm run verify fails it, and health raises a critical alarm naming the planted key.
    const checks = await reverifyPasskeyApprovals(db);
    expect(checks.find((c) => c.what.endsWith(p.id))).toMatchObject({ ok: false, detail: expect.stringMatching(/enrolment seal/) });
    const alarm = health(db, NOW).alerts.find((a) => a.code === "passkey_unsealed");
    expect(alarm).toMatchObject({ severity: "critical", words: expect.stringContaining(`eve, ${eve.credentialId.slice(0, 8)}`) });
  });

  it("the planted key cannot replace the CFO's: revoking max's row and planting one under his name approves nothing", async () => {
    const db = openDb(":memory:");
    await enrol(db, "max", false);
    db.prepare("UPDATE passkeys SET status = 'REVOKED'").run();
    const eve = plant(db, "max");
    const p = payment(db, "500.00");
    expect((await submit(db, eve, p)).status).toBe("refused");
    forgeApprovalWith(db, p, eve, `max (passkey ${eve.credentialId.slice(0, 8)})`);
    expect(message(() => beginExecution(db, p.id, () => {}, NOW))).toMatch(/enrolment seal/);
  });

  it("changing a sealed row breaks its seal: another public key, another person, an earlier date, a copied seal", async () => {
    const db = openDb(":memory:");
    const max = await enrol(db, "max", false);
    const eve = new FakeAuthenticator();
    const original = db.prepare("SELECT * FROM passkeys WHERE status = 'ACTIVE'").get() as Record<string, string>;
    const tries: [string, () => void][] = [
      ["public key", () => db.prepare("UPDATE passkeys SET public_key = ? WHERE credential_id = ?").run(Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(eve.publicJwk.x, "base64url")], [-3, Buffer.from(eve.publicJwk.y, "base64url")]]))).toString("base64url"), original.credential_id)],
      ["label", () => db.prepare("UPDATE passkeys SET label = 'anna' WHERE credential_id = ?").run(original.credential_id)],
      ["enrolled_at", () => db.prepare("UPDATE passkeys SET enrolled_at = '2026-01-01T00:00:00.000Z' WHERE credential_id = ?").run(original.credential_id)],
    ];
    for (const [what, change] of tries) {
      change();
      const row = db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(original.credential_id) as Parameters<typeof sealRefusal>[1];
      expect({ what, refused: sealRefusal(db, row) }).toEqual({ what, refused: UNSEALED });
      db.prepare("UPDATE passkeys SET public_key = ?, label = ?, enrolled_at = ? WHERE credential_id = ?").run(original.public_key, original.label, original.enrolled_at, original.credential_id);
    }
    // The genuine row again verifies; its seal copied onto the planted key does not make that one sealed.
    expect((await submit(db, max, payment(db, "10.00"))).status).toBe("approved");
    const planted = plant(db, "eve");
    db.prepare("INSERT INTO passkey_seals (credential_id, seal, sealed_at) SELECT ?, seal, sealed_at FROM passkey_seals WHERE credential_id = ?").run(planted.credentialId, original.credential_id);
    expect((await submit(db, planted, payment(db, "10.00"))).status).toBe("refused");
  });

  it("four eyes still needs two sealed people: a planted second person does not count", async () => {
    const db = openDb(":memory:");
    const max = await enrol(db, "max", false);
    const eve = plant(db, "eve");
    const p = payment(db, "20000.00");
    forgeApprovalWith(db, p, eve, `max (passkey ${max.credentialId.slice(0, 8)}) + eve (passkey ${eve.credentialId.slice(0, 8)})`);
    // Max's own genuine signature stored beside it: one sealed person, where the approval names two.
    const r = signed(max, p.hash);
    db.prepare("INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?)")
      .run(assertionSha256(r), p.id, max.credentialId, p.hash, JSON.stringify(r), counter, NOW.toISOString());
    expect(message(() => beginExecution(db, p.id, () => {}, NOW))).toMatch(/needs the passkey signatures of 2 different people, and 1 verifies \(signed by .* enrolment seal/);
  });

  it("an older passkey is sealed only by the runner, after its fingerprint is compared; without the key it cannot be", async () => {
    const db = openDb(":memory:");
    useEnrolmentSealKey(null); // enrolled before the seal existed
    const max = await enrol(db, "max", false);
    useEnrolmentSealKey(KEY);
    expect(unsealedPasskeys(db).map((k) => k.label)).toEqual(["max"]);
    expect((await submit(db, max, payment(db, "10.00"))).status).toBe("refused");
    useEnrolmentSealKey(null);
    expect(message(() => sealEnrolledPasskey(db, fingerprintOf(max.spkiSha256), NOW))).toMatch(/no enrolment seal key/);
    useEnrolmentSealKey(KEY);
    expect(message(() => sealEnrolledPasskey(db, "0000-0000-0000-0000", NOW))).toMatch(/no active passkey with fingerprint/);
    sealEnrolledPasskey(db, fingerprintOf(max.spkiSha256), NOW);
    expect((await submit(db, max, payment(db, "10.00"))).status).toBe("approved");
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'passkey.sealed'").get()).toEqual({ n: 1 });
    // A seal made with another key (someone who guessed or made their own) is no seal here.
    useEnrolmentSealKey("another-key-0123456789abcdef-0123456789");
    expect((await submit(db, max, payment(db, "10.00"))).status).toBe("refused");
  });

  it("the runner keeps the key outside the ledger: PURSER_ENROLMENT_SEAL_KEY, else a mode-600 file it makes once and reuses", () => {
    const dir = mkdtempSync(join(tmpdir(), "seal-key-"));
    const file = join(dir, "passkey-seal.key");
    expect(loadRunnerSealKey({}, file)).toBe(file);
    const first = readFileSync(file, "utf8").trim();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(enrolmentSealKey()).toBe(first);
    loadRunnerSealKey({}, file);
    expect(enrolmentSealKey()).toBe(first);
    expect(loadRunnerSealKey({ [SEAL_KEY_ENV]: KEY }, file)).toBe(SEAL_KEY_ENV);
    expect(enrolmentSealKey()).toBe(KEY);
    expect(() => useEnrolmentSealKey("short")).toThrow(/at least 32/);
  });
});
