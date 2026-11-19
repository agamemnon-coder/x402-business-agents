// The Airwallex gateway's kit11 side (worker/src/awxGateway.ts AwxGatewayDesk), against a stand-in sandbox: each call is
// checked before anything is sent; a write needs AWX_GATEWAY_WRITE=on and every call a key; the login token is reused
// until a minute before it ends, and fetched again once on a 401; a POST with no answer, or a 5xx to a POST, is
// "ambiguous" (it may have happened) while a read is not; an error answers Airwallex's code and trace id only when they
// are plain, never its words, the key or the token.
import { describe, expect, it } from "vitest";
import { AwxGatewayDesk } from "../worker/src/awxGateway.js";

const BASE = "https://api.sandbox.airwallex.com/api/v1";
const KEY = { AWX_ACT_CLIENT_ID: "client-id", AWX_ACT_API_KEY: "api-key-secret" };
type Step = Response | Error;
/** A sandbox that answers the login with a fresh token each time and each other call from `calls`, in order. */
function sandbox(calls: Step[], login: () => Step = () => Response.json({ token: `tok-${++logins.n}` }), logins = { n: 0 }) {
  const seen: { url: string; method: string; auth: string | null; body: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen.push({ url, method: init.method ?? "GET", auth: h.get("authorization") ?? (h.get("x-api-key") ? "key" : null), body: (init.body as string | undefined) ?? null });
    const next = url.endsWith("/authentication/login") ? login() : calls.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { seen, fetchImpl, logins };
}
const read = { method: "GET" as const, path: "/balances/current" };
const quote = { method: "POST" as const, path: "/fx/quotes/create", body: { buy_currency: "EUR", sell_currency: "USD", buy_amount: 100 } };

describe("before anything is sent", () => {
  it("a write is refused while writes are off, and any call without a key; the sandbox is never asked", async () => {
    const s = sandbox([]);
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: s.fetchImpl }).call(quote)).toEqual({ ok: false, status: 403, code: "gateway_writes_off", trace_id: null, refused: "writes are switched off at the gateway (AWX_GATEWAY_WRITE)" });
    expect(await new AwxGatewayDesk({ AWX_ACT_CLIENT_ID: "only-an-id" }, { fetchImpl: s.fetchImpl }).call(read)).toEqual({ ok: false, status: 503, code: "gateway_no_key", trace_id: null, refused: "the gateway holds no sandbox key" });
    expect(await new AwxGatewayDesk({ ...KEY, AWX_GATEWAY_WRITE: "yes" }, { fetchImpl: s.fetchImpl }).call(quote)).toMatchObject({ code: "gateway_writes_off" });
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: s.fetchImpl }).call({ method: "GET", path: "/transfers/../keys" })).toMatchObject({ status: 400, code: "gateway_refused", refused: "not a plain path" });
    expect(s.seen).toEqual([]);
  });
});

describe("the login token", () => {
  it("is fetched with the key, reused until a minute before it ends, then fetched again; the key goes to the login only", async () => {
    let t = 0;
    const s = sandbox([Response.json({ a: 1 }), Response.json({ a: 2 }), Response.json({ a: 3 })]);
    const desk = new AwxGatewayDesk(KEY, { fetchImpl: s.fetchImpl, now: () => t });
    expect(await desk.call({ ...read, query: { currency: "EUR" } })).toEqual({ ok: true, status: 200, json: { a: 1 } });
    t = 23 * 60_000; // 2 minutes before the 25-minute token ends: still used
    await desk.call(read);
    t = 24 * 60_000 + 1; // within the last minute: a new login
    await desk.call(read);
    expect(s.seen.map((x) => [x.method, x.url.replace(BASE, ""), x.auth])).toEqual([
      ["POST", "/authentication/login", "key"], ["GET", "/balances/current?currency=EUR", "Bearer tok-1"], ["GET", "/balances/current", "Bearer tok-1"],
      ["POST", "/authentication/login", "key"], ["GET", "/balances/current", "Bearer tok-2"],
    ]);
  });

  it("refused or unreadable: no call is made, and the answer says the login was refused or failed", async () => {
    const refused = sandbox([], () => Response.json({ code: "credentials_invalid" }, { status: 401 }));
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: refused.fetchImpl }).call(read)).toEqual({ ok: false, status: 502, code: "gateway_login_refused", trace_id: null });
    const noToken = sandbox([], () => new Response("not json"));
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: noToken.fetchImpl }).call(read)).toEqual({ ok: false, status: 502, code: "gateway_login_refused", trace_id: null });
    const down = sandbox([], () => new Error("connect ECONNREFUSED"));
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: down.fetchImpl }).call(read)).toEqual({ ok: false, status: 502, code: "gateway_login_failed", trace_id: null });
    for (const s of [refused, noToken, down]) expect(s.seen.map((x) => x.url)).toEqual([`${BASE}/authentication/login`]);
  });

  it("a 401 to a call fetches a new token and tries once more; a second 401 is the answer", async () => {
    const once = sandbox([new Response("", { status: 401 }), Response.json({ ok: 1 })]);
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: once.fetchImpl }).call(read)).toEqual({ ok: true, status: 200, json: { ok: 1 } });
    expect(once.seen.map((x) => x.auth)).toEqual(["key", "Bearer tok-1", "key", "Bearer tok-2"]);
    const twice = sandbox([new Response("", { status: 401 }), Response.json({ code: "unauthorized" }, { status: 401 })]);
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: twice.fetchImpl }).call(read)).toEqual({ ok: false, status: 401, code: "unauthorized", trace_id: null });
    expect(twice.seen).toHaveLength(4);
  });
});

describe("an answer that is not a success", () => {
  it("a POST without an answer may have happened: ambiguous, not resent; a read without one is just a 504", async () => {
    const post = sandbox([new Error("socket hang up")]);
    expect(await new AwxGatewayDesk({ ...KEY, AWX_GATEWAY_WRITE: "on" }, { fetchImpl: post.fetchImpl }).call(quote)).toEqual({ ok: false, status: 504, code: null, trace_id: null, ambiguous: true });
    expect(post.seen.filter((x) => x.url.endsWith("/fx/quotes/create"))).toHaveLength(1);
    expect(JSON.parse(post.seen[1]!.body!)).toEqual(quote.body);
    const get = sandbox([new Error("socket hang up")]);
    expect(await new AwxGatewayDesk(KEY, { fetchImpl: get.fetchImpl }).call(read)).toEqual({ ok: false, status: 504, code: null, trace_id: null });
  });

  it("a 5xx to a POST is ambiguous too; a 4xx is not; Airwallex's code and trace id come back only when plain", async () => {
    const desk = (calls: Step[]) => new AwxGatewayDesk({ ...KEY, AWX_GATEWAY_WRITE: "on" }, { fetchImpl: sandbox(calls).fetchImpl });
    const err = (status: number, body: unknown, trace: string) => new Response(JSON.stringify(body), { status, headers: { "x-b3-traceid": trace } });
    expect(await desk([err(500, { code: "internal_error", message: "words with the key api-key-secret" }, "abc123")]).call(quote))
      .toEqual({ ok: false, status: 500, code: "internal_error", trace_id: "abc123", ambiguous: true });
    expect(await desk([err(400, { code: "invalid argument!", message: "nope" }, "trace with spaces")]).call(quote))
      .toEqual({ ok: false, status: 400, code: null, trace_id: null });
    expect(await desk([err(503, "not an object", "t-1")]).call(read)).toEqual({ ok: false, status: 503, code: null, trace_id: "t-1" });
    expect(await desk([new Response("<html>", { status: 502 })]).call(read)).toEqual({ ok: false, status: 502, code: null, trace_id: null });
  });
});
