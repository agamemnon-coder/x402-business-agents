// A stand-in Moneybird administration for the connector's tests. No network: it answers through the connectors'
// RecordingTransport. Every JSON request body is checked against Moneybird's own request schema for that endpoint
// (test/fixtures/moneybird/openapi-subset.json, extracted from Moneybird's official OpenAPI file), so a field name the
// connector made up, or an amount in the wrong shape, is answered with 400 as Moneybird would refuse it. Answers follow
// the shapes in that OpenAPI file: ids as large integers, money as decimal strings, errors as {"error", "symbolic"}.
// Test money only; nothing here is a real administration.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ErpError, RecordingTransport, type HttpRequest, type HttpResponse } from "../../src/erp/connector.js";

type Schema = Record<string, unknown>;
const SUBSET = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/moneybird/openapi-subset.json"), "utf8")) as {
  _source: { version: string };
  requests: Record<string, { contentType: string; schema: Schema }>;
};
export const OPENAPI_VERSION = SUBSET._source.version;

/** A small JSON Schema check, enough for the keywords Moneybird's request schemas use. Returns what is wrong. */
export function schemaErrors(s: Schema, v: unknown, at = "$"): string[] {
  const errs: string[] = [];
  const types = s.type === undefined ? null : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  const typeOf = (x: unknown) => (x === null ? "null" : Array.isArray(x) ? "array" : Number.isInteger(x) ? "integer" : typeof x);
  if (types) {
    const t = typeOf(v);
    const ok = types.some((want) => want === t || (want === "number" && t === "integer"));
    if (!ok) return [`${at}: is ${t}, schema wants ${types.join("|")}`];
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const alts = s[key] as Schema[] | undefined;
    if (alts) {
      const passing = alts.filter((a) => schemaErrors(a, v, at).length === 0).length;
      if (key === "oneOf" ? passing !== 1 : passing === 0) errs.push(`${at}: matches ${passing} of the ${key} alternatives`);
    }
  }
  for (const a of (s.allOf as Schema[] | undefined) ?? []) errs.push(...schemaErrors(a, v, at));
  if (typeof v === "string") {
    if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(v)) errs.push(`${at}: ${JSON.stringify(v)} does not match ${s.pattern}`);
    if (s.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push(`${at}: ${JSON.stringify(v)} is not a date`);
    if (Array.isArray(s.enum) && !s.enum.includes(v)) errs.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.join(", ")}`);
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) errs.push(`${at}: below ${s.minimum}`);
    if (typeof s.maximum === "number" && v > s.maximum) errs.push(`${at}: above ${s.maximum}`);
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => errs.push(...schemaErrors(s.items as Schema, x, `${at}[${i}]`)));
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const props = (s.properties as Record<string, Schema> | undefined) ?? {};
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in v)) errs.push(`${at}.${r}: required`);
    for (const [k, x] of Object.entries(v)) {
      if (props[k]) errs.push(...schemaErrors(props[k]!, x, `${at}.${k}`));
      else if (s.additionalProperties && typeof s.additionalProperties === "object") errs.push(...schemaErrors(s.additionalProperties as Schema, x, `${at}.${k}`));
      else if (s.unevaluatedProperties === false || s.additionalProperties === false) errs.push(`${at}.${k}: not a field Moneybird knows`);
    }
  }
  return errs;
}

/** Money as Moneybird writes it ("1428.0", "12.5", "-3.21"), from whole cents. */
const money = (cents: number) => {
  const s = (Math.abs(cents) / 100).toString();
  return `${cents < 0 ? "-" : ""}${s.includes(".") ? s : `${s}.0`}`;
};
/** Cents from a request's money (a number, "10.95" or "10,95"). */
const centsOf = (m: unknown): number => {
  const s = String(m).replace(",", ".");
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  if (frac.length > 2) throw new Error(`more than two decimals: ${s}`);
  const c = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -c : c;
};

let seq = 458026356994737200n;
/** A Moneybird id: a large integer, as its OpenAPI file shows them (beyond 2^53, so a float would lose digits). */
const nextId = () => (seq += 7n).toString();

export interface LedgerAccount { id: string; account_id: string | null; name: string; account_type: string; allowed_document_types: string[]; active: boolean }
export interface TaxRate { id: string; name: string; percentage: string; tax_rate_type: string; active: boolean }
interface Contact { id: string; company_name: string; customer_id: string; tax_number: string | null; bank_account: string | null; country: string | null }
interface Detail { id: string; description: string; price: string; amount: string; tax_rate_id: string; ledger_account_id: string; project_id: string | null; total_price_excl_tax_with_discount: string }
interface Invoice {
  id: string; contact_id: string; reference: string; date: string; due_date: string; currency: string; state: string;
  total_price_excl_tax: string; total_price_incl_tax: string; details: Detail[]; payments: Payment[]; attachments: { id: string; filename: string; size: number }[];
}
interface Payment { id: string; invoice_id: string; payment_date: string; price: string; transaction_identifier: string | null }
interface Journal { id: string; reference: string; date: string; entries: { ledger_account_id: string; debit: string; credit: string; description: string }[] }

export const LEDGER: LedgerAccount[] = [
  { id: "458026356994737101", account_id: "6200", name: "Inkoop", account_type: "direct_costs", allowed_document_types: ["purchase_invoice", "general_journal_document"], active: true },
  { id: "458026356994737102", account_id: "6900", name: "Overige kosten", account_type: "expenses", allowed_document_types: ["purchase_invoice", "general_journal_document"], active: true },
  { id: "458026356994737103", account_id: "6800", name: "Bankkosten", account_type: "expenses", allowed_document_types: ["purchase_invoice", "general_journal_document"], active: true },
  { id: "458026356994737104", account_id: "1200", name: "Airwallex EUR", account_type: "current_assets", allowed_document_types: ["general_journal_document"], active: true },
  { id: "458026356994737105", account_id: null, name: "Software", account_type: "expenses", allowed_document_types: ["purchase_invoice"], active: true },
];
export const TAX: TaxRate[] = [
  { id: "458026356994737121", name: "21% btw", percentage: "21.0", tax_rate_type: "purchase_invoice", active: true },
  { id: "458026356994737109", name: "9% btw", percentage: "9.0", tax_rate_type: "purchase_invoice", active: true },
  { id: "458026356994737100", name: "0% btw", percentage: "0.0", tax_rate_type: "purchase_invoice", active: true },
  { id: "458026356994737199", name: "21% btw verkoop", percentage: "21.0", tax_rate_type: "sales_invoice", active: true },
];

/** What the next matching request is answered with instead of the normal answer (a 429, a 500, a dropped line). */
interface Planned { when: (req: HttpRequest) => boolean; answer: HttpResponse | "drop-after-doing" }

export class FakeMoneybird {
  readonly admin = "123456789012345678";
  readonly base = `https://moneybird.com/api/v2/${this.admin}`;
  readonly token = "test-token";
  readonly contacts = new Map<string, Contact>();
  readonly invoices = new Map<string, Invoice>();
  readonly journals = new Map<string, Journal>();
  readonly attachments: { invoiceId: string; filename: string; contentType: string; bytes: Uint8Array }[] = [];
  readonly refused: { path: string; errors: string[] }[] = [];
  private planned: Planned[] = [];
  /** VAT per detail, the way this stand-in computes it (whole cents, half up); a test may override. */
  vatOf = (netCents: number, pct: number) => Math.round((netCents * pct) / 100);
  readonly transport = new RecordingTransport((req) => this.handle(req));

  /** The next request that matches gets `answer` (or is done and its answer lost). */
  plan(when: (req: HttpRequest) => boolean, answer: HttpResponse | "drop-after-doing") { this.planned.push({ when, answer }); }
  posts(pathPart?: string) { return this.transport.sent.filter((r) => r.method === "POST" && (!pathPart || this.path(r).startsWith(pathPart))); }
  path(r: HttpRequest) { return new URL(r.url).pathname.slice(`/api/v2/${this.admin}`.length); }

  private json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
    // Ids go out as bare large integers, as in Moneybird's OpenAPI examples for administration ids: the connector must
    // read them as strings, never as floats.
    const text = JSON.stringify(body).replace(/"(id|[a-z_]+_id)":"(\d{16,})"/g, '"$1":$2');
    return { status, headers: { "content-type": "application/json", ...headers }, body: text };
  }
  private error(status: number, error: string) { return this.json(status, { error, symbolic: {} }); }

  private check(key: string, body: unknown): string[] {
    const r = SUBSET.requests[key];
    if (!r) throw new Error(`the fake has no schema for ${key}`);
    return schemaErrors(r.schema, body);
  }

  private invoiceView(inv: Invoice) {
    return { ...inv, administration_id: Number(this.admin), contact: { id: inv.contact_id }, prices_are_incl_tax: false, revenue_invoice: false };
  }

  private async handle(req: HttpRequest): Promise<HttpResponse> {
    const i = this.planned.findIndex((p) => p.when(req));
    let drop = false;
    if (i >= 0) {
      const [p] = this.planned.splice(i, 1);
      if (p!.answer === "drop-after-doing") drop = true;
      else return p!.answer;
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) return this.json(401, { error: "access token revoked", symbolic: { request: "invalid_grant" } });
    const answer = this.route(req);
    // What the live transport throws when the answer never arrives (src/erp/connector.ts fetchTransport).
    if (drop) throw new ErpError("network", `${req.method} ${req.url}: the connection dropped before the answer came`, { retryable: true });
    return answer;
  }

  private body(req: HttpRequest): Record<string, unknown> {
    if (req.headers["content-type"] !== "application/json") throw new Error(`expected JSON, got ${req.headers["content-type"]}`);
    return JSON.parse(req.body as string) as Record<string, unknown>;
  }

  private route(req: HttpRequest): HttpResponse {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(`/api/v2/${this.admin}/`)) return this.error(404, "administration not found");
    const path = this.path(req);
    if (!path.endsWith(".json")) return this.error(406, "format not supported");
    const p = path.slice(0, -".json".length);
    const q = url.searchParams;
    const page = Number(q.get("page") ?? 1);
    const per = Math.min(Number(q.get("per_page") ?? 50), 100);
    const paged = <T>(all: T[]) => {
      const slice = all.slice((page - 1) * per, page * per);
      const more = page * per < all.length;
      const next = new URL(req.url);
      next.searchParams.set("page", String(page + 1));
      return this.json(200, slice, more ? { link: `<${next.toString()}>; rel="next"` } : {});
    };

    if (req.method === "GET" && p === "/ledger_accounts") return this.json(200, LEDGER.map((l) => ({ ...l, administration_id: Number(this.admin), parent_id: null })));
    if (req.method === "GET" && p === "/tax_rates") return paged(TAX.map((t) => ({ ...t, administration_id: Number(this.admin), show_tax: true, country: null })));
    if (req.method === "GET" && p === "/contacts") return paged([...this.contacts.values()]);
    const byCustomer = /^\/contacts\/customer_id\/(.+)$/.exec(p);
    if (req.method === "GET" && byCustomer) {
      const c = [...this.contacts.values()].find((x) => x.customer_id === decodeURIComponent(byCustomer[1]!));
      return c ? this.json(200, c) : this.error(404, "record not found");
    }
    if (req.method === "POST" && p === "/contacts") {
      const b = this.body(req);
      const errs = this.check("POST /{administration_id}/contacts{format}", b);
      const c = b.contact as Record<string, string> | undefined;
      if (!errs.length && !c?.company_name && !c?.firstname && !c?.lastname) errs.push("contact: needs company_name or a name");
      if (!errs.length && c?.customer_id && [...this.contacts.values()].some((x) => x.customer_id === c.customer_id)) return this.json(422, { error: { customer_id: ["has already been taken"] }, details: { customer_id: [{ error: "taken" }] } });
      if (errs.length) { this.refused.push({ path: p, errors: errs }); return this.json(400, { error: errs.join("; "), symbolic: {} }); }
      const contact: Contact = { id: nextId(), company_name: c!.company_name ?? "", customer_id: c!.customer_id ?? nextId(), tax_number: c!.tax_number ?? null, bank_account: c!.bank_account ?? null, country: c!.country ?? null };
      this.contacts.set(contact.id, contact);
      return this.json(201, contact);
    }
    if (req.method === "GET" && p === "/documents/purchase_invoices") {
      const f = Object.fromEntries((q.get("filter") ?? "").split(",").filter(Boolean).map((t) => [t.slice(0, t.indexOf(":")), t.slice(t.indexOf(":") + 1)]));
      // Without a filter Moneybird lists this year only; with one, only what the filter says.
      const all = [...this.invoices.values()].filter((x) => (!f.contact_id || x.contact_id === f.contact_id) && (!f.reference || x.reference === f.reference) && (q.get("filter") ? true : x.date.startsWith("2026")));
      return paged(all.map((x) => this.invoiceView(x)));
    }
    if (req.method === "POST" && p === "/documents/purchase_invoices") {
      const b = this.body(req);
      const errs = this.check("POST /{administration_id}/documents/purchase_invoices{format}", b);
      if (errs.length) { this.refused.push({ path: p, errors: errs }); return this.json(400, { error: errs.join("; "), symbolic: {} }); }
      const pi = b.purchase_invoice as Record<string, unknown>;
      if (!this.contacts.has(String(pi.contact_id))) return this.json(422, { error: { contact_id: ["is invalid"] }, details: { contact_id: [{ error: "invalid" }] } });
      const rows = Array.isArray(pi.details_attributes) ? (pi.details_attributes as Record<string, unknown>[]) : Object.values((pi.details_attributes ?? {}) as Record<string, Record<string, unknown>>);
      let net = 0;
      let vat = 0;
      const details: Detail[] = [];
      for (const d of rows) {
        const led = LEDGER.find((l) => l.id === String(d.ledger_account_id));
        const tax = TAX.find((t) => t.id === String(d.tax_rate_id));
        if (!led || !led.allowed_document_types.includes("purchase_invoice")) return this.json(422, { error: { "details.ledger_account_id": ["is invalid"] } });
        if (!tax || tax.tax_rate_type !== "purchase_invoice") return this.json(422, { error: { "details.tax_rate_id": ["is invalid"] } });
        const qty = Number(d.amount ?? 1);
        const lineNet = centsOf(d.price) * qty;
        net += lineNet;
        vat += this.vatOf(lineNet, Number(tax.percentage));
        details.push({ id: nextId(), description: String(d.description ?? ""), price: money(centsOf(d.price)), amount: String(qty), tax_rate_id: tax.id, ledger_account_id: led.id, project_id: d.project_id ? String(d.project_id) : null, total_price_excl_tax_with_discount: money(lineNet) });
      }
      const inv: Invoice = {
        id: nextId(), contact_id: String(pi.contact_id), reference: String(pi.reference ?? ""), date: String(pi.date), due_date: String(pi.due_date ?? ""),
        currency: String(pi.currency ?? "EUR"), state: "open", total_price_excl_tax: money(net), total_price_incl_tax: money(net + vat), details, payments: [], attachments: [],
      };
      this.invoices.set(inv.id, inv);
      return this.json(201, this.invoiceView(inv));
    }
    const one = /^\/documents\/purchase_invoices\/(\d+)(\/payments|\/attachments)?$/.exec(p);
    if (one) {
      const inv = this.invoices.get(one[1]!);
      if (!inv) return this.error(404, "record not found");
      if (req.method === "GET" && !one[2]) return this.json(200, this.invoiceView(inv));
      if (req.method === "POST" && one[2] === "/payments") {
        const b = this.body(req);
        const errs = this.check("POST /{administration_id}/documents/purchase_invoices/{id}/payments{format}", b);
        if (errs.length) { this.refused.push({ path: p, errors: errs }); return this.json(400, { error: errs.join("; "), symbolic: {} }); }
        const pay = b.payment as Record<string, unknown>;
        const payment: Payment = { id: nextId(), invoice_id: inv.id, payment_date: String(pay.payment_date), price: money(centsOf(pay.price)), transaction_identifier: (pay.transaction_identifier as string | undefined) ?? null };
        inv.payments.push(payment);
        const paid = inv.payments.reduce((s, x) => s + centsOf(x.price), 0);
        inv.state = paid >= centsOf(inv.total_price_incl_tax) ? "paid" : "open";
        return this.json(201, { ...payment, administration_id: Number(this.admin), invoice_type: "Document" });
      }
      if (req.method === "POST" && one[2] === "/attachments") {
        const ct = req.headers["content-type"] ?? "";
        const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(ct)?.[1];
        if (!boundary || !(req.body instanceof Uint8Array)) return this.error(400, "not multipart/form-data");
        const raw = Buffer.from(req.body);
        const text = raw.toString("latin1");
        const head = new RegExp(`^--${boundary}\\r\\nContent-Disposition: form-data; name="file"; filename="([^"\\r\\n]+)"\\r\\nContent-Type: ([^\\r\\n]+)\\r\\n\\r\\n`).exec(text);
        const tail = `\r\n--${boundary}--\r\n`;
        if (!head || !text.endsWith(tail)) return this.error(400, "the file part is missing or malformed");
        const bytes = new Uint8Array(raw.subarray(head[0].length, raw.length - tail.length));
        this.attachments.push({ invoiceId: inv.id, filename: head[1]!, contentType: head[2]!, bytes });
        inv.attachments.push({ id: nextId(), filename: head[1]!, size: bytes.length });
        return { status: 200, headers: { "content-type": "application/json" }, body: "200" };
      }
    }
    if (req.method === "GET" && p === "/documents/general_journal_documents") {
      const ref = /(?:^|,)reference:([^,]*)/.exec(q.get("filter") ?? "")?.[1];
      return paged([...this.journals.values()].filter((j) => ref === undefined || j.reference === ref));
    }
    if (req.method === "POST" && p === "/documents/general_journal_documents") {
      const b = this.body(req);
      const errs = this.check("POST /{administration_id}/documents/general_journal_documents{format}", b);
      if (errs.length) { this.refused.push({ path: p, errors: errs }); return this.json(400, { error: errs.join("; "), symbolic: {} }); }
      const g = b.general_journal_document as Record<string, unknown>;
      const entries = (g.general_journal_document_entries_attributes as Record<string, unknown>[]).map((e) => ({ ledger_account_id: String(e.ledger_account_id), debit: String(e.debit ?? "0"), credit: String(e.credit ?? "0"), description: String(e.description ?? "") }));
      const d = entries.reduce((s, e) => s + centsOf(e.debit), 0);
      const c = entries.reduce((s, e) => s + centsOf(e.credit), 0);
      if (d !== c) return this.json(422, { error: { base: ["debit and credit are not equal"] } });
      const j: Journal = { id: nextId(), reference: String(g.reference ?? ""), date: String(g.date ?? ""), entries };
      this.journals.set(j.id, j);
      return this.json(201, j);
    }
    return this.error(405, `${req.method} ${p} is not available in this stand-in`);
  }
}
