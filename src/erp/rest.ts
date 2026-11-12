// One authenticated JSON call, shared by the REST connectors (Exact Online, Business Central): the bearer token, one
// new token after a 401, the ERP's own error text in the error, and the answer parsed.

import type { TokenProvider } from "./auth.js";
import { errorForStatus, ErpError, redactUrl, type HttpRequest, type Transport } from "./connector.js";

export interface JsonCall {
  method: HttpRequest["method"];
  url: string;
  body?: unknown;
  /** Raw bytes instead of JSON (an attachment's content), with its content type. */
  bytes?: { data: Uint8Array; contentType: string };
  headers?: Record<string, string>;
}
export interface JsonAnswer<T> { status: number; headers: Record<string, string>; json: T | null }

/** The message an OData error body carries: v2 {"error":{"message":{"value"}}} or v4 {"error":{"message"}}. */
export function odataError(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { code?: string; message?: string | { value?: string } } }).error;
    if (!e) return "";
    const m = typeof e.message === "string" ? e.message : e.message?.value ?? "";
    return [e.code, m].filter(Boolean).join(": ").slice(0, 500);
  } catch {
    return "";
  }
}

export async function callJson<T>(transport: Transport, tokens: TokenProvider, c: JsonCall, errorText: (body: string) => string = odataError): Promise<JsonAnswer<T>> {
  const where = `${c.method} ${redactUrl(c.url)}`;
  for (let attempt = 0; ; attempt++) {
    const req: HttpRequest = {
      method: c.method, url: c.url,
      headers: {
        authorization: `Bearer ${await tokens.token()}`, accept: "application/json",
        ...(c.bytes ? { "content-type": c.bytes.contentType } : c.body !== undefined ? { "content-type": "application/json" } : {}),
        ...c.headers,
      },
      ...(c.bytes ? { body: c.bytes.data } : c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    };
    const res = await transport.send(req);
    if (res.status === 401 && attempt === 0) {
      tokens.invalidate();
      continue;
    }
    if (res.status < 200 || res.status > 299) throw errorForStatus(res.status, res.headers, where, errorText(res.body));
    if (res.status === 204 || res.body.trim() === "") return { status: res.status, headers: res.headers, json: null };
    try {
      return { status: res.status, headers: res.headers, json: JSON.parse(res.body) as T };
    } catch {
      throw new ErpError("unexpected", `${where}: the answer is not JSON`, { status: res.status });
    }
  }
}

/** An OData string literal: single quotes doubled. */
export const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Uint8Array to base64, for an attachment sent inside JSON or XML. */
export const base64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** A setting holding a JSON object of strings (a VAT code or account map), or a config error naming it. */
export function jsonMap(env: Record<string, string | undefined>, name: string, optional = false): Record<string, string> {
  const raw = env[name];
  if (!raw) {
    if (optional) return {};
    throw new ErpError("config", `${name} is not set`);
  }
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every((v) => typeof v === "string" || typeof v === "number")) {
      return Object.fromEntries(Object.entries(o as Record<string, string | number>).map(([k, v]) => [k, String(v)]));
    }
  } catch { /* below */ }
  throw new ErpError("config", `${name} must be a JSON object of strings, like {"NL21":"2"}`);
}
