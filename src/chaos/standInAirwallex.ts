// The Airwallex sandbox's REST API as a stand-in, for the money chaos (npm run chaos:money): a fetch the real client
// (src/airwallex/client.ts) and the real adapter (src/airwallex/adapter.ts AirwallexRest) talk to, kept in memory by
// FakeAirwallex (src/redteam/airwallex.ts), with faults put between them: a request lost on its way, an answer lost after
// Airwallex did the work (a connection dropped, a timeout), 500/502/503, 429, and the runner's process dying with the
// request sent. Field names follow the adapter, so the code under test is the code a live run uses. No network.
import { randomUUID } from "node:crypto";
import type { Currency, NewTransfer, Transfer } from "../airwallex/port.js";
import { fromCents, toCents } from "../lib/money.js";
import { FakeAirwallex } from "../redteam/airwallex.js";

/** What can go wrong with one call. "*-after" faults happen after Airwallex did the work. */
export type Fault = "lost-request" | "lost-answer" | "timeout-after" | "500" | "502-after" | "503" | "429";
export const FAULTS: readonly Fault[] = ["lost-request", "lost-answer", "timeout-after", "500", "502-after", "503", "429"];
const APPLIED: ReadonlySet<Fault> = new Set(["lost-answer", "timeout-after", "502-after"]);

/** The runner's process died: thrown into the code under test, which must not act on it (its process is gone). */
export class ProcessDied extends Error { constructor(where: string) { super(`the process died (${where})`); this.name = "ProcessDied"; } }

export interface CallLog { n: number; method: string; path: string; fault: Fault | "crash" | null; applied: boolean; status: number | null }

interface Reply { status: number; json: unknown }

/** One transfer as Airwallex keeps it, with the approval hash its metadata carried. */
export interface AwxTransferRecord extends Transfer { metadata: string; reference?: string }

export class StandInAirwallex {
  readonly fake = new FakeAirwallex();
  readonly log: CallLog[] = [];
  /** Every status each transfer went through, in order (what Airwallex's webhooks would announce). */
  readonly history: { transferId: string; requestId: string; status: string; amountCents: number; at: number }[] = [];
  /** Decides the fault of each call (null: answered normally). */
  faultOf: (call: { n: number; method: string; path: string }) => Fault | null = () => null;
  /** Whether the process dies with this call sent (after Airwallex did it); the stand-in then refuses every call. */
  crashOn: ((call: { n: number; method: string; path: string }) => boolean) | null = null;
  onCrash: (() => void) | null = null;
  dead = false;
  private n = 0;
  /** Airwallex's clock (the runner's may differ: skew). */
  constructor(readonly clock: () => number) {
    this.fake.clock = clock;
    this.fake.bal.USD.availableCents = 2_500_000;
    this.fake.bal.EUR.availableCents = 3_500_000;
  }

  /** Back to life with a new process: faults and crash cleared by the caller as it wishes. */
  revive(): void { this.dead = false; this.crashOn = null; this.onCrash = null; }

  /** The fetch the Airwallex client is given. */
  readonly fetch = (async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (this.dead) throw new ProcessDied(`a call after the crash: ${method} ${path}`);
    const n = ++this.n;
    const entry: CallLog = { n, method, path, fault: null, applied: false, status: null };
    this.log.push(entry);
    const fault = path === "/authentication/login" ? null : this.faultOf({ n, method, path });
    const crash = path !== "/authentication/login" && !!this.crashOn?.({ n, method, path });
    entry.fault = crash ? "crash" : fault;
    if (fault === "lost-request") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (fault === "500" || fault === "503") return this.answer(entry, { status: Number(fault), json: { code: "internal_error", message: "stand-in: the service failed" } });
    if (fault === "429") { const r = this.answer(entry, { status: 429, json: { code: "too_many_requests", message: "stand-in: slow down" } }); r.headers.set("retry-after", "1"); return r; }
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    const reply = await this.route(method, path, url.searchParams, body);
    entry.applied = reply.status < 400;
    if (crash) { this.dead = true; this.onCrash?.(); throw new ProcessDied(`with ${method} ${path} sent and done at Airwallex`); }
    if (fault && APPLIED.has(fault)) {
      if (fault === "lost-answer") throw new TypeError("fetch failed: other side closed");
      if (fault === "timeout-after") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      return this.answer(entry, { status: 502, json: { code: "bad_gateway", message: "stand-in: the gateway lost the answer" } });
    }
    return this.answer(entry, reply);
  }) as typeof fetch;

  private answer(entry: CallLog, r: Reply): Response {
    entry.status = r.status;
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json", "x-awx-traceid": `stand-in-${entry.n}` } });
  }

  private transferJson(t: AwxTransferRecord): Record<string, unknown> {
    return { id: t.id, request_id: t.requestId, status: t.status, transfer_amount: Number(fromCents(t.amountCents)), transfer_currency: t.currency,
      failure_type: t.failureType ?? null, failure_reason: t.failureReason ?? null, fee_amount: t.fee ? Number(fromCents(t.fee.cents)) : null, fee_currency: t.fee?.currency ?? null,
      beneficiary_id: t.beneficiaryId ?? null, metadata: { approval_sha256: t.metadata } };
  }

  get transfers(): AwxTransferRecord[] { return this.fake.transfers as AwxTransferRecord[]; }

  /** Time passes at Airwallex: every transfer still under way is paid out, as the bank does on its own. */
  async settleAll(): Promise<void> {
    for (const t of this.transfers) {
      if (!["PROCESSING", "SCHEDULED", "SENT"].includes(t.status)) continue;
      if (t.status !== "SENT") { await this.fake.transitionTransfer(t.id, "SENT"); this.noteStatus(t); }
      await this.fake.transitionTransfer(t.id, "PAID");
      this.noteStatus(t);
    }
  }

  private noteStatus(t: AwxTransferRecord): void {
    const last = [...this.history].reverse().find((h) => h.transferId === t.id);
    if (last?.status !== t.status) this.history.push({ transferId: t.id, requestId: t.requestId, status: t.status, amountCents: t.amountCents, at: this.clock() });
  }

  private async route(method: string, path: string, q: URLSearchParams, b: Record<string, unknown>): Promise<Reply> {
    const f = this.fake;
    const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): Reply => ({ status, json: { code, message, ...extra } });
    try {
      if (method === "POST" && path === "/authentication/login") return { status: 200, json: { token: "stand-in-token", expires_at: new Date(this.clock() + 30 * 60_000).toISOString() } };
      if (method === "GET" && path === "/balances/current") {
        return { status: 200, json: Object.entries(f.bal).map(([currency, v]) => ({ currency, available_amount: Number(fromCents(v.availableCents)), pending_amount: Number(fromCents(v.pendingCents)), reserved_amount: Number(fromCents(v.reservedCents)), account_type: "cash" })) };
      }
      if (method === "GET" && path === "/global_accounts") return { status: 200, json: { items: [{ id: "ga_usd_1", status: "ACTIVE", supported_features: [{ currency: "USD", type: "LOCAL" }] }] } };
      if (method === "GET" && path === "/deposits") return { status: 200, json: { has_more: false, items: f.deposits.map((d) => ({ id: d.id, amount: Number(fromCents(d.amountCents)), currency: d.currency, reference: d.reference, status: d.status })) } };
      if (method === "POST" && path === "/simulation/deposit/create") {
        const d = await f.simulateDeposit({ globalAccountId: String(b.global_account_id), amountCents: toCents(Number(b.amount).toFixed(2)), reference: String(b.reference), payerName: String(b.payer_name) });
        return { status: 200, json: { id: d.id, amount: Number(fromCents(d.amountCents)), currency: d.currency, reference: d.reference, status: d.status } };
      }
      if (method === "GET" && path === "/fx/rates/current") {
        const r = await f.currentRate({ buyCurrency: q.get("buy_currency") as Currency, sellCurrency: q.get("sell_currency") as Currency, buyAmountCents: toCents(q.get("buy_amount") ?? "0") });
        return { status: 200, json: { rate: Number(r.rate), created_at: new Date(this.clock()).toISOString(), rate_details: [{ level: "CLIENT", rate: Number(r.rate), sell_amount: Number(fromCents(r.sellAmountCents)) }] } };
      }
      if (method === "POST" && path === "/fx/quotes/create") {
        const qt = await f.createQuote({ buyCurrency: b.buy_currency as Currency, sellCurrency: b.sell_currency as Currency, buyAmountCents: toCents(Number(b.buy_amount).toFixed(2)), validity: String(b.validity) });
        return { status: 200, json: { quote_id: qt.quoteId, buy_amount: Number(fromCents(qt.buyAmountCents)), sell_amount: Number(fromCents(qt.sellAmountCents)), client_rate: Number(qt.clientRate), valid_from_at: qt.validFrom, valid_to_at: qt.validTo } };
      }
      if (method === "POST" && path === "/fx/conversions/create") {
        const quote = f.quotes.get(String(b.quote_id));
        if (!quote) return err(400, "invalid_argument", "no such quote");
        if (f.conversions.some((c) => c.requestId === b.request_id)) return err(400, "duplicate_request_id", "this request_id was used before");
        const c = await f.createConversion({ requestId: String(b.request_id), quote, approvalSha256: String((b.metadata as { approval_sha256?: string } | undefined)?.approval_sha256 ?? "") });
        return { status: 200, json: { conversion_id: c.conversionId, request_id: c.requestId, status: c.status, buy_amount: Number(fromCents(c.buyAmountCents)), sell_amount: Number(fromCents(c.sellAmountCents)), quote_id: c.quoteId } };
      }
      if (method === "GET" && path === "/fx/conversions") {
        const rid = q.get("request_id");
        const items = f.conversions.filter((c) => !rid || c.requestId === rid).map((c) => ({ conversion_id: c.conversionId, request_id: c.requestId, status: c.status, buy_amount: Number(fromCents(c.buyAmountCents)), sell_amount: Number(fromCents(c.sellAmountCents)), quote_id: c.quoteId }));
        return { status: 200, json: { has_more: false, items } };
      }
      if (method === "GET" && path === "/beneficiaries") {
        return { status: 200, json: { has_more: false, items: f.beneficiaries.map((x) => ({ id: x.id, beneficiary: { company_name: x.name, bank_details: { iban: x.iban, swift_code: x.bic, account_currency: x.currency, account_name: x.name } } })) } };
      }
      if (method === "POST" && path === "/beneficiaries/schema") return { status: 200, json: { schema: {} } };
      if (method === "POST" && path === "/beneficiaries/validate") return { status: 200, json: {} };
      if (method === "POST" && path === "/beneficiaries/create") {
        const ben = b.beneficiary as { company_name: string; bank_details: { iban: string; swift_code: string; account_currency: Currency; bank_country_code: string; bank_name: string } };
        const made = await f.createBeneficiary({ name: ben.company_name, iban: ben.bank_details.iban, bic: ben.bank_details.swift_code, currency: ben.bank_details.account_currency, countryCode: ben.bank_details.bank_country_code, bankName: ben.bank_details.bank_name } as never);
        return { status: 201, json: { id: made.id } };
      }
      if (method === "POST" && path === "/transfers/create") {
        const prior = this.transfers.find((x) => x.requestId === b.request_id);
        if (prior) return err(400, "duplicate_request_id", `request_id has been used for a transfer with the transfer ID ${prior.id} before`, { source: "request_id", details: { id: prior.id, request_id: b.request_id } });
        const want: NewTransfer = { requestId: String(b.request_id), beneficiaryId: String(b.beneficiary_id), amountCents: toCents(String(b.transfer_amount)), currency: "EUR", sourceCurrency: "EUR",
          reference: String(b.reference ?? ""), reason: String(b.reason ?? ""), approvalSha256: String((b.metadata as { approval_sha256?: string } | undefined)?.approval_sha256 ?? "") };
        try {
          await f.createTransfer(want);
        } catch (e) {
          return err(400, (e as { code?: string }).code ?? "invalid_argument", (e as Error).message);
        }
        const t = this.transfers.at(-1)!;
        t.id = randomUUID();
        this.noteStatus(t);
        return { status: 201, json: this.transferJson(t) };
      }
      if (method === "GET" && path === "/transfers") {
        const rid = q.get("request_id");
        return { status: 200, json: { has_more: false, items: this.transfers.filter((t) => !rid || t.requestId === rid).map((t) => this.transferJson(t)) } };
      }
      const one = /^\/transfers\/([^/]+)$/.exec(path);
      if (method === "GET" && one) {
        const t = this.transfers.find((x) => x.id === decodeURIComponent(one[1]!));
        return t ? { status: 200, json: this.transferJson(t) } : err(404, "not_found", "no such transfer");
      }
      const sim = /^\/simulation\/transfers\/([^/]+)\/transition$/.exec(path);
      if (method === "POST" && sim) {
        const t = this.transfers.find((x) => x.id === sim[1]);
        if (!t) return err(404, "not_found", "no such transfer");
        if (t.status === "PAID" && b.next_status === "PAID") return { status: 200, json: this.transferJson(t) };
        await f.transitionTransfer(t.id, b.next_status as "SENT" | "PAID" | "FAILED", b.failure_type as string | undefined);
        this.noteStatus(t);
        return { status: 200, json: this.transferJson(t) };
      }
      return err(404, "not_found", `stand-in: no route ${method} ${path}`);
    } catch (e) {
      return err(400, (e as { code?: string }).code ?? "invalid_argument", (e as Error).message);
    }
  }
}
