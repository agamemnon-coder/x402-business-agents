// Purser Cloud's public demo mode: a deployment of its own (its own database and document store, holding seeded test
// companies and nothing else) that anyone may read without an account. One deployment variable switches it on
// (DEMO_PUBLIC=on, with DEMO_SLUGS naming the demo companies). With the variable unset nothing in this file runs.
//
// In demo mode there is one caller: an anonymous, read-only visitor.
//   GET /v1/demo/companies               the demo companies, for the console's switcher
//   GET /v1/demo/{company}/<a read>      the reads in DEMO_READS, for a demo company only
//   GET /v1/health, GET /v1/openapi.json as on any deployment
// Everything else answers 403 demo_read_only: every other method, signing in, enrolling, recovering, keys, pushes,
// administering, mail and the platform's routes. Keys, sessions and the platform token are never looked at, so nothing
// in a request can change who is asking. Nothing is written: no schema script, no rate counters (the limits live in
// this isolate's memory), no last-used stamps. A company that is not on the list does not exist here.
//
// The gate itself is in app.ts (demoRoute), next to the route table it reads; this file holds its parts.

import { BadRequest } from "./read.js";
import type { Blobs, Sql } from "./store.js";

/** A company's address, as everywhere else. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** A demo is a handful of companies; the list is checked on every request. */
export const DEMO_MAX_COMPANIES = 12;
/** Requests one address may make in a minute, and reads that may reach the database in a minute (all addresses), per isolate. */
export const DEMO_RATE = { perMinute: 300, uncachedPerMinute: 600 };
/** How long an answer is remembered, in this isolate and in the edge cache: the data is static after seeding. */
export const DEMO_TTL_SEC = 300;
/** How long a visitor's browser may keep an answer; a document by its hash (it never changes); the health check, everywhere. */
export const DEMO_BROWSER_SEC = 60;
export const DEMO_DOCUMENT_BROWSER_SEC = 86_400;
export const DEMO_HEALTH_SEC = 30;
/** The largest document the demo serves. */
export const DEMO_MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** The reads a visitor may ask of a demo company, by the route table's own names (app.ts ROUTES). Nothing else is served. */
export const DEMO_READS: ReadonlySet<string> = new Set([
  "GET /v1/me", "GET /v1/invoices", "GET /v1/invoices/{id}", "GET /v1/invoices/{id}/document", "GET /v1/vendors", "GET /v1/payments",
  "GET /v1/transactions", "GET /v1/transactions/summary", "GET /v1/transactions/export.csv", "GET /v1/transactions/{id}",
  "GET /v1/ledger/entries", "GET /v1/reports/{name}", "GET /v1/insights", "GET /v1/documents/{sha256}",
]);
/** The routes that name no company and still answer at their own path. */
export const DEMO_OPEN: ReadonlySet<string> = new Set(["GET /v1/health", "GET /v1/openapi.json"]);
/** The two reads that return a document's bytes: in demo mode demoDocument serves them. */
export const DEMO_DOCUMENT_ROUTES: ReadonlySet<string> = new Set(["/v1/invoices/{id}/document", "/v1/documents/{sha256}"]);

/** What the demo says about itself wherever it answers in its own words. */
export const DEMO_NOTE = "A public, read-only demo of Purser Cloud: test companies and test money. Nothing here is real, and nothing can be changed.";
export const DEMO_LABEL = { read_only: true, test_world: true, note: DEMO_NOTE } as const;
/** Why the demo takes no mail (the Worker's e-mail handler). */
export const DEMO_MAIL_REFUSAL = "this address is a read-only demo and takes no mail";

/** The part of Cloudflare's Cache API used here (caches.default); a test passes a fake. */
export interface DemoCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<unknown>;
}

export interface DemoEnv {
  /** The demo companies' addresses, in the order they are shown. */
  readonly slugs: readonly string[];
  readonly rate: { readonly perMinute: number; readonly uncachedPerMinute: number };
  readonly ttlSec: number;
  /** This isolate's own state: its counters and the answers it remembers. Nothing of it is in the database. */
  readonly limiter: MemoryLimiter;
  readonly memo: ResponseMemo;
  /**
   * Cloudflare's edge cache, shared by the isolates of one data centre. Used when the runtime has one; it is a saving,
   * never needed (as far as we know it stores nothing on a workers.dev address: the isolate's memory works everywhere).
   */
  readonly cache?: DemoCache;
}

/** A demo's configuration with fresh state. Throws on a list that is empty, too long or holds something that is no address. */
export function demoEnv(slugs: readonly string[], o: { perMinute?: number; uncachedPerMinute?: number; ttlSec?: number; cache?: DemoCache } = {}): DemoEnv {
  const list = [...new Set(slugs)];
  if (!list.length) throw new Error("DEMO_SLUGS names no company (demo mode needs the demo companies' addresses, separated by commas)");
  if (list.length > DEMO_MAX_COMPANIES) throw new Error(`DEMO_SLUGS names more than ${DEMO_MAX_COMPANIES} companies`);
  const bad = list.find((s) => !SLUG.test(s));
  if (bad !== undefined) throw new Error(`DEMO_SLUGS holds ${JSON.stringify(bad.slice(0, 60))}, which is not a company's address (lowercase letters, digits and dashes)`);
  return {
    slugs: list, rate: { perMinute: o.perMinute ?? DEMO_RATE.perMinute, uncachedPerMinute: o.uncachedPerMinute ?? DEMO_RATE.uncachedPerMinute }, ttlSec: o.ttlSec ?? DEMO_TTL_SEC,
    limiter: new MemoryLimiter(), memo: new ResponseMemo(), ...(o.cache ? { cache: o.cache } : {}),
  };
}

/**
 * Demo mode from the deployment's variables: on only with DEMO_PUBLIC exactly "on"; unset, empty or "off" is off, and
 * DEMO_SLUGS alone switches nothing on. Any other value is a mistake and is refused, never guessed at.
 */
export function demoFromVars(v: { DEMO_PUBLIC?: string; DEMO_SLUGS?: string }, o: { cache?: DemoCache } = {}): DemoEnv | undefined {
  const flag = v.DEMO_PUBLIC ?? "";
  if (flag === "" || flag === "off") return undefined;
  if (flag !== "on") throw new Error('DEMO_PUBLIC must be "on" or "off"');
  return demoEnv((v.DEMO_SLUGS ?? "").split(/[\s,]+/).filter(Boolean), o);
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (status: number, body: unknown, more: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...more } });

/** The one answer to everything the demo does not do. */
export function demoRefused(): Response {
  return json(403, { error: "This is a read-only demo with test companies and test money. Nothing can be changed here and nobody signs in. GET /v1/demo/companies lists the companies.", code: "demo_read_only" });
}

/** A company the demo does not have: not on the list, never seeded, or closed. One answer for all, naming nothing. */
export function demoNoCompany(): Response {
  return json(404, { error: "no such company in this demo; GET /v1/demo/companies lists them", code: "not_found" });
}

export function demoBusy(demo: DemoEnv, now: Date, error = "too many requests; wait a minute"): Response {
  return json(429, { error, code: "rate_limited" }, { "retry-after": String(demo.limiter.retryAfterSec(now.getTime())) });
}

/**
 * A counter per key in a fixed window, in this isolate's memory: the demo's rate limits write nothing to the database.
 * It is per isolate, so it bounds what one isolate does, not the deployment as a whole (a rate rule at Cloudflare does
 * that). Bounded: minutes that are over are dropped, and under a flood of addresses the lightest half goes first, so an
 * address that is over its limit stays over it.
 */
export class MemoryLimiter {
  private readonly hits = new Map<string, { win: number; n: number }>();
  constructor(private readonly windowMs = 60_000, private readonly maxKeys = 10_000) {}

  get size(): number { return this.hits.size; }

  /** Counts one; true while the key is within `max` for the current window. */
  take(key: string, nowMs: number, max: number): boolean {
    const win = Math.floor(nowMs / this.windowMs);
    const e = this.hits.get(key);
    if (e && e.win === win) { e.n += 1; return e.n <= max; }
    if (!e && this.hits.size >= this.maxKeys) this.prune(win);
    this.hits.set(key, { win, n: 1 });
    return max >= 1;
  }

  /** Seconds until the current window is over. */
  retryAfterSec(nowMs: number): number {
    return Math.max(1, Math.ceil((this.windowMs - (nowMs % this.windowMs)) / 1000));
  }

  private prune(win: number): void {
    for (const [k, e] of this.hits) if (e.win !== win) this.hits.delete(k);
    if (this.hits.size < this.maxKeys) return;
    const lightest = [...this.hits].sort((a, b) => a[1].n - b[1].n).slice(0, Math.ceil(this.hits.size / 2));
    for (const [k] of lightest) this.hits.delete(k);
  }
}

export interface Remembered { status: number; headers: [string, string][]; body: Uint8Array<ArrayBuffer> }

/**
 * Answers this isolate remembers, each until its time is up: the least recently used goes first once there are too
 * many or they are too large together, and an answer larger than `entryBytes` is not kept at all.
 */
export class ResponseMemo {
  private readonly map = new Map<string, { v: Remembered; expires: number }>();
  private total = 0;
  constructor(private readonly max: { entries: number; bytes: number; entryBytes: number } = { entries: 400, bytes: 8 * 1024 * 1024, entryBytes: 1024 * 1024 }) {}

  get size(): number { return this.map.size; }
  get bytes(): number { return this.total; }

  get(key: string, nowMs: number): Remembered | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= nowMs) { this.drop(key); return undefined; }
    // A Map keeps its keys in the order they were set: the one just used goes to the end.
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  set(key: string, v: Remembered, expiresMs: number): boolean {
    this.drop(key);
    if (v.body.byteLength > this.max.entryBytes) return false;
    this.map.set(key, { v, expires: expiresMs });
    this.total += v.body.byteLength;
    for (const k of this.map.keys()) {
      if (this.map.size <= this.max.entries && this.total <= this.max.bytes) break;
      if (k !== key) this.drop(k);
    }
    return true;
  }

  private drop(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.total -= e.v.body.byteLength;
    this.map.delete(key);
  }
}

/** A read's filters, bounded, and its cache key: the same read asked with its filters in another order is the same read. */
export function demoKey(origin: string, path: string, query: URLSearchParams): { key: string; query: URLSearchParams } {
  const names = [...new Set(query.keys())].sort();
  if (names.length > 12) throw new BadRequest("too many filters in one request");
  const q = new URLSearchParams();
  for (const n of names) {
    // The first value of each, as the routes read it.
    const v = query.get(n) ?? "";
    if (n.length > 40 || v.length > 200) throw new BadRequest("a filter is too long");
    q.set(n, v);
  }
  const qs = q.toString();
  return { key: `${origin}${path}${qs ? `?${qs}` : ""}`, query: q };
}

/** The headers of an answer that are kept with it; everything else is set again when it is served. */
const CARRIED = ["content-type", "content-disposition", "x-content-type-options", "content-security-policy", "cross-origin-resource-policy"];
const carried = (h: Headers): [string, string][] => CARRIED.flatMap((n) => { const v = h.get(n); return v === null ? [] : [[n, v] as [string, string]]; });

function served(v: Remembered, browser: string, from: "hit" | "edge" | "miss"): Response {
  return new Response(v.body, { status: v.status, headers: [...v.headers, ["cache-control", browser], ["x-purser-cache", from], ["x-purser-demo", "read-only test world"]] });
}

/**
 * A demo read, answered from this isolate's memory, else from the edge cache, else made (and then remembered in both).
 * Only a 200 is remembered; anything else is passed on as it is and made again next time. A read that has to be made
 * counts against the isolate's budget of uncached reads: past it the answer is 429 until the minute is over, while
 * remembered answers are still served. `browser` is the Cache-Control the visitor's browser gets.
 */
export async function remembered(demo: DemoEnv, key: string, now: Date, keep: { ttlSec: number; browser: string }, make: () => Promise<Response>): Promise<Response> {
  const nowMs = now.getTime();
  const kept = demo.memo.get(key, nowMs);
  if (kept) return served(kept, keep.browser, "hit");
  if (demo.cache) {
    try {
      const hit = await demo.cache.match(new Request(key));
      if (hit && hit.status === 200) {
        const v: Remembered = { status: 200, headers: carried(hit.headers), body: new Uint8Array(await hit.arrayBuffer()) };
        demo.memo.set(key, v, nowMs + keep.ttlSec * 1000);
        return served(v, keep.browser, "edge");
      }
    } catch { /* the edge cache is a saving, never a dependency */ }
  }
  if (!demo.limiter.take("uncached", nowMs, demo.rate.uncachedPerMinute)) return demoBusy(demo, now, "the demo is busy; try again in a minute");
  const res = await make();
  if (res.status !== 200) return res;
  const v: Remembered = { status: 200, headers: carried(res.headers), body: new Uint8Array(await res.arrayBuffer()) };
  demo.memo.set(key, v, nowMs + keep.ttlSec * 1000);
  if (demo.cache) {
    try {
      await demo.cache.put(new Request(key), new Response(v.body, { status: 200, headers: [...v.headers, ["cache-control", `public, max-age=${keep.ttlSec}`]] }));
    } catch { /* as above */ }
  }
  return served(v, keep.browser, "miss");
}

export interface DemoCompany {
  slug: string;
  name: string;
  language: "nl" | "en";
  /** Counted from the company's rows when the answer is made; never typed. */
  counts: { invoices: number; invoices_paid: number; suppliers: number; payments: number; transactions: number; documents: number; ledger_entries: number };
}

/** The demo companies that exist and are open, in the configured order, each with counts of what it holds. */
export async function demoCompanies(sql: Sql, slugs: readonly string[]): Promise<{ test_world: true; read_only: true; note: string; companies: DemoCompany[] }> {
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
  const rows = await sql.all<{ id: string; slug: string; name: string; language: string }>(`SELECT id, slug, name, language FROM tenants WHERE closed_at IS NULL AND slug IN (${marks(slugs.length)})`, [...slugs]);
  const ids = rows.map((r) => r.id);
  // One statement per table for all companies together; the table names are this file's own.
  const count = async (table: "invoices" | "vendors" | "payments" | "transactions" | "documents" | "ledger_entries", where = ""): Promise<Map<string, number>> =>
    new Map(ids.length ? (await sql.all<{ tenant_id: string; n: number }>(`SELECT tenant_id, COUNT(*) AS n FROM ${table} WHERE tenant_id IN (${marks(ids.length)})${where} GROUP BY tenant_id`, ids)).map((r) => [r.tenant_id, r.n]) : []);
  const [invoices, paid, suppliers, payments, transactions, documents, entries] = [await count("invoices"), await count("invoices", " AND status = 'paid'"), await count("vendors"), await count("payments"),
    await count("transactions"), await count("documents"), await count("ledger_entries")];
  const companies = slugs.flatMap((slug): DemoCompany[] => {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return [];
    const n = (m: Map<string, number>) => m.get(r.id) ?? 0;
    return [{ slug, name: r.name, language: r.language === "en" ? "en" : "nl",
      counts: { invoices: n(invoices), invoices_paid: n(paid), suppliers: n(suppliers), payments: n(payments), transactions: n(transactions), documents: n(documents), ledger_entries: n(entries) } }];
  });
  return { ...DEMO_LABEL, companies };
}

/** The stored types the demo serves as they are; every other type (HTML, SVG, scripts, anything unknown) goes out as plain bytes. */
const SAFE_TYPES: Record<string, string> = {
  "application/pdf": "application/pdf", "image/png": "image/png", "image/jpeg": "image/jpeg",
  "text/plain": "text/plain; charset=utf-8", "text/csv": "text/csv; charset=utf-8", "application/json": "application/json; charset=utf-8",
};
export function demoContentType(stored: string): string {
  return SAFE_TYPES[(stored.split(";")[0] ?? "").trim().toLowerCase()] ?? "application/octet-stream";
}

/**
 * A demo company's document from the store, for anyone: its content type from the stored type (the safe ones only),
 * never sniffed, never a page (a download, under a policy that runs no script even if a browser showed it), and never
 * larger than the cap. A row that says it is too large is refused before a byte is read.
 */
export async function demoDocument(blobs: Blobs, d: { blob_key: string; filename: string; mime: string; size: number } | null, what: string): Promise<Response> {
  if (!d) return json(404, { error: `no ${what}`, code: "not_found" });
  const tooLarge = () => json(413, { error: `this document is larger than ${DEMO_MAX_DOCUMENT_BYTES} bytes; the demo does not serve it`, code: "too_large" });
  if (d.size > DEMO_MAX_DOCUMENT_BYTES) return tooLarge();
  const bytes = await blobs.get(d.blob_key);
  if (!bytes) return json(404, { error: `no ${what}`, code: "not_found" });
  if (bytes.byteLength > DEMO_MAX_DOCUMENT_BYTES) return tooLarge();
  return new Response(new Uint8Array(bytes), { status: 200, headers: {
    "content-type": demoContentType(d.mime), "content-disposition": `attachment; filename="${d.filename.replace(/[^\w.-]+/g, "_")}"`, "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox; frame-ancestors 'none'", "cross-origin-resource-policy": "same-origin", "cache-control": "no-store",
  } });
}
