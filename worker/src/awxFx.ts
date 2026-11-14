// /try's live FX quote (14 Nov): the hands-on demo's engine (purser-try) asks this Worker, which holds the Airwallex
// sandbox key, for a quote when a test company's payment needs currency bought. The engine's Worker reaches it only
// through a service binding to the named entrypoint AwxFx (worker/src/index.ts, cloud/wrangler.try.jsonc): no outside
// request has a route to it. The desk lives in its own instance of the relay's Durable Object ("awx-fx"), so its counts
// and its cache are kept in one place and in order.
//
// Read-only and sandbox only: the one call is SandboxQuotes' allow-listed POST /api/v1/fx/quotes/create on
// api.sandbox.airwallex.com (worker/src/fxQuote.ts). Nothing is converted at Airwallex; the engine converts on its
// simulated bank at the quoted amounts. The key and the token never leave fxQuote.ts: an answer here carries the quote,
// Airwallex's own rate from the same answer, or a fixed reason, never Airwallex's words.
//
// Limits: AWX_FX_DAY quotes a UTC day in all, AWX_FX_COMPANY_DAY for one test company; a quote asked again for the
// same company, pair and amount is answered from the cache while it has at least AWX_FX_REUSE_MS left. Every call that
// is sent counts, also one that fails.
import type { Sql } from "./core.js";
import type { FxQuote } from "./fxQuote.js";

export const AWX_FX_DAY = 300;
export const AWX_FX_COMPANY_DAY = 6;
/** A cached quote is handed out again only while it is valid for at least this long. */
export const AWX_FX_REUSE_MS = 5 * 60_000;

export interface AwxFxAsk { company: string; buyCurrency: string; sellCurrency: string; buyAmount: string }
/** Why no live quote, as a fixed code (the engine's page says it in words). */
export type AwxFxReason = "bad_request" | "switched_off" | "no_key" | "day_cap" | "company_cap" | "unavailable";
export type AwxFxAnswer =
  | { ok: true; quote: FxQuote; market_rate: string; cached: boolean }
  | { ok: false; reason: AwxFxReason };

/** What the desk needs of Airwallex: SandboxQuotes.quoteAndMarket (a fake in the tests). */
export interface MarketQuotes { quoteAndMarket(a: { buyCurrency: string; sellCurrency: string; buyAmount: string }): Promise<{ quote: FxQuote; market_rate: string }> }

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class AwxFxDesk {
  private readonly now: () => number;

  /** source: null without the sandbox key. off: the Worker's switch AWX_FX ("off" stops every call). */
  constructor(private readonly sql: Sql, private readonly opts: { source: MarketQuotes | null; off: boolean; now?: () => number; day?: number; companyDay?: number }) {
    this.now = opts.now ?? (() => Date.now());
    sql.exec("CREATE TABLE IF NOT EXISTS awx_fx_calls (day TEXT NOT NULL, scope TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, scope))");
    sql.exec("CREATE TABLE IF NOT EXISTS awx_fx_cache (k TEXT PRIMARY KEY, valid_to INTEGER NOT NULL, body TEXT NOT NULL)");
  }

  /** Today's calls in all, for a check (never a company's). */
  callsToday(): number {
    return this.count(utcDay(this.now()), "*");
  }

  async quote(a: AwxFxAsk): Promise<AwxFxAnswer> {
    if (!a || typeof a !== "object" || typeof a.company !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(a.company)
      || !/^[A-Z]{3}$/.test(String(a.buyCurrency)) || !/^[A-Z]{3}$/.test(String(a.sellCurrency)) || a.buyCurrency === a.sellCurrency
      || typeof a.buyAmount !== "string" || !/^\d{1,9}\.\d{2}$/.test(a.buyAmount) || Number(a.buyAmount) <= 0) return { ok: false, reason: "bad_request" };
    if (this.opts.off) return { ok: false, reason: "switched_off" };
    if (!this.opts.source) return { ok: false, reason: "no_key" };
    const now = this.now();
    const k = `${a.company}|${a.buyCurrency}|${a.sellCurrency}|${a.buyAmount}`;
    this.sql.exec("DELETE FROM awx_fx_cache WHERE valid_to <= ?", now);
    const hit = this.sql.exec("SELECT valid_to, body FROM awx_fx_cache WHERE k = ?", k).toArray()[0] as { valid_to: number; body: string } | undefined;
    if (hit && hit.valid_to - now >= AWX_FX_REUSE_MS) {
      const kept = JSON.parse(hit.body) as { quote: FxQuote; market_rate: string };
      return { ok: true, quote: kept.quote, market_rate: kept.market_rate, cached: true };
    }
    const day = utcDay(now);
    this.sql.exec("DELETE FROM awx_fx_calls WHERE day < ?", day);
    if (this.count(day, "*") >= (this.opts.day ?? AWX_FX_DAY)) return { ok: false, reason: "day_cap" };
    if (this.count(day, a.company) >= (this.opts.companyDay ?? AWX_FX_COMPANY_DAY)) return { ok: false, reason: "company_cap" };
    for (const scope of ["*", a.company]) this.sql.exec("INSERT INTO awx_fx_calls (day, scope, n) VALUES (?, ?, 1) ON CONFLICT(day, scope) DO UPDATE SET n = n + 1", day, scope);
    let got: { quote: FxQuote; market_rate: string };
    try {
      got = await this.opts.source.quoteAndMarket({ buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmount: a.buyAmount });
    } catch {
      // Whatever went wrong (fxQuote.ts's fixed reasons, a timeout), only the code goes back: never Airwallex's words.
      return { ok: false, reason: "unavailable" };
    }
    const validTo = Date.parse(got.quote.valid_to_at);
    if (Number.isFinite(validTo) && validTo > now) this.sql.exec("INSERT INTO awx_fx_cache (k, valid_to, body) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET valid_to = excluded.valid_to, body = excluded.body", k, validTo, JSON.stringify(got));
    return { ok: true, quote: got.quote, market_rate: got.market_rate, cached: false };
  }

  private count(day: string, scope: string): number {
    const r = this.sql.exec("SELECT n FROM awx_fx_calls WHERE day = ? AND scope = ?", day, scope).toArray()[0] as { n: number } | undefined;
    return r?.n ?? 0;
  }
}
