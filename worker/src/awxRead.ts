// Purser Cloud's live Airwallex tab (14 Nov): the one read-only gateway between Purser Cloud and the Airwallex sandbox.
// Purser Cloud (purser-try) holds no Airwallex key. It asks this Worker (kit11) through a service binding to a named
// entrypoint (worker/src/index.ts, AwxRead), which no HTTP request can reach; only this Worker talks to Airwallex.
//
// The rules, the same as the live FX quote's (./fxQuote.ts):
// - one host only, the sandbox (AWX_SANDBOX_HOST): test money, never a live account;
// - an explicit table of calls (AWX_READ_ALLOWED): the login, and GETs only, each with the query keys it may carry;
//   anything else throws before fetch is reached. No transfer, no conversion, no card change: nothing here writes;
// - the key and the bearer token stay in this module: never in an answer, an error message or a log line. Every
//   failure is told in fixed words. The token is kept in memory until shortly before it expires;
// - one answer per view for everyone, kept READ_TTL_SECONDS in the Durable Object's own SQL storage; concurrent visits
//   share the one refresh in flight;
// - ceilings for all visitors together: READ_PER_MINUTE calls a minute and READ_DAILY_CEILING a UTC day, checked and
//   counted before each call (the SQL API is synchronous, so no other request runs between the check and the count);
// - every call is counted by endpoint (method and path, no query, no id), so the page can show how many calls were made
//   and to which endpoints: the "Airwallex calls" panel.
// When the key is missing, a ceiling is reached or the sandbox fails, the view says "unavailable" with the reason; it
// never makes a figure up.

import { AWX_SANDBOX_HOST } from "./fxQuote.js";
import type { Sql } from "./core.js";

/** The path inside the Worker where the RelayObject's awx-read instance answers. No outside request is routed here. */
export const AWX_READ_PATH = "/internal/awx-read";

type Method = "GET" | "POST";
/** Every call this module may make: method, path (a fixed string, or one id-shaped pattern) and the query keys it may
 *  carry. Nothing else. A patterned row is counted under its path ("{id}"), never with the id itself. */
export const AWX_READ_ALLOWED: readonly { method: Method; path: string; pattern?: RegExp; query: readonly string[] }[] = [
  { method: "POST", path: "/api/v1/authentication/login", query: [] },
  { method: "GET", path: "/api/v1/balances/current", query: [] },
  { method: "GET", path: "/api/v1/global_accounts", query: ["page_num", "page_size"] },
  { method: "GET", path: "/api/v1/financial_transactions", query: ["from_created_at", "to_created_at", "page_num", "page_size"] },
  { method: "GET", path: "/api/v1/fx/rates/current", query: ["buy_currency", "sell_currency"] },
  { method: "GET", path: "/api/v1/transfers", query: ["page_num", "page_size"] },
  { method: "GET", path: "/api/v1/beneficiaries", query: ["page_num", "page_size"] },
  { method: "GET", path: "/api/v1/issuing/cards", query: ["page_num", "page_size"] },
  { method: "GET", path: "/api/v1/issuing/transactions", query: ["page_num", "page_size"] },
  // One card, by its id: the list carries no spending limits, the card's own record does (live, 14 Nov). Only the card
  // itself: never /details (the card number), never a write. The pattern is anchored: a UUID and nothing after it.
  { method: "GET", path: "/api/v1/issuing/cards/{id}", pattern: /^\/api\/v1\/issuing\/cards\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, query: [] },
];

/** The table's row for a call, by exact path or by its anchored pattern; none when the call is not listed. */
const rowFor = (method: string, pathname: string) => AWX_READ_ALLOWED.find((a) => a.method === method && (a.pattern ? a.pattern.test(pathname) : a.path === pathname));

/** A call outside the table: refused before anything is sent. */
export class AwxReadNotAllowed extends Error {
  constructor(method: string, url: string) { super(`not allowed: ${method} ${url.replace(/\?.*$/, "")}`); this.name = "AwxReadNotAllowed"; }
}
/** Why a view has no live answer: fixed words, never Airwallex's own, a key or a token. */
export class AwxReadUnavailable extends Error {
  constructor(readonly reason: string, readonly code: "no_key" | "ceiling" | "no_answer" | "refused" | "not_in_scope" | "bad_answer" | "switched_off" = "no_answer") { super(reason); this.name = "AwxReadUnavailable"; }
}

/** The query value a key may carry: short, plain characters (dates, numbers, currency codes). */
const QUERY_VALUE = /^[A-Za-z0-9:+.\-]{1,40}$/;

/** The URL for a call, only if the table has it, on the sandbox host, over HTTPS, with only its own query keys; else it throws. */
export function readAllowedUrl(method: string, url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new AwxReadNotAllowed(method, "(not a URL)"); }
  const row = rowFor(method, u.pathname);
  const queryOk = !!row && [...u.searchParams].every(([k, v]) => row.query.includes(k) && QUERY_VALUE.test(v)) && new Set([...u.searchParams.keys()]).size === [...u.searchParams.keys()].length;
  if (u.protocol !== "https:" || u.host !== AWX_SANDBOX_HOST || u.port || u.username || u.password || u.hash || !row || !queryOk) throw new AwxReadNotAllowed(method, url);
  return u;
}

/** The views the page asks for, each a fixed set of calls. */
export const AWX_VIEWS = ["balances", "accounts", "financial", "rates", "transfers", "beneficiaries", "issuing", "calls"] as const;
export type AwxView = (typeof AWX_VIEWS)[number];
export const isAwxView = (v: unknown): v is AwxView => typeof v === "string" && (AWX_VIEWS as readonly string[]).includes(v);

/** The currency pairs the live rates are read for: the currencies in Purser's books (EUR the base; USD and GBP bills). */
export const RATE_PAIRS: readonly [sell: string, buy: string][] = [["USD", "EUR"], ["GBP", "EUR"], ["EUR", "USD"]];
/** The window of the recorded awx-1 run (7 Nov), the one Purser's ledger reconciles with Airwallex's financial transactions. */
export const RUN_WINDOW = { from: "2026-11-07T12:00:00+0000", to: "2026-11-07T14:00:00+0000" } as const;

/** How long one view's answer serves everyone. */
export const READ_TTL_SECONDS = 45;
/** Calls to Airwallex a minute and a UTC day, all visitors together. */
export const READ_PER_MINUTE = 40;
export const READ_DAILY_CEILING = 1500;
const TIMEOUT_MS = 8_000;
/** The newest active cards read one by one for their limits (the list has none). */
export const CARD_DETAILS = 8;
/** Financial transactions read in one page: Airwallex's largest page (page_size ≤ 1000). */
export const FT_PAGE = 1000;
const TOKEN_EARLY_MS = 60_000;
const TOKEN_DEFAULT_MS = 25 * 60_000;

/** One view's answer as the page gets it. */
export type AwxReadAnswer =
  | { view: AwxView; source: "airwallex-sandbox"; host: typeof AWX_SANDBOX_HOST; read_at: string; cache_seconds: number; data: unknown }
  | { view: AwxView; source: "unavailable"; host: typeof AWX_SANDBOX_HOST; code: AwxReadUnavailable["code"]; reason: string; checked_at: string };

// --- Reading Airwallex's answers: field by field, only what the page shows, as strings; anything off is left out. ---
type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? v as J : null);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const num = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && /^-?\d{1,15}(\.\d{1,8})?$/.test(v)) return v;
  return null;
};
const items = (v: unknown): J[] => { const o = obj(v); const a = Array.isArray(v) ? v : Array.isArray(o?.items) ? o.items as unknown[] : []; return a.map(obj).filter((x): x is J => !!x); };
/** The last four characters of an account number or IBAN (sandbox test details, still shown masked). */
const last4 = (v: unknown): string | null => { const s = str(v, 64)?.replace(/\s/g, ""); return s && s.length >= 4 ? s.slice(-4) : null; };

export function balancesOf(raw: unknown): { currency: string; available: string | null; pending: string | null; reserved: string | null; total: string | null }[] {
  return items(raw).map((b) => ({ currency: str(b.currency, 3) ?? "", available: num(b.available_amount), pending: num(b.pending_amount), reserved: num(b.reserved_amount), total: num(b.total_amount) }))
    .filter((b) => /^[A-Z]{3}$/.test(b.currency)).sort((a, b) => a.currency.localeCompare(b.currency));
}

export function accountsOf(raw: unknown) {
  return items(raw).map((a) => {
    const inst = obj(a.institution);
    const routing = (Array.isArray(a.routing_codes) ? a.routing_codes : []).map(obj).filter((x): x is J => !!x).map((r) => ({ type: str(r.type, 40), value: str(r.value, 40) })).filter((r) => r.type && r.value);
    return {
      id: str(a.id, 64), name: str(a.account_name), nickname: str(a.nick_name), status: str(a.status, 40), country: str(a.country_code, 2),
      currency: str(a.currency, 3), institution: str(inst?.name), swift: str(a.swift_code, 11), iban_last4: last4(a.iban), account_number_last4: last4(a.account_number), routing,
    };
  }).filter((a) => a.id);
}

export function financialOf(raw: unknown) {
  return items(raw).map((f) => ({
    id: str(f.id, 64), source_id: str(f.source_id, 64), source_type: str(f.source_type, 40), transaction_type: str(f.transaction_type, 40),
    currency: str(f.currency, 3), amount: num(f.amount), fee: num(f.fee), net: num(f.net), status: str(f.status, 20), created_at: str(f.created_at, 40), settled_at: str(f.settled_at, 40),
  })).filter((f) => f.id);
}

export function rateOf(raw: unknown, sell: string, buy: string) {
  const r = obj(raw);
  const rate = num(r?.rate) ?? num(r?.client_rate);
  if (!r || !rate || (r.sell_currency !== undefined && r.sell_currency !== sell) || (r.buy_currency !== undefined && r.buy_currency !== buy)) return null;
  return { sell_currency: sell, buy_currency: buy, rate, pair: str(r.currency_pair, 6), created_at: str(r.created_at, 40), conversion_date: str(r.conversion_date, 40) };
}

export function transfersOf(raw: unknown) {
  return items(raw).map((t) => {
    const meta = obj(t.metadata);
    const sha = typeof meta?.approval_sha256 === "string" && /^[0-9a-f]{64}$/.test(meta.approval_sha256) ? meta.approval_sha256 : null;
    return {
      id: str(t.id, 64), status: str(t.status, 40), amount: num(t.transfer_amount) ?? num(t.amount_beneficiary_receives), currency: str(t.transfer_currency, 3),
      source_amount: num(t.source_amount) ?? num(t.amount_payer_pays), source_currency: str(t.source_currency, 3), fee: num(t.fee_amount), beneficiary_id: str(t.beneficiary_id, 64),
      reference: str(t.reference, 140), request_id: str(t.request_id, 64), short_reference_id: str(t.short_reference_id, 40), created_at: str(t.created_at, 40), approval_sha256: sha,
    };
  }).filter((t) => t.id);
}

export function beneficiariesOf(raw: unknown) {
  return items(raw).map((b) => {
    const ben = obj(b.beneficiary), bank = obj(ben?.bank_details);
    // The sandbox's beneficiaries carry the payee's name on the bank account (live, 14 Nov), not always company_name.
    const name = str(ben?.company_name) ?? str(bank?.account_name) ?? [str(ben?.first_name), str(ben?.last_name)].filter(Boolean).join(" ");
    return {
      id: str(b.id, 64), nickname: str(b.nickname), name: name || null, entity_type: str(ben?.entity_type, 20), country: str(bank?.bank_country_code, 2), currency: str(bank?.account_currency, 3),
      bank: str(bank?.bank_name), iban_last4: last4(bank?.iban), account_number_last4: last4(bank?.account_number), methods: (Array.isArray(b.transfer_methods) ? b.transfer_methods : Array.isArray(b.payment_methods) ? b.payment_methods : []).filter((m): m is string => typeof m === "string").slice(0, 4),
      status: str(b.status, 40),
    };
  }).filter((b) => b.id);
}

export function cardsOf(raw: unknown) {
  return items(raw).map((c) => {
    const ac = obj(c.authorization_controls), tl = obj(ac?.transaction_limits);
    const limits = (Array.isArray(tl?.limits) ? tl.limits : []).map(obj).filter((x): x is J => !!x).map((l) => ({ amount: num(l.amount), interval: str(l.interval, 20) })).filter((l) => l.amount && l.interval);
    return {
      id: str(c.card_id, 64) ?? str(c.id, 64), status: str(c.card_status, 20) ?? str(c.status, 20), nickname: str(c.nick_name), brand: str(c.brand, 20), last4: last4(c.card_number),
      created_at: str(c.created_at, 40), currency: str(tl?.currency, 3), limits,
      merchant_categories: (Array.isArray(ac?.allowed_merchant_categories) ? ac.allowed_merchant_categories : []).filter((m): m is string => typeof m === "string" && /^\d{4}$/.test(m)).slice(0, 12),
      active_to: str(ac?.active_to, 40),
    };
  }).filter((c) => c.id);
}

export function cardTransactionsOf(raw: unknown) {
  return items(raw).map((t) => {
    const m = obj(t.merchant);
    return {
      id: str(t.transaction_id, 64) ?? str(t.id, 64), card_id: str(t.card_id, 64), type: str(t.transaction_type, 40), status: str(t.status, 40),
      amount: num(t.transaction_amount) ?? num(t.billing_amount), currency: str(t.transaction_currency, 3) ?? str(t.billing_currency, 3),
      merchant: str(m?.name), mcc: str(m?.category_code, 4), at: str(t.transaction_date, 40) ?? str(t.created_at, 40), failure_reason: str(t.failure_reason, 80),
    };
  }).filter((t) => t.id);
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const utcMinute = (d: Date) => d.toISOString().slice(0, 16);
/** "2026-11-06T09:32:24+0000" or any ISO time, as epoch milliseconds; null when it is not a time. */
const timeOf = (v: unknown): number | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isFinite(t) ? t : null;
};

/** The read gateway's desk: one per Durable Object instance ("awx-read"), its cache and counters in that instance's SQL. */
export class AwxReadDesk {
  private token: { value: string; expiresAt: number } | null = null;
  private loggingIn: Promise<string> | null = null;
  private readonly inFlight = new Map<AwxView, Promise<AwxReadAnswer>>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly sql: Sql, private readonly cfg: { clientId?: string; apiKey?: string; off?: boolean; fetchImpl?: typeof fetch; now?: () => number }) {
    this.fetchImpl = cfg.fetchImpl ?? ((...a) => fetch(...a));
    this.now = cfg.now ?? (() => Date.now());
    sql.exec("CREATE TABLE IF NOT EXISTS ar_cache (view TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS ar_minute (minute TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS ar_calls (day TEXT NOT NULL, endpoint TEXT NOT NULL, n INTEGER NOT NULL, ok INTEGER NOT NULL, PRIMARY KEY (day, endpoint))");
  }

  /** The Durable Object's route: GET ?view=<view>. Anything else is a 404. */
  async fetch(req: Request): Promise<Response> {
    const view = new URL(req.url).searchParams.get("view");
    if (req.method !== "GET" || !isAwxView(view)) return Response.json({ error: "no such view" }, { status: 404 });
    return Response.json(await this.read(view), { headers: { "cache-control": "no-store" } });
  }

  /** One view: from the cache while it is fresh, else read once for everyone. */
  async read(view: AwxView): Promise<AwxReadAnswer> {
    if (view === "calls") return this.callsAnswer();
    const cached = this.sql.exec("SELECT at, body FROM ar_cache WHERE view = ?", view).toArray() as { at: number; body: string }[];
    if (cached[0] && this.now() - cached[0].at < READ_TTL_SECONDS * 1000) return JSON.parse(cached[0].body) as AwxReadAnswer;
    const running = this.inFlight.get(view);
    if (running) return running;
    const p = this.refresh(view).finally(() => this.inFlight.delete(view));
    this.inFlight.set(view, p);
    return p;
  }

  private async refresh(view: Exclude<AwxView, "calls">): Promise<AwxReadAnswer> {
    const at = new Date(this.now()).toISOString();
    let answer: AwxReadAnswer;
    try {
      const data = await this.load(view);
      answer = { view, source: "airwallex-sandbox", host: AWX_SANDBOX_HOST, read_at: at, cache_seconds: READ_TTL_SECONDS, data };
    } catch (e) {
      const u = e instanceof AwxReadUnavailable ? e : new AwxReadUnavailable("the Airwallex sandbox gave no usable answer", "bad_answer");
      answer = { view, source: "unavailable", host: AWX_SANDBOX_HOST, code: u.code, reason: u.reason, checked_at: at };
    }
    // A failure is kept too (a shorter while is not needed: the sandbox is not asked again on every visit).
    this.sql.exec("INSERT INTO ar_cache (view, at, body) VALUES (?, ?, ?) ON CONFLICT(view) DO UPDATE SET at = excluded.at, body = excluded.body", view, this.now(), JSON.stringify(answer));
    return answer;
  }

  private async load(view: Exclude<AwxView, "calls">): Promise<unknown> {
    if (this.cfg.off) throw new AwxReadUnavailable("the Airwallex sandbox reads are switched off", "switched_off");
    if (!this.cfg.clientId || !this.cfg.apiKey) throw new AwxReadUnavailable("this deployment holds no Airwallex sandbox key", "no_key");
    switch (view) {
      case "balances": return { balances: balancesOf(await this.get("/api/v1/balances/current")) };
      case "accounts": return { accounts: accountsOf(await this.get("/api/v1/global_accounts", { page_num: "0", page_size: "20" })) };
      case "financial": {
        // The newest movements (the last 30 days), and the recorded run's window for the reconciliation.
        const to = new Date(this.now()), from = new Date(this.now() - 30 * 86_400_000);
        const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");
        // One page of FT_PAGE (Airwallex's largest) each. has_more is kept: a window with more rows than one page is said
        // to be cut, and the reconciliation then concludes nothing (cloud/src/awxLive.ts), never "0 differences".
        const page = async (q: Record<string, string>) => { const j = await this.get("/api/v1/financial_transactions", { ...q, page_num: "0", page_size: String(FT_PAGE) }); return { rows: financialOf(j), more: obj(j)?.has_more === true }; };
        const recent = await page({ from_created_at: iso(from), to_created_at: iso(to) });
        const run = await page({ from_created_at: RUN_WINDOW.from, to_created_at: RUN_WINDOW.to });
        recent.rows.sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0));
        return { recent: recent.rows.slice(0, 25), recent_cut: recent.more, recent_rows: recent.rows.length, run_window: RUN_WINDOW, run: run.rows, run_complete: !run.more };
      }
      case "rates": {
        const rates = [];
        for (const [sell, buy] of RATE_PAIRS) {
          const r = rateOf(await this.get("/api/v1/fx/rates/current", { sell_currency: sell, buy_currency: buy }), sell, buy);
          if (!r) throw new AwxReadUnavailable("the Airwallex sandbox's rate was not in the expected form", "bad_answer");
          rates.push(r);
        }
        return { rates };
      }
      case "transfers": return { transfers: transfersOf(await this.get("/api/v1/transfers", { page_num: "0", page_size: "20" })) };
      case "beneficiaries": return { beneficiaries: beneficiariesOf(await this.get("/api/v1/beneficiaries", { page_num: "0", page_size: "20" })) };
      case "issuing": {
        // Issuing needs its own scope on the key. Without it Airwallex answers 401/403: said so, not hidden.
        // Airwallex lists the oldest first (live, 14 Nov): a page of 100, the newest shown. The list carries no spending
        // limits, so the newest active cards are read one by one (GET /issuing/cards/{id}, at most CARD_DETAILS).
        const newest = <T>(rows: T[], at: (r: T) => unknown) => [...rows].sort((a, b) => (timeOf(at(b)) ?? 0) - (timeOf(at(a)) ?? 0));
        const listed = newest(cardsOf(await this.get("/api/v1/issuing/cards", { page_num: "0", page_size: "100" }, true)), (c) => c.created_at).slice(0, 12);
        const cards = [];
        let details = 0;
        for (const c of listed) {
          if (c.status === "ACTIVE" && details < CARD_DETAILS && c.id && /^[0-9a-f-]{36}$/.test(c.id)) {
            details++;
            const full = cardsOf({ items: [await this.get(`/api/v1/issuing/cards/${c.id}`, {}, true)] })[0];
            cards.push(full ? { ...c, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))) } : c);
          } else cards.push(c);
        }
        const transactions = newest(cardTransactionsOf(await this.get("/api/v1/issuing/transactions", { page_num: "0", page_size: "100" }, true)), (t) => t.at).slice(0, 20);
        return { cards, transactions };
      }
    }
  }

  /** The calls made today, by endpoint (no query, no id), for the page's "Airwallex calls" panel. */
  private callsAnswer(): AwxReadAnswer {
    const now = new Date(this.now());
    const rows = this.sql.exec("SELECT endpoint, n, ok FROM ar_calls WHERE day = ? ORDER BY endpoint", utcDay(now)).toArray() as { endpoint: string; n: number; ok: number }[];
    return { view: "calls", source: "airwallex-sandbox", host: AWX_SANDBOX_HOST, read_at: now.toISOString(), cache_seconds: 0,
      data: { day: utcDay(now), total: rows.reduce((s, r) => s + r.n, 0), ceiling: READ_DAILY_CEILING, per_minute: READ_PER_MINUTE, cache_seconds: READ_TTL_SECONDS, endpoints: rows.map((r) => ({ endpoint: r.endpoint, calls: r.n, ok: r.ok })) } };
  }

  /** Check and count one call under both ceilings, before it is sent. */
  private admit(endpoint: string): void {
    const now = new Date(this.now()), day = utcDay(now), minute = utcMinute(now);
    const today = (this.sql.exec("SELECT COALESCE(SUM(n), 0) AS n FROM ar_calls WHERE day = ?", day).toArray() as { n: number }[])[0]?.n ?? 0;
    const thisMinute = (this.sql.exec("SELECT n FROM ar_minute WHERE minute = ?", minute).toArray() as { n: number }[])[0]?.n ?? 0;
    if (today >= READ_DAILY_CEILING) throw new AwxReadUnavailable(`today's ceiling of ${READ_DAILY_CEILING} Airwallex sandbox calls is reached`, "ceiling");
    if (thisMinute >= READ_PER_MINUTE) throw new AwxReadUnavailable("too many Airwallex sandbox calls this minute; try again in a minute", "ceiling");
    this.sql.exec("INSERT INTO ar_minute (minute, n) VALUES (?, 1) ON CONFLICT(minute) DO UPDATE SET n = n + 1", minute);
    this.sql.exec("DELETE FROM ar_minute WHERE minute < ?", minute);
    this.sql.exec("INSERT INTO ar_calls (day, endpoint, n, ok) VALUES (?, ?, 1, 0) ON CONFLICT(day, endpoint) DO UPDATE SET n = n + 1", day, endpoint);
    this.sql.exec("DELETE FROM ar_calls WHERE day < ?", day);
  }
  private answered(endpoint: string): void {
    this.sql.exec("UPDATE ar_calls SET ok = ok + 1 WHERE day = ? AND endpoint = ?", utcDay(new Date(this.now())), endpoint);
  }

  /** The one way out: the table decides, the ceilings count, then fetch. Failures become fixed reasons. */
  private async call(method: Method, path: string, query: Record<string, string>, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
    const u = new URL(`https://${AWX_SANDBOX_HOST}${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    const url = readAllowedUrl(method, u.toString());
    // Counted by the table's own path: a card's id never reaches the calls panel.
    const endpoint = `${method} ${rowFor(method, url.pathname)!.path}`;
    this.admit(endpoint);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers: { ...headers, "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new AwxReadUnavailable("the Airwallex sandbox did not answer in time", "no_answer");
    }
    const json = await res.json().catch(() => null);
    if (res.status >= 200 && res.status < 300) this.answered(endpoint);
    return { status: res.status, json };
  }

  /** The bearer token: one login at a time, shared by every view refreshing at once (9 views made up to 9 logins before). */
  private bearer(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_EARLY_MS > this.now()) return Promise.resolve(this.token.value);
    return (this.loggingIn ??= this.login().finally(() => { this.loggingIn = null; }));
  }

  private async login(): Promise<string> {
    this.token = null;
    const r = await this.call("POST", "/api/v1/authentication/login", {}, { "x-client-id": this.cfg.clientId!, "x-api-key": this.cfg.apiKey! });
    const j = obj(r.json), token = j?.token;
    if (r.status < 200 || r.status >= 300 || typeof token !== "string" || token.length < 20) throw new AwxReadUnavailable(`the Airwallex sandbox refused the login (HTTP ${r.status})`, "refused");
    const until = timeOf(j?.expires_at);
    this.token = { value: token, expiresAt: Math.min(until ?? this.now() + TOKEN_DEFAULT_MS, this.now() + TOKEN_DEFAULT_MS) };
    return token;
  }

  /** One GET with the bearer token; a token Airwallex no longer takes is dropped and the login made once more. */
  private async get(path: string, query: Record<string, string> = {}, scoped = false): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.bearer();
      const r = await this.call("GET", path, query, { authorization: `Bearer ${token}` });
      if (r.status === 401 && attempt === 0 && !scoped) { this.token = null; continue; }
      if (scoped && (r.status === 401 || r.status === 403)) throw new AwxReadUnavailable("the sandbox key has no Issuing scope, so cards and their authorizations cannot be read", "not_in_scope");
      if (r.status < 200 || r.status >= 300) throw new AwxReadUnavailable(`the Airwallex sandbox answered HTTP ${r.status} for ${path.replace(/^\/api\/v1/, "")}`, "refused");
      return r.json;
    }
    throw new AwxReadUnavailable("the Airwallex sandbox refused the token", "refused");
  }
}
