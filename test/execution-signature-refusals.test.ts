// The execution guard's re-check of an approval (src/policy/signedApproval.ts approvalSignatureRefusal), on the cases
// test/execution-signature.test.ts does not reach: a payment approved by Purser's code within the limit to pay alone
// stands only with its own record, over the approved hash, under a limit in force then that covers the exact amount;
// a passkey approval refuses a stored signature by a key that is not enrolled, one dated before its key was enrolled,
// and one whose stored text was changed; a typed prefix counts only in a ledger where no passkey was ever enrolled.
// Each refusal says why; nothing is written.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { sealPasskey, type SealedFields } from "../src/passkey/seal.js";
import { ALONE_KEY, SYSTEM_DEFAULT, aloneLimitInForce, aloneLimitRecord, setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { approveWithinLimit, createProposal, decide, nextProposalId } from "../src/policy/approvals.js";
import { approvalSignatureRefusal, policyApprovalCheck } from "../src/policy/signedApproval.js";
import { aloneDecision, plainCents } from "../src/policy/withinLimit.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
let tickets = 0;
let counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });

async function enrol(db: DB, label = "max"): Promise<FakeAuthenticator> {
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
  await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label }, NOW);
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
  return phone;
}
function payment(db: DB, amount: string, kind = "invoice_payment"): { id: string; hash: string } {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind, proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor: "Bergtex Textil GmbH", invoice_no: `BTX-${id}` } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return { id, hash: termsHash(terms) };
}
const LIMIT = { currency: "EUR", amount: "500.00" };
function forgePolicyApproval(db: DB, id: string, hash: string): void {
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'Purser''s code', 'policy', ?, ?)").run(id, hash, hash.slice(0, 8), NOW.toISOString());
}
const alone = (db: DB, id: string) => approveWithinLimit(db, { proposalId: id, limit: LIMIT, rule: "within the limit to pay alone", agent: "treasury" }, NOW);

describe("a payment Purser's code approved within the limit to pay alone", () => {
  it("stands on its record, under a labelled limit in force then that covers the exact amount", () => {
    const db = openDb(":memory:");
    expect(setSystemDefaultAloneLimit(db, "500.00", NOW)).toBe(true);
    expect(setSystemDefaultAloneLimit(db, "500.00", NOW)).toBe(false);
    const { id } = payment(db, "120.00");
    expect(alone(db, id)).toEqual({ ok: true });
    expect(policyApprovalCheck(db, id, { signature: true })).toMatchObject({ ok: true, limit: { amount: "500.00", source: { kind: "system_default" } } });
    expect(approvalSignatureRefusal(db, id)).toBeNull();
  });

  it("does not stand without its record, with a record over other terms, or with terms changed after", () => {
    const db = openDb(":memory:");
    setSystemDefaultAloneLimit(db, "500.00", NOW);
    // An approval row that claims the policy approved it, written straight into the ledger: no record behind it.
    const a = payment(db, "120.00");
    forgePolicyApproval(db, a.id, a.hash);
    expect(approvalSignatureRefusal(db, a.id)).toBe(`${a.id}: approved by the policy, but no proposal.within_limit record stands for these terms`);
    const b = payment(db, "130.00");
    alone(db, b.id);
    audit(db, "system", "proposal.within_limit", b.id, { terms_sha256: "0".repeat(64) }, NOW);
    expect(approvalSignatureRefusal(db, b.id)).toBe(`${b.id}: approved by the policy, but no proposal.within_limit record stands for these terms`);
    const c = payment(db, "140.00");
    alone(db, c.id);
    db.prepare("UPDATE proposals SET terms_json = replace(terms_json, '140.00', '1400.00') WHERE proposal_id = ?").run(c.id);
    expect(approvalSignatureRefusal(db, c.id)).toBe(`${c.id}: the stored terms do not hash to the approved hash`);
  });

  it("does not stand when no limit was in force then, or the amount is above the limit that was", () => {
    const db = openDb(":memory:");
    // A limit written by hand without its label: no limit was in force at the approval.
    audit(db, "system", SYSTEM_DEFAULT, ALONE_KEY, { key: ALONE_KEY, value: "500.00", label: "set by hand" }, NOW);
    const a = payment(db, "120.00");
    forgePolicyApproval(db, a.id, a.hash);
    audit(db, "system", "proposal.within_limit", a.id, { terms_sha256: a.hash }, NOW);
    expect(approvalSignatureRefusal(db, a.id)).toBe(`${a.id}: approved by the policy, but no limit to pay alone was in force then (none signed by the CFO, and no labelled system default)`);

    const db2 = openDb(":memory:");
    setSystemDefaultAloneLimit(db2, "500.00", NOW);
    const b = payment(db2, "120.00");
    alone(db2, b.id);
    // The stored amount raised past the limit, hash and approval rewritten to match: the limit still refuses it.
    const terms = { ...(JSON.parse((db2.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(b.id) as { terms_json: string }).terms_json) as Terms), amount: "900.00" } as Terms;
    const h = termsHash(terms);
    db2.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(terms), h, b.id);
    db2.prepare("UPDATE approvals SET approved_sha256 = ? WHERE proposal_id = ?").run(h, b.id);
    audit(db2, "system", "proposal.within_limit", b.id, { terms_sha256: h }, NOW);
    expect(policyApprovalCheck(db2, b.id, { signature: false })).toEqual({ ok: false, reason: `${b.id}: EUR 900.00 is not within the EUR 500.00 in force then` });
  });

  it("is never one for a kind code does not pay alone, nor for another method", async () => {
    const db = openDb(":memory:");
    setSystemDefaultAloneLimit(db, "500.00", NOW);
    const r = payment(db, "10.00", "refund_batch");
    expect(alone(db, r.id)).toEqual({ ok: false, reason: `${r.id} is a refund_batch: only an invoice's payment may be paid alone` });
    // A row that claims the policy approved a refund batch.
    forgePolicyApproval(db, r.id, r.hash);
    expect(approvalSignatureRefusal(db, r.id)).toBe(`${r.id}: a refund_batch is never paid alone`);
    const p = payment(db, "20.00");
    decide(db, { proposalId: p.id, decision: "APPROVED", typedPrefix: p.hash.slice(0, 8), approver: "max", method: "cli" }, NOW);
    expect(policyApprovalCheck(db, p.id, { signature: true })).toEqual({ ok: false, reason: `${p.id}: approved by cli, not by the policy` });
    expect(policyApprovalCheck(db, "P-0404", { signature: true })).toEqual({ ok: false, reason: "P-0404: no approval on record" });
    expect(approvalSignatureRefusal(db, "P-0404")).toBe("P-0404 has no approval");
  });
});

describe("the limit to pay alone the record puts in force", () => {
  it("only a labelled default or a signed, executed change; a setting written by hand is no limit", () => {
    const db = openDb(":memory:");
    expect(aloneLimitRecord(db)).toBeNull();
    expect(() => setSystemDefaultAloneLimit(db, "0.00", NOW)).toThrow('a limit to pay alone is a plain amount above zero, not "0.00"');
    expect(() => setSystemDefaultAloneLimit(db, "500", NOW)).toThrow(/plain amount above zero/);
    setSystemDefaultAloneLimit(db, "500.00", NOW);
    expect(aloneLimitInForce(db)).toMatchObject({ amount: "500.00" });
    // The setting changed by hand: the record no longer matches, so nothing is in force.
    db.prepare("UPDATE settings SET value = '5000.00' WHERE key = ?").run(ALONE_KEY);
    expect(aloneLimitInForce(db)).toBeNull();
    // A policy.changed record for a proposal that never ran, or for no proposal at all, puts nothing in force.
    audit(db, "system", "policy.changed", ALONE_KEY, { proposal_id: "P-0404", to: "5000.00" }, NOW);
    expect(aloneLimitRecord(db)).toBeNull();
    audit(db, "system", "policy.changed", ALONE_KEY, { to: "5000.00" }, NOW);
    expect(aloneLimitRecord(db)).toBeNull();
    audit(db, "system", "setting.changed", ALONE_KEY, { value: "5000.00" }, NOW);
    expect(aloneLimitRecord(db)).toBeNull();
    // Once a signed change was recorded, a default is never written over it.
    expect(setSystemDefaultAloneLimit(db, "300.00", NOW)).toBe(false);
  });

  it("the arithmetic is integer cents, in the limit's own currency", () => {
    expect(plainCents("000000001.05")).toBe(105);
    expect(plainCents("1.5")).toBeNull();
    expect(plainCents("1234567890.00")).toBeNull();
    expect(aloneDecision("500.00", "EUR", LIMIT)).toBe("within");
    expect(aloneDecision("500.01", "EUR", LIMIT)).toBe("not_within");
    expect(aloneDecision("100.00", "USD", LIMIT)).toBe("not_within");
    expect(aloneDecision(100, "EUR", LIMIT)).toBe("not_within");
    expect(aloneDecision("1.00", "EUR", { currency: "EUR", amount: "0.00" })).toBe("no_limit");
  });
});

describe("a passkey approval's stored signatures", () => {
  async function approved() {
    const db = openDb(":memory:");
    const max = await enrol(db);
    const p = payment(db, "1850.00");
    const r = await processAssertion(db, item("assertion", { proposal_id: p.id, terms_sha256: p.hash, credential: max.sign({ challenge: challengeFor(p.hash), origin: ORIGIN, rpId: RP, counter: ++counter }) }, p.id), NOW);
    expect(r.status).toBe("approved");
    expect(approvalSignatureRefusal(db, p.id)).toBeNull();
    return { db, p };
  }

  it("refuses one by a key that is not enrolled", async () => {
    const { db, p } = await approved();
    db.pragma("foreign_keys = OFF");
    db.prepare("UPDATE passkey_assertions SET credential_id = 'stranger-credential' WHERE proposal_id = ?").run(p.id);
    expect(approvalSignatureRefusal(db, p.id)).toBe(`${p.id}: approved as a passkey approval, but no stored passkey signature verifies over its exact terms (signed by a key that is not enrolled (stranger))`);
  });

  it("refuses one dated before its key was enrolled", async () => {
    const { db, p } = await approved();
    db.prepare("UPDATE passkeys SET enrolled_at = '2026-11-20T10:30:00.000Z'").run();
    // Sealed again for the new date (as a genuine later enrolment would be), so the date check is the one that refuses.
    for (const row of db.prepare("SELECT credential_id, public_key, rp_id, origin, label, enrolled_at FROM passkeys").all() as SealedFields[]) sealPasskey(db, row);
    expect(approvalSignatureRefusal(db, p.id)).toMatch(/signed before the key was enrolled\)$/);
  });

  it("refuses one whose stored text was changed or cannot be read", async () => {
    const { db, p } = await approved();
    db.prepare("UPDATE passkey_assertions SET assertion_json = '{not json' WHERE proposal_id = ?").run(p.id);
    expect(approvalSignatureRefusal(db, p.id)).toMatch(/\(the stored signature was changed\)$/);
  });

  it("refuses an approval that names two people when one signature verifies", async () => {
    const { db, p } = await approved();
    db.prepare("UPDATE approvals SET approver = approver || ' + anna (passkey annaannaa)' WHERE proposal_id = ?").run(p.id);
    expect(approvalSignatureRefusal(db, p.id)).toBe(`${p.id}: needs the passkey signatures of 2 different people, and 1 verifies`);
  });

  it("refuses a security key approval with no security key signature behind it", async () => {
    const { db, p } = await approved();
    db.prepare("UPDATE approvals SET approver = 'max (passkey and security key)' WHERE proposal_id = ?").run(p.id);
    expect(approvalSignatureRefusal(db, p.id)).toBe(`${p.id}: approved with a passkey and a security key, but no stored security key signature of the same person verifies over its exact terms`);
  });
});

describe("a typed hash prefix", () => {
  it("counts only in a ledger where no passkey was enrolled before it; a revoked one still counts against it", async () => {
    const db = openDb(":memory:");
    const p = payment(db, "20.00");
    decide(db, { proposalId: p.id, decision: "APPROVED", typedPrefix: p.hash.slice(0, 8), approver: "max", method: "cli" }, NOW);
    expect(approvalSignatureRefusal(db, p.id)).toBeNull();
    const q = payment(db, "30.00");
    decide(db, { proposalId: q.id, decision: "APPROVED", typedPrefix: q.hash.slice(0, 8), approver: "max", method: "cli" }, new Date(NOW.getTime() + 60_000));
    await enrol(db);
    db.prepare("UPDATE passkeys SET status = 'REVOKED'").run();
    // Enrolled (NOW) before q's typed approval (NOW + 1 min, as recorded): refused, though the key is revoked now.
    db.prepare("UPDATE approvals SET created_at = ? WHERE proposal_id = ?").run(new Date(NOW.getTime() + 60_000).toISOString(), q.id);
    expect(approvalSignatureRefusal(db, q.id)).toBe(`${q.id}: approved by cli (a typed hash prefix), but a passkey is enrolled: only a passkey signature approves`);
  });
});
