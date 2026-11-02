// Contract tests for every Airwallex call Purser makes (docs/airwallex.md lists them): the request we send and the
// response we read, field by field, against Airwallex's documented shapes, and each documented error path through
// Purser's own code (a clear refusal, no money moved, no crash). Offline: a fake fetch answers with the documented
// bodies, or the in-memory rail throws Airwallex's documented errors. Nothing here reaches Airwallex.
//
// Sources, cited per case:
//   [API]   https://www.airwallex.com/docs/api (Transfers, FX, Issuing, Balances, Authentication)
//   [TERR]  https://www.airwallex.com/docs/payouts/errors/transfer-error-codes (400 errors for "Create a transfer")
//   [FXERR] https://www.airwallex.com/docs/transactional-fx/troubleshooting/error-codes (conversion errors)
//   [GUIDE] https://airwallexdev.com/guide (hackathon builder guide: unconfigured_client_fee, the three insufficient-funds
//           codes, sandbox decline reasons, inclusive limits, 20/s global and 10/s per endpoint)
//   [RUN-CARDS] docs/runs/2026-10-29-cards.md (45.00 EUR declined LIMIT_EXCEEDED; 401 Insufficient permissions)
//   [RUN-S3]    docs/runs/2026-10-29-s3.md, [RUN-R3] docs/runs/2026-10-29-rehearsal-3.md (quote, conversion, transfer ids)
//   [READBACK]  docs/runs/airwallex-readback.json (ids re-read GET-only on 1 November)
//   [HOOKS]     docs/runs/2026-10-30-webhooks.md (a card transaction in both event shapes)
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANUFACTURER, invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../../src/agents/invoice.js";
import { AirwallexRest } from "../../src/airwallex/adapter.js";
import { Airwallex, AirwallexAmbiguous, AirwallexError } from "../../src/airwallex/client.js";
import { IssuingRest, toCardTransaction } from "../../src/airwallex/issuing.js";
import type { Conversion, MarketRate, NewTransfer, Quote, Transfer } from "../../src/airwallex/port.js";
import { openDb, type DB } from "../../src/db/open.js";
import { executeInvoicePayment } from "../../src/executors/invoicePayment.js";
import { decide } from "../../src/policy/approvals.js";
import { eurInFlightCents } from "../../src/policy/available.js";
import { chaos } from "../../src/policy/saga.js";
import { reconcile } from "../../src/finance/reconcile.js";
import { systemHealth } from "../../src/dashboard/health.js";
import { FakeAirwallex } from "../../src/redteam/airwallex.js";

// ---------------------------------------------------------------------------------------------------------------
// A fake Airwallex over HTTP: answers by "METHOD /path", records each request with its parsed body and query.

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;
type Seen = { method: string; path: string; query: Record<string, string>; body: unknown; headers: Record<string, string> };

function http(routes: Record<string, Reply | Reply[]>) {
  const seen: Seen[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = init.method ?? "GET";
    seen.push({ method, path, query: Object.fromEntries(url.searchParams), body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    const q = queues.get(`${method} ${path}`);
    if (!q?.length) throw new Error(`no reply for ${method} ${path}`);
    const r = q.length > 1 ? q.shift()! : q[0]!;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  let t = 0;
  const api = new Airwallex({ clientId: "client-id", apiKey: "api-key", fetchImpl: impl, sleep: async (ms) => { t += ms; }, now: () => t });
  return { api, seen, calls: (k: string) => seen.filter((s) => `${s.method} ${s.path}` === k) };
}

// [API] Authentication: POST /authentication/login, x-client-id and x-api-key as headers, answers { token, expires_at }.
const LOGIN = { "POST /authentication/login": { status: 201, body: { token: "tok", expires_at: "2026-10-29T06:30:00+0000" } } };
/** A documented 400 error body: code, message, source (and details where the code has them) [TERR]. */
const err400 = (code: string, message = code, extra: Record<string, unknown> = {}) => ({ status: 400, body: { code, message, source: "transfer", ...extra } });

describe("contract: Airwallex authentication and the client", () => {
  it("logs in with x-client-id and x-api-key headers and sends the token as a bearer [API]", async () => {
    const { api, seen } = http({ ...LOGIN, "GET /balances/current": { status: 200, body: [] } });
    await api.call("GET", "/balances/current");
    expect(seen[0]).toMatchObject({ method: "POST", path: "/authentication/login", headers: { "x-client-id": "client-id", "x-api-key": "api-key" } });
    expect(seen[1]!.headers.authorization).toBe("Bearer tok");
  });

  it("turns a documented 400 body into an AirwallexError carrying its status and code, never a success [TERR]", async () => {
    const { api } = http({ ...LOGIN, "POST /transfers/create": err400("fee_unknown", "There is a problem with your transfer fee configuration. Please contact the Account Manager.") });
    const e = await api.call("POST", "/transfers/create", { request_id: "r" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AirwallexError);
    expect(e).toMatchObject({ status: 400, code: "fee_unknown", path: "/transfers/create" });
  });

  it("keeps Airwallex's trace id, request id and message, and the error body redacted, so the request can be shown to Airwallex (agent run 1, 2 Nov)", async () => {
    const body = { code: "fee_unknown", message: "There is a problem with your transfer fee configuration. Please contact your Account Manager.", source: "transfer", details: { token: "tok-secret", client_id: "cid" } };
    const { api } = http({ ...LOGIN, "POST /transfers/create": { status: 400, body, headers: { "x-b3-traceid": "6f1c2a9e4b7d3c10", "x-request-id": "awx-req-77" } } });
    const e = await api.call("POST", "/transfers/create", { request_id: "r" }).catch((x: unknown) => x) as AirwallexError;
    expect(e).toBeInstanceOf(AirwallexError);
    expect(e).toMatchObject({ status: 400, code: "fee_unknown", traceId: "6f1c2a9e4b7d3c10", awxRequestId: "awx-req-77", awxMessage: body.message });
    // Never a key or token, not even one Airwallex echoes back in its error.
    expect(JSON.stringify(e.body)).not.toMatch(/tok-secret|"cid"/);
    expect(e.body).toMatchObject({ code: "fee_unknown", message: body.message, details: { token: "[redacted]", client_id: "[redacted]" } });
    // The message a person reads (proposal.failed) names the code, the trace id and Airwallex's own words.
    expect(e.message).toContain("fee_unknown");
    expect(e.message).toContain("6f1c2a9e4b7d3c10");
    expect(e.message).toContain("transfer fee configuration");
  });

  it("drops a trace header that is not a plain id (nothing from a header is written to a log as it came)", async () => {
    const { api } = http({ ...LOGIN, "POST /transfers/create": { status: 400, body: { code: "fee_unknown", message: "m" }, headers: { "x-b3-traceid": "abc def<script>", "request-id": "r-1" } } });
    const e = await api.call("POST", "/transfers/create", { request_id: "r" }).catch((x: unknown) => x) as AirwallexError;
    expect(e.traceId).toBeNull();
    expect(e.awxRequestId).toBe("r-1");
  });

  it("refreshes the token once on a 401, then reports 401 Insufficient permissions as an error [RUN-CARDS]", async () => {
    const denied = { status: 401, body: { code: "unauthorized", message: "Insufficient permissions for subscribing to conversion.overdue" } };
    const { api, calls } = http({ ...LOGIN, "POST /webhooks/create": [denied, denied] });
    await expect(api.call("POST", "/webhooks/create", {})).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(calls("POST /authentication/login")).toHaveLength(2);
    expect(calls("POST /webhooks/create")).toHaveLength(2);
  });

  it("retries a 429 (nothing was done) and gives up after four retries with an error [GUIDE: 10/s per endpoint]", async () => {
    const busy = { status: 429, body: { code: "too_many_requests" } };
    const { api, calls } = http({ ...LOGIN, "GET /balances/current": [busy, busy, busy, busy, busy] });
    await expect(api.call("GET", "/balances/current")).rejects.toMatchObject({ status: 429 });
    expect(calls("GET /balances/current")).toHaveLength(5);
  });

  it("treats a 5xx on a POST as ambiguous (resolved by request_id), never as refused and never resent [API]", async () => {
    const { api, calls } = http({ ...LOGIN, "POST /transfers/create": { status: 503, body: { code: "service_unavailable" } } });
    await expect(api.call("POST", "/transfers/create", { request_id: "r" })).rejects.toBeInstanceOf(AirwallexAmbiguous);
    expect(calls("POST /transfers/create")).toHaveLength(1);
  });

  it("refuses any base URL but the sandbox", () => {
    expect(() => new Airwallex({ clientId: "a", apiKey: "b", baseUrl: "https://api.airwallex.com/api/v1" })).toThrow(/sandbox/);
  });
});

describe("contract: Airwallex request and response shapes", () => {
  it("GET /balances/current?account_type=cash: only available_amount is spendable [API, RUN-S3]", async () => {
    const { api, seen } = http({ ...LOGIN, "GET /balances/current": { status: 200, body: [
      { currency: "EUR", available_amount: 25150.0, pending_amount: 12.5, reserved_amount: 1863.47, total_amount: 27025.97 },
      { currency: "USD", available_amount: 25001.35, pending_amount: 0, reserved_amount: 0, total_amount: 25001.35 },
      { currency: "GBP", available_amount: 860.5, pending_amount: 0, reserved_amount: 0, total_amount: 860.5 },
    ] } });
    const b = await new AirwallexRest(api).balances();
    expect(seen[1]!.query).toEqual({ account_type: "cash" });
    expect(b).toEqual({ EUR: { availableCents: 2_515_000, pendingCents: 1250, reservedCents: 186_347 }, USD: { availableCents: 2_500_135, pendingCents: 0, reservedCents: 0 } });
  });

  it("GET /fx/rates/current: the CLIENT level of rate_details is what this account pays [API]", async () => {
    const { api, seen } = http({ ...LOGIN, "GET /fx/rates/current": { status: 200, body: {
      rate: 1.1268, created_at: "2026-10-29T05:40:00+0000", currency_pair: "EURUSD",
      rate_details: [{ level: "AWX", rate: 1.1261, sell_amount: 416.66 }, { level: "CLIENT", rate: 1.1268, sell_amount: 416.92 }],
    } } });
    const r = await new AirwallexRest(api).currentRate({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 37_000 });
    expect(seen[1]!.query).toEqual({ buy_currency: "EUR", sell_currency: "USD", buy_amount: "370.00" });
    expect(r).toEqual({ rate: "1.1268", sellAmountCents: 41_692, at: "2026-10-29T05:40:00.000Z" });
  });

  it("GET /fx/rates/current without the CLIENT level is refused, not guessed [API]", async () => {
    const { api } = http({ ...LOGIN, "GET /fx/rates/current": { status: 200, body: { rate: 1.12, rate_details: [{ level: "AWX", rate: 1.12, sell_amount: 1 }] } } });
    await expect(new AirwallexRest(api).currentRate({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 100 })).rejects.toThrow(/client level/);
  });

  it("POST /fx/quotes/create: buy_amount as a number and a validity; the quote id, rate and valid_to_at come back [API, READBACK quote 101475c7…]", async () => {
    const { api, seen } = http({ ...LOGIN, "POST /fx/quotes/create": { status: 201, body: {
      quote_id: "101475c7-493b-3442-9734-3b2c0ce83f6f", buy_currency: "EUR", sell_currency: "USD", buy_amount: 362.85, sell_amount: 408.86,
      client_rate: 1.1268, valid_from_at: "2026-10-29T05:40:00+0000", valid_to_at: "2026-10-29T05:55:00+0000", validity: "MIN_15",
    } } });
    const q = await new AirwallexRest(api).createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 36_285, validity: "MIN_15" });
    expect(seen[1]!.body).toEqual({ buy_currency: "EUR", sell_currency: "USD", buy_amount: 362.85, validity: "MIN_15" });
    expect(q).toEqual({ quoteId: "101475c7-493b-3442-9734-3b2c0ce83f6f", buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 36_285, sellAmountCents: 40_886, clientRate: "1.1268", validFrom: "2026-10-29T05:40:00.000Z", validTo: "2026-10-29T05:55:00.000Z" });
  });

  it("POST /fx/conversions/create: request_id, quote_id and the approval hash in metadata [API, RUN-R3 conversion 0650049f…]", async () => {
    const { api, seen } = http({ ...LOGIN, "POST /fx/conversions/create": { status: 201, body: {
      conversion_id: "0650049f-acb1-476e-a72f-c4de56d5b7b1", request_id: "req-conv", quote_id: "q-1", status: "SCHEDULED", buy_amount: 370, sell_amount: 416.92, buy_currency: "EUR", sell_currency: "USD",
    } } });
    const quote: Quote = { quoteId: "q-1", buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 37_000, sellAmountCents: 41_692, clientRate: "1.1268", validFrom: "", validTo: "" };
    const c = await new AirwallexRest(api).createConversion({ requestId: "req-conv", quote, approvalSha256: "ab".repeat(32) });
    expect(seen[1]!.body).toEqual({ request_id: "req-conv", quote_id: "q-1", buy_currency: "EUR", sell_currency: "USD", buy_amount: "370.00", metadata: { approval_sha256: "ab".repeat(32) } });
    expect(c).toEqual({ conversionId: "0650049f-acb1-476e-a72f-c4de56d5b7b1", requestId: "req-conv", quoteId: "q-1", status: "SCHEDULED", buyAmountCents: 37_000, sellAmountCents: 41_692 });
  });

  it("POST /transfers/create: the documented SWIFT fields; the fee is read only once Airwallex states it [API, RUN-R3 transfer 260638bd…, fee 13.46]", async () => {
    const { api, seen } = http({ ...LOGIN,
      "POST /transfers/create": { status: 201, body: { id: "260638bd-3400-4a6f-b170-268ecc1ffc5b", request_id: "req-tr", status: "PROCESSING", transfer_amount: 1850, transfer_currency: "EUR" } },
      "GET /transfers/260638bd-3400-4a6f-b170-268ecc1ffc5b": { status: 200, body: { id: "260638bd-3400-4a6f-b170-268ecc1ffc5b", request_id: "req-tr", status: "PAID", transfer_amount: "1850.00", transfer_currency: "EUR", fee_amount: 13.46, fee_currency: "EUR" } },
    });
    const rest = new AirwallexRest(api);
    const req: NewTransfer = { requestId: "req-tr", beneficiaryId: "1322d7e4-5102-4858-ac2f-912d0ad5b999", amountCents: 185_000, currency: "EUR", sourceCurrency: "EUR", reference: "BTX-2026-11", reason: "professional_business_services", approvalSha256: "cd".repeat(32) };
    const made = await rest.createTransfer(req);
    expect(seen[1]!.body).toEqual({
      request_id: "req-tr", beneficiary_id: "1322d7e4-5102-4858-ac2f-912d0ad5b999", transfer_amount: "1850.00", transfer_currency: "EUR", source_currency: "EUR",
      transfer_method: "SWIFT", reference: "BTX-2026-11", reason: "professional_business_services", metadata: { approval_sha256: "cd".repeat(32) },
    });
    expect(made).toMatchObject({ status: "PROCESSING", amountCents: 185_000, fee: null });
    expect(await rest.getTransfer(made.id)).toMatchObject({ status: "PAID", fee: { cents: 1346, currency: "EUR" } });
  });

  it("GET /transfers?request_id=…: a failed transfer's nested failure details are read [API]", async () => {
    const { api, seen } = http({ ...LOGIN, "GET /transfers": { status: 200, body: { items: [
      { id: "t-9", request_id: "other", status: "PAID", transfer_amount: 1, transfer_currency: "EUR" },
      { id: "t-1", request_id: "req-1", status: "FAILED", transfer_amount: 10, transfer_currency: "EUR", failure: { code: "BENEFICIARY_BANK_RETURNED", message: "returned by the bank" } },
    ] } } });
    const t = await new AirwallexRest(api).findTransferByRequestId("req-1");
    expect(seen[1]!.query).toEqual({ request_id: "req-1" });
    expect(t).toMatchObject({ id: "t-1", status: "FAILED", failureType: "BENEFICIARY_BANK_RETURNED", failureReason: "returned by the bank" });
  });

  it("refuses an amount finer than a cent or negative at the boundary, so no rounding moves money [API: amounts in major units]", async () => {
    const { api } = http({ ...LOGIN, "GET /transfers/x": { status: 200, body: { id: "x", request_id: "r", status: "PAID", transfer_amount: 10.005, transfer_currency: "EUR" } } });
    await expect(new AirwallexRest(api).getTransfer("x")).rejects.toThrow(/finer than a cent/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Issuing: the card decline paths. Airwallex itself declines; Purser records the decline and moves nothing.

describe("contract: Airwallex Issuing declines (LIMIT_EXCEEDED, INSUFFICIENT_FUNDS and the other sandbox reasons)", () => {
  // [RUN-CARDS] 15:54: Northwind Market Data, Pro plan, 45.00 EUR, declined LIMIT_EXCEEDED (over 30.00 a purchase).
  const legacyListItem = { transaction_id: "7edb809a-48d4-440e-ab1f-3805645fd605", card_id: "card-1", transaction_amount: -45, transaction_currency: "EUR", status: "FAILED", failure_reason: "LIMIT_EXCEEDED", transaction_date: "2026-10-29T15:54:12.300+0000", merchant: { name: "Northwind Market Data____", category_code: "5734" }, transaction_type: "AUTHORIZATION" };
  // [HOOKS] the newer card transaction event shape (the simulation's answer and the webhook's data.object).
  const eventShape = { card_transaction_id: "ct-9", card_id: "card-1", process_result: "DECLINED", failure_reason: "INSUFFICIENT_FUNDS", transaction_amount: 45, transaction_currency: "EUR", transacted_at: "2026-10-29T15:54:12Z", merchant: { name: "Packwise___", category_code: "5734" } };

  it("reads a legacy list decline: approved false, the reason kept, the amount positive, the merchant unpadded", () => {
    expect(toCardTransaction(legacyListItem)).toMatchObject({ transactionId: "7edb809a-48d4-440e-ab1f-3805645fd605", approved: false, status: "FAILED", failureReason: "LIMIT_EXCEEDED", amountCents: 4500, merchant: "Northwind Market Data", mcc: "5734" });
  });

  it("reads an event-shape decline with INSUFFICIENT_FUNDS the same way [GUIDE decline reasons]", () => {
    expect(toCardTransaction(eventShape)).toMatchObject({ transactionId: "ct-9", approved: false, failureReason: "INSUFFICIENT_FUNDS", amountCents: 4500 });
  });

  it("reads a webhook event with only a failure reason (no status, no process_result) as declined", () => {
    const { process_result: _p, ...bare } = eventShape;
    expect(toCardTransaction(bare)).toMatchObject({ approved: false, status: "DECLINED", failureReason: "INSUFFICIENT_FUNDS" });
  });

  it("refuses an unknown result rather than guessing it was approved", () => {
    expect(() => toCardTransaction({ ...eventShape, process_result: "MAYBE" })).toThrow(/unknown card transaction result/);
  });

  it("GET /issuing/transactions?card_id=… pages and returns every decline as not approved [API]", async () => {
    const { api, seen } = http({ ...LOGIN, "GET /issuing/transactions": [
      { status: 200, body: { has_more: true, items: [legacyListItem] } },
      { status: 200, body: { has_more: false, items: [{ ...legacyListItem, transaction_id: "t-2", failure_reason: "MERCHANT_CATEGORY_NOT_ALLOWED" }, { ...legacyListItem, transaction_id: "t-3", failure_reason: "CARD_INACTIVE" }] } },
    ] });
    const txs = await new IssuingRest(api).listCardTransactions("card-1");
    expect(seen.filter((s) => s.path === "/issuing/transactions").map((s) => s.query)).toEqual([
      { card_id: "card-1", page_num: "0", page_size: "100" }, { card_id: "card-1", page_num: "1", page_size: "100" },
    ]);
    expect(txs.map((t) => [t.approved, t.failureReason])).toEqual([[false, "LIMIT_EXCEEDED"], [false, "MERCHANT_CATEGORY_NOT_ALLOWED"], [false, "CARD_INACTIVE"]]);
  });

  it("POST /simulation/issuing/create (sandbox only): the charge Airwallex declines comes back as a decline [API, RUN-CARDS]", async () => {
    const { api, seen } = http({ ...LOGIN, "POST /simulation/issuing/create": { status: 201, body: { ...eventShape, failure_reason: "LIMIT_EXCEEDED" } } });
    const t = await new IssuingRest(api).simulateCardCharge({ cardId: "card-1", amountCents: 4500, currency: "EUR", merchant: "Packwise", mcc: "5734" });
    expect(seen[1]!.body).toEqual({ card_id: "card-1", transaction_amount: 45, transaction_currency: "EUR", merchant_category_code: "5734", merchant_info: "Packwise" });
    expect(t).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
  });

  it("POST /issuing/cards/create: limits PER_TRANSACTION and MONTHLY in EUR, VIRTUAL, never a card number asked for [API]", async () => {
    const card = { card_id: "card-1", cardholder_id: "ch-1", card_number: "************8120", card_status: "ACTIVE", nick_name: "sourcing", authorization_controls: { allowed_transaction_count: "MULTIPLE", transaction_limits: { currency: "EUR", limits: [{ amount: 30, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] } } };
    const { api, seen } = http({ ...LOGIN, "POST /issuing/cards/create": { status: 201, body: card } });
    const c = await new IssuingRest(api).createCard({ cardholderId: "ch-1", nickname: "sourcing", createdBy: "Purser", limits: { currency: "EUR", perTxCents: 3000, monthlyCents: 10_000 } });
    expect(seen[1]!.body).toMatchObject({ cardholder_id: "ch-1", form_factor: "VIRTUAL", authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 30, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] } } });
    expect(seen.some((s) => /sensitive|cvv|pan/i.test(s.path))).toBe(false);
    expect(c).toMatchObject({ last4: "8120", limits: { perTxCents: 3000, monthlyCents: 10_000 } });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The documented error paths through Purser's own code: the invoice payment (FX quote, conversion, SWIFT payout).

const invoiceText = readFileSync(new URL("../../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");
const awxError = (status: number, code: string, path: string, extra: Record<string, unknown> = {}) => new AirwallexError(status, code, { code, message: code, ...extra }, path);

type Hook = "currentRate" | "createQuote" | "createConversion" | "createTransfer";
/** The in-memory rail, made to answer one call with Airwallex's documented error (as the real client throws it). */
class ErringAirwallex extends FakeAirwallex {
  /** One error answers the next call; a list answers that many calls, one each, in order. */
  fail: Partial<Record<Hook, Error | Error[]>> = {};
  /** Hide transfers from the list for this many look-ups (the list lags behind a create). */
  listLag = 0;
  private take(k: Hook): void {
    const f = this.fail[k];
    const e = Array.isArray(f) ? f.shift() : f;
    if (!Array.isArray(f) || f.length === 0) delete this.fail[k];
    if (e) { this.calls.push(`${k}:refused`); throw e; }
  }
  override async currentRate(a: Parameters<FakeAirwallex["currentRate"]>[0]): Promise<MarketRate> { this.take("currentRate"); return super.currentRate(a); }
  override async createQuote(a: Parameters<FakeAirwallex["createQuote"]>[0]): Promise<Quote> { this.take("createQuote"); return super.createQuote(a); }
  override async createConversion(a: Parameters<FakeAirwallex["createConversion"]>[0]): Promise<Conversion> { this.take("createConversion"); return super.createConversion(a); }
  /** Runs while a create is at Airwallex (before its answer): what another process does to the ledger meanwhile. */
  onCreate: ((t: NewTransfer) => void) | null = null;
  /** The fee Airwallex charges on the next transfer made, when a test wants another than the sandbox's usual. */
  feeCents: number | null = null;
  override async createTransfer(t: NewTransfer): Promise<Transfer> {
    this.onCreate?.(t);
    this.take("createTransfer");
    // [TERR] duplicate_request_id: "has been used for a transfer with the transfer ID … before", with details.id.
    const prior = this.transfers.find((x) => x.requestId === t.requestId);
    if (prior && this.tamper) Object.assign(prior, this.tamper);
    if (prior) throw awxError(400, "duplicate_request_id", "/transfers/create", { source: "request_id", details: { id: this.duplicateId ?? prior.id, request_id: t.requestId } });
    // Airwallex's transfer ids are UUIDs (the in-memory rail's are not): renamed as Airwallex would name them.
    const rename = () => { const last = this.transfers.at(-1)!; last.id = randomUUID(); return last.id; };
    try {
      const made = await super.createTransfer(t);
      if (this.feeCents !== null) this.transfers.at(-1)!.fee = { cents: this.feeCents, currency: "EUR" };
      return { ...made, id: rename(), fee: this.transfers.at(-1)!.fee ?? null };
    } catch (e) {
      if (e instanceof AirwallexAmbiguous) rename();
      throw e;
    }
  }
  /** What Airwallex's record of the first send turns out to hold, when a test wants it to differ from the payout. */
  tamper: Partial<Transfer> | null = null;
  /** The id a duplicate_request_id answer names, when a test wants another one. */
  duplicateId: string | null = null;
  gotIds: string[] = [];
  /** Whether Airwallex's answers state the payee (beneficiary_id): no recorded run proves the list or GET carry it. */
  payeeIn = { list: true, get: true };
  /** The payee GET /transfers/{id} states, when a test wants it to differ from the one sent. */
  payeeOnGet: string | null = null;
  override async getTransfer(id: string) {
    this.gotIds.push(id);
    const t = await super.getTransfer(id);
    return { ...t, beneficiaryId: this.payeeIn.get ? (this.payeeOnGet ?? t.beneficiaryId) : null };
  }
  override async findTransferByRequestId(requestId: string) {
    if (this.listLag > 0) { this.listLag--; return undefined; }
    const t = await super.findTransferByRequestId(requestId);
    return t && { ...t, beneficiaryId: this.payeeIn.list ? t.beneficiaryId : null };
  }
}

/** The fee retry in tests: the same attempts as live, no real waiting; `waited` lists each wait asked for. */
const fast = () => { const waited: number[] = []; return { waited, delaysMs: [15_000, 30_000, 60_000, 90_000, 120_000], sleep: async (ms: number) => { waited.push(ms); } }; };
const FAST = fast();
/** Airwallex answering the same refusal to every create (more than the retries allow). */
const persistently = (code: string) => Array.from({ length: 6 }, () => awxError(400, code, "/transfers/create"));

async function world() {
  const db = openDb(":memory:");
  const awx = new ErringAirwallex();
  await seedTreasury(db, awx, awx);
  return { db, awx };
}
const invoice = () => parseInvoiceFallback(invoiceText);
async function approved(db: DB, awx: ErringAirwallex) {
  const out = await proposeInvoicePayment(db, awx, invoice(), invoiceText);
  if (out.kind !== "proposed") throw new Error(out.reason);
  decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "test", method: "cli" });
  return out;
}
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const transferRows = (db: DB) => db.prepare("SELECT transfer_id, status, failure_type FROM transfers").all() as { transfer_id: string | null; status: string; failure_type: string | null }[];

describe("contract: FX errors through the invoice payment", () => {
  it("unconfigured_client_fee on the rate check (a newly activated account) escalates: no quote, no proposal, nothing moved [GUIDE]", async () => {
    const { db, awx } = await world();
    awx.fail.currentRate = awxError(400, "unconfigured_client_fee", "/fx/rates/current");
    const out = await proposeInvoicePayment(db, awx, invoice(), invoiceText);
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/unconfigured_client_fee.*nothing was converted or paid/) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.calls).not.toContain("createTransfer");
  });

  it("unconfigured_client_fee on the quote escalates the same way [GUIDE]", async () => {
    const { db, awx } = await world();
    awx.fail.createQuote = awxError(400, "unconfigured_client_fee", "/fx/quotes/create");
    expect(await proposeInvoicePayment(db, awx, invoice(), invoiceText)).toMatchObject({ kind: "escalated" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM fx_quotes").get()).toEqual({ n: 0 });
  });

  it("a forbidden FX call (an account not ACTIVE yet) escalates too, not a crash [GUIDE]", async () => {
    const { db, awx } = await world();
    awx.fail.createQuote = awxError(403, "forbidden", "/fx/quotes/create");
    expect(await proposeInvoicePayment(db, awx, invoice(), invoiceText)).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/forbidden/) });
  });

  it("an approval after the quote's end voids it before Airwallex is called: nothing converted, nothing paid", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    const late = new Date(Date.parse(out.terms.conversion!.valid_to) - 10_000);
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, () => late)).rejects.toThrow(/expired|approval void|too late/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.transfers).toHaveLength(0);
  });

  it("expired_quote from POST /fx/conversions/create sends the proposal back for a new approval, and pays nothing [FXERR]", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.fail.createConversion = awxError(400, "expired_quote", "/fx/conversions/create");
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toMatchObject({ code: "expired_quote" });
    expect(status(db, out.proposal.proposal_id)).toBe("NEEDS_REAPPROVAL");
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
    expect(transferRows(db)).toEqual([]);
  });

  it("insufficient_funds from POST /fx/conversions/create fails the payment with nothing converted or paid [FXERR, GUIDE]", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.fail.createConversion = awxError(400, "insufficient_funds", "/fx/conversions/create");
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(status(db, out.proposal.proposal_id)).toBe("FAILED");
    expect(awx.conversions).toHaveLength(0);
    expect(awx.transfers).toHaveLength(0);
  });
});

describe("contract: SWIFT payout errors through the invoice payment", () => {
  for (const [code, source] of [["fee_unknown", "TERR"], ["balance_insufficient", "TERR, GUIDE"]] as const) {
    it(`${code} from POST /transfers/create: refused, nothing paid, the payout row closed so the invoice can be proposed again [${source}]`, async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      // fee_unknown is retried under the same request_id (below); here Airwallex keeps refusing past the last retry.
      awx.fail.createTransfer = code === "fee_unknown" ? persistently(code) : awxError(400, code, "/transfers/create");
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, FAST)).rejects.toMatchObject({ code });
      expect(status(db, out.proposal.proposal_id)).toBe("FAILED");
      expect(awx.transfers).toHaveLength(0);
      // Airwallex made no transfer: the ledger's row must not stay SUBMITTING (an invisible payout "under way").
      expect(transferRows(db)).toEqual([{ transfer_id: null, status: "CANCELLED", failure_type: code }]);
      expect(eurInFlightCents(db)).toBe(0);
      expect(invoiceAlreadyHandled(db, "BTX-2026-11")).toBeNull();
      const refused = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.refused'").get() as { payload_json: string } | undefined;
      expect(JSON.parse(refused!.payload_json)).toMatchObject({ code, amount: "EUR 1850.00" });
    });
  }

  it("the refusal row and proposal.failed carry the code, Airwallex's trace id and its message (agent run 1: we kept neither)", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    const msg = "There is a problem with your transfer fee configuration. Please contact your Account Manager.";
    const refusal = () => new AirwallexError(400, "fee_unknown", { code: "fee_unknown", message: msg, source: "transfer" }, "/transfers/create", { traceId: "6f1c2a9e4b7d3c10", requestId: "awx-req-77" });
    awx.fail.createTransfer = [1, 2, 3, 4, 5, 6].map(refusal);
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, FAST)).rejects.toMatchObject({ code: "fee_unknown" });
    const payload = (event: string) => JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq DESC").get(event) as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(payload("transfer.refused")).toMatchObject({ code: "fee_unknown", trace_id: "6f1c2a9e4b7d3c10", awx_request_id: "awx-req-77", message: msg });
    expect(payload("proposal.failed")).toMatchObject({ code: "fee_unknown", trace_id: "6f1c2a9e4b7d3c10", awx_request_id: "awx-req-77", awx_message: msg });
    expect(String(payload("proposal.failed").error)).toContain("6f1c2a9e4b7d3c10");
  });

  it("a lost answer, then duplicate_request_id on the resend: the existing transfer is adopted, paid exactly once [TERR]", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.loseNextTransferAnswer = true; // Airwallex made it; its answer was lost
    awx.listLag = 1; // and the list does not show it yet
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(awx.transfers).toHaveLength(1);
    expect(r.transfer.id).toBe(awx.transfers[0]!.id);
    expect(r.transfer.status).toBe("PAID");
    expect(status(db, out.proposal.proposal_id)).toBe("EXECUTED");
    expect(transferRows(db)).toEqual([{ transfer_id: awx.transfers[0]!.id, status: "PAID", failure_type: null }]);
    // Named by its UUID, read back by it, and recorded as adopted, never as created.
    expect(awx.gotIds[0]).toBe(awx.transfers[0]!.id);
    const events = (db.prepare("SELECT event FROM audit_log WHERE event LIKE 'transfer.%' ORDER BY seq").all() as { event: string }[]).map((e) => e.event);
    expect(events).toContain("transfer.adopted");
    expect(events).not.toContain("transfer.created");
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.ambiguous'").get() as { payload_json: string }).payload_json)).toMatchObject({ resolved: "adopted" });
  });

  it("the review's probe: a crash after create, then a resend answered balance_insufficient, never closes the payout [review 2 Nov]", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    chaos.at = (point) => { if (point === "transfer:after-create") throw new Error("crash"); };
    try {
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow("crash");
    } finally {
      chaos.at = null;
    }
    expect(awx.transfers).toHaveLength(1); // Airwallex made it; the ledger has only its SUBMITTING row
    awx.listLag = 1; // the look-up misses it
    awx.fail.createTransfer = awxError(400, "balance_insufficient", "/transfers/create"); // and the resend is refused
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toMatchObject({ code: "balance_insufficient" });
    expect(awx.transfers).toHaveLength(1);
    // A resend never closes the row: it stays under way and keeps blocking a second payout of the invoice.
    expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
    expect(invoiceAlreadyHandled(db, "BTX-2026-11")).toMatch(/already has a payout \(SUBMITTING\)/);
    expect(eurInFlightCents(db)).toBeGreaterThan(0);
    // The reconciliation looks the id-less row up by request_id and raises it.
    const r = await reconcile(db, {
      transfer: async (id) => awx.getTransfer(id),
      transferByRequestId: async (requestId) => { const t = await awx.findTransferByRequestId(requestId); return t && { id: t.id, status: t.status, amountCents: t.amountCents, currency: t.currency }; },
    });
    expect(r.differences).toEqual([expect.objectContaining({ area: "airwallex transfer", ref: out.terms.transfer_request_id, outside: expect.stringContaining(awx.transfers[0]!.id) })]);
  });

  it("a payout closed as refused is never sent again under its request_id, and its proposal re-run stops before Airwallex", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.fail.createTransfer = persistently("fee_unknown");
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, FAST)).rejects.toMatchObject({ code: "fee_unknown" });
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, FAST)).rejects.toThrow(/refused by Airwallex and closed/);
    expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toEqual(Array(6).fill("createTransfer:refused"));
    const refused = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.refused'").all() as { payload_json: string }[];
    expect(refused).toHaveLength(1);
    expect(JSON.parse(refused[0]!.payload_json)).toHaveProperty("origin");
  });

  it("the reconciliation raises a payout closed as refused that Airwallex holds after all; System health counts the double", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.fail.createTransfer = persistently("fee_unknown");
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, FAST)).rejects.toMatchObject({ code: "fee_unknown" });
    // Suppose Airwallex had made it anyway, and a second proposal paid the invoice.
    awx.transfers.push({ id: randomUUID(), requestId: out.terms.transfer_request_id, status: "PAID", amountCents: 185_000, currency: "EUR", metadata: "x", beneficiaryId: out.terms.beneficiary_id });
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-second', 'req-second', 'BTX-2026-11', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'h', ?)").run(new Date().toISOString());
    const r = await reconcile(db, {
      transfer: async () => ({ status: "PAID", amountCents: 185_000, currency: "EUR" }),
      transferByRequestId: async (requestId) => { const t = await awx.findTransferByRequestId(requestId); return t && { id: t.id, status: t.status, amountCents: t.amountCents, currency: t.currency }; },
    });
    expect(r.differences.map((d) => d.ref)).toEqual([out.terms.transfer_request_id]);
    expect(systemHealth(db).slos.find((s) => s.id === "double_payments")).toMatchObject({ met: false, detail: expect.stringMatching(/BTX-2026-11.*req-second/) });
  });

  it("adoption on duplicate_request_id: the transfer it names must be this payout (amount, currency, payee) and live", async () => {
    for (const change of [{ amountCents: 1 }, { beneficiaryId: "someone-else" }, { status: "FAILED" }] as Partial<Transfer>[]) {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      awx.loseNextTransferAnswer = true;
      awx.listLag = 1;
      // After the lost answer, Airwallex's record differs from the payout: never adopted, the payout stays open.
      awx.tamper = change;
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id), JSON.stringify(change)).rejects.toThrow();
      expect(transferRows(db), JSON.stringify(change)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event IN ('transfer.adopted', 'transfer.created')").get()).toEqual({ n: 0 });
    }
  });

  describe("adoption when Airwallex's answer does not state the payee (beneficiary_id is unproven in its GET/list answers)", () => {
    /** A crash right after the create: Airwallex has the transfer, the ledger only its SUBMITTING row; then the re-run. */
    async function crashedAfterCreate() {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      chaos.at = (point) => { if (point === "transfer:after-create") throw new Error("crash"); };
      try {
        await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow("crash");
      } finally {
        chaos.at = null;
      }
      return { db, awx, out };
    }
    const adoptedPayload = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.adopted'").get() as { payload_json: string } | undefined)?.payload_json;

    it("the list answer lacks it: read back by GET /transfers/{id}; the same payee there is adopted, payee confirmed", async () => {
      const { db, awx, out } = await crashedAfterCreate();
      awx.payeeIn = { list: false, get: true };
      const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
      expect(r.transfer.id).toBe(awx.transfers[0]!.id);
      expect(awx.transfers).toHaveLength(1);
      expect(awx.gotIds[0]).toBe(awx.transfers[0]!.id);
      expect(JSON.parse(adoptedPayload(db)!)).toMatchObject({ payee_confirmed: true });
    });

    it("the read-back names another payee: never adopted, the payout stays open for a person", async () => {
      const { db, awx, out } = await crashedAfterCreate();
      awx.payeeIn = { list: false, get: true };
      awx.payeeOnGet = "someone-else";
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow(/not this payout/);
      expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
      expect(adoptedPayload(db)).toBeUndefined();
    });

    it("neither answer states it: adopted on what is proven (request_id, amount, currency), recorded as payee not confirmed", async () => {
      const { db, awx, out } = await crashedAfterCreate();
      awx.payeeIn = { list: false, get: false };
      const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
      expect(r.transfer.status).toBe("PAID");
      expect(awx.transfers).toHaveLength(1);
      expect(JSON.parse(adoptedPayload(db)!)).toMatchObject({ payee_confirmed: false });
    });

    it("duplicate_request_id with an id that is not a UUID, the list lacking the payee: read back by its own id before adoption", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      awx.loseNextTransferAnswer = true;
      awx.listLag = 1;
      awx.duplicateId = "not-a-uuid";
      awx.payeeIn = { list: false, get: true };
      awx.payeeOnGet = "someone-else";
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow(/duplicate_request_id/);
      expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
    });
  });

  it("duplicate_request_id: an id that is not a UUID never goes into a URL; the transfer is looked up by request_id instead", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.loseNextTransferAnswer = true;
    awx.listLag = 1;
    awx.duplicateId = "../../balances/current";
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(awx.gotIds).not.toContain("../../balances/current");
    expect(r.transfer.id).toBe(awx.transfers[0]!.id);
    expect(awx.transfers).toHaveLength(1);
  });

  it("a duplicate_request_id naming a transfer under another request_id is never adopted", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.fail.createTransfer = awxError(400, "duplicate_request_id", "/transfers/create", { details: { id: "tr_elsewhere", request_id: "another" } });
    awx.transfers.push({ id: "tr_elsewhere", requestId: "another", status: "PAID", amountCents: 1, currency: "EUR", metadata: "x" });
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow(/duplicate_request_id/);
    expect(status(db, out.proposal.proposal_id)).toBe("FAILED");
    // Unknown whether ours exists: the row stays SUBMITTING, counted as under way, and blocks a second payout.
    expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
    expect(invoiceAlreadyHandled(db, "BTX-2026-11")).toMatch(/already has a payout \(SUBMITTING\)/);
  });

  it("service_unavailable (a 400 whose outcome is not stated) keeps the payout open as under way: never resent, never closed", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    awx.fail.createTransfer = awxError(400, "service_unavailable", "/transfers/create");
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toMatchObject({ code: "service_unavailable" });
    expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toEqual(["createTransfer:refused"]);
    expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
  });

  it("a refusal at create closes only a row still SUBMITTING with no id: a row another path changed meanwhile is left, with no refusal recorded", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    // While the first create is at Airwallex, another path records a transfer for this payout (an adoption).
    awx.onCreate = () => db.prepare("UPDATE transfers SET transfer_id = 'tr-other', status = 'PROCESSING' WHERE request_id = ?").run(out.terms.transfer_request_id);
    awx.fail.createTransfer = awxError(400, "balance_insufficient", "/transfers/create");
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toMatchObject({ code: "balance_insufficient" });
    expect(transferRows(db)).toEqual([{ transfer_id: "tr-other", status: "PROCESSING", failure_type: null }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'transfer.refused'").get()).toEqual({ n: 0 });
  });

  it("a created transfer is written only over its own SUBMITTING row: a row closed meanwhile is never overwritten, and it raises an alarm", async () => {
    const { db, awx } = await world();
    const out = await approved(db, awx);
    // While the create is at Airwallex (and makes the transfer), the row is closed (a mistaken close, for one).
    awx.onCreate = () => db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = 'closed_unsent' WHERE request_id = ?").run(out.terms.transfer_request_id);
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow(/a person checks it/);
    expect(awx.transfers).toHaveLength(1);
    expect(transferRows(db)).toEqual([{ transfer_id: null, status: "CANCELLED", failure_type: "closed_unsent" }]);
    const alarm = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'transfer.row_conflict'").get() as { subject: string; payload_json: string } | undefined;
    expect(alarm?.subject).toBe(awx.transfers[0]!.id);
    expect(JSON.parse(alarm!.payload_json)).toMatchObject({ request_id: out.terms.transfer_request_id, row_status: "CANCELLED" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event IN ('transfer.created', 'transfer.adopted')").get()).toEqual({ n: 0 });
  });

  describe("fee_unknown and unconfigured_client_fee: the create is retried under the same request_id with a bounded backoff (agent run 1)", () => {
    const retries = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.retry' ORDER BY seq").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

    for (const code of ["fee_unknown", "unconfigured_client_fee"]) {
      it(`${code} twice, then accepted: paid exactly once, every attempt under the same request_id with the same terms, each audited`, async () => {
        const { db, awx } = await world();
        const out = await approved(db, awx);
        const sent: NewTransfer[] = [];
        awx.onCreate = (t) => sent.push(t);
        awx.fail.createTransfer = [awxError(400, code, "/transfers/create"), awxError(400, code, "/transfers/create")];
        const retry = fast();
        const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, retry);
        expect(r.transfer.status).toBe("PAID");
        expect(awx.transfers).toHaveLength(1);
        expect(status(db, out.proposal.proposal_id)).toBe("EXECUTED");
        expect(sent).toHaveLength(3);
        expect(new Set(sent.map((t) => JSON.stringify(t))).size).toBe(1);
        expect(sent[0]!.requestId).toBe(out.terms.transfer_request_id);
        expect(retry.waited).toEqual([15_000, 30_000]);
        expect(retries(db)).toEqual([
          expect.objectContaining({ attempt: 1, code, request_id: out.terms.transfer_request_id, next_attempt_in_s: 15 }),
          expect.objectContaining({ attempt: 2, code, request_id: out.terms.transfer_request_id, next_attempt_in_s: 30 }),
        ]);
        expect(retries(db).every((p) => "origin" in p)).toBe(true);
        expect(transferRows(db)).toEqual([{ transfer_id: awx.transfers[0]!.id, status: "PAID", failure_type: null }]);
      });
    }

    it("refused on every attempt: 1 + 5 retries over about 5 minutes, then the existing refusal path closes the first send", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      awx.fail.createTransfer = persistently("fee_unknown");
      const retry = fast();
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, retry)).rejects.toMatchObject({ code: "fee_unknown" });
      expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toEqual(Array(6).fill("createTransfer:refused"));
      expect(retry.waited).toEqual([15_000, 30_000, 60_000, 90_000, 120_000]);
      expect(retry.waited.reduce((a, b) => a + b, 0)).toBe(315_000);
      expect(retries(db).map((p) => p.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(retries(db).at(-1)).toMatchObject({ next_attempt_in_s: null, stopped: expect.stringMatching(/no attempts left/) });
      expect(transferRows(db)).toEqual([{ transfer_id: null, status: "CANCELLED", failure_type: "fee_unknown" }]);
      expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.refused'").get() as { payload_json: string }).payload_json)).toMatchObject({ code: "fee_unknown", attempts: 6 });
      expect(awx.transfers).toHaveLength(0);
    });

    it("any other code stops the retries at once: a documented refusal closes the first send, an undocumented one keeps it open", async () => {
      for (const [next, row] of [["balance_insufficient", "CANCELLED"], ["service_unavailable", "SUBMITTING"]] as const) {
        const { db, awx } = await world();
        const out = await approved(db, awx);
        awx.fail.createTransfer = [awxError(400, "fee_unknown", "/transfers/create"), awxError(400, next, "/transfers/create"), ...persistently("fee_unknown")];
        const retry = fast();
        await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, retry), next).rejects.toMatchObject({ code: next });
        expect(awx.calls.filter((c) => c.startsWith("createTransfer")), next).toHaveLength(2);
        expect(retry.waited, next).toEqual([15_000]);
        expect(transferRows(db)[0]!.status, next).toBe(row);
      }
    });

    it("a lost answer during the retries is never retried blind: it is looked up by request_id and adopted", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      awx.fail.createTransfer = [awxError(400, "fee_unknown", "/transfers/create")];
      let n = 0;
      awx.onCreate = () => { if (++n === 2) awx.loseNextTransferAnswer = true; };
      const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, fast());
      expect(awx.transfers).toHaveLength(1);
      expect(r.transfer.id).toBe(awx.transfers[0]!.id);
      expect(n).toBe(2);
    });

    it("duplicate_request_id on a retry: the existing adoption checks apply (this payout adopted once; anything else never, and never closed)", async () => {
      for (const amountCents of [185_000, 1]) {
        const { db, awx } = await world();
        const out = await approved(db, awx);
        awx.fail.createTransfer = [awxError(400, "fee_unknown", "/transfers/create")];
        let n = 0;
        // By the second attempt Airwallex holds a transfer under this request_id after all.
        awx.onCreate = (t) => {
          if (++n === 2) awx.transfers.push({ id: randomUUID(), requestId: t.requestId, status: "PROCESSING", amountCents, currency: "EUR", metadata: t.approvalSha256, beneficiaryId: t.beneficiaryId, fee: { cents: 1347, currency: "EUR" } });
        };
        const run = executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, fast());
        if (amountCents === 185_000) {
          expect((await run).transfer.id).toBe(awx.transfers[0]!.id);
          expect(transferRows(db)).toEqual([{ transfer_id: awx.transfers[0]!.id, status: "PAID", failure_type: null }]);
          expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'transfer.adopted'").get()).toEqual({ n: 1 });
        } else {
          await expect(run).rejects.toMatchObject({ code: "duplicate_request_id" });
          expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
          expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event IN ('transfer.adopted', 'transfer.created', 'transfer.refused')").get()).toEqual({ n: 0 });
        }
        expect(awx.transfers).toHaveLength(1);
      }
    });

    it("no attempt after the approved terms expire: the retries stop before the expiry, and the first send is closed", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      const expires = Date.parse(out.terms.expires_at);
      let t = expires - 50_000;
      const at: number[] = [];
      awx.onCreate = () => at.push(t);
      awx.fail.createTransfer = persistently("fee_unknown");
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, () => new Date(t), { delaysMs: [15_000, 30_000, 60_000, 90_000, 120_000], sleep: async (ms) => { t += ms; } }))
        .rejects.toMatchObject({ code: "fee_unknown" });
      expect(at).toEqual([expires - 50_000, expires - 35_000, expires - 5_000]);
      expect(at.every((x) => x < expires)).toBe(true);
      expect(retries(db).at(-1)).toMatchObject({ attempt: 3, next_attempt_in_s: null, stopped: expect.stringMatching(/expire/) });
      expect(transferRows(db)).toEqual([{ transfer_id: null, status: "CANCELLED", failure_type: "fee_unknown" }]);
    });

    it("a hold set during the wait (the CFO pauses Treasury) stops the retries: no further attempt", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      awx.fail.createTransfer = persistently("fee_unknown");
      const sleep = async () => { db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.treasury', 'on', ?) ON CONFLICT(key) DO UPDATE SET value = 'on'").run(new Date().toISOString()); };
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, { delaysMs: [15_000, 30_000], sleep })).rejects.toMatchObject({ code: "fee_unknown" });
      expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toHaveLength(1);
      expect(retries(db)).toEqual([expect.objectContaining({ attempt: 1, next_attempt_in_s: 15 })]);
      expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.retry_stopped'").get() as { payload_json: string }).payload_json)).toMatchObject({ after_attempt: 1, reason: expect.stringMatching(/paused/) });
      expect(transferRows(db)[0]!.status).toBe("CANCELLED");
    });

    it("the SWIFT fee ceiling still applies to what is finally paid after a retry", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      awx.fail.createTransfer = [awxError(400, "fee_unknown", "/transfers/create")];
      awx.feeCents = 2_500;
      await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, fast());
      expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.fee_over_ceiling'").get() as { payload_json: string }).payload_json)).toMatchObject({ fee: "EUR 25.00" });
    });

    it("a resend (the row written by an earlier run that crashed before its first create) is retried too, and stays open: never closed", async () => {
      const { db, awx } = await world();
      const out = await approved(db, awx);
      chaos.at = (point) => { if (point === "transfer:after-insert") throw new Error("crash"); };
      try {
        await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, fast())).rejects.toThrow("crash");
      } finally {
        chaos.at = null;
      }
      expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toHaveLength(0);
      awx.fail.createTransfer = persistently("fee_unknown");
      await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, undefined, fast())).rejects.toMatchObject({ code: "fee_unknown" });
      expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toHaveLength(6);
      expect(transferRows(db)).toEqual([{ transfer_id: null, status: "SUBMITTING", failure_type: null }]);
    });
  });

  it("names the supplier's real account only from the allowlist, whatever the error", () => {
    expect(invoice().iban).toBe(MANUFACTURER.iban);
  });
});
