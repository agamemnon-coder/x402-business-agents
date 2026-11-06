// /try/sign's live FX quote (P2, 6 Nov): the one place in the Worker that talks to Airwallex, read-only. It may make
// two calls and no other, to one host only, the sandbox:
//   POST /api/v1/authentication/login   (the sandbox key, from Worker secrets, for a bearer token)
//   POST /api/v1/fx/quotes/create       (a quote: a rate and amounts, valid for a while; nothing is converted)
// The table below is the whole of it: any other method, path or host throws before fetch is reached
// (test/try-fx.test.ts also reads this file for any other Airwallex path). No transfer, no conversion, no payment.
// The key and the bearer token stay in this module: never in an answer, an error message or a log line. The token is
// kept in memory until shortly before it expires.

/**
 * The sandbox host: Airwallex's test environment, the one host the repo's adapter uses (src/airwallex/client.ts,
 * SANDBOX_BASE). No other host is reachable from here. Creating a quote needs the key's "Conversion: Write" scope, which
 * would also allow a conversion: this table, not the key, is what keeps conversions out.
 */
export const AWX_SANDBOX_HOST = "api.sandbox.airwallex.com";
/** Every call this module may make, method and path. Nothing else. */
export const AWX_ALLOWED: readonly { method: "POST"; path: string }[] = [
  { method: "POST", path: "/api/v1/authentication/login" },
  { method: "POST", path: "/api/v1/fx/quotes/create" },
];

/** A quote as the terms carry it: strings only (the terms carry no numbers), the time in UTC. */
export interface FxQuote {
  quote_id: string;
  sell_currency: string;
  buy_currency: string;
  buy_amount: string;
  sell_amount: string;
  client_rate: string;
  valid_to_at: string;
  /** Where it came from: the Airwallex sandbox (the Worker), or a labelled stand-in (tests and local checks only). */
  source: "airwallex-sandbox" | "stand-in";
}

/** Why no live quote: a fixed reason, never Airwallex's words, a key or a token. */
export class QuoteUnavailable extends Error {
  constructor(readonly reason: string) { super(reason); this.name = "QuoteUnavailable"; }
}
/** A call outside the table: refused before anything is sent. */
export class AirwallexCallNotAllowed extends Error {
  constructor(method: string, url: string) { super(`not allowed: ${method} ${url.replace(/\?.*$/, "")}`); this.name = "AirwallexCallNotAllowed"; }
}

/** The URL for a call, only if the table has it, on the sandbox host, over HTTPS, with no query; else it throws. */
export function allowedUrl(method: string, url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new AirwallexCallNotAllowed(method, "(not a URL)"); }
  const listed = AWX_ALLOWED.some((a) => a.method === method && a.path === u.pathname);
  if (u.protocol !== "https:" || u.host !== AWX_SANDBOX_HOST || u.username || u.password || u.search || u.hash || !listed) throw new AirwallexCallNotAllowed(method, url);
  return u;
}

/** Where a quote comes from: the sandbox client below, or a stand-in in the tests and the local relay. */
export interface FxSource { quote(a: { buyCurrency: string; sellCurrency: string; buyAmount: string }): Promise<FxQuote> }

const TOKEN_EARLY_MS = 60_000;
const TOKEN_DEFAULT_MS = 25 * 60_000;
const TIMEOUT_MS = 8_000;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const twoDecimals = (v: unknown): string | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && AMOUNT.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) return null;
  const c = Math.round(n * 100);
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
};
/** "2026-11-06T09:32:24+0000" or any ISO time, as "2026-11-06T09:32:24Z"; null when it is not a time. */
const utc = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
};

/** The sandbox quote client: one login, its token kept until it nearly expires, then quotes. */
export class SandboxQuotes implements FxSource {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly cfg: { clientId: string; apiKey: string; fetchImpl?: typeof fetch; now?: () => number }) {
    this.fetchImpl = cfg.fetchImpl ?? ((...a) => fetch(...a));
    this.now = cfg.now ?? (() => Date.now());
  }

  /** The one way out: the table decides, then fetch. Answers are read as JSON; failures become fixed reasons. */
  private async call(method: "POST", path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const url = allowedUrl(method, `https://${AWX_SANDBOX_HOST}${path}`);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new QuoteUnavailable("the Airwallex sandbox did not answer");
    }
    const json = await res.json().then((j) => (typeof j === "object" && j !== null && !Array.isArray(j) ? j as Record<string, unknown> : null), () => null);
    return { status: res.status, json };
  }

  private async bearer(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_EARLY_MS > this.now()) return this.token.value;
    this.token = null;
    const r = await this.call("POST", "/api/v1/authentication/login", { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey });
    const token = r.json?.token;
    if (r.status < 200 || r.status >= 300 || typeof token !== "string" || token.length < 20) throw new QuoteUnavailable(`the Airwallex sandbox refused the login (HTTP ${r.status})`);
    const until = utc(r.json?.expires_at);
    const expiresAt = until ? Date.parse(until) : this.now() + TOKEN_DEFAULT_MS;
    this.token = { value: token, expiresAt: Math.min(expiresAt, this.now() + TOKEN_DEFAULT_MS) };
    return token;
  }

  async quote(a: { buyCurrency: string; sellCurrency: string; buyAmount: string }): Promise<FxQuote> {
    if (!/^[A-Z]{3}$/.test(a.buyCurrency) || !/^[A-Z]{3}$/.test(a.sellCurrency) || !twoDecimals(a.buyAmount)) throw new QuoteUnavailable("not a quote this page asks for");
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.bearer();
      const r = await this.call("POST", "/api/v1/fx/quotes/create", { authorization: `Bearer ${token}` },
        { buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: Number(a.buyAmount), validity: "MIN_15" });
      // A token Airwallex no longer takes: drop it and log in once more.
      if (r.status === 401 && attempt === 0) { this.token = null; continue; }
      if (r.status < 200 || r.status >= 300 || !r.json) throw new QuoteUnavailable(`the Airwallex sandbox gave no quote (HTTP ${r.status})`);
      return toQuote(r.json, a);
    }
    throw new QuoteUnavailable("the Airwallex sandbox gave no quote");
  }
}

/** Airwallex's answer as the terms carry it, checked field by field; anything off is no quote, not a guess. */
export function toQuote(j: Record<string, unknown>, asked: { buyCurrency: string; sellCurrency: string; buyAmount: string }): FxQuote {
  const quoteId = typeof j.quote_id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(j.quote_id) ? j.quote_id : null;
  const rate = typeof j.client_rate === "number" || (typeof j.client_rate === "string" && /^\d+(\.\d+)?$/.test(j.client_rate)) ? String(j.client_rate) : null;
  const buy = twoDecimals(j.buy_amount), sell = twoDecimals(j.sell_amount), validTo = utc(j.valid_to_at);
  if (!quoteId || !rate || !buy || !sell || !validTo || j.buy_currency !== asked.buyCurrency || j.sell_currency !== asked.sellCurrency || buy !== twoDecimals(asked.buyAmount)) {
    throw new QuoteUnavailable("the Airwallex sandbox's quote was not in the expected form");
  }
  return { quote_id: quoteId, sell_currency: asked.sellCurrency, buy_currency: asked.buyCurrency, buy_amount: buy, sell_amount: sell, client_rate: rate, valid_to_at: validTo, source: "airwallex-sandbox" };
}
