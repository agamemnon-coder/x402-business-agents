// Security review, 20 November, finding 1 (HIGH): execution trusted database rows, not signatures. The reviewer wrote an
// approvals row with method 'passkey' and no stored signature, set the proposal APPROVED, added an audit row through
// audit(), and beginExecution returned terms for EUR 9,999.00. Now the execution guard re-verifies the stored passkey
// signatures (src/policy/signedApproval.ts) against the enrolled public keys over the exact terms, and refuses, with the
// refusal in the audit log, an approval no verifying signature stands behind. Breaks if an approval row alone, a
// signature over other terms, a changed signature, one person's signature where four eyes needs two, or a typed prefix
// while a passkey is enrolled ever lets beginExecution return terms; or if the genuine flows (one CFO, four eyes, a
// signed batch) stop running.
import { describe, expect, it } from "vitest";
import { audit, verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { assertionSha256, challengeFor } from "../src/passkey/webauthn.js";
import { beginExecution, createProposal, nextProposalId } from "../src/policy/approvals.js";
import { createBatch } from "../src/policy/batch.js";
import { hashFirst } from "../src/policy/hashFirst.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
let tickets = 0;
let counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });

async function enrol(db: DB, label: string, add: boolean): Promise<FakeAuthenticator> {
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, ...(add ? { addPerson: label } : {}) }, NOW);
  const r = await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label }, NOW);
  expect(r.status).toBe("pending");
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
  return phone;
}

function payment(db: DB, amount: string, createdBy = "treasury"): { id: string; hash: string } {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor: "Bergtex Textil GmbH", invoice_no: `BTX-${id}` } as Terms;
  createProposal(db, { terms, createdBy: createdBy as never }, NOW);
  return { id, hash: termsHash(terms) };
}

const signWith = (phone: FakeAuthenticator, id: string, hash: string) =>
  item("assertion", { proposal_id: id, terms_sha256: hash, credential: phone.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter }) }, id);
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const refusals = (db: DB, id: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'execution.refused_unsigned' AND subject = ?").all(id) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as { reason: string });
const message = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as Error).message; } };

/** The reviewer's reproduction: an approval row, a status and an audit row, all written straight into the ledger. */
function forgeApproval(db: DB, id: string, hash: string, approver = "max (passkey forged00)", method = "passkey"): void {
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, ?, ?, ?, ?)").run(id, hash, approver, method, hash.slice(0, 8), NOW.toISOString());
  db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(id);
  audit(db, "human", "proposal.approved", id, { terms_sha256: hash, approver, method }, NOW);
}

describe("execution re-verifies the stored passkey signature (finding 1)", () => {
  it("refuses the reviewer's EUR 9,999.00: a passkey approval row with no stored signature, and logs why", async () => {
    const db = openDb(":memory:");
    await enrol(db, "max", false);
    const { id, hash } = payment(db, "9999.00");
    forgeApproval(db, id, hash);
    expect(verifyAuditChain(db).ok).toBe(true); // the forged audit row chains like any other
    const why = message(() => beginExecution(db, id, () => {}, NOW));
    expect(why).toMatch(/no passkey signature is stored for its terms/);
    expect(status(db, id)).toBe("APPROVED");
    expect(refusals(db, id)).toEqual([expect.objectContaining({ reason: expect.stringMatching(/no passkey signature/) })]);
    // The earlier check every money executor makes before any outside call refuses it too.
    expect(message(() => hashFirst(db, id))).toMatch(/no passkey signature/);
  });

  it("refuses a genuine signature over other terms, and a stored signature that was changed", async () => {
    const db = openDb(":memory:");
    const max = await enrol(db, "max", false);
    const small = payment(db, "12.00");
    expect((await processAssertion(db, signWith(max, small.id, small.hash), NOW)).status).toBe("approved");
    // The small payment's genuine signature, filed under the large one.
    const big = payment(db, "9999.00");
    forgeApproval(db, big.id, big.hash);
    const stored = db.prepare("SELECT * FROM passkey_assertions WHERE proposal_id = ?").get(small.id) as Record<string, unknown>;
    db.prepare("INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?)")
      .run("f".repeat(64), big.id, stored.credential_id, big.hash, stored.assertion_json, 0, NOW.toISOString());
    expect(message(() => beginExecution(db, big.id, () => {}, NOW))).toMatch(/no stored passkey signature verifies over its exact terms \(the stored signature was changed\)/);
    // Another genuine signature by the CFO's passkey, over the small payment's terms, stored whole under the large one.
    const other = max.sign({ challenge: challengeFor(small.hash), origin: ORIGIN, rpId: RP, counter: ++counter });
    db.prepare("DELETE FROM passkey_assertions WHERE proposal_id = ?").run(big.id);
    db.prepare("INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?)")
      .run(assertionSha256(other), big.id, stored.credential_id, big.hash, JSON.stringify(other), counter, NOW.toISOString());
    expect(message(() => beginExecution(db, big.id, () => {}, NOW))).toMatch(/the passkey signed other terms/);
    expect(status(db, big.id)).toBe("APPROVED");
    expect(refusals(db, big.id)).toHaveLength(2);
    // The genuine one still runs.
    expect(beginExecution<Terms & { amount: string }>(db, small.id, () => {}, NOW).amount).toBe("12.00");
  });

  it("refuses a typed hash prefix written into the ledger while a passkey is enrolled", async () => {
    const db = openDb(":memory:");
    await enrol(db, "max", false);
    const { id, hash } = payment(db, "9999.00");
    forgeApproval(db, id, hash, "max", "cli");
    expect(message(() => beginExecution(db, id, () => {}, NOW))).toMatch(/approved by cli \(a typed hash prefix\), but a passkey is enrolled/);
  });

  it("four eyes: one person's genuine signature under an approval row that names one person is refused; two people run", async () => {
    const db = openDb(":memory:");
    const max = await enrol(db, "max", false);
    const anna = await enrol(db, "anna", true);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '500.00', ?)").run(NOW.toISOString());
    const one = payment(db, "1850.00");
    expect((await processAssertion(db, signWith(max, one.id, one.hash), NOW)).status).toBe("cosigned");
    // Max's real first signature is stored; the second person's approval is written straight into the ledger.
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'max (passkey x)', 'passkey', ?, ?)").run(one.id, one.hash, one.hash.slice(0, 8), NOW.toISOString());
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(one.id);
    expect(message(() => beginExecution(db, one.id, () => {}, NOW))).toMatch(/needs the passkey signatures of 2 different people, and 1 verifies/);
    const two = payment(db, "1850.00");
    expect((await processAssertion(db, signWith(max, two.id, two.hash), NOW)).status).toBe("cosigned");
    expect((await processAssertion(db, signWith(anna, two.id, two.hash), NOW)).status).toBe("approved");
    expect(beginExecution<Terms & { amount: string }>(db, two.id, () => {}, NOW).amount).toBe("1850.00");
  });

  it("a line of a batch the CFO signed runs on the batch's signature; a line no signed batch lists does not", async () => {
    const db = openDb(":memory:");
    const max = await enrol(db, "max", false);
    const a = payment(db, "100.00");
    const b = payment(db, "200.00");
    const batch = createBatch(db, [a.id, b.id], "treasury", NOW);
    expect((await processAssertion(db, signWith(max, batch.proposal_id, batch.terms_sha256), NOW)).status).toBe("approved");
    expect([status(db, a.id), status(db, b.id)]).toEqual(["APPROVED", "APPROVED"]);
    expect(beginExecution<Terms & { amount: string }>(db, a.id, () => {}, NOW).amount).toBe("100.00");
    // A third payment's approval row copied from a line's, naming the same batch, is not in the signed list.
    const c = payment(db, "9999.00");
    db.prepare("INSERT INTO batch_lines (batch_id, proposal_id, position, terms_sha256) VALUES (?, ?, 9, ?)").run(batch.proposal_id, c.id, c.hash);
    forgeApproval(db, c.id, c.hash);
    expect(message(() => beginExecution(db, c.id, () => {}, NOW))).toMatch(/batch .*'s signed terms do not list it/);
  });
});
