// Purser's TypeScript client (sdk/typescript/README.md): read the books, propose an invoice's payment, read a proposal's
// status. No dependency: the platform's fetch. Its operations are those of openapi/purser.yaml (test/sdk-typescript.test.ts
// checks every one against the document).
//
// What it cannot do, on purpose: approve. Approving a payment is a signed-in person's passkey over the exact terms, in
// Purser Cloud; the API refuses every key there, and this client has no method for it.

/** A supplier invoice as the company's records hold it (OpenAPI: Invoice). */
export interface Invoice {
  id: string;
  version: number;
  vendor?: string;
  invoice_no?: string;
  due_date?: string;
  currency?: string;
  total?: string;
  status?: string;
  [field: string]: unknown;
}
export interface InvoiceDetail extends Invoice { earlier_versions?: { version: number; replaced_at: string }[] }
export interface InvoicePage { items: Invoice[]; next_cursor: string | null }

/** A payment proposal: the exact terms the CFO's passkey signs (OpenAPI: Proposal). */
export interface Proposal {
  id: string;
  kind: string;
  /** PENDING_APPROVAL waits for the CFO; APPROVED, EXECUTED, FAILED, REJECTED or EXPIRED after. */
  status: string;
  terms_sha256: string;
  challenge?: string;
  facts?: [string, string][];
  warnings?: string[];
  [field: string]: unknown;
}
/** What filing a proposal answers (OpenAPI: ProposeAnswer). `alone` only when a pay-alone limit the CFO set covered it. */
export interface ProposeAnswer { proposal: Proposal; alone?: Record<string, unknown>; settled?: Record<string, unknown> | null; [field: string]: unknown }

/** An invoice as the company's engine sees it (OpenAPI: EngineInvoice). */
export interface PayableInvoice {
  id: string; status: string; status_words?: string; payable: boolean; vendor: string; invoice_no?: string; currency: string; total: string; due_date?: string;
  findings?: { level: string; code: string; message: string }[];
  proposal: Proposal | null;
  [field: string]: unknown;
}

export type Scope = "read" | "sync" | "admin" | "propose";
export interface Me { tenant: { id: string; slug?: string; name?: string; language?: string }; kind: "key" | "session"; scopes: Scope[]; role: string | null; [field: string]: unknown }

/** The operations this client calls, by OpenAPI operationId: [method, path]. */
export const OPERATIONS = {
  getMe: ["GET", "/v1/me"],
  listInvoices: ["GET", "/v1/invoices"],
  getInvoice: ["GET", "/v1/invoices/{id}"],
  listPayableInvoices: ["GET", "/v1/engine/invoices"],
  proposePayment: ["POST", "/v1/engine/invoices/{id}/pay"],
  getProposal: ["GET", "/v1/engine/proposals/{id}"],
} as const;
export type OperationId = keyof typeof OPERATIONS;

/** An answer that was not 2xx: the API's sentence for a person and its stable code for a program. */
export class PurserError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "PurserError";
  }
}

export interface PurserOptions {
  /** Your Purser Cloud, like https://purser.example.com (https; http only for localhost). */
  baseUrl: string;
  /** An API key (pck_…) from the environment, never from code. read to read; read and propose to file payments. */
  apiKey: string;
  /** Another fetch (a test's, a proxy's); the platform's by default. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface ListInvoicesQuery { status?: string; dueFrom?: string; dueTo?: string; limit?: number; cursor?: string }

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export class Purser {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(o: PurserOptions) {
    const url = new URL(o.baseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL.has(url.hostname))) throw new Error("baseUrl must be https (http only for localhost)");
    if (!o.apiKey) throw new Error("apiKey is empty: read it from the environment (PURSER_API_KEY)");
    this.#base = url.origin;
    this.#key = o.apiKey;
    this.#fetch = o.fetch ?? ((i, init) => fetch(i, init));
  }

  /** A client from PURSER_URL and PURSER_API_KEY. */
  static fromEnv(env: Record<string, string | undefined> = process.env): Purser {
    return new Purser({ baseUrl: env.PURSER_URL ?? "", apiKey: env.PURSER_API_KEY ?? "" });
  }

  async #call<T>(op: OperationId, id?: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const [method, path] = OPERATIONS[op];
    if (path.includes("{id}") && !(id && ID.test(id))) throw new Error(`${op} needs an id like AP-0004 or P-0009`);
    const qs = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string | number] => e[1] !== undefined).map(([k, v]) => [k, String(v)]));
    const search = qs.toString();
    const url = `${this.#base}${path.replace("{id}", encodeURIComponent(id ?? ""))}${search ? `?${search}` : ""}`;
    const res = await this.#fetch(url, { method, headers: { authorization: `Bearer ${this.#key}`, accept: "application/json" } });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: said below */ }
    if (!res.ok) {
      const e = (body ?? {}) as { error?: string; code?: string };
      throw new PurserError(res.status, e.code ?? "error", e.error ?? `HTTP ${res.status}`);
    }
    if (body === null) throw new PurserError(res.status, "not_json", "the answer was not JSON");
    return body as T;
  }

  /** Who is calling: the company and this key's scopes. */
  me(): Promise<Me> { return this.#call("getMe"); }

  /** One page of supplier invoices; next_cursor fetches the next. */
  listInvoices(q: ListInvoicesQuery = {}): Promise<InvoicePage> {
    return this.#call("listInvoices", undefined, { status: q.status, due_from: q.dueFrom, due_to: q.dueTo, limit: q.limit, cursor: q.cursor });
  }

  /** Every invoice that matches, page by page. */
  async *invoices(q: Omit<ListInvoicesQuery, "cursor"> = {}): AsyncGenerator<Invoice> {
    let cursor: string | undefined;
    do {
      const page = await this.listInvoices({ ...q, ...(cursor ? { cursor } : {}) });
      yield* page.items;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  getInvoice(id: string): Promise<InvoiceDetail> { return this.#call("getInvoice", id); }

  /** The engine's invoices: whether each can be proposed (payable) and its proposal, if one was filed. */
  async listPayableInvoices(): Promise<PayableInvoice[]> {
    return (await this.#call<{ items: PayableInvoice[] }>("listPayableInvoices")).items;
  }

  /**
   * File an invoice's payment for the CFO's approval (a key with the propose scope). Nothing is paid until the CFO signs
   * these exact terms with their passkey in Purser Cloud. A 409 PurserError says why Purser would not file it.
   */
  proposePayment(invoiceId: string): Promise<ProposeAnswer> { return this.#call("proposePayment", invoiceId); }

  /** Where a proposal stands: PENDING_APPROVAL until the CFO's passkey, then APPROVED and EXECUTED, or REJECTED or EXPIRED. */
  async getProposal(id: string): Promise<Proposal> {
    return (await this.#call<{ proposal: Proposal }>("getProposal", id)).proposal;
  }
}
