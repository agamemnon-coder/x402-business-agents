// The Airwallex sandbox's read-only Code Mode server (cloud/src/claude/awxCodemode.ts, awxCodemodeMcp.ts) at its edges,
// over a stand-in gateway port: what the protocol refuses, a path that normalises out of the API, a call that is not a
// call, a refusal, an unreachable gateway and an object answer as the plan reports them, the selection, filters and sums
// on odd data (no prototype keys read, groups without a value), truncation, and that every answer is redacted.
import { describe, expect, it } from "vitest";
import { AwxReadRefused, checkRead, MAX_ITEMS, runPlan, searchSpec, type AwxReadPort, type Plan } from "../cloud/src/claude/awxCodemode.js";
import { awxMcpAnswer } from "../cloud/src/claude/awxCodemodeMcp.js";
import { LEGACY_VERSIONS, MODERN_VERSIONS } from "../cloud/src/claude/mcp.js";
import type { GatewayAnswer, GatewayRequest } from "../src/airwallex/gatewayRules.js";

const T1 = "738a4263-6d6c-4de8-94a3-93da1c175fb4";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdHViIn0.c3R1Yi1zaWduYXR1cmU";

/** A gateway port answering by path; records every request. */
function port(answers: Record<string, GatewayAnswer | (() => Promise<GatewayAnswer>)>): AwxReadPort & { sent: GatewayRequest[] } {
  const sent: GatewayRequest[] = [];
  return {
    sent,
    call: async (r) => {
      sent.push(r);
      const a = answers[r.path];
      if (!a) return { ok: false, status: 404, code: "not_found", trace_id: "t-404" };
      return typeof a === "function" ? a() : a;
    },
  };
}
const ok = (json: unknown): GatewayAnswer => ({ ok: true, status: 200, json });
const TRANSFERS = ok({ has_more: true, items: [
  { id: T1, status: "PAID", amount: 100.25, currency: "EUR", beneficiary: { name: "Bergtex" } },
  { id: "b", status: "PAID", amount: "50", currency: "EUR" },
  { id: "c", status: "FAILED", amount: "n/a", currency: "GBP" },
  { id: "d", status: "PAID", amount: 7, constructor: "x" },
] });

const rpc = async (body: unknown, p: AwxReadPort | null = null) => awxMcpAnswer({ port: p }, typeof body === "string" ? body : JSON.stringify(body));
const toolText = (r: { body: unknown }) => JSON.parse(((r.body as { result: { content: { text: string }[] } }).result.content[0]!.text)) as Record<string, unknown>;

describe("the server's protocol", () => {
  it("refuses what is not one JSON-RPC 2.0 request; takes a notification without an answer", async () => {
    expect(await rpc("{nope")).toMatchObject({ status: 400, body: { id: null, error: { code: -32700 } } });
    expect(await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).toMatchObject({ status: 400, body: { id: null, error: { code: -32600 } } });
    expect(await rpc("null")).toMatchObject({ status: 400, body: { id: null, error: { code: -32600 } } });
    expect(await rpc({ id: 4, method: "ping" })).toMatchObject({ status: 400, body: { id: 4, error: { code: -32600 } } });
    expect(await rpc({ jsonrpc: "2.0", id: 5, method: 7 })).toMatchObject({ status: 400, body: { id: 5 } });
    expect(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({ status: 202, body: null });
  });

  it("initialize answers the asked legacy version or the newest; discover, ping, an unknown tool and an unknown method", async () => {
    expect(await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).toMatchObject({ body: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "purser-airwallex-read" } } } });
    expect(await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: "x" })).toMatchObject({ body: { result: { protocolVersion: LEGACY_VERSIONS[0] } } });
    expect(await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 2025 } })).toMatchObject({ body: { result: { protocolVersion: LEGACY_VERSIONS[0] } } });
    expect(await rpc({ jsonrpc: "2.0", id: 2, method: "server/discover" })).toMatchObject({ body: { result: { supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS] } } });
    expect(await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 3, result: {} } });
    expect(await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "transfer_money" } })).toMatchObject({ status: 200, body: { error: { code: -32602, message: "no tool transfer_money: this server has search and execute only" } } });
    expect(await rpc({ jsonrpc: "2.0", id: 5, method: "resources/list" })).toMatchObject({ status: 200, body: { error: { code: -32601, message: "method not found: resources/list" } } });
  });

  it("search: a query that is not a string or too long is refused; one that matches nothing says so; no arguments lists all", async () => {
    for (const query of [5, "x".repeat(201)]) {
      const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query } } });
      expect((r.body as { result: { isError: boolean } }).result.isError).toBe(true);
      expect(toolText(r)).toEqual({ error: "query must be a string of at most 200 characters" });
    }
    expect(toolText(await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "zebra quokka" } } }))).toMatchObject({ matches: [], note: "nothing matched; search with no query lists every operation" });
    expect((toolText(await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: "x" } })).operations as unknown[]).length).toBeGreaterThan(5);
    expect(searchSpec("transfers status").matches).not.toHaveLength(0);
  });

  it("execute: a plan the server refuses makes no call; one that cannot be run says so without its details", async () => {
    const p = port({ "/transfers": TRANSFERS });
    const refused = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute", arguments: { calls: [{ method: "GET", path: "/transfers" }, { method: "POST", path: "/transfers" }] } } }, p);
    expect(toolText(refused)).toEqual({ error: "refused", reason: "call 2: method POST is not allowed: GET only, this server never writes", calls_made: 0 });
    expect(p.sent).toEqual([]);
    // A filter that is not a list cannot be run: the answer says only that.
    const odd = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "execute", arguments: { calls: [{ method: "GET", path: "/transfers", where: 5 }] } } }, p);
    expect(toolText(odd)).toEqual({ error: "the plan could not be run" });
  });
});

describe("a call's check", () => {
  it("a path that normalises out of the API, and anything that is not a call, are refused", () => {
    expect(() => checkRead({ method: "GET", path: "/balances/./current" })).toThrow("refused: the path leaves the sandbox API");
    expect(() => checkRead(null as unknown as { method: string; path: string })).toThrow("refused: not a call");
    expect(() => checkRead({ method: "GET", path: "/transfers", query: { status: { $ne: 1 } } })).toThrow("the value of status is not plain");
    expect(checkRead({ method: "GET", path: "/transfers", query: { page_size: 10 } }).req).toEqual({ method: "GET", path: "/transfers", query: { page_size: "10" } });
  });

  it("in a plan, a call that throws something other than a refusal while being read is 'not a call', and nothing is sent", async () => {
    const p = port({});
    const sneaky = { method: "GET", get path(): string { throw new Error("boom"); } };
    await expect(runPlan(p, { calls: [sneaky] } as unknown as Plan)).rejects.toThrow("refused: call 1: not a call");
    await expect(runPlan(p, { calls: [null] } as unknown as Plan)).rejects.toThrow("refused: call 1: not a call");
    await expect(runPlan(p, { calls: Array.from({ length: 11 }, () => ({ method: "GET", path: "/transfers" })) })).rejects.toThrow(AwxReadRefused);
    await expect(runPlan(p, null as unknown as Plan)).rejects.toThrow(/a plan needs calls/);
    expect(p.sent).toEqual([]);
  });
});

describe("a plan's results", () => {
  it("a refusal (redacted), an unreachable gateway and an object answer, each under its own name", async () => {
    const p = port({
      "/balances/current": ok({ currency: "EUR", available_amount: 12, nested: { deep: 1 } }),
      "/global_accounts": { ok: false, status: 403, code: "forbidden", trace_id: "t-1", refused: `token ${TOKEN} has no scope` },
      "/fx/rates/current": { ok: false, status: 429, code: "too_many", trace_id: null },
      "/beneficiaries": async () => { throw new Error("binding failed"); },
    });
    const { results } = await runPlan(p, { calls: [
      { as: "bal", method: "GET", path: "/balances/current", select: ["currency", "nested.deep", "missing.field", "__proto__.polluted", "constructor"] },
      { method: "GET", path: "/balances/current" },
      { as: "not a name!", method: "GET", path: "/global_accounts" },
      { method: "GET", path: "/fx/rates/current" },
      { method: "GET", path: "/beneficiaries" },
    ] });
    expect(results[0]).toEqual({ as: "bal", operationId: "getCurrentBalances", ok: true, data: { currency: "EUR", "nested.deep": 1, "missing.field": null } });
    expect(results[1]).toMatchObject({ as: "getCurrentBalances_2", ok: true, data: { currency: "EUR", available_amount: 12 } });
    expect(results[2]).toEqual({ as: "listGlobalAccounts_3", operationId: "listGlobalAccounts", ok: false, status: 403, code: "forbidden", trace_id: "t-1", refused: "token [redacted] has no scope" });
    expect(results[3]).toEqual({ as: "getCurrentFxRate_4", operationId: "getCurrentFxRate", ok: false, status: 429, code: "too_many", trace_id: null });
    expect(results[4]).toMatchObject({ ok: false, status: 502, code: "gateway_unreachable", trace_id: null });
  });

  it("sums skip what is not a number and group what has no value under (none); a sum alone lists no items; a limit truncates", async () => {
    const p = port({ "/transfers": TRANSFERS });
    const [grouped] = (await runPlan(p, { calls: [{ method: "GET", path: "/transfers", aggregate: { sum: "amount", group_by: "currency" } }] })).results;
    expect(grouped).toEqual({ as: "listTransfers", operationId: "listTransfers", ok: true, count: 4, has_more: true, sum: { field: "amount", group_by: "currency", totals: [{ group: "EUR", total: 150.25 }, { group: "(none)", total: 7 }] } });
    const [all] = (await runPlan(p, { calls: [{ method: "GET", path: "/transfers", where: [{ field: "status", equals: "PAID" }], aggregate: { sum: "amount" }, limit: 1 }] })).results;
    expect(all).toMatchObject({ count: 3, sum: { field: "amount", totals: [{ group: "all", total: 157.25 }] }, items: [{ id: T1 }], truncated: true });
    expect(all).not.toHaveProperty("sum.group_by");
    const [counted] = (await runPlan(p, { calls: [{ method: "GET", path: "/transfers", aggregate: {} }] })).results;
    expect(counted).toEqual({ as: "listTransfers", operationId: "listTransfers", ok: true, count: 4, has_more: true });
    const [picked] = (await runPlan(p, { calls: [{ method: "GET", path: "/transfers", select: ["id", "beneficiary.name", "constructor.name"], limit: MAX_ITEMS + 50 }] })).results;
    expect((picked as { items: unknown[] }).items).toEqual([{ id: T1, "beneficiary.name": "Bergtex" }, { id: "b", "beneficiary.name": null }, { id: "c", "beneficiary.name": null }, { id: "d", "beneficiary.name": null }]);
    expect(picked).not.toHaveProperty("truncated");
    // A bare list (not { items }) is a list too, without has_more.
    const bare = port({ "/transfers": ok([{ id: "x" }]) });
    expect((await runPlan(bare, { calls: [{ method: "GET", path: "/transfers" }] })).results[0]).toEqual({ as: "listTransfers", operationId: "listTransfers", ok: true, count: 1, items: [{ id: "x" }] });
  });
});
