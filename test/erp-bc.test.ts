// The Business Central connector (src/erp/businessCentral.ts) against answers shaped as Microsoft's API v2.0
// reference shows them (OData v4: a record as itself, a list as {"value":[...],"@odata.nextLink":...}). No live calls.
import { describe, expect, it } from "vitest";
import { staticToken } from "../src/erp/auth.js";
import { RecordingTransport, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import { BusinessCentralConnector, type BcConfig } from "../src/erp/businessCentral.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

const BASE = "https://api.businesscentral.dynamics.com/v2.0/contoso.onmicrosoft.com/production/api/v2.0/companies(c0c0c0c0-0000-0000-0000-000000000001)";
const config: BcConfig = {
  tenant: "contoso.onmicrosoft.com", environment: "production", companyId: "c0c0c0c0-0000-0000-0000-000000000001", localCurrency: "EUR",
  generalJournalId: "j0000000-0000-0000-0000-00000000000a", paymentJournalId: "j0000000-0000-0000-0000-00000000000b",
  vatCodes: { NL21: "VAT21", NL9: "VAT9", NL0: "VAT0", EU_RC: "EUREV", NONEU_RC: "IMPREV", EXEMPT: "NOVAT", NONE: "" }, glMap: { "6200": "60100" }, postInvoices: true,
};
const refs = { vendor: () => "v0000000-0000-0000-0000-000000000001", invoice: () => "i0000000-0000-0000-0000-000000000001" };
const json = (o: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify(o) });
const body = (r: HttpRequest) => JSON.parse(r.body as string) as Record<string, unknown>;
const path = (r: HttpRequest) => decodeURIComponent(r.url.slice(BASE.length));

function bc(route: (req: HttpRequest) => HttpResponse) {
  const tr = new RecordingTransport(route);
  return { tr, c: new BusinessCentralConnector(config, tr, staticToken("bc")) };
}

describe("Business Central connector", () => {
  it("creates a vendor; a vendor in the local currency carries a blank currency code", async () => {
    const { tr, c } = bc(() => json({ id: "v-new", number: "V0042" }, 201));
    expect(await c.pushVendor(sampleVendor())).toBe("v-new");
    expect(tr.sent[0]).toMatchObject({ method: "POST", url: `${BASE}/vendors` });
    expect(body(tr.sent[0]!)).toEqual({ displayName: "Bergtex Textil GmbH", taxRegistrationNumber: "DE123456789", currencyCode: "", email: "billing@example.com", country: "DE" });
  });

  it("creates a purchase invoice, its account lines, attaches the PDF, checks the total, then posts it", async () => {
    const { tr, c } = bc((req) => {
      const p = path(req);
      if (req.method === "POST" && p === "/purchaseInvoices") return json({ id: "pi-1", number: "108001", status: "Draft" }, 201);
      if (req.method === "POST" && p.startsWith("/purchaseInvoices(pi-1)/purchaseInvoiceLines")) return json({ id: "line" }, 201);
      if (req.method === "POST" && p === "/attachments") return json({ id: "att-1", "@odata.etag": 'W/"JzQ0OzE7MDsn"' }, 201);
      if (req.method === "PATCH") return json({ id: "att-1" });
      if (req.method === "GET" && p.startsWith("/purchaseInvoices(pi-1)?")) return json({ id: "pi-1", totalAmountIncludingTax: 1428, totalTaxAmount: 228 });
      if (req.method === "POST" && p === "/purchaseInvoices(pi-1)/Microsoft.NAV.post") return { status: 204, headers: {}, body: "" };
      throw new Error(`unexpected ${req.method} ${p}`);
    });
    expect(await c.pushPurchaseInvoice(sampleInvoice(), refs)).toBe("pi-1");
    expect(tr.sent.map((r) => `${r.method} ${path(r).split("?")[0]}`)).toEqual([
      "POST /purchaseInvoices", "POST /purchaseInvoices(pi-1)/purchaseInvoiceLines", "POST /purchaseInvoices(pi-1)/purchaseInvoiceLines",
      "POST /attachments", "PATCH /attachments(att-1)/attachmentContent", "GET /purchaseInvoices(pi-1)", "POST /purchaseInvoices(pi-1)/Microsoft.NAV.post",
    ]);
    expect(body(tr.sent[0]!)).toEqual({ vendorId: "v0000000-0000-0000-0000-000000000001", vendorInvoiceNumber: "BT-2026-0042", invoiceDate: "2026-11-02", postingDate: "2026-11-02", dueDate: "2026-12-02", currencyCode: "", pricesIncludeTax: false });
    expect(body(tr.sent[1]!)).toEqual({ lineType: "Account", lineObjectNumber: "60100", description: "Rain jackets, 40 pieces", unitCost: 1000, quantity: 1, taxCode: "VAT21" });
    expect(body(tr.sent[2]!)).toMatchObject({ lineObjectNumber: "6900", unitCost: 200, taxCode: "VAT9" });
    expect(body(tr.sent[3]!)).toEqual({ parentId: "pi-1", fileName: "BT-2026-0042.pdf", parentType: "Purchase Invoice" });
    expect(tr.sent[4]!.headers["if-match"]).toBe('W/"JzQ0OzE7MDsn"');
    expect(tr.sent[4]!.body).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it("leaves an invoice in Draft and says so when Business Central's own total differs from the invoice", async () => {
    const { tr, c } = bc((req) => {
      const p = path(req);
      if (req.method === "POST" && p === "/purchaseInvoices") return json({ id: "pi-2" }, 201);
      if (req.method === "GET") return json({ id: "pi-2", totalAmountIncludingTax: 1430, totalTaxAmount: 230 });
      return json({ id: "x" }, 201);
    });
    await expect(c.pushPurchaseInvoice({ ...sampleInvoice(), pdf: undefined }, refs)).rejects.toThrow(/1430.*1428|Draft/);
    expect(tr.sent.some((r) => path(r).endsWith("Microsoft.NAV.post"))).toBe(false);
  });

  it("cancels an invoice with a purchase credit memo linked to it", async () => {
    const { tr, c } = bc((req) => (path(req) === "/purchaseCreditMemos" ? json({ id: "cm-1" }, 201) : json({ id: "l" }, 201)));
    expect(await c.pushCreditNote({ ...sampleInvoice(), pdf: undefined }, "pi-1", refs)).toBe("cm-1");
    expect(body(tr.sent[0]!)).toMatchObject({ vendorId: "v0000000-0000-0000-0000-000000000001", vendorCreditMemoNumber: "BT-2026-0042-CR", invoiceId: "pi-1", creditMemoDate: "2026-11-02" });
    expect(path(tr.sent[1]!)).toBe("/purchaseCreditMemoLines");
    expect(body(tr.sent[1]!)).toMatchObject({ documentId: "cm-1", lineType: "Account", unitCost: 1000, quantity: 1 });
  });

  it("records a payment in the payment journal, applied to the invoice", async () => {
    const { tr, c } = bc(() => json({ id: "vp-1" }, 201));
    expect(await c.pushPayment(samplePayment(), refs)).toBe("vp-1");
    expect(path(tr.sent[0]!)).toBe("/vendorPayments");
    expect(body(tr.sent[0]!)).toEqual({
      journalId: "j0000000-0000-0000-0000-00000000000b", vendorId: "v0000000-0000-0000-0000-000000000001", postingDate: "2026-11-20", amount: 1428,
      appliesToInvoiceId: "i0000000-0000-0000-0000-000000000001", externalDocumentNumber: "Purser PAY-1", description: "Purser payment PAY-1",
      comment: "Airwallex transfer 03360bfa-afce-457b-89d1-e1097fbe3985",
    });
  });

  it("writes a journal entry as G/L journal lines sharing one document number, debit positive", async () => {
    const { tr, c } = bc(() => json({ id: "jl" }, 201));
    const ext = await c.pushJournalEntry(sampleJournal());
    expect(ext).toMatch(/^j0000000-0000-0000-0000-00000000000a:PRS[0-9A-F]{12}$/);
    const lines = tr.sent.map(body);
    expect(tr.sent.map(path)).toEqual(["/journals(j0000000-0000-0000-0000-00000000000a)/journalLines", "/journals(j0000000-0000-0000-0000-00000000000a)/journalLines"]);
    expect(lines.map((l) => [l.accountType, l.accountNumber, l.amount])).toEqual([["G/L Account", "6800", 13.42], ["G/L Account", "1200", -13.42]]);
    expect(new Set(lines.map((l) => l.documentNumber)).size).toBe(1);
    expect(lines[0]!.externalDocumentNumber).toBe("Purser JE-1");
  });

  it("refuses a journal entry in another currency than the company's (journal lines carry none)", async () => {
    const { c } = bc(() => json({}));
    await expect(c.pushJournalEntry({ ...sampleJournal(), currency: "USD" })).rejects.toThrow(/USD/);
  });

  it("finds an invoice by vendor and vendor invoice number, and reads its status", async () => {
    const { tr, c } = bc((req) => (path(req).includes("$filter") ? json({ value: [{ id: "pi-9" }] }) : json({ status: "Paid" })));
    expect(await c.findExisting("invoice", sampleInvoice(), refs)).toBe("pi-9");
    expect(path(tr.sent[0]!)).toBe("/purchaseInvoices?$filter=vendorId eq v0000000-0000-0000-0000-000000000001 and vendorInvoiceNumber eq 'BT-2026-0042'&$select=id");
    expect(await c.pullPaymentStatus(sampleInvoice(), "pi-9", refs)).toBe("paid");
  });

  it("follows @odata.nextLink for the chart of accounts", async () => {
    let n = 0;
    const tr = new RecordingTransport(() => (++n === 1 ? json({ value: [{ id: "a1", number: "1200", displayName: "Bank" }], "@odata.nextLink": `${BASE}/accounts?$skiptoken=2` }) : json({ value: [{ id: "a2", number: "6800", displayName: "Fees" }] })));
    const c = new BusinessCentralConnector(config, tr, staticToken());
    expect(await c.pullChartOfAccounts()).toEqual([{ code: "1200", name: "Bank", externalId: "a1" }, { code: "6800", name: "Fees", externalId: "a2" }]);
  });

  it("carries Business Central's error message", async () => {
    const { c } = bc(() => json({ error: { code: "Application_DialogException", message: "Vendor Invoice No. must have a value" } }, 400));
    await expect(c.pushPurchaseInvoice({ ...sampleInvoice(), pdf: undefined }, refs)).rejects.toThrow(/Vendor Invoice No\. must have a value/);
  });
});
