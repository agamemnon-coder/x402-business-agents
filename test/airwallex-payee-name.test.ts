// The payee's bank checks the account and the name before the CFO is asked (src/airwallex/payeeName.ts,
// AIRWALLEX_PAYEE_CHECK=on). Breaks if a mismatched, closed or unchecked account reaches a proposal with the flag on, if
// a check of one account covers another, if the bank's answer is missing from the signed terms, or if the flag being
// off changes anything. No network: the in-memory stand-ins only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ibanSha } from "../src/agents/invoice.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { checkPayeeAddName, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { FakePayeeNames, nameCheckVerdict, verifyBody } from "../src/airwallex/payeeName.js";
import { openDb, type DB } from "../src/db/open.js";
import { checkPayeeChangeName, proposePayeeChange, recordVerification, requestPayeeChange } from "../src/policy/payeeChange.js";
import { DE } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "Hafenstraße 9", city: "Hamburg", postcode: "20457" };
const HOW = "called Lagerhaus Nord on the number in our 2025 framework contract; their accounts team confirmed the IBAN";
const LAGERHAUS_IBAN = "DE75512108001245126199";

let dir: string;
let db: DB;
let bank: FakePayeeNames;
const env = process.env;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "payee-name-"));
  db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  bank = new FakePayeeNames();
  process.env = { ...env, AIRWALLEX_PAYEE_CHECK: "on" };
});
afterEach(() => { process.env = env; rmSync(dir, { recursive: true, force: true }); });

const verifiedAdd = async () => {
  const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(DE), filename: "invoice.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const req = requestPayeeAddForInvoice(db, out.invoice.id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  return req.add_id;
};
const proposals = () => (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind IN ('payee_add', 'payee_change')").get() as { n: number }).n;

describe("a new supplier's account, checked with its bank before the CFO is asked", () => {
  it("proposes only after the bank confirmed the account and the name; the answer is in the signed terms", async () => {
    const id = await verifiedAdd();
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/not checked with the payee's bank yet/);
    bank.accounts.set(LAGERHAUS_IBAN, { name: "Lagerhaus Nord GmbH", entity: "COMPANY", bank: "Test Bank" });
    const c = await checkPayeeAddName(db, bank, id, "human", now);
    expect(c).toMatchObject({ code: "VERIFIED", match: "FULL_MATCH", proceed: 1 });
    const p = proposePayeeAdd(db, id, "treasury", now);
    expect(JSON.parse(p.terms_json).name_check).toMatchObject({ name: "Lagerhaus Nord GmbH", code: "VERIFIED", match: "FULL_MATCH", label: "the payee's bank confirmed the account and the name" });
  });

  it("checks the supplier's own name, never an account holder named on the request", async () => {
    const id = await verifiedAdd();
    const r = db.prepare("SELECT details_json FROM payee_adds WHERE add_id = ?").get(id) as { details_json: string };
    db.prepare("UPDATE payee_adds SET details_json = ? WHERE add_id = ?").run(JSON.stringify({ ...JSON.parse(r.details_json), accountName: "Mallory Ltd" }), id);
    bank.accounts.set(LAGERHAUS_IBAN, { name: "Mallory Ltd", entity: "COMPANY", bank: "Test Bank" });
    await checkPayeeAddName(db, bank, id, "human", now);
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/holds this account as "Mallory Ltd", not as "Lagerhaus Nord GmbH"/);
  });

  it("refuses a name the bank does not hold, before any proposal: the CFO's phone never shows it", async () => {
    const id = await verifiedAdd();
    bank.accounts.set(LAGERHAUS_IBAN, { name: "Northbridge Trading Ltd", entity: "COMPANY", bank: "Test Bank" });
    const c = await checkPayeeAddName(db, bank, id, "human", now);
    expect(c).toMatchObject({ code: "VERIFIED", match: "NOT_MATCHED", proceed: 0, resolved_name: "Northbridge Trading Ltd" });
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/holds this account as "Northbridge Trading Ltd", not as "Lagerhaus Nord GmbH"/);
    expect(proposals()).toBe(0);
    expect(db.prepare("SELECT event FROM audit_log WHERE event = 'payee.name_check_refused'").all()).toHaveLength(1);
  });

  it("refuses a partial match, a person's account for a company, a closed account and an unanswered check", async () => {
    const id = await verifiedAdd();
    bank.accounts.set(LAGERHAUS_IBAN, { name: "Lagerhaus Nord", entity: "COMPANY", bank: "Test Bank" });
    await checkPayeeAddName(db, bank, id, "human", now);
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/PARTIAL_MATCH/);
    bank.accounts.set(LAGERHAUS_IBAN, { name: "Lagerhaus Nord GmbH", entity: "PERSONAL", bank: "Test Bank" });
    await checkPayeeAddName(db, bank, id, "human", now);
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/FULL_MATCH_INCORRECT_TYPE/);
    bank.accounts.delete(LAGERHAUS_IBAN);
    await checkPayeeAddName(db, bank, id, "human", now);
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/does not exist or is closed/);
    bank.nextCode = "EXTERNAL_SERVICE_UNAVAILABLE";
    await checkPayeeAddName(db, bank, id, "human", now);
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/did not answer/);
    expect(proposals()).toBe(0);
  });

  it("lets a bank that cannot verify through, labelled, so the CFO sees it in the signed terms", async () => {
    const id = await verifiedAdd();
    bank.nextCode = "CANNOT_VERIFY";
    await checkPayeeAddName(db, bank, id, "human", now);
    const p = proposePayeeAdd(db, id, "treasury", now);
    expect(JSON.parse(p.terms_json).name_check.label).toMatch(/could not verify/);
  });

  it("a check older than a day does not count", async () => {
    const id = await verifiedAdd();
    bank.accounts.set(LAGERHAUS_IBAN, { name: "Lagerhaus Nord GmbH", entity: "COMPANY", bank: "Test Bank" });
    await checkPayeeAddName(db, bank, id, "human", new Date(now.getTime() - 25 * 3_600_000));
    expect(() => proposePayeeAdd(db, id, "treasury", now)).toThrow(/older than a day/);
  });

  it("with the flag off, nothing is asked and the terms are as before", async () => {
    process.env = { ...env };
    delete process.env.AIRWALLEX_PAYEE_CHECK;
    const id = await verifiedAdd();
    const p = proposePayeeAdd(db, id, "treasury", now);
    expect(JSON.parse(p.terms_json).name_check).toBeUndefined();
    expect(bank.calls).toBe(0);
  });
});

describe("a supplier's new bank details, checked with the new bank", () => {
  const OLD = "DE89370400440532013000";
  const NEW = "DE02100100100006820101";
  const verifiedChange = () => {
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_old', 'Bergtex Textil GmbH', ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')").run(OLD.slice(-4), ibanSha(OLD));
    const c = requestPayeeChange(db, { vendor: "Bergtex Textil GmbH", iban: NEW, bic: "PBNKDEFFXXX", source: "BTX-2026-12" }, "treasury", now);
    recordVerification(db, c.change_id, { by: "max", how: "called Bergtex on +49 30 0000000 from our 2025 contract; the accounts team confirmed the new account", actor: "human" }, now);
    return c.change_id;
  };

  it("refuses a new account held under another name (the classic invoice fraud), and proposes a confirmed one", async () => {
    const id = verifiedChange();
    bank.accounts.set(NEW, { name: "Bergtex Holding Services", entity: "COMPANY", bank: "Test Bank" });
    await checkPayeeChangeName(db, bank, id, "human", now);
    expect(() => proposePayeeChange(db, id, "treasury", now)).toThrow(/not as "Bergtex Textil GmbH"/);
    bank.accounts.set(NEW, { name: "Bergtex Textil GmbH", entity: "COMPANY", bank: "Test Bank" });
    await checkPayeeChangeName(db, bank, id, "human", now);
    expect(JSON.parse(proposePayeeChange(db, id, "treasury", now).terms_json).name_check.match).toBe("FULL_MATCH");
  });
});

describe("the verdicts and the request body", () => {
  it("proceeds only on VERIFIED with FULL_MATCH, or CANNOT_VERIFY (labelled)", () => {
    const v = (code: string, match: string | null) => nameCheckVerdict({ code, match, resolvedName: null, resolvedBank: null }, "X").proceed;
    expect([v("VERIFIED", "FULL_MATCH"), v("CANNOT_VERIFY", null)]).toEqual([true, true]);
    expect([v("VERIFIED", "PARTIAL_MATCH"), v("VERIFIED", "NOT_MATCHED"), v("VERIFIED", null), v("INVALID", null), v("EXTERNAL_SERVICE_UNAVAILABLE", null), v("SOMETHING_NEW", null)]).toEqual([false, false, false, false, false, false]);
  });

  it("sends a LOCAL check with the account holder's name and the IBAN", () => {
    expect(verifyBody({ name: "Lagerhaus Nord GmbH", entity: "COMPANY", country: "DE", currency: "EUR", iban: "DE75 5121 0800 1245 1261 99" })).toEqual({
      transfer_method: "LOCAL", entity_type: "COMPANY",
      bank_details: { account_name: "Lagerhaus Nord GmbH", bank_country_code: "DE", account_currency: "EUR", iban: LAGERHAUS_IBAN },
    });
  });
});
