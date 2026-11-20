// A supplier payment the CFO approved, stopped at execution before any Airwallex call that moves money
// (src/executors/supplierPayment.ts holdReason and the quote checks): the payee blocked by the CFO policy, the emergency
// stop, the treasury agent stopped by its velocity limit or paused by the CFO, the approved account no longer the one on
// file or in another currency, the invoice paid meanwhile by another proposal, and a quote that expired, is unknown or
// was used by another conversion. Each says why; nothing is converted or paid. All against the in-memory stand-in.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { executePayeeAdd, checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { decide } from "../src/policy/approvals.js";
import type { SupplierPaymentTerms } from "../src/payouts/plan.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { US, UK } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { standInBank } from "./support/standInBank.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "sp-holds-"));
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
/** An invoice from a new supplier, the supplier added in three steps, the payment proposed and approved. */
async function approvedPayment(text: string): Promise<{ id: string; terms: SupplierPaymentTerms }> {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: "inv.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const req = requestPayeeAddForInvoice(db, out.invoice.id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const add = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  approve(add.proposal_id);
  await executePayeeAdd(db, awx, add.proposal_id, { now: () => now, reader: parserOnly }, now);
  const p = await payApInvoice(db, awx, out.invoice.id, now);
  if (p.kind !== "proposed") throw new Error(p.reason);
  approve(p.proposal.proposal_id);
  return { id: p.proposal.proposal_id, terms: JSON.parse(p.proposal.terms_json) as SupplierPaymentTerms };
}
const moved = () => ({ transfers: awx.transfers.length, conversions: awx.conversions.length });

describe("an approved supplier payment stopped before money moves", () => {
  const cases: [string, (t: SupplierPaymentTerms) => void, RegExp][] = [
    ["the payee blocked by the CFO policy", (t) => setSetting(db, "human", `counterparty:${t.beneficiary_name}`, "blocked"), /is blocked by the CFO policy; nothing is paid$/],
    ["the emergency stop", () => setSetting(db, "human", "freeze", "on"), /^the CFO pulled the emergency stop; nothing is paid until it is lifted$/],
    ["the treasury agent stopped by its velocity limit", () => setSetting(db, "system", "stop.treasury", "on"), /^the treasury agent was stopped automatically \(velocity limit\)/],
    ["the treasury agent paused by the CFO", () => setSetting(db, "human", "pause.treasury", "on"), /^the treasury agent is paused by the CFO/],
    ["the approved account no longer on file", (t) => db.prepare("UPDATE beneficiaries SET status = 'REPLACED' WHERE beneficiary_id = ?").run(t.beneficiary_id), /is no longer the one on file; nothing is paid \(a new proposal pays it\)$/],
    ["the approved account in another currency", (t) => db.prepare("UPDATE beneficiaries SET currency = 'EUR' WHERE beneficiary_id = ?").run(t.beneficiary_id), /^the approved account receives EUR, not USD; nothing is paid$/],
  ];
  for (const [what, change, why] of cases) {
    it(what, async () => {
      const { id, terms } = await approvedPayment(US);
      change(terms);
      const before = moved();
      await expect(executeSupplierPayment(db, awx, awx, id)).rejects.toThrow(why);
      expect(moved()).toEqual(before);
    });
  }

  it("an invoice another proposal already has a payout for", async () => {
    const { id, terms } = await approvedPayment(US);
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('other-request', ?, ?, ?, 'LOCAL', '0.00', 'PAID', 'x', ?)")
      .run(terms.invoice_no, terms.amount, terms.currency, now.toISOString());
    await expect(executeSupplierPayment(db, awx, awx, id)).rejects.toThrow(`invoice ${terms.invoice_no} is already paid by another proposal; nothing is converted or paid`);
    expect(awx.transfers).toHaveLength(0);
  });
});

describe("the quote a conversion was approved on", () => {
  async function withConversion() {
    awx.bal.GBP = { availableCents: 0, pendingCents: 0, reservedCents: 0 };
    const p = await approvedPayment(UK);
    if (!p.terms.conversion) throw new Error("the UK invoice is expected to need a conversion from EUR");
    return p;
  }

  it("past the quote's end the approval is void (the proposal runs out 30 seconds before its quote); nothing is converted", async () => {
    const { id, terms } = await withConversion();
    const late = () => new Date(Date.parse(terms.conversion!.valid_to));
    await expect(executeSupplierPayment(db, awx, awx, id, late)).rejects.toThrow(/expired at .*; approval void$/);
    expect(awx.conversions).toHaveLength(0);
  });

  it("a quote another conversion used is never converted on", async () => {
    const a = await withConversion();
    db.prepare("UPDATE fx_quotes SET used_by_conversion = 'another-request' WHERE quote_id = ?").run(a.terms.conversion!.quote_id);
    await expect(executeSupplierPayment(db, awx, awx, a.id)).rejects.toThrow(`quote ${a.terms.conversion!.quote_id} was already used`);
    expect(awx.conversions).toHaveLength(0);
  });

  it("a quote the ledger does not know is never converted on", async () => {
    const a = await withConversion();
    db.prepare("DELETE FROM fx_quotes WHERE quote_id = ?").run(a.terms.conversion!.quote_id);
    await expect(executeSupplierPayment(db, awx, awx, a.id)).rejects.toThrow(`unknown quote ${a.terms.conversion!.quote_id}`);
    expect(awx.conversions).toHaveLength(0);
  });
});
