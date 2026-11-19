// A local mock of a provider's REST API for the workplace integrations (src/workplace): a fetch that answers by method
// and path, records every request (method, URL, headers, body) so a test can hold the request's shape to the provider's
// documentation, and never leaves this process. The answers are shaped as each provider's reference shows them; each
// test cites the page.

export interface Recorded { method: string; url: URL; headers: Record<string, string>; body: string | null }
type Answer = Response | { status?: number; json?: unknown; bytes?: Uint8Array; text?: string; headers?: Record<string, string> };
type Handler = (req: Recorded, match: RegExpExecArray) => Answer | Promise<Answer>;

export class MockApi {
  readonly calls: Recorded[] = [];
  private readonly routes: { method: string; re: RegExp; handler: Handler }[] = [];

  constructor(readonly origin: string) {}

  /** `path` is matched against the URL's pathname (not the query), from its start to its end. */
  on(method: string, path: RegExp, handler: Handler): this {
    this.routes.push({ method, re: new RegExp(`^${path.source}$`), handler });
    return this;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    const body = init?.body === undefined || init.body === null ? null : typeof init.body === "string" ? init.body : String(init.body);
    const req: Recorded = { method: init?.method ?? "GET", url, headers, body };
    this.calls.push(req);
    if (url.origin !== this.origin) return new Response(JSON.stringify({ error: { message: `no such host in the mock: ${url.origin}` } }), { status: 599 });
    for (const r of this.routes) {
      const m = r.method === req.method ? r.re.exec(decodeURIComponent(url.pathname)) : null;
      if (!m) continue;
      const a = await r.handler(req, m);
      if (a instanceof Response) return a;
      const status = a.status ?? 200;
      if (a.bytes) return new Response(new Uint8Array(a.bytes), { status, headers: { "content-type": "application/octet-stream", ...(a.headers ?? {}) } });
      if (a.text !== undefined) return new Response(a.text, { status, headers: a.headers ?? {} });
      return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status, headers: { "content-type": "application/json", ...(a.headers ?? {}) } });
    }
    return new Response(JSON.stringify({ error: { code: 404, message: `no route in the mock for ${req.method} ${url.pathname}` } }), { status: 404 });
  };

  /** The requests to a path, in order. */
  to(method: string, path: RegExp): Recorded[] {
    return this.calls.filter((c) => c.method === method && path.test(decodeURIComponent(c.url.pathname)));
  }
}

/** base64url, as Gmail sends a MessagePartBody's data. */
export const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A UBL 2.1 invoice (Peppol BIS Billing 3.0 shape) with the given PDF embedded as base64, or none. */
export function ublInvoice(o: { id: string; supplier: string; payable: string; pdf?: Uint8Array; root?: "Invoice" | "CreditNote"; extra?: string }): Buffer {
  const root = o.root ?? "Invoice";
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ID>${o.id}</cbc:ID>
  <cbc:IssueDate>2026-11-02</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>${o.extra ?? ""}
  ${o.pdf ? `<cac:AdditionalDocumentReference>
    <cbc:ID>${o.id}</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="${o.id}.pdf">${Buffer.from(o.pdf).toString("base64").replace(/(.{76})/g, "$1\n")}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>` : ""}
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${o.supplier}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">${o.payable}</cbc:PayableAmount></cac:LegalMonetaryTotal>
</${root}>
`, "utf8");
}
