// The ERP connector interface (ERP connectors design, 8 November) and the plumbing every connector shares: one HTTP
// transport (fetch, or a recording one for dry runs and tests), errors mapped to a few kinds the sync runner can act
// on, and redaction so a request can be printed without its credentials.

import type { JournalEntry, ObjectKind, Payment, PurchaseInvoice, Vendor } from "./model.js";

export const CONNECTOR_NAMES = ["exact", "bc", "odoo"] as const;
export type ConnectorName = (typeof CONNECTOR_NAMES)[number];

export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: Record<string, string>;
  /** JSON, a form, an XML-RPC call, or a file's bytes (an attachment's content). */
  body?: string | Uint8Array;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface Transport {
  send(req: HttpRequest): Promise<HttpResponse>;
}

/** The live transport: global fetch with a time limit. A network failure throws ErpError("network"). */
export function fetchTransport(timeoutMs = 30_000): Transport {
  return {
    async send(req) {
      let res: Response;
      try {
        // Bytes go as their own ArrayBuffer (a copy), which fetch takes as a body.
        const body = req.body instanceof Uint8Array ? new Uint8Array(req.body).buffer : req.body;
        res = await fetch(req.url, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new ErpError("network", `${req.method} ${redactUrl(req.url)}: ${(e as Error).message}`, { retryable: true });
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      return { status: res.status, headers, body: await res.text() };
    },
  };
}

/**
 * A transport that sends nothing: it records each request and answers with what `answer` returns (a connector's
 * plausible dry-run answer, or a test's scripted one). The sync runner's --dry-run and every contract test use it.
 */
export class RecordingTransport implements Transport {
  readonly sent: HttpRequest[] = [];
  constructor(private readonly answer: (req: HttpRequest, n: number) => HttpResponse | Promise<HttpResponse>) {}
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.sent.push(req);
    return this.answer(req, this.sent.length);
  }
}

/** needs_review: the ERP now holds the object, but in a state a person must look at (a draft whose total differs);
 *  the sync runner keeps it with that person and never clears it by itself. */
export type ErpErrorKind = "auth" | "rate_limited" | "validation" | "not_found" | "conflict" | "server" | "network" | "config" | "unexpected" | "needs_review";

export class ErpError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly status: number | undefined;
  /** needs_review: the ERP's id of the object left for a person. */
  readonly externalId: string | undefined;
  constructor(readonly kind: ErpErrorKind, message: string, o: { retryable?: boolean; retryAfterMs?: number; status?: number; externalId?: string } = {}) {
    super(message);
    this.name = "ErpError";
    this.retryable = o.retryable ?? false;
    this.retryAfterMs = o.retryAfterMs;
    this.status = o.status;
    this.externalId = o.externalId;
  }
  /** True when the ERP may have done what was asked although no answer came back: look before trying again. */
  get ambiguous(): boolean {
    return this.kind === "network" || (this.kind === "server" && this.status !== 503);
  }
}

/** Retry-After as seconds or an HTTP date, in milliseconds; undefined when absent or unreadable. */
export function retryAfterMs(h: Record<string, string>, now = Date.now()): number | undefined {
  const v = h["retry-after"];
  if (!v) return undefined;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

/** The error an HTTP status means, with the ERP's own message (`detail`) when it gave one. */
export function errorForStatus(status: number, headers: Record<string, string>, where: string, detail: string): ErpError {
  const msg = `${where}: HTTP ${status}${detail ? `: ${detail}` : ""}`;
  if (status === 401 || status === 403) return new ErpError("auth", msg, { status });
  if (status === 404) return new ErpError("not_found", msg, { status });
  if (status === 409 || status === 412) return new ErpError("conflict", msg, { status });
  if (status === 429) return new ErpError("rate_limited", msg, { status, retryable: true, ...(retryAfterMs(headers) !== undefined ? { retryAfterMs: retryAfterMs(headers)! } : {}) });
  if (status >= 500) return new ErpError("server", msg, { status, retryable: true, ...(retryAfterMs(headers) !== undefined ? { retryAfterMs: retryAfterMs(headers)! } : {}) });
  return new ErpError("validation", msg, { status });
}

const SECRET_KEYS = /^(authorization|cookie|x-api-key|api[-_]?key|password|client_secret|refresh_token|access_token|code)$/i;

/** A URL with secret-looking query values replaced. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_KEYS.test(k)) u.searchParams.set(k, "[redacted]");
    return u.toString();
  } catch {
    return url;
  }
}

/** A request fit to print: credentials, tokens, IBANs and file contents replaced. */
export function redactRequest(req: HttpRequest): HttpRequest {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : v]));
  let body = req.body;
  if (body instanceof Uint8Array) body = `[${body.length} bytes]`;
  else if (body !== undefined) {
    body = body
      .replace(/([A-Z]{2}\d{2}[A-Z0-9]{10,30})/g, (iban) => `${iban.slice(0, 4)}…${iban.slice(-4)}`)
      .replace(/("(?:Attachment|attachmentContent|datas|password|client_secret|refresh_token)"\s*:\s*)"[^"]*"/g, '$1"[redacted]"')
      .replace(/(<string>)([A-Za-z0-9+/=]{200,})(<\/string>)/g, "$1[base64 redacted]$3")
      .replace(/(client_secret|refresh_token|code)=[^&]*/g, "$1=[redacted]");
    // An Odoo call carries the API key as the third parameter of execute_kw / authenticate.
    body = body.replace(/(<methodName>(?:execute_kw|authenticate)<\/methodName>\s*<params>(?:\s*<param>[\s\S]*?<\/param>){2}\s*<param>\s*<value>\s*<string>)[^<]*(<\/string>)/, "$1[redacted]$2");
  }
  return { ...req, url: redactUrl(req.url), headers, ...(body !== undefined ? { body } : {}) };
}

/** External ids Purser already holds for objects this one depends on (from erp_sync). */
export interface RefResolver {
  vendor(vendorId: string): string | null;
  invoice(invoiceId: string): string | null;
}

/**
 * The steps of a push made of several requests (a header, then its lines, an attachment, a post action) that already
 * succeeded, kept in erp_sync after each one: a retry or the next run resumes from the first step not done instead of
 * starting over, so a rate limit on the second line never makes a second header or repeats the first line.
 */
export interface PushProgress {
  get(step: string): string | undefined;
  set(step: string, value: string): void;
}

/** Runs one step of a push once: a step already done returns what it recorded. */
export async function step(progress: PushProgress | undefined, name: string, run: () => Promise<string>): Promise<string> {
  const done = progress?.get(name);
  if (done !== undefined) return done;
  const value = await run();
  progress?.set(name, value);
  return value;
}

/** The same steps under a prefix (a correction's credit note and its replacement each keep their own). */
export function scoped(progress: PushProgress | undefined, prefix: string): PushProgress | undefined {
  return progress && { get: (s) => progress.get(`${prefix}${s}`), set: (s, v) => progress.set(`${prefix}${s}`, v) };
}

export interface ErpAccount { code: string; name: string; externalId: string }
export interface ErpVendorRow { externalId: string; name: string; vatId?: string }
export type PaymentStatus = "unpaid" | "partial" | "paid" | "unknown";

export interface ErpConnector {
  readonly name: ConnectorName;
  pullChartOfAccounts(): Promise<ErpAccount[]>;
  pullVendors(): Promise<ErpVendorRow[]>;
  /** The ERP's id for an object Purser may already have created there (a crash between "sent" and "recorded"), or null. */
  findExisting(kind: ObjectKind, object: Vendor | PurchaseInvoice | Payment | JournalEntry, refs: RefResolver): Promise<string | null>;
  /**
   * For an object found by findExisting with no record of its steps (the answer to its first request was lost): null
   * when the ERP holds all of it, else what is missing. Missing parts go to a person, never 'synced'.
   */
  incomplete?(kind: ObjectKind, object: Vendor | PurchaseInvoice | Payment | JournalEntry, externalId: string, refs: RefResolver): Promise<string | null>;
  pushVendor(v: Vendor, progress?: PushProgress): Promise<string>;
  pushPurchaseInvoice(inv: PurchaseInvoice, refs: RefResolver, progress?: PushProgress): Promise<string>;
  /** A credit note that cancels `original` as it was sent (`originalExternalId` is its id in the ERP). */
  pushCreditNote(original: PurchaseInvoice, originalExternalId: string, refs: RefResolver, progress?: PushProgress): Promise<string>;
  pushPayment(p: Payment, refs: RefResolver, progress?: PushProgress): Promise<string>;
  pushJournalEntry(j: JournalEntry, progress?: PushProgress): Promise<string>;
  pullPaymentStatus(inv: PurchaseInvoice, invoiceExternalId: string, refs: RefResolver): Promise<PaymentStatus>;
}

/** Reads a required setting; a missing one is a config error naming the variable, never its value. */
export function required(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new ErpError("config", `${name} is not set`);
  return v;
}
