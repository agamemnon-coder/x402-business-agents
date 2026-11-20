// The execution guard's re-check of a passkey approval (src/policy/signedApproval.ts approvalSignatureRefusal) on what
// the other files leave: a passkey approval over terms changed after it; a line of a signed batch stands on the
// batch's signature, past a batch row that names no batch, and not when the batch's stored terms were changed (no
// longer listing it, or unreadable) or the batch's own signature was changed. Each refusal says why; nothing is
// written. A virtual test authenticator; test money only.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal, nextProposalId } from "../src/policy/approvals.js";
import { createBatch } from "../src/policy/batch.js";
import { approvalSignatureRefusal } from "../src/policy/signedApproval.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
let n = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++n}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });

async function enrol(db: DB): Promise<FakeAuthenticator> {
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
  await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, NOW);
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
  return phone;
}
function payment(db: DB, amount: string, vendor: string): { id: string; hash: string } {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor, invoice_no: `INV-${id}` } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return { id, hash: termsHash(terms) };
}
const sign = async (db: DB, phone: FakeAuthenticator, id: string, hash: string) =>
  processAssertion(db, item("assertion", { proposal_id: id, terms_sha256: hash, credential: phone.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++n }) }, id), NOW);

describe("a passkey approval", () => {
  it("over terms changed after it does not stand", async () => {
    const db = openDb(":memory:");
    const phone = await enrol(db);
    const p = payment(db, "1850.00", "Bergtex Textil GmbH");
    expect((await sign(db, phone, p.id, p.hash)).status).toBe("approved");
    db.prepare("UPDATE proposals SET terms_json = replace(terms_json, '1850.00', '18500.00') WHERE proposal_id = ?").run(p.id);
    expect(approvalSignatureRefusal(db, p.id)).toBe(`${p.id}: the stored terms do not hash to the approved hash`);
  });
});

describe("a line of a signed batch", () => {
  async function signedBatch() {
    const db = openDb(":memory:");
    const phone = await enrol(db);
    const a = payment(db, "120.00", "Bergtex Textil GmbH");
    const b = payment(db, "130.00", "Ridgeline Outfitters");
    const batch = createBatch(db, [a.id, b.id], "treasury", NOW);
    expect((await sign(db, phone, batch.proposal_id, batch.terms_sha256)).status).toBe("approved");
    expect(approvalSignatureRefusal(db, a.id)).toBeNull();
    return { db, a, batch };
  }

  it("stands on the batch's signature, past a batch row that names no batch on record", async () => {
    const { db, a } = await signedBatch();
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO batch_lines (batch_id, proposal_id, position, terms_sha256) VALUES ('P-9999', ?, 0, ?)").run(a.id, a.hash);
    expect(approvalSignatureRefusal(db, a.id)).toBeNull();
  });

  it("does not stand when the batch's stored terms no longer list it, or cannot be read", async () => {
    const { db, a, batch } = await signedBatch();
    db.prepare("UPDATE proposals SET terms_json = '{}' WHERE proposal_id = ?").run(batch.proposal_id);
    expect(approvalSignatureRefusal(db, a.id)).toBe(`${a.id}: batch ${batch.proposal_id}'s signed terms do not list it with these terms`);
    db.prepare("UPDATE proposals SET terms_json = '{not json' WHERE proposal_id = ?").run(batch.proposal_id);
    expect(approvalSignatureRefusal(db, a.id)).toBe(`${a.id}: batch ${batch.proposal_id}'s signed terms do not list it with these terms`);
  });

  it("does not stand when the batch's own signature was changed", async () => {
    const { db, a, batch } = await signedBatch();
    db.prepare("UPDATE passkey_assertions SET assertion_json = '{not json' WHERE proposal_id = ?").run(batch.proposal_id);
    expect(approvalSignatureRefusal(db, a.id)).toBe(`${a.id} is a line of batch ${batch.proposal_id}: ${batch.proposal_id}: approved as a passkey approval, but no stored passkey signature verifies over its exact terms (the stored signature was changed)`);
  });
});
