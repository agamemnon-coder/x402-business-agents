// Airwallex sandbox REST client. It is the only code that holds the client id, API key and bearer token.
// Calls run one at a time, at most 5 per second, with backoff on 429 (and, for reads, on 502/503/504). Money-moving creates always
// carry a caller-chosen request_id, so a retry after a timeout cannot create a second payment.

import { redactSecrets } from "../lib/redact.js";
import { AirwallexBudgetSpent, budgetFromEnv } from "./callBudget.js";
import { ACCOUNT_ID } from "./platform.js";

export const SANDBOX_BASE = "https://api.sandbox.airwallex.com/api/v1";

/**
 * Airwallex's answers about its own fee configuration (agent run 1). Only for these is its free-text message kept
 * (redacted): it is what Airwallex support asks for. Any other error keeps only its code and the trace and request ids,
 * since the message can name a payee or bank details, and audit fields feed the dashboard and the public relay.
 */
export const AIRWALLEX_FEE_CODES: ReadonlySet<string> = new Set(["fee_unknown", "unconfigured_client_fee"]);

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Minimum gap between calls. 200 ms keeps us at 5/s, half the sandbox's per-endpoint limit. */
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long one HTTP call may take before it is abandoned (a POST then counts as ambiguous). Default 30 s. */
  timeoutMs?: number;
  /**
   * Purser as an Airwallex platform (docs/airwallex-platform.md): every call (never the login) is made on behalf of this
   * connected account, with the `x-on-behalf-of` header Airwallex documents for platforms, so it happens in that
   * company's own wallet.
   */
  onBehalfOf?: string;
}

/** An Airwallex account id (acct_…), defined with the platform rail, which the cloud imports without this Node-only client. */
export { ACCOUNT_ID };

/** What Airwallex needs to find one request in its own logs: the response's trace and request ids. */
export interface AirwallexTrace {
  traceId?: string | null;
  requestId?: string | null;
}

/** A header value kept only when it is a plain id: nothing from a header goes into a log as it came. */
const plainId = (v: string | null | undefined): string | null => (v && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null);

/** The trace headers of an Airwallex answer (x-b3-traceid; x-request-id or request-id), if present. */
export function traceOf(headers: Headers): AirwallexTrace {
  return { traceId: plainId(headers.get("x-b3-traceid")), requestId: plainId(headers.get("x-request-id") ?? headers.get("request-id")) };
}

export class AirwallexError extends Error {
  /** The error body, redacted (never a key or token, even one Airwallex echoes back). */
  readonly body: unknown;
  /** Airwallex's x-b3-traceid for this answer, so the request can be shown to Airwallex (agent run 1, 2 November). */
  readonly traceId: string | null;
  /** Airwallex's request id header for this answer (not our request_id), if it sent one. */
  readonly awxRequestId: string | null;
  /** Airwallex's own words, for the fee codes only (AIRWALLEX_FEE_CODES), redacted, at most 300 characters; else null. */
  readonly awxMessage: string | null;

  constructor(
    readonly status: number,
    readonly code: string | undefined,
    body: unknown,
    readonly path: string,
    trace: AirwallexTrace = {},
  ) {
    const message = (body as { message?: unknown } | null)?.message;
    const awxMessage = AIRWALLEX_FEE_CODES.has(code ?? "") && typeof message === "string" && message.trim() ? redactSecrets(message.trim()).slice(0, 300) : null;
    const traceId = plainId(trace.traceId);
    super(`Airwallex ${path} -> ${status}${code ? ` ${code}` : ""}${awxMessage ? `: ${awxMessage}` : ""}${traceId ? ` (trace ${traceId})` : ""}`);
    this.body = redact(body);
    this.traceId = traceId;
    this.awxRequestId = plainId(trace.requestId);
    this.awxMessage = awxMessage;
  }
}

/** A create whose answer never arrived. The caller must look it up by request_id before any retry. */
export class AirwallexAmbiguous extends Error {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`Airwallex ${path}: no answer; outcome unknown`);
  }
}

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_EARLY_MS = 5 * 60 * 1000;
const MAX_429_RETRIES = 4;
/** Answers that mean "try again shortly": a gateway or the service briefly down. Only reads are retried. */
const TRANSIENT = new Set([502, 503, 504]);

export function fromEnv(env = process.env): AirwallexConfig | null {
  const clientId = env.AIRWALLEX_CLIENT_ID;
  const apiKey = env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) return null;
  // A live run with an approved call budget (src/airwallex/callBudget.ts): every request is counted, none goes over it.
  const budgeted = budgetFromEnv(env, (...a) => fetch(...a));
  // Purser as a platform (AIRWALLEX_PLATFORM=on): the company's connected account, when it has one.
  const onBehalfOf = env.AIRWALLEX_PLATFORM === "on" && env.AIRWALLEX_ON_BEHALF_OF ? env.AIRWALLEX_ON_BEHALF_OF : undefined;
  return { clientId, apiKey, ...(budgeted ? { fetchImpl: budgeted } : {}), ...(onBehalfOf ? { onBehalfOf } : {}) };
}

export class Airwallex {
  private token: { value: string; expiresAt: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly minGapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  /** The connected account every call is made for, or null for the company's own account. */
  get onBehalfOf(): string | null { return this.cfg.onBehalfOf ?? null; }

  constructor(private readonly cfg: AirwallexConfig) {
    if (cfg.onBehalfOf !== undefined && !ACCOUNT_ID.test(cfg.onBehalfOf)) throw new Error("onBehalfOf is not an Airwallex account id (acct_…)");
    this.base = cfg.baseUrl ?? SANDBOX_BASE;
    if (!this.base.startsWith("https://api.sandbox.airwallex.com/")) throw new Error("this build only talks to the Airwallex sandbox");
    this.fetch = cfg.fetchImpl ?? fetch;
    this.minGapMs = cfg.minGapMs ?? 200;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = cfg.now ?? Date.now;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
  }

  /** Serialises every call through one queue and spaces them out. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastCallAt + this.minGapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCallAt = this.now();
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async login(): Promise<string> {
    const res = await this.fetch(`${this.base}/authentication/login`, {
      method: "POST",
      headers: { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; code?: string };
    if (!res.ok || !body.token) throw new AirwallexError(res.status, body.code, body, "/authentication/login", traceOf(res.headers));
    this.token = { value: body.token, expiresAt: this.now() + TOKEN_LIFETIME_MS };
    return body.token;
  }

  private async bearer(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_EARLY_MS > this.now()) return this.token.value;
    return this.login();
  }

  /**
   * One HTTP call. GETs are safe to retry. For POSTs, a network error or 5xx becomes AirwallexAmbiguous:
   * the caller resolves it by request_id (build plan 2.5), never by blind resending.
   */
  async call<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    return this.enqueue(async () => {
      const url = new URL(this.base + path);
      for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
      for (let attempt = 0; ; attempt++) {
        const token = await this.bearer();
        let res: Response;
        try {
          res = await this.fetch(url, {
            method,
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(this.cfg.onBehalfOf ? { "x-on-behalf-of": this.cfg.onBehalfOf } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (err) {
          // Refused by the call budget before it was sent: nothing reached Airwallex, so it is not ambiguous.
          if (err instanceof AirwallexBudgetSpent) throw err;
          if (method === "POST") throw new AirwallexAmbiguous(path, err);
          if (attempt < MAX_429_RETRIES) { await this.sleep(500 * 2 ** attempt); continue; }
          throw err;
        }
        if (res.status === 401 && attempt === 0) { this.token = null; continue; }
        if (res.status === 429 && attempt < MAX_429_RETRIES) {
          const after = Number(res.headers.get("retry-after"));
          await this.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt);
          continue;
        }
        // A brief outage on Airwallex's side (502, 503, 504): a read is safe to ask again; a POST never is (below).
        if (method === "GET" && TRANSIENT.has(res.status) && attempt < MAX_429_RETRIES) { await this.sleep(500 * 2 ** attempt); continue; }
        const json = (await res.json().catch(() => null)) as unknown;
        if (res.status >= 500 && method === "POST") throw new AirwallexAmbiguous(path, new AirwallexError(res.status, undefined, json, path, traceOf(res.headers)));
        if (!res.ok) {
          const code = (json as { code?: string } | null)?.code;
          throw new AirwallexError(res.status, code, json, path, traceOf(res.headers));
        }
        return json as T;
      }
    });
  }
}

/** Strips anything that looks like a secret before a body goes into a log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, /token|api[_-]?key|secret|authorization|client[_-]?id/i.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}
