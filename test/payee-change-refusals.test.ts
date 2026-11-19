// A supplier's new bank details (src/policy/payeeChange.ts), the requests refused before anything is recorded: not an
// IBAN, not a BIC, an account outside Germany, a supplier not on file, the details already on file, an account already
// another supplier's; a verification of a change that is not waiting for one; a bank check of a change nobody verified;
// a proposal after the supplier's account changed; and no bank to ask when the name check is on.
import { beforeEach, describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { openDb, type DB } from "../src/db/open.js";
import { checkPayeeChangeName, checkThenProposePayeeChange, proposePayeeChange, recordVerification, requestPayeeChange } from "../src/policy/payeeChange.js";
import { standInBank } from "./support/standInBank.js";

const now = new Date("2026-11-03T10:00:00Z");
const OLD = "DE89370400440532013000";
const NEW = "DE02100100100006820101";
const OTHERS = "DE75512108001245126199";
const HOW = "called Bergtex on +49 30 0000000 from our 2025 contract; Frau Beispiel confirmed it";
let db: DB;
const ask = (over: Partial<{ vendor: string; iban: string; bic: string }> = {}) => requestPayeeChange(db, { vendor: "Bergtex Textil GmbH", iban: NEW, bic: "PBNKDEFFXXX", source: null, ...over }, "treasury", now);

beforeEach(() => {
  db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_old', 'Bergtex Textil GmbH', ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')").run(OLD.slice(-4), ibanSha(OLD));
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_lic', 'Lizenzhaus Beispiel GmbH', ?, ?, 'SSKMDEMMXXX', 'EUR', 'SWIFT')").run(OTHERS.slice(-4), ibanSha(OTHERS));
});

describe("requests refused before anything is recorded", () => {
  it("not an IBAN, not a BIC, or an account outside Germany", () => {
    expect(() => ask({ iban: "NOT AN IBAN" })).toThrow("not an IBAN: NOT AN IBAN");
    expect(() => ask({ bic: "?" })).toThrow("not a BIC: ?");
    expect(() => ask({ iban: "NL91ABNA0417164300", bic: "ABNANL2A" })).toThrow("this build adds German (DE) accounts at Airwallex only, not NL; nothing was requested");
  });

  it("a supplier not on file, the details already on file, and an account that is another supplier's", () => {
    expect(() => ask({ vendor: "Nobody GmbH" })).toThrow("Nobody GmbH is not an allowlisted payee; a new supplier is not a bank-detail change");
    expect(() => ask({ iban: OLD.replace(/(.{4})/g, "$1 "), bic: "cobadeffxxx" })).toThrow("these bank details are already on file for Bergtex Textil GmbH");
    expect(() => ask({ iban: OTHERS, bic: "SSKMDEMMXXX" })).toThrow(/this account is already on file for Lizenzhaus Beispiel GmbH; one account is never two suppliers'/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM payee_changes").get()).toEqual({ n: 0 });
  });
});

describe("the steps after a request, out of order", () => {
  it("a change that is not waiting for verification, an unknown one, and a bank check before a person verified it", async () => {
    const c = ask();
    expect(() => recordVerification(db, "B-9999", { by: "max", how: HOW, actor: "human" }, now)).toThrow("no payee change B-9999");
    await expect(checkPayeeChangeName(db, standInBank(), c.change_id, "treasury", now)).rejects.toThrow(`${c.change_id} is REQUESTED; only a change a person verified is checked with the bank`);
    recordVerification(db, c.change_id, { by: "max", how: HOW, actor: "human" }, now);
    expect(() => recordVerification(db, c.change_id, { by: "max", how: HOW, actor: "human" }, now)).toThrow(`${c.change_id} is verified, not waiting for verification`);
  });

  it("no proposal after the supplier's account on file changed since the request", () => {
    const c = ask();
    recordVerification(db, c.change_id, { by: "max", how: HOW, actor: "human" }, now);
    db.prepare("UPDATE beneficiaries SET status = 'REPLACED' WHERE beneficiary_id = 'ben_old'").run();
    expect(() => proposePayeeChange(db, c.change_id, "treasury", now)).toThrow(`Bergtex Textil GmbH's account on file changed since ${c.change_id} was requested`);
  });

  it("with the bank's name check on and no bank to ask, nothing is proposed", async () => {
    const c = ask();
    recordVerification(db, c.change_id, { by: "max", how: HOW, actor: "human" }, now);
    await expect(checkThenProposePayeeChange(db, null, c.change_id, "treasury", now)).rejects.toThrow("no Airwallex keys: the new account's bank cannot be asked whether it carries Bergtex Textil GmbH's name, so nothing is proposed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });
});
