// The plumbing every workplace integration shares (docs/integrations/workplace.md): one authenticated call with fetch,
// answers read with a size cap before they are parsed, JSON checked with a zod schema before anything trusts it, and
// errors that name the call but never a token, a query value or a provider's body beyond a short message.
//
// A token reaches this file only as a TokenSource: a function the caller made from the environment or secret config
// (tokenSourceFromEnv in ./oauth.ts). Nothing here logs.

import type { z } from "zod";

export type Fetch = typeof fetch;
/** Gives a current access token (refreshing it when the source can). */
export type TokenSource = () => Promise<string>;

export type WorkplaceErrorKind = "auth" | "rate_limited" | "not_found" | "server" | "network" | "invalid" | "too_large" | "config" | "refused";

export class WorkplaceError extends Error {
  constructor(readonly kind: WorkplaceErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "WorkplaceError";
  }
}

/** The largest JSON answer read from a provider (a page of a list, one message's structure). */
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
/** How long one call may take. */
export const CALL_TIMEOUT_MS = 30_000;

/** A URL fit for an error: the path only, never the query (a query can hold a search, an e-mail address, a token). */
export function where(method: string, url: string): string {
  try {
    const u = new URL(url);
    return `${method} ${u.host}${u.pathname}`;
  } catch {
    return `${method} (a malformed URL)`;
  }
}

/** A provider's own short error words from a JSON error body (Google, Graph, Xero shapes), cut to 200 characters. */
export function providerMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown; error_description?: unknown; Message?: unknown; message?: unknown };
    const e = j.error;
    const m = typeof e === "object" && e !== null ? (e as { message?: unknown }).message : typeof j.error_description === "string" ? j.error_description : j.Message ?? j.message ?? (typeof e === "string" ? e : "");
    return typeof m === "string" ? m.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 200) : "";
  } catch {
    return "";
  }
}

function errorFor(status: number, at: string, body: string): WorkplaceError {
  const words = providerMessage(body);
  const msg = `${at}: HTTP ${status}${words ? `: ${words}` : ""}`;
  if (status === 401 || status === 403) return new WorkplaceError("auth", msg, status);
  if (status === 404) return new WorkplaceError("not_found", msg, status);
  if (status === 429) return new WorkplaceError("rate_limited", msg, status);
  if (status >= 500) return new WorkplaceError("server", msg, status);
  return new WorkplaceError("refused", msg, status);
}

/** The body of an answer, refused once it passes `max` bytes (a Content-Length above it is refused before reading). */
export async function readCapped(res: Response, max: number, at: string): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new WorkplaceError("too_large", `${at}: the answer is ${declared} bytes, above the cap of ${max}; nothing was read`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new WorkplaceError("too_large", `${at}: the answer passed the cap of ${max} bytes; it was not kept`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at2 = 0;
  for (const c of chunks) { out.set(c, at2); at2 += c.byteLength; }
  return out;
}

export interface CallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
  /** null: no Authorization header (a pre-authenticated download URL, a public key set). */
  token: TokenSource | null;
  fetch?: Fetch;
}

/** One call: the bearer token, a time limit, the status mapped to an error kind. The answer's body is not read here. */
export async function call(url: string, o: CallOptions): Promise<Response> {
  const method = o.method ?? "GET";
  const at = where(method, url);
  const headers: Record<string, string> = { accept: "application/json", ...(o.headers ?? {}) };
  if (o.token) headers.authorization = `Bearer ${await o.token()}`;
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(url, { method, headers, ...(o.body !== undefined ? { body: o.body } : {}), redirect: "follow", signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (e) {
    throw new WorkplaceError("network", `${at}: ${(e as Error).name === "TimeoutError" ? "no answer in time" : "the call failed"}`);
  }
  if (!res.ok) {
    const body = new TextDecoder().decode(await readCapped(res, 64 * 1024, at).catch(() => new Uint8Array(0)));
    throw errorFor(res.status, at, body);
  }
  return res;
}

/** A JSON answer, read with a cap and checked with `schema`; a mismatch names the path of the first problem, never a value. */
export async function callJson<T>(url: string, schema: z.ZodType<T>, o: CallOptions, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const at = where(o.method ?? "GET", url);
  const res = await call(url, o);
  const text = new TextDecoder().decode(await readCapped(res, maxBytes, at));
  let raw: unknown;
  try { raw = text.trim() === "" ? {} : JSON.parse(text); } catch { throw new WorkplaceError("invalid", `${at}: the answer is not JSON`); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new WorkplaceError("invalid", `${at}: the answer is not the documented shape (${issue ? `${issue.path.join(".") || "(root)"}: ${issue.code}` : "unknown"})`);
  }
  return parsed.data;
}

/** A file's bytes, refused above `max`. */
export async function callBytes(url: string, max: number, o: CallOptions): Promise<Uint8Array> {
  const res = await call(url, { ...o, headers: { accept: "*/*", ...(o.headers ?? {}) } });
  return readCapped(res, max, where(o.method ?? "GET", url));
}

const B64URL = /^[A-Za-z0-9_-]*={0,2}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 or base64url to bytes: strict alphabet, and refused before decoding when it would pass `max` bytes. */
export function decodeBase64(s: string, max: number, url = true): Uint8Array {
  const clean = s.replace(/\s+/g, "");
  if (!(url ? B64URL : B64).test(clean)) throw new WorkplaceError("invalid", "the attachment's data is not base64");
  if (Math.floor((clean.replace(/=+$/, "").length * 3) / 4) > max) throw new WorkplaceError("too_large", `the attachment is above the cap of ${max} bytes; it was not decoded`);
  return new Uint8Array(Buffer.from(url ? clean.replace(/-/g, "+").replace(/_/g, "/") : clean, "base64"));
}

/** A setting from the environment or secret config; a missing one names the variable, never a value. */
export function setting(env: Record<string, string | undefined>, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new WorkplaceError("config", `${name} is not set`);
  return v;
}

/** A provider's id as it goes into a URL path: only the characters such ids are made of, at most `max` long. */
export function safeId(what: string, id: string, re = /^[A-Za-z0-9_-]{1,256}$/): string {
  if (!re.test(id)) throw new WorkplaceError("invalid", `${what} is not a well-formed id`);
  return id;
}

/** Text from a provider as Purser keeps it: no control or direction characters, one line, at most `n` characters. */
export const clean = (s: string | null | undefined, n = 200): string => (s ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
