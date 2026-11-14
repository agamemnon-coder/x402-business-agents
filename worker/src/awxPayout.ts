// /try's live sandbox payout (step 2, 14 Nov): after a visitor's passkey signature is verified and the simulated bank
// has paid, the engine (purser-try) asks this Worker, through the AwxFx entrypoint, to make the same payment as an
// Airwallex SANDBOX transfer (test money) to the sandbox beneficiary of the main runs, with metadata.approval_sha256 =
// the hash of the signed terms. Off unless the Worker has the payout key and AWX_PAYOUT is not "off"; the engine's own
// switch (awx_payout, POST /v1/try/admin) is off until set.
//
// The client below may make these calls and no other, to one host only, the sandbox:
//   POST /api/v1/authentication/login      (the payout key, from Worker secrets, for a bearer token)
//   GET  /api/v1/balances/current          (is there enough before a transfer is asked for)
//   POST /api/v1/transfers/create          (the one transfer, request_id derived from the signed terms' hash)
//   GET  /api/v1/transfers/{id}            (its status, read back)
//   POST /api/v1/simulation/transfers/{id}/transition   (the sandbox's own simulation, on the visitor's tap: SENT, then PAID)
// Any other method, path or host throws before fetch is reached. The payout key is its own (AIRWALLEX_PAYOUT_CLIENT_ID,
// AIRWALLEX_PAYOUT_API_KEY): the quote key (fxQuote.ts) stays as it is. The key and the token never leave this module.
//
// Limits: one payout per test company (its first signed payment), AWX_PAYOUT_DAY a UTC day in all, at most
// AWX_PAYOUT_MAX_CENTS, EUR only, and never more than the sandbox's available EUR balance. The same signed terms asked
// again answer the stored transfer: never a second one.
import type { Sql } from "./core.js";

export const AWX_PAYOUT_HOST = "api.sandbox.airwallex.com";
/** Every call this module may make, method and path (a transfer id is one path segment of letters, digits and hyphens). */
export const AWX_PAYOUT_ALLOWED: readonly { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/v1\/authentication\/login$/ },
  { method: "GET", path: /^\/api\/v1\/balances\/current$/ },
  { method: "POST", path: /^\/api\/v1\/transfers\/create$/ },
  { method: "GET", path: /^\/api\/v1\/transfers\/[A-Za-z0-9-]{8,64}$/ },
  { method: "POST", path: /^\/api\/v1\/simulation\/transfers\/[A-Za-z0-9-]{8,64}\/transition$/ },
];
/** The sandbox beneficiary of the main runs (docs/runs/2026-11-10-airwallex-two-locks.md): the only payee. */
export const AWX_PAYOUT_BENEFICIARY = "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb";
export const AWX_PAYOUT_DAY = 100;
/** The demo's invoices go up to EUR 5,000 (src/engine/tryWorld.ts); nothing larger is ever sent. */
export const AWX_PAYOUT_MAX_CENTS = 500_000;
const TIMEOUT_MS = 6_000;

export class PayoutCallNotAllowed extends Error {
  constructor(method: string, url: string) { super(`not allowed: ${method} ${url.replace(/\?.*$/, "")}`); this.name = "PayoutCallNotAllowed"; }
}
/** A fixed reason, never Airwallex's words, a key or a token. ambiguous: the create may or may not have been made. */
export class PayoutFailed extends Error {
  constructor(readonly code: "unavailable" | "refused" | "ambiguous", reason: string) { super(reason); this.name = "PayoutFailed"; }
}

/** The URL for a call, only if the table has it, on the sandbox host, over HTTPS, with no query; else it throws. */
export function payoutUrl(method: string, url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new PayoutCallNotAllowed(method, "(not a URL)"); }
  const listed = AWX_PAYOUT_ALLOWED.some((a) => a.method === method && a.path.test(u.pathname));
  if (u.protocol !== "https:" || u.host !== AWX_PAYOUT_HOST || u.username || u.password || u.search || u.hash || !listed) throw new PayoutCallNotAllowed(method, url);
  return u;
}

/** Airwallex's request_id for the signed terms: their SHA-256's first 128 bits as a UUID. Same terms, same id. */
export function requestIdOf(termsSha256: string): string {
  const h = termsSha256.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface SandboxTransfer { id: string; status: string }
export interface PayoutRail {
  availableCents(currency: string): Promise<number>;
  createTransfer(t: { requestId: string; amount: string; currency: string; reference: string; approvalSha256: string }): Promise<SandboxTransfer>;
  transfer(id: string): Promise<SandboxTransfer>;
  /** The sandbox's simulation: the transfer moved to the next status (sandbox only; no money anywhere). */
  simulate(id: string, to: "SENT" | "PAID"): Promise<SandboxTransfer>;
}

const STATUS = /^[A-Z_]{2,40}$/;
const toTransfer = (j: Record<string, unknown> | null): SandboxTransfer | null => {
  const id = j && typeof j.id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(j.id) ? j.id : null;
  const status = j && typeof j.status === "string" && STATUS.test(j.status) ? j.status : null;
  return id && status ? { id, status } : null;
};

/** The sandbox payout client: one login, its token kept in memory until it nearly expires. */
export class SandboxPayouts implements PayoutRail {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly cfg: { clientId: string; apiKey: string; fetchImpl?: typeof fetch; now?: () => number }) {
    this.fetchImpl = cfg.fetchImpl ?? ((...a) => fetch(...a));
    this.now = cfg.now ?? (() => Date.now());
  }

  private async call(method: "GET" | "POST", path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | unknown[] | null }> {
    const url = payoutUrl(method, `https://${AWX_PAYOUT_HOST}${path}`);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new PayoutFailed(method === "POST" && path.endsWith("/transfers/create") ? "ambiguous" : "unavailable", "the Airwallex sandbox did not answer");
    }
    const json = await res.json().then((j) => (typeof j === "object" && j !== null ? j as Record<string, unknown> | unknown[] : null), () => null);
    return { status: res.status, json };
  }

  private async bearer(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    this.token = null;
    const r = await this.call("POST", "/api/v1/authentication/login", { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey });
    const token = r.json && !Array.isArray(r.json) ? r.json.token : undefined;
    if (r.status < 200 || r.status >= 300 || typeof token !== "string" || token.length < 20) throw new PayoutFailed("unavailable", `the Airwallex sandbox refused the login (HTTP ${r.status})`);
    this.token = { value: token, expiresAt: this.now() + 20 * 60_000 };
    return token;
  }

  private async authed(method: "GET" | "POST", path: string, body?: unknown) {
    const r = await this.call(method, path, { authorization: `Bearer ${await this.bearer()}` }, body);
    if (r.status === 401) { this.token = null; return this.call(method, path, { authorization: `Bearer ${await this.bearer()}` }, body); }
    return r;
  }

  async availableCents(currency: string): Promise<number> {
    const r = await this.authed("GET", "/api/v1/balances/current");
    if (r.status !== 200 || !Array.isArray(r.json)) throw new PayoutFailed("unavailable", `the Airwallex sandbox gave no balance (HTTP ${r.status})`);
    const row = r.json.find((b) => typeof b === "object" && b !== null && (b as { currency?: unknown }).currency === currency) as { available_amount?: unknown } | undefined;
    const v = row?.available_amount;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : 0;
  }

  async createTransfer(t: { requestId: string; amount: string; currency: string; reference: string; approvalSha256: string }): Promise<SandboxTransfer> {
    const r = await this.authed("POST", "/api/v1/transfers/create", {
      request_id: t.requestId, beneficiary_id: AWX_PAYOUT_BENEFICIARY, transfer_amount: Number(t.amount), transfer_currency: t.currency, source_currency: t.currency,
      transfer_method: "SWIFT", reference: t.reference, reason: "goods_purchased", metadata: { approval_sha256: t.approvalSha256 },
    });
    const tr = toTransfer(r.json && !Array.isArray(r.json) ? r.json : null);
    if (r.status >= 200 && r.status < 300 && tr) return tr;
    // A 5xx may have made it: the request_id makes asking again safe (Airwallex answers the same request_id once).
    throw new PayoutFailed(r.status >= 500 ? "ambiguous" : "refused", `the Airwallex sandbox did not take the transfer (HTTP ${r.status})`);
  }

  async simulate(id: string, to: "SENT" | "PAID"): Promise<SandboxTransfer> {
    const r = await this.authed("POST", `/api/v1/simulation/transfers/${encodeURIComponent(id)}/transition`, { next_status: to });
    const tr = toTransfer(r.json && !Array.isArray(r.json) ? r.json : null);
    if (r.status < 200 || r.status >= 300 || !tr) throw new PayoutFailed("refused", `the Airwallex sandbox did not move the transfer (HTTP ${r.status})`);
    return tr;
  }

  async transfer(id: string): Promise<SandboxTransfer> {
    const r = await this.authed("GET", `/api/v1/transfers/${encodeURIComponent(id)}`);
    const tr = toTransfer(r.json && !Array.isArray(r.json) ? r.json : null);
    if (r.status !== 200 || !tr) throw new PayoutFailed("unavailable", `the Airwallex sandbox gave no status (HTTP ${r.status})`);
    return tr;
  }
}

export interface PayoutAsk { company: string; terms_sha256: string; amount: string; currency: string; reference: string }
export type PayoutReason = "bad_request" | "switched_off" | "no_key" | "day_cap" | "company_cap" | "over_max" | "not_eur" | "balance_low" | "unavailable" | "refused" | "ambiguous";
export type PayoutAnswer =
  | { ok: true; transfer_id: string; status: string; amount: string; currency: string; request_id: string; again: boolean }
  | { ok: false; reason: PayoutReason };

export type SimulateAnswer = { ok: true; transfer_id: string; status: string } | { ok: false; reason: "bad_request" | "switched_off" | "no_key" | "no_transfer" | "in_approval" | "refused" | "unavailable"; status?: string };

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const centsOf = (s: string): number | null => (/^\d{1,9}\.\d{2}$/.test(s) ? Number(s.replace(".", "")) : null);

/** The desk in the "awx-payout" instance: the counts, the one row per company, the switch and the key's client. */
export class AwxPayoutDesk {
  private readonly now: () => number;

  constructor(private readonly sql: Sql, private readonly opts: { rail: PayoutRail | null; off: boolean; now?: () => number; day?: number }) {
    this.now = opts.now ?? (() => Date.now());
    sql.exec("CREATE TABLE IF NOT EXISTS awx_payouts (company TEXT PRIMARY KEY, terms_sha256 TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, transfer_id TEXT, status TEXT, amount TEXT NOT NULL, currency TEXT NOT NULL, day TEXT NOT NULL)");
  }

  async payout(a: PayoutAsk): Promise<PayoutAnswer> {
    if (!a || typeof a !== "object" || typeof a.company !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(a.company) || typeof a.terms_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(a.terms_sha256)
      || typeof a.amount !== "string" || centsOf(a.amount) === null || typeof a.currency !== "string" || !/^[A-Z]{3}$/.test(a.currency)
      || typeof a.reference !== "string" || a.reference.length > 140 || /[^\x20-\x7e]/.test(a.reference)) return { ok: false, reason: "bad_request" };
    if (this.opts.off) return { ok: false, reason: "switched_off" };
    if (!this.opts.rail) return { ok: false, reason: "no_key" };
    const rail = this.opts.rail;
    const kept = this.sql.exec("SELECT * FROM awx_payouts WHERE company = ?", a.company).toArray()[0] as { terms_sha256: string; request_id: string; transfer_id: string | null; status: string | null; amount: string; currency: string } | undefined;
    if (kept && kept.terms_sha256 !== a.terms_sha256) return { ok: false, reason: "company_cap" };
    if (kept?.status === "REFUSED") return { ok: false, reason: "refused" };
    if (kept?.transfer_id) {
      // The same signed terms again: the stored transfer, its status read back; never a second create.
      let status = kept.status ?? "UNKNOWN";
      try { status = (await rail.transfer(kept.transfer_id)).status; this.sql.exec("UPDATE awx_payouts SET status = ? WHERE company = ?", status, a.company); } catch { /* the stored status stands */ }
      return { ok: true, transfer_id: kept.transfer_id, status, amount: kept.amount, currency: kept.currency, request_id: kept.request_id, again: true };
    }
    const cents = centsOf(a.amount)!;
    if (a.currency !== "EUR") return { ok: false, reason: "not_eur" };
    if (cents <= 0 || cents > AWX_PAYOUT_MAX_CENTS) return { ok: false, reason: "over_max" };
    const day = utcDay(this.now());
    const requestId = requestIdOf(a.terms_sha256);
    if (!kept) {
      const today = (this.sql.exec("SELECT COUNT(*) AS n FROM awx_payouts WHERE day = ?", day).toArray()[0] as { n: number }).n;
      if (today >= (this.opts.day ?? AWX_PAYOUT_DAY)) return { ok: false, reason: "day_cap" };
      try {
        if ((await rail.availableCents(a.currency)) < cents) return { ok: false, reason: "balance_low" };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      // The row first: from here on this company's one payout is these terms, also if the create's answer is lost.
      this.sql.exec("INSERT INTO awx_payouts (company, terms_sha256, request_id, amount, currency, day) VALUES (?, ?, ?, ?, ?, ?)", a.company, a.terms_sha256, requestId, a.amount, a.currency, day);
    }
    let t: SandboxTransfer;
    try {
      t = await rail.createTransfer({ requestId, amount: a.amount, currency: a.currency, reference: a.reference, approvalSha256: a.terms_sha256 });
    } catch (e) {
      const code = e instanceof PayoutFailed ? e.code : "ambiguous";
      // Refused outright: nothing was made; the row stays, marked, so this company's one payout is spent and never retried.
      if (code === "refused") this.sql.exec("UPDATE awx_payouts SET status = 'REFUSED' WHERE company = ?", a.company);
      return { ok: false, reason: code };
    }
    this.sql.exec("UPDATE awx_payouts SET transfer_id = ?, status = ? WHERE company = ?", t.id, t.status, a.company);
    return { ok: true, transfer_id: t.id, status: t.status, amount: a.amount, currency: a.currency, request_id: requestId, again: false };
  }

  /**
   * The visitor's "Sandbox: move to PAID": the company's own transfer, for the same signed terms, moved by the sandbox's
   * simulation to SENT and then PAID. A transfer still IN_APPROVAL waits for a person in Airwallex and is not moved.
   */
  async simulatePaid(a: { company: string; terms_sha256: string }): Promise<SimulateAnswer> {
    if (!a || typeof a.company !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(a.company) || typeof a.terms_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(a.terms_sha256)) return { ok: false, reason: "bad_request" };
    if (this.opts.off) return { ok: false, reason: "switched_off" };
    if (!this.opts.rail) return { ok: false, reason: "no_key" };
    const kept = this.sql.exec("SELECT terms_sha256, transfer_id FROM awx_payouts WHERE company = ?", a.company).toArray()[0] as { terms_sha256: string; transfer_id: string | null } | undefined;
    if (!kept?.transfer_id || kept.terms_sha256 !== a.terms_sha256) return { ok: false, reason: "no_transfer" };
    const rail = this.opts.rail, id = kept.transfer_id;
    try {
      let t = await rail.transfer(id);
      if (t.status === "IN_APPROVAL") { this.sql.exec("UPDATE awx_payouts SET status = ? WHERE company = ?", t.status, a.company); return { ok: false, reason: "in_approval", status: t.status }; }
      for (const to of ["SENT", "PAID"] as const) {
        if (t.status === "PAID") break;
        if (to === "SENT" && t.status === "SENT") continue;
        t = await rail.simulate(id, to);
      }
      this.sql.exec("UPDATE awx_payouts SET status = ? WHERE company = ?", t.status, a.company);
      return { ok: true, transfer_id: id, status: t.status };
    } catch (e) {
      return { ok: false, reason: e instanceof PayoutFailed && e.code === "refused" ? "refused" : "unavailable" };
    }
  }

  /** Today's payouts in all, for a check. */
  payoutsToday(): number {
    return (this.sql.exec("SELECT COUNT(*) AS n FROM awx_payouts WHERE day = ?", utcDay(this.now())).toArray()[0] as { n: number }).n;
  }
}
