// Purser Cloud's live Airwallex tab (14 Nov): the site Worker's read-only gateway to the Airwallex sandbox
// (worker/src/awxRead.ts) and the cloud's route and checks (cloud/src/awxLive.ts). It holds: only the sandbox host, only
// the listed GETs (and the login), only their own query keys; no key and no token in any answer; one answer per view for
// 45 s; the ceilings a minute and a day; an unavailable sandbox said so; the reconciliation exact to the cent; the
// guest's route read only and capped per visitor. 0 network: the sandbox is a stand-in here.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqlOver } from "../src/relay/local.js";
import {
  AWX_READ_ALLOWED, AWX_VIEWS, AwxReadDesk, AwxReadNotAllowed, READ_DAILY_CEILING, READ_PER_MINUTE, READ_TTL_SECONDS, RUN_WINDOW, readAllowedUrl, type AwxReadAnswer,
} from "../worker/src/awxRead.js";
import { AWX_VISITOR_PER_MINUTE, checkGatewayAnswer, reconcileView, type AwxLiveAnswer } from "../cloud/src/awxLive.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const HOST = "https://api.sandbox.airwallex.com";
const TOKEN = "tok_" + "x".repeat(40);
const KEY = "key_" + "k".repeat(40);
const CLIENT = "client_" + "c".repeat(20);
const RUN = JSON.parse(readFileSync(new URL("../docs/demo/airwallex-run.json", import.meta.url), "utf8")) as { invoices: { transfer_id: string | null; approval_sha256: string; invoice_no: string }[] };
/** Airwallex's financial transactions for the run's window, as the 12 Nov read recorded them (amounts back in major units). */
const FT_ITEMS = (JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-airwallex-financial-transactions.json", import.meta.url), "utf8")) as { audit: { event: string; payload: { items?: { id: string; source_id: string; source_type: string; transaction_type: string; currency: string; amount_cents: number; fee_cents: number; net_cents: number; status: string; created_at: string }[] } }[] })
  .audit.find((a) => a.event === "awx_ft.read")!.payload.items!.map((i) => ({ ...i, amount: i.amount_cents / 100, fee: i.fee_cents / 100, net: i.net_cents / 100 }));

/** A stand-in for the sandbox: the answers Airwallex gives, and every call it got. */
function sandbox(o: { issuing?: number; down?: boolean; ftItems?: unknown[] } = {}) {
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    calls.push({ method: String(init.method), url: input, headers: init.headers as Record<string, string> });
    if (o.down) throw new Error("network down");
    const u = new URL(input), p = u.pathname;
    if (p === "/api/v1/authentication/login") return Response.json({ token: TOKEN, expires_at: "2099-01-01T00:00:00+0000" }, { status: 201 });
    if (p === "/api/v1/balances/current") return Response.json([{ currency: "EUR", available_amount: 9940000.5, pending_amount: 0, reserved_amount: 0, total_amount: 9940000.5 }, { currency: "USD", available_amount: 100, total_amount: 100 }]);
    if (p === "/api/v1/global_accounts") return Response.json({ items: [{ id: "ga_1", account_name: "Northwind Outdoor", account_number: "12345678", iban: "GB33BUKB20201555555555", country_code: "GB", status: "ACTIVE", institution: { name: "Test Bank" }, swift_code: "TESTGB2L" }] });
    if (p === "/api/v1/financial_transactions") return Response.json({ items: o.ftItems ?? FT_ITEMS, has_more: false });
    if (p === "/api/v1/fx/rates/current") return Response.json({ sell_currency: u.searchParams.get("sell_currency"), buy_currency: u.searchParams.get("buy_currency"), rate: 0.885, currency_pair: "USDEUR", created_at: "2026-11-14T10:00:00+0000" });
    if (p === "/api/v1/transfers") return Response.json({ items: RUN.invoices.filter((i) => i.transfer_id).map((i, k) => ({ id: i.transfer_id, status: "PAID", transfer_amount: 240, transfer_currency: "EUR", metadata: { approval_sha256: k === 0 ? i.approval_sha256 : "0".repeat(64) }, created_at: "2026-11-07T12:12:00+0000" })) });
    if (p === "/api/v1/beneficiaries") return Response.json({ items: [{ id: "ben_1", nickname: "Stockline", beneficiary: { entity_type: "COMPANY", company_name: "Stockline Data GmbH", bank_details: { iban: "DE02120300000000202051", bank_country_code: "DE", account_currency: "EUR" } }, transfer_methods: ["LOCAL"] }] });
    if (p === "/api/v1/issuing/cards" || p === "/api/v1/issuing/transactions") {
      if (o.issuing) return Response.json({ code: "unauthorized" }, { status: o.issuing });
      return Response.json({ items: p.endsWith("cards") ? [{ card_id: "card_1", card_status: "ACTIVE", nick_name: "sourcing agent: warehouse", card_number: "************1423", authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 46, interval: "PER_TRANSACTION" }] }, allowed_merchant_categories: ["5734"] } }] : [{ transaction_id: "tx_1", card_id: "card_1", transaction_type: "AUTHORIZATION", status: "APPROVED", transaction_amount: 12.5, transaction_currency: "EUR", merchant: { name: "Shop", category_code: "5734" } }] });
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function desk(o: Parameters<typeof sandbox>[0] & { key?: boolean; off?: boolean } = {}) {
  const sb = sandbox(o);
  const clock = { t: Date.parse("2026-11-14T10:00:00Z") };
  const sql = sqlOver(new Database(":memory:"));
  const d = new AwxReadDesk(sql, { ...(o.key === false ? {} : { clientId: CLIENT, apiKey: KEY }), off: o.off, fetchImpl: sb.fetchImpl, now: () => clock.t });
  return { d, sb, clock, sql };
}
const secretFree = (x: unknown) => { const s = JSON.stringify(x); expect(s).not.toContain(TOKEN); expect(s).not.toContain(KEY); expect(s).not.toContain(CLIENT); expect(s).not.toMatch(/"(token|access_token|api_key|x-api-key|authorization)"\s*:/i); expect(s).not.toMatch(/Bearer /); };

describe("the read gateway's table: the sandbox host, the listed GETs and their query keys, nothing else", () => {
  it("lists the login and GETs only", () => {
    expect(AWX_READ_ALLOWED.filter((a) => a.method !== "GET")).toEqual([{ method: "POST", path: "/api/v1/authentication/login", query: [] }]);
    expect(AWX_READ_ALLOWED.every((a) => a.path.startsWith("/api/v1/"))).toBe(true);
  });
  it("lets the listed calls through", () => {
    expect(readAllowedUrl("GET", `${HOST}/api/v1/balances/current`).pathname).toBe("/api/v1/balances/current");
    expect(readAllowedUrl("GET", `${HOST}/api/v1/fx/rates/current?sell_currency=USD&buy_currency=EUR`).search).toBe("?sell_currency=USD&buy_currency=EUR");
  });
  it.each([
    ["GET", "https://api.airwallex.com/api/v1/balances/current"], ["GET", "https://api-demo.airwallex.com/api/v1/balances/current"],
    ["GET", "http://api.sandbox.airwallex.com/api/v1/balances/current"], ["GET", "https://api.sandbox.airwallex.com.evil.example/api/v1/balances/current"],
    ["GET", "https://user:pw@api.sandbox.airwallex.com/api/v1/balances/current"], ["GET", "https://api.sandbox.airwallex.com:8443/api/v1/balances/current"],
    ["POST", `${HOST}/api/v1/transfers/create`], ["POST", `${HOST}/api/v1/fx/conversions/create`], ["POST", `${HOST}/api/v1/issuing/cards/create`],
    ["POST", `${HOST}/api/v1/balances/current`], ["DELETE", `${HOST}/api/v1/beneficiaries`], ["GET", `${HOST}/api/v1/transfers/abc`],
    ["GET", `${HOST}/api/v1/balances/current?x=1`], ["GET", `${HOST}/api/v1/transfers?page_size=1&page_size=2`], ["GET", `${HOST}/api/v1/transfers?page_size=%3Cscript%3E`],
    ["GET", `${HOST}/api/v1/balances/current#x`], ["GET", `${HOST}/api/v1/transfers/../transfers/create`], ["GET", "not a url"],
  ])("refuses %s %s before anything is sent", (method, url) => {
    expect(() => readAllowedUrl(method, url)).toThrow(AwxReadNotAllowed);
  });
  it("the gateway's source names no other host and no write path", () => {
    const src = readFileSync(new URL("../worker/src/awxRead.ts", import.meta.url), "utf8");
    expect(src.match(/https:\/\/[a-z0-9.-]+/g) ?? []).toEqual([]);
    expect(src).not.toMatch(/\/create"|\/update"|\/cancel"|\/delete"/);
  });
});

describe("the read gateway (AwxReadDesk)", () => {
  it("answers each view live, labelled, with no key and no token in it", async () => {
    const { d, sb } = desk();
    for (const v of AWX_VIEWS) {
      const a = await d.read(v);
      expect({ v, source: a.source }).toEqual({ v, source: "airwallex-sandbox" });
      expect(a.host).toBe("api.sandbox.airwallex.com");
      secretFree(a);
    }
    // The key went only to the login, the token only to the GETs, every call to the sandbox host.
    expect(sb.calls.every((c) => c.url.startsWith(`${HOST}/api/v1/`))).toBe(true);
    expect(sb.calls.filter((c) => c.headers["x-api-key"]).map((c) => c.url)).toEqual([`${HOST}/api/v1/authentication/login`]);
    expect(sb.calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual([`${HOST}/api/v1/authentication/login`]);
    const bal = await d.read("balances");
    expect(bal.source === "airwallex-sandbox" && bal.data).toEqual({ balances: [{ currency: "EUR", available: "9940000.5", pending: "0", reserved: "0", total: "9940000.5" }, { currency: "USD", available: "100", pending: null, reserved: null, total: "100" }] });
    const acc = await d.read("accounts");
    expect(JSON.stringify(acc)).not.toContain("GB33BUKB20201555555555");
    expect(acc.source === "airwallex-sandbox" && acc.data).toMatchObject({ accounts: [{ id: "ga_1", iban_last4: "5555", account_number_last4: "5678" }] });
  });

  it("reads the run's window for the reconciliation, and the last 30 days", async () => {
    const { d, sb } = desk();
    await d.read("financial");
    const ft = sb.calls.filter((c) => c.url.includes("financial_transactions")).map((c) => new URL(c.url).searchParams);
    expect(ft.map((q) => q.get("from_created_at"))).toEqual(["2026-10-15T10:00:00+0000", RUN_WINDOW.from]);
  });

  it("keeps one answer per view for 45 s, then reads again", async () => {
    const { d, sb, clock } = desk();
    await d.read("balances");
    const n = sb.calls.length;
    await Promise.all([d.read("balances"), d.read("balances")]);
    expect(sb.calls.length).toBe(n);
    clock.t += (READ_TTL_SECONDS + 1) * 1000;
    await d.read("balances");
    expect(sb.calls.length).toBe(n + 1); // the token is kept: one GET, no new login
  });

  it("shares one refresh between visits that arrive together", async () => {
    const { d, sb } = desk();
    await Promise.all([d.read("rates"), d.read("rates"), d.read("rates")]);
    expect(sb.calls.filter((c) => c.url.includes("/fx/rates/current")).length).toBe(3); // three pairs, once
  });

  it("counts every call by endpoint, without its query or any id", async () => {
    const { d } = desk();
    await d.read("rates");
    const c = await d.read("calls");
    expect(c.source === "airwallex-sandbox" && c.data).toMatchObject({ total: 4, ceiling: READ_DAILY_CEILING, endpoints: [{ endpoint: "GET /api/v1/fx/rates/current", calls: 3, ok: 3 }, { endpoint: "POST /api/v1/authentication/login", calls: 1, ok: 1 }] });
  });

  it("stops at the minute's ceiling and at the day's, before the call is sent", async () => {
    const { d, sb, sql } = desk();
    sql.exec("CREATE TABLE IF NOT EXISTS ar_minute (minute TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    sql.exec("INSERT INTO ar_minute (minute, n) VALUES (?, ?)", "2026-11-14T10:00", READ_PER_MINUTE);
    const a = await d.read("balances");
    expect(a).toMatchObject({ source: "unavailable", code: "ceiling" });
    expect(sb.calls).toEqual([]);
    const e = desk();
    e.sql.exec("INSERT INTO ar_calls (day, endpoint, n, ok) VALUES (?, ?, ?, 0)", "2026-11-14", "GET /api/v1/balances/current", READ_DAILY_CEILING);
    expect(await e.d.read("balances")).toMatchObject({ source: "unavailable", code: "ceiling", reason: expect.stringMatching(/ceiling of 1500/) });
    expect(e.sb.calls).toEqual([]);
  });

  it("says the sandbox is unavailable when it does not answer, and never says why in Airwallex's words or with a secret", async () => {
    const { d } = desk({ down: true });
    const a = await d.read("balances");
    expect(a).toMatchObject({ source: "unavailable", code: "no_answer", reason: "the Airwallex sandbox did not answer in time" });
    secretFree(a);
  });

  it("without the key, makes no call and says so", async () => {
    const { d, sb } = desk({ key: false });
    expect(await d.read("transfers")).toMatchObject({ source: "unavailable", code: "no_key" });
    const off = desk({ off: true });
    expect(await off.d.read("transfers")).toMatchObject({ source: "unavailable", code: "switched_off" });
    expect([...sb.calls, ...off.sb.calls]).toEqual([]);
  });

  it("says plainly when the key has no Issuing scope", async () => {
    for (const status of [401, 403]) {
      const { d } = desk({ issuing: status });
      expect(await d.read("issuing")).toMatchObject({ source: "unavailable", code: "not_in_scope", reason: expect.stringMatching(/no Issuing scope/) });
    }
  });

  it("answers its own route only for a known view, by GET", async () => {
    const { d } = desk();
    expect((await d.fetch(new Request("https://relay.internal/internal/awx-read?view=nope"))).status).toBe(404);
    expect((await d.fetch(new Request("https://relay.internal/internal/awx-read?view=balances", { method: "POST" }))).status).toBe(404);
    expect((await d.fetch(new Request("https://relay.internal/internal/awx-read?view=balances"))).status).toBe(200);
  });

  it("is reached from outside only through the named entrypoint: the Worker routes no path to it", () => {
    const index = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
    const handler = index.slice(index.indexOf("export default {"));
    expect(handler).not.toMatch(/AWX_READ_PATH|awx-read/);
    expect(index).toMatch(/export class AwxRead extends WorkerEntrypoint<Env>/);
  });
});

describe("Airwallex's answers as the live sandbox gives them (read 14 Nov after the deploy)", () => {
  const OLD = "ca2def06-1de3-4167-ad40-c30e6353599d", NEW = "0b9d6c1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e", CLOSED = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  /** The list without limits and oldest first; each card's own record with its controls; authorizations oldest first. */
  function liveShapes() {
    const calls: string[] = [];
    const fetchImpl = (async (input: string, init: RequestInit) => {
      const u = new URL(input), p = u.pathname;
      calls.push(`${String(init.method)} ${p}`);
      if (p === "/api/v1/authentication/login") return Response.json({ token: TOKEN }, { status: 201 });
      if (p === "/api/v1/issuing/cards") return Response.json({ items: [
        { card_id: OLD, card_status: "ACTIVE", nick_name: "sourcing agent: data subscriptions", card_number: "************8366", created_at: "2026-10-29T14:44:53.292+0000" },
        { card_id: CLOSED, card_status: "CLOSED", nick_name: "task T-0001: flight", card_number: "************8653", created_at: "2026-10-30T09:00:00.000+0000" },
        { card_id: NEW, card_status: "ACTIVE", nick_name: "sourcing agent: warehouse and data software (3efefc)", card_number: "************1423", created_at: "2026-11-03T06:06:27.783+0000" },
      ] });
      if (p.startsWith("/api/v1/issuing/cards/")) {
        const id = p.split("/").pop();
        return Response.json({ card_id: id, card_status: "ACTIVE", authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 46, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] }, allowed_merchant_categories: ["5734"] } });
      }
      if (p === "/api/v1/issuing/transactions") return Response.json({ items: [
        { transaction_id: "tx-old", card_id: OLD, transaction_type: "AUTHORIZATION", status: "FAILED", transaction_amount: -45, transaction_currency: "EUR", failure_reason: "LIMIT_EXCEEDED", transaction_date: "2026-10-29T14:45:28.541+0000" },
        { transaction_id: "tx-new", card_id: NEW, transaction_type: "AUTHORIZATION", status: "APPROVED", transaction_amount: -29.99, transaction_currency: "EUR", transaction_date: "2026-11-06T10:00:00.000+0000" },
      ] });
      if (p === "/api/v1/beneficiaries") return Response.json({ items: [
        { id: "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", nickname: "Stockline Data GmbH EUR SWIFT", beneficiary: { entity_type: "COMPANY", bank_details: { bank_country_code: "DE", account_currency: "EUR", iban: "DE02120300000000202051" } }, transfer_methods: ["SWIFT"] },
        { id: "2fdac779-877a-418a-8ade-d21764af7558", nickname: "Bergtex Textil GmbH EUR SWIFT", beneficiary: { entity_type: "COMPANY", bank_details: { account_name: "Bergtex Textil GmbH", bank_country_code: "DE", account_currency: "EUR" } }, transfer_methods: ["SWIFT"] },
      ] });
      return Response.json({ code: "not_found" }, { status: 404 });
    }) as unknown as typeof fetch;
    const d = new AwxReadDesk(sqlOver(new Database(":memory:")), { clientId: CLIENT, apiKey: KEY, fetchImpl, now: () => Date.parse("2026-11-14T19:00:00Z") });
    return { d, calls };
  }

  it("reads one card's own record (by id, GET only) for its limits; never the card number's /details", () => {
    expect(readAllowedUrl("GET", `${HOST}/api/v1/issuing/cards/${NEW}`).pathname).toBe(`/api/v1/issuing/cards/${NEW}`);
    for (const [m, url] of [["GET", `${HOST}/api/v1/issuing/cards/${NEW}/details`], ["GET", `${HOST}/api/v1/issuing/cards/${NEW}/`], ["GET", `${HOST}/api/v1/issuing/cards/not-a-card`],
      ["GET", `${HOST}/api/v1/issuing/cards/${NEW}?x=1`], ["POST", `${HOST}/api/v1/issuing/cards/${NEW}`], ["POST", `${HOST}/api/v1/issuing/cards/${NEW}/update`], ["GET", `${HOST}/api/v1/issuing/cards/${NEW.toUpperCase()}`]] as const) {
      expect(() => readAllowedUrl(m, url), `${m} ${url}`).toThrow(AwxReadNotAllowed);
    }
  });

  it("shows the newest cards first, with the limits from each active card's own record, and the newest authorizations first", async () => {
    const { d, calls } = liveShapes();
    const a = await d.read("issuing");
    expect(a.source).toBe("airwallex-sandbox");
    const data = (a as Extract<AwxReadAnswer, { source: "airwallex-sandbox" }>).data as { cards: { id: string; last4: string; status: string; currency: string | null; limits: { amount: string; interval: string }[]; nickname: string }[]; transactions: { id: string }[] };
    expect(data.cards.map((c) => c.last4)).toEqual(["1423", "8653", "8366"]);
    expect(data.cards[0]).toMatchObject({ id: NEW, status: "ACTIVE", currency: "EUR", limits: [{ amount: "46", interval: "PER_TRANSACTION" }, { amount: "100", interval: "MONTHLY" }], nickname: expect.stringMatching(/^sourcing agent/) });
    expect(data.cards[1]).toMatchObject({ status: "CLOSED", limits: [] }); // a closed card is not read one by one
    expect(data.transactions.map((t) => t.id)).toEqual(["tx-new", "tx-old"]);
    expect(calls.filter((c) => c.startsWith("GET /api/v1/issuing/cards/"))).toEqual([`GET /api/v1/issuing/cards/${NEW}`, `GET /api/v1/issuing/cards/${OLD}`]);
    expect(calls.some((c) => c.endsWith("/details"))).toBe(false);
  });

  it("counts a card's read under {id}: no card id ever reaches the calls panel", async () => {
    const { d } = liveShapes();
    await d.read("issuing");
    const c = await d.read("calls");
    const s = JSON.stringify(c);
    expect(s).toContain('"GET /api/v1/issuing/cards/{id}"');
    expect(s).not.toContain(NEW);
    expect(s).not.toContain(OLD);
  });

  it("names a beneficiary from its bank account when Airwallex gives no company name, and finds the recorded payee check by its nickname", async () => {
    const { d } = liveShapes();
    const a = await d.read("beneficiaries");
    const data = (a as Extract<AwxReadAnswer, { source: "airwallex-sandbox" }>).data as { beneficiaries: { name: string | null; nickname: string }[] };
    expect(data.beneficiaries.map((b) => b.name)).toEqual([null, "Bergtex Textil GmbH"]);
    const { annotateBeneficiaries } = await import("../cloud/src/awxLive.js");
    const ann = annotateBeneficiaries(data as unknown as Record<string, unknown>) as { beneficiaries: { payee_check: { match: string; source: string } | null }[] };
    expect(ann.beneficiaries[0]!.payee_check).toMatchObject({ match: "NOT_MATCHED", source: "recorded" });
    expect(ann.beneficiaries[1]!.payee_check).toBeNull();
  });
});

describe("the reconciliation: Purser's ledger of the run against Airwallex's financial transactions", () => {
  const live = (items: unknown[]): AwxLiveAnswer => ({ view: "financial", source: "airwallex-sandbox", host: "api.sandbox.airwallex.com", read_at: "2026-11-14T10:00:00.000Z", cache_seconds: 45, data: { run: items, run_window: RUN_WINDOW } });
  const asRows = (items: typeof FT_ITEMS) => items.map((i) => ({ ...i, amount: String(i.amount), fee: String(i.fee), net: String(i.net) }));

  it("agrees to the cent with the rows Airwallex holds: 0 differences, computed", () => {
    const r = reconcileView(live(asRows(FT_ITEMS)), new Date());
    expect(r.source).toBe("airwallex-sandbox");
    const d = (r as Extract<AwxLiveAnswer, { source: "airwallex-sandbox" }>).data as { computed: boolean; checked: number; matched: number; differences: number; movements: { matched: boolean }[] };
    expect(d.computed).toBe(true);
    expect(d.checked).toBeGreaterThanOrEqual(3);
    expect({ matched: d.matched, differences: d.differences }).toEqual({ matched: d.checked, differences: 0 });
  });

  it("shows a 1-cent difference as unmatched, with its reason", () => {
    const rows = asRows(FT_ITEMS);
    const payout = rows.find((x) => x.source_type === "PAYOUT")!;
    payout.amount = (Number(payout.amount) - 0.01).toFixed(2);
    const r = reconcileView(live(rows), new Date()) as Extract<AwxLiveAnswer, { source: "airwallex-sandbox" }>;
    const d = r.data as { differences: number; movements: { source_id: string; matched: boolean; reason: string }[] };
    expect(d.differences).toBe(1);
    expect(d.movements.find((m) => m.source_id === payout.source_id)).toMatchObject({ matched: false, reason: "amounts differ" });
  });

  it("concludes nothing when Airwallex could not be read", () => {
    const r = reconcileView({ view: "financial", source: "unavailable", host: "api.sandbox.airwallex.com", code: "no_answer", reason: "the Airwallex sandbox did not answer in time", checked_at: "x" }, new Date());
    expect(r).toMatchObject({ view: "reconcile", source: "unavailable" });
    expect(JSON.stringify(r)).not.toMatch(/differences/);
  });

  it("an amount finer than a cent is no conclusion", () => {
    const rows = asRows(FT_ITEMS);
    rows[0]!.amount = "-1850.005";
    expect(reconcileView(live(rows), new Date())).toMatchObject({ source: "unavailable", code: "bad_answer" });
  });
});

describe("the records the tab checks against", () => {
  it("cloud/src/awxRecorded.ts is the records' own fields, unchanged", async () => {
    const { AWX_RUN_RECORDED, PAYEE_CHECKS_RECORDED } = await import("../cloud/src/awxRecorded.js");
    const run = JSON.parse(readFileSync(new URL("../docs/demo/airwallex-run.json", import.meta.url), "utf8")) as { run: string; invoices: Record<string, unknown>[] };
    const pick = (i: Record<string, unknown>) => ({ invoice_no: i.invoice_no, amount: i.amount, transfer_id: i.transfer_id, status: i.status, fee: i.fee, conversion_id: i.conversion_id, approval_sha256: i.approval_sha256,
      quote: i.quote ? { buy_eur: (i.quote as Record<string, unknown>).buy_eur, sell_usd: (i.quote as Record<string, unknown>).sell_usd } : null });
    expect(AWX_RUN_RECORDED).toEqual({ run: run.run, invoices: run.invoices.map(pick) });
    const pc = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-airwallex-payee-check.json", import.meta.url), "utf8")) as { audit: { ts: string; event: string; subject: string | null; payload: { match?: string; label?: string } }[] };
    expect(PAYEE_CHECKS_RECORDED).toEqual(pc.audit.filter((a) => a.subject && /^payee\.name_check/.test(a.event)).map((a) => ({ name: a.subject, match: a.payload.match ?? null, label: a.payload.label ?? null, at: a.ts })));
  });
});

describe("FX rates read the right way round (live, 14 Nov)", () => {
  it("follows Airwallex's currency pair, whichever side is bought: never '1 BUY = rate SELL' blindly", async () => {
    const { rateWords, annotateRates } = await import("../cloud/src/awxLive.js");
    // As read live: buying EUR with USD and buying USD with EUR, both quoted as EURUSD (the spread between them).
    expect(rateWords({ sell_currency: "USD", buy_currency: "EUR", rate: "1.116374", pair: "EURUSD" })).toEqual({ base: "EUR", quote: "USD", says: "1 EUR = 1.116374 USD" });
    expect(rateWords({ sell_currency: "EUR", buy_currency: "USD", rate: "1.08768", pair: "EURUSD" })).toEqual({ base: "EUR", quote: "USD", says: "1 EUR = 1.08768 USD" });
    expect(rateWords({ sell_currency: "GBP", buy_currency: "EUR", rate: "0.844602", pair: "EURGBP" })).toEqual({ base: "EUR", quote: "GBP", says: "1 EUR = 0.844602 GBP" });
    // A pair that does not name both currencies, or none at all: no "1 X = Y" is said.
    expect(rateWords({ sell_currency: "USD", buy_currency: "EUR", rate: "1.1", pair: "GBPUSD" })).toBeNull();
    expect(rateWords({ sell_currency: "USD", buy_currency: "EUR", rate: "1.1", pair: null })).toBeNull();
    const a = annotateRates({ rates: [{ sell_currency: "USD", buy_currency: "EUR", rate: "1.116374", pair: "EURUSD" }] }) as { rates: { says: string }[] };
    expect(a.rates[0]!.says).toBe("1 EUR = 1.116374 USD");
  });
});

describe("the tab's look: the official logo, the Overview card", () => {
  it("embeds the Airwallex wordmark byte for byte", async () => {
    const { AIRWALLEX_LOGO_DATA_URL } = await import("../cloud/src/awxLogo.gen.js");
    const file = readFileSync(new URL("../src/ui/logos/airwallex.png", import.meta.url));
    expect(AIRWALLEX_LOGO_DATA_URL).toBe(`data:image/png;base64,${file.toString("base64")}`);
  });
  it("puts the live card on the Overview, labelled apart from the demo month, and the logo in the console's script", async () => {
    const { consolePage } = await import("../cloud/src/console.js");
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
    expect(html).toContain("nx,awlOverview(),dash]");
    expect(html).toContain("const AWL_LOGO=\"data:image/png;base64,");
    expect(html).not.toContain("__AWL_LOGO__");
    const { MESSAGES } = await import("../src/ui/i18n.js");
    expect(MESSAGES.en["cs.awl.ov_sub"]).toMatch(/Airwallex sandbox: test money.*demo company's simulated month/);
  });
});

describe("the cloud's check of the gateway's answer", () => {
  it("drops an answer that is not the sandbox's or that carries a secret-looking field", () => {
    const now = new Date();
    expect(checkGatewayAnswer("balances", { host: "api.airwallex.com", source: "airwallex-sandbox", read_at: "x", data: {} }, now)).toMatchObject({ source: "unavailable" });
    expect(checkGatewayAnswer("balances", { host: "api.sandbox.airwallex.com", source: "airwallex-sandbox", read_at: "x", data: { token: "abc" } }, now)).toMatchObject({ source: "unavailable", reason: expect.stringMatching(/withheld/) });
    expect(checkGatewayAnswer("balances", null, now)).toMatchObject({ source: "unavailable" });
  });
});

describe("GET /v1/airwallex-live/{view} for a guest", () => {
  let c: TestCloud;
  beforeEach(async () => { c = await testCloud(); });
  afterEach(() => c.close());
  const guest = async () => ((await c.req("POST", "/v1/auth/guest", { key: null })).json as { session: string }).session;

  it("reads every view through the gateway, labelled, with ids in full and no secret", async () => {
    const { d } = desk();
    c.env.awxRead = { read: (v: string) => d.read(v as Parameters<typeof d.read>[0]) };
    const g = await guest();
    for (const v of ["balances", "accounts", "financial", "rates", "transfers", "beneficiaries", "issuing", "calls", "reconcile"]) {
      const r = await c.req("GET", `/v1/airwallex-live/${v}`, { key: g });
      expect({ v, status: r.status, source: r.json.source }).toEqual({ v, status: 200, source: "airwallex-sandbox" });
      secretFree(r.json);
    }
    const t = (await c.req("GET", "/v1/airwallex-live/transfers", { key: g })).json as { data: { transfers: { id: string; recorded: { matches: boolean } | null }[] } };
    const first = RUN.invoices.find((i) => i.transfer_id)!;
    expect(t.data.transfers.find((x) => x.id === first.transfer_id)!.recorded).toMatchObject({ invoice: first.invoice_no, approval_sha256: first.approval_sha256, matches: true });
    expect(t.data.transfers.filter((x) => x.recorded && !x.recorded.matches).length).toBe(1);
    const b = (await c.req("GET", "/v1/airwallex-live/beneficiaries", { key: g })).json as { data: { beneficiaries: { payee_check: { match: string; source: string } | null }[] } };
    expect(b.data.beneficiaries[0]!.payee_check).toMatchObject({ match: "NOT_MATCHED", source: "recorded" });
    const i = (await c.req("GET", "/v1/airwallex-live/issuing", { key: g })).json as { data: { cards: { agent: string | null; limits: unknown[] }[] } };
    expect(i.data.cards[0]).toMatchObject({ agent: "sourcing", limits: [{ amount: "46", interval: "PER_TRANSACTION" }] });
    const rec = (await c.req("GET", "/v1/airwallex-live/reconcile", { key: g })).json as { data: { differences: number; computed: boolean } };
    expect(rec.data).toMatchObject({ computed: true, differences: 0 });
  });

  it("without the gateway, says the sandbox is unavailable", async () => {
    const g = await guest();
    const r = await c.req("GET", "/v1/airwallex-live/balances", { key: g });
    expect(r.json).toMatchObject({ source: "unavailable", code: "no_gateway" });
  });

  it("a gateway that hangs is cut off with a clear state", async () => {
    // A gateway that throws at once stands in for one that times out (the timeout itself is AWX_GATEWAY_TIMEOUT_MS).
    c.env.awxRead = { read: () => Promise.reject(new Error("boom")) };
    const g = await guest();
    expect((await c.req("GET", "/v1/airwallex-live/rates", { key: g })).json).toMatchObject({ source: "unavailable", code: "no_answer", reason: "the Airwallex gateway did not answer" });
  });

  it("is a GET only, needs a session, refuses unknown views, and caps each visitor", async () => {
    const { d } = desk();
    c.env.awxRead = { read: (v: string) => d.read(v as Parameters<typeof d.read>[0]) };
    expect((await c.req("GET", "/v1/airwallex-live/balances", { key: null })).status).toBe(401);
    const g = await guest();
    expect((await c.req("POST", "/v1/airwallex-live/balances", { key: g, body: {} })).status).toBeGreaterThanOrEqual(400);
    expect((await c.req("GET", "/v1/airwallex-live/transfers-create", { key: g })).status).toBe(404);
    let last = 200;
    for (let k = 0; k <= AWX_VISITOR_PER_MINUTE; k++) last = (await c.req("GET", "/v1/airwallex-live/calls", { key: g, headers: { "cf-connecting-ip": "203.0.113.9" } })).status;
    expect(last).toBe(429);
    // Another network is not held back by the first.
    expect((await c.req("GET", "/v1/airwallex-live/calls", { key: g, headers: { "cf-connecting-ip": "203.0.113.10" } })).status).toBe(200);
  });
});

// Types only: the gateway's answer and the cloud's agree on the fields the page reads.
const _shape: (a: AwxReadAnswer) => AwxLiveAnswer["source"] = (a) => a.source;
void _shape;
