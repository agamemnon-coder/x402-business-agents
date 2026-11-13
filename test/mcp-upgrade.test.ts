// Connect any AI, upgraded (13 Nov): the MCP server checked against the current spec (2026-07-28) and its legacy
// revisions, and the new read tools. It holds: a request with per-request _meta is served statelessly (server/discover,
// headers mirrored and checked against the body, resultType and serverInfo on every result, ttlMs/cacheScope on lists),
// initialize still serves older clients; every tool has a title, icons, annotations and an outputSchema its results
// conform to; results link the resources they name; the books, invoices, payments and the policy are resources;
// lists page with cursors; errors say what to do; and still nothing approves, pays, changes a limit or writes.
/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC answers are read loosely here; each test checks their shape */
import { createHash, randomBytes } from "node:crypto";
import { Ajv } from "ajv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";
import { clientTabs } from "../cloud/src/claude/connectPage.js";
import { MODERN_VERSIONS, PAGE_SIZE, PROTOCOL_VERSIONS } from "../cloud/src/claude/mcp.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud;
let A: TestTenant;
let reader: string;
const V = "2026-07-28";
type Res = { status: number; json: Record<string, any>; res: Response };

/** A current-revision request: version, client and capabilities in _meta, mirrored into the headers. */
const modern = async (method: string, params: Record<string, unknown> = {}, o: { token?: string; headers?: Record<string, string>; meta?: Record<string, unknown> | null; id?: number | null } = {}): Promise<Res> => {
  const name = method === "resources/read" ? params.uri : params.name;
  const meta = o.meta === null ? undefined : { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {}, ...(o.meta ?? {}) };
  const body = { jsonrpc: "2.0", ...(o.id === null ? {} : { id: o.id ?? 7 }), method, params: { ...params, ...(meta ? { _meta: meta } : {}) } };
  const headers = { accept: "application/json, text/event-stream", origin: "null-omit", "mcp-protocol-version": V, "mcp-method": method, ...(typeof name === "string" ? { "mcp-name": name } : {}), ...(o.headers ?? {}) };
  for (const [k, v] of Object.entries(headers)) if (v === "") delete (headers as Record<string, string>)[k];
  return c.req("POST", "/mcp", { key: o.token ?? DEMO_CONNECTOR_TOKEN, body, headers }) as Promise<Res>;
};
/** A legacy request (after initialize), with the version the client negotiated in its header. */
const legacy = async (method: string, params: Record<string, unknown> = {}, version = "2025-11-25", token = DEMO_CONNECTOR_TOKEN): Promise<Res> =>
  c.req("POST", "/mcp", { key: token, body: { jsonrpc: "2.0", id: 1, method, params }, headers: { origin: "null-omit", "mcp-protocol-version": version } }) as Promise<Res>;
const tool = async (name: string, args: Record<string, unknown> = {}, token = DEMO_CONNECTOR_TOKEN) => (await modern("tools/call", { name, arguments: args }, { token })).json.result as { content: { type: string; text?: string; uri?: string }[]; structuredContent: Record<string, any>; isError?: boolean };
const text = (r: { content: { type: string; text?: string }[] }) => r.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");

beforeAll(async () => {
  c = testCloud({ engine: true });
  A = await c.tenant("northwind");
  reader = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "Claude (reads)" } })).json.token as string;
});
afterAll(() => c.close());

describe("protocol 2026-07-28 (stateless, per-request _meta)", () => {
  it("answers server/discover with its versions, capabilities, identity and caching hints", async () => {
    const r = await modern("server/discover");
    expect(r.status).toBe(200);
    const res = r.json.result;
    expect(res).toMatchObject({ resultType: "complete", supportedVersions: [...PROTOCOL_VERSIONS], capabilities: { tools: {}, prompts: {}, resources: {} }, cacheScope: "private" });
    expect(res.ttlMs).toBeGreaterThan(0);
    expect(res.supportedVersions[0]).toBe(MODERN_VERSIONS[0]);
    expect(res._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "purser", title: "Purser", icons: [{ src: `${ORIGIN}/icon.png` }, { src: `${ORIGIN}/favicon.svg` }] });
    expect(res.instructions).toMatch(/cannot approve, pay.*Face ID/);
  });

  it("checks the mirrored headers against the body, and says what is wrong", async () => {
    const missing = await modern("tools/list", {}, { headers: { "mcp-protocol-version": "" } });
    expect([missing.status, missing.json.error.code]).toEqual([400, -32020]);
    expect(missing.json.error.message).toMatch(/MCP-Protocol-Version header is required/);
    const crossed = await modern("tools/list", {}, { headers: { "mcp-protocol-version": "2025-11-25" } });
    expect([crossed.status, crossed.json.error.code]).toEqual([400, -32020]);
    const noMeta = await modern("tools/list", {}, { meta: null });
    expect([noMeta.status, noMeta.json.error.code]).toEqual([400, -32020]);
    const noMethod = await modern("tools/list", {}, { headers: { "mcp-method": "" } });
    expect([noMethod.status, noMethod.json.error.message]).toEqual([400, expect.stringMatching(/Mcp-Method header is required/)]);
    const otherMethod = await modern("tools/list", {}, { headers: { "mcp-method": "prompts/list" } });
    expect(otherMethod.json.error.code).toBe(-32020);
    const otherName = await modern("tools/call", { name: "cfo_policy", arguments: {} }, { headers: { "mcp-name": "company_overview" } });
    expect([otherName.status, otherName.json.error.message]).toEqual([400, expect.stringMatching(/Mcp-Name header value 'company_overview' does not match body value 'cfo_policy'/)]);
    // The Base64 sentinel form of Mcp-Name is decoded before it is compared.
    const b64 = await modern("tools/call", { name: "cfo_policy", arguments: {} }, { headers: { "mcp-name": `=?base64?${btoa("cfo_policy")}?=` } });
    expect(b64.status).toBe(200);
  });

  it("refuses an unknown version with the versions it speaks, an unknown method with 404, and takes a notification with 202", async () => {
    const v = await modern("tools/list", {}, { meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" }, headers: { "mcp-protocol-version": "2099-01-01" } });
    expect(v.status).toBe(400);
    expect(v.json.error).toMatchObject({ code: -32022, data: { supported: [...PROTOCOL_VERSIONS], requested: "2099-01-01" } });
    const m = await modern("no/such");
    expect([m.status, m.json.error.code]).toEqual([404, -32601]);
    expect((await modern("notifications/whatever", {}, { id: null })).status).toBe(202);
    // A batch is not part of the current revision.
    const batch = await c.req("POST", "/mcp", { key: DEMO_CONNECTOR_TOKEN, body: [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": V } } }], headers: { origin: "null-omit" } });
    expect(batch.status).toBe(400);
    // GET and DELETE on the endpoint: 405.
    expect((await c.req("GET", "/mcp", { key: DEMO_CONNECTOR_TOKEN })).status).toBe(405);
    expect((await c.req("DELETE", "/mcp", { key: DEMO_CONNECTOR_TOKEN })).status).toBe(405);
  });

  it("keeps the Origin check: a page on another site cannot call it, Claude's own web origins can", async () => {
    expect((await modern("tools/list", {}, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await modern("tools/list", {}, { headers: { origin: "https://claude.ai" } })).status).toBe(200);
  });

  it("still serves legacy clients by initialize, and a batch under 2025-03-26", async () => {
    for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      const r = await c.req("POST", "/mcp", { key: DEMO_CONNECTOR_TOKEN, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } } }, headers: { origin: "null-omit" } });
      expect(r.json.result).toMatchObject({ protocolVersion: v, capabilities: { resources: {} }, serverInfo: { name: "purser", version: expect.any(String) } });
      expect((r.json.result as Record<string, unknown>).resultType).toBeUndefined();
    }
    const b = await c.req("POST", "/mcp", { key: DEMO_CONNECTOR_TOKEN, body: [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }], headers: { origin: "null-omit" } });
    expect((b.json as unknown as unknown[]).length).toBe(2);
    // A legacy client's resource-not-found code is -32002; the current one's is -32602.
    expect((await legacy("resources/read", { uri: "purser://invoices/AP-9999" })).json.error.code).toBe(-32002);
    expect((await modern("resources/read", { uri: "purser://invoices/AP-9999" })).json.error.code).toBe(-32602);
  });
});

describe("tools: titles, icons, annotations, output schemas", () => {
  it("every tool has a title, Purser's icons, read-only annotations and an output schema, in a fixed order", async () => {
    const r = await modern("tools/list");
    expect(r.json.result).toMatchObject({ resultType: "complete", cacheScope: "private" });
    const tools = r.json.result.tools as { name: string; title: string; icons: unknown[]; outputSchema: { type: string }; annotations: Record<string, unknown> }[];
    expect(tools.length).toBe(14);
    for (const t of tools) {
      expect({ name: t.name, title: !!t.title, icons: t.icons.length, out: t.outputSchema.type, ann: t.annotations }).toEqual({ name: t.name, title: true, icons: 2, out: "object", ann: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } });
    }
    expect((await modern("tools/list")).json.result.tools.map((t: { name: string }) => t.name)).toEqual(tools.map((t) => t.name));
    // The hard rule: no tool approves, pays, changes a limit or writes, for any token.
    const proposer = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "p", propose: true } })).json.token as string;
    for (const tok of [DEMO_CONNECTOR_TOKEN, reader, proposer]) {
      const names = ((await modern("tools/list", {}, { token: tok })).json.result.tools as { name: string }[]).map((t) => t.name);
      expect(names.filter((n) => /approve|^pay_|execute|limit|sign|write|update|delete|create/.test(n))).toEqual([]);
    }
  });

  it("gives structured results that conform to each tool's output schema, and links the resources they name", async () => {
    const tools = (await modern("tools/list")).json.result.tools as { name: string; outputSchema: object }[];
    const ajv = new Ajv({ strict: false, allErrors: true });
    const args: Record<string, Record<string, unknown>> = { get_invoice: { id: "AP-0005" }, books_report: { report: "balance" }, payment_audit_trail: { id: "AP-0004" }, explain_payment: { id: "P-0008" }, spend_breakdown: { by: "supplier" } };
    for (const t of tools) {
      const r = await tool(t.name, args[t.name] ?? {});
      expect({ t: t.name, err: r.isError ?? false }).toEqual({ t: t.name, err: false });
      const ok = ajv.validate(t.outputSchema, r.structuredContent);
      expect({ t: t.name, errors: ok ? null : ajv.errorsText() }).toEqual({ t: t.name, errors: null });
    }
    const inv = await tool("get_invoice", { id: "AP-0005" });
    expect(inv.content.find((x) => x.type === "resource_link")).toMatchObject({ uri: "purser://invoices/AP-0005", mimeType: "application/json" });
    // A 2025-03-26 client does not know resource_link: it gets text and data only.
    const old = (await legacy("tools/call", { name: "get_invoice", arguments: { id: "AP-0005" } }, "2025-03-26")).json.result as { content: { type: string }[]; structuredContent: unknown };
    expect(old.content.map((x) => x.type)).toEqual(["text"]);
    expect(old.structuredContent).toBeTruthy();
  });

  it("says what to do when a call goes wrong", async () => {
    const bad = await tool("vat_summary", { quarter: "Q4" });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/^The arguments do not fit vat_summary: quarter: a quarter like 2026Q4\. Fix them and call again\./);
    const extra = await tool("cfo_policy", { approve: true });
    expect(extra.isError).toBe(true);
    const none = await modern("tools/call", { name: "approve_payment", arguments: {} });
    expect(none.json.error).toMatchObject({ code: -32602, message: expect.stringMatching(/no tool approve_payment; tools\/list shows/) });
    const proposeAsReader = await modern("tools/call", { name: "propose_invoice_payment", arguments: { invoice_id: "AP-0001" } }, { token: reader });
    expect(proposeAsReader.json.error.message).toMatch(/this token reads only/);
    expect((await tool("explain_payment", { id: "P-9999" })).isError).toBe(true);
    expect(text(await tool("explain_payment", { id: "P-9999" }))).toMatch(/list_transactions shows the payment ids/);
  });
});

describe("the new read tools, on the demo company", () => {
  it("cash_position: net cash from what moved, and a projection from due days that says what it is", async () => {
    const r = await tool("cash_position");
    const s = r.structuredContent;
    expect(s).toMatchObject({ currency: "EUR", as_of: "2026-11-12", net_cash: "9227.32" });
    expect(s.projection).toHaveLength(4);
    // The open payable (Bergtex, due 23 Nov) leaves in the second week.
    expect(s.projection[1]).toMatchObject({ due_out: s.open.payables, projected_net_cash: (9227.32 - Number(s.open.payables)).toFixed(2) });
    expect(text(r)).toMatch(/^Northwind Outdoor \(demo company\): net cash EUR 9,227\.32 as of 12 Nov 2026/);
    expect(text(r)).toMatch(/not a bank balance/);
    expect((await tool("cash_position", { weeks: 13 })).structuredContent.projection).toHaveLength(13);
  });

  it("pending_approvals: what waits for the CFO, each with where to approve it, and no way to approve here", async () => {
    const r = await tool("pending_approvals");
    expect(r.structuredContent.invoices).toEqual([expect.objectContaining({ id: "AP-0005", approve_in: `${ORIGIN}/#/invoices` })]);
    expect(r.structuredContent.how_to_approve).toMatch(/Only the CFO approves.*Face ID.*No AI client/);
    expect(text(r)).toMatch(/demo data\)\. Approve each in Purser Cloud; no AI can approve\./);
    // It agrees with the overview's count of invoices waiting for the CFO.
    expect(r.structuredContent.invoices.length).toBe((await tool("company_overview")).structuredContent.invoices.waiting_cfo.count);
  });

  it("cfo_policy: the rules in plain words, the version in force, each agent's card limits", async () => {
    const r = await tool("cfo_policy");
    const s = r.structuredContent;
    expect(s.rules.join(" ")).toMatch(/exact terms.*Face ID/);
    expect(s.policy_version).toMatchObject({ version: 3 });
    expect(s.agent_cards).toEqual(expect.arrayContaining([expect.objectContaining({ agent: "sourcing", per_purchase: "30.00", per_month: "100.00" })]));
    expect(s.decisions.approved).toBeGreaterThan(0);
    expect(text(r)).toMatch(/Sourcing agent: EUR 30\.00 a purchase, EUR 100\.00 a month/);
  });

  it("spend_breakdown: by agent and by supplier, the same total either way, within days when asked", async () => {
    const byAgent = (await tool("spend_breakdown")).structuredContent, bySupplier = (await tool("spend_breakdown", { by: "supplier" })).structuredContent;
    expect(byAgent.totals).toEqual(bySupplier.totals);
    expect(byAgent.items[0]).toMatchObject({ key: "invoices", label: "Supplier invoices, CFO-approved" });
    expect(byAgent.items.find((i: { key: string }) => i.key === "sourcing")).toMatchObject({ declined: 1 });
    expect(bySupplier.items[0]).toMatchObject({ label: "Bergtex Textil GmbH" });
    const nov = (await tool("spend_breakdown", { from: "2026-11-01", to: "2026-11-12" })).structuredContent;
    expect(Number(nov.totals.EUR)).toBeLessThan(Number(byAgent.totals.EUR));
    expect((await tool("spend_breakdown", { from: "12-11-2026" })).isError).toBe(true);
  });

  it("vat_summary: the current quarter by default, as the return's rubrics, an overview not a filing", async () => {
    const r = await tool("vat_summary");
    expect(r.structuredContent).toMatchObject({ quarter: "2026Q4" });
    expect(text(r)).toMatch(/VAT overview 2026Q4.*not a filing/);
    expect(r.content.find((x) => x.type === "resource_link")!.uri).toBe("purser://books/vat/2026Q4");
    expect((await tool("vat_summary", { quarter: "2026Q3" })).structuredContent.quarter).toBe("2026Q3");
  });

  it("payment_audit_trail: every step of a payment, found by its id, its invoice or its proposal", async () => {
    const byInvoice = (await tool("payment_audit_trail", { id: "AP-0004" })).structuredContent;
    const byProposal = (await tool("payment_audit_trail", { id: "P-0008" })).structuredContent;
    const byId = (await tool("payment_audit_trail", { id: byInvoice.payment.id })).structuredContent;
    expect(byProposal).toEqual(byInvoice);
    expect(byId).toEqual(byInvoice);
    const events = byInvoice.steps.map((s: { event: string }) => s.event);
    expect(events).toEqual(expect.arrayContaining(["ap.received", "proposal.created", "proposal.approved", "transfer.status", "proposal.executed"]));
    expect(events.indexOf("proposal.approved")).toBeLessThan(events.indexOf("proposal.executed"));
    expect(byInvoice.steps.find((s: { event: string }) => s.event === "proposal.approved")).toMatchObject({ who: "The CFO" });
    expect(byInvoice.books).toEqual([expect.objectContaining({ entry_id: 25, entry_hash: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(byInvoice.steps.map((s: { seq: number }) => s.seq)).toEqual([...byInvoice.steps.map((s: { seq: number }) => s.seq)].sort((a: number, b: number) => a - b));
  });

  it("explain_payment: who, how much, why, who allowed it and how, where it is booked", async () => {
    const r = await tool("explain_payment", { id: "AP-0004" });
    expect(text(r)).toMatch(/^The company paid Lagerhaus Nord GmbH EUR 618\.80 on 7 Nov 2026 for invoice LN-2026-0815 \(AP-0004\)/);
    expect(text(r)).toMatch(/The CFO approved P-0008 on 7 Nov 2026 by signing its exact terms with Face ID/);
    expect(text(r)).toMatch(/Booked in ledger entry 25/);
    expect(text(r)).toMatch(/Demo data, no real money/);
    const card = (await tool("list_transactions", { limit: 30 })).structuredContent.items.find((t: { id: string }) => t.id.startsWith("card:"));
    const e = await tool("explain_payment", { id: card.id });
    expect(e.structuredContent.explanation.allowed_by).toMatch(/^No CFO approval was needed/);
    const incoming = (await tool("explain_payment", { id: "receipt:dep_demo_7" }));
    expect(text(incoming)).toMatch(/^Summit Outfitters paid the company EUR 1,987\.50/);
  });

  it("each answers in plain words first, short enough for a phone", async () => {
    for (const [name, args] of [["cash_position", {}], ["pending_approvals", {}], ["cfo_policy", {}], ["spend_breakdown", {}], ["vat_summary", {}], ["payment_audit_trail", { id: "AP-0004" }], ["explain_payment", { id: "AP-0004" }]] as const) {
      const t = text(await tool(name, args));
      expect({ name, first: /^[A-Z0-9]/.test(t), short: t.length < 2000, raw: /[{}"]|_cents/.test(t) }).toEqual({ name, first: true, short: true, raw: false });
    }
  });
});

describe("resources", () => {
  it("lists the books, the approvals, the policy and each invoice; reads each; and has templates", async () => {
    const list = (await modern("resources/list")).json.result;
    expect(list).toMatchObject({ resultType: "complete", cacheScope: "private" });
    const uris = (list.resources as { uri: string }[]).map((r) => r.uri);
    expect(uris).toEqual(expect.arrayContaining(["purser://company/overview", "purser://cash", "purser://approvals/pending", "purser://policy", "purser://books/pnl", "purser://books/vat/2026Q4", "purser://invoices/AP-0005"]));
    for (const uri of uris) {
      const r = await modern("resources/read", { uri });
      expect({ uri, status: r.status, n: r.json.result?.contents?.length }).toEqual({ uri, status: 200, n: 1 });
      const ct = r.json.result.contents[0] as { uri: string; mimeType: string; text: string };
      expect(ct.uri).toBe(uri);
      if (ct.mimeType === "application/json") expect(JSON.parse(ct.text)).toMatchObject({ demo_data: true });
    }
    const policy = (await modern("resources/read", { uri: "purser://policy" })).json.result.contents[0];
    expect(policy).toMatchObject({ mimeType: "text/markdown", text: expect.stringMatching(/^# Northwind Outdoor \(demo company\): the CFO's policy/) });
    const pay = JSON.parse((await modern("resources/read", { uri: "purser://payments/P-0008" })).json.result.contents[0].text);
    expect(pay.payment).toMatchObject({ counterparty: "Lagerhaus Nord GmbH" });
    const tpl = (await modern("resources/templates/list")).json.result.resourceTemplates as { uriTemplate: string }[];
    expect(tpl.map((t) => t.uriTemplate)).toEqual(["purser://invoices/{id}", "purser://payments/{id}", "purser://books/vat/{quarter}", "purser://books/{report}"]);
    const nf = await modern("resources/read", { uri: "purser://secrets" });
    expect(nf.json.error).toMatchObject({ code: -32602, message: expect.stringMatching(/^Resource not found: .*resources\/list/), data: { uri: "purser://secrets" } });
  });

  it("reads a company's own resources only", async () => {
    const own = (await modern("resources/list", {}, { token: reader })).json.result.resources as { uri: string }[];
    expect(own.map((r) => r.uri)).toContain("purser://policy");
    expect(own.map((r) => r.uri)).not.toContain("purser://invoices/AP-0005");
    const demoInvoice = await modern("resources/read", { uri: "purser://invoices/AP-0005" }, { token: reader });
    expect(demoInvoice.json.error?.code).toBe(-32602);
  });
});

describe("pagination", () => {
  it("pages tools, prompts and resources with an opaque cursor, and refuses a cursor it did not give", async () => {
    const all = ((await modern("resources/list")).json.result.resources as { uri: string }[]).map((r) => r.uri);
    const was = { ...PAGE_SIZE };
    try {
      PAGE_SIZE.resources = 4; PAGE_SIZE.tools = 5; PAGE_SIZE.prompts = 2;
      for (const [method, key, full] of [["resources/list", "resources", all], ["tools/list", "tools", null], ["prompts/list", "prompts", null]] as const) {
        const got: string[] = [];
        let cursor: string | undefined, pages = 0;
        do {
          const r = (await modern(method, cursor ? { cursor } : {})).json.result;
          got.push(...(r[key] as { uri?: string; name: string }[]).map((x) => x.uri ?? x.name));
          cursor = r.nextCursor as string | undefined;
          pages++;
        } while (cursor && pages < 20);
        expect(pages).toBeGreaterThan(1);
        if (full) expect(got).toEqual(full);
        expect(new Set(got).size).toBe(got.length);
      }
    } finally {
      Object.assign(PAGE_SIZE, was);
    }
    for (const cursor of ["nope", btoa("o:99999"), 42]) expect((await modern("resources/list", { cursor })).json.error).toMatchObject({ code: -32602, message: expect.stringMatching(/invalid cursor/) });
  });
});

describe("OAuth: complete metadata, and Client ID Metadata Documents (ChatGPT, Claude, VS Code prefer them)", () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const CLIENT = "https://client.example/oauth/client.json", REDIRECT = "https://client.example/callback";
  const doc = (o: Record<string, unknown> = {}) => ({ client_id: CLIENT, client_name: "Example AI", redirect_uris: [REDIRECT], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none", ...o });
  let served: { status: number; body: unknown; headers?: Record<string, string> } = { status: 200, body: doc() };
  const fetched: string[] = [];
  const install = () => {
    c.env.outbound = async (url: string, init: RequestInit) => {
      fetched.push(url);
      expect(init.redirect).toBe("manual");
      return new Response(typeof served.body === "string" ? served.body : JSON.stringify(served.body), { status: served.status, headers: { "content-type": "application/json", ...(served.headers ?? {}) } });
    };
  };
  const authorize = (o: Record<string, string> = {}) => c.fetch(`${ORIGIN}/oauth/authorize?${new URLSearchParams({ response_type: "code", code_challenge_method: "S256", client_id: CLIENT, redirect_uri: REDIRECT, state: "s", code_challenge: challenge, resource: `${ORIGIN}/mcp`, ...o })}`);

  it("publishes complete protected-resource and authorization-server metadata, and a scoped challenge", async () => {
    expect((await c.req("GET", "/.well-known/oauth-protected-resource")).json).toEqual({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], bearer_methods_supported: ["header"], scopes_supported: ["purser"], resource_name: "Purser", resource_documentation: expect.stringMatching(/^https:\/\//) });
    expect((await c.req("GET", "/.well-known/oauth-protected-resource/mcp")).json.resource).toBe(`${ORIGIN}/mcp`);
    const as = (await c.req("GET", "/.well-known/oauth-authorization-server")).json;
    expect(as).toMatchObject({ issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/oauth/authorize`, token_endpoint: `${ORIGIN}/oauth/token`, registration_endpoint: `${ORIGIN}/oauth/register`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true });
    const r = await c.req("POST", "/mcp", { key: null, body: { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: { origin: "null-omit" } });
    expect(r.res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="purser"`);
  });

  it("signs in a client by its metadata document's address, with no registration, and names the host it checked", async () => {
    install();
    const page = await authorize();
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toMatch(/Example AI<\/span> asks to use your company's Purser\. Purser fetched its details from <span class="who">client\.example<\/span>/);
    expect(fetched).toEqual([CLIENT]);
    const consentTok = /name="consent" value="([^"]+)"/.exec(html)![1]!;
    const ok = await c.fetch(`${ORIGIN}/oauth/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, state: "s", code_challenge: challenge, resource: `${ORIGIN}/mcp`, consent: consentTok, act: "demo" }).toString() });
    expect(ok.status).toBe(303);
    const back = new URL(ok.headers.get("location")!);
    expect([`${back.origin}${back.pathname}`, back.searchParams.get("iss")]).toEqual([REDIRECT, ORIGIN]);
    const tok = await c.fetch(`${ORIGIN}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: verifier, client_id: CLIENT, redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp` }).toString() });
    expect(((await tok.json()) as { access_token: string }).access_token).toBe(DEMO_CONNECTOR_TOKEN);
    // The document was fetched once and kept for five minutes.
    expect(fetched).toEqual([CLIENT]);
  });

  it("refuses a document that does not name itself, a redirect, a confidential client, an address it does not list, and an address that is not a document's", async () => {
    install();
    let n = 0;
    const fresh = () => `https://client${++n}.example/meta.json`;
    for (const [body, status, why] of [
      [doc({ client_id: "https://other.example/meta.json" }), 200, /does not name its own address/],
      [doc(), 302, /answered 302 \(a redirect is not followed\)/],
      [doc({ token_endpoint_auth_method: "private_key_jwt" }), 200, /only public clients/],
      [doc({ redirect_uris: ["http://evil.example/cb"] }), 200, /redirect_uris/],
      ["not json", 200, /not JSON/],
    ] as const) {
      const id = fresh();
      served = { status, body: typeof body === "string" ? body : { ...body, client_id: body.client_id === CLIENT ? id : body.client_id } };
      const r = await authorize({ client_id: id });
      expect({ status: r.status, text: await r.text() }).toEqual({ status: 400, text: expect.stringMatching(why) });
    }
    served = { status: 200, body: { ...doc(), client_id: "https://client99.example/meta.json" } };
    const unlisted = await authorize({ client_id: "https://client99.example/meta.json", redirect_uri: "https://client99.example/elsewhere" });
    expect(unlisted.status).toBe(400);
    // Not a document's address: an IP literal, a bare host, plain http. These are treated as (unknown) registered ids.
    for (const id of ["https://203.0.113.9/meta.json", "https://client.example/", "http://client.example/meta.json"]) expect((await authorize({ client_id: id })).status).toBe(400);
    expect(fetched.some((u) => /203\.0\.113|http:\/\//.test(u))).toBe(false);
    delete c.env.outbound;
  });
});

describe("/connect-ai: a tab per client, exact configs, one-click links", () => {
  it("serves one tab per major client, every snippet and link built from this cloud's own address, with no script", async () => {
    const r = await c.fetch(`${ORIGIN}/connect-ai`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'; style-src 'nonce-[^']+'; img-src 'self'/);
    const html = await r.text();
    expect(html).not.toMatch(/<script/i);
    for (const name of ["Claude", "ChatGPT", "Cursor", "VS Code", "Gemini CLI", "Windsurf"]) expect(html).toContain(`>${name}</label>`);
    expect(html).toMatch(/No AI can approve, pay, change a limit or write to the books/);
    const tabs = clientTabs(ORIGIN);
    for (const t of tabs) for (const s of t.snippets) {
      expect(s.code).toContain(`${ORIGIN}/mcp`);
      if (s.code.startsWith("{")) expect(() => JSON.parse(s.code)).not.toThrow();
    }
    const cursor = new URL(tabs.find((t) => t.id === "cursor")!.links[0]!.href);
    expect(cursor.protocol).toBe("cursor:");
    expect(cursor.searchParams.get("name")).toBe("purser");
    expect(JSON.parse(atob(cursor.searchParams.get("config")!))).toEqual({ url: `${ORIGIN}/mcp` });
    const vs = new URL(tabs.find((t) => t.id === "vscode")!.links[0]!.href);
    expect(vs.origin).toBe("https://vscode.dev");
    const inner = vs.searchParams.get("url")!;
    expect(inner.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(inner.slice("vscode:mcp/install?".length)))).toEqual({ name: "purser", type: "http", url: `${ORIGIN}/mcp` });
    // ChatGPT signs in by OAuth only: its tab offers no fixed token.
    expect(tabs.find((t) => t.id === "chatgpt")!.snippets).toEqual([]);
    expect(tabs.find((t) => t.id === "gemini")!.snippets[1]!.code).toContain('"httpUrl"');
  });
});
