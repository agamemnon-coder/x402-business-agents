// Airwallex Spend Bills (AIRWALLEX_BILLS=on, off by default): each invoice Purser pays becomes a bill in Airwallex's own
// accounts payable, with its PDF attached and the signed terms hash as external_id, read back, and marked paid once its
// transfer is PAID. Breaks if a bill is made twice for one invoice (Airwallex keeps external_id unique for no one), if a
// lost answer is resent, if a bill whose read-back differs is marked paid, if a hash the CFO did not sign is sent as
// external_id, if a bills error fails the payment sync, or if anything is called with the flag off. No network: the
// in-memory stand-ins, and a stand-in fetch for the REST mapping.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { billDifferences, billExternalId, syncBills } from "../src/ap/billSync.js";
import { AirwallexBillsRest, attachmentName, billBody, billsFromEnv, billsOn, FakeBills, seededUuid, toBill, vendorExternalId, type AwxBill } from "../src/airwallex/bills.js";
import { Airwallex } from "../src/airwallex/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let bills: FakeBills;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "awx-bills-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  bills = new FakeBills();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** One invoice through the inbox, signed by the CFO and executed; settled (PAID) in the sandbox when `settle`. */
async function paidInvoice(settle = true): Promise<{ id: string; proposalId: string; sha: string; transferId: string }> {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const id = out.invoice.id;
  const filed = await payApInvoice(db, awx, id, now);
  if (filed.kind !== "proposed") throw new Error(filed.reason);
  const proposalId = filed.proposal.proposal_id;
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  decide(db, { proposalId, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "cfo", method: "cli" }, now);
  const r = await executeInvoicePayment(db, awx, settle ? awx : null, proposalId);
  return { id, proposalId, sha, transferId: r.transfer.id };
}
const events = (event: string, subject: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, subject) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

describe("Airwallex Spend Bills: the switch", () => {
  it("is off by default, and only AIRWALLEX_BILLS=on switches it on", async () => {
    expect(billsOn({})).toBe(false);
    expect(billsOn({ AIRWALLEX_BILLS: "true" })).toBe(false);
    expect(billsOn({ AIRWALLEX_BILLS: "on" })).toBe(true);
    expect(await billsFromEnv({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "key" })).toBeNull();
    expect(await billsFromEnv({ AIRWALLEX_BILLS: "on" })).toBeNull();
    expect(await billsFromEnv({ AIRWALLEX_BILLS: "on", AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "key" })).toBeInstanceOf(AirwallexBillsRest);
  });

  it("with the switch off, a payment sync makes no bill and no Spend call", async () => {
    const { id } = await paidInvoice();
    const was = process.env.AIRWALLEX_BILLS;
    delete process.env.AIRWALLEX_BILLS;
    try { await syncPayments(db, { ...deps, rail: awx }); } finally { if (was !== undefined) process.env.AIRWALLEX_BILLS = was; }
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(events("awx_bill.created", id)).toHaveLength(0);
    // And null turns it off for one sync even with a rail at hand.
    await syncPayments(db, { ...deps, rail: awx, bills: null });
    expect(bills.calls).toEqual([]);
  });
});

describe("Airwallex Spend Bills: a paid invoice becomes a bill", () => {
  it("creates the bill with the signed hash as external_id and the PDF attached, reads it back, and marks it paid once PAID", async () => {
    const { id, sha, transferId, proposalId } = await paidInvoice();
    const inv = apInvoice(db, id)!;
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(apInvoice(db, id)!.status).toBe("paid");
    const [created] = events("awx_bill.created", id);
    expect(created).toMatchObject({ how: "created", external_id: sha, external_id_is: "approval_sha256", invoice_no: inv.invoice_no, read_back: "agrees", transfer_id: transferId, proposal_id: proposalId });
    const bill = bills.bills.get(String(created!.bill_id))!;
    expect(bill.externalId).toBe(sha);
    expect(bill.amount).toBe(inv.total);
    expect(bill.currency).toBe(inv.currency);
    expect(bill.dueDate).toBe(inv.due_date);
    expect(bill.description).toContain(transferId);
    // The invoice's own PDF, uploaded once as a SPEND_ATTACHMENT and attached.
    expect(bill.attachmentIds).toHaveLength(1);
    expect(events("awx_bill.attachment", id)).toEqual([expect.objectContaining({ file_id: bill.attachmentIds[0], doc_sha256: inv.doc_sha256, purpose: "SPEND_ATTACHMENT" })]);
    // Marked paid: an EXTERNAL payment (Airwallex links no transfer), read back as PAID with the same external_id.
    const [paid] = events("awx_bill.paid", id);
    expect(paid).toMatchObject({ bill_id: bill.id, external_id: sha, status: "PAID", read_back: "agrees", transfer_id: transferId });
    expect(bill.status).toBe("PAID");
    expect(bill.payments.map((p) => p.type)).toEqual(["EXTERNAL"]);
    // One vendor for the supplier.
    expect(bills.vendors.size).toBe(1);
    expect([...bills.vendors.values()][0]!.externalId).toBe(vendorExternalId(inv.vendor));
  });

  it("makes nothing twice: a second sync calls Airwallex Spend not at all", async () => {
    await paidInvoice();
    await syncPayments(db, { ...deps, rail: awx, bills });
    const n = bills.calls.length;
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(bills.calls.length).toBe(n);
    expect(bills.bills.size).toBe(1);
  });

  it("creates the bill when the payout is sent, and marks it paid only after the transfer is PAID", async () => {
    const { id, transferId } = await paidInvoice(false);
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
    const [created] = events("awx_bill.created", id);
    expect(created).toMatchObject({ status: "AWAITING_PAYMENT", read_back: "agrees" });
    expect(events("awx_bill.paid", id)).toHaveLength(0);
    expect(bills.calls).not.toContain("markPaid");

    await awx.transitionTransfer(transferId, "PAID");
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(events("awx_bill.paid", id)).toEqual([expect.objectContaining({ status: "PAID", read_back: "agrees" })]);
  });

  it("makes no bill for an invoice still waiting for the CFO", async () => {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    await payApInvoice(db, awx, out.invoice.id, now);
    expect(await syncBills(db, bills, { now: () => now })).toEqual([]);
    expect(bills.calls).toEqual([]);
  });

  it("a lost create answer is never resent: the next sync finds the bill by its external_id and adopts it", async () => {
    const { id, sha } = await paidInvoice();
    bills.loseNextCreateAnswer = true;
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(events("awx_bill.ambiguous", id)).toHaveLength(1);
    expect(events("awx_bill.created", id)).toHaveLength(0);
    expect(bills.bills.size).toBe(1);

    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(bills.calls.filter((c) => c === "createBill")).toHaveLength(1);
    expect(bills.bills.size).toBe(1);
    expect(events("awx_bill.created", id)).toEqual([expect.objectContaining({ how: "adopted", external_id: sha, read_back: "agrees" })]);
    expect(events("awx_bill.paid", id)).toHaveLength(1);
    // The PDF was uploaded once, before the lost create; not again.
    expect(bills.calls.filter((c) => c === "uploadAttachment")).toHaveLength(1);
  });

  it("refuses when Airwallex already holds two bills with the invoice's external_id: a person picks one", async () => {
    const { id, sha } = await paidInvoice();
    const v = await bills.createVendor({ requestId: "r-v", externalId: "x", name: "x" });
    for (const r of ["r-1", "r-2"]) await bills.createBill({ requestId: r, externalId: sha, invoiceNumber: "x", currency: "EUR", total: "1.00", issuedDate: "2026-11-19", dueDate: "2026-11-19", legalEntityId: "le", vendorId: v.id, lineDescription: "x", description: "x", attachmentIds: [] });
    const out = await syncBills(db, bills, { now: () => now });
    expect(out).toEqual([expect.objectContaining({ invoice: id, step: "refused" })]);
    expect(events("awx_bill.refused", id)).toHaveLength(1);
    expect(bills.calls).not.toContain("markPaid");
  });

  it("a bill whose read-back differs is recorded as differing and never marked paid", async () => {
    const { id } = await paidInvoice();
    bills.tamper = (b) => { b.amount = "1.00"; };
    await syncPayments(db, { ...deps, rail: awx, bills });
    const [created] = events("awx_bill.created", id);
    expect(created).toMatchObject({ read_back: "differs" });
    expect(String((created!.differences as string[])[0])).toMatch(/billing_amount 1.00/);
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(bills.calls).not.toContain("markPaid");
  });

  it("a Spend error is recorded and never fails the payment sync; the next sync tries again", async () => {
    const { id } = await paidInvoice();
    const broken = new FakeBills();
    broken.legalEntityId = async () => { throw Object.assign(new Error("Airwallex /account -> 403 unauthorized"), { status: 403, code: "unauthorized" }); };
    const changed = await syncPayments(db, { ...deps, rail: awx, bills: broken });
    expect(changed.map((c) => c.id)).toContain(id);
    expect(events("awx_bill.failed", id)).toEqual([expect.objectContaining({ http_status: 403, code: "unauthorized" })]);
    await syncPayments(db, { ...deps, rail: awx, bills });
    expect(events("awx_bill.paid", id)).toHaveLength(1);
  });
});

describe("Airwallex Spend Bills: the external_id", () => {
  const sha = "a".repeat(64);
  it("is the hash a person signed, which the transfer carries", () => {
    expect(billExternalId({ id: "AP-0001" }, { approved_sha256: sha, method: "passkey", approval_sha256: sha, terms_sha256: sha })).toEqual({ externalId: sha, kind: "approval_sha256" });
  });
  it("is the invoice id when no person signed (code approved it within the limit), or nothing was approved", () => {
    expect(billExternalId({ id: "AP-0001" }, { approved_sha256: sha, method: "policy", approval_sha256: sha, terms_sha256: sha })).toEqual({ externalId: "AP-0001", kind: "invoice_id" });
    expect(billExternalId({ id: "AP-0001" }, { approved_sha256: null, method: null, approval_sha256: sha, terms_sha256: sha })).toEqual({ externalId: "AP-0001", kind: "invoice_id" });
  });
  it("is refused when the transfer carries another hash than the one signed", () => {
    expect(billExternalId({ id: "AP-0001" }, { approved_sha256: sha, method: "passkey", approval_sha256: "b".repeat(64), terms_sha256: sha })).toMatch(/not the hash the CFO signed/);
  });
  it("a read-back is compared field by field", () => {
    const b = toBill({ id: "b1", external_id: sha, invoice_number: "INV-1", billing_currency: "EUR", billing_amount: "240.0", status: "AWAITING_PAYMENT", vendor_id: "v1", attachments: [{ id: "f1" }] });
    expect(billDifferences(b, { externalId: sha, invoiceNo: "INV-1", currency: "EUR", total: "240.00", vendorId: "v1", attachmentIds: ["f1"] })).toEqual([]);
    expect(billDifferences(b, { externalId: "x", invoiceNo: "INV-2", currency: "USD", total: "240.01", vendorId: "v2", attachmentIds: ["f2"], status: "PAID" })).toHaveLength(7);
  });
});

describe("Airwallex Spend Bills: the REST mapping (a stand-in fetch)", () => {
  type Reply = { status: number; body: unknown };
  function client(replies: Reply[]) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
      const u = String(url);
      calls.push({ url: u, method: init.method ?? "GET", body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t" }), { status: 201 });
      const r = replies.shift();
      if (!r) throw new Error("no more replies");
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
    return { rest: new AirwallexBillsRest(new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: impl, minGapMs: 0, sleep: async () => {} })), calls };
  }
  const raw = (id: string, ext: string): Record<string, unknown> => ({ id, external_id: ext, invoice_number: "INV-1", billing_currency: "EUR", billing_amount: "240.00", status: "AWAITING_PAYMENT", attachments: [], bill_payments: [] });

  it("reads the legal entity from the account once", async () => {
    const { rest, calls } = client([{ status: 200, body: { id: "acct_x", account_details: { legal_entity_id: "le_abc" } } }]);
    expect(await rest.legalEntityId()).toBe("le_abc");
    expect(await rest.legalEntityId()).toBe("le_abc");
    expect(calls.filter((c) => c.url.endsWith("/api/v1/account"))).toHaveLength(1);
  });

  it("matches external_id itself over every page (Airwallex ignores the filter)", async () => {
    const { rest, calls } = client([
      { status: 200, body: { items: [raw("b1", "x"), raw("b2", "want")], page_after: "p2" } },
      { status: 200, body: { items: [raw("b3", "want"), raw("b4", "y")], page_after: null } },
    ]);
    expect((await rest.findBills("want")).map((b) => b.id)).toEqual(["b2", "b3"]);
    expect(calls[2]!.url).toContain("page=p2");
  });

  it("sends one line, tax included, with the invoice's fields, and marks paid with no body", async () => {
    const { rest, calls } = client([{ status: 201, body: raw("b1", "e") }, { status: 200, body: { ...raw("b1", "e"), status: "PAID", bill_payments: [{ id: "p1", type: "EXTERNAL", amount: "240.00", currency: "EUR", transfer: null }] } }]);
    const b = { requestId: seededUuid("s"), externalId: "e", invoiceNumber: "INV-1", currency: "EUR", total: "240.00", issuedDate: "2026-11-19", dueDate: "2026-12-03", legalEntityId: "le", vendorId: "v", lineDescription: "l", description: "d", attachmentIds: ["f1"] };
    await rest.createBill(b);
    expect(calls[1]).toMatchObject({ method: "POST", url: "https://api.sandbox.airwallex.com/api/v1/spend/bills/create", body: billBody(b) });
    expect(billBody(b)).toMatchObject({ line_items: [{ quantity: "1", unit_price: "240.00", description: "l" }], tax_status: "TAX_INCLUSIVE", sync_status: "NOT_SYNCED", attachments: ["f1"] });
    const paid: AwxBill = await rest.markPaid("b1");
    expect(calls[2]).toMatchObject({ method: "POST", url: "https://api.sandbox.airwallex.com/api/v1/spend/bills/b1/mark_as_paid", body: undefined });
    expect(paid.payments).toEqual([{ id: "p1", type: "EXTERNAL", amount: "240.00", currency: "EUR", transferId: null }]);
  });

  it("uploads the PDF to the sandbox Files host as a SPEND_ATTACHMENT", async () => {
    const { rest, calls } = client([{ status: 201, body: { file_id: "f1", size: 3 } }]);
    expect(await rest.uploadAttachment({ bytes: new Uint8Array([1, 2, 3]), fileName: attachmentName("SLL-2026-11/R1 (copy)"), notes: "Purser AP-0001" })).toEqual({ fileId: "f1", size: 3 });
    expect(calls[1]!.url).toBe("https://files.sandbox.airwallex.com/api/v1/files/upload");
    const form = calls[1]!.body as FormData;
    expect(form.get("purpose")).toBe("SPEND_ATTACHMENT");
    expect((form.get("file") as File).name).toBe("SLL-2026-11-R1-copy.pdf");
    expect(attachmentName("x".repeat(80))).toHaveLength(50);
  });

  it("derives the same request_id from the same seed, shaped as a UUID", () => {
    expect(seededUuid("a")).toBe(seededUuid("a"));
    expect(seededUuid("a")).not.toBe(seededUuid("b"));
    expect(seededUuid("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
