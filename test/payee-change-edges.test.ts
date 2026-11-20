// A supplier's new bank details (src/policy/payeeChange.ts), the paths test/payee-change.test.ts leaves: with the
// payee check switched off nothing is asked and the terms carry no check; a check already made today is not asked
// again; an approved change is refused when the supplier has no account on file any more, when the proposal is not a
// payee change, or when its account is not German (changed after the request); and the new account Airwallex already
// holds is adopted when it is this supplier's, while one the ledger holds for another supplier is never renamed: a new
// beneficiary is made. Against the in-memory Airwallex; no network.
import { beforeEach, describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { openDb, type DB } from "../src/db/open.js";
import { PAYEE_CHECK_FLAG } from "../src/airwallex/payeeName.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { checkPayeeChangeName, checkThenProposePayeeChange, executePayeeChange, recordVerification, requestPayeeChange } from "../src/policy/payeeChange.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { standInBank } from "./support/standInBank.js";

const now = new Date("2026-11-03T10:00:00Z");
const OLD = "DE89370400440532013000";
const NEW = "DE02100100100006820101";
const VENDOR = "Bergtex Textil GmbH";
let db: DB;
let awx: FakeAirwallex;

beforeEach(() => {
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_old', ?, ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')").run(VENDOR, OLD.slice(-4), ibanSha(OLD));
});

async function verified(): Promise<string> {
  const c = requestPayeeChange(db, { vendor: VENDOR, iban: NEW, bic: "PBNKDEFFXXX", source: null }, "human", now);
  recordVerification(db, c.change_id, { by: "max", how: "called the number on our contract and confirmed the new account", actor: "human" }, now);
  return c.change_id;
}
const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
};
const failure = (id: string) => JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.failed' AND subject = ?").get(id) as { payload_json: string }).payload_json) as { error: string };

describe("proposing", () => {
  it("with the payee check off nothing is asked, and the terms carry no check", async () => {
    const saved = process.env[PAYEE_CHECK_FLAG];
    process.env[PAYEE_CHECK_FLAG] = "off";
    try {
      const bank = standInBank();
      const p = await checkThenProposePayeeChange(db, bank, await verified(), "human", now);
      expect(bank.calls).toBe(0);
      expect(JSON.parse(p.terms_json)).not.toHaveProperty("name_check");
    } finally {
      if (saved === undefined) delete process.env[PAYEE_CHECK_FLAG]; else process.env[PAYEE_CHECK_FLAG] = saved;
    }
  });

  it("a check already made today is not asked again", async () => {
    const id = await verified();
    const bank = standInBank();
    await checkPayeeChangeName(db, bank, id, "human", now);
    const p = await checkThenProposePayeeChange(db, bank, id, "human", now);
    expect(bank.calls).toBe(1);
    expect(JSON.parse(p.terms_json)).toMatchObject({ name_check: { name: VENDOR, code: "VERIFIED" } });
  });
});

describe("executing an approved change", () => {
  it("refused when the supplier has no account on file any more", async () => {
    const p = await checkThenProposePayeeChange(db, standInBank(), await verified(), "human", now);
    approve(p.proposal_id);
    db.prepare("UPDATE beneficiaries SET status = 'REPLACED' WHERE beneficiary_id = 'ben_old'").run();
    await expect(executePayeeChange(db, awx, p.proposal_id, now)).rejects.toThrow(`${VENDOR}'s account on file is now …none, not …3000; nothing changed`);
    expect(awx.beneficiaries).toEqual([]);
  });

  it("refused when the proposal is not a payee change", async () => {
    const terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-03T11:00:00Z", total: "0.10" } as Terms;
    createProposal(db, { terms, createdBy: "support" }, now);
    approve("P-0001");
    await expect(executePayeeChange(db, awx, "P-0001", now)).rejects.toThrow("P-0001 is not a payee change");
  });

  it("an account that is not German is never added: the change fails, nothing at Airwallex", async () => {
    const p = await checkThenProposePayeeChange(db, standInBank(), await verified(), "human", now);
    // The stored terms changed to another country's account, rehashed (as only someone with the ledger file could).
    const t = JSON.parse(p.terms_json) as Record<string, unknown>;
    t.new_iban = "NL91ABNA0417164300";
    db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(t), termsHash(t as unknown as Terms), p.proposal_id);
    approve(p.proposal_id);
    await expect(executePayeeChange(db, awx, p.proposal_id, now)).rejects.toThrow("this build adds German (DE) accounts at Airwallex only; nothing changed");
    expect(failure(p.proposal_id).error).toBe("this build adds German (DE) accounts at Airwallex only");
    expect(awx.beneficiaries).toEqual([]);
  });

  it("adopts the account Airwallex already holds for this supplier", async () => {
    const p = await checkThenProposePayeeChange(db, standInBank(), await verified(), "human", now);
    approve(p.proposal_id);
    const held = await awx.createBeneficiary({ name: VENDOR, iban: NEW, bic: "PBNKDEFFXXX", currency: "EUR", countryCode: "DE", bankName: "B", address: { street: "s", city: "c", postcode: "1", countryCode: "DE" } });
    await executePayeeChange(db, awx, p.proposal_id, now);
    expect(awx.beneficiaries).toHaveLength(1);
    expect(db.prepare("SELECT beneficiary_id FROM beneficiaries WHERE status = 'ACTIVE'").get()).toEqual({ beneficiary_id: held.id });
  });

  it("never renames one the ledger holds for another supplier: a new beneficiary is made for this one", async () => {
    const p = await checkThenProposePayeeChange(db, standInBank(), await verified(), "human", now);
    approve(p.proposal_id);
    const theirs = await awx.createBeneficiary({ name: "Somebody Else GmbH", iban: NEW, bic: "PBNKDEFFXXX", currency: "EUR", countryCode: "DE", bankName: "B", address: { street: "s", city: "c", postcode: "1", countryCode: "DE" } });
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES (?, 'Somebody Else GmbH', '9999', ?, 'X', 'EUR', 'SWIFT', 'REPLACED')").run(theirs.id, "e".repeat(64));
    await executePayeeChange(db, awx, p.proposal_id, now);
    expect(awx.beneficiaries).toHaveLength(2);
    const active = db.prepare("SELECT beneficiary_id, name FROM beneficiaries WHERE status = 'ACTIVE'").get() as { beneficiary_id: string; name: string };
    expect(active.name).toBe(VENDOR);
    expect(active.beneficiary_id).not.toBe(theirs.id);
  });
});
