// The Airwallex client's own edges (src/airwallex/client.ts): a login Airwallex refuses, or answers with no token, is
// an error with its status and code; a read whose request never got an answer is asked again with a growing pause, at
// most four times, then the error stands; a POST in the same case is ambiguous at once; an answer that is not JSON
// reads as nothing; Airwallex's retry-after is honoured with the real clock; the configuration from the environment
// acts for a connected account only with the platform switch on, and counts its calls with a budget; and secrets are
// stripped from bodies inside lists too. A recording stand-in for fetch; no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Airwallex, AirwallexAmbiguous, AirwallexError, fromEnv, redact } from "../src/airwallex/client.js";

type Answer = Response | Error | (() => Response | Error);
/** Answers the login with a token unless told otherwise, then each call in turn. */
function stand(answers: Answer[], login: Answer = Response.json({ token: "t" })) {
  const seen: string[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname.replace("/api/v1", "")}`);
    const a0 = url.pathname.endsWith("/authentication/login") ? login : answers[Math.min(i++, answers.length - 1)]!;
    const a = typeof a0 === "function" ? a0() : a0;
    if (a instanceof Error) throw a;
    return a;
  }) as typeof fetch;
  return { fetchImpl, seen };
}
const client = (fetchImpl: typeof fetch, sleeps: number[] = []) => new Airwallex({ clientId: "stand-in-client", apiKey: "stand-in-key", fetchImpl, minGapMs: 0, sleep: async (ms) => { sleeps.push(ms); } });

describe("the login", () => {
  it("refused, or answered without a token: an error with Airwallex's status and code", async () => {
    const refused = stand([], Response.json({ code: "credentials_invalid", message: "bad key" }, { status: 401 }));
    await expect(client(refused.fetchImpl).call("GET", "/balances/current")).rejects.toMatchObject({ status: 401, message: expect.stringContaining("/authentication/login -> 401 credentials_invalid") });
    const empty = stand([], new Response("not json", { status: 200 }));
    const e = await client(empty.fetchImpl).call("GET", "/balances/current").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AirwallexError);
    expect((e as AirwallexError).message).toContain("/authentication/login -> 200");
  });
});

describe("a request that never got an answer", () => {
  it("a read is asked again with a growing pause, four times at most, then the error stands", async () => {
    const sleeps: number[] = [];
    const s = stand([new TypeError("fetch failed")]);
    await expect(client(s.fetchImpl, sleeps).call("GET", "/balances/current")).rejects.toThrow("fetch failed");
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
    expect(s.seen.filter((x) => x === "GET /balances/current")).toHaveLength(5);
  });

  it("a read answered on the second try is answered", async () => {
    const s = stand([new TypeError("fetch failed"), Response.json([{ currency: "EUR" }])]);
    expect(await client(s.fetchImpl).call("GET", "/balances/current")).toEqual([{ currency: "EUR" }]);
  });

  it("a write is ambiguous at once: never sent twice", async () => {
    const s = stand([new TypeError("socket hang up")]);
    await expect(client(s.fetchImpl).call("POST", "/transfers/create", {})).rejects.toBeInstanceOf(AirwallexAmbiguous);
    expect(s.seen.filter((x) => x === "POST /transfers/create")).toHaveLength(1);
  });
});

describe("answers", () => {
  it("an answer that is not JSON reads as nothing", async () => {
    const s = stand([new Response("", { status: 200 })]);
    expect(await client(s.fetchImpl).call("GET", "/balances/current")).toBeNull();
  });

  it("a 429 with retry-after waits that long on the real clock, then asks again", async () => {
    const s = stand([new Response("{}", { status: 429, headers: { "retry-after": "0.001" } }), Response.json({ ok: true })]);
    const awx = new Airwallex({ clientId: "stand-in-client", apiKey: "stand-in-key", fetchImpl: s.fetchImpl, minGapMs: 0 });
    expect(await awx.call("GET", "/balances/current")).toEqual({ ok: true });
  });

  it("secrets are stripped inside lists too", () => {
    expect(redact([{ token: "x", items: [{ api_key: "y", amount: 1 }] }, "plain"])).toEqual([{ token: "[redacted]", items: [{ api_key: "[redacted]", amount: 1 }] }, "plain"]);
  });
});

describe("the configuration from the environment", () => {
  const BASE = { AIRWALLEX_CLIENT_ID: "stand-in-client", AIRWALLEX_API_KEY: "stand-in-key" };

  it("acts for a connected account only with the platform switch on and an account named", () => {
    expect(fromEnv({ ...BASE, AIRWALLEX_ON_BEHALF_OF: "acct_123" })).toEqual({ clientId: "stand-in-client", apiKey: "stand-in-key" });
    expect(fromEnv({ ...BASE, AIRWALLEX_PLATFORM: "on" })).not.toHaveProperty("onBehalfOf");
    expect(fromEnv({ ...BASE, AIRWALLEX_PLATFORM: "on", AIRWALLEX_ON_BEHALF_OF: "acct_123" })).toMatchObject({ onBehalfOf: "acct_123" });
  });

  it("counts every call against a budget when one is given, and refuses half a budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "awx-budget-"));
    try {
      const cfg = fromEnv({ ...BASE, AIRWALLEX_CALL_BUDGET: "10", AIRWALLEX_CALL_LOG: join(dir, "calls.jsonl") })!;
      expect(typeof cfg.fetchImpl).toBe("function");
      expect(() => fromEnv({ ...BASE, AIRWALLEX_CALL_BUDGET: "10" })).toThrow("AIRWALLEX_CALL_BUDGET (a whole number) and AIRWALLEX_CALL_LOG (a file) go together");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with AIRWALLEX_OAUTH on, no key is read, and it needs Purser Cloud", () => {
    expect(() => fromEnv({ ...BASE, AIRWALLEX_OAUTH: "on" })).toThrow("AIRWALLEX_OAUTH=on needs PURSER_CLOUD_URL and PURSER_CLOUD_KEY");
  });
});
