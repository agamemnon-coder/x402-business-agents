// The Exact Online connector (src/erp/exact.ts) against answers shaped as Exact's REST API reference shows them
// (OData v2: {"d":{...}} for one record, {"d":{"results":[...],"__next":...}} for a list). No live calls.
import { describe, expect, it } from "vitest";
import { staticToken } from "../src/erp/auth.js";
import { ErpError, RecordingTransport, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import { ExactConnector, type ExactConfig } from "../src/erp/exact.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

const BASE = "https://start.exactonline.nl/api/v1/123456";
const ok = (d: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify({ d }) });
const GL = [
  { ID: "aaaaaaaa-0000-0000-0000-000000006200", Code: "6200", Description: "Inkoop" },
  { ID: "aaaaaaaa-0000-0000-0000-000000006900", Code: "6900", Description: "Overige" },
  { ID: "aaaaaaaa-0000-0000-0000-000000001600", Code: "1600", Description: "Crediteuren" },
  { ID: "aaaaaaaa-0000-0000-0000-000000006800", Code: "6800", Description: "Bankkosten" },
  { ID: "aaaaaaaa-0000-0000-0000-000000001200", Code: "1200", Description: "Bank" },
];
const config: ExactConfig = {
  baseUrl: "https://start.exactonline.nl", division: 123456, purchaseJournal: "60", bankJournals: { "1200": "20" }, generalJournal: "90",
  vatCodes: { NL21: "2", NL9: "1", NL0: "0", EU_RC: "6", NONEU_RC: "7", EXEMPT: "0", NONE: "0" }, glMap: {}, apAccount: "1600", documentType: 20, paymentSign: -1,
};
const refs = { vendor: () => "11111111-2222-3333-4444-555555555555", invoice: () => "99999999-8888-7777-6666-555555555555" };

function exact(route: (req: HttpRequest) => HttpResponse) {
  const tr = new RecordingTransport((req) => {
    if (req.method === "GET" && req.url.startsWith(`${BASE}/financial/GLAccounts`)) return ok({ results: GL });
    return route(req);
  });
  return { tr, c: new ExactConnector(config, tr, staticToken("tok")) };
}
const body = (r: HttpRequest) => JSON.parse(r.body as string) as Record<string, unknown>;

describe("Exact Online connector", () => {
  it("creates a supplier account, then its bank account", async () => {
    const { tr, c } = exact((req) => req.url.endsWith("/crm/Accounts") ? ok({ ID: "11111111-2222-3333-4444-555555555555" }, 201) : ok({ ID: "bank-1" }, 201));
    expect(await c.pushVendor(sampleVendor())).toBe("11111111-2222-3333-4444-555555555555");
    expect(tr.sent[0]).toMatchObject({ method: "POST", url: `${BASE}/crm/Accounts` });
    expect(tr.sent[0]!.headers.authorization).toBe("Bearer tok");
    expect(body(tr.sent[0]!)).toEqual({ Name: "Bergtex Textil GmbH", IsSupplier: true, VATNumber: "DE123456789", PurchaseCurrency: "EUR", Country: "DE", Email: "billing@example.com" });
    expect(tr.sent[1]!.url).toBe(`${BASE}/crm/BankAccounts`);
    expect(body(tr.sent[1]!)).toEqual({ Account: "11111111-2222-3333-4444-555555555555", BankAccount: "DE89370400440532013000", BICCode: "COBADEFFXXX", Main: true, BankAccountHolderName: "Bergtex Textil GmbH" });
  });

  it("books a purchase entry with net amounts, the mapped VAT codes and the exact VAT, and attaches the PDF", async () => {
    const { tr, c } = exact((req) => {
      if (req.url.endsWith("/documents/Documents")) return ok({ ID: "doc-guid" }, 201);
      if (req.url.endsWith("/documents/DocumentAttachments")) return ok({ ID: "att-guid" }, 201);
      if (req.url.endsWith("/purchaseentry/PurchaseEntries")) return ok({ EntryID: "entry-guid" }, 201);
      throw new Error(`unexpected ${req.url}`);
    });
    expect(await c.pushPurchaseInvoice(sampleInvoice(), refs)).toBe("entry-guid");
    const posts = tr.sent.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.url.slice(BASE.length))).toEqual(["/documents/Documents", "/documents/DocumentAttachments", "/purchaseentry/PurchaseEntries"]);
    expect(body(posts[0]!)).toMatchObject({ Type: 20, Account: "11111111-2222-3333-4444-555555555555" });
    expect(body(posts[1]!)).toEqual({ Document: "doc-guid", FileName: "BT-2026-0042.pdf", Attachment: "JVBERg==" });
    const entry = body(posts[2]!);
    expect(entry).toMatchObject({ Journal: "60", Supplier: "11111111-2222-3333-4444-555555555555", Currency: "EUR", Type: 30, YourRef: "BT-2026-0042", Document: "doc-guid", EntryDate: "2026-11-02T00:00:00", DueDate: "2026-12-02T00:00:00" });
    expect(entry.PurchaseEntryLines).toEqual([
      { GLAccount: "aaaaaaaa-0000-0000-0000-000000006200", AmountFC: 1000, VATCode: "2", VATAmountFC: 210, Description: "Rain jackets, 40 pieces", CostCenter: "CC100" },
      { GLAccount: "aaaaaaaa-0000-0000-0000-000000006900", AmountFC: 200, VATCode: "1", VATAmountFC: 18, Description: "Printed catalogues" },
    ]);
  });

  it("cancels a sent invoice with a purchase credit note (type 31) for the same amounts, negative", async () => {
    const { tr, c } = exact(() => ok({ EntryID: "credit-guid" }, 201));
    await c.pushCreditNote({ ...sampleInvoice(), pdf: undefined }, "entry-guid", refs);
    const e = body(tr.sent.find((r) => r.method === "POST")!);
    expect(e).toMatchObject({ Type: 31, YourRef: "BT-2026-0042" });
    expect((e.PurchaseEntryLines as { AmountFC: number; VATAmountFC: number }[]).map((l) => [l.AmountFC, l.VATAmountFC])).toEqual([[-1000, -210], [-200, -18]]);
  });

  it("records a payment as a bank entry line against the supplier on the bank journal for that account", async () => {
    const { tr, c } = exact(() => ok({ EntryID: "bank-entry" }, 201));
    expect(await c.pushPayment(samplePayment(), refs)).toBe("bank-entry");
    const e = body(tr.sent.find((r) => r.method === "POST")!);
    expect(tr.sent.find((r) => r.method === "POST")!.url).toBe(`${BASE}/financialtransaction/BankEntries`);
    expect(e).toEqual({ JournalCode: "20", Currency: "EUR", BankEntryLines: [{
      AmountFC: -1428, Date: "2026-11-20T00:00:00", GLAccount: "aaaaaaaa-0000-0000-0000-000000001600", Account: "11111111-2222-3333-4444-555555555555",
      Description: "Purser payment PAY-1", Notes: "Airwallex transfer 03360bfa-afce-457b-89d1-e1097fbe3985",
    }] });
  });

  it("posts a journal entry with debits positive and credits negative, marked with its Purser id", async () => {
    const { tr, c } = exact(() => ok({ EntryID: "gj-entry" }, 201));
    await c.pushJournalEntry(sampleJournal());
    const e = body(tr.sent.find((r) => r.method === "POST")!);
    expect(e).toMatchObject({ JournalCode: "90", Currency: "EUR" });
    expect((e.GeneralJournalEntryLines as { AmountFC: number; Description: string }[]).map((l) => [l.AmountFC, l.Description])).toEqual([
      [13.42, "Bank and transfer fees [Purser JE-1]"], [-13.42, "Airwallex EUR [Purser JE-1]"],
    ]);
  });

  it("finds an invoice it may already have created by supplier and invoice number", async () => {
    const { tr, c } = exact(() => ok({ results: [{ EntryID: "found-guid" }] }));
    expect(await c.findExisting("invoice", sampleInvoice(), refs)).toBe("found-guid");
    const url = decodeURIComponent(tr.sent.at(-1)!.url);
    expect(url).toContain("/purchaseentry/PurchaseEntries?$filter=Supplier eq guid'11111111-2222-3333-4444-555555555555' and YourRef eq 'BT-2026-0042'");
    const { c: c2 } = exact(() => ok({ results: [] }));
    expect(await c2.findExisting("invoice", sampleInvoice(), refs)).toBeNull();
  });

  it("escapes quotes in a filter", async () => {
    const { tr, c } = exact(() => ok({ results: [] }));
    await c.findExisting("vendor", { ...sampleVendor(), name: "O'Neill Outdoor" }, refs);
    expect(decodeURIComponent(tr.sent.at(-1)!.url)).toContain("Name eq 'O''Neill Outdoor'");
  });

  it("reads the chart of accounts across pages", async () => {
    let page = 0;
    const tr = new RecordingTransport(() => {
      page++;
      return page === 1 ? ok({ results: GL.slice(0, 2), __next: `${BASE}/financial/GLAccounts?$skiptoken=guid'x'` }) : ok({ results: GL.slice(2) });
    });
    const c = new ExactConnector(config, tr, staticToken());
    expect((await c.pullChartOfAccounts()).map((a) => a.code)).toEqual(["6200", "6900", "1600", "6800", "1200"]);
    expect(tr.sent[1]!.url).toBe(`${BASE}/financial/GLAccounts?$skiptoken=guid'x'`);
  });

  it("reads payment status from cashflow Payments: all processed or matched is paid", async () => {
    const at = (statuses: number[]) => exact(() => ok({ results: statuses.map((Status) => ({ Status })) })).c;
    expect(await at([50]).pullPaymentStatus(sampleInvoice(), "x", refs)).toBe("paid");
    expect(await at([40, 20]).pullPaymentStatus(sampleInvoice(), "x", refs)).toBe("partial");
    expect(await at([20]).pullPaymentStatus(sampleInvoice(), "x", refs)).toBe("unpaid");
    expect(await at([]).pullPaymentStatus(sampleInvoice(), "x", refs)).toBe("unknown");
  });

  it("maps Exact's errors: 429 with Retry-After is retryable, 400 carries Exact's message", async () => {
    const { c } = exact(() => ({ status: 429, headers: { "retry-after": "3" }, body: "" }));
    const e = await c.pushVendor(sampleVendor()).catch((x: unknown) => x as ErpError);
    expect(e).toMatchObject({ kind: "rate_limited", retryable: true, retryAfterMs: 3000 });
    const { c: c2 } = exact(() => ({ status: 400, headers: {}, body: JSON.stringify({ error: { code: "", message: { lang: "", value: "Journal 60 does not exist" } } }) }));
    await expect(c2.pushPurchaseInvoice({ ...sampleInvoice(), pdf: undefined }, refs)).rejects.toThrow(/Journal 60 does not exist/);
  });

  it("refuses a GL account or VAT code it has no mapping for, before sending anything", async () => {
    const { tr, c } = exact(() => ok({ EntryID: "x" }, 201));
    const inv = sampleInvoice();
    inv.lines[0]!.glAccount = "4999";
    await expect(c.pushPurchaseInvoice({ ...inv, pdf: undefined }, refs)).rejects.toThrow(/4999/);
    expect(tr.sent.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
