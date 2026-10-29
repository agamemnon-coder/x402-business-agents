// Airwallex sandbox REST client. It is the only code that holds the client id, API key and bearer token.
// Calls run one at a time, at most 5 per second, with backoff on 429. Money-moving creates always
// carry a caller-chosen request_id, so a retry after a timeout cannot create a second payment.

export const SANDBOX_BASE = "https://api.sandbox.airwallex.com/api/v1";

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Minimum gap between calls. 200 ms keeps us at 5/s, half the sandbox's per-endpoint limit. */
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class AirwallexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(`Airwallex ${path} -> ${status}${code ? ` ${code}` : ""}`);
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

export function fromEnv(env = process.env): AirwallexConfig | null {
  const clientId = env.AIRWALLEX_CLIENT_ID;
  const apiKey = env.AIRWALLEX_API_KEY;
  return clientId && apiKey ? { clientId, apiKey } : null;
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

  constructor(private readonly cfg: AirwallexConfig) {
    this.base = cfg.baseUrl ?? SANDBOX_BASE;
    if (!this.base.startsWith("https://api.sandbox.airwallex.com/")) throw new Error("this build only talks to the Airwallex sandbox");
    this.fetch = cfg.fetchImpl ?? fetch;
    this.minGapMs = cfg.minGapMs ?? 200;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = cfg.now ?? Date.now;
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
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; code?: string };
    if (!res.ok || !body.token) throw new AirwallexError(res.status, body.code, redact(body), "/authentication/login");
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
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch (err) {
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
        const json = (await res.json().catch(() => null)) as unknown;
        if (res.status >= 500 && method === "POST") throw new AirwallexAmbiguous(path, new AirwallexError(res.status, undefined, json, path));
        if (!res.ok) {
          const code = (json as { code?: string } | null)?.code;
          throw new AirwallexError(res.status, code, json, path);
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
