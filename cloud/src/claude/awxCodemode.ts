// The Airwallex sandbox, read only, in "Code Mode" style (docs/codemode.md): two MCP tools, `search` over a small
// OpenAPI document (openapi/airwallex-read.json) and `execute` running a plan of calls, instead of one tool per endpoint.
//
// This is the DECLARATIVE variant, not sandboxed JavaScript: `execute` takes a JSON plan (up to MAX_CALLS GET calls, each
// with optional field selection, filters and a count/sum), never code. Cloudflare's Worker Loader, which runs model-written
// code in an isolate, is not used (it is beta and needs new packages and a new binding).
//
// The guarantees, all enforced here on the host before anything is sent:
// - GET only, and only the operations in AWX_CODEMODE_READS (anchored path patterns, UUID ids, listed query keys with
//   plain values). Anything else, a POST, a path with "..", "%", "//", a query string, an absolute URL or another
//   origin, is refused, and a plan with one refused call makes no call at all.
// - The sandbox only: the one base is the gateway's (https://api.sandbox.airwallex.com/api/v1); any other is refused.
// - No credential here: Purser Cloud holds no Airwallex key. The calls go over the service binding to kit11's
//   AwxGateway entrypoint (worker/src/awxGateway.ts), which adds the login and checks its own allow-list again. Answers
//   carry Airwallex's JSON or its code and trace id; every text that leaves is passed through redact() as well.
import SPEC from "../../../openapi/airwallex-read.json" with { type: "json" };
import { GATEWAY_SANDBOX_BASE, type GatewayAnswer, type GatewayRequest } from "../../../src/airwallex/gatewayRules.js";

export { SPEC as AWX_READ_SPEC };
/** The kit11 gateway's one method (cloud/wrangler.try.jsonc, AWX_GATEWAY). */
export interface AwxReadPort { call(r: GatewayRequest): Promise<GatewayAnswer> }

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAGE = ["page_num", "page_size"] as const;
const WINDOW = ["from_created_at", "to_created_at"] as const;

/** One allowed read: its operationId, its path (as the spec writes it), and the query keys it may carry. */
export interface AwxReadOp { operationId: string; path: string; query: readonly string[] }

/** Every call the server may make. GET only; the spec (openapi/airwallex-read.json) lists exactly these (tested). */
export const AWX_CODEMODE_READS: readonly AwxReadOp[] = [
  { operationId: "getCurrentBalances", path: "/balances/current", query: [] },
  { operationId: "listGlobalAccounts", path: "/global_accounts", query: [...PAGE] },
  { operationId: "listFinancialTransactions", path: "/financial_transactions", query: [...WINDOW, "currency", "status", "source_id", ...PAGE] },
  { operationId: "getCurrentFxRate", path: "/fx/rates/current", query: ["buy_currency", "sell_currency"] },
  { operationId: "listConversions", path: "/fx/conversions", query: ["request_id", "status", ...WINDOW, ...PAGE] },
  { operationId: "listTransfers", path: "/transfers", query: ["request_id", "status", ...WINDOW, ...PAGE] },
  { operationId: "getTransfer", path: "/transfers/{id}", query: [] },
  { operationId: "listBeneficiaries", path: "/beneficiaries", query: [...PAGE] },
  { operationId: "listCards", path: "/issuing/cards", query: ["card_status", ...PAGE] },
  { operationId: "getCard", path: "/issuing/cards/{id}", query: [] },
];

const patternOf = (path: string) => new RegExp(`^${path.replace(/\{id\}/g, UUID).replace(/\//g, "\\/")}$`);
const QUERY_VALUE = /^[A-Za-z0-9:+._-]{1,64}$/;

export class AwxReadRefused extends Error {
  constructor(readonly reason: string) { super(`refused: ${reason}`); this.name = "AwxReadRefused"; }
}

/** Anything that looks like a credential, replaced: bearer tokens, JWTs, API key headers. */
export function redact(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/(x-api-key|x-client-id|api_key|client_id|token)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1$2[redacted]");
}

export interface AwxRead { method: string; path: string; query?: Record<string, unknown> }

/**
 * The one check of a call, before anything is sent: GET, a plain path on the list, the sandbox base, and only the
 * operation's own query keys with plain values. Answers the operation and the exact request for the gateway.
 */
export function checkRead(r: AwxRead, base: string = GATEWAY_SANDBOX_BASE): { op: AwxReadOp; req: GatewayRequest } {
  if (base !== GATEWAY_SANDBOX_BASE) throw new AwxReadRefused("only the Airwallex sandbox base URL is allowed");
  if (!r || typeof r !== "object") throw new AwxReadRefused("not a call");
  if (r.method !== "GET") throw new AwxReadRefused(`method ${String(r.method).slice(0, 10)} is not allowed: GET only, this server never writes`);
  const path = r.path;
  if (typeof path !== "string" || path.length === 0 || path.length > 120) throw new AwxReadRefused("the path is missing or too long");
  if (!path.startsWith("/") || path.startsWith("//") || /:\/\/|\.\.|[%\\?#@\s]|[^\x21-\x7e]/.test(path)) throw new AwxReadRefused("the path must be a plain path under the API, like /balances/current (no URL, no '..', no query string)");
  const url = new URL(GATEWAY_SANDBOX_BASE + path);
  const baseUrl = new URL(GATEWAY_SANDBOX_BASE);
  if (url.origin !== baseUrl.origin || url.pathname !== baseUrl.pathname + path) throw new AwxReadRefused("the path leaves the sandbox API");
  const op = AWX_CODEMODE_READS.find((o) => patternOf(o.path).test(path));
  if (!op) throw new AwxReadRefused(`GET ${path.replace(/[A-Za-z0-9_-]{20,}/g, "{id}")} is not on the read allow-list; search shows the operations there are`);
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.query ?? {})) {
    if (!op.query.includes(k)) throw new AwxReadRefused(`${op.operationId} takes no query key ${k.slice(0, 40)}`);
    const s = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
    if (typeof s !== "string" || !QUERY_VALUE.test(s)) throw new AwxReadRefused(`the value of ${k} is not plain`);
    query[k] = s;
  }
  return { op, req: { method: "GET", path, ...(Object.keys(query).length ? { query } : {}) } };
}

// --- search: fragments of the spec, never the whole document. ---

type J = Record<string, unknown>;
const specPaths = SPEC.paths as unknown as Record<string, { get: J }>;
const specParams = (SPEC.components as unknown as { parameters: Record<string, J> }).parameters;
const resolve = (p: J): J => (typeof p.$ref === "string" ? specParams[p.$ref.split("/").pop()!] ?? p : p);

/** One operation as search returns it: method, path, summary and its parameters resolved. */
export function fragmentOf(path: string): J {
  const g = specPaths[path]!.get;
  return { method: "GET", path, operationId: g.operationId, tags: g.tags, summary: g.summary, parameters: ((g.parameters ?? []) as J[]).map(resolve), response: (g.responses as Record<string, J>)["200"]!.description };
}

export const SEARCH_MAX = 5;

export function searchSpec(query: string | undefined): J {
  const words = (query ?? "").toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 1);
  const all = Object.keys(specPaths);
  if (!words.length) return { server: SPEC.servers[0]!.url, note: "GET only. Call execute with { calls: [{ method: \"GET\", path, query? }] }.", operations: all.map((p) => ({ method: "GET", path: p, operationId: specPaths[p]!.get.operationId, summary: specPaths[p]!.get.summary })) };
  const scored = all.map((p) => {
    // A word in the path, operationId or tags weighs most, then the summary, then anything else in the fragment.
    const f = fragmentOf(p);
    const head = `${p} ${String(f.operationId)} ${JSON.stringify(f.tags)}`.toLowerCase(), summary = String(f.summary).toLowerCase(), rest = JSON.stringify(f).toLowerCase();
    return { p, score: words.reduce((n, w) => n + (head.includes(w) ? 4 : 0) + (summary.includes(w) ? 2 : 0) + (rest.includes(w) ? 1 : 0), 0) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, SEARCH_MAX);
  return { server: SPEC.servers[0]!.url, matches: scored.map((x) => fragmentOf(x.p)), ...(scored.length ? {} : { note: "nothing matched; search with no query lists every operation" }) };
}

// --- execute: a declarative plan, no code. ---

export const MAX_CALLS = 10;
export const MAX_ITEMS = 200;

export interface PlanCall {
  as?: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  /** Keep only these fields (dot paths) of each item (or of the object). */
  select?: string[];
  /** Keep only items whose field equals the value. */
  where?: { field: string; equals: string | number | boolean | null }[];
  /** Count the items and, with sum, add up a numeric field, optionally per group_by field. */
  aggregate?: { sum?: string; group_by?: string };
  /** Items returned at most (default 50, at most MAX_ITEMS). */
  limit?: number;
}
export interface Plan { calls: PlanCall[] }

const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as J)[k] : undefined), o);
const pick = (o: unknown, fields: string[]): J => Object.fromEntries(fields.map((f) => [f, get(o, f) ?? null]));
const itemsOf = (json: unknown): unknown[] | null => (Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as J).items) ? (json as J).items as unknown[] : null);
const round = (n: number) => Math.round(n * 1e8) / 1e8;

/** Runs a plan: every call checked first (one refused, none is made), then each sent over the port in order. */
export async function runPlan(port: AwxReadPort | null, plan: Plan): Promise<{ results: J[] }> {
  if (!plan || !Array.isArray(plan.calls) || plan.calls.length === 0) throw new AwxReadRefused("a plan needs calls: [{ method: \"GET\", path }]");
  if (plan.calls.length > MAX_CALLS) throw new AwxReadRefused(`a plan makes at most ${MAX_CALLS} calls`);
  const checked = plan.calls.map((c, i) => {
    try { return checkRead(c); } catch (e) { throw new AwxReadRefused(`call ${i + 1}: ${e instanceof AwxReadRefused ? e.reason : "not a call"}`); }
  });
  if (!port) throw new AwxReadRefused("the Airwallex sandbox gateway is not connected to this Purser Cloud");
  const results: J[] = [];
  for (const [i, c] of plan.calls.entries()) {
    const { op, req } = checked[i]!;
    const as = typeof c.as === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.as) ? c.as : `${op.operationId}${plan.calls.length > 1 ? `_${i + 1}` : ""}`;
    let a: GatewayAnswer;
    try { a = await port.call(req); } catch { a = { ok: false, status: 502, code: "gateway_unreachable", trace_id: null }; }
    if (!a.ok) { results.push({ as, operationId: op.operationId, ok: false, status: a.status, code: a.code, trace_id: a.trace_id, ...(a.refused ? { refused: redact(a.refused) } : {}) }); continue; }
    const list = itemsOf(a.json);
    if (!list) { results.push({ as, operationId: op.operationId, ok: true, data: c.select?.length ? pick(a.json, c.select) : a.json }); continue; }
    let rows = list;
    for (const w of c.where ?? []) rows = rows.filter((r) => get(r, w.field) === w.equals);
    const out: J = { as, operationId: op.operationId, ok: true, count: rows.length };
    if (a.json && typeof a.json === "object" && !Array.isArray(a.json) && typeof (a.json as J).has_more === "boolean") out.has_more = (a.json as J).has_more;
    if (c.aggregate?.sum) {
      const sums: Record<string, number> = {};
      for (const r of rows) {
        const v = Number(get(r, c.aggregate.sum));
        if (!Number.isFinite(v)) continue;
        const g = c.aggregate.group_by ? String(get(r, c.aggregate.group_by) ?? "(none)") : "all";
        sums[g] = round((sums[g] ?? 0) + v);
      }
      out.sum = { field: c.aggregate.sum, ...(c.aggregate.group_by ? { group_by: c.aggregate.group_by } : {}), totals: sums };
    }
    const limit = Math.min(Math.max(1, Math.trunc(c.limit ?? 50)), MAX_ITEMS);
    if (!c.aggregate || c.limit !== undefined || c.select?.length) out.items = rows.slice(0, limit).map((r) => (c.select?.length ? pick(r, c.select) : r));
    if (rows.length > limit && out.items) out.truncated = true;
    results.push(out);
  }
  return { results };
}
