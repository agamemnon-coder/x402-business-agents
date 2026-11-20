// The reserve floors at execution for supplier payments (docs/controls.md, "Guards in code", the "USD reserve floor, at
// execution" row): src/executors/supplierPayment.ts checks the payout currency's floor before it converts, counting what
// the conversion brings in, and holds what the payout speaks for in the same step; a conversion run again after a lost
// answer, with nothing at Airwallex under its request_id, checks the sell currency's floor again on fresh balances. Each
// test fails if its check is taken out. A UK invoice in GBP, bought from EUR, on the Airwallex stand-in; test money only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { AirwallexAmbiguous } from "../src/airwallex/client.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { executePayeeAdd, checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { toCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { holdPayout } from "../src/policy/payoutLock.js";
import { chaos } from "../src/policy/saga.js";
import type { PlatformFields, SupplierPaymentTerms } from "../src/payouts/plan.js";
import { getSetting, setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { UK } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { standInBank } from "./support/standInBank.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";
/** A second invoice from the same supplier, for less. */
const UK_SECOND = UK.replace(/HR-0042/g, "HR-0043").replace("Subtotal GBP 800.00\nVAT 20% GBP 160.00\nTotal due GBP 960.00", "Subtotal GBP 500.00\nVAT 20% GBP 100.00\nTotal due GBP 600.00");

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "sp-floors-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  awx.bal.GBP = { availableCents: 0, pendingCents: 0, reservedCents: 0 };
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => { chaos.at = null; rmSync(dir, { recursive: true, force: true }); });

const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
async function ingest(text: string, filename: string): Promise<string> {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
}
async function proposeAndApprove(invoiceId: string): Promise<{ id: string; terms: SupplierPaymentTerms }> {
  const p = await payApInvoice(db, awx, invoiceId, now);
  if (p.kind !== "proposed") throw new Error(p.reason);
  approve(p.proposal.proposal_id);
  return { id: p.proposal.proposal_id, terms: JSON.parse(p.proposal.terms_json) as SupplierPaymentTerms };
}
/** The UK supplier added in three steps, then its invoice's payment proposed and approved: GBP bought from EUR. */
async function approvedUk(text = UK): Promise<{ id: string; terms: SupplierPaymentTerms }> {
  const invoiceId = await ingest(text, "uk.pdf");
  const req = requestPayeeAddForInvoice(db, invoiceId, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const add = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  approve(add.proposal_id);
  await executePayeeAdd(db, awx, add.proposal_id, { now: () => now, reader: parserOnly }, now);
  const p = await proposeAndApprove(invoiceId);
  if (!p.terms.conversion) throw new Error("the UK invoice is expected to need a conversion from EUR");
  return p;
}

const payoutCents = (t: SupplierPaymentTerms) => toCents(t.amount) + toCents(t.fee_reserve) + toCents((t as PlatformFields).platform_fee?.amount ?? "0.00");
const held = (db: DB, key: string) => db.prepare("SELECT currency, cents FROM payout_reservations WHERE key = ? AND status = 'HELD'").get(key) as { currency: string; cents: number } | undefined;
const statusOf = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const eurFloor = () => toCents(getSetting(db, "eur_floor", ""));

/** Stops the first execution to reach a saga checkpoint there until `go()`; `at` resolves when it got there. */
function pauseAt(point: string) {
  let go!: () => void;
  let reached!: () => void;
  const at = new Promise<void>((r) => { reached = r; });
  const release = new Promise<void>((r) => { go = r; });
  let first = true;
  chaos.at = (p) => (p === point && first ? (first = false, reached(), release) : undefined);
  return { at, go };
}

describe("the payout currency's floor before the conversion (supplierPayment.ts, the check on the payout currency)", () => {
  it("GBP already held by another payment under way: refused before anything is converted, nothing stays held", async () => {
    const { id, terms } = await approvedUk();
    // Exactly what the conversion buys covers the payout; another supplier payment, executing now, holds GBP 1.00 of it.
    expect(toCents(terms.conversion!.buy_amount) - payoutCents(terms)).toBeLessThan(100);
    holdPayout(db, "P-OTHER", "other-gbp-payout", "GBP", 100);
    await expect(executeSupplierPayment(db, awx, awx, id)).rejects.toThrow(/^GBP would now drop under its floor, commitments and payouts under way; a new proposal is needed$/);
    // Without this check the conversion would be made and only the payout refused: EUR sold for GBP nobody can pay out.
    expect(awx.calls).not.toContain("createConversionAny");
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
    expect(statusOf(id)).toBe("APPROVED");
    expect(held(db, terms.conversion!.request_id)).toBeUndefined();
    expect(held(db, terms.transfer_request_id)).toBeUndefined();
  });

  it("with nothing else spoken for, the same payment converts once and pays", async () => {
    const { id } = await approvedUk();
    const r = await executeSupplierPayment(db, awx, awx, id);
    expect(r.conversionId).not.toBeNull();
    expect(awx.conversions).toHaveLength(1);
    expect(awx.transfers).toHaveLength(1);
  });
});

describe("the payout's hold, taken with the check (supplierPayment.ts, the hold on the payout currency)", () => {
  it("GBP already in the account that one payment counts on is held for it; a second payment counting on it is refused", async () => {
    // GBP 500.00 already there: each invoice buys only its shortfall and counts on those 500 pounds.
    awx.bal.GBP!.availableCents = 50_000;
    awx.bal.EUR.availableCents += 10_000_000;
    const a = await approvedUk();
    const b = await proposeAndApprove(await ingest(UK_SECOND, "uk-second.pdf"));
    if (!b.terms.conversion) throw new Error("the second UK invoice is expected to need a conversion too");
    const fromBalanceA = payoutCents(a.terms) - toCents(a.terms.conversion!.buy_amount);
    expect(fromBalanceA).toBeGreaterThan(0);

    // A has judged the floors and holds what it speaks for, but has not reached Airwallex yet.
    const pause = pauseAt("conversion:before");
    const runA = executeSupplierPayment(db, awx, awx, a.id);
    await pause.at;
    expect(held(db, a.terms.transfer_request_id)).toEqual({ currency: "GBP", cents: fromBalanceA });
    await expect(executeSupplierPayment(db, awx, awx, b.id)).rejects.toThrow(/^GBP would now drop under its floor, commitments and payouts under way/);
    expect(awx.conversions).toHaveLength(0);
    pause.go();
    await runA;
    expect(awx.conversions).toHaveLength(1);
    expect(awx.transfers).toHaveLength(1);
    expect(awx.bal.GBP!.availableCents).toBeGreaterThanOrEqual(0);
  });
});

describe("a conversion run again after a lost answer (supplierPayment.ts, the fresh check on a retry)", () => {
  /** The create is lost on its way once: Airwallex never got it; the conversion step stays STARTED, its EUR held. */
  async function lostOnce() {
    const p = await approvedUk();
    const create = awx.createConversionAny.bind(awx);
    let drops = 1;
    awx.createConversionAny = async (a) => { if (drops > 0) { drops--; throw new AirwallexAmbiguous("/fx/conversions/create", new Error("socket hang up")); } return create(a); };
    await expect(executeSupplierPayment(db, awx, awx, p.id)).rejects.toThrow(AirwallexAmbiguous);
    expect(statusOf(p.id)).toBe("FAILED");
    expect(awx.conversions).toHaveLength(0);
    expect(db.prepare("SELECT status FROM money_steps WHERE action_id = ? AND step = 'conversion'").pluck().get(p.id)).toBe("STARTED");
    return p;
  }

  it("EUR spent before the re-run: nothing under its request_id at Airwallex, so the floor is checked again and nothing is converted", async () => {
    const { id, terms } = await lostOnce();
    // The EUR left the account meanwhile: selling the quote's EUR would now cross the floor by one cent.
    awx.bal.EUR.availableCents = eurFloor() + toCents(terms.conversion!.sell_amount) - 1;
    await expect(executeSupplierPayment(db, awx, awx, id)).rejects.toThrow(/^EUR would now drop under its floor; a new proposal is needed$/);
    expect(awx.calls.filter((c) => c === "createConversionAny")).toHaveLength(0);
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
  });

  it("with the EUR still there, the re-run converts once, under the same request_id, and pays", async () => {
    const { id, terms } = await lostOnce();
    awx.bal.EUR.availableCents = eurFloor() + toCents(terms.conversion!.sell_amount);
    const r = await executeSupplierPayment(db, awx, awx, id);
    expect(awx.conversions.map((c) => c.requestId)).toEqual([terms.conversion!.request_id]);
    expect(r.transfer.requestId).toBe(terms.transfer_request_id);
    expect(awx.transfers).toHaveLength(1);
    expect(held(db, terms.conversion!.request_id)).toBeUndefined();
  });
});
