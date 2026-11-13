import { mkdtempSync } from "node:fs";
import { standInBank } from "./standInBank.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedTreasury } from "../../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../../src/ap/pay.js";
import type { Asker } from "../../src/ap/read.js";
import { apInvoice } from "../../src/ap/store.js";
import { executePayeeAdd, checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../../src/ap/vendors.js";
import { openDb, type DB } from "../../src/db/open.js";
import { executeSupplierPayment } from "../../src/executors/supplierPayment.js";
import { executeInvoicePayment } from "../../src/executors/invoicePayment.js";
import { decide } from "../../src/policy/approvals.js";
import { setSetting } from "../../src/world/settings.js";
import { FakeAirwallex } from "../fakes/airwallex.js";
import { pdfOf } from "../fakes/pdf.js";

export const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
export const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
export const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";

export async function world(now = new Date()) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "rtm-"));
  const db: DB = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
  const approve = (id: string) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  };
  const add = async (text: string, name: string) => {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    return out.invoice.id;
  };
  const addSupplier = async (id: string) => {
    const req = requestPayeeAddForInvoice(db, id, "treasury", now);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
    const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
    approve(p.proposal_id);
    await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
    return apInvoice(db, id)!;
  };
  const pay = async (id: string) => {
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(out.proposal.proposal_id);
    if (out.proposal.kind === "supplier_payment") await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id);
    else await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    await syncPayments(db, { now: () => now });
    return out;
  };
  return { dir, db, awx, deps, approve, add, addSupplier, pay, inv: (id: string) => apInvoice(db, id)! };
}
