// A supplier's new bank details (E3): requested (by an agent or a person) changes nothing; only a person can record
// that the supplier confirmed them on a number we already had; only then can it be proposed; and only after the CFO's
// approval is the new IBAN the one invoices are paid to. The old one stays in the history.
import { beforeEach, describe, expect, it } from "vitest";
import { checkInvoice, ibanSha, type Invoice } from "../src/agents/invoice.js";
import { openDb, type DB } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { executePayeeChange, proposePayeeChange, recordVerification, requestPayeeChange } from "../src/policy/payeeChange.js";
import { rules } from "../src/policy/rules.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const now = new Date("2026-11-03T10:00:00Z");
const OLD = "DE89370400440532013000";
const NEW = "DE02100100100006820101";
const inv = (iban: string): Invoice => ({ invoice_no: "BTX-2026-12", vendor: "Bergtex Textil GmbH", amount: "1850.00", currency: "EUR", due_date: "2026-12-15", iban, bic: "PBNKDEFFXXX", reference: "BTX-2026-12" });

describe("changing a supplier's bank details", () => {
  let db: DB;
  let awx: FakeAirwallex;
  beforeEach(() => {
    db = openDb(":memory:");
    awx = new FakeAirwallex();
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_old', 'Bergtex Textil GmbH', ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')").run(OLD.slice(-4), ibanSha(OLD));
  });

  it("needs a request, a person's verification and the CFO's approval, in that order", async () => {
    expect(checkInvoice(db, inv(NEW)).ok).toBe(false);
    const c = requestPayeeChange(db, { vendor: "Bergtex Textil GmbH", iban: NEW, bic: "PBNKDEFFXXX", source: "BTX-2026-12" }, "treasury", now);
    expect(c.status).toBe("REQUESTED");
    // Not verified: no proposal.
    expect(() => proposePayeeChange(db, c.change_id, "treasury", now)).toThrow(/not verified/);
    // An agent cannot verify.
    expect(() => recordVerification(db, c.change_id, { by: "treasury", how: "the invoice says so", actor: "treasury" }, now)).toThrow(/only a person/);
    expect(() => recordVerification(db, c.change_id, { by: "max", how: "ok", actor: "human" }, now)).toThrow(/how it was verified/);
    recordVerification(db, c.change_id, { by: "max", how: "called Bergtex on +49 30 0000000 from our 2025 contract; Frau Beispiel confirmed the new account", actor: "human" }, now);
    const p = proposePayeeChange(db, c.change_id, "treasury", now);
    const terms = JSON.parse(p.terms_json);
    expect(terms).toMatchObject({ kind: "payee_change", vendor: "Bergtex Textil GmbH", old_iban_last4: "3000", new_iban: NEW, new_bic: "PBNKDEFFXXX" });
    expect(terms.verification.how).toMatch(/from our 2025 contract/);
    // Before approval nothing changed.
    expect(checkInvoice(db, inv(NEW)).ok).toBe(false);
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
    await executePayeeChange(db, awx, p.proposal_id, now);
    expect(awx.beneficiaries.map((b) => b.iban)).toEqual([NEW]);
    expect(checkInvoice(db, inv(NEW))).toMatchObject({ ok: true, ibanLast4: "0101" });
    // The old account is not paid any more, and the supplier is still one payee in the policy.
    expect(checkInvoice(db, { ...inv(OLD), bic: "COBADEFFXXX" }).ok).toBe(false);
    expect(rules(db).filter((r) => r.key.startsWith("counterparty:")).map((r) => r.key)).toEqual(["counterparty:Bergtex Textil GmbH"]);
    expect(db.prepare("SELECT status FROM beneficiaries ORDER BY beneficiary_id").all()).toEqual([{ status: "ACTIVE" }, { status: "REPLACED" }].sort((a, b) => (a.status < b.status ? -1 : 1)));
  });

  it("refuses a change for a vendor that is not a payee, or to the account already on file", () => {
    expect(() => requestPayeeChange(db, { vendor: "Bergtex Beispie1 GmbH", iban: NEW, bic: "PBNKDEFFXXX", source: null }, "treasury", now)).toThrow(/not an allowlisted payee/);
    expect(() => requestPayeeChange(db, { vendor: "Bergtex Textil GmbH", iban: OLD, bic: "COBADEFFXXX", source: null }, "treasury", now)).toThrow(/already on file/);
  });

  it("does not apply a change whose payee changed meanwhile", async () => {
    const c = requestPayeeChange(db, { vendor: "Bergtex Textil GmbH", iban: NEW, bic: "PBNKDEFFXXX", source: null }, "human", now);
    recordVerification(db, c.change_id, { by: "max", how: "called the number on our contract and confirmed", actor: "human" }, now);
    const p = proposePayeeChange(db, c.change_id, "human", now);
    db.prepare("UPDATE beneficiaries SET iban_last4 = '9999' WHERE beneficiary_id = 'ben_old'").run();
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
    await expect(executePayeeChange(db, awx, p.proposal_id, now)).rejects.toThrow(/on file is now …9999/);
    expect(awx.beneficiaries).toEqual([]);
  });
});

describe("the phone's view of a bank-detail change", () => {
  it("shows the full new IBAN, the old account and who verified it, with a fraud warning", async () => {
    const { describeTerms } = await import("../src/approve/client.js");
    const f = describeTerms({ kind: "payee_change", vendor: "Bergtex Textil GmbH", old_iban_last4: "3000", new_iban: NEW, new_bic: "PBNKDEFFXXX", verification: { by: "max", how: "called the number on our contract" } }, {});
    expect(f.approvable).toBe(true);
    expect(f.rows).toContainEqual(["New IBAN", NEW]);
    expect(f.rows).toContainEqual(["Old account", "…3000"]);
    expect(f.warnings[0]).toMatch(/invoice fraud/);
  });
});
