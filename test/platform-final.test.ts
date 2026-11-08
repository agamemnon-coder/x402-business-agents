// The final seam review and red team round 3 on the integrated platform, each finding as the scenario that broke it.
// All against the in-memory Airwallex stand-in: no outside call, test money.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAdd, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { fromCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { fourEyes, FOUR_EYES_KEY } from "../src/policy/fourEyes.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { setSetting } from "../src/world/settings.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { TR, UK, US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";
const BERGTEX = { vendor: "Bergtex Textil GmbH", amount: "1850.00", currency: "EUR", due_date: "2026-11-16", iban: "DE89370400440532013000", bic: "COBADEFFXXX", reference: "BTX-2026-21" };

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "final-"));
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
const add = async (text: string, name = "invoice.pdf") => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const addSupplier = async (id: string) => {
  const req = requestPayeeAddForInvoice(db, id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const p = proposePayeeAdd(db, req.add_id, "treasury", now);
  approve(p.proposal_id);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  return apInvoice(db, id)!;
};
const filed = async (id: string) => {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  return out.proposal.proposal_id;
};
const approvedInbox = async (id: string) => { const p = await filed(id); approve(p); return p; };
const kit11 = async (invoiceNo: string) => {
  const out = await proposeInvoicePayment(db, awx, { ...BERGTEX, invoice_no: invoiceNo }, EN, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  return out.proposal.proposal_id;
};

describe("R1: the same invoice paid through the inbox and Kit 11's bare number", () => {
  it("inbox first: Kit 11's bare number for the same supplier is refused, also at the executor", async () => {
    const id = await add(EN, "bergtex.pdf");
    const inbox = await approvedInbox(id);
    await executeInvoicePayment(db, awx, awx, inbox);
    expect(awx.transfers).toHaveLength(1);
    const out = await proposeInvoicePayment(db, awx, { ...BERGTEX, invoice_no: "BTX-2026-21" }, EN, now);
    expect(out.kind).toBe("escalated");
    expect(out.kind === "escalated" && out.reason).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21", now, undefined, { vendor: "Bergtex Textil GmbH" })).toMatch(/already paid/);
  });

  it("Kit 11 first: the inbox's number for the same supplier is handled, another supplier's is not", async () => {
    const bare = await kit11("BTX-2026-21");
    approve(bare);
    await executeInvoicePayment(db, awx, awx, bare);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · Bergtex Textil GmbH", now)).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · Stockline Data GmbH", now)).toBeNull();
  });

  it("both approved: whichever executes second pays nothing", async () => {
    const bare = await kit11("BTX-2026-21");
    approve(bare);
    // The inbox proposal filed before the guard knew (the seam): a payout under the inbox's number is already PAID.
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('BTX-2026-21 · Bergtex Textil GmbH', 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-16', 'h', 'b', 'd', 'PAID')").run();
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('r-inbox', 'BTX-2026-21 · Bergtex Textil GmbH', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'x', ?)").run(now.toISOString());
    await expect(executeInvoicePayment(db, awx, awx, bare)).rejects.toThrow(/already paid/);
    expect(awx.transfers).toHaveLength(0);
  });
});

describe("R2: a supplier payment checks the treasury agent's identity", () => {
  it("a revoked treasury agent pays no supplier", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await approvedInbox(id);
    revokePrincipal(db, "treasury", "test", "the CFO", now);
    await expect(executeSupplierPayment(db, awx, awx, pid)).rejects.toThrow(/principal_revoked/);
    expect(awx.transfers).toHaveLength(0);
  });

  it("the treasury agent may pay every payable currency (TRY, GBP, USD), also with a principal from before", async () => {
    // A principal row written with the old defaults (USDZ, USD, EUR) is widened to the payable set.
    db.prepare("INSERT INTO principals (principal_id, kind, capabilities_json, status, created_at, updated_at) VALUES ('treasury', 'internal', ?, 'ACTIVE', ?, ?)")
      .run(JSON.stringify({ tools: ["sweep", "invoice_payment", "card_purchase"], rails: ["metal", "airwallex", "card"], currencies: ["USDZ", "USD", "EUR"], payees: ["sweep", "beneficiaries", "merchants"] }), now.toISOString(), now.toISOString());
    const id = await add(TR, "tr.pdf");
    await addSupplier(id);
    const pid = await approvedInbox(id);
    await executeSupplierPayment(db, awx, awx, pid);
    expect(awx.transfers).toHaveLength(1);
  });
});

describe("R3: four eyes covers supplier payments", () => {
  const p = (terms: object) => ({ kind: "supplier_payment", terms_json: JSON.stringify(terms) });
  it("EUR by its amount; EUR-funded by the quote's rate; otherwise over the threshold", () => {
    setSetting(db, "human", FOUR_EYES_KEY, "5000.00");
    expect(fourEyes(db, p({ amount: "4000.00", currency: "EUR", conversion: null }))).toBe(false);
    expect(fourEyes(db, p({ amount: "6000.00", currency: "EUR", conversion: null }))).toBe(true);
    // USD 10,000 with USD 2,000 bought for EUR 1,850: at that rate the whole payment is EUR 9,250.
    expect(fourEyes(db, p({ amount: "10000.00", currency: "USD", conversion: { sell_currency: "EUR", sell_amount: "1850.00", buy_amount: "2000.00" } }))).toBe(true);
    expect(fourEyes(db, p({ amount: "4000.00", currency: "USD", conversion: { sell_currency: "EUR", sell_amount: "3700.00", buy_amount: "4000.00" } }))).toBe(false);
    expect(fourEyes(db, p({ amount: "10.00", currency: "GBP", conversion: null }))).toBe(true);
  });
});
