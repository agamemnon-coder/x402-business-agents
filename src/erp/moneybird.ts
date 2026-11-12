// The Moneybird connector, built from Moneybird's API documentation (developer.moneybird.com: "Welcome to Moneybird",
// "Authentication") and its official OpenAPI file (github.com/moneybird/openapi, openapi.yml, version
// v2-20261110-3df079017e), which the tests check every request against (test/fixtures/moneybird/openapi-subset.json).
//
// - Paths: https://moneybird.com/api/v2/{administration_id}/{resource}.json; a Bearer token (a personal API token or an
//   OAuth access token) in the Authorization header. One scope is enough for everything here: `documents` (purchase
//   invoices, their payments and attachments, general journal documents; contacts, ledger accounts and tax rates accept
//   it too). A plain payment (no manual_payment_action) needs no `bank` scope.
// - Ids are integers past 2^53 ("we recommend to parse the IDs as strings"): every answer is read with them as strings.
// - Money goes out as a decimal string ("1000.00"), which Moneybird's `money` schema accepts; never through a float.
// - Lists page with page/per_page (at most 100) and a Link header; the ledger accounts list does not page.
// - 150 requests per 5 minutes per IP address; a 429 carries Retry-After, which the sync runner waits out.
// - Moneybird caches GET answers ("we strongly advise against using GET methods for verification"): an invoice's
//   totals are checked on the answer to its own POST, and a GET is only used to find an object a lost answer may have
//   created, never to confirm a push.
//
// What the documentation leaves to the administration is a setting, never a guess: which tax rate each of Purser's VAT
// treatments uses, which ledger account an account code without a match is, which project a cost centre is.
//
// Two guards sit in front of every request (moneybirdEndpoint): it must be one of the endpoints listed below, and it
// must go to the administration the settings name. With ERP_MONEYBIRD_SANDBOX_ONLY=on that can only be the owner's
// sandbox administration. The list is the purchase side of the books; nothing on it sends an e-mail, an invoice or a
// reminder to a contact (a sandbox administration delivers its e-mail for real).

import type { TokenProvider } from "./auth.js";
import { errorForStatus, ErpError, redactUrl, step, type ErpAccount, type ErpConnector, type ErpVendorRow, type HttpRequest, type HttpResponse, type PaymentStatus, type PushProgress, type RefResolver, type Transport } from "./connector.js";
import { VAT_CODES, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type VatCode, type Vendor } from "./model.js";

export interface MoneybirdConfig {
  /** https://moneybird.com/api/v2 */
  baseUrl: string;
  /** The administration's id: the number in the web app's address when the administration is open. */
  administrationId: string;
  /** The administration's own currency; a payment or journal entry in another one is refused (Moneybird needs both amounts). */
  baseCurrency: string;
  /** Moneybird's tax rate id for each of Purser's VAT treatments that is used; an unmapped one is refused. */
  taxRates: Partial<Record<VatCode, string>>;
  /** Purser account code to a Moneybird ledger account id, where the codes differ; otherwise the account with that code. */
  glMap: Record<string, string>;
  /** Purser cost centre to a Moneybird project id; a cost centre without one is refused unless ignoreCostCentres. */
  projects: Record<string, string>;
  ignoreCostCentres: boolean;
  /** Compare Moneybird's own totals with the invoice's (off only for a dry run, where nothing computes them). */
  verifyTotals?: boolean;
  /** ERP_MONEYBIRD_SANDBOX_ONLY=on: no request goes anywhere but the sandbox administration, on Moneybird's own address. */
  sandboxOnly?: boolean;
}

export const MONEYBIRD_BASE_URL = "https://moneybird.com/api/v2";
/** The owner's Moneybird sandbox administration ("Purser", EUR, the Netherlands; created 12 November 2026). Test data only. */
export const MONEYBIRD_SANDBOX_ADMINISTRATION = "503585935808530148";

/**
 * Every request the connector can make, named as Moneybird's OpenAPI file names its paths. A request to anything else
 * is refused before it is sent. All of it is the purchase side of the books: suppliers, the chart, the tax rates,
 * purchase invoices with their PDF and payments, and journal documents. Nothing here sends an e-mail, an invoice or a
 * reminder to a contact, and nothing changes or removes what was sent (no PATCH, no DELETE).
 */
export const MONEYBIRD_ENDPOINTS = [
  "GET /{administration_id}/ledger_accounts{format}",
  "GET /{administration_id}/tax_rates{format}",
  "GET /{administration_id}/contacts{format}",
  "GET /{administration_id}/contacts/customer_id/{customer_id}{format}",
  "POST /{administration_id}/contacts{format}",
  "GET /{administration_id}/documents/purchase_invoices{format}",
  "POST /{administration_id}/documents/purchase_invoices{format}",
  "GET /{administration_id}/documents/purchase_invoices/{id}{format}",
  "POST /{administration_id}/documents/purchase_invoices/{id}/attachments{format}",
  "POST /{administration_id}/documents/purchase_invoices/{id}/payments{format}",
  "GET /{administration_id}/documents/general_journal_documents{format}",
  "POST /{administration_id}/documents/general_journal_documents{format}",
] as const;
export type MoneybirdEndpoint = (typeof MONEYBIRD_ENDPOINTS)[number];

const ADMIN_PART = "/{administration_id}";
/** Each endpoint as a pattern over the path after the administration: the format is always .json, an id is digits. */
const ENDPOINT_PATTERNS = MONEYBIRD_ENDPOINTS.map((endpoint) => {
  const [method, path] = endpoint.split(" ") as [string, string];
  const pattern = path.slice(ADMIN_PART.length).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace("{format}", "\\.json").replace("{id}", "\\d+").replace("{customer_id}", "[^/]+");
  return { endpoint, method, re: new RegExp(`^${pattern}$`) };
});

interface Ledger { id: string; account_id: string | null; name: string; allowed_document_types?: string[] | null; active?: boolean }
interface TaxRate { id: string; name: string; percentage: string | null; tax_rate_type: string; active?: boolean }
interface MbInvoice { id: string; reference: string | null; state: string; total_price_excl_tax: string | null; total_price_incl_tax: string | null; payments?: { id: string; transaction_identifier: string | null; price: string }[]; attachments?: unknown[] }

const ID = /^\d+$/;

type Guarded = Pick<MoneybirdConfig, "baseUrl" | "administrationId" | "sandboxOnly">;

/**
 * The endpoint a request is, or the reason it may not be sent. Read from the URL as it would leave this machine (so a
 * "../" in an id cannot lead elsewhere): it must be on Moneybird's address from the settings, inside the administration
 * from the settings, and on the list above. With the sandbox guard on, that administration is the sandbox one.
 */
export function moneybirdEndpoint(method: string, url: string, cfg: Guarded): MoneybirdEndpoint {
  const where = `${method} ${redactUrl(url)}`;
  if (cfg.sandboxOnly && (cfg.administrationId !== MONEYBIRD_SANDBOX_ADMINISTRATION || cfg.baseUrl !== MONEYBIRD_BASE_URL)) {
    throw new ErpError("config", `${where}: ERP_MONEYBIRD_SANDBOX_ONLY is on, so only the sandbox administration ${MONEYBIRD_SANDBOX_ADMINISTRATION} at ${MONEYBIRD_BASE_URL} may be called; nothing was sent`);
  }
  const outside = new ErpError("config", `${where} is outside administration ${cfg.administrationId} at ${cfg.baseUrl}; nothing was sent`);
  let u: URL;
  let base: URL;
  try { u = new URL(url); base = new URL(cfg.baseUrl); } catch { throw outside; }
  const prefix = `${base.pathname.replace(/\/+$/, "")}/`;
  if (u.origin !== base.origin || !u.pathname.startsWith(prefix)) throw outside;
  const [admin, ...rest] = u.pathname.slice(prefix.length).split("/");
  if (!ID.test(cfg.administrationId) || admin !== cfg.administrationId) throw outside;
  const path = `/${rest.join("/")}`;
  const hit = ENDPOINT_PATTERNS.find((e) => e.method === method && e.re.test(path));
  if (!hit) throw new ErpError("unexpected", `${where} is not an endpoint Purser's Moneybird connector uses; nothing was sent`);
  return hit.endpoint;
}

/** What the call log names a request: Moneybird's host and path with the administration kept and object ids left out. */
export function moneybirdCallName(req: Pick<HttpRequest, "method" | "url">, cfg: Guarded): string {
  const endpoint = moneybirdEndpoint(req.method, req.url, cfg);
  const base = new URL(cfg.baseUrl);
  return `${base.host}${base.pathname.replace(/\/+$/, "")}/${cfg.administrationId}${endpoint.slice(endpoint.indexOf(ADMIN_PART) + ADMIN_PART.length).replace("{format}", ".json")}`;
}

/** Whole cents as the decimal string Moneybird's money fields take: exact, two decimals, a sign only when negative. */
export function toMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`amount: ${cents} is not whole cents`);
  const a = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Cents from a money string Moneybird wrote ("1428.0", "-3.21", "10,95"); null when it is not money. */
export function fromMoney(m: string | null | undefined): number | null {
  const x = /^(-?)(\d+)(?:[.,](\d{1,2})0*)?$/.exec(String(m ?? "").trim());
  if (!x) return null;
  const c = Number(x[2]) * 100 + Number((x[3] ?? "").padEnd(2, "0"));
  return x[1] ? -c : c;
}

/** Moneybird's JSON with every id (`id`, `*_id`) that is a bare integer read as its digits, so none passes through a float. */
export function parseMoneybirdJson(body: string): unknown {
  return JSON.parse(body.replace(/("(?:id|[a-z_]+_id)"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g, '$1"$2"'));
}

/**
 * Retry-After as Moneybird may send it: seconds, an HTTP date, or a moment as Unix seconds ("the time after which a new
 * request can be made"). A bare number past 10^9 is a moment, not a wait of thirty years.
 */
export function moneybirdRetryAfterMs(h: Record<string, string>, now = Date.now()): number | undefined {
  const v = (h["retry-after"] ?? "").trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n > 1e9 ? Math.max(0, n * 1000 - now) : n * 1000;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

/** Moneybird's own words from an error body: {"error": "..."} or {"error": {field: [messages]}, "full_message": "..."}. */
export function moneybirdError(body: string): string {
  try {
    const b = JSON.parse(body) as { error?: unknown; full_message?: string };
    if (typeof b.full_message === "string" && b.full_message) return b.full_message.slice(0, 500);
    if (typeof b.error === "string") return b.error.slice(0, 500);
    if (b.error && typeof b.error === "object") {
      return Object.entries(b.error as Record<string, unknown>).map(([k, v]) => `${k} ${Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ") : String(v)}`).join("; ").slice(0, 500);
    }
  } catch { /* not JSON */ }
  return body.trim().slice(0, 200);
}

/** A form with one file part, as Moneybird's attachment endpoint takes it (multipart/form-data, field `file`). */
function filePart(fileName: string, bytes: Uint8Array): { contentType: string; body: Uint8Array } {
  const boundary = `purser-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const safeName = fileName.replace(/["\r\n\\]/g, "_").slice(0, 200) || "invoice.pdf";
  const type = /\.pdf$/i.test(safeName) ? "application/pdf" : "application/octet-stream";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${type}\r\n\r\n`, "latin1");
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "latin1");
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: new Uint8Array(Buffer.concat([head, Buffer.from(bytes), tail])) };
}

/** Money Moneybird wrote, shown with two decimals ("121.6" as 121.60), or as it came when it is not money. */
const show = (m: string | null | undefined) => { const c = fromMoney(m); return c === null ? JSON.stringify(m ?? null) : toMoney(c); };

/** The customer id Purser gives a supplier it creates, so a lost answer can be found again (GET contacts/customer_id/…). */
export const customerIdOf = (vendorId: string) => `PURSER-${vendorId}`;
const journalRef = (id: string) => `Purser ${id}`;
const creditRef = (number: string) => `${number} (credit note)`;

export class MoneybirdConnector implements ErpConnector {
  readonly name = "moneybird" as const;
  private ledger: Ledger[] | null = null;
  private taxes: TaxRate[] | null = null;

  constructor(private readonly cfg: MoneybirdConfig, private readonly transport: Transport, private readonly tokens: TokenProvider) {}

  private url(path: string) { return `${this.cfg.baseUrl}/${this.cfg.administrationId}/${path}`; }

  /** One call: the Bearer token, one fresh token after a 401, Moneybird's own error words, ids read as strings. */
  private async call(method: HttpRequest["method"], path: string, o: { json?: unknown; file?: { contentType: string; body: Uint8Array } } = {}): Promise<{ res: HttpResponse; data: unknown }> {
    const url = this.url(path);
    const where = `${method} ${redactUrl(url)}`;
    // Refused here, before anything is sent: a request outside the administration, or one that is not on the list.
    moneybirdEndpoint(method, url, this.cfg);
    for (let attempt = 0; ; attempt++) {
      const req: HttpRequest = {
        method, url,
        headers: { authorization: `Bearer ${await this.tokens.token()}`, accept: "application/json", ...(o.json !== undefined ? { "content-type": "application/json" } : o.file ? { "content-type": o.file.contentType } : {}) },
        ...(o.json !== undefined ? { body: JSON.stringify(o.json) } : o.file ? { body: o.file.body } : {}),
      };
      const res = await this.transport.send(req);
      if (res.status === 401 && attempt === 0) {
        this.tokens.invalidate();
        continue;
      }
      if (res.status < 200 || res.status > 299) {
        const wait = moneybirdRetryAfterMs(res.headers);
        const headers = { ...res.headers };
        if (wait !== undefined) headers["retry-after"] = String(Math.ceil(wait / 1000));
        else delete headers["retry-after"];
        throw errorForStatus(res.status, headers, where, moneybirdError(res.body));
      }
      if (res.body.trim() === "") return { res, data: null };
      try {
        return { res, data: parseMoneybirdJson(res.body) };
      } catch {
        throw new ErpError("unexpected", `${where}: the answer is not JSON`, { status: res.status });
      }
    }
  }

  private async post<T>(path: string, json: unknown): Promise<T> {
    const { data } = await this.call("POST", path, { json });
    if (!data || typeof data !== "object") throw new ErpError("unexpected", `POST ${path}: Moneybird answered without a record`);
    return data as T;
  }

  /** Every page of a list (per_page 100), following the Link header Moneybird sends while there is a next page. */
  private async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 1000; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const { res, data } = await this.call("GET", `${path}${sep}per_page=100&page=${page}`);
      const rows = Array.isArray(data) ? (data as T[]) : [];
      out.push(...rows);
      if (!/rel="next"/.test(res.headers.link ?? "") || rows.length === 0) return out;
    }
    throw new ErpError("unexpected", `GET ${path}: more than 1000 pages`);
  }

  // GET ledger_accounts.json (no pagination): id, account_id (the code, may be empty), name, allowed_document_types.
  private async ledgerAccounts(): Promise<Ledger[]> {
    if (!this.ledger) {
      const { data } = await this.call("GET", "ledger_accounts.json");
      this.ledger = Array.isArray(data) ? (data as Ledger[]) : [];
    }
    return this.ledger;
  }

  async pullChartOfAccounts(): Promise<ErpAccount[]> {
    this.ledger = null;
    return (await this.ledgerAccounts()).map((l) => ({ code: l.account_id ?? "", name: l.name, externalId: l.id }));
  }

  // GET tax_rates.json (paginated): id, name, percentage, tax_rate_type (purchase_invoice, sales_invoice, general_journal_document).
  private async taxRates(): Promise<TaxRate[]> {
    if (!this.taxes) this.taxes = await this.list<TaxRate>("tax_rates.json");
    return this.taxes;
  }

  /** The administration's tax rates, for the person who fills in ERP_MONEYBIRD_TAX_RATES. */
  async pullTaxRates(): Promise<{ id: string; name: string; percentage: string; type: string }[]> {
    this.taxes = null;
    return (await this.taxRates()).filter((t) => t.active !== false).map((t) => ({ id: t.id, name: t.name, percentage: t.percentage ?? "", type: t.tax_rate_type }));
  }

  /** The Moneybird ledger account for a Purser account code, allowed on this kind of document; else a config error. */
  private async ledgerId(code: string, doc: "purchase_invoice" | "general_journal_document"): Promise<string> {
    const all = await this.ledgerAccounts();
    const mapped = this.cfg.glMap[code];
    const l = mapped ? all.find((x) => x.id === mapped) : all.find((x) => (x.account_id ?? "").trim() === code);
    if (!l) throw new ErpError("config", mapped ? `Moneybird has no ledger account ${mapped} (ERP_MONEYBIRD_GL_MAP for Purser account ${code})` : `Moneybird has no ledger account with code ${code}; map Purser account ${code} to a ledger account id in ERP_MONEYBIRD_GL_MAP`);
    if (l.active === false) throw new ErpError("config", `Moneybird's ledger account ${l.name} (${l.id}, Purser account ${code}) is not active`);
    if (l.allowed_document_types?.length && !l.allowed_document_types.includes(doc)) {
      throw new ErpError("config", `Moneybird's ledger account ${l.name} (Purser account ${code}) is not allowed on a ${doc === "purchase_invoice" ? "purchase invoice" : "general journal document"}`);
    }
    return l.id;
  }

  /** The Moneybird tax rate for one of Purser's VAT treatments, of the right type; else a config error. */
  private async taxId(code: VatCode, type: "purchase_invoice" | "general_journal_document"): Promise<string> {
    const id = this.cfg.taxRates[code];
    if (!id) throw new ErpError("config", `no Moneybird tax rate for ${code}; set it in ERP_MONEYBIRD_TAX_RATES`);
    const t = (await this.taxRates()).find((x) => x.id === id);
    if (!t) throw new ErpError("config", `Moneybird has no tax rate ${id} (ERP_MONEYBIRD_TAX_RATES for ${code})`);
    if (t.active === false) throw new ErpError("config", `Moneybird's tax rate ${t.name} (${id}, for ${code}) is not active`);
    if (t.tax_rate_type !== type) throw new ErpError("config", `Moneybird's tax rate ${id} (${t.name}, for ${code}) is a ${t.tax_rate_type} rate, not a ${type === "purchase_invoice" ? "purchase invoice" : "journal"} rate`);
    return id;
  }

  private projectOf(costCentre: string | undefined): string | null {
    if (!costCentre || this.cfg.ignoreCostCentres) return null;
    const p = this.cfg.projects[costCentre];
    if (!p) throw new ErpError("config", `no Moneybird project for cost centre ${costCentre}; map it in ERP_MONEYBIRD_PROJECTS (or set ERP_MONEYBIRD_IGNORE_COST_CENTRES=on)`);
    return p;
  }

  private sameCurrency(what: string, currency: string): void {
    if (currency !== this.cfg.baseCurrency) {
      throw new ErpError("validation", `${what} is in ${currency}; Moneybird needs its amount in ${this.cfg.baseCurrency} too (price_base), which Purser does not record for it yet: book it in Moneybird by hand`);
    }
  }

  // GET contacts.json (paginated): company_name, or firstname and lastname; tax_number.
  async pullVendors(): Promise<ErpVendorRow[]> {
    const rows = await this.list<{ id: string; company_name?: string | null; firstname?: string | null; lastname?: string | null; tax_number?: string | null }>("contacts.json");
    return rows.map((r) => ({ externalId: r.id, name: r.company_name || [r.firstname, r.lastname].filter(Boolean).join(" "), ...(r.tax_number ? { vatId: r.tax_number } : {}) }));
  }

  // POST contacts.json: company_name is enough; customer_id is "Should be unique for the administration", so Purser's own
  // id there finds the contact again; bank_account is the supplier's IBAN ("Used for outgoing payments").
  async pushVendor(v: Vendor): Promise<string> {
    const c = await this.post<{ id: string }>("contacts.json", { contact: {
      company_name: v.name, customer_id: customerIdOf(v.id), ...(v.vatId ? { tax_number: v.vatId } : {}), ...(v.iban ? { bank_account: v.iban } : {}), ...(v.country ? { country: v.country } : {}),
    } });
    return c.id;
  }

  private async details(inv: PurchaseInvoice, sign: 1 | -1) {
    const out = [];
    for (const l of inv.lines) {
      const project = this.projectOf(l.costCentre);
      out.push({
        description: l.description, price: toMoney(sign * l.netCents), amount: 1,
        tax_rate_id: await this.taxId(l.vatCode, "purchase_invoice"), ledger_account_id: await this.ledgerId(l.glAccount, "purchase_invoice"),
        ...(project ? { project_id: project } : {}),
      });
    }
    return out;
  }

  private contactOf(vendorId: string, refs: RefResolver): string {
    const c = refs.vendor(vendorId);
    if (!c) throw new ErpError("validation", `vendor ${vendorId} is not in Moneybird yet`);
    return c;
  }

  /**
   * POST documents/purchase_invoices.json with its details (prices excluding VAT, the mapped tax rate and ledger account
   * per line), then the PDF (POST …/{id}/attachments.json, multipart field `file`). Moneybird computes the VAT itself; its
   * totals on the answer must be the invoice's to the cent, or the invoice waits for a person (needs_review) and nothing
   * is paid against it.
   */
  private async pushDocument(inv: PurchaseInvoice, refs: RefResolver, sign: 1 | -1, reference: string, progress?: PushProgress): Promise<string> {
    const contact = this.contactOf(inv.vendorId, refs);
    const details = await this.details(inv, sign);
    let totals = progress?.get("totals");
    const id = await step(progress, "invoice", async () => {
      const r = await this.post<MbInvoice>("documents/purchase_invoices.json", { purchase_invoice: {
        contact_id: contact, reference, date: inv.issueDate, due_date: inv.dueDate, currency: inv.currency, prices_are_incl_tax: false, details_attributes: details,
      } });
      totals = `${r.total_price_excl_tax ?? ""}|${r.total_price_incl_tax ?? ""}`;
      progress?.set("totals", totals);
      return r.id;
    });
    if (inv.pdf && sign === 1) {
      const pdf = inv.pdf;
      await step(progress, "attachment", async () => { await this.call("POST", `documents/purchase_invoices/${id}/attachments.json`, { file: filePart(pdf.fileName, pdf.bytes) }); return "done"; });
    }
    if (this.cfg.verifyTotals !== false && totals !== undefined) {
      const [excl, incl] = totals.split("|");
      const wantNet = sign * inv.totals.netCents;
      const wantGross = sign * inv.totals.grossCents;
      if (fromMoney(excl) !== wantNet || fromMoney(incl) !== wantGross) {
        throw new ErpError("needs_review", `Moneybird computed ${show(excl)} excluding and ${show(incl)} including VAT for ${reference}; the invoice says ${toMoney(wantNet)} and ${toMoney(wantGross)}: a person checks the VAT in Moneybird`, { externalId: id });
      }
    }
    return id;
  }

  async pushPurchaseInvoice(inv: PurchaseInvoice, refs: RefResolver, progress?: PushProgress): Promise<string> {
    return this.pushDocument(inv, refs, 1, inv.number, progress);
  }

  // The same lines with negative prices, on the same ledger accounts and tax rates, so the two cancel out. (Moneybird's
  // `revenue_invoice` flag would book a supplier's credit as income instead; confirm in a sandbox administration.)
  async pushCreditNote(original: PurchaseInvoice, _originalExternalId: string, refs: RefResolver, progress?: PushProgress): Promise<string> {
    return this.pushDocument(original, refs, -1, creditRef(original.number), progress);
  }

  // POST documents/purchase_invoices/{id}/payments.json: payment_date and price (required); transaction_identifier is
  // "Used to match the payment with financial mutations", so the Airwallex bank line finds it.
  async pushPayment(p: Payment, refs: RefResolver): Promise<string> {
    this.sameCurrency(`payment ${p.id}`, p.currency);
    const inv = refs.invoice(p.invoiceId);
    if (!inv) throw new ErpError("validation", `invoice ${p.invoiceId} is not in Moneybird yet`);
    const r = await this.post<{ id: string }>(`documents/purchase_invoices/${inv}/payments.json`, { payment: {
      payment_date: p.date, price: toMoney(p.amountCents), transaction_identifier: p.airwallexTransferId ?? `purser-${p.id}`,
    } });
    return r.id;
  }

  // POST documents/general_journal_documents.json: reference, date and entries with ledger_account_id, debit, credit.
  // A journal document has no currency of its own: only the administration's.
  async pushJournalEntry(j: JournalEntry): Promise<string> {
    this.sameCurrency(`journal entry ${j.id}`, j.currency);
    const entries = [];
    for (const l of j.lines) {
      const project = this.projectOf(l.costCentre);
      entries.push({
        ledger_account_id: await this.ledgerId(l.glAccount, "general_journal_document"), description: l.description ?? j.memo,
        debit: toMoney(l.debitCents), credit: toMoney(l.creditCents),
        ...(l.vatCode ? { tax_rate_id: await this.taxId(l.vatCode, "general_journal_document") } : {}), ...(project ? { project_id: project } : {}),
      });
    }
    const r = await this.post<{ id: string }>("documents/general_journal_documents.json", { general_journal_document: { reference: journalRef(j.id), date: j.date, general_journal_document_entries_attributes: entries } });
    return r.id;
  }

  /**
   * An invoice found after a lost answer, with no record of its steps: Moneybird's totals must be the invoice's and its
   * PDF must be there; otherwise it goes to a person (the sync runner keeps it as needs_review), nothing is resent.
   */
  async incomplete(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, externalId: string): Promise<string | null> {
    if (kind !== "invoice") return null;
    const inv = o as PurchaseInvoice;
    const { data } = await this.call("GET", `documents/purchase_invoices/${externalId}.json`);
    const d = data as MbInvoice;
    const missing: string[] = [];
    if (fromMoney(d.total_price_excl_tax) !== inv.totals.netCents || fromMoney(d.total_price_incl_tax) !== inv.totals.grossCents) {
      missing.push(`Moneybird's totals are ${show(d.total_price_excl_tax)} and ${show(d.total_price_incl_tax)}, the invoice's ${toMoney(inv.totals.netCents)} and ${toMoney(inv.totals.grossCents)}`);
    }
    if (inv.pdf && !(d.attachments ?? []).length) missing.push("the PDF is not attached");
    return missing.length ? missing.join("; ") : null;
  }

  /** The supplier's purchase invoices (filter contact_id, no period: "Without period, the filter does not limit the dates"). */
  private invoicesOf(contact: string): Promise<MbInvoice[]> {
    return this.list<MbInvoice>(`documents/purchase_invoices.json?filter=${encodeURIComponent(`contact_id:${contact}`)}`);
  }

  async findExisting(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, refs: RefResolver): Promise<string | null> {
    switch (kind) {
      case "vendor":
        try {
          const { data } = await this.call("GET", `contacts/customer_id/${encodeURIComponent(customerIdOf(o.id))}.json`);
          return (data as { id?: string } | null)?.id ?? null;
        } catch (e) {
          if (e instanceof ErpError && e.kind === "not_found") return null;
          throw e;
        }
      case "invoice": {
        const inv = o as PurchaseInvoice;
        const contact = refs.vendor(inv.vendorId);
        if (!contact) return null;
        // Matched here, not in the filter: a reference may hold the filter's own separators (a comma, a colon).
        return (await this.invoicesOf(contact)).find((x) => x.reference === inv.number)?.id ?? null;
      }
      case "payment": {
        const p = o as Payment;
        const inv = refs.invoice(p.invoiceId);
        if (!inv) return null;
        const { data } = await this.call("GET", `documents/purchase_invoices/${inv}.json`);
        const want = p.airwallexTransferId ?? `purser-${p.id}`;
        return (data as MbInvoice).payments?.find((x) => x.transaction_identifier === want)?.id ?? null;
      }
      case "journal": {
        const ref = journalRef(o.id);
        const filter = /[,:]/.test(ref) ? "" : `?filter=${encodeURIComponent(`reference:${ref}`)}`;
        const rows = await this.list<{ id: string; reference: string | null }>(`documents/general_journal_documents.json${filter}`);
        return rows.find((x) => x.reference === ref)?.id ?? null;
      }
    }
  }

  // GET documents/purchase_invoices/{id}.json: state is new, saved, open, late, pending_payment or paid; payments lists what was registered.
  async pullPaymentStatus(_inv: PurchaseInvoice, invoiceExternalId: string, _refs?: RefResolver): Promise<PaymentStatus> {
    const { data } = await this.call("GET", `documents/purchase_invoices/${invoiceExternalId}.json`);
    const d = data as MbInvoice;
    if (d.state === "paid") return "paid";
    const paid = (d.payments ?? []).reduce((s, x) => s + (fromMoney(x.price) ?? 0), 0);
    return paid > 0 ? "partial" : "unpaid";
  }
}

/** The connector's settings from the environment (names only in errors, never values). */
export function moneybirdConfigFromEnv(env: Record<string, string | undefined>): MoneybirdConfig {
  const need = (n: string) => { const v = env[n]; if (!v) throw new ErpError("config", `${n} is not set`); return v; };
  const map = (n: string, optional: boolean): Record<string, string> => {
    const raw = env[n];
    if (!raw) { if (optional) return {}; throw new ErpError("config", `${n} is not set`); }
    let o: unknown;
    try { o = JSON.parse(raw); } catch { throw new ErpError("config", `${n} must be a JSON object, like {"NL21":"458026356994737217"}`); }
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new ErpError("config", `${n} must be a JSON object`);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const s = String(v);
      if (!ID.test(s)) throw new ErpError("config", `${n}: ${k} must be a Moneybird id (digits only)`);
      out[k] = s;
    }
    return out;
  };
  const admin = need("ERP_MONEYBIRD_ADMINISTRATION_ID");
  if (!ID.test(admin)) throw new ErpError("config", "ERP_MONEYBIRD_ADMINISTRATION_ID must be the administration's number (digits only)");
  const baseUrl = env.ERP_MONEYBIRD_BASE_URL ?? MONEYBIRD_BASE_URL;
  // The sandbox guard is on or off: a value that only looks like "on" is refused, never read as off.
  const guard = env.ERP_MONEYBIRD_SANDBOX_ONLY ?? "off";
  if (guard !== "on" && guard !== "off") throw new ErpError("config", "ERP_MONEYBIRD_SANDBOX_ONLY must be on or off");
  if (guard === "on" && admin !== MONEYBIRD_SANDBOX_ADMINISTRATION) {
    throw new ErpError("config", `ERP_MONEYBIRD_SANDBOX_ONLY is on: only the sandbox administration ${MONEYBIRD_SANDBOX_ADMINISTRATION} may be called, and ERP_MONEYBIRD_ADMINISTRATION_ID names another one; nothing was called`);
  }
  if (guard === "on" && baseUrl !== MONEYBIRD_BASE_URL) {
    throw new ErpError("config", `ERP_MONEYBIRD_SANDBOX_ONLY is on: only ${MONEYBIRD_BASE_URL} may be called, and ERP_MONEYBIRD_BASE_URL names another address; nothing was called`);
  }
  // Not needed to read (a pull lists the tax rates this map is made from); sending refuses a VAT treatment without one.
  const taxRates = map("ERP_MONEYBIRD_TAX_RATES", true);
  for (const k of Object.keys(taxRates)) if (!(VAT_CODES as readonly string[]).includes(k)) throw new ErpError("config", `ERP_MONEYBIRD_TAX_RATES: ${k} is not one of Purser's VAT treatments (${VAT_CODES.join(", ")})`);
  const base = env.ERP_MONEYBIRD_BASE_CURRENCY ?? "EUR";
  if (!/^[A-Z]{3}$/.test(base)) throw new ErpError("config", "ERP_MONEYBIRD_BASE_CURRENCY must be a three-letter currency code");
  return {
    baseUrl, administrationId: admin, baseCurrency: base,
    taxRates: taxRates as Partial<Record<VatCode, string>>, glMap: map("ERP_MONEYBIRD_GL_MAP", true), projects: map("ERP_MONEYBIRD_PROJECTS", true),
    ignoreCostCentres: env.ERP_MONEYBIRD_IGNORE_COST_CENTRES === "on", sandboxOnly: guard === "on",
  };
}
