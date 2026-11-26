// A payables world for supplier payments against the in-memory Airwallex stand-in (src/redteam/airwallex.ts): an
// invoice read from a PDF, its supplier added through the three steps, its payment proposed and approved. Test money only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedTreasury } from "../../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../../src/ap/inbox.js";
import { payApInvoice } from "../../src/ap/pay.js";
import type { Asker } from "../../src/ap/read.js";
import { checkThenProposePayeeAdd, executePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../../src/ap/vendors.js";
import { openDb, type DB } from "../../src/db/open.js";
import { decide } from "../../src/policy/approvals.js";
import type { SupplierPaymentTerms } from "../../src/payouts/plan.js";
import { setSetting } from "../../src/world/settings.js";
import { FakeAirwallex } from "../../src/redteam/airwallex.js";
import { pdfOf } from "../fakes/pdf.js";
import { standInBank } from "./standInBank.js";

export const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";

export interface SupplierWorld {
  db: DB;
  awx: FakeAirwallex;
  now: Date;
  deps: InboxDeps;
  approve(id: string): void;
  /** The invoice read, its supplier added and approved, its payment proposed and approved: the proposal and its terms. */
  approvedPayment(text: string, name: string): Promise<{ invoiceId: string; proposalId: string; terms: SupplierPaymentTerms }>;
  done(): void;
}

export async function supplierWorld(now = new Date()): Promise<SupplierWorld> {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "supplier-world-"));
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
  const approve = (id: string) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  };
  return {
    db, awx, now, deps, approve,
    async approvedPayment(text, name) {
      const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
      if (out.kind !== "invoice") throw new Error(out.kind);
      const invoiceId = out.invoice.id;
      const req = requestPayeeAddForInvoice(db, invoiceId, "treasury", now);
      recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
      const add = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
      approve(add.proposal_id);
      await executePayeeAdd(db, awx, add.proposal_id, { now: () => now, reader: parserOnly }, now);
      const filed = await payApInvoice(db, awx, invoiceId, now);
      if (filed.kind !== "proposed") throw new Error(filed.reason);
      approve(filed.proposal.proposal_id);
      return { invoiceId, proposalId: filed.proposal.proposal_id, terms: JSON.parse(filed.proposal.terms_json) as SupplierPaymentTerms };
    },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}
