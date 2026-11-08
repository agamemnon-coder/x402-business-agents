// The final seam review and red team round 3 on the integrated platform, each finding as the scenario that broke it.
// All against the in-memory Airwallex stand-in: no outside call, test money.
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { readDocument } from "../src/ap/read.js";
import { parseApFallback, readingCheck, totalAmbiguity, totalLine } from "../src/ap/reading.js";
import { staticToken } from "../src/erp/auth.js";
import { BusinessCentralConnector, type BcConfig } from "../src/erp/businessCentral.js";
import { RecordingTransport } from "../src/erp/connector.js";
import { validateVendor, type Payment, type PurchaseInvoice, type Vendor } from "../src/erp/model.js";
import { ledgerItems } from "../src/erp/source.js";
import { dataSha, monthData, receiptData } from "../src/vault/data.js";
import { safeSegment } from "../src/vault/layout.js";
import { insights } from "../src/ap/insights.js";
import { apInvoice } from "../src/ap/store.js";
import { accountWords } from "../src/policy/fraudCore.js";
import { describeTerms, reviewLabel } from "../src/approve/client.js";
import { parseReview } from "../src/dashboard/snapshot.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAdd, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { journal } from "../src/accounting/gl.js";
import { batchesFor } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { proposalCheck, proposalRun, type ProposalLike } from "../src/hub/runs.js";
import { lockMonth } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { ledgerApp } from "../src/ledger/serve.js";
import { cashByCurrency } from "../src/ledger/reports.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { releaseStuckHold, stuckHolds } from "../src/finance/stuckHolds.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { fromCents } from "../src/lib/money.js";
import { decide } from "../src/policy/approvals.js";
import { fourEyes, FOUR_EYES_KEY } from "../src/policy/fourEyes.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { setSetting } from "../src/world/settings.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
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

describe("R4: the same supplier under a second name", () => {
  it("a new supplier paid to an account already on file under another name is refused", () => {
    expect(() => requestPayeeAdd(db, { vendor: "BTX Holding AG", iban: "DE89370400440532013000", bic: "COBADEFFXXX", source: null }, "treasury", now))
      .toThrow(/already on file for Bergtex Textil GmbH/);
  });

  it("the ledger's guard knows a paid invoice by its account and number, whatever the name", async () => {
    const bare = await kit11("BTX-2026-21");
    approve(bare);
    await executeInvoicePayment(db, awx, awx, bare);
    const bergtexAccount = (db.prepare("SELECT iban_sha256 FROM invoices WHERE invoice_no = 'BTX-2026-21'").get() as { iban_sha256: string }).iban_sha256;
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · BTX Holding AG", now, undefined, { accountSha256: bergtexAccount })).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-2026-21 · BTX Holding AG", now, undefined, { accountSha256: "another" })).toBeNull();
  });
});

describe("R5: payments executed at once keep the EUR floor, whichever executor runs them", () => {
  /** EUR free above the floor and commitments set to `cents`, after the proposals were filed. */
  const freeEur = (cents: number) => setSetting(db, "human", "eur_obligations", fromCents(awx.bal.EUR.availableCents - 25_000_00 - cents));
  const held = () => db.prepare("SELECT COUNT(*) AS n FROM payout_reservations WHERE status = 'HELD'").get();

  it("a Kit 11 invoice payment and a supplier payment at once: one is paid, the other refused", async () => {
    const lagerhaus = await add(DE, "de.pdf");
    await addSupplier(lagerhaus);
    const supplier = await approvedInbox(lagerhaus);
    const legacy = await approvedInbox(await add(EN, "bergtex.pdf"));
    // EUR 2,500.00 free: EUR 1,870.00 (Bergtex with its fee ceiling) or EUR 1,190.00 (Lagerhaus) fits, not both.
    freeEur(2500_00);
    const out = await Promise.allSettled([executeInvoicePayment(db, awx, awx, legacy), executeSupplierPayment(db, awx, awx, supplier)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(String((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/EUR would now drop under its floor/);
    expect(awx.transfers).toHaveLength(1);
    expect(held()).toEqual({ n: 0 });
  });

  it("two Kit 11 invoice payments at once: one is paid, the other refused", async () => {
    const a = await kit11("BTX-2026-21");
    const b = await kit11("BTX-2026-22");
    approve(a);
    approve(b);
    freeEur(2500_00);
    const out = await Promise.allSettled([executeInvoicePayment(db, awx, awx, a), executeInvoicePayment(db, awx, awx, b)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(String((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/EUR would now drop under its floor/);
    expect(awx.transfers).toHaveLength(1);
    expect(held()).toEqual({ n: 0 });
  });
});

describe("R6: two amounts on one total line, and a tail the CFO does not see", () => {
  const usd = US.replace("Total due USD 2,400.00", "Amount due USD 2,400.00 on total USD 24,000.00");
  it("a total line with more than one amount is ambiguous: a person decides, code never picks", async () => {
    expect(totalAmbiguity(usd)).toMatch(/more than one amount/);
    const id = await add(usd, "two.pdf");
    expect(apInvoice(db, id)!.findings.map((f) => f.code)).toContain("ambiguous_total");
    expect(apInvoice(db, id)!.status).not.toBe("ready");
  });

  it("the line shown to the CFO ends at the chosen amount (its currency kept), leader dots folded", () => {
    const dotted = EN.replace("Total due EUR 1,850.00", `Total due ${".".repeat(150)} EUR 1,850.00 ${" ".repeat(40)}see page 2 for our terms and the late fee`);
    expect(totalLine(dotted)).toBe("Total due … EUR 1,850.00");
    expect(totalLine(DE)).toBe("Gesamtbetrag 1.190,00 EUR");
  });

  it("the approval card warns when the paid amount is not literally in the shown line", () => {
    const base = { kind: "supplier_payment", currency: "USD", amount: "24000.00", fee_reserve: "25.00", vendor: "Pinecrest Outdoor Supply LLC", beneficiary_name: "Pinecrest Outdoor Supply LLC", document_currency: "USD", conversion: null };
    expect(describeTerms({ ...base, document_total_line: "Amount due USD 2,400.00" }, {}).warnings.join(" ")).toMatch(/USD 24,000.00 is not written in the invoice's own total line/);
    expect(describeTerms({ ...base, document_total_line: "Amount due USD 24,000.00" }, {}).warnings.join(" ")).not.toMatch(/not written/);
    expect(describeTerms({ ...base, kind: "invoice_payment", currency: "EUR", document_currency: "EUR", amount: "1850.00", document_total_line: "Total due EUR 1.850,00" }, {}).warnings.join(" ")).not.toMatch(/not written/);
  });
});

describe("R7: a typographic apostrophe between the digits of a total", () => {
  it("3’400.00 and 3ʼ400.00 read as 3400.00; digits split by another mark are refused, never read as 400.00", () => {
    for (const sep of ["’", "ʼ"]) {
      const text = EN.replace("Total due EUR 1,850.00", `Total due CHF 3${sep}400.00`);
      expect(parseApFallback(text).total).toBe("3400.00");
      expect(totalAmbiguity(text)).toBeNull();
    }
    const odd = EN.replace("Total due EUR 1,850.00", "Total due CHF 3‘400.00");
    expect(parseApFallback(odd).total).not.toBe("400.00");
    expect(totalAmbiguity(odd)).toMatch(/split/);
  });
});

describe("R9: one supplier's payments on one day are held to the route's limit together", () => {
  it("TRY 249,999.99 and then TRY 2.00 to the same supplier on the same day: the second is escalated", async () => {
    const big = await add(TR.replace("TRY 52,000.00", "TRY 249,999.99"), "tr1.pdf");
    await addSupplier(big);
    expect((await payApInvoice(db, awx, big, now)).kind).toBe("proposed");
    const small = await add(TR.replace("TRY 52,000.00", "TRY 2.00").replaceAll("BT-5531", "BT-5532"), "tr2.pdf");
    expect(apInvoice(db, small)!.status).toBe("ready");
    const out = await payApInvoice(db, awx, small, now);
    expect(out.kind).toBe("escalated");
    expect((out as { reason: string }).reason).toMatch(/already paid or on its way to Bursa Tekstil AS today.*TRY 250,000\.00/);
  });
});

describe("B1: payouts and conversions post to the bank account of their currency", () => {
  it("USD, TRY and GBP payouts, and the FX legs, land on 1201, 1203 and 1202 in the journal and the stored ledger", async () => {
    for (const [text, name] of [[US, "us.pdf"], [TR, "tr.pdf"], [UK, "uk.pdf"]] as const) {
      const id = await add(text, name);
      await addSupplier(id);
      await executeSupplierPayment(db, awx, awx, await approvedInbox(id));
    }
    const lines = journal(db);
    const banks = (cur: string) => [...new Set(lines.filter((l) => l.currency === cur && l.bank_account !== "1210").map((l) => l.bank_account))];
    expect(banks("USD")).toEqual(["1201"]);
    expect(banks("TRY")).toEqual(["1203"]);
    expect(banks("GBP")).toEqual(["1202"]);
    syncLedger(db, now);
    // Each bank account in the stored ledger holds only its own currency; cashByCurrency agrees.
    const posted = db.prepare("SELECT DISTINCT account, currency FROM ledger_lines WHERE account IN ('1200', '1201', '1202', '1203') ORDER BY account, currency").all();
    expect(posted).toEqual(expect.arrayContaining([{ account: "1200", currency: "EUR" }, { account: "1201", currency: "USD" }, { account: "1202", currency: "GBP" }, { account: "1203", currency: "TRY" }]));
    expect(posted.filter((r) => (r as { account: string }).account === "1200")).toEqual([{ account: "1200", currency: "EUR" }]);
    expect(cashByCurrency(db).filter((c) => c.account === "1200").map((c) => c.currency)).toEqual(["EUR"]);
  });
});

describe("B2: the vault keeps to the ledger's closed periods", () => {
  it("a closed month's report is the state at its end: a later payment changes nothing in it, so no correction", async () => {
    const october = new Date("2026-10-20T10:00:00Z");
    const out = await ingestDocument(db, { ...deps, now: () => october }, { bytes: await pdfOf(DE), filename: "de.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    const id = out.invoice.id;
    lockMonth(db, "2026-10", "the CFO", now);
    const before = monthData(db, "2026-10");
    expect(before.open.map((o) => o.status)).toEqual(["needs_vendor"]);
    await addSupplier(id);
    await executeSupplierPayment(db, awx, awx, await approvedInbox(id));
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(dataSha(monthData(db, "2026-10"))).toBe(dataSha(before));
  });

  it("a payment is dated by the ledger: as posted, or in the first open month when its own month closed first", async () => {
    const id = await add(DE, "de.pdf");
    await addSupplier(id);
    await executeSupplierPayment(db, awx, awx, await approvedInbox(id));
    await syncPayments(db, { now: () => now });
    const paidDay = now.toISOString().slice(0, 10);
    expect(receiptData(db, id)!.paid_at.slice(0, 10)).toBe(paidDay);
    // Its month closed before the ledger posted it: the ledger posts it in the next open month, and so does the vault.
    lockMonth(db, paidDay.slice(0, 7), "the CFO", now);
    const next = receiptData(db, id)!.paid_at.slice(0, 10);
    expect(next > paidDay && next.endsWith("-01")).toBe(true);
    expect(monthData(db, paidDay.slice(0, 7)).paid).toEqual([]);
  });

  it("once the ledger posted a payment, a later close leaves its date alone", async () => {
    const id = await add(DE, "de.pdf");
    await addSupplier(id);
    await executeSupplierPayment(db, awx, awx, await approvedInbox(id));
    await syncPayments(db, { now: () => now });
    syncLedger(db, now);
    const paidDay = now.toISOString().slice(0, 10);
    lockMonth(db, paidDay.slice(0, 7), "the CFO", now);
    expect(receiptData(db, id)!.paid_at.slice(0, 10)).toBe(paidDay);
    expect(monthData(db, paidDay.slice(0, 7)).paid.map((p) => p.paid_on)).toEqual([paidDay]);
  });
});

describe("B3: the ERP gets the supplier's own invoice, not the ledger's key", () => {
  it("number, issue date, VAT and GL account from the inbox; a rejected invoice is not sent", async () => {
    const bergtex = await add(EN, "bergtex.pdf");
    await executeInvoicePayment(db, awx, awx, await approvedInbox(bergtex));
    const zeeland = await add(NL, "zeeland.pdf");
    await addSupplier(zeeland);
    const pz = await filed(zeeland);
    const invoices = () => ledgerItems(db).filter((i) => i.kind === "invoice").map((i) => i.object as PurchaseInvoice);
    const b = invoices().find((i) => i.id === "BTX-2026-21 · Bergtex Textil GmbH")!;
    expect(b).toMatchObject({ number: "BTX-2026-21", issueDate: "2026-11-02", dueDate: "2026-11-16" });
    expect(b.lines[0]).toMatchObject({ glAccount: apInvoice(db, bergtex)!.gl_account, netCents: 185000, vatCents: 0, vatCode: "NONE" });
    const z = invoices().find((i) => i.number === "ZV-4471")!;
    expect(z.lines[0]).toMatchObject({ netCents: 40000, vatCents: 8400, vatCode: "NL21" });
    // The payment still names the invoice by the id the ERP knows it under.
    expect(ledgerItems(db).filter((i) => i.kind === "payment").map((i) => (i.object as Payment).invoiceId)).toEqual([b.id]);
    // The CFO rejects Zeeland's payment: its invoice is rejected and is not sent.
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(pz) as { terms_sha256: string };
    decide(db, { proposalId: pz, decision: "REJECTED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli", reason: "not ours" } as never, now);
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, zeeland)!.status).toBe("rejected");
    expect(invoices().map((i) => i.number)).not.toContain("ZV-4471");
  });

  it("Business Central refuses a vendor invoice number longer than its field (Code[35]) before any request", async () => {
    const tr = new RecordingTransport(() => ({ status: 201, headers: {}, body: "{}" }));
    const c = new BusinessCentralConnector({ tenant: "t", environment: "e", companyId: "c", localCurrency: "EUR", generalJournalId: "g", paymentJournalId: "p", vatCodes: {}, glMap: {}, postInvoices: false } as unknown as BcConfig, tr, staticToken("bc"));
    const inv = { id: "x", vendorId: "v", number: "N".repeat(36), issueDate: "2026-11-02", dueDate: "2026-11-16", currency: "EUR", lines: [], totals: { netCents: 0, vatCents: 0, grossCents: 0 }, documentSha256: "0".repeat(64) } as unknown as PurchaseInvoice;
    await expect(c.pushPurchaseInvoice(inv, { vendor: () => "v", invoice: () => null } as never)).rejects.toThrow(/35/);
    expect(tr.sent).toHaveLength(0);
  });
});

describe("L1: the hub's runs know supplier payments", () => {
  it("amount and currency, and the duplicate rule across both kinds and both number forms", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await filed(id);
    const row = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(pid) as ProposalLike;
    expect(proposalRun(db, "w-test", row)).toMatchObject({ what: "Supplier payment", amount: "2400.00", currency: "USD", check: "pass", rule: "invoice_payout_needs_person" });
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('X', 'Pinecrest Outdoor Supply LLC', '1.00', 'USD', '2026-11-16', 'h', 'b', 'd', 'PAID')").run();
    const terms = JSON.parse(row.terms_json) as { invoice_no: string };
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('r-other', 'X', '1.00', 'USD', 'LOCAL', '0.00', 'PAID', 'x', ?)").run(now.toISOString());
    expect(proposalCheck(db, row).rule).not.toBe("duplicate_invoice");
    // The same invoice paid under its bare number (Kit 11's form) for the same supplier: a duplicate.
    db.prepare("INSERT OR IGNORE INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES (?, 'Pinecrest Outdoor Supply LLC', '1.00', 'USD', '2026-11-16', 'h', 'b', 'd', 'PAID')").run(terms.invoice_no.split(" · ")[0]);
    db.prepare("UPDATE transfers SET invoice_no = ? WHERE request_id = 'r-other'").run(terms.invoice_no.split(" · ")[0]);
    expect(proposalCheck(db, row)).toEqual({ check: "fail", rule: "duplicate_invoice" });
  });
});

describe("L2: the cloud push carries no full account number", () => {
  it("the inbox invoices' readings go masked: last four and the account's hash", async () => {
    await add(EN, "bergtex.pdf");
    await add(US, "us.pdf");
    const body = JSON.stringify(batchesFor(db, { documents: [], ledger: { entry_id: 0 }, audit: { seq: 0 } } as never));
    expect(body).not.toContain("DE89370400440532013000");
    expect(body).not.toMatch(/"account_number":"\d{5,}"/);
    expect(body).toContain("…3000");
  });
});

describe("L3: the books page answers only requests addressed to this machine", () => {
  it("Host evil.example is refused; 127.0.0.1 gets the page with strict headers", async () => {
    const server = ledgerApp(db).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as AddressInfo).port;
    const get = (host: string) => new Promise<{ status: number; csp: string }>((resolve, reject) => {
      request({ host: "127.0.0.1", port, path: "/", headers: { host } }, (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0, csp: String(res.headers["content-security-policy"] ?? "") })); }).on("error", reject).end();
    });
    try {
      expect((await get("evil.example")).status).toBe(403);
      expect((await get(`evil.example:${port}`)).status).toBe(403);
      const ok = await get(`127.0.0.1:${port}`);
      expect(ok.status).toBe(200);
      expect(ok.csp).toContain("default-src");
    } finally {
      server.close();
    }
  });
});

describe("L4: a hold left behind by a dead execution is resolved, never guessed", () => {
  it("lists it; refuses while Airwallex holds a transfer or cannot be asked; releases it when nothing is there", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const pid = await filed(id);
    const key = (JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(pid) as { terms_json: string }).terms_json) as { transfer_request_id: string }).transfer_request_id;
    const old = new Date(now.getTime() - 2 * 3600_000).toISOString();
    db.prepare("INSERT INTO payout_reservations (key, proposal_id, currency, cents, status, updated_at) VALUES (?, ?, 'USD', 242500, 'HELD', ?)").run(key, pid, old);
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(pid);
    expect(stuckHolds(db, now)).toEqual([]);
    db.prepare("UPDATE proposals SET status = 'FAILED' WHERE proposal_id = ?").run(pid);
    expect(stuckHolds(db, now)).toMatchObject([{ key, proposal_id: pid, kind: "payout", currency: "USD", cents: 242500 }]);
    const none = { transfer: async () => undefined, conversion: async () => undefined };
    expect(await releaseStuckHold(db, key, { ...none, transfer: async () => ({ id: "t-1", status: "SENT" }) }, now)).toMatchObject({ released: false, reason: expect.stringMatching(/holds transfer t-1/) });
    expect(await releaseStuckHold(db, key, { ...none, transfer: async () => { throw new Error("timeout"); } }, now)).toMatchObject({ released: false, reason: expect.stringMatching(/look-up .* failed/) });
    expect(await releaseStuckHold(db, key, none, now)).toMatchObject({ released: true, key });
    expect(db.prepare("SELECT status FROM payout_reservations WHERE key = ?").get(key)).toEqual({ status: "RELEASED" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'payout.hold_released' AND subject = ?").get(key)).toEqual({ n: 1 });
  });
});

describe("S1, S2: fraud reasons without empty parts; credit notes read and kept out of what is open", () => {
  it("an account with no BIC on file reads cleanly", () => {
    expect(accountWords("3000", "", "")).toBe("IBAN ...3000");
    expect(accountWords("3000", "DE", "COBADEFFXXX")).toBe("IBAN ...3000 (DE) and BIC COBADEFFXXX");
    expect(accountWords("", "", "")).toBe("an account with no IBAN");
  });

  const GUTSCHRIFT = `Lagerhaus Nord GmbH
Gutschrift
Gutschriftnummer: GS-2026-0007
Datum: 05.11.2026
Gesamtbetrag -119,00 EUR
IBAN: DE75 5121 0800 1245 1261 99`;
  it("Gutschriftnummer, Gutschrift-Nr., Credit note no. and Creditnota nr. are the document's number", () => {
    expect(parseApFallback(GUTSCHRIFT).invoice_no).toBe("GS-2026-0007");
    expect(parseApFallback(GUTSCHRIFT.replace("Gutschriftnummer:", "Gutschrift-Nr.")).invoice_no).toBe("GS-2026-0007");
    expect(parseApFallback(GUTSCHRIFT.replace("Gutschriftnummer:", "Credit note no.")).invoice_no).toBe("GS-2026-0007");
    expect(parseApFallback(GUTSCHRIFT.replace("Gutschriftnummer:", "Creditnota nr.")).invoice_no).toBe("GS-2026-0007");
  });

  it("a credit note is not counted as open in the insight panel nor as received in the month report", async () => {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(GUTSCHRIFT.replace("-119,00", "119,00")), filename: "gs.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    expect(apInvoice(db, out.invoice.id)!.doc_kind).toBe("credit_note");
    expect(insights(db, now).open).toEqual([]);
    expect(monthData(db, now.toISOString().slice(0, 7)).received).toEqual([]);
  });
});

describe("S3: notes say who wrote them and go once they no longer hold", () => {
  it("a code-written note is labelled as Purser's code; the waiting note is gone once paid", async () => {
    const id = await add(EN, "bergtex.pdf");
    const pid = await approvedInbox(id);
    const explanation = (db.prepare("SELECT explanation FROM proposals WHERE proposal_id = ?").get(pid) as { explanation: string }).explanation;
    const review = parseReview(explanation)!;
    expect(review.model).toBeNull();
    expect(reviewLabel(review)).toBe("Purser's code (no model), advisory");
    expect(reviewLabel({ model: "claude-opus-x", recommendation: "approve" })).toBe("Opus review, advisory: approve");
    expect(apInvoice(db, id)!.review_note).toMatch(/Waits for the CFO/);
    await executeInvoicePayment(db, awx, awx, pid);
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)).toMatchObject({ status: "paid", review_note: null });
  });
});

describe("R8: the supplier's name a model gives is checked and cleaned", () => {
  const claude = (vendor: string): Asker => ({ ask: async () => ({ value: { ...parseApFallback(EN), vendor }, source: "claude", model: "test-model", note: "" }) }) as unknown as Asker;
  it("control and bidi characters are stripped, and the name is capped at 120 characters", async () => {
    const { reading } = await readDocument(db, claude("‮Bergtex Textil GmbH​"), EN, "a".repeat(64));
    expect(reading.vendor).toBe("Bergtex Textil GmbH");
    const long = parseApFallback(`‮RLO Supplier\u0007 Ltd ${"x".repeat(200)}\n${EN}`).vendor;
    expect(long).toMatch(/^RLO Supplier Ltd x+$/);
    expect(long.length).toBeLessThanOrEqual(120);
  });

  it("a name that is not written in the document is not taken from the model", async () => {
    expect(readingCheck({ ...parseApFallback(EN), vendor: "Trusted Payee Ltd" }, EN)).toMatch(/supplier's name/);
    const { reading, readBy } = await readDocument(db, claude("Trusted Payee Ltd"), EN, "b".repeat(64));
    expect(readBy).toBe("parser");
    expect(reading.vendor).toBe("Bergtex Textil GmbH");
  });

  it("vault folder names and the ERP's validation refuse control and bidi characters", () => {
    expect(safeSegment("Berg‮tex​ GmbH\u0007")).toBe("Bergtex GmbH");
    expect(validateVendor({ id: "v1", name: "Bergtex‮ GmbH", currency: "EUR" } as Vendor).join(" ")).toMatch(/control or direction/);
  });
});
