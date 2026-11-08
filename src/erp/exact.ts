// The Exact Online connector, built from Exact's REST API reference (start.exactonline.nl/docs, "Exact Online REST
// API - Reference documentation"; each endpoint's page is cited where it is used) and its OAuth guide
// (support.exactonline.com, "Step 3. Get and use access tokens"). OData v2: a record comes back as {"d":{...}}, a list as
// {"d":{"results":[...],"__next":...}}, an error as {"error":{"message":{"value":...}}}.
//
// What the reference leaves to the administration is a setting (ExactConfig), never a guess: the journal codes, the
// VAT codes, the document type for a purchase invoice, and the sign of a payment on a bank entry line.

import type { TokenProvider } from "./auth.js";
import { ErpError, type ErpAccount, type ErpConnector, type ErpVendorRow, type PaymentStatus, type RefResolver, type Transport } from "./connector.js";
import { amount, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type VatCode, type Vendor } from "./model.js";
import { base64, callJson, odataString } from "./rest.js";

export interface ExactConfig {
  /** https://start.exactonline.nl for the Netherlands; Exact runs other countries on their own hosts. */
  baseUrl: string;
  division: number;
  /** Purchase journal code (PurchaseEntries.Journal). */
  purchaseJournal: string;
  /** Bank journal code per Purser bank account (BankEntries.JournalCode), e.g. {"1200":"20"}. */
  bankJournals: Record<string, string>;
  /** General journal code (GeneralJournalEntries.JournalCode). */
  generalJournal: string;
  /** Exact's VAT code for each of Purser's VAT treatments; exclusive codes (the line amount is net). */
  vatCodes: Record<VatCode, string>;
  /** Purser chart code to Exact G/L code, where they differ; unmapped codes are looked up as they are. */
  glMap: Record<string, string>;
  /** Purser's code for accounts payable (bank entry lines against a supplier are booked to it). */
  apAccount: string;
  /** The document type id for a purchase invoice (GET documents/DocumentTypes); without it no PDF is attached. */
  documentType?: number;
  /** The sign of a supplier payment on a bank entry line; confirm in a test division before going live. */
  paymentSign: 1 | -1;
}

type One<T> = { d: T };
type Many<T> = { d: { results: T[]; __next?: string } };
const date = (d: string) => `${d}T00:00:00`;
const guid = (g: string) => `guid${odataString(g)}`;

export class ExactConnector implements ErpConnector {
  readonly name = "exact" as const;
  private gl: Map<string, string> | null = null;

  constructor(private readonly cfg: ExactConfig, private readonly transport: Transport, private readonly tokens: TokenProvider) {}

  private get base() { return `${this.cfg.baseUrl}/api/v1/${this.cfg.division}`; }

  private async get<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = `${this.base}/${path}`;
    while (url) {
      const r: { json: Many<T> | null } = await callJson<Many<T>>(this.transport, this.tokens, { method: "GET", url });
      out.push(...(r.json?.d.results ?? []));
      url = r.json?.d.__next;
    }
    return out;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await callJson<One<T>>(this.transport, this.tokens, { method: "POST", url: `${this.base}/${path}`, body });
    if (!r.json) throw new ErpError("unexpected", `POST ${path}: Exact answered without a record`);
    return r.json.d;
  }

  private filter(path: string, expr: string, select: string) {
    return `${path}?$filter=${encodeURIComponent(expr)}&$select=${select}`;
  }

  // financial/GLAccounts (start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=FinancialGLAccounts)
  async pullChartOfAccounts(): Promise<ErpAccount[]> {
    const rows = await this.get<{ ID: string; Code: string; Description: string }>("financial/GLAccounts?$select=ID,Code,Description");
    this.gl = new Map(rows.map((r) => [r.Code.trim(), r.ID]));
    return rows.map((r) => ({ code: r.Code.trim(), name: r.Description, externalId: r.ID }));
  }

  /** Exact's G/L account id for a Purser account code, or a config error naming the code. */
  private async glId(code: string): Promise<string> {
    if (!this.gl) await this.pullChartOfAccounts();
    const exactCode = this.cfg.glMap[code] ?? code;
    const id = this.gl!.get(exactCode);
    if (!id) throw new ErpError("config", `Exact has no G/L account ${exactCode} (Purser account ${code}); map it in ERP_EXACT_GL_MAP`);
    return id;
  }

  private vat(code: VatCode): string {
    const v = this.cfg.vatCodes[code];
    if (v === undefined) throw new ErpError("config", `no Exact VAT code for ${code}; set it in ERP_EXACT_VAT_CODES`);
    return v;
  }

  // crm/Accounts (…?name=CRMAccounts): suppliers are accounts with IsSupplier.
  async pullVendors(): Promise<ErpVendorRow[]> {
    const rows = await this.get<{ ID: string; Name: string; VATNumber?: string | null }>(this.filter("crm/Accounts", "IsSupplier eq true", "ID,Name,VATNumber"));
    return rows.map((r) => ({ externalId: r.ID, name: r.Name, ...(r.VATNumber ? { vatId: r.VATNumber } : {}) }));
  }

  // crm/Accounts, then crm/BankAccounts (…?name=CRMBankAccounts; Account and BankAccount are mandatory).
  async pushVendor(v: Vendor): Promise<string> {
    const acc = await this.post<{ ID: string }>("crm/Accounts", {
      Name: v.name, IsSupplier: true, ...(v.vatId ? { VATNumber: v.vatId } : {}), PurchaseCurrency: v.currency,
      ...(v.country ? { Country: v.country } : {}), ...(v.email ? { Email: v.email } : {}),
    });
    if (v.iban) {
      await this.post("crm/BankAccounts", { Account: acc.ID, BankAccount: v.iban, ...(v.bic ? { BICCode: v.bic } : {}), Main: true, BankAccountHolderName: v.name });
    }
    return acc.ID;
  }

  private async entryLines(inv: PurchaseInvoice, sign: 1 | -1) {
    const lines = [];
    for (const l of inv.lines) {
      lines.push({
        GLAccount: await this.glId(l.glAccount), AmountFC: amount(sign * l.netCents), VATCode: this.vat(l.vatCode), VATAmountFC: amount(sign * l.vatCents),
        Description: l.description, ...(l.costCentre ? { CostCenter: l.costCentre } : {}),
      });
    }
    return lines;
  }

  // documents/Documents (Subject and Type mandatory) and documents/DocumentAttachments (Attachment as base64, Document,
  // FileName mandatory): …?name=DocumentsDocuments, …?name=DocumentsDocumentAttachments.
  private async attach(inv: PurchaseInvoice, supplier: string): Promise<string | null> {
    if (!inv.pdf || this.cfg.documentType === undefined) return null;
    const doc = await this.post<{ ID: string }>("documents/Documents", { Subject: `Purchase invoice ${inv.number}`, Type: this.cfg.documentType, Account: supplier, DocumentDate: date(inv.issueDate) });
    await this.post("documents/DocumentAttachments", { Document: doc.ID, FileName: inv.pdf.fileName, Attachment: base64(inv.pdf.bytes) });
    return doc.ID;
  }

  private supplierOf(vendorId: string, refs: RefResolver): string {
    const s = refs.vendor(vendorId);
    if (!s) throw new ErpError("validation", `vendor ${vendorId} is not in Exact yet`);
    return s;
  }

  // purchaseentry/PurchaseEntries (…?name=PurchaseEntryPurchaseEntries): the header with PurchaseEntryLines in one POST;
  // Type 30 = purchase entry; YourRef holds the supplier's invoice number. Lines: …?name=PurchaseEntryPurchaseEntryLines
  // (AmountFC and GLAccount mandatory; VATAmountFC "to specify a VAT amount that differs from the one calculated").
  async pushPurchaseInvoice(inv: PurchaseInvoice, refs: RefResolver): Promise<string> {
    const supplier = this.supplierOf(inv.vendorId, refs);
    const lines = await this.entryLines(inv, 1);
    const doc = await this.attach(inv, supplier);
    const e = await this.post<{ EntryID: string }>("purchaseentry/PurchaseEntries", {
      Journal: this.cfg.purchaseJournal, Supplier: supplier, Currency: inv.currency, EntryDate: date(inv.issueDate), DueDate: date(inv.dueDate),
      YourRef: inv.number, Description: `Invoice ${inv.number}`, Type: 30, ...(inv.paymentReference ? { PaymentReference: inv.paymentReference } : {}),
      ...(doc ? { Document: doc } : {}), PurchaseEntryLines: lines,
    });
    return e.EntryID;
  }

  // Type 31 = purchase credit note; credit amounts negative (PurchaseEntries, GAccountAmountFC: "In case of a credit
  // invoice the amount should have negative value").
  async pushCreditNote(original: PurchaseInvoice, originalExternalId: string, refs: RefResolver): Promise<string> {
    const supplier = this.supplierOf(original.vendorId, refs);
    const e = await this.post<{ EntryID: string }>("purchaseentry/PurchaseEntries", {
      Journal: this.cfg.purchaseJournal, Supplier: supplier, Currency: original.currency, EntryDate: date(original.issueDate), DueDate: date(original.dueDate),
      YourRef: original.number, Description: `Credit note cancelling entry ${originalExternalId} (invoice ${original.number})`, Type: 31,
      PurchaseEntryLines: await this.entryLines(original, -1),
    });
    return e.EntryID;
  }

  // financialtransaction/BankEntries with BankEntryLines (JournalCode and lines mandatory; a line needs AmountFC,
  // GLAccount; Account is the supplier): …?name=FinancialTransactionBankEntries, …?name=FinancialTransactionBankEntryLines.
  async pushPayment(p: Payment, refs: RefResolver): Promise<string> {
    const journal = this.cfg.bankJournals[p.bankAccount];
    if (!journal) throw new ErpError("config", `no Exact bank journal for Purser account ${p.bankAccount}; set it in ERP_EXACT_BANK_JOURNALS`);
    const e = await this.post<{ EntryID: string }>("financialtransaction/BankEntries", {
      JournalCode: journal, Currency: p.currency, BankEntryLines: [{
        AmountFC: amount(this.cfg.paymentSign * p.amountCents), Date: date(p.date), GLAccount: await this.glId(this.cfg.apAccount), Account: this.supplierOf(p.vendorId, refs),
        Description: `Purser payment ${p.id}`, ...(p.airwallexTransferId ? { Notes: `Airwallex transfer ${p.airwallexTransferId}` } : {}),
      }],
    });
    return e.EntryID;
  }

  // generaljournalentry/GeneralJournalEntries with GeneralJournalEntryLines (JournalCode mandatory; a line needs
  // GLAccount): …?name=GeneralJournalEntryGeneralJournalEntries, …Lines. Debit positive, credit negative.
  async pushJournalEntry(j: JournalEntry): Promise<string> {
    const lines = [];
    for (const l of j.lines) {
      lines.push({
        GLAccount: await this.glId(l.glAccount), AmountFC: amount(l.debitCents > 0 ? l.debitCents : -l.creditCents), Date: date(j.date),
        Description: `${l.description ?? j.memo} [Purser ${j.id}]`, ...(l.costCentre ? { CostCenter: l.costCentre } : {}), ...(l.vatCode ? { VATCode: this.vat(l.vatCode) } : {}),
      });
    }
    const e = await this.post<{ EntryID: string }>("generaljournalentry/GeneralJournalEntries", { JournalCode: this.cfg.generalJournal, Currency: j.currency, GeneralJournalEntryLines: lines });
    return e.EntryID;
  }

  async findExisting(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, refs: RefResolver): Promise<string | null> {
    let rows: { ID?: string; EntryID?: string }[];
    switch (kind) {
      case "vendor":
        rows = await this.get(this.filter("crm/Accounts", `IsSupplier eq true and Name eq ${odataString((o as Vendor).name)}`, "ID"));
        return rows[0]?.ID ?? null;
      case "invoice": {
        const inv = o as PurchaseInvoice;
        const s = refs.vendor(inv.vendorId);
        if (!s) return null;
        rows = await this.get(this.filter("purchaseentry/PurchaseEntries", `Supplier eq ${guid(s)} and YourRef eq ${odataString(inv.number)}`, "EntryID"));
        return rows[0]?.EntryID ?? null;
      }
      case "payment":
        rows = await this.get(this.filter("financialtransaction/BankEntryLines", `Description eq ${odataString(`Purser payment ${o.id}`)}`, "EntryID"));
        return rows[0]?.EntryID ?? null;
      case "journal": {
        const j = o as JournalEntry;
        const first = j.lines[0];
        rows = await this.get(this.filter("generaljournalentry/GeneralJournalEntryLines", `Description eq ${odataString(`${first?.description ?? j.memo} [Purser ${j.id}]`)}`, "EntryID"));
        return rows[0]?.EntryID ?? null;
      }
    }
  }

  // cashflow/Payments (…?name=CashflowPayments): Status 20 open, 30 selected, 40 processed, 50 matched; YourRef is the
  // supplier's invoice number of a payment matched with one invoice.
  async pullPaymentStatus(inv: PurchaseInvoice, _invoiceExternalId: string, refs: RefResolver): Promise<PaymentStatus> {
    const s = refs.vendor(inv.vendorId);
    if (!s) return "unknown";
    const rows = await this.get<{ Status: number }>(this.filter("cashflow/Payments", `Account eq ${guid(s)} and YourRef eq ${odataString(inv.number)}`, "Status"));
    if (rows.length === 0) return "unknown";
    const done = rows.filter((r) => r.Status >= 40).length;
    return done === rows.length ? "paid" : done > 0 ? "partial" : "unpaid";
  }
}

/** The connector's settings from the environment (names only in errors, never values). */
export function exactConfigFromEnv(env: Record<string, string | undefined>, maps: { vat: Record<string, string>; gl: Record<string, string>; banks: Record<string, string> }): ExactConfig {
  const need = (n: string) => { const v = env[n]; if (!v) throw new ErpError("config", `${n} is not set`); return v; };
  const division = Number(need("ERP_EXACT_DIVISION"));
  if (!Number.isInteger(division)) throw new ErpError("config", "ERP_EXACT_DIVISION must be the division number");
  for (const c of ["NL21", "NL9", "NL0", "EU_RC", "NONEU_RC", "EXEMPT", "NONE"]) if (maps.vat[c] === undefined) throw new ErpError("config", `ERP_EXACT_VAT_CODES has no code for ${c}`);
  const sign = env.ERP_EXACT_PAYMENT_SIGN === "1" ? 1 : -1;
  return {
    baseUrl: env.ERP_EXACT_BASE_URL ?? "https://start.exactonline.nl", division, purchaseJournal: need("ERP_EXACT_PURCHASE_JOURNAL"), bankJournals: maps.banks,
    generalJournal: need("ERP_EXACT_GENERAL_JOURNAL"), vatCodes: maps.vat as Record<VatCode, string>, glMap: maps.gl, apAccount: env.ERP_EXACT_AP_ACCOUNT ?? "1600",
    ...(env.ERP_EXACT_DOCUMENT_TYPE ? { documentType: Number(env.ERP_EXACT_DOCUMENT_TYPE) } : {}), paymentSign: sign,
  };
}
