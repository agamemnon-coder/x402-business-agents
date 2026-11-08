// The Microsoft Dynamics 365 Business Central connector, built from Microsoft's API v2.0 reference
// (learn.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/; each resource cited where it is
// used). Endpoint: https://api.businesscentral.dynamics.com/v2.0/<tenant>/<environment>/api/v2.0 ("Endpoints for the
// APIs"). OData v4: a record comes back as itself, a list as {"value":[...],"@odata.nextLink":...}, an error as
// {"error":{"code","message"}}. Auth: src/erp/auth.ts (Microsoft Entra client credentials).
//
// Not in API v2.0's standard resources, so not done here: a vendor's bank account (a person adds it in Business
// Central), and posting the payment journal (a person reviews and posts it, or exports the payment file).

import { createHash } from "node:crypto";
import type { TokenProvider } from "./auth.js";
import { ErpError, step, type ErpAccount, type ErpConnector, type ErpVendorRow, type PaymentStatus, type PushProgress, type RefResolver, type Transport } from "./connector.js";
import { amount, type InvoiceLine, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type VatCode, type Vendor } from "./model.js";
import { callJson, odataString } from "./rest.js";

/**
 * Business Central's Vendor Invoice No. on the purchase header: Code[35]
 * (https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.purchases.document.purchase-header).
 * Line descriptions are cut at 100 characters (below).
 */
export const BC_VENDOR_INVOICE_NUMBER_MAX = 35;

export interface BcConfig {
  /** The tenant id or domain (contoso.onmicrosoft.com). */
  tenant: string;
  environment: string;
  companyId: string;
  /** The company's local currency: Business Central writes it as a blank currency code. */
  localCurrency: string;
  /** The general journal batch id (GET journals) the G/L lines go into. */
  generalJournalId: string;
  /** The payment journal batch id (GET vendorPaymentJournals) supplier payments go into. */
  paymentJournalId: string;
  /** Business Central's tax code for each of Purser's VAT treatments. */
  vatCodes: Record<VatCode, string>;
  /** Purser chart code to Business Central account number, where they differ. */
  glMap: Record<string, string>;
  /** Post a purchase invoice once its total matches (Microsoft.NAV.post); otherwise leave it in Draft for a person. */
  postInvoices: boolean;
  /** Compare Business Central's computed total with the invoice before posting (default on; a dry run turns it off). */
  verifyTotals?: boolean;
}

type List<T> = { value: T[]; "@odata.nextLink"?: string };

export class BusinessCentralConnector implements ErpConnector {
  readonly name = "bc" as const;
  constructor(private readonly cfg: BcConfig, private readonly transport: Transport, private readonly tokens: TokenProvider) {}

  private get base() {
    return `https://api.businesscentral.dynamics.com/v2.0/${encodeURIComponent(this.cfg.tenant)}/${encodeURIComponent(this.cfg.environment)}/api/v2.0/companies(${this.cfg.companyId})`;
  }

  private async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = `${this.base}/${path}`;
    while (url) {
      const r: { json: List<T> | null } = await callJson<List<T>>(this.transport, this.tokens, { method: "GET", url });
      out.push(...(r.json?.value ?? []));
      url = r.json?.["@odata.nextLink"];
    }
    return out;
  }

  private async one<T>(path: string): Promise<T> {
    const r = await callJson<T>(this.transport, this.tokens, { method: "GET", url: `${this.base}/${path}` });
    if (!r.json) throw new ErpError("unexpected", `GET ${path}: no record`);
    return r.json;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await callJson<T>(this.transport, this.tokens, { method: "POST", url: `${this.base}/${path}`, ...(body !== undefined ? { body } : {}) });
    return r.json as T;
  }

  private filter(path: string, expr: string, select: string) {
    return `${path}?$filter=${encodeURIComponent(expr)}&$select=${select}`;
  }

  private currency(c: string) { return c === this.cfg.localCurrency ? "" : c; }
  private account(code: string) { return this.cfg.glMap[code] ?? code; }
  private tax(code: VatCode): string {
    const t = this.cfg.vatCodes[code];
    if (t === undefined) throw new ErpError("config", `no Business Central tax code for ${code}; set it in ERP_BC_VAT_CODES`);
    return t;
  }
  private vendorOf(id: string, refs: RefResolver): string {
    const v = refs.vendor(id);
    if (!v) throw new ErpError("validation", `vendor ${id} is not in Business Central yet`);
    return v;
  }

  // resources/dynamics_account: id, number, displayName.
  async pullChartOfAccounts(): Promise<ErpAccount[]> {
    const rows = await this.list<{ id: string; number: string; displayName: string }>("accounts?$select=id,number,displayName");
    return rows.map((r) => ({ code: r.number, name: r.displayName, externalId: r.id }));
  }

  // resources/dynamics_vendor.
  async pullVendors(): Promise<ErpVendorRow[]> {
    const rows = await this.list<{ id: string; displayName: string; taxRegistrationNumber?: string }>("vendors?$select=id,number,displayName,taxRegistrationNumber");
    return rows.map((r) => ({ externalId: r.id, name: r.displayName, ...(r.taxRegistrationNumber ? { vatId: r.taxRegistrationNumber } : {}) }));
  }

  // api/dynamics_vendor_create: POST companies({id})/vendors.
  async pushVendor(v: Vendor): Promise<string> {
    const r = await this.post<{ id: string }>("vendors", {
      displayName: v.name, ...(v.vatId ? { taxRegistrationNumber: v.vatId } : {}), currencyCode: this.currency(v.currency),
      ...(v.email ? { email: v.email } : {}), ...(v.country ? { country: v.country } : {}),
    });
    return r.id;
  }

  private line(l: InvoiceLine) {
    // resources/dynamics_purchaseinvoiceline: lineType "Account", lineObjectNumber the account number, unitCost × quantity.
    return { lineType: "Account", lineObjectNumber: this.account(l.glAccount), description: l.description.slice(0, 100), unitCost: amount(l.netCents), quantity: 1, taxCode: this.tax(l.vatCode) };
  }

  // api/dynamics_purchaseinvoice_create; api/dynamics_purchaseinvoiceline_create
  // (POST purchaseInvoices({id})/purchaseInvoiceLines); api/dynamics_attachment_create (parentType "Purchase Invoice")
  // and api/dynamics_attachment_update (PATCH attachments({id})/attachmentContent, If-Match required); the bound action
  // Microsoft.NAV.post (resources/dynamics_purchaseinvoice, "Bound actions", 204).
  // pricesIncludeTax is read-only on purchaseInvoice and purchaseCreditMemo in API v2.0: not sent.
  // Each request is one step (src/erp/connector.ts step): a retry resumes after the last one that succeeded.
  async pushPurchaseInvoice(inv: PurchaseInvoice, refs: RefResolver, progress?: PushProgress): Promise<string> {
    // The purchase header's "Vendor Invoice No." is Code[35] (Microsoft Learn, table Purchase Header, checked 8 November
    // 2026): a longer number is refused here, never cut (a cut number could name another invoice).
    if (inv.number.length > BC_VENDOR_INVOICE_NUMBER_MAX) throw new ErpError("validation", `invoice ${inv.id}: the supplier's number has ${inv.number.length} characters; Business Central's Vendor Invoice No. holds ${BC_VENDOR_INVOICE_NUMBER_MAX}`);
    const vendorId = this.vendorOf(inv.vendorId, refs);
    const lines = inv.lines.map((l) => this.line(l));
    const head = await step(progress, "header", async () => (await this.post<{ id: string }>("purchaseInvoices", {
      vendorId, vendorInvoiceNumber: inv.number, invoiceDate: inv.issueDate, postingDate: inv.issueDate, dueDate: inv.dueDate, currencyCode: this.currency(inv.currency),
    })).id);
    for (const [i, l] of lines.entries()) await step(progress, `line:${i}`, async () => (await this.post<{ id?: string }>(`purchaseInvoices(${head})/purchaseInvoiceLines`, l))?.id ?? "done");
    if (inv.pdf) {
      const pdf = inv.pdf;
      const att = await step(progress, "attachment", async () => JSON.stringify(await this.post<{ id: string; "@odata.etag"?: string }>("attachments", { parentId: head, fileName: pdf.fileName, parentType: "Purchase Invoice" })));
      const a = JSON.parse(att) as { id: string; "@odata.etag"?: string };
      await step(progress, "attachment:content", async () => {
        await callJson(this.transport, this.tokens, {
          method: "PATCH", url: `${this.base}/attachments(${a.id})/attachmentContent`, bytes: { data: pdf.bytes, contentType: "application/octet-stream" }, headers: { "if-match": a["@odata.etag"] ?? "*" },
        });
        return "done";
      });
    }
    // Business Central computes the tax itself: post only when its total is the invoice's, to the cent. Otherwise the
    // draft stays for a person, and stays theirs: the sync runner never clears needs_review by itself.
    const t = this.cfg.verifyTotals === false ? null : await this.one<{ totalAmountIncludingTax: number }>(`purchaseInvoices(${head})?$select=totalAmountIncludingTax,totalTaxAmount`);
    if (t && Math.round(t.totalAmountIncludingTax * 100) !== inv.totals.grossCents) {
      throw new ErpError("needs_review", `Business Central computed a total of ${t.totalAmountIncludingTax.toFixed(2)} for purchase invoice ${head}, the invoice says ${amount(inv.totals.grossCents).toFixed(2)}; it is left in Draft for a person (check the tax codes)`, { externalId: head });
    }
    if (this.cfg.postInvoices) await step(progress, "posted", async () => { await this.post(`purchaseInvoices(${head})/Microsoft.NAV.post`); return "done"; });
    return head;
  }

  // api/dynamics_purchasecreditmemo_create (invoiceId links the invoice it corrects);
  // api/dynamics_purchasecreditmemoline_create: the example body carries documentId, so the line is created on the
  // purchaseCreditMemoLines collection with documentId (the example's URL ends in "({id})", which a create cannot use).
  async pushCreditNote(original: PurchaseInvoice, originalExternalId: string, refs: RefResolver, progress?: PushProgress): Promise<string> {
    const vendorId = this.vendorOf(original.vendorId, refs);
    const lines = original.lines.map((l) => this.line(l));
    const head = await step(progress, "header", async () => (await this.post<{ id: string }>("purchaseCreditMemos", {
      vendorId, vendorCreditMemoNumber: `${original.number}-CR`, creditMemoDate: original.issueDate, postingDate: original.issueDate, dueDate: original.dueDate,
      currencyCode: this.currency(original.currency), invoiceId: originalExternalId,
    })).id);
    for (const [i, l] of lines.entries()) await step(progress, `line:${i}`, async () => (await this.post<{ id?: string }>("purchaseCreditMemoLines", { documentId: head, ...l }))?.id ?? "done");
    return head;
  }

  // api/dynamics_vendorpayment_create: POST companies({id})/vendorPayments; resources/dynamics_vendorpayment (journalId,
  // vendorId, postingDate, amount, appliesToInvoiceId, externalDocumentNumber, description, comment).
  async pushPayment(p: Payment, refs: RefResolver): Promise<string> {
    const inv = refs.invoice(p.invoiceId);
    const r = await this.post<{ id: string }>("vendorPayments", {
      journalId: this.cfg.paymentJournalId, vendorId: this.vendorOf(p.vendorId, refs), postingDate: p.date, amount: amount(p.amountCents),
      ...(inv ? { appliesToInvoiceId: inv } : {}), externalDocumentNumber: `Purser ${p.id}`, description: `Purser payment ${p.id}`,
      ...(p.airwallexTransferId ? { comment: `Airwallex transfer ${p.airwallexTransferId}` } : {}),
    });
    return r.id;
  }

  private docNo(j: JournalEntry) { return `PRS${createHash("sha256").update(j.id).digest("hex").slice(0, 12).toUpperCase()}`; }

  // api/dynamics_journalline_create: POST companies({id})/journals({id})/journalLines; resources/dynamics_journalline
  // (accountType "G/L Account", accountNumber, postingDate, documentNumber, externalDocumentNumber, amount, taxCode).
  async pushJournalEntry(j: JournalEntry, progress?: PushProgress): Promise<string> {
    if (j.currency !== this.cfg.localCurrency) throw new ErpError("config", `journal entry ${j.id} is in ${j.currency}; Business Central journal lines carry no currency, so only ${this.cfg.localCurrency} entries are sent`);
    const doc = this.docNo(j);
    for (const [i, l] of j.lines.entries()) {
      await step(progress, `line:${i}`, async () => (await this.post<{ id?: string }>(`journals(${this.cfg.generalJournalId})/journalLines`, {
        accountType: "G/L Account", accountNumber: this.account(l.glAccount), postingDate: j.date, documentNumber: doc, externalDocumentNumber: `Purser ${j.id}`,
        amount: amount(l.debitCents > 0 ? l.debitCents : -l.creditCents), description: (l.description ?? j.memo).slice(0, 100), ...(l.vatCode ? { taxCode: this.tax(l.vatCode) } : {}),
      }))?.id ?? "done");
    }
    return `${this.cfg.generalJournalId}:${doc}`;
  }

  /** An invoice or journal entry found with no record of its steps: all its lines must be there. */
  async incomplete(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, externalId: string): Promise<string | null> {
    if (kind === "invoice") {
      const want = (o as PurchaseInvoice).lines.length;
      const have = (await this.list<{ id: string }>(`purchaseInvoices(${externalId})/purchaseInvoiceLines?$select=id`)).length;
      return have === want ? null : `${have} of its ${want} lines are there`;
    }
    if (kind === "journal") {
      const j = o as JournalEntry;
      const have = (await this.list<{ id: string }>(this.filter(`journals(${this.cfg.generalJournalId})/journalLines`, `externalDocumentNumber eq ${odataString(`Purser ${j.id}`)}`, "id"))).length;
      return have === j.lines.length ? null : `${have} of its ${j.lines.length} journal lines are there`;
    }
    return null;
  }

  async findExisting(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, refs: RefResolver): Promise<string | null> {
    switch (kind) {
      case "vendor":
        return (await this.list<{ id: string }>(this.filter("vendors", `displayName eq ${odataString((o as Vendor).name)}`, "id")))[0]?.id ?? null;
      case "invoice": {
        const inv = o as PurchaseInvoice;
        const v = refs.vendor(inv.vendorId);
        if (!v) return null;
        return (await this.list<{ id: string }>(this.filter("purchaseInvoices", `vendorId eq ${v} and vendorInvoiceNumber eq ${odataString(inv.number)}`, "id")))[0]?.id ?? null;
      }
      case "payment":
        return (await this.list<{ id: string }>(this.filter("vendorPayments", `externalDocumentNumber eq ${odataString(`Purser ${o.id}`)}`, "id")))[0]?.id ?? null;
      case "journal": {
        const j = o as JournalEntry;
        const rows = await this.list<{ id: string }>(this.filter(`journals(${this.cfg.generalJournalId})/journalLines`, `externalDocumentNumber eq ${odataString(`Purser ${j.id}`)}`, "id"));
        return rows.length ? `${this.cfg.generalJournalId}:${this.docNo(j)}` : null;
      }
    }
  }

  // resources/dynamics_purchaseinvoice: status " ", "Draft", "In Review", "Open", "Paid", "Canceled" or "Corrective".
  async pullPaymentStatus(_inv: PurchaseInvoice, invoiceExternalId: string, _refs?: RefResolver): Promise<PaymentStatus> {
    const r = await this.one<{ status: string }>(`purchaseInvoices(${invoiceExternalId})?$select=status`);
    return r.status === "Paid" ? "paid" : r.status === "Open" ? "unpaid" : "unknown";
  }
}
