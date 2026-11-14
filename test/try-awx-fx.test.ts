// /try's live FX quote (14 Nov), on the kit11 Worker's side (worker/src/awxFx.ts): the desk the AwxFx entrypoint asks.
// It holds the caps (a day in all, a day per test company), the cache, the switch, and never passes on the key, the
// token or Airwallex's words. Its one call is fxQuote.ts's allow-listed quote; no network here: Airwallex is a fake fetch.
import { stripJsonComments } from "./support/wranglerConfig.js";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { sqlOver } from "../src/relay/local.js";
import { AWX_FX_COMPANY_DAY, AWX_FX_DAY, AwxFxDesk, type MarketQuotes } from "../worker/src/awxFx.js";
import { AWX_ALLOWED, AWX_SANDBOX_HOST, QuoteUnavailable, SandboxQuotes, marketRateOf, type FxQuote } from "../worker/src/fxQuote.js";

const KEY = "test-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN = "test-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const T0 = Date.parse("2026-11-14T10:00:00Z");
const ask = (company = "t_try_a", buyAmount = "350.00") => ({ company, buyCurrency: "EUR", sellCurrency: "USD", buyAmount });
const quoteFor = (buyAmount: string, validTo = T0 + 15 * 60_000): FxQuote => ({
  quote_id: "cc8fb106-29bb-3cce-b011-5fd0b4685617", sell_currency: "USD", buy_currency: "EUR", buy_amount: buyAmount, sell_amount: "406.42", client_rate: "1.1612",
  valid_to_at: new Date(validTo).toISOString().replace(/\.\d{3}Z$/, "Z"), source: "airwallex-sandbox",
});

function desk(o: { source?: MarketQuotes | null; off?: boolean; day?: number; companyDay?: number } = {}) {
  const clock = { t: T0 };
  const calls: string[] = [];
  const source: MarketQuotes = o.source ?? { quoteAndMarket: async (a) => { calls.push(a.buyAmount); return { quote: quoteFor(a.buyAmount), market_rate: "1.1601" }; } };
  const d = new AwxFxDesk(sqlOver(new Database(":memory:")), { source: o.source === null ? null : source, off: o.off ?? false, now: () => clock.t, ...(o.day ? { day: o.day } : {}), ...(o.companyDay ? { companyDay: o.companyDay } : {}) });
  return { d, clock, calls };
}

describe("the AwxFx desk: caps, cache, switch", () => {
  it("answers Airwallex's quote and its own rate; the same ask again is the cached quote, no second call", async () => {
    const { d, calls } = desk();
    expect(await d.quote(ask())).toEqual({ ok: true, quote: quoteFor("350.00"), market_rate: "1.1601", cached: false });
    expect(await d.quote(ask())).toMatchObject({ ok: true, cached: true });
    expect(calls).toEqual(["350.00"]);
    // Another company never gets this company's cached quote.
    expect(await d.quote(ask("t_try_b"))).toMatchObject({ ok: true, cached: false });
    expect(calls).toHaveLength(2);
    expect(d.callsToday()).toBe(2);
  });

  it("a cached quote with less than five minutes left is not handed out again", async () => {
    const { d, clock, calls } = desk();
    await d.quote(ask());
    clock.t += 11 * 60_000;
    expect(await d.quote(ask())).toMatchObject({ ok: true, cached: false });
    expect(calls).toHaveLength(2);
  });

  it(`at most ${AWX_FX_COMPANY_DAY} calls a day for one test company and ${AWX_FX_DAY} in all; a new UTC day starts again`, async () => {
    expect([AWX_FX_COMPANY_DAY, AWX_FX_DAY]).toEqual([6, 300]);
    const { d, clock, calls } = desk();
    for (let i = 0; i < AWX_FX_COMPANY_DAY; i++) expect(await d.quote(ask("t_try_a", `${100 + i}.00`))).toMatchObject({ ok: true });
    expect(await d.quote(ask("t_try_a", "999.00"))).toEqual({ ok: false, reason: "company_cap" });
    expect(calls).toHaveLength(AWX_FX_COMPANY_DAY);
    const all = desk({ day: 3 });
    for (const c of ["t_try_a", "t_try_b", "t_try_c"]) expect(await all.d.quote(ask(c))).toMatchObject({ ok: true });
    expect(await all.d.quote(ask("t_try_d"))).toEqual({ ok: false, reason: "day_cap" });
    expect(all.calls).toHaveLength(3);
    clock.t += 24 * 3600_000;
    expect(await d.quote(ask("t_try_a", "999.00"))).toMatchObject({ ok: true });
  });

  it("switched off or without the key: no call, a fixed reason", async () => {
    const off = desk({ off: true });
    expect(await off.d.quote(ask())).toEqual({ ok: false, reason: "switched_off" });
    expect(off.calls).toHaveLength(0);
    expect(await desk({ source: null }).d.quote(ask())).toEqual({ ok: false, reason: "no_key" });
  });

  it("refuses what is not a quote this demo asks for, before any call or count", async () => {
    const { d, calls } = desk();
    for (const bad of [{ ...ask(), company: "x; drop" }, { ...ask(), buyCurrency: "eur" }, { ...ask(), sellCurrency: "EUR" }, { ...ask(), buyAmount: "1e9" }, { ...ask(), buyAmount: "0.00" }, null]) {
      expect(await d.quote(bad as never)).toEqual({ ok: false, reason: "bad_request" });
    }
    expect(calls).toHaveLength(0);
    expect(d.callsToday()).toBe(0);
  });

  it("Airwallex fails: the code 'unavailable', never its words, and the failed call still counts", async () => {
    const { d } = desk({ source: { quoteAndMarket: async () => { throw new Error(`Airwallex said: bad key ${KEY} token ${TOKEN}`); } } });
    const out = await d.quote(ask());
    expect(out).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(out)).not.toMatch(/test-key|test-token/);
    expect(d.callsToday()).toBe(1);
  });
});

describe("the quote client's market rate: the same one call, no new path", () => {
  const QUOTE = { quote_id: "cc8fb106-29bb-3cce-b011-5fd0b4685617", client_rate: 1.1612, buy_amount: 350, sell_amount: 406.42, buy_currency: "EUR", sell_currency: "USD", valid_to_at: "2026-11-14T10:15:00+0000", awx_rate: 1.1601, mid_rate: 1.158 };
  function sandbox(body: Record<string, unknown> = QUOTE) {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      urls.push(u);
      if (u === `https://${AWX_SANDBOX_HOST}/api/v1/authentication/login`) return Response.json({ token: TOKEN, expires_at: "2026-11-14T10:30:00+0000" }, { status: 201 });
      if (u === `https://${AWX_SANDBOX_HOST}/api/v1/fx/quotes/create`) return Response.json(body);
      throw new Error(`unexpected call ${u}`);
    });
    return { urls, client: new SandboxQuotes({ clientId: "id", apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => T0, timeoutMs: 2_500 }) };
  }

  it("Airwallex's own rate (awx_rate, else mid_rate) from the quote's answer; only the two allow-listed calls are sent", async () => {
    const s = sandbox();
    const got = await s.client.quoteAndMarket({ buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "350.00" });
    expect(got).toEqual({ quote: { quote_id: QUOTE.quote_id, sell_currency: "USD", buy_currency: "EUR", buy_amount: "350.00", sell_amount: "406.42", client_rate: "1.1612", valid_to_at: "2026-11-14T10:15:00Z", source: "airwallex-sandbox" }, market_rate: "1.1601" });
    expect(s.urls.map((u) => u.replace(`https://${AWX_SANDBOX_HOST}`, ""))).toEqual(["/api/v1/authentication/login", "/api/v1/fx/quotes/create"]);
    expect(JSON.stringify(got)).not.toMatch(/test-key|test-token/);
    expect(marketRateOf({ mid_rate: "1.158" })).toBe("1.158");
    expect(marketRateOf({ awx_rate: -1, mid_rate: "x" })).toBeNull();
    // The table is unchanged: login and quote creation, nothing else (step 1 adds no Airwallex path).
    expect(AWX_ALLOWED.map((a) => `${a.method} ${a.path}`)).toEqual(["POST /api/v1/authentication/login", "POST /api/v1/fx/quotes/create"]);
  });

  it("a quote without Airwallex's own rate is no quote for the engine (its markup could not be checked)", async () => {
    const { awx_rate: _a, mid_rate: _m, ...bare } = QUOTE;
    await expect(sandbox(bare).client.quoteAndMarket({ buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "350.00" })).rejects.toBeInstanceOf(QuoteUnavailable);
  });
});

describe("the AwxFx entrypoint: reachable only through the binding", () => {
  const index = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
  it("the awx-fx instance is reached only from the AwxFx entrypoint's RPC, never from a route of the Worker's fetch", () => {
    expect(index).toMatch(/export class AwxFx extends WorkerEntrypoint<Env>/);
    expect(index.match(/idFromName\("awx-fx"\)/g)).toHaveLength(1);
    const entry = index.slice(index.indexOf("export class AwxFx"), index.indexOf("export default"));
    expect(entry).toContain('idFromName("awx-fx")');
    // The desk is made with the key inside its own quote client, with the short timeout; the switch is AWX_FX.
    expect(index).toMatch(/new SandboxQuotes\(\{ clientId: id, apiKey: key, timeoutMs: AWX_FX_TIMEOUT_MS \}\)/);
    expect(index).toMatch(/AWX_FX \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "off"/);
  });
  it("purser-try binds the entrypoint and holds no Airwallex key", () => {
    const cfg = readFileSync(new URL("../cloud/wrangler.try.jsonc", import.meta.url), "utf8");
    // 14 Nov: one services array, shared with the live Airwallex tab's read gateway (AWX_READ, entrypoint AwxRead).
    const services = (JSON.parse(stripJsonComments(cfg)) as { services: { binding: string; service: string; entrypoint: string }[] }).services;
    expect(services).toContainEqual({ binding: "AWX_FX", service: "kit11", entrypoint: "AwxFx" });
    expect(cfg.match(/"services"/g)).toHaveLength(1);
    expect(readFileSync(new URL("../cloud/src/engine/liveFx.ts", import.meta.url), "utf8")).not.toMatch(/AIRWALLEX_|apiKey|x-api-key/i);
  });
});
