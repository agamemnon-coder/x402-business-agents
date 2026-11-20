// Adding a new supplier (src/ap/vendors.ts) when the ledger changed between the steps. One account is never added under
// a second name, and a name already on file is never added again: checked when it is requested, again when it is
// filed for the CFO, and again inside the executor's lock after the CFO approved, so an approval given before another
// supplier took that name or account adds nothing and calls nothing at Airwallex. A verification is recorded only
// with an address, once, and the bank is asked only about a verified request.
import { beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { checkPayeeAddName, checkThenProposePayeeAdd, executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAdd } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { ibanSha } from "../src/agents/invoice.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { standInBank } from "./support/standInBank.js";

const now = new Date("2026-11-20T10:00:00Z");
const HOW = "called the supplier's accounts team on the number in our signed purchase contract; they confirmed the account";
const ADDRESS = { street: "Industriestrasse 4", city: "Stuttgart", postcode: "70565" };
const IBAN = "DE75512108001245126199";
const BIC = "SOGEDEFFXXX";

let db: DB, awx: FakeAirwallex;
beforeEach(async () => {
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
});

const request = (vendor = "Schwarzwald Holz GmbH", iban = IBAN) => requestPayeeAdd(db, { vendor, iban, bic: BIC, source: null }, "treasury", now);
const verify = (id: string, address = ADDRESS) => recordPayeeAddVerification(db, id, { by: "the CFO", how: HOW, actor: "human", address }, now);
/** Another supplier on file, as if it had been added meanwhile. */
const onFileMeanwhile = (name: string, iban: string) => db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES (?, ?, ?, ?, ?, 'EUR', 'LOCAL', 'ACTIVE')")
  .run(`ben_${name.length}_${iban.slice(-4)}`, name, iban.slice(-4), ibanSha(iban), BIC);
const status = (id: string) => (db.prepare("SELECT status FROM payee_adds WHERE add_id = ?").get(id) as { status: string }).status;
async function approvedAdd() {
  const req = request();
  verify(req.add_id);
  const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  return { req, p };
}
const created = () => awx.calls.filter((c) => c === "createPayoutBeneficiary").length;

describe("requesting and verifying a new supplier", () => {
  it("needs a name", () => {
    expect(() => requestPayeeAdd(db, { vendor: "   ", iban: IBAN, bic: BIC, source: null }, "treasury", now)).toThrow("a supplier needs a name");
    expect(db.prepare("SELECT COUNT(*) AS n FROM payee_adds").get()).toEqual({ n: 0 });
  });

  it("records a verification only with the supplier's whole address, and only once", () => {
    const req = request();
    for (const address of [{ ...ADDRESS, street: " " }, { ...ADDRESS, city: "" }, { ...ADDRESS, postcode: "" }]) {
      expect(() => verify(req.add_id, address)).toThrow("the supplier's address (street, city, postcode) is needed to add it at Airwallex");
    }
    expect(status(req.add_id)).toBe("REQUESTED");
    verify(req.add_id);
    expect(status(req.add_id)).toBe("VERIFIED");
    expect(() => verify(req.add_id)).toThrow(`${req.add_id} is verified, not waiting for verification`);
  });

  it("asks the payee's bank only about a request a person verified", async () => {
    const req = request();
    await expect(checkPayeeAddName(db, standInBank(), req.add_id, "treasury", now)).rejects.toThrow(`${req.add_id} is REQUESTED; only a request a person verified is checked with the bank`);
  });
});

describe("filing it for the CFO after the ledger changed", () => {
  it("refuses when a supplier of that name was added meanwhile", () => {
    const req = request();
    verify(req.add_id);
    onFileMeanwhile("Schwarzwald Holz GmbH", "DE89370400440532013000");
    expect(() => proposePayeeAdd(db, req.add_id, "treasury", now)).toThrow("Schwarzwald Holz GmbH is on file already");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'payee_add'").get()).toEqual({ n: 0 });
  });

  it("refuses when the same account was added meanwhile under another name", () => {
    const req = request();
    verify(req.add_id);
    onFileMeanwhile("Holz Schwarzwald Handel", IBAN);
    expect(() => proposePayeeAdd(db, req.add_id, "treasury", now)).toThrow("this account is already on file for Holz Schwarzwald Handel; one account is never added under a second name");
  });
});

describe("executing the CFO's approval after the ledger changed", () => {
  it("adds nothing and calls nothing when a supplier of that name was added after the approval", async () => {
    const { req, p } = await approvedAdd();
    onFileMeanwhile("Schwarzwald Holz GmbH", "DE89370400440532013000");
    await expect(executePayeeAdd(db, awx, p.proposal_id, {}, now)).rejects.toThrow("Schwarzwald Holz GmbH is on file already; nothing was added");
    expect(created()).toBe(0);
    expect(status(req.add_id)).toBe("PROPOSED");
  });

  it("adds nothing and calls nothing when the account was added under another name after the approval", async () => {
    const { p } = await approvedAdd();
    onFileMeanwhile("Holz Schwarzwald Handel", IBAN);
    await expect(executePayeeAdd(db, awx, p.proposal_id, {}, now)).rejects.toThrow("this account is already on file for Holz Schwarzwald Handel; nothing was added under a second name");
    expect(created()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM beneficiaries WHERE name = 'Schwarzwald Holz GmbH'").get()).toEqual({ n: 0 });
  });

  it("adds it once when nothing changed: on file, the request applied", async () => {
    const { req, p } = await approvedAdd();
    await executePayeeAdd(db, awx, p.proposal_id, {}, now);
    expect(created()).toBe(1);
    expect(status(req.add_id)).toBe("APPLIED");
    expect(db.prepare("SELECT name, iban_sha256 FROM beneficiaries WHERE name = 'Schwarzwald Holz GmbH'").get()).toEqual({ name: "Schwarzwald Holz GmbH", iban_sha256: ibanSha(IBAN) });
  });
});
