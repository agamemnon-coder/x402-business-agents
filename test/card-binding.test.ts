// Red team 6, the last gap: card calls (Airwallex Issuing) act for the same account as payouts. With Purser as a
// platform (AIRWALLEX_PLATFORM=on) every card call, create, limits, controls, status, reads and the sandbox's simulated
// charge, runs only for the company's own account in the binding Purser Cloud signed, checked before each call; a
// mismatched, missing, expired or non-active binding stops it before anything reaches Airwallex. Off, nothing changes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Airwallex } from "../src/airwallex/client.js";
import { checkCardAccount } from "../src/airwallex/binding.js";
import { IssuingRest, issuingFor } from "../src/airwallex/issuing.js";
import { openDb, type DB } from "../src/db/open.js";
import { bind, BINDING_ENV } from "./support/platformBinding.js";

const ENV = { AIRWALLEX_PLATFORM: "on", ...BINDING_ENV };
const LIMITS = { currency: "EUR" as const, perTxCents: 3000, monthlyCents: 10_000 };
const CARD = { card_id: "card-1", cardholder_id: "ch-1", card_number: "************4242", card_status: "ACTIVE", nick_name: "sourcing" };

let db: DB;
let calls: { path: string; onBehalfOf: string | null }[];
beforeEach(() => { db = openDb(":memory:"); calls = []; Object.assign(process.env, ENV); });
afterEach(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

const api = (onBehalfOf?: string) => new Airwallex({
  clientId: "x", apiKey: "y", minGapMs: 0, ...(onBehalfOf ? { onBehalfOf } : {}),
  fetchImpl: (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
    calls.push({ path, onBehalfOf: new Headers(init?.headers).get("x-on-behalf-of") });
    if (path.endsWith("/issuing/transactions")) return new Response(JSON.stringify({ has_more: false, items: [] }), { status: 200 });
    return new Response(JSON.stringify(CARD), { status: 200 });
  }) as typeof fetch,
});

/** Every card call Purser makes, so none is left out of the check. */
const everyCall = (rest: IssuingRest) => [
  () => rest.createCard({ cardholderId: "ch-1", nickname: "sourcing", createdBy: "Purser", limits: LIMITS }),
  () => rest.getCard("card-1"),
  () => rest.findCardholderByEmail("cfo@example.com"),
  () => rest.createCardholder({ email: "cfo@example.com", firstName: "Test", lastName: "Holder" }),
  () => rest.findCard("ch-1", "sourcing"),
  () => rest.setCardControls("card-1", { mccs: ["5734"], currencies: ["EUR"] }),
  () => rest.setCardLimits("card-1", LIMITS),
  () => rest.setCardStatus("card-1", "INACTIVE"),
  () => rest.listCardTransactions("card-1"),
  () => rest.simulateCardCharge({ cardId: "card-1", amountCents: 4500, currency: "EUR", merchant: "Packwise", mcc: "5734" }),
];

describe("card calls with Purser as a platform", () => {
  it("run for the bound account, with its x-on-behalf-of on every call", async () => {
    await bind(db);
    const rest = issuingFor(api("acct_northwind"), db);
    for (const call of everyCall(rest)) await call().catch(() => undefined);
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(calls.every((c) => c.onBehalfOf === "acct_northwind")).toBe(true);
  });

  it("refuse a runner that acts for another account, before anything reaches Airwallex", async () => {
    await bind(db);
    for (const call of everyCall(issuingFor(api("acct_mallory"), db))) await expect(call()).rejects.toThrow(/acct_mallory.*nothing is done at Airwallex/);
    expect(calls).toEqual([]);
  });

  it("refuse a runner on the company's own account when the company is bound to a connected one", async () => {
    await bind(db);
    await expect(issuingFor(api(), db).getCard("card-1")).rejects.toThrow(/company's own Airwallex account.*nothing is done at Airwallex/);
    expect(calls).toEqual([]);
  });

  it.each(["dormant", "closed", "action_required"] as const)("refuse a %s account", async (status) => {
    await bind(db, { status });
    await expect(issuingFor(api("acct_northwind"), db).setCardLimits("card-1", LIMITS)).rejects.toThrow(/not active.*nothing is done at Airwallex/);
    expect(calls).toEqual([]);
  });

  it("refuse with no binding, or one that has expired", async () => {
    await expect(issuingFor(api("acct_northwind"), db).getCard("card-1")).rejects.toThrow(/nothing is done at Airwallex/);
    const past = new Date(Date.now() - 24 * 3600_000);
    await bind(db, {}, { now: past });
    await expect(issuingFor(api("acct_northwind"), db).getCard("card-1")).rejects.toThrow(/nothing is done at Airwallex/);
    expect(calls).toEqual([]);
  });

  it("check the binding at each call, not once: a binding closed after the rail was made stops the next call", async () => {
    await bind(db);
    const rest = issuingFor(api("acct_northwind"), db);
    await rest.getCard("card-1");
    await bind(db, { status: "closed" });
    await expect(rest.getCard("card-1")).rejects.toThrow(/closed, not active/);
    expect(calls).toHaveLength(1);
  });

  it("refuse a card rail made without the company's database: the binding cannot be checked", async () => {
    await bind(db);
    await expect(new IssuingRest(api("acct_northwind")).getCard("card-1")).rejects.toThrow(/binding.*nothing is done at Airwallex/);
    await expect(issuingFor(api("acct_northwind")).getCard("card-1")).rejects.toThrow(/nothing is done at Airwallex/);
    expect(calls).toEqual([]);
  });

  it("is the same check the payout executors run: the shared binding check names the reason", async () => {
    await bind(db, { status: "dormant" });
    expect(() => checkCardAccount(db, { payingAccount: "acct_northwind" }, new Date())).toThrow(/dormant, not active/);
  });
});

describe("card calls with the platform off", () => {
  beforeEach(() => { for (const k of Object.keys(ENV)) delete process.env[k]; });

  it("change nothing: the company's own account, no x-on-behalf-of, with or without a database", async () => {
    for (const rest of [new IssuingRest(api()), issuingFor(api(), db), issuingFor(api())]) {
      for (const call of everyCall(rest)) await call().catch(() => undefined);
    }
    expect(calls.length).toBeGreaterThanOrEqual(30);
    expect(calls.every((c) => c.onBehalfOf === null)).toBe(true);
  });

  it("refuse a rail that names a connected account while the platform is off", async () => {
    await expect(issuingFor(api("acct_northwind"), db).getCard("card-1")).rejects.toThrow(/nothing is done at Airwallex/);
    await expect(new IssuingRest(api("acct_northwind")).getCard("card-1")).rejects.toThrow(/nothing is done at Airwallex/);
    expect(calls).toEqual([]);
  });
});
