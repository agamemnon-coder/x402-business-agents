import { describe, expect, it } from "vitest";
import { Airwallex, AirwallexAmbiguous, AirwallexError, redact } from "../src/airwallex/client.js";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { impl, calls };
}

const login = { status: 201, body: { token: "tok-1", expires_at: "x" } };
const mk = (replies: Reply[]) => {
  const f = fakeFetch(replies);
  let t = 0;
  const client = new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: f.impl, sleep: async (ms) => { t += ms; }, now: () => t });
  return { client, calls: f.calls };
};

describe("Airwallex client", () => {
  it("logs in once and reuses the token", async () => {
    const { client, calls } = mk([login, { status: 200, body: { a: 1 } }, { status: 200, body: { b: 2 } }]);
    await client.call("GET", "/balances/current");
    await client.call("GET", "/balances/current");
    expect(calls.filter((c) => c.url.endsWith("/authentication/login"))).toHaveLength(1);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("backs off on 429 and retries", async () => {
    const { client } = mk([login, { status: 429, headers: { "retry-after": "1" } }, { status: 200, body: { ok: true } }]);
    expect(await client.call("GET", "/balances/current")).toEqual({ ok: true });
  });

  it("turns a lost POST answer into an ambiguous outcome, never a resend", async () => {
    const { client, calls } = mk([login, new TypeError("socket hang up")]);
    await expect(client.call("POST", "/transfers/create", { request_id: "r1" })).rejects.toBeInstanceOf(AirwallexAmbiguous);
    expect(calls.filter((c) => c.url.endsWith("/transfers/create"))).toHaveLength(1);
  });

  it("gives up on a call that hangs, and treats a hung POST as ambiguous, never resent", async () => {
    const calls: string[] = [];
    // Answers the login at once; every other call hangs until its signal aborts.
    const hang = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push(String(url));
      if (String(url).endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t" }), { status: 201 });
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    }) as typeof fetch;
    const client = new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: hang, timeoutMs: 20, sleep: async () => {} });
    await expect(client.call("POST", "/transfers/create", {})).rejects.toBeInstanceOf(AirwallexAmbiguous);
    expect(calls.filter((u) => u.endsWith("/transfers/create"))).toHaveLength(1);
  });

  it("surfaces Airwallex error codes", async () => {
    const { client } = mk([login, { status: 400, body: { code: "expired_quote", message: "quote expired" } }]);
    await expect(client.call("POST", "/fx/conversions/create", {})).rejects.toMatchObject({ code: "expired_quote" } satisfies Partial<AirwallexError>);
  });

  it("refuses a non-sandbox base URL", () => {
    expect(() => new Airwallex({ clientId: "a", apiKey: "b", baseUrl: "https://api.airwallex.com/api/v1" })).toThrow(/sandbox/);
  });

  it("redacts secrets in logged bodies", () => {
    expect(redact({ token: "t", nested: { api_key: "k", amount: "1.00" } })).toEqual({ token: "[redacted]", nested: { api_key: "[redacted]", amount: "1.00" } });
  });
});
