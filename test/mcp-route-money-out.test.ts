// route_money_out (26 Nov): the MCP tool an AI calls before any transfer, payout or currency conversion, for instance
// right after Airwallex's AgentOS said it does not move money (docs/agentos.md). It reads only: it finds the checked
// invoice a transfer would pay, says where that invoice stands and which tool comes next, and never files, approves or
// moves anything. A transfer with no invoice and a conversion on its own are not Purser's to file, and it says so.
// Called on the cloud's database in memory through the server's answer function (cloud/src/claude/mcp.ts mcpAnswer).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv } from "ajv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import { DEMO_TENANT, ensureDemoCompany } from "../cloud/src/guest/guest.js";
import { DEMO_END } from "../cloud/src/guest/seed.gen.js";
import { ASK_TOOLS } from "../cloud/src/ask/tools.js";
import type { Caller } from "../cloud/src/auth.js";
import { annotationsOf, MONEY_OUT_APPROVAL, mcpAnswer, type McpCtx, NEVER_SENTENCE, READ_TOOLS, toolsFor } from "../cloud/src/claude/mcp.js";
import type { EngineApi } from "../cloud/src/engine/api.js";
import { dirBlobs, sqliteSql } from "../cloud/src/node.js";
import { TenantDb } from "../cloud/src/tenant.js";

const T = "t_routemoney01";
type Json = Record<string, unknown>;
type Match = { invoice_id: string; vendor: string; currency: string; total: string; status: string; route: string; next_tool: string | null; proposal_id?: string };
type Out = { kind: string; route: string; next_tool: string | null; can_propose: boolean; matches: Match[]; approval: string; never: string };
type Result = { content: { type: string; text?: string; uri?: string }[]; structuredContent?: Out; isError?: boolean };

let sql: ReturnType<typeof sqliteSql>;

/** An engine that fails the test if it is touched: routing a payment reads the books only. */
const untouchable = new Proxy({}, { get: (_t, k) => { throw new Error(`route_money_out called the engine (${String(k)})`); } }) as unknown as EngineApi;
const caller = (purpose: string): Caller => ({ tenantId: T, kind: "key", principal: "k_test", scopes: new Set(["read"]) as Caller["scopes"], user: null, purpose });
const ctx = (o: Partial<McpCtx> & { purpose?: string } = {}): McpCtx => ({
  origin: "https://cloud.test", company: "Route BV", demo: false, engine: untouchable, now: new Date("2026-11-26T10:00:00Z"),
  db: new TenantDb(sql, T), caller: caller(o.purpose ?? "claude"), ...o,
});
const reader = () => ctx();
const proposer = (o: Partial<McpCtx> = {}) => ctx({ purpose: "claude-propose", ...o });

async function rpc(c: McpCtx, method: string, params: Json = {}): Promise<Json> {
  return (await mcpAnswer(c, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), new Headers({ "mcp-protocol-version": "2025-11-25" }))).body as Json;
}
const route = async (c: McpCtx, args: Json = {}) => (await rpc(c, "tools/call", { name: "route_money_out", arguments: args })).result as Result;
const text = (r: Result) => r.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
/** The answer's one plain sentence: the first line of its text. */
const first = (r: Result) => r.content[0]!.text!.split("\n")[0]!;

async function invoice(id: string, status: string, vendor: string, currency: string, total: string, extra: Json = {}): Promise<void> {
  const body = { vendor, invoice_no: `${id}-N`, currency, total, due_date: "2026-12-01", status, ...extra };
  await sql.run("INSERT INTO invoices (tenant_id, id, vendor, invoice_no, due_date, currency, total, status, doc_sha256, received_at, updated_at, version, body_json, body_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [T, id, vendor, `${id}-N`, "2026-12-01", currency, total, status, "0".repeat(64), "2026-11-20T00:00:00Z", "2026-11-20T00:00:00Z", 1, JSON.stringify(body), "1".repeat(64)]);
}

let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mcp-route-"));
  sql = sqliteSql(":memory:");
  await ensureSchema(sql);
  await ensureDemoCompany(sql, dirBlobs(join(dir, "blobs")), new Date(DEMO_END));
  await sql.run("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, ?, ?)", [T, "route-bv", "Route BV", "en", "2026-11-01T00:00:00Z"]);
  await invoice("AP-0001", "ready", "Bergtex GmbH", "EUR", "2380.00");
  await invoice("AP-0002", "ready", "Bergtex GmbH", "EUR", "120.00");
  await invoice("AP-0003", "waiting_cfo", "Acme Ltd", "GBP", "500.00", { proposal_id: "P-0007" });
  await invoice("AP-0004", "needs_vendor", "Zeeland Visserij", "EUR", "300.00");
  await invoice("AP-0005", "blocked", "Blocked BV", "EUR", "45.00");
  await invoice("AP-0006", "paid", "Paid Co", "USD", "99.00", { proposal_id: "P-0002" });
  await invoice("AP-0007", "ready", "Dollar Inc", "USD", "1000.00");
});
afterAll(() => { sql.close(); rmSync(dir, { recursive: true, force: true }); });

describe("route_money_out: declared as a reading tool for every token", () => {
  it("is a read-only, idempotent tool every token has, with a closed schema whose arguments are all optional", () => {
    const t = READ_TOOLS.find((x) => x.name === "route_money_out")!;
    expect(t.readOnly).toBe(true);
    expect(annotationsOf(t)).toEqual({ title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false, required: [] });
    for (const purpose of ["claude", "claude-propose"]) expect(toolsFor(caller(purpose)).map((x) => x.name)).toContain("route_money_out");
    expect(t.description).toMatch(/AgentOS/);
    expect(t.description).toMatch(/Read only\.$/);
  });

  it("is not one of Ask Purser's tools (code answers a money question there first)", () => {
    expect(ASK_TOOLS.map((x) => x.name)).not.toContain("route_money_out");
  });

  it("tells an AI to call it first when money or currency should move", async () => {
    const init = (await rpc(reader(), "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result as { instructions: string };
    expect(init.instructions).toMatch(/transfer money, pay a supplier or convert currency.*call route_money_out first/);
  });
});

describe("route_money_out: a transfer goes to the checked invoice it pays", () => {
  it("finds the invoice by payee and amount and, with a token made to propose, names propose_invoice_payment", async () => {
    const r = await route(proposer(), { kind: "transfer", payee: "Bergtex GmbH", amount: "2380.00", currency: "EUR" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ kind: "transfer", route: "propose", next_tool: "propose_invoice_payment", can_propose: true, matches: [{ invoice_id: "AP-0001", route: "propose" }] });
    expect(first(r)).toMatch(/^AP-0001 \(Bergtex GmbH, EUR 2,380\.00, due 1 Dec 2026\) can be filed: call propose_invoice_payment with AP-0001\. Nothing is paid until the CFO approves the exact terms with Face ID in Purser Cloud\./);
    expect(text(r)).toContain(MONEY_OUT_APPROVAL);
    expect(r.content.find((x) => x.type === "resource_link")).toMatchObject({ uri: "purser://invoices/AP-0001" });
  });

  it("matches a payee by its letters and digits, and an amount by its cents", async () => {
    const r = await route(proposer(), { payee: "BERGTEX gmbh.", amount: "2380" });
    expect(r.structuredContent!.matches.map((m) => m.invoice_id)).toEqual(["AP-0001"]);
  });

  it("with a reading token it routes but names no tool that files, and says how to get one", async () => {
    const r = await route(reader(), { payee: "Bergtex", amount: "2380.00" });
    expect(r.structuredContent).toMatchObject({ route: "propose", next_tool: null, can_propose: false });
    expect(first(r)).toMatch(/nothing can be filed from here: this token reads only: an owner can make a token that may propose in Purser Cloud/);
  });

  it("on the demo company and on a runner's company, nothing can be filed, and it says why", async () => {
    const demo = await route(proposer({ demo: true }), { payee: "Bergtex", amount: "2380.00" });
    expect(demo.structuredContent).toMatchObject({ route: "propose", next_tool: null, can_propose: false });
    expect(first(demo)).toMatch(/the demo company is read only.*Demo data, no real money\.$/);
    const runner = await route(proposer({ engine: null }), { payee: "Bergtex", amount: "2380.00" });
    expect(first(runner)).toMatch(/filed on its own runner/);
  });

  it("asks which one when several invoices fit", async () => {
    const r = await route(proposer(), { payee: "Bergtex" });
    expect(r.structuredContent).toMatchObject({ route: "choose", next_tool: null });
    expect(r.structuredContent!.matches.map((m) => [m.invoice_id, m.next_tool])).toEqual([["AP-0001", "propose_invoice_payment"], ["AP-0002", "propose_invoice_payment"]]);
    expect(first(r)).toMatch(/^2 invoices fit Bergtex: ask your user which, then call route_money_out again with its invoice_id\./);
  });

  it("says where an invoice stands when it cannot be filed: waiting, a new supplier, held, paid", async () => {
    const waiting = await route(proposer(), { invoice_id: "AP-0003" });
    expect(waiting.structuredContent).toMatchObject({ route: "waiting_cfo", next_tool: "payment_proposal", matches: [{ proposal_id: "P-0007" }] });
    expect(first(waiting)).toMatch(/already filed and waits for the CFO's Face ID in Purser Cloud; do not file it again/);
    expect((await route(reader(), { invoice_id: "AP-0003" })).structuredContent!.next_tool).toBe("pending_approvals");
    const fresh = await route(proposer(), { payee: "Zeeland Visserij", amount: "300.00" });
    expect(fresh.structuredContent).toMatchObject({ route: "new_supplier", next_tool: null });
    expect(first(fresh)).toMatch(/new supplier.*the CFO approves the supplier with Face ID/);
    expect((await route(proposer(), { invoice_id: "AP-0005" })).structuredContent).toMatchObject({ route: "held", next_tool: "get_invoice" });
    const paid = await route(proposer(), { payee: "Paid Co", amount: "99.00", currency: "USD" });
    expect(paid.structuredContent).toMatchObject({ route: "paid", next_tool: "explain_payment" });
    expect(first(paid)).toMatch(/is paid already: do not pay it again/);
  });

  it("files no transfer without an invoice: it says to send the invoice to Purser, and matches nothing by a near amount", async () => {
    for (const args of [{ payee: "Nobody Ltd", amount: "10.00" }, { payee: "Bergtex", amount: "2380.01" }, { invoice_id: "AP-0404" }, { payee: "Bergtex", currency: "USD" }]) {
      const r = await route(proposer(), args);
      expect({ args, route: r.structuredContent!.route, matches: r.structuredContent!.matches, next: r.structuredContent!.next_tool }).toEqual({ args, route: "needs_invoice", matches: [], next: null });
      expect(first(r)).toMatch(/Purser has no invoice.*only against an invoice it has read and checked.*a transfer without an invoice is made by a person in Airwallex's own app/);
    }
  });

  it("with nothing named, lists the invoices ready to pay", async () => {
    const r = await route(proposer());
    expect(r.structuredContent).toMatchObject({ kind: "transfer", route: "choose" });
    expect(r.structuredContent!.matches.map((m) => m.invoice_id)).toEqual(["AP-0001", "AP-0002", "AP-0007"]);
  });
});

describe("route_money_out: a currency conversion", () => {
  it("on its own is not Purser's to file: it says a person makes it in Airwallex's app, and lists what Purser can pay instead", async () => {
    const r = await route(proposer(), { kind: "fx_conversion", amount: "5000.00", currency: "USD" });
    expect(r.structuredContent).toMatchObject({ kind: "fx_conversion", route: "not_in_purser", next_tool: null });
    expect(r.structuredContent!.matches.map((m) => m.invoice_id)).toEqual(["AP-0007"]);
    expect(first(r)).toMatch(/^Purser does not file a currency conversion on its own: it buys currency only for a supplier payment it files .* A conversion on its own is made by a person in Airwallex's own app\. Nothing was filed\. Listed: 1 invoice ready to pay in USD/);
    expect((await route(proposer(), { kind: "fx_conversion", currency: "JPY" })).structuredContent).toMatchObject({ route: "not_in_purser", matches: [] });
  });

  it("for a supplier's invoice, routes the payment, the currency bought inside the terms the CFO signs", async () => {
    const r = await route(proposer(), { kind: "fx_conversion", invoice_id: "AP-0007", amount: "925.00" });
    expect(r.structuredContent).toMatchObject({ route: "propose", next_tool: "propose_invoice_payment", matches: [{ invoice_id: "AP-0007" }] });
    expect(first(r)).toMatch(/Purser buys currency only for a supplier payment it files: a quote for the shortfall, inside the terms the CFO signs\.$/);
  });
});

describe("route_money_out: the contract", () => {
  it("every answer conforms to the output schema and says no MCP tool moves money", async () => {
    const t = READ_TOOLS.find((x) => x.name === "route_money_out")!;
    const validate = new Ajv({ strict: false, allErrors: true }).compile(t.outputSchema);
    for (const args of [{}, { payee: "Bergtex" }, { invoice_id: "AP-0003" }, { invoice_id: "AP-0404" }, { kind: "fx_conversion" }, { kind: "payout", payee: "Paid Co" }]) {
      for (const c of [reader(), proposer()]) {
        const r = await route(c, args);
        expect({ args, ok: validate(r.structuredContent), err: r.isError ?? false }).toEqual({ args, ok: true, err: false });
        expect(r.structuredContent!.never).toMatch(/No MCP tool moves money, converts currency or approves, for any token/);
      }
    }
  });

  it("on the demo company's seeded books, answers in plain words a phone chat can show, and files nothing", async () => {
    const demo = { ...ctx({ demo: true, engine: null }), db: new TenantDb(sql, DEMO_TENANT), company: "Northwind Outdoor (demo company)", caller: { ...caller("claude"), tenantId: DEMO_TENANT } };
    for (const args of [{}, { kind: "fx_conversion" }, { payee: "Nobody Ltd", amount: "1.00" }]) {
      const r = await route(demo, args);
      const t = r.content[0]!.text!;
      expect({ args, err: r.isError ?? false, plain: /^[A-Z0-9]/.test(t) && t.length < 2000 && !/[{}]/.test(t), demo: /Demo data, no real money\./.test(first(r)), can: r.structuredContent!.can_propose })
        .toEqual({ args, err: false, plain: true, demo: true, can: false });
    }
  });

  it("refuses arguments it does not take: an approval, a malformed amount or currency, an unknown kind", async () => {
    for (const args of [{ approve: true }, { amount: "12,50" }, { currency: "eur" }, { kind: "approve" }, { payee: "x" }]) {
      const r = await route(proposer(), args);
      expect({ args, isError: r.isError }).toEqual({ args, isError: true });
      expect(JSON.parse(r.content[1]!.text!)).toMatchObject({ error: { code: "invalid_arguments" } });
    }
  });

  it("a guessed tool that would move money or currency is refused and pointed at route_money_out", async () => {
    for (const name of ["create_transfer", "transfer_funds", "convert_currency", "create_conversion", "execute_fx"]) {
      const e = (await rpc(proposer(), "tools/call", { name, arguments: {} })).error as { code: number; message: string; data: Json };
      expect({ name, code: e.code, data: e.data }).toEqual({ name, code: -32602, data: { code: "not_available_over_mcp", tool: name, next_tool: "route_money_out" } });
      expect(e.message).toContain(NEVER_SENTENCE);
      expect(e.message).toMatch(/route_money_out says whether and how Purser can file it\.$/);
    }
    for (const name of ["propose_transfer", "propose_fx", "get_beneficiaries"]) {
      const e = (await rpc(reader(), "tools/call", { name, arguments: {} })).error as { message: string; data: Json };
      expect({ name, data: e.data }).toEqual({ name, data: { code: "unknown_tool", tool: name, next_tool: "route_money_out" } });
    }
    // Any other unknown name is refused as before, with no pointer.
    expect((await rpc(reader(), "tools/call", { name: "list_suppliers" })).error).toMatchObject({ message: "no tool list_suppliers; tools/list shows the tools this token has", data: { code: "unknown_tool", tool: "list_suppliers" } });
  });
});
