// /mcp/airwallex (docs/codemode.md): the Airwallex sandbox, read only, as a Code Mode MCP server with two tools. It holds:
// tools/list has exactly search and execute; search answers fragments of the committed spec; execute reads a stubbed
// sandbox (no network) through the real gateway desk; anything but an allow-listed GET (a POST, another path, "..", an
// absolute URL, another origin or base) is refused before any call; the spec lists exactly the allow-list; the route
// takes the /mcp connector tokens only (not the demo's public token, not a session, not anonymous); and no credential
// (key, client id, bearer token) appears in any tool output or error.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";
import { AWX_CODEMODE_READS, AWX_READ_SPEC, AwxReadRefused, checkRead, runPlan } from "../cloud/src/claude/awxCodemode.js";
import { AWX_CODEMODE_TOOLS } from "../cloud/src/claude/awxCodemodeMcp.js";
import { AWX_GATEWAY_ALLOW, gatewayCheck } from "../src/airwallex/gatewayRules.js";
import { AwxGatewayDesk } from "../worker/src/awxGateway.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

// Stand-in credentials: made-up strings, never a real key. The test proves none of them leaves the gateway.
const CLIENT_ID = "stub-client-id-0000";
const API_KEY = "stub-api-key-not-a-real-key-0000";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdHViIn0.c3R1Yi1zaWduYXR1cmU";
const T1 = "738a4263-6d6c-4de8-94a3-93da1c175fb4";

/** A stubbed Airwallex sandbox: answers the login and a few reads, records every request. No network. */
function stubSandbox() {
  const sent: { method: string; url: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    const h = new Headers(init?.headers);
    sent.push({ method, url, auth: h.get("authorization") });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-b3-traceid": "trace123" } });
    const u = new URL(url);
    if (u.pathname === "/api/v1/authentication/login") return json(201, { token: TOKEN, expires_at: "2026-11-20T13:00:00Z" });
    if (h.get("authorization") !== `Bearer ${TOKEN}`) return json(401, { code: "unauthorized" });
    if (u.pathname === "/api/v1/balances/current") return json(200, [{ currency: "EUR", available_amount: 1200.5, total_amount: 1300 }, { currency: "USD", available_amount: 80, total_amount: 80 }]);
    if (u.pathname === "/api/v1/transfers") return json(200, { has_more: false, items: [
      { id: T1, status: "PAID", transfer_amount: 100.25, transfer_currency: "EUR", beneficiary: { bank_details: { account_name: "Bergtex" } } },
      { id: "4140dee2-6373-4eb4-a71f-bf69130f96a7", status: "PAID", transfer_amount: 50, transfer_currency: "EUR", beneficiary: { bank_details: { account_name: "Lumen" } } },
      { id: "11111111-2222-4333-8444-555555555555", status: "FAILED", transfer_amount: 9, transfer_currency: "GBP", beneficiary: { bank_details: { account_name: "X" } } },
    ] });
    if (u.pathname === `/api/v1/transfers/${T1}`) return json(200, { id: T1, status: "PAID", metadata: { approval_sha256: "a".repeat(64) } });
    if (u.pathname === "/api/v1/fx/rates/current") return json(200, { currency_pair: "EURUSD", rate: 1.0877, buy_currency: u.searchParams.get("buy_currency"), sell_currency: u.searchParams.get("sell_currency") });
    if (u.pathname === "/api/v1/issuing/cards") return json(403, { code: "forbidden", message: `no scope for client ${CLIENT_ID} token ${TOKEN}` });
    return json(404, { code: "not_found" });
  }) as typeof fetch;
  const desk = new AwxGatewayDesk({ AWX_ACT_CLIENT_ID: CLIENT_ID, AWX_ACT_API_KEY: API_KEY }, { fetchImpl });
  return { desk, sent };
}

const SECRETS = [CLIENT_ID, API_KEY, TOKEN, "Bearer "];
const noSecret = (s: string) => { for (const x of SECRETS) expect(s).not.toContain(x); };

let c: TestCloud;
let A: TestTenant;
let reader: string;
let sb: ReturnType<typeof stubSandbox>;

const rpc = async (token: string | null, method: string, params: Record<string, unknown> = {}) => {
  const r = await c.req("POST", "/mcp/airwallex", { key: token, body: { jsonrpc: "2.0", id: 7, method, params }, headers: { accept: "application/json, text/event-stream", origin: "null-omit" } });
  noSecret(await r.res.clone().text());
  return r;
};
const call = async (name: string, args: unknown) => {
  const r = await rpc(reader, "tools/call", { name, arguments: args });
  expect(r.status).toBe(200);
  const result = (r.json as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { isError: !!result.isError, data: JSON.parse(result.content[0]!.text) as Record<string, unknown> };
};

beforeAll(async () => {
  c = testCloud();
  A = await c.tenant("northwind");
  reader = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "Claude (Airwallex)" } })).json.token as string;
  sb = stubSandbox();
  c.env.awxGateway = sb.desk;
});
afterAll(() => c.close());

describe("the spec and the allow-list", () => {
  it("the committed spec lists exactly the allow-list: paths, GET only, query keys", () => {
    const params = (AWX_READ_SPEC.components as { parameters: Record<string, { name: string; in: string }> }).parameters;
    const paths = AWX_READ_SPEC.paths as Record<string, Record<string, { operationId: string; parameters?: ({ $ref?: string; name?: string; in?: string })[] }>>;
    const fromSpec = Object.entries(paths).map(([path, ops]) => {
      expect(Object.keys(ops)).toEqual(["get"]);
      const q = (ops.get!.parameters ?? []).map((p) => (p.$ref ? params[p.$ref.split("/").pop()!]! : p)).filter((p) => p.in === "query").map((p) => p.name!).sort();
      return { operationId: ops.get!.operationId, path, query: q };
    });
    expect(fromSpec).toEqual(AWX_CODEMODE_READS.map((o) => ({ operationId: o.operationId, path: o.path, query: [...o.query].sort() })));
    expect(AWX_READ_SPEC.servers).toEqual([expect.objectContaining({ url: "https://api.sandbox.airwallex.com/api/v1" })]);
  });

  it("every allowed read is a read on kit11's gateway list too (the second lock), and no card /details", () => {
    for (const o of AWX_CODEMODE_READS) {
      const path = o.path.replace("{id}", T1);
      const g = gatewayCheck({ method: "GET", path });
      expect("rule" in g && g.rule.kind, path).toBe("read");
      expect(path).not.toMatch(/details|create|update|submit|delete|simulation|login/);
    }
    expect(AWX_GATEWAY_ALLOW.filter((r) => r.kind === "money").length).toBe(3);
  });
});

describe("the host's request check refuses, before any call", () => {
  const refused = (r: { method: string; path: string; query?: Record<string, unknown> }, base?: string) => expect(() => checkRead(r, base)).toThrow(AwxReadRefused);
  it("anything but GET", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "get", "HEAD"]) refused({ method, path: "/balances/current" });
  });
  it("paths off the list, traversal, absolute URLs, other origins, other bases, query strings, odd query keys", () => {
    for (const path of ["/transfers/create", "/authentication/login", "/issuing/cards/" + T1 + "/details", "/balances/current/../../transfers/create",
      "/balances/%2e%2e/transfers/create", "https://api.airwallex.com/api/v1/balances/current", "//evil.example/api/v1/balances/current",
      "http://api.sandbox.airwallex.com/api/v1/balances/current", "/balances/current?x=1", "/balances/current#x", "/transfers/not-a-uuid",
      "\\balances\\current", "@evil.example/balances/current", "", "/batch_transfers", "/simulation/deposit/create", "/balances/current/"]) refused({ method: "GET", path });
    refused({ method: "GET", path: "/balances/current" }, "https://api.airwallex.com/api/v1");
    refused({ method: "GET", path: "/balances/current" }, "https://evil.example/api/v1");
    refused({ method: "GET", path: "/transfers", query: { amount: "1" } });
    refused({ method: "GET", path: "/transfers", query: { status: "PAID&x=1" } });
    expect(checkRead({ method: "GET", path: `/transfers/${T1}` }).req).toEqual({ method: "GET", path: `/transfers/${T1}` });
  });
  it("a plan with one refused call makes no call at all", async () => {
    const sent: unknown[] = [];
    await expect(runPlan({ call: async (r) => { sent.push(r); return { ok: true, status: 200, json: {} }; } }, { calls: [{ method: "GET", path: "/balances/current" }, { method: "POST", path: "/transfers/create" }] })).rejects.toBeInstanceOf(AwxReadRefused);
    expect(sent).toEqual([]);
  });
});

describe("/mcp/airwallex", () => {
  it("needs a connector token: not anonymous, not the demo's public token, not a session or an API key", async () => {
    const anon = await rpc(null, "tools/list");
    expect(anon.status).toBe(401);
    expect(anon.res.headers.get("www-authenticate")).toMatch(/^Bearer resource_metadata=/);
    expect((await rpc(DEMO_CONNECTOR_TOKEN, "tools/list")).status).toBe(403);
    expect((await rpc(A.session, "tools/list")).status).toBe(403);
    expect((await rpc(A.key, "tools/list")).status).toBe(403);
    expect((await rpc("pck_bogus_token", "tools/list")).status).toBe(401);
  });

  it("initializes and lists exactly two tools, search and execute", async () => {
    const init = await rpc(reader, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect((init.json as { result: { protocolVersion: string; serverInfo: { name: string } } }).result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "purser-airwallex-read" } });
    const tools = (await rpc(reader, "tools/list")).json as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(tools.result.tools.map((t) => t.name)).toEqual(["search", "execute"]);
    expect(tools.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(AWX_CODEMODE_TOOLS).toHaveLength(2);
    const unknown = await rpc(reader, "tools/call", { name: "create_transfer", arguments: {} });
    expect((unknown.json as unknown as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("search answers fragments of the spec, not the whole document", async () => {
    const r = await call("search", { query: "transfer status" });
    expect(r.isError).toBe(false);
    const m = r.data.matches as { path: string; method: string; parameters: { name: string }[] }[];
    expect(m.length).toBeGreaterThan(0);
    expect(m.length).toBeLessThan(Object.keys(AWX_READ_SPEC.paths).length);
    expect(m[0]!.path).toMatch(/^\/transfers/);
    expect(m.every((x) => x.method === "GET")).toBe(true);
    const all = await call("search", {});
    expect((all.data.operations as unknown[]).length).toBe(AWX_CODEMODE_READS.length);
  });

  it("execute reads the stubbed sandbox through the gateway: selected fields, filters, sums; sandbox host only", async () => {
    sb.sent.length = 0;
    const r = await call("execute", { calls: [
      { as: "bal", method: "GET", path: "/balances/current", select: ["currency", "available_amount"] },
      { as: "paid", method: "GET", path: "/transfers", query: { page_size: 100 }, where: [{ field: "status", equals: "PAID" }], aggregate: { sum: "transfer_amount", group_by: "transfer_currency" } },
      { method: "GET", path: `/transfers/${T1}`, select: ["status", "metadata.approval_sha256"] },
      { method: "GET", path: "/fx/rates/current", query: { buy_currency: "USD", sell_currency: "EUR" }, select: ["currency_pair", "rate"] },
    ] });
    expect(r.isError).toBe(false);
    const res = r.data.results as Record<string, unknown>[];
    expect(res[0]).toMatchObject({ as: "bal", ok: true, count: 2, items: [{ currency: "EUR", available_amount: 1200.5 }, { currency: "USD", available_amount: 80 }] });
    expect(res[1]).toMatchObject({ as: "paid", count: 2, sum: { field: "transfer_amount", group_by: "transfer_currency", totals: { EUR: 150.25 } } });
    expect(res[1]!.items).toBeUndefined();
    expect(res[2]).toMatchObject({ ok: true, data: { status: "PAID", "metadata.approval_sha256": "a".repeat(64) } });
    expect(res[3]).toMatchObject({ data: { currency_pair: "EURUSD", rate: 1.0877 } });
    // One login, then four GETs, all to the sandbox host.
    expect(sb.sent.map((s) => s.method)).toEqual(["POST", "GET", "GET", "GET", "GET"]);
    expect(sb.sent.every((s) => s.url.startsWith("https://api.sandbox.airwallex.com/api/v1/"))).toBe(true);
    expect(sb.sent[2]!.url).toBe("https://api.sandbox.airwallex.com/api/v1/transfers?page_size=100");
  });

  it("execute refuses writes, other paths, traversal and other origins, and then calls nothing", async () => {
    sb.sent.length = 0;
    for (const bad of [
      { method: "POST", path: "/transfers/create" },
      { method: "PUT", path: "/beneficiaries" },
      { method: "DELETE", path: `/transfers/${T1}` },
      { method: "GET", path: "/fx/conversions/create" },
      { method: "GET", path: "/balances/current/../../transfers/create" },
      { method: "GET", path: "https://api.airwallex.com/api/v1/balances/current" },
      { method: "GET", path: "//evil.example/x" },
      { method: "GET", path: `/issuing/cards/${T1}/details` },
    ]) {
      const r = await call("execute", { calls: [{ method: "GET", path: "/balances/current" }, bad] });
      expect(r.isError, JSON.stringify(bad)).toBe(true);
      expect(r.data).toMatchObject({ error: "refused", calls_made: 0 });
    }
    expect(sb.sent).toEqual([]);
    expect((await call("execute", { calls: Array.from({ length: 11 }, () => ({ method: "GET", path: "/balances/current" })) })).isError).toBe(true);
    expect((await call("execute", {})).isError).toBe(true);
  });

  it("an Airwallex error comes back as its code and trace id, never its words, a key or the token", async () => {
    const r = await call("execute", { calls: [{ method: "GET", path: "/issuing/cards" }] });
    const res = (r.data.results as Record<string, unknown>[])[0]!;
    expect(res).toMatchObject({ ok: false, status: 403, code: "forbidden", trace_id: "trace123" });
    noSecret(JSON.stringify(r.data));
  });

  it("without the gateway binding, execute refuses and search still answers", async () => {
    const keep = c.env.awxGateway;
    delete c.env.awxGateway;
    try {
      const r = await call("execute", { calls: [{ method: "GET", path: "/balances/current" }] });
      expect(r).toMatchObject({ isError: true, data: { error: "refused" } });
      expect((await call("search", { query: "balances" })).isError).toBe(false);
    } finally { c.env.awxGateway = keep; }
  });
});
