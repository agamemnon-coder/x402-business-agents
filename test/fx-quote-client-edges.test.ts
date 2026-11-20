// /try/sign's live FX quote client (worker/src/fxQuote.ts), the edges test/try-fx.test.ts leaves: an ask it never sends,
// a login without an expiry (the token kept 25 minutes, no longer), a login refused, a sandbox that does not answer
// (also the platform's own fetch: no network in the tests), an answer that is a list, and two 401s in a row.
import { describe, expect, it } from "vitest";
import { QuoteUnavailable, SandboxQuotes, toQuote } from "../worker/src/fxQuote.js";

const TOKEN = "test-token-ffffffffffffffffffffffffffffff";
const ask = { buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "623.50" };
const good = { quote_id: "q-12345678", buy_currency: "EUR", sell_currency: "USD", buy_amount: 623.5, sell_amount: "704.37", client_rate: 1.1297, valid_to_at: "2026-11-06T09:47:24+0000" };
const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
function sandbox(login: () => Response, quote: () => Response) {
  const calls: string[] = [];
  const fetchImpl = (async (u: string | URL) => {
    const p = new URL(String(u)).pathname;
    calls.push(p);
    return p.endsWith("/login") ? login() : quote();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("the sandbox quote client's edges", () => {
  it("never sends an ask for another currency form or an amount that is not one", async () => {
    const s = sandbox(() => res(200, { token: TOKEN }), () => res(200, good));
    const c = new SandboxQuotes({ clientId: "id", apiKey: "k", fetchImpl: s.fetchImpl });
    for (const a of [{ ...ask, buyCurrency: "eur" }, { ...ask, sellCurrency: "US" }, { ...ask, buyAmount: "1.234" }, { ...ask, buyAmount: "0" }]) {
      await expect(c.quote(a)).rejects.toThrow("not a quote this page asks for");
    }
    expect(s.calls).toEqual([]);
  });

  it("a login without an expiry keeps its token 25 minutes, then logs in again", async () => {
    let now = Date.parse("2026-11-06T09:30:00Z");
    const s = sandbox(() => res(200, { token: TOKEN }), () => res(200, good));
    const c = new SandboxQuotes({ clientId: "id", apiKey: "k", fetchImpl: s.fetchImpl, now: () => now });
    expect(await c.quote(ask)).toMatchObject({ quote_id: "q-12345678", buy_amount: "623.50", sell_amount: "704.37", client_rate: "1.1297", valid_to_at: "2026-11-06T09:47:24Z" });
    now += 23 * 60_000;
    await c.quote(ask);
    expect(s.calls.filter((p) => p.endsWith("/login"))).toHaveLength(1);
    now += 60_000; // 24 minutes: within a minute of the 25, so a new login
    await c.quote(ask);
    expect(s.calls.filter((p) => p.endsWith("/login"))).toHaveLength(2);
  });

  it("a refused login, a short token, and a login that is not JSON are all a refused login", async () => {
    for (const login of [() => res(403, { code: "forbidden" }), () => res(200, { token: "short" }), () => res(200, "<html>")]) {
      const c = new SandboxQuotes({ clientId: "id", apiKey: "k", fetchImpl: sandbox(login, () => res(200, good)).fetchImpl });
      await expect(c.quote(ask)).rejects.toThrow(/^the Airwallex sandbox refused the login \(HTTP \d+\)$/);
    }
  });

  it("no answer at all, and the platform's own fetch with no network, are 'did not answer'", async () => {
    const down = new SandboxQuotes({ clientId: "id", apiKey: "k", fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch });
    await expect(down.quote(ask)).rejects.toThrow("the Airwallex sandbox did not answer");
    await expect(new SandboxQuotes({ clientId: "id", apiKey: "k" }).quote(ask)).rejects.toBeInstanceOf(QuoteUnavailable);
  });

  it("an answer that is a list is no quote, and two 401s in a row give up", async () => {
    const list = new SandboxQuotes({ clientId: "id", apiKey: "k", fetchImpl: sandbox(() => res(200, { token: TOKEN }), () => res(200, [good])).fetchImpl });
    await expect(list.quote(ask)).rejects.toThrow("the Airwallex sandbox gave no quote (HTTP 200)");
    const s = sandbox(() => res(200, { token: TOKEN }), () => res(401, {}));
    await expect(new SandboxQuotes({ clientId: "id", apiKey: "k", fetchImpl: s.fetchImpl }).quote(ask)).rejects.toThrow("the Airwallex sandbox gave no quote");
    expect(s.calls.filter((p) => p.endsWith("/login"))).toHaveLength(2);
  });

  it("a valid-to that is not a time, or far too long, is a quote not in the expected form", () => {
    expect(() => toQuote({ ...good, valid_to_at: 1762422444 }, ask)).toThrow("not in the expected form");
    expect(() => toQuote({ ...good, valid_to_at: "2026-11-06T09:47:24+0000".padEnd(41, " ") }, ask)).toThrow("not in the expected form");
    expect(() => toQuote({ ...good, sell_amount: "-1" }, ask)).toThrow("not in the expected form");
  });
});
