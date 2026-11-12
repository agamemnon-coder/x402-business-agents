// The integration of FX payouts with the ERP feed and the vault: a supplier paid in its own currency (USD by ACH, with
// no BIC; TRY to a Turkish IBAN, bought from EUR) reaches the ERP as a valid vendor and a payment on the right
// Airwallex bank account, and the vault files a receipt that names the supplier's route, the currency and the FX.
// All against the in-memory Airwallex stand-in: no outside call, test money.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { validate } from "../src/erp/model.js";
import { ledgerItems } from "../src/erp/source.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { decide } from "../src/policy/approvals.js";
import { receiptData, receipts } from "../src/vault/data.js";
import { receiptPdf } from "../src/vault/pdf.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { TR, US } from "./fakes/fxInvoices.js";
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
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "platform-fx-"));
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
/** Read the invoice, add its supplier in three steps, and pay it with the CFO's approval; returns the inbox id. */
const paid = async (text: string, name: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const id = out.invoice.id;
  const req = requestPayeeAddForInvoice(db, id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const p = proposePayeeAdd(db, req.add_id, "treasury", now);
  approve(p.proposal_id);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  const pay = await payApInvoice(db, awx, id, now);
  if (pay.kind !== "proposed") throw new Error(pay.reason);
  approve(pay.proposal.proposal_id);
  await executeSupplierPayment(db, awx, awx, pay.proposal.proposal_id);
  await syncPayments(db, { now: () => now });
  expect(apInvoice(db, id)!.status).toBe("paid");
  return id;
};

describe("multi-currency supplier payments in the ERP feed and the vault", () => {
  it("the ERP feed sends each supplier and payment valid, on the bank account of its currency", async () => {
    await paid(US, "us.pdf");
    await paid(TR, "tr.pdf");
    const items = ledgerItems(db);
    for (const i of items) expect({ id: i.object.id, errs: validate(i.kind, i.object) }).toEqual({ id: i.object.id, errs: [] });
    const payments = items.filter((i) => i.kind === "payment").map((i) => i.object as { currency: string; bankAccount: string });
    expect(payments).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: "USD", bankAccount: "1201" }),
      expect.objectContaining({ currency: "TRY", bankAccount: "1203" }),
    ]));
    // A US supplier on ACH has no BIC: the vendor goes without one rather than with an empty, invalid one.
    const vendors = items.filter((i) => i.kind === "vendor").map((i) => i.object as { currency: string; bic?: string });
    expect(vendors.find((v) => v.currency === "USD")?.bic).toBeUndefined();
  });

  it("the vault files a receipt for a supplier payment: its route, its currency, the FX it was bought with", async () => {
    const id = await paid(TR, "tr.pdf");
    expect(receipts(db).map((r) => r.id)).toEqual([id]);
    const r = receiptData(db, id)!;
    const terms = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(r.proposal_id) as { terms_json: string }).terms_json) as { kind: string; amount: string; account: string; transfer_request_id: string; conversion: { client_rate: string; buy_amount: string; sell_amount: string } };
    expect(terms.kind).toBe("supplier_payment");
    const t = db.prepare("SELECT transfer_id FROM transfers WHERE request_id = ?").get(terms.transfer_request_id) as { transfer_id: string };
    expect(r).toMatchObject({ currency: "TRY", amount: terms.amount, method: "LOCAL", transfer_id: t.transfer_id, approval: { approver: "cfo" } });
    expect(r.account).toContain(terms.account);
    expect(r.account).not.toMatch(/undefined/);
    expect(r.fx).toEqual({ rate: terms.conversion.client_rate, bought: `TRY ${terms.conversion.buy_amount}`, sold: `EUR ${terms.conversion.sell_amount}` });
    const pdf = await receiptPdf("Northwind Outdoor B.V.", r, "en");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
