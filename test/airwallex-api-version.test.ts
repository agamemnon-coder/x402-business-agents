// The pinned Airwallex API version (outside audit, finding 2.5; src/airwallex/apiVersion.ts): every request any of
// Purser's Airwallex HTTP clients sends carries `x-api-version: 2025-11-11`, the login included, except an FX call
// (quotes, rates, conversions), which the kit asks to leave without one (docs/requirements-matrix.md, K8-api).
// Offline: each client talks to a stand-in fetch that records the headers of every request.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AIRWALLEX_API_VERSION, apiVersionHeader, isFxPath } from "../src/airwallex/apiVersion.js";
import { Airwallex } from "../src/airwallex/client.js";
import { AirwallexRest } from "../src/airwallex/adapter.js";
import { sqlOver } from "../src/relay/local.js";
import { AwxCardsDesk } from "../worker/src/awxCards.js";
import { AwxGatewayDesk } from "../worker/src/awxGateway.js";
import { SandboxPayouts } from "../worker/src/awxPayout.js";
import { AwxReadDesk } from "../worker/src/awxRead.js";
import { SandboxQuotes } from "../worker/src/fxQuote.js";

type Seen = { method: string; path: string; version: string | null };
const TOKEN = "tok-0123456789abcdefghijklmnop";

/** A stand-in sandbox: the login answers a token, any other call `{}` (or `answer(path)`); every request is recorded. */
function sandbox(answer: (path: string) => unknown = () => ({})) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    seen.push({ method: init.method ?? "GET", path: url.pathname.replace(/^\/api\/v1/, ""), version: new Headers(init.headers).get("x-api-version") });
    const body = url.pathname.endsWith("/authentication/login") ? { token: TOKEN, expires_at: "2099-01-01T00:00:00+0000" } : answer(url.pathname);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

/** Every recorded request: FX paths without a version, every other one with the pinned version. */
function expectPinned(seen: Seen[]) {
  expect(seen.length).toBeGreaterThan(0);
  for (const s of seen) expect({ ...s, version: s.version }).toEqual({ ...s, version: isFxPath(s.path) ? null : AIRWALLEX_API_VERSION });
}

describe("the pinned version", () => {
  it("is one dated constant, sent on every path but an FX one", () => {
    expect(AIRWALLEX_API_VERSION).toBe("2025-11-11");
    expect(apiVersionHeader("/authentication/login")).toEqual({ "x-api-version": "2025-11-11" });
    expect(apiVersionHeader("/transfers/create")).toEqual({ "x-api-version": "2025-11-11" });
    expect(apiVersionHeader("/api/v1/balances/current")).toEqual({ "x-api-version": "2025-11-11" });
    for (const fx of ["/fx/quotes/create", "/fx/rates/current", "/fx/conversions/create", "/fx/conversions", "/api/v1/fx/quotes/create"]) expect(apiVersionHeader(fx)).toEqual({});
    // Only a path that starts with the FX segment is an FX call.
    expect(isFxPath("/transfers/fx/x")).toBe(false);
    expect(isFxPath("/fxquotes")).toBe(false);
  });
});

describe("the runner's client (src/airwallex/client.ts)", () => {
  const client = (s: ReturnType<typeof sandbox>, extra: Partial<ConstructorParameters<typeof Airwallex>[0]> = {}) =>
    new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: s.fetchImpl, minGapMs: 0, sleep: async () => {}, ...extra });

  it("the login, reads, writes and uploads carry the version; FX calls do not", async () => {
    const s = sandbox();
    const api = client(s);
    await api.call("GET", "/balances/current", undefined, { account_type: "cash" });
    await api.call("POST", "/transfers/create", { request_id: "r" });
    await api.call("POST", "/fx/quotes/create", { buy_currency: "EUR" });
    await api.call("GET", "/fx/rates/current", undefined, { buy_currency: "EUR", sell_currency: "USD" });
    await api.call("POST", "/fx/conversions/create", { request_id: "c" });
    await api.upload("/files/upload", new FormData());
    expect(s.seen.map((x) => `${x.method} ${x.path} ${x.version ?? "-"}`)).toEqual([
      "POST /authentication/login 2025-11-11",
      "GET /balances/current 2025-11-11",
      "POST /transfers/create 2025-11-11",
      "POST /fx/quotes/create -",
      "GET /fx/rates/current -",
      "POST /fx/conversions/create -",
      "POST /files/upload 2025-11-11",
    ]);
  });

  it("also on behalf of a connected account, after a 401's fresh login, and through the adapter's every rail call", async () => {
    const s = sandbox((p) => (p.endsWith("/balances/current") ? [{ currency: "EUR", available_amount: 10 }] : { items: [] }));
    let first = true;
    const once401 = (async (input: string | URL, init?: RequestInit) => {
      if (first && !String(input).endsWith("/authentication/login")) { first = false; s.seen.push({ method: init?.method ?? "GET", path: new URL(String(input)).pathname.replace(/^\/api\/v1/, ""), version: new Headers(init?.headers).get("x-api-version") }); return new Response("{}", { status: 401 }); }
      return s.fetchImpl(input, init);
    }) as typeof fetch;
    const rail = new AirwallexRest(client({ ...s, fetchImpl: once401 }, { onBehalfOf: "acct_0123456789abcdef" }));
    await rail.balances();
    await rail.findTransferByRequestId("req-1");
    await rail.findConversionByRequestId("conv-1");
    expect(s.seen.filter((x) => x.path === "/authentication/login")).toHaveLength(2);
    expect(s.seen.some((x) => x.path === "/fx/conversions")).toBe(true);
    expectPinned(s.seen);
  });
});

describe("the relay Worker's clients (worker/src)", () => {
  it("the /try FX quote (fxQuote.ts): the login carries the version, the quote (FX) does not", async () => {
    const s = sandbox(() => ({ quote_id: "q", buy_currency: "EUR", sell_currency: "USD", buy_amount: 1, sell_amount: 1.1, client_rate: 1.1, valid_to_at: "2099-01-01T00:00:00+0000" }));
    await new SandboxQuotes({ clientId: "id", apiKey: "key", fetchImpl: s.fetchImpl }).quote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "1.00" }).catch(() => undefined);
    expect(s.seen.map((x) => `${x.path} ${x.version ?? "-"}`)).toEqual(["/authentication/login 2025-11-11", "/fx/quotes/create -"]);
  });

  it("the /try payout (awxPayout.ts): login, balance, transfer and its read-back", async () => {
    const s = sandbox((p) => (p.endsWith("/balances/current") ? [{ currency: "EUR", available_amount: 100 }] : { id: "11111111-2222-3333-4444-555555555555", status: "PAID" }));
    const payouts = new SandboxPayouts({ clientId: "id", apiKey: "key", fetchImpl: s.fetchImpl });
    await payouts.availableCents("EUR");
    await payouts.createTransfer({ requestId: "r", amount: "1.00", currency: "EUR", reference: "ref", approvalSha256: "a".repeat(64) }).catch(() => undefined);
    expect(s.seen.map((x) => x.path)).toEqual(expect.arrayContaining(["/authentication/login", "/balances/current", "/transfers/create"]));
    expectPinned(s.seen);
  });

  it("the gateway (awxGateway.ts): a read and the login carry it, an FX quote does not", async () => {
    const s = sandbox();
    const desk = new AwxGatewayDesk({ AWX_ACT_CLIENT_ID: "id", AWX_ACT_API_KEY: "key", AWX_GATEWAY_WRITE: "on" }, { fetchImpl: s.fetchImpl });
    await desk.call({ method: "GET", path: "/balances/current" });
    await desk.call({ method: "POST", path: "/fx/quotes/create", body: { buy_currency: "EUR", sell_currency: "USD", buy_amount: 100 } });
    expect(s.seen.map((x) => `${x.path} ${x.version ?? "-"}`)).toEqual(["/authentication/login 2025-11-11", "/balances/current 2025-11-11", "/fx/quotes/create -"]);
  });

  it("the card desk (awxCards.ts)", async () => {
    const s = sandbox();
    await new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "key" }, { fetchImpl: s.fetchImpl }).ask({ op: "card", card_id: "card_1" });
    expect(s.seen.map((x) => x.path)).toEqual(["/authentication/login", "/issuing/cards/card_1"]);
    expectPinned(s.seen);
  });

  it("the live read desk (awxRead.ts): balances carry it, the FX rates do not", async () => {
    const s = sandbox((p) => (p.endsWith("/balances/current") ? [] : {}));
    const desk = new AwxReadDesk(sqlOver(new Database(":memory:")), { clientId: "id", apiKey: "key", fetchImpl: s.fetchImpl, now: () => Date.parse("2026-11-20T10:00:00Z") });
    await desk.read("balances");
    await desk.read("rates");
    expect(s.seen.map((x) => x.path)).toEqual(expect.arrayContaining(["/authentication/login", "/balances/current", "/fx/rates/current"]));
    expectPinned(s.seen);
  });
});
