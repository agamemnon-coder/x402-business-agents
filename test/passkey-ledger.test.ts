// The ledger side of passkey approvals: the approvals migration, decide() with a signed hash, enrolment windows.
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { rejectionSha256, sha256Hex, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { activePasskey, codeSha256, normalizeCode, openEnrolment, openWindow, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal, decide } from "../src/policy/approvals.js";

const t0 = new Date("2026-10-30T14:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T14:10:00Z", total: "0.60" };
const hash = termsHash(terms);
const passkey = { credentialId: "cred-1", assertionSha256: "a".repeat(64) };

function setup() {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  return db;
}

describe("approvals migration", () => {
  it("rebuilds an old approvals table so it accepts passkey, keeping every row", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kit11-")), "old.sqlite");
    const old = new Database(path);
    // The approvals table as ledgers created before the passkey work have it.
    old.exec(`
      CREATE TABLE proposals (proposal_id TEXT PRIMARY KEY, kind TEXT NOT NULL, terms_json TEXT NOT NULL, terms_sha256 TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL, evidence_json TEXT, explanation TEXT, status TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE approvals (
        approval_id INTEGER PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(proposal_id),
        decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
        approved_sha256 TEXT NOT NULL,
        approver TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('web', 'cli', 'telegram')),
        typed_prefix TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO proposals VALUES ('P-0009', 'refund_batch', '{}', '${"9".repeat(64)}', 'support', NULL, NULL, 'APPROVED', '2026-10-29T06:00:00Z', '2026-10-29T05:50:00Z');
      INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at)
        VALUES ('P-0009', 'APPROVED', '${"9".repeat(64)}', 'max', 'cli', '99999999', '2026-10-29T05:55:00Z');
    `);
    old.close();

    const db = openDb(path);
    expect(db.prepare("SELECT proposal_id, approver, method FROM approvals").all()).toEqual([{ proposal_id: "P-0009", approver: "max", method: "cli" }]);
    const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'approvals'").get() as { sql: string }).sql;
    expect(ddl).toContain("'passkey'");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
    // A second open finds nothing left to migrate.
    expect(() => openDb(path).close()).not.toThrow();
  });

  it("lets an old passkey_assertions table record rejections, keeping every row", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kit11-")), "old.sqlite");
    const first = openDb(path);
    first.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0009', 'refund_batch', '{}', ?, 'support', 'APPROVED', '2026-10-29T06:00:00Z', '2026-10-29T05:50:00Z')").run("9".repeat(64));
    first.prepare("INSERT INTO passkeys (credential_id, public_key, counter, rp_id, origin, label, registration_json, status, enrolled_at) VALUES ('cred-9', 'pk', 0, 'r', 'o', 'max', '{}', 'ACTIVE', '2026-10-29T05:00:00Z')").run();
    // Put the table back the way ledgers from before rejections have it.
    first.pragma("foreign_keys = OFF");
    first.exec(`DROP TABLE passkey_assertions;
      CREATE TABLE passkey_assertions (assertion_sha256 TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
        credential_id TEXT NOT NULL REFERENCES passkeys(credential_id), terms_sha256 TEXT NOT NULL, assertion_json TEXT NOT NULL,
        counter INTEGER NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('APPROVED', 'TOO_LATE')), verified_at TEXT NOT NULL);
      INSERT INTO passkey_assertions VALUES ('${"a".repeat(64)}', 'P-0009', 'cred-9', '${"9".repeat(64)}', '{}', 1, 'APPROVED', '2026-10-29T05:55:00Z');`);
    first.close();

    const db = openDb(path);
    expect(db.prepare("SELECT proposal_id, outcome FROM passkey_assertions").all()).toEqual([{ proposal_id: "P-0009", outcome: "APPROVED" }]);
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE name = 'passkey_assertions'").get() as { sql: string }).sql).toContain("'REJECTED'");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
    expect(() => openDb(path).close()).not.toThrow();
  });
});

describe("decide() with a passkey", () => {
  it("approves when the signed hash is the terms hash, and names the credential in the audit row", () => {
    const db = setup();
    const result = decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: hash.slice(0, 8), approver: "max (passkey cred-1)", method: "passkey", signedSha256: hash, passkey }, t0);
    expect(result).toBe("APPROVED");
    expect(db.prepare("SELECT method, approved_sha256, approver FROM approvals").get()).toEqual({ method: "passkey", approved_sha256: hash, approver: "max (passkey cred-1)" });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.approved'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ method: "passkey", passkey: { credential_id: "cred-1", assertion_sha256: "a".repeat(64) } });
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("refuses a signature over other terms and records nothing", () => {
    const db = setup();
    const other = sha256Hex("other terms");
    expect(() => decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: hash.slice(0, 8), approver: "max", method: "passkey", signedSha256: other, passkey }, t0))
      .toThrow(/other terms/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT status FROM proposals").get()).toEqual({ status: "PENDING_APPROVAL" });
  });

  it("needs the signed hash and the credential; a rejection needs the rejection hash, never the terms hash", () => {
    const db = setup();
    const base = { proposalId: "P-0001", typedPrefix: hash.slice(0, 8), approver: "max", method: "passkey" as const };
    expect(() => decide(db, { ...base, decision: "APPROVED", passkey }, t0)).toThrow(/signed hash/);
    expect(() => decide(db, { ...base, decision: "APPROVED", signedSha256: hash }, t0)).toThrow(/credential/);
    expect(() => decide(db, { ...base, decision: "REJECTED", signedSha256: hash, passkey }, t0)).toThrow(/rejection/);
    expect(() => decide(db, { ...base, decision: "APPROVED", signedSha256: rejectionSha256(hash), passkey }, t0)).toThrow(/other terms/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    expect(decide(db, { ...base, decision: "REJECTED", signedSha256: rejectionSha256(hash), passkey }, t0)).toBe("REJECTED");
    expect(db.prepare("SELECT decision, approved_sha256 FROM approvals").get()).toEqual({ decision: "REJECTED", approved_sha256: hash });
  });

  it("derives a rejection hash that differs from the terms hash and from every other proposal's", () => {
    expect(rejectionSha256(hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(rejectionSha256(hash)).not.toBe(hash);
    expect(rejectionSha256(hash)).toBe(sha256Hex(`kit11 reject v1 ${hash}`));
    expect(() => rejectionSha256("ABC")).toThrow(/64/);
  });

  it("records a passkey approval after expiry as too late, with the credential", () => {
    const db = setup();
    const late = new Date("2026-10-30T14:10:01Z");
    expect(decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: hash.slice(0, 8), approver: "max (passkey cred-1)", method: "passkey", signedSha256: hash, passkey }, late)).toBe("EXPIRED");
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'approval.too_late'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ method: "passkey", passkey: { credential_id: "cred-1" } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
  });
});

describe("price options", () => {
  const option = (id: string, opt: string): Terms => ({
    schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: "2026-10-30T15:00:00Z", option: opt,
    steps: [{ order: "1", agent: "treasury", replaces_credential_hash: "0xaa", credential_hash: "0x01" }],
  });

  it("decide() approves only one option for the same mandates, whatever the method", () => {
    const db = openDb(":memory:");
    const [a, b] = [option("P-0001", "A"), option("P-0002", "B")];
    createProposal(db, { terms: a, createdBy: "treasury" }, t0);
    createProposal(db, { terms: b, createdBy: "treasury" }, t0);
    decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: termsHash(a).slice(0, 8), approver: "max", method: "cli" }, t0);
    expect(() => decide(db, { proposalId: "P-0002", decision: "APPROVED", typedPrefix: termsHash(b).slice(0, 8), approver: "max", method: "web" }, t0))
      .toThrow(/another option, P-0001, was already approved/);
    // Rejecting the other option stays possible.
    expect(decide(db, { proposalId: "P-0002", decision: "REJECTED", typedPrefix: termsHash(b).slice(0, 8), approver: "max", method: "cli" }, t0)).toBe("REJECTED");
  });
});

describe("enrolment windows", () => {
  const origin = "https://kit11.example.workers.dev";
  const rpId = "kit11.example.workers.dev";

  it("opens a ten-minute window and stores only the code's hash", () => {
    const db = openDb(":memory:");
    const { window, code } = openEnrolment(db, { rpId, origin }, t0);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(window.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(window.user_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(window.expires_at).toBe("2026-10-30T14:10:00.000Z");
    expect(window.code_sha256).toBe(codeSha256(code));
    const dump = JSON.stringify([db.prepare("SELECT * FROM passkey_enrolments").all(), db.prepare("SELECT * FROM audit_log").all()]);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(code.replace("-", ""));
    expect(openWindow(db, t0)?.window_id).toBe(window.window_id);
  });

  it("reads a typed code the way people type it", () => {
    expect(normalizeCode(" ab1o-iL9z ")).toBe("AB10119Z");
    expect(codeSha256("ab1o-il9z")).toBe(codeSha256("AB10-119Z"));
    expect(normalizeCode("AB10-119")).toBeNull();
    expect(normalizeCode("AB10-119Z0")).toBeNull();
    expect(normalizeCode("AB10-119U")).toBeNull();
    expect(codeSha256("nope")).toBeNull();
  });

  it("closes the previous window when a new one opens, and expires windows on time", () => {
    const db = openDb(":memory:");
    const first = openEnrolment(db, { rpId, origin }, t0).window;
    const second = openEnrolment(db, { rpId, origin }, new Date("2026-10-30T14:01:00Z")).window;
    expect(db.prepare("SELECT status FROM passkey_enrolments WHERE window_id = ?").get(first.window_id)).toEqual({ status: "CLOSED" });
    // A new user handle each time: a new passkey never overwrites the pinned one on the phone before it is accepted.
    expect(second.user_id).not.toBe(first.user_id);
    expect(openWindow(db, new Date("2026-10-30T14:10:59Z"))?.window_id).toBe(second.window_id);
    expect(openWindow(db, new Date("2026-10-30T14:11:00Z"))).toBeNull();
    expect(db.prepare("SELECT status FROM passkey_enrolments WHERE window_id = ?").get(second.window_id)).toEqual({ status: "EXPIRED" });
  });

  it("refuses a second passkey unless asked to replace the first; the new one revokes the old", () => {
    const db = openDb(":memory:");
    const w1 = openEnrolment(db, { rpId, origin }, t0).window;
    recordPasskey(db, { window: w1, credentialId: "cred-1", publicKey: "pk1", counter: 0, transports: ["internal"], aaguid: null, registrationJson: "{}", label: "max" }, t0);
    expect(activePasskey(db)?.credential_id).toBe("cred-1");
    expect(() => openEnrolment(db, { rpId, origin }, t0)).toThrow(/already enrolled/);
    const w2 = openEnrolment(db, { rpId, origin, replace: true }, t0).window;
    expect(activePasskey(db)?.credential_id).toBe("cred-1");
    recordPasskey(db, { window: w2, credentialId: "cred-2", publicKey: "pk2", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
    expect(activePasskey(db)?.credential_id).toBe("cred-2");
    expect(db.prepare("SELECT credential_id, status FROM passkeys ORDER BY credential_id").all()).toEqual([
      { credential_id: "cred-1", status: "REVOKED" }, { credential_id: "cred-2", status: "ACTIVE" },
    ]);
    expect(db.prepare("SELECT status FROM passkey_enrolments ORDER BY opened_at, window_id").all().map((r) => (r as { status: string }).status)).toEqual(["USED", "USED"]);
    expect(db.prepare("SELECT event FROM audit_log WHERE event LIKE 'passkey.%' ORDER BY seq").all().map((r) => (r as { event: string }).event))
      .toEqual(["passkey.enrolment_opened", "passkey.enrolled", "passkey.enrolment_opened", "passkey.revoked", "passkey.enrolled"]);
  });

  it("will not record a passkey from a window that is no longer open", () => {
    const db = openDb(":memory:");
    const w = openEnrolment(db, { rpId, origin }, t0).window;
    const late = new Date("2026-10-30T14:10:00Z");
    expect(() => recordPasskey(db, { window: w, credentialId: "cred-1", publicKey: "pk1", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, late))
      .toThrow(/not open/);
    expect(activePasskey(db)).toBeNull();
  });
});
