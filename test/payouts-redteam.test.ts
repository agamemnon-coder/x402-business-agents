// Red team of the FX payouts (PR 112), each finding as the scenario that broke it: a lost answer that left the invoice
// payable twice, a re-run that skipped the floor, two payments executed at once that both broke the EUR floor, payout
// settings outside EUR and USD that no Face ID guarded, a route's per-payout limit found only at Airwallex, and a new
// supplier created twice after a lost answer. All against the in-memory Airwallex stand-in: no outside call, test money.
import { standInBank, standInCheckedAdd } from "./support/standInBank.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, checkThenProposePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { fromCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { currentPolicy, loosens, validateChange } from "../src/policy/rules.js";
import { feeReserveFor, floorCents, fundingCurrency } from "../src/payouts/plan.js";
import { routeLimitReason } from "../src/payouts/routes.js";
import { setSetting } from "../src/world/settings.js";
import { NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { TR, UK, US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "fx-red-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
const status = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const add = async (text: string, name: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const proposeAdd = (id: string) => {
  const req = requestPayeeAddForInvoice(db, id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  standInCheckedAdd(db, req.add_id, now);
  const p = proposePayeeAdd(db, req.add_id, "treasury", now);
  approve(p.proposal_id);
  return p.proposal_id;
};
const addSupplier = async (id: string) => {
  await executePayeeAdd(db, awx, proposeAdd(id), { now: () => now, reader: parserOnly }, now);
  return apInvoice(db, id)!;
};
/** The invoice filed and approved; returns the proposal id. */
const approved = async (id: string) => {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  approve(out.proposal.proposal_id);
  return out.proposal.proposal_id;
};
const creates = () => awx.calls.filter((c) => c === "createPayoutTransfer").length;

describe("HIGH: a lost answer never leads to a second payout", () => {
  it("lost answer, not found yet: FAILED, the invoice is not set back to ready; the re-run adopts the one transfer", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await approved(id);
    awx.loseNextTransferAnswer = true;
    awx.transferLookupMisses = 1;
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow();
    expect(status(pid)).toBe("FAILED");
    expect(awx.transfers).toHaveLength(1);
    // Airwallex holds the payout: the invoice waits, it is not offered to be paid again.
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
    await executeSupplierPayment(db, awx, awx, pid);
    expect(awx.transfers).toHaveLength(1);
    expect(creates()).toBe(1);
    expect(status(pid)).toBe("EXECUTED");
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("paid");
  });

  it("a re-run whose resend is answered duplicate_request resolves the existing transfer, never closes the row", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await approved(id);
    awx.loseNextTransferAnswer = true;
    // Not listed after the lost answer, nor at the re-run's own look-up: the re-run resends under the same request_id.
    awx.transferLookupMisses = 2;
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow();
    await executeSupplierPayment(db, awx, awx, pid);
    expect(creates()).toBe(2);
    expect(awx.transfers).toHaveLength(1);
    expect(status(pid)).toBe("EXECUTED");
    const row = db.prepare("SELECT transfer_id, status FROM transfers").get() as { transfer_id: string; status: string };
    expect(row).toEqual({ transfer_id: awx.transfers[0]!.id, status: "PAID" });
  });

  it("a payout Airwallex refused at its first send is closed and never sent again, even on a re-run", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await approved(id);
    awx.refuseNextTransfer = "balance_insufficient";
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow(/balance_insufficient/);
    expect((db.prepare("SELECT status FROM transfers").get() as { status: string }).status).toBe("CANCELLED");
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow(/refused by Airwallex and closed; nothing is sent again/);
    expect(creates()).toBe(1);
    expect(awx.transfers).toHaveLength(0);
    // Nothing is under way: the invoice can be filed again, as a new proposal with its own Face ID.
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("ready");
  });
});

describe("HIGH: a re-run checks the floor again whenever no transfer exists yet", () => {
  it("the CFO raises usd_floor between attempts: the re-run sends nothing", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await approved(id);
    // The first create never reaches Airwallex and its answer is lost: nothing exists under the request_id.
    awx.dropNextTransfer = true;
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow();
    expect(status(pid)).toBe("FAILED");
    setSetting(db, "human", "usd_floor", fromCents(awx.bal.USD.availableCents - 100_000));
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow(/USD would now drop under its floor/);
    expect(creates()).toBe(1);
    expect(awx.transfers).toHaveLength(0);
  });
});

describe("MEDIUM-HIGH: payments executed at once cannot both break the EUR floor", () => {
  it("two approved payments, each fitting alone, executed concurrently: the second is refused before converting", async () => {
    const uk = await add(UK, "uk.pdf");
    const tr = await add(TR, "tr.pdf");
    await addSupplier(uk);
    await addSupplier(tr);
    // EUR 2,000.00 free above floor and commitments: GBP 960.00 costs EUR 1,123.20, TRY 52,000.00 costs EUR 1,378.00.
    setSetting(db, "human", "eur_obligations", "8000.00");
    const a = await approved(uk);
    const b = await approved(tr);
    const out = await Promise.allSettled([executeSupplierPayment(db, awx, awx, a), executeSupplierPayment(db, awx, awx, b)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const refused = out.find((o): o is PromiseRejectedResult => o.status === "rejected")!;
    expect(String(refused.reason)).toMatch(/EUR would now drop under its floor/);
    expect(awx.conversions).toHaveLength(1);
    expect(awx.bal.EUR.availableCents).toBeGreaterThanOrEqual(25_000_00 + 8000_00);
    // Nothing is left spoken for once the payment is done.
    expect(db.prepare("SELECT COUNT(*) AS n FROM payout_reservations WHERE status = 'HELD'").get()).toEqual({ n: 0 });
  });
});

describe("MEDIUM: payout floors, the funding currency and fee reserves are CFO policy", () => {
  it("shown with the policy, changed only through an approved policy_change, within bounds", async () => {
    const id = await add(UK, "uk.pdf");
    await addSupplier(id);
    const keys = currentPolicy(db).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["payout.funding_currency", "floor.GBP", "fee_reserve.LOCAL.GBP"]));
    expect(floorCents(db, "GBP")).toBe(0);
    const p = proposePolicyChange(db, { changes: [{ key: "floor.GBP", to: "500.00" }, { key: "fee_reserve.SWIFT.TRY", to: "800.00" }], reason: "keep GBP for payroll" }, "human", now);
    approve(p.proposal_id);
    executePolicyChange(db, p.proposal_id, now);
    expect(floorCents(db, "GBP")).toBe(50_000);
    expect(feeReserveFor(db, "SWIFT", "TRY")).toBe(80_000);
    expect(fundingCurrency(db)).toBe("EUR");
    expect(validateChange(db, { key: "floor.GBP", from: "500.00", to: "lots" })).toMatch(/bad format/);
    expect(validateChange(db, { key: "fee_reserve.SWIFT.TRY", from: "800.00", to: "20000.00" })).toMatch(/at most 10000.00/);
    expect(validateChange(db, { key: "payout.funding_currency", from: "EUR", to: "XYZ" })).toMatch(/must be one of/);
    expect(validateChange(db, { key: "payout.funding_currency", from: "EUR", to: "USD" })).toBeNull();
    expect(validateChange(db, { key: "floor.JPY", from: "", to: "1.00" })).toMatch(/unknown policy setting/);
    expect(loosens({ key: "floor.GBP", from: "500.00", to: "100.00" })).toBe(true);
    expect(loosens({ key: "floor.GBP", from: "500.00", to: "900.00" })).toBe(false);
    expect(loosens({ key: "fee_reserve.SWIFT.TRY", from: "800.00", to: "100.00" })).toBe(true);
    expect(loosens({ key: "payout.funding_currency", from: "EUR", to: "USD" })).toBe(true);
  });

  it("the escalation names the policy key the CFO can change with Face ID", async () => {
    const id = await add(UK, "uk.pdf");
    await addSupplier(id);
    setSetting(db, "human", "eur_obligations", "9500.00");
    const out = await payApInvoice(db, awx, id, now);
    expect((out as { reason: string }).reason).toMatch(/lower its floor \(policy eur_floor\) with Face ID/);
  });
});

describe("MEDIUM-LOW: a route's per-payout limit is checked at plan time", () => {
  it("the guides' limits: Faster Payments 1,000,000 GBP, local TRY 250,000 (at least 1), ACH 15,000,000 USD; SEPA and SWIFT none", () => {
    expect(routeLimitReason({ country: "GB", currency: "GBP", method: "LOCAL", clearing: "FASTER_PAYMENTS" }, 1_000_000_00)).toBeNull();
    expect(routeLimitReason({ country: "GB", currency: "GBP", method: "LOCAL", clearing: "FASTER_PAYMENTS" }, 1_000_000_01)).toMatch(/GBP 1,000,000\.00 .*united-kingdom\.md/);
    expect(routeLimitReason({ country: "TR", currency: "TRY", method: "LOCAL", clearing: null }, 250_000_01)).toMatch(/TRY 250,000\.00 .*turkey\.md/);
    expect(routeLimitReason({ country: "TR", currency: "TRY", method: "LOCAL", clearing: null }, 50)).toMatch(/below the least .* TRY 1\.00/);
    expect(routeLimitReason({ country: "US", currency: "USD", method: "LOCAL", clearing: "ACH" }, 15_000_000_01)).toMatch(/USD 15,000,000\.00/);
    expect(routeLimitReason({ country: "NL", currency: "EUR", method: "LOCAL", clearing: null }, 900_000_000_00)).toBeNull();
    expect(routeLimitReason({ country: "TR", currency: "TRY", method: "SWIFT", clearing: null }, 900_000_000_00)).toBeNull();
  });

  it("a TRY invoice above the local route's 250,000 is escalated before any rate, quote or conversion", async () => {
    const id = await add(TR.replace("TRY 52,000.00", "TRY 260,000.00"), "tr.pdf");
    await addSupplier(id);
    const out = await payApInvoice(db, awx, id, now);
    expect(out.kind).toBe("escalated");
    expect((out as { reason: string }).reason).toMatch(/above the most Airwallex's LOCAL in TR route carries in one payout, TRY 250,000\.00/);
    expect(awx.calls.filter((c) => c === "currentRateAny" || c === "createQuoteAny")).toHaveLength(0);
    expect(apInvoice(db, id)!.status).toBe("ready");
  });
});

describe("LOW: a new supplier is never created twice", () => {
  it("a lost answer to the beneficiary create: the re-run finds it by its account details and adopts it", async () => {
    const id = await add(UK, "uk.pdf");
    const pid = proposeAdd(id);
    awx.loseNextBeneficiaryAnswer = true;
    await expect(executePayeeAdd(db, awx, pid, { now: () => now, reader: parserOnly }, now)).rejects.toThrow();
    expect(awx.payoutBeneficiaries).toHaveLength(1);
    await executePayeeAdd(db, awx, pid, { now: () => now, reader: parserOnly }, now);
    expect(awx.payoutBeneficiaries).toHaveLength(1);
    expect(status(pid)).toBe("EXECUTED");
    const ben = db.prepare("SELECT beneficiary_id FROM beneficiaries WHERE name = 'Harbour Rope Ltd'").get() as { beneficiary_id: string };
    expect(ben.beneficiary_id).toBe(awx.payoutBeneficiaries[0]!.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'payee.adopted'").get()).toEqual({ n: 1 });
  });
});

describe("the phone page for a new supplier paid to an IBAN", () => {
  it("names the currency and the method the CFO approves", async () => {
    const { describeTerms } = await import("../src/approve/client.js");
    const id = await add(TR, "tr.pdf");
    const req = requestPayeeAddForInvoice(db, id, "treasury", now);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
    const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
    const d = describeTerms(JSON.parse(p.terms_json), {});
    expect(d.sentence).toMatch(/paid in TRY by LOCAL to IBAN TR33/);
    expect(d.rows).toContainEqual(["Paid in", "TRY by LOCAL"]);
    const nl = await add(NL, "nl.pdf");
    const req2 = requestPayeeAddForInvoice(db, nl, "treasury", now);
    recordPayeeAddVerification(db, req2.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
    const d2 = describeTerms(JSON.parse((await checkThenProposePayeeAdd(db, standInBank(), req2.add_id, "treasury", now)).terms_json), {});
    expect(d2.sentence).toMatch(/paid in EUR by LOCAL to IBAN NL91/);
  });
});
