// The workplace connectors' HTTP layer (src/workplace/http.ts): each status is its own error kind with the provider's
// own short words (never a query string, never a control character), a body is refused past its cap whether its length
// was declared or not, a JSON answer must parse and have the documented shape, and base64 is decoded only when it is
// strict and within its cap. A failed or timed-out call says which, with no detail of the request.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { call, callBytes, callJson, decodeBase64, providerMessage, readCapped, setting, where, WorkplaceError } from "../src/workplace/http.js";

const answer = (status: number, body: string | null, headers: Record<string, string> = {}) => async () => new Response(body, { status, headers });
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a refusal"); }, (e: unknown) => e as WorkplaceError);
const URL1 = "https://graph.example/v1/me/messages?$search=secret@example.com";

describe("an error from the provider", () => {
  it.each([
    [401, "auth"], [403, "auth"], [404, "not_found"], [429, "rate_limited"], [503, "server"], [409, "refused"],
  ])("HTTP %i is %s, said with the path only and the provider's words", async (status, kind) => {
    const e = await failure(call(URL1, { token: async () => "t", fetch: answer(status, JSON.stringify({ error: { message: "Mailbox\u0007 is busy" } })) }));
    expect(e).toBeInstanceOf(WorkplaceError);
    expect(e).toMatchObject({ kind, status });
    expect(e.message).toBe(`GET graph.example/v1/me/messages: HTTP ${status}: Mailbox  is busy`);
  });

  it("reads the provider's words from each documented shape, and nothing from a body that is not JSON", () => {
    expect(providerMessage(JSON.stringify({ error: "invalid_grant", error_description: "The refresh token expired" }))).toBe("The refresh token expired");
    expect(providerMessage(JSON.stringify({ Message: "Xero says no" }))).toBe("Xero says no");
    expect(providerMessage(JSON.stringify({ message: "lower case" }))).toBe("lower case");
    expect(providerMessage(JSON.stringify({ error: "plain" }))).toBe("plain");
    expect(providerMessage(JSON.stringify({ error: { message: 7 } }))).toBe("");
    expect(providerMessage("<html>")).toBe("");
    expect(where("POST", "not a url")).toBe("POST (a malformed URL)");
  });

  it("an error with no words says only the status", async () => {
    const e = await failure(call(URL1, { token: null, fetch: answer(500, "") }));
    expect(e.message).toBe("GET graph.example/v1/me/messages: HTTP 500");
  });

  it("a call that fails or times out says which, never the request", async () => {
    const down = await failure(call(URL1, { token: null, fetch: async () => { throw new TypeError("fetch failed: secret@example.com"); } }));
    expect(down).toMatchObject({ kind: "network", message: "GET graph.example/v1/me/messages: the call failed" });
    const slow = await failure(call(URL1, { token: null, fetch: async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); } }));
    expect(slow.message).toBe("GET graph.example/v1/me/messages: no answer in time");
  });

  it("sends the bearer token, the method and the body as given", async () => {
    let seen: RequestInit | undefined;
    await call("https://x.example/a", { method: "PATCH", body: "{}", headers: { "content-type": "application/json" }, token: async () => "tok", fetch: async (_u, init) => { seen = init; return new Response("{}"); } });
    expect(seen).toMatchObject({ method: "PATCH", body: "{}", headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer tok" } });
  });
});

describe("reading an answer", () => {
  it("refuses a declared length over the cap before reading, and a stream that passes the cap while reading", async () => {
    expect(await failure(readCapped(new Response("x".repeat(10), { headers: { "content-length": "10" } }), 5, "GET a"))).toMatchObject({ kind: "too_large", message: "GET a: the answer is 10 bytes, above the cap of 5; nothing was read" });
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); c.enqueue(new Uint8Array(4)); c.close(); } });
    expect(await failure(readCapped(new Response(stream), 5, "GET a"))).toMatchObject({ kind: "too_large", message: "GET a: the answer passed the cap of 5 bytes; it was not kept" });
    expect(await readCapped(new Response(null), 5, "GET a")).toEqual(new Uint8Array(0));
    expect(await readCapped(new Response("abc"), 5, "GET a")).toEqual(new TextEncoder().encode("abc"));
  });

  it("a JSON answer must parse and have the documented shape; an empty one is an empty object", async () => {
    const schema = z.object({ id: z.string() });
    expect(await callJson("https://x.example/a", schema, { token: null, fetch: answer(200, '{"id":"m1"}') })).toEqual({ id: "m1" });
    expect(await failure(callJson("https://x.example/a", schema, { token: null, fetch: answer(200, "not json") }))).toMatchObject({ kind: "invalid", message: "GET x.example/a: the answer is not JSON" });
    expect(await failure(callJson("https://x.example/a", schema, { token: null, fetch: answer(200, '{"id":7}') }))).toMatchObject({ kind: "invalid", message: "GET x.example/a: the answer is not the documented shape (id: invalid_type)" });
    expect(await failure(callJson("https://x.example/a", schema, { token: null, fetch: answer(200, "  ") }))).toMatchObject({ message: expect.stringContaining("(id: invalid_type)") });
    expect(await failure(callJson("https://x.example/a", z.string(), { token: null, fetch: answer(200, "{}") }))).toMatchObject({ message: expect.stringContaining("((root): invalid_type)") });
  });

  it("a file's bytes, within their cap", async () => {
    expect(await callBytes("https://x.example/f", 10, { token: null, fetch: answer(200, "pdf") })).toEqual(new TextEncoder().encode("pdf"));
    expect(await failure(callBytes("https://x.example/f", 2, { token: null, fetch: answer(200, "pdf") }))).toMatchObject({ kind: "too_large" });
  });
});

describe("base64 and settings", () => {
  it("decodes strict base64url and base64 within the cap, and refuses anything else", () => {
    expect(Buffer.from(decodeBase64("aGVs bG8_", 10)).toString("latin1")).toBe("hello?");
    expect(Buffer.from(decodeBase64("aGVsbG8/", 10, false)).toString("latin1")).toBe("hello?");
    expect(() => decodeBase64("aGVsbG8/", 10)).toThrow("the attachment's data is not base64");
    expect(() => decodeBase64("aGVsbG8_", 10, false)).toThrow("the attachment's data is not base64");
    expect(() => decodeBase64("aGVsbG8=", 4)).toThrow("the attachment is above the cap of 4 bytes; it was not decoded");
  });
  it("a missing setting names the variable", () => {
    expect(setting({ A: " v " }, "A")).toBe("v");
    expect(() => setting({ A: "  " }, "A")).toThrow("A is not set");
  });
});
