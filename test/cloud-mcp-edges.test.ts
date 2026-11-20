// The MCP server's answer function (cloud/src/claude/mcp.ts mcpAnswer) called directly, on the cloud's database in
// memory: the demo company's seeded books, and a company of hand-written rows whose records lack what the demo always
// has (no issue day, no VAT, no status words, an internal move, a declined charge). Each case asserts what a client
// reads back: the protocol's refusals in both eras, the cursors, the prompts, the resources, every tool's sentence,
// the propose tools against a stand-in engine, and that a failure of the books is not dressed up as a refusal.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import type { Caller } from "../cloud/src/auth.js";
import { mcpAnswer, type McpCtx, PROTOCOL_VERSIONS } from "../cloud/src/claude/mcp.js";
import type { EngineApi } from "../cloud/src/engine/api.js";
import { DEMO_TENANT, ensureDemoCompany } from "../cloud/src/guest/guest.js";
import { DEMO_END } from "../cloud/src/guest/seed.gen.js";
import { dirBlobs, sqliteSql } from "../cloud/src/node.js";
import { TenantDb } from "../cloud/src/tenant.js";

const ORIGIN = "https://cloud.test";
const EDGE = "t_edgecase01";
const NOW = new Date("2026-11-20T10:00:00Z");
type Json = Record<string, unknown>;
type Result = { content: ({ type: string; text?: string; uri?: string })[]; structuredContent?: Json; isError?: boolean };

let sql: ReturnType<typeof sqliteSql>;
let dir: string;

const caller = (tenantId: string, purpose: string | null = "claude"): Caller => ({ tenantId, kind: "key", principal: "k_test", scopes: new Set(["read"]) as Caller["scopes"], user: null, purpose });

function ctx(o: Partial<McpCtx> & { tenant?: string; purpose?: string | null } = {}): McpCtx {
  const tenant = o.tenant ?? DEMO_TENANT;
  return {
    origin: ORIGIN, company: "Northwind Outdoor (demo company)", demo: tenant === DEMO_TENANT, engine: null, now: new Date(DEMO_END),
    db: new TenantDb(sql, tenant), caller: caller(tenant, o.purpose === undefined ? "claude" : o.purpose),
    ...o,
  };
}

/** One legacy request (no protocol header unless given): the JSON-RPC answer. */
async function legacy(c: McpCtx, method: string, params: Json = {}, version?: string): Promise<{ status: number; body: Json }> {
  const h = new Headers(version ? { "mcp-protocol-version": version } : {});
  return mcpAnswer(c, JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }), h) as Promise<{ status: number; body: Json }>;
}
/** One request in the current revision, with its mirrored headers. */
async function modern(c: McpCtx, method: string, params: Json = {}, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  const name = method === "resources/read" ? params.uri : params.name;
  const h = new Headers({ "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(typeof name === "string" ? { "mcp-name": name } : {}), ...headers });
  return mcpAnswer(c, JSON.stringify({ jsonrpc: "2.0", id: 8, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }), h) as Promise<{ status: number; body: Json }>;
}
const result = (r: { body: Json }) => (r.body as { result: Json }).result;
const error = (r: { body: Json }) => (r.body as { error: { code: number; message: string; data: { code: string } & Json } }).error;
async function tool(c: McpCtx, name: string, args?: Json, version = "2025-11-25"): Promise<Result> {
  return result(await legacy(c, "tools/call", { name, ...(args ? { arguments: args } : {}) }, version)) as unknown as Result;
}
const text = (r: Result) => r.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
const codeOf = (r: Result) => (JSON.parse(r.content[1]!.text!) as { error: { code: string } }).error.code;

async function insert(table: string, values: Json): Promise<void> {
  const keys = Object.keys(values);
  await sql.run(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => values[k] as string | number | null));
}

/** A company of plain rows: what a runner without the demo's extras would push. */
async function seedEdge(): Promise<void> {
  await insert("tenants", { id: EDGE, slug: "edge-case", name: "Edge Case BV", language: "en", created_at: "2026-10-01T00:00:00Z" });
  const inv = (id: string, status: string, body: Json, extra: Json = {}) => insert("invoices", {
    tenant_id: EDGE, id, vendor: String(body.vendor ?? "Bare Supplier"), invoice_no: String(body.invoice_no ?? id), due_date: String(body.due_date ?? "2026-11-25"), currency: String(body.currency ?? "EUR"),
    total: String(body.total ?? "100.00"), status, doc_sha256: "0".repeat(64), received_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", version: 1,
    body_json: JSON.stringify(body), body_sha256: "1".repeat(64), ...extra,
  });
  // A bare invoice: no issue day, no VAT, no booking account, no status words, no findings.
  await inv("AP-0001", "waiting_cfo", { vendor: "Bare Supplier", invoice_no: "B-1", currency: "EUR", total: "100.00", due_date: "2026-11-25", status: "waiting_cfo", proposal_id: null });
  // A full one: issue day, VAT, booking account, paid, a proposal, findings.
  await inv("AP-0002", "paid", { vendor: "Full Supplier", invoice_no: "F-2", currency: "EUR", total: "121.00", subtotal: "100.00", tax: "21.00", gl_account: "4000", issue_date: "2026-10-20", due_date: "2026-11-05", status: "paid", status_words: "paid", paid_at: "2026-11-04T09:00:00Z", proposal_id: "P-0002", findings: [{ level: "info", message: "the IBAN matches the one on file" }] });
  // Blocked, with a finding that blocks; overdue.
  await inv("AP-0003", "blocked", { vendor: "Blocked Supplier", invoice_no: "X-3", currency: "USD", total: "50.00", due_date: "2026-11-01", status: "blocked", findings: [{ code: "bank_changed", level: "block", message: "the bank account changed" }] });
  // Taxed but without a subtotal.
  await inv("AP-0004", "needs_review", { vendor: "Taxed Supplier", invoice_no: "T-4", currency: "EUR", total: "12.10", tax: "2.10", due_date: "2026-12-30", status: "needs_review" });

  const tx = (id: string, at: string, body: Json) => insert("transactions", {
    tenant_id: EDGE, id, sort_key: `${at}|${id}`, at, rail: String(body.rail), direction: String(body.direction), currency: String(body.currency), moved: body.moved ? 1 : 0,
    reconciliation: String(body.reconciliation ?? "unmatched"), version: 1, body_json: JSON.stringify({ id, at, ...body }), body_sha256: "2".repeat(64),
  });
  const approval = (o: Json = {}) => ({ required: false, authority: "within the agent's card limit", proposal_id: null, decision: null, method: null, approved_at: null, terms_sha256: null, ...o });
  // Paid out for AP-0002, approved by the CFO with a passkey, booked, with a fee.
  await tx("tx-out-1", "2026-11-04T09:00:00Z", { direction: "out", rail: "airwallex_transfer", description: "Invoice F-2", counterparty: "Full Supplier", amount: "121.00", currency: "EUR", fee: { amount: "0.50", currency: "EUR" }, moved: true, status: "paid", proof: "awx-tr-1", flags: ["late"], reconciliation_words: "matched to AP-0002",
    invoice: { ap_id: "AP-0002", supplier_no: "F-2", vendor: "Full Supplier" }, approval: approval({ required: true, authority: "the CFO", proposal_id: "P-0002", decision: "approved", method: "passkey", approved_at: "2026-11-03T08:00:00Z", terms_sha256: "a".repeat(64) }), booking: { entry_ids: [1], accounts: ["1600", "1100"], booked: "2026-11-04" } });
  // Money in, no invoice, no status words, no rail label.
  await tx("tx-in-1", "2026-11-10T09:00:00Z", { direction: "in", rail: "sepa", description: "Customer payment", counterparty: "A Customer", amount: "500.00", currency: "EUR", fee: null, moved: true, status: "settled", invoice: null, approval: approval(), booking: null });
  // Between the company's own accounts.
  await tx("tx-int-1", "2026-11-11T09:00:00Z", { direction: "internal", rail: "sepa", rail_label: "Own transfer", description: "", counterparty: "Own account", amount: "20.00", currency: "EUR", fee: null, moved: true, status: "settled", invoice: null, approval: approval(), booking: { entry_ids: [], accounts: [], booked: null } });
  // A card charge an agent made, declined (not moved), and one that needs the CFO and has no approval yet.
  await tx("tx-card-1", "2026-11-12T09:00:00Z", { direction: "out", rail: "card", description: "", counterparty: "Cloud Host", amount: "15.00", currency: "EUR", fee: null, moved: false, status: "declined", invoice: null, approval: approval({ authority: "card limit" }), booking: null, agent: "buyer" });
  await tx("tx-out-2", "2026-11-13T09:00:00Z", { direction: "out", rail: "airwallex_transfer", description: "", counterparty: "Waiting Supplier", amount: "70.00", currency: "USD", fee: { amount: "1.00", currency: "EUR" }, moved: true, status: "pending", invoice: { ap_id: null, vendor: "" }, approval: approval({ required: true, authority: "the CFO's passkey", method: "totp", approved_at: null }), booking: { entry_ids: [1, 2], accounts: ["1600"], booked: "2026-11-13" } });

  // The buyer agent's own card: one with no fee, one with a fee in another currency; a malformed amount counts as nothing.
  await tx("tx-card-2", "2026-11-14T09:00:00Z", { direction: "out", rail: "card", description: "Hosting", counterparty: "Cloud Host", amount: "10.00", currency: "EUR", fee: null, moved: true, status: "settled", invoice: null, approval: approval({ authority: "the buyer agent's card, within its limit" }), booking: null });
  await tx("tx-card-3", "2026-11-15T09:00:00Z", { direction: "out", rail: "card", description: "Hosting", counterparty: "Cloud Host", amount: "5.00", currency: "EUR", fee: { amount: "0.10", currency: "USD" }, moved: true, status: "settled", invoice: null, approval: approval({ authority: "the buyer agent's card, within its limit" }), booking: null });
  await tx("tx-odd-1", "2026-11-16T09:00:00Z", { direction: "out", rail: "card", description: "", counterparty: "", amount: "about ten", currency: "EUR", fee: null, moved: true, status: "settled", invoice: null, approval: approval(), booking: null });
  // An open invoice past its due day.
  await inv("AP-0005", "needs_vendor", { vendor: "Late Supplier", invoice_no: "L-5", currency: "EUR", total: "30.00", due_date: "2026-11-10", status: "needs_vendor" });

  let seq = 0;
  const audit = (ts: string, actor: string, event: string, subject: string | null, payload: Json | string) => insert("audit_rows", {
    tenant_id: EDGE, seq: ++seq, ts, actor, event, subject, payload_json: typeof payload === "string" ? payload : JSON.stringify(payload), prev_hash: "0".repeat(64), row_hash: (seq.toString(16)).padStart(64, "0"),
  });
  // An older policy version recorded without its fields, then the one in force.
  await audit("2026-10-01T00:00:00Z", "human", "policy.version", null, {});
  await audit("2026-11-01T00:00:00Z", "human", "policy.version", null, { version: 2, sha256: "b".repeat(64), changed: "limits" });
  await audit("2026-11-01T00:01:00Z", "treasury", "card.issued", "buyer", { agent: "buyer", currency: "EUR", limits: "50.00 / 500.00", last4: "4242" });
  await audit("2026-11-01T00:02:00Z", "treasury", "card.issued", null, { limits: "1 / 2" });
  await audit("2026-11-01T00:03:00Z", "human", "card.limit_changed", "buyer", { agent: "buyer", per_purchase: "75.00" });
  await audit("2026-11-01T00:04:00Z", "human", "card.limit_changed", "nobody", { agent: "nobody", per_purchase: "9.00" });
  await audit("2026-11-01T00:05:00Z", "human", "setting.changed", "fx_floor", { after: "1000" });
  await audit("2026-11-01T00:06:00Z", "human", "setting.changed", "bank_name", { after: "Test Bank" });
  // A card issued with one limit and no currency or last digits; a setting cleared.
  await audit("2026-11-01T00:07:00Z", "treasury", "card.issued", "solo", { limits: "40.00" });
  await audit("2026-11-01T00:08:00Z", "treasury", "setting.changed", "note", {});
  await audit("2026-11-02T00:00:00Z", "payer", "proposal.created", "P-0009", { kind: "payee_add", terms_sha256: "c".repeat(64) });
  await audit("2026-11-02T00:01:00Z", "payer", "proposal.created", "P-0010", "not json");
  await audit("2026-11-02T00:02:00Z", "payer", "proposal.created", "P-0011", { kind: "card_limit" });
  await audit("2026-11-02T00:03:00Z", "human", "proposal.rejected", "P-0011", {});
  await audit("2026-11-03T08:00:00Z", "human", "proposal.approved", "P-0002", {});
  await audit("2026-11-04T09:00:00Z", "awx-executor", "transfer.created", "awx-tr-1", {});
  await audit("2026-11-04T09:00:01Z", "awx-executor", "transfer.fee", "awx-tr-1", { fee: "EUR 0.50", fee_max: "EUR 1.00" });
  await audit("2026-11-04T09:00:02Z", "awx-executor", "transfer.fee", "awx-tr-1", { fee: "EUR 0.50" });
  await audit("2026-11-04T09:00:03Z", "awx-executor", "transfer.status", "awx-tr-1", { status: "PAID" });
  await audit("2026-11-04T09:00:04Z", "treasury", "ap.review_note", "AP-0002", { by: "code", status: "ready_to_pay" });
  await audit("2026-11-04T09:00:05Z", "treasury", "ap.review_note", "AP-0002", { by: "Vera" });
  await audit("2026-11-04T09:00:06Z", "treasury", "ap.review_note", "AP-0002", {});
  await audit("2026-11-04T09:00:07Z", "treasury", "proposal.executing", "P-0002", {});
  await audit("2026-11-04T09:00:08Z", "treasury", "something.odd_happened", "tx-out-1", {});
  await audit("2026-11-04T09:00:09Z", "human", "something.else", "P-0002", {});
  await audit("2026-11-04T09:00:10Z", "awx-executor", "transfer.status", "awx-tr-1", {});
  // Decisions code made with no model, and a duplicate the inbox stopped.
  await audit("2026-11-05T09:00:00Z", "buyer", "card.decline_met", "tx-card-1", { source: "fallback" });
  await audit("2026-11-05T09:00:01Z", "buyer", "claude.fallback", null, {});
  await audit("2026-11-05T09:00:02Z", "treasury", "ap.duplicate_document", null, { filename: "copy.pdf" });
  await insert("ledger_entries", { tenant_id: EDGE, entry_id: 1, posting_date: "2026-11-04", doc_date: "2026-11-04", description: "Payment F-2", entry_json: "{}", prev_hash: "0".repeat(64), entry_hash: "e".repeat(64) });
  // Open items: a receivable due next week and one in week three, a payable due in week two, one in USD.
  await insert("ledger_entries", { tenant_id: EDGE, entry_id: 2, posting_date: "2026-11-15", doc_date: "2026-11-15", description: "Open items", entry_json: "{}", prev_hash: "e".repeat(64), entry_hash: "f".repeat(64) });
  const line = (n: number, account: string, currency: string, debit: number, credit: number, party: string, doc: string, due: string) => insert("ledger_lines", { tenant_id: EDGE, entry_id: 2, line_no: n, posting_date: "2026-11-15", account, currency, debit_cents: debit, credit_cents: credit, party, doc_ref: doc, due_date: due });
  await line(1, "1300", "EUR", 20_000, 0, "A Customer", "S-1", "2026-11-24");
  await line(2, "1300", "EUR", 3_000, 0, "B Customer", "S-2", "2026-12-08");
  await line(3, "2100", "EUR", 0, 5_000, "Bare Supplier", "B-1", "2026-12-01");
  await line(4, "2100", "USD", 0, 7_000, "US Supplier", "U-1", "2026-11-30");
}

beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mcp-edges-"));
  sql = sqliteSql(":memory:");
  await ensureSchema(sql);
  await ensureDemoCompany(sql, dirBlobs(join(dir, "blobs")), new Date(DEMO_END));
  await seedEdge();
});
afterAll(() => { sql.close(); rmSync(dir, { recursive: true, force: true }); });

describe("the body and the era", () => {
  it("refuses a body that is not JSON, an empty batch, a batch of more than 20 and a message that is not an object", async () => {
    const c = ctx();
    const notJson = await mcpAnswer(c, "{nope");
    expect(notJson.status).toBe(400);
    expect(error(notJson as { body: Json })).toMatchObject({ code: -32700, data: { code: "parse_error" } });
    for (const body of ["[]", JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }))), "[1]", "null"]) {
      const r = await mcpAnswer(c, body);
      expect(r.status).toBe(400);
      expect(error(r as { body: Json }).data.code).toBe("invalid_request");
    }
  });

  it("a batch carrying the current revision's _meta is refused; an unknown legacy header version is refused with what is supported", async () => {
    const c = ctx();
    const batch = await mcpAnswer(c, JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }]));
    expect(batch.status).toBe(400);
    expect(error(batch as { body: Json }).message).toMatch(/batch is not part of protocol 2026-07-28/);
    const old = await legacy(c, "ping", {}, "2023-01-01");
    expect(old.status).toBe(400);
    expect(error(old)).toMatchObject({ code: -32022, data: { code: "unsupported_protocol_version", supported: [...PROTOCOL_VERSIONS], requested: "2023-01-01" } });
  });

  it("answers a legacy batch in order; notifications and a client's own answers get nothing; a message with neither is invalid", async () => {
    const c = ctx();
    const r = await mcpAnswer(c, JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 9, result: {} },
      { jsonrpc: "2.0", id: 10 },
    ]));
    expect(r.status).toBe(200);
    const out = r.body as Json[];
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(out[1]).toMatchObject({ id: 10, error: { code: -32600, data: { code: "invalid_request" } } });
    const quiet = await mcpAnswer(c, JSON.stringify([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 3, error: { code: 1, message: "x" } }]));
    expect(quiet).toEqual({ status: 202, body: null });
  });

  it("initialize picks the asked legacy version, or the newest legacy one; a propose token is told it may propose", async () => {
    const asked = await legacy(ctx(), "initialize", { protocolVersion: "2025-03-26" });
    expect(result(asked)).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "purser", websiteUrl: ORIGIN } });
    const unknown = await mcpAnswer(ctx({ tenant: EDGE, company: "Edge Case BV", demo: false, purpose: "claude-propose", origin: undefined }), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    const r = (unknown.body as { result: { protocolVersion: string; serverInfo: Json; instructions: string } }).result;
    expect(r.protocolVersion).toBe("2025-11-25");
    expect(r.serverInfo).not.toHaveProperty("websiteUrl");
    expect(r.instructions).toMatch(/You can read the books and propose an invoice's payment/);
    expect(r.instructions).toMatch(/Amounts are the company's own records/);
  });

  it("server/discover in a legacy request carries serverInfo in the result; an unknown method is -32601 (200 legacy, 404 current)", async () => {
    const d = result(await legacy(ctx(), "server/discover"));
    expect(d).toMatchObject({ serverInfo: { name: "purser" }, supportedVersions: [...PROTOCOL_VERSIONS] });
    const l = await legacy(ctx(), "sampling/createMessage");
    expect(l.status).toBe(200);
    expect(error(l)).toMatchObject({ code: -32601, data: { code: "unknown_method" } });
    expect(error(l).message).toMatch(/initialize and ping/);
    const m = await modern(ctx(), "sampling/createMessage");
    expect(m.status).toBe(404);
    expect(error(m).message).not.toMatch(/initialize and ping/);
  });
});

describe("the current revision's header checks", () => {
  const send = (body: Json, headers: Record<string, string>) => mcpAnswer(ctx(), JSON.stringify(body), new Headers(headers)) as Promise<{ status: number; body: Json }>;
  const META = (v: unknown) => ({ _meta: { "io.modelcontextprotocol/protocolVersion": v } });

  it("needs the version in the body and the header, the same in both, and one it speaks per request", async () => {
    const noBody = await send({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "ping" });
    expect(error(noBody)).toMatchObject({ code: -32020, data: { code: "header_mismatch" } });
    expect(error(noBody).message).toMatch(/header says 2026-07-28, but params._meta/);
    const notString = await send({ jsonrpc: "2.0", id: 1, method: "ping", params: META(5) }, {});
    expect(error(notString).message).toMatch(/header says nothing/);
    const noHeader = await send({ jsonrpc: "2.0", id: 1, method: "ping", params: META("2026-07-28") }, {});
    expect(error(noHeader).message).toMatch(/MCP-Protocol-Version header is required/);
    const differ = await send({ jsonrpc: "2.0", id: 1, method: "ping", params: META("2026-07-28") }, { "mcp-protocol-version": "2025-11-25" });
    expect(error(differ).message).toMatch(/does not match the body's/);
    const legacyInBody = await send({ jsonrpc: "2.0", id: "x", method: "ping", params: META("2025-11-25") }, { "mcp-protocol-version": "2025-11-25" });
    expect(legacyInBody.status).toBe(400);
    expect(error(legacyInBody)).toMatchObject({ code: -32022, data: { code: "unsupported_protocol_version", requested: "2025-11-25" } });
    expect((legacyInBody.body as { id: unknown }).id).toBe("x");
  });

  it("needs a method, and the Mcp-Method and Mcp-Name headers mirroring the body", async () => {
    const h = { "mcp-protocol-version": "2026-07-28" };
    const noMethod = await send({ jsonrpc: "2.0", id: { odd: true }, params: META("2026-07-28") }, h);
    expect(noMethod.status).toBe(400);
    expect(error(noMethod)).toMatchObject({ code: -32600, data: { code: "invalid_request" } });
    expect((noMethod.body as { id: unknown }).id).toBeNull();
    expect(error(await send({ jsonrpc: "2.0", id: 1, method: "ping", params: META("2026-07-28") }, h)).message).toMatch(/Mcp-Method header is required/);
    expect(error(await send({ jsonrpc: "2.0", id: 1, method: "ping", params: META("2026-07-28") }, { ...h, "mcp-method": "tools/list" })).message).toMatch(/Mcp-Method header 'tools\/list' does not match body value 'ping'/);
    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "cash_position", ...META("2026-07-28") } };
    expect(error(await send(call, { ...h, "mcp-method": "tools/call" })).message).toMatch(/Mcp-Name header is required for tools\/call/);
    expect(error(await send(call, { ...h, "mcp-method": "tools/call", "mcp-name": "cfo_policy" })).message).toMatch(/Mcp-Name header value 'cfo_policy' does not match body value 'cash_position'/);
    // The Base64 sentinel form: a name that decodes to the body's is taken; one that is not UTF-8 is not.
    const b64 = `=?base64?${Buffer.from("cash_position").toString("base64")}?=`;
    const ok = await send(call, { ...h, "mcp-method": "tools/call", "mcp-name": b64 });
    expect(ok.status).toBe(200);
    expect((result(ok) as { resultType: string; ttlMs?: number }).resultType).toBe("complete");
    const bad = await send(call, { ...h, "mcp-method": "tools/call", "mcp-name": `=?base64?${Buffer.from([0xff, 0xfe]).toString("base64")}?=` });
    expect(error(bad)).toMatchObject({ code: -32020, data: { code: "header_mismatch" } });
    // A notification in the current revision is taken without an answer; params that are not an object read as none.
    expect(await send({ jsonrpc: "2.0", method: "ping", params: META("2026-07-28") }, { ...h, "mcp-method": "ping" })).toEqual({ status: 202, body: null });
    const notObject = await send({ jsonrpc: "2.0", id: 1, method: "ping", params: "x" }, { ...h, "mcp-method": "ping" });
    expect(error(notObject).message).toMatch(/params._meta/);
  });
});

describe("lists and their cursors", () => {
  it("refuses a cursor it did not give (too long, not Base64, not an offset, past the end) on every list", async () => {
    for (const method of ["tools/list", "prompts/list", "resources/list", "resources/templates/list"]) {
      for (const cursor of ["x".repeat(41), "%%%", Buffer.from("p:3").toString("base64"), Buffer.from("o:999").toString("base64").replace(/=+$/, ""), 12]) {
        const r = await legacy(ctx(), method, { cursor });
        expect(error(r), `${method} ${String(cursor)}`).toMatchObject({ code: -32602, data: { code: "invalid_cursor" } });
      }
      // The first page (no cursor) answers.
      expect((await legacy(ctx(), method, { cursor: null })).body).toHaveProperty("result");
    }
  });

  it("without the cloud's origin, nothing carries icons; resources page on with nextCursor", async () => {
    const c = ctx({ origin: undefined });
    const tools = result(await legacy(c, "tools/list")) as { tools: Json[] };
    expect(tools.tools.every((t) => !("icons" in t))).toBe(true);
    const prompts = result(await legacy(c, "prompts/list")) as { prompts: Json[] };
    expect(prompts.prompts.every((p) => !("icons" in p))).toBe(true);
    expect(prompts.prompts.find((p) => p.name === "cfo_weekly_brief")).not.toHaveProperty("arguments");
    const res = result(await legacy(c, "resources/list")) as { resources: Json[]; nextCursor?: string };
    expect(res.resources.every((r) => !("icons" in r))).toBe(true);
    // The demo company has more invoices than a page holds only if it has over 50 resources; read on while there are pages.
    let cursor = res.nextCursor, pages = 1;
    while (cursor) { const next = result(await legacy(c, "resources/list", { cursor })) as { resources: Json[]; nextCursor?: string }; cursor = next.nextCursor; pages++; }
    expect(pages).toBeGreaterThanOrEqual(1);
  });
});

describe("prompts", () => {
  it("an unknown prompt and a missing or malformed required argument are refused; arguments that are not an object are none", async () => {
    expect(error(await legacy(ctx(), "prompts/get", { name: "nope" }))).toMatchObject({ code: -32602, data: { code: "unknown_prompt" } });
    expect(error(await legacy(ctx(), "prompts/get", { name: "explain_invoice", arguments: "AP-0001" }))).toMatchObject({ data: { code: "missing_argument", argument: "invoice_id" } });
    expect(error(await legacy(ctx(), "prompts/get", { name: "explain_payment", arguments: { payment_id: "no spaces allowed" } }))).toMatchObject({ data: { code: "missing_argument", argument: "payment_id" } });
    const ok = result(await legacy(ctx(), "prompts/get", { name: "explain_payment", arguments: { payment_id: "P-0002" } })) as { messages: { content: { text: string } }[] };
    expect(ok.messages[0]!.content.text).toMatch(/Call explain_payment with id P-0002, then payment_audit_trail/);
    const brief = result(await legacy(ctx(), "prompts/get", { name: "cash_outlook" })) as { messages: { content: { text: string } }[] };
    expect(brief.messages[0]!.content.text).toMatch(/cash_position and pending_approvals/);
  });
});

describe("resources/read", () => {
  it("needs a uri of at most 300 characters; an unknown one is -32002 before 2026-07-28 and -32602 since", async () => {
    expect(error(await legacy(ctx(), "resources/read", {}))).toMatchObject({ code: -32602, data: { code: "missing_argument" } });
    expect(error(await legacy(ctx(), "resources/read", { uri: `purser://${"x".repeat(300)}` }))).toMatchObject({ data: { code: "missing_argument" } });
    expect(error(await legacy(ctx(), "resources/read", { uri: "purser://nothing" }))).toMatchObject({ code: -32002, data: { code: "resource_not_found", uri: "purser://nothing" } });
    expect(error(await modern(ctx(), "resources/read", { uri: "purser://nothing" }))).toMatchObject({ code: -32602, data: { code: "resource_not_found" } });
  });

  it("a payment, an invoice, the policy and the connection read as documents; the demo's books end on its last day", async () => {
    const edge = ctx({ tenant: EDGE, company: "Edge Case BV", demo: false, now: NOW, purpose: "claude-propose" });
    const conn = (result(await legacy(edge, "resources/read", { uri: "purser://connection" })) as { contents: { text: string }[] }).contents[0]!.text;
    expect(conn).toMatch(/may propose an invoice's payment/);
    expect(conn).toMatch(/Amounts are the company's own records/);
    const pol = (result(await legacy(edge, "resources/read", { uri: "purser://policy" })) as { contents: { text: string }[] }).contents[0]!.text;
    expect(pol).toMatch(/Policy version 2, since 2026-11-01/);
    expect(pol).toMatch(/- buyer|Buyer|- .*: EUR 75.00 a purchase, EUR 500.00 a month/);
    expect(pol).toMatch(/- fx_floor: 1000/);
    const pay = JSON.parse((result(await legacy(edge, "resources/read", { uri: "purser://payments/AP-0002" })) as { contents: { text: string }[] }).contents[0]!.text) as Json;
    expect(pay).toMatchObject({ payment: { id: "tx-out-1", counterparty: "Full Supplier" } });
    expect(pay).not.toHaveProperty("demo_data");
    const inv = JSON.parse((result(await legacy(edge, "resources/read", { uri: "purser://invoices/AP-0004" })) as { contents: { text: string }[] }).contents[0]!.text) as { invoice: { vendor: string } };
    expect(inv.invoice.vendor).toBe("Taxed Supplier");
    expect(error(await legacy(edge, "resources/read", { uri: "purser://payments/P-9999" })).message).toMatch(/no payment in Edge Case BV's books is P-9999/);
    expect(error(await legacy(edge, "resources/read", { uri: "purser://invoices/%E0%A4%A" })).message).toMatch(/not valid percent-encoding/);
    expect(error(await legacy(edge, "resources/read", { uri: "purser://books/vat/2026Q5" })).data.code).toBe("resource_not_found");
    // An empty company's policy: no version, no cards, no settings.
    const empty = ctx({ tenant: "t_emptyco01", company: "Empty BV", demo: false, now: NOW });
    const ep = (result(await legacy(empty, "resources/read", { uri: "purser://policy" })) as { contents: { text: string }[] }).contents[0]!.text;
    expect(ep).toMatch(/No policy version recorded yet/);
    expect(ep).toMatch(/- none issued/);
    expect(ep).toMatch(/- none recorded/);
    // The demo company, under a name that does not say demo: labelled demo data, and its reports at its own last day.
    const demo = ctx({ company: "Northwind Outdoor" });
    const demoConn = (result(await legacy(demo, "resources/read", { uri: "purser://connection" })) as { contents: { text: string }[] }).contents[0]!.text;
    expect(demoConn).toMatch(/Northwind Outdoor \(demo data\)/);
    expect(demoConn).toMatch(/cannot propose anything/);
    const demoPol = (result(await legacy(demo, "resources/read", { uri: "purser://policy" })) as { contents: { text: string }[] }).contents[0]!.text;
    expect(demoPol).toMatch(/^# Northwind Outdoor: the CFO's policy \(demo data\)/);
    const bal = JSON.parse((result(await legacy(demo, "resources/read", { uri: "purser://books/balance" })) as { contents: { text: string }[] }).contents[0]!.text) as Json;
    expect(bal).toMatchObject({ demo_data: true, report: "balance", to: DEMO_END.slice(0, 10) });
  });
});

describe("tools/call: the protocol's refusals", () => {
  it("needs a name; a propose tool on a reading token, an approving name and an unknown one are each refused with their code", async () => {
    expect(error(await legacy(ctx(), "tools/call", {}))).toMatchObject({ code: -32602, data: { code: "missing_argument" } });
    expect(error(await legacy(ctx(), "tools/call", { name: "propose_invoice_payment" }))).toMatchObject({ data: { code: "needs_propose_token", tool: "propose_invoice_payment" } });
    expect(error(await legacy(ctx(), "tools/call", { name: "approve_payment" }))).toMatchObject({ data: { code: "not_available_over_mcp" } });
    expect(error(await legacy(ctx(), "tools/call", { name: "raise_card_limit" }))).toMatchObject({ data: { code: "not_available_over_mcp" } });
    expect(error(await legacy(ctx(), "tools/call", { name: "weather" }))).toMatchObject({ data: { code: "unknown_tool", tool: "weather" } });
  });

  it("arguments that do not fit are a refusal with the tool's own words", async () => {
    const bad = await tool(ctx(), "list_invoices", { limit: 0, status: "Not A Word" });
    expect(bad.isError).toBe(true);
    expect(codeOf(bad)).toBe("invalid_arguments");
    expect(text(bad)).toMatch(/The arguments do not fit list_invoices: (limit|status)/);
    const notArgs = await tool(ctx(), "get_invoice", { id: "" });
    expect(text(notArgs)).toMatch(/id:/);
  });

  it("a failure of the books themselves is not dressed up as a refusal: the request fails", async () => {
    const broken = ctx({ db: { select: async () => { throw new Error("the database is away"); }, one: async () => { throw new Error("the database is away"); } } as unknown as TenantDb });
    await expect(tool(broken, "agent_decisions")).rejects.toThrow("the database is away");
    await expect(legacy(broken, "resources/read", { uri: "purser://cash" })).rejects.toThrow("the database is away");
  });
});

describe("the reading tools on the demo company", () => {
  it("company_overview: labelled demo data under a name that does not say so; links to the overview and the approvals", async () => {
    const r = await tool(ctx({ company: "Northwind Outdoor" }), "company_overview");
    expect(text(r)).toMatch(/^Northwind Outdoor \(demo data\): net EUR [\d,]+\.\d\d, \d+ invoices? waiting for the CFO's Face ID\./);
    expect(text(r)).toMatch(/Money in EUR .* \(\d+ \w+ 2026 to \d+ \w+ 2026\)\./);
    expect(r.content.filter((x) => x.type === "resource_link").map((x) => x.uri)).toEqual(["purser://company/overview", "purser://approvals/pending"]);
    // An older client (2025-03-26) gets no resource links.
    const old = await tool(ctx(), "company_overview", undefined, "2025-03-26");
    expect(old.content.every((x) => x.type === "text")).toBe(true);
  });

  it("every report of the books answers in a sentence, and vat names its quarter", async () => {
    const c = ctx();
    for (const report of ["pnl", "balance", "trial", "payables", "receivables"]) {
      const r = await tool(c, "books_report", { report });
      expect(r.isError, report).toBeUndefined();
      expect(r.structuredContent).toMatchObject({ report });
      expect(r.content.find((x) => x.type === "resource_link")!.uri).toBe(`purser://books/${report}`);
    }
    expect(text(await tool(c, "books_report", { report: "trial" }))).toMatch(/trial balance at 12 Nov 2026, \d+ accounts?\./);
    expect(text(await tool(c, "books_report", { report: "payables" }))).toMatch(/open payables? at 12 Nov 2026\./);
    const vat = await tool(c, "books_report", { report: "vat" });
    expect(text(vat)).toMatch(/VAT overview 2026Q4, balance EUR/);
    expect(vat.content.find((x) => x.type === "resource_link")!.uri).toBe("purser://books/vat/2026Q4");
    const q3 = await tool(c, "books_report", { report: "vat", quarter: "2026Q3" });
    expect(q3.content.find((x) => x.type === "resource_link")!.uri).toBe("purser://books/vat/2026Q3");
    expect(text(await tool(c, "vat_summary", { quarter: "2026Q4" }))).toMatch(/\(an overview, not a filing\)/);
  });

  it("agent_decisions: the newest entries up to the limit", async () => {
    const r = await tool(ctx(), "agent_decisions", { limit: 2 });
    expect((r.structuredContent as { items: unknown[] }).items).toHaveLength(2);
    expect(text(r)).toMatch(/decisions? by agents in all/);
  });

  it("spend by supplier between two days names the period; cash_position projects the weeks asked", async () => {
    const s = await tool(ctx(), "spend_breakdown", { by: "supplier", from: "2026-11-01" });
    expect(text(s)).toMatch(/^Spend by supplier \(demo data\): .* out \(1 Nov 2026 to now\)\./);
    const t = await tool(ctx(), "spend_breakdown", { to: "2026-11-30" });
    expect(text(t)).toMatch(/\(start to 30 Nov 2026\)/);
    const cash = await tool(ctx({ company: "Northwind Outdoor" }), "cash_position", { weeks: 2 });
    expect((cash.structuredContent as { projection: unknown[] }).projection).toHaveLength(2);
    expect(text(cash)).toMatch(/^Northwind Outdoor \(demo data\): net cash/);
  });
});

describe("the reading tools on a company of plain rows", () => {
  const edge = () => ctx({ tenant: EDGE, company: "Edge Case BV", demo: false, now: NOW });

  it("company_overview of a company without a decision or a movement in the period still answers", async () => {
    const r = await tool(ctx({ tenant: "t_emptyco01", company: "Empty BV", demo: false, now: NOW }), "company_overview");
    expect(text(r)).toMatch(/^Empty BV: net EUR 0\.00, 0 invoices waiting for the CFO's Face ID\./);
    expect(text(r)).not.toMatch(/ to /);
    const p = await tool(ctx({ tenant: "t_emptyco01", company: "Empty BV", demo: false, now: NOW }), "books_report", { report: "pnl" });
    expect(text(p)).toMatch(/^Empty BV: profit and loss 1 Jan 2026 to 20 Nov 2026\.$/m);
  });

  it("get_invoice: a bare invoice says what it lacks plainly; a full one says all; a missing one is not_found", async () => {
    const bare = text(await tool(edge(), "get_invoice", { id: "AP-0001" }));
    expect(bare).toMatch(/^AP-0001: Bare Supplier, EUR 100\.00, waiting_cfo\./);
    expect(bare).toMatch(/Bare Supplier · invoice B-1 · due 25 Nov 2026\./);
    expect(bare).toMatch(/Total EUR 100\.00\./);
    expect(bare).toMatch(/Checks: nothing found\./);
    const full = text(await tool(edge(), "get_invoice", { id: "AP-0002" }));
    expect(full).toMatch(/invoice F-2 of 20 Oct 2026 · due 5 Nov 2026/);
    expect(full).toMatch(/Total EUR 121\.00 \(net EUR 100\.00, VAT EUR 21\.00\) · booked to 4000\./);
    expect(full).toMatch(/Status: paid, paid 4 Nov 2026 · proposal P-0002\./);
    expect(full).toMatch(/Checks found: the IBAN matches the one on file/);
    expect(text(await tool(edge(), "get_invoice", { id: "AP-0004" }))).toMatch(/\(net EUR 0\.00, VAT EUR 2\.10\)/);
    const none = await tool(edge(), "get_invoice", { id: "AP-0099" });
    expect(codeOf(none)).toBe("not_found");
  });

  it("list_invoices and list_transactions read each row as it is: status words or the status, the rail's label or the rail, in, out or internal", async () => {
    const inv = await tool(edge(), "list_invoices", { status: "blocked" });
    expect(text(inv)).toMatch(/^1 invoice with status blocked\./);
    expect(text(inv)).toMatch(/AP-0003 · Blocked Supplier · X-3 · USD 50\.00 · due 1 Nov 2026 · blocked/);
    const paged = await tool(edge(), "list_invoices", { limit: 1 });
    expect(text(paged)).toMatch(/^1 invoice; more with next_cursor\./);
    const tx = text(await tool(edge(), "list_transactions", { limit: 10 }));
    expect(tx).toMatch(/in EUR 500\.00 · A Customer · sepa · settled/);
    expect(tx).toMatch(/internal EUR 20\.00 · Own account · Own transfer · settled/);
    expect(tx).toMatch(/out EUR 121\.00 · Full Supplier · airwallex_transfer · paid/);
    expect(text(await tool(edge(), "list_transactions", { limit: 2 }))).toMatch(/more with next_cursor/);
  });

  it("what_needs_attention counts what is blocked and overdue", async () => {
    const r = await tool(edge(), "what_needs_attention");
    expect(text(r)).toMatch(/^As of 20 Nov 2026: 1 invoice waiting for the CFO's Face ID, (some overdue|nothing overdue)\./);
    expect(text(r)).toMatch(/Blocked: 1\./);
    expect((r.structuredContent as { blocked_by_reason: Json }).blocked_by_reason).toEqual({ bank_changed: 1 });
  });

  it("pending_approvals lists the invoice waiting and each proposal with no decision, without an origin as a bare path", async () => {
    const r = await tool(ctx({ tenant: EDGE, company: "Edge Case BV", demo: false, now: NOW, origin: undefined }), "pending_approvals");
    const s = r.structuredContent as { invoices: { id: string; approve_in: string }[]; proposals: { id: string; kind: string; terms_sha256: string | null; approve_in: string }[] };
    expect(s.invoices.map((i) => i.id)).toEqual(["AP-0001"]);
    expect(s.invoices[0]!.approve_in).toBe("/#/invoices");
    expect(s.proposals.map((p) => [p.id, p.kind, p.terms_sha256])).toEqual([["P-0009", "payee_add", "c".repeat(64)], ["P-0010", "proposal", null]]);
    expect(text(r)).toMatch(/^3 items waiting for the CFO's Face ID\. Approve each in Purser Cloud; no AI can approve\./);
    expect(text(r)).toMatch(/- P-0009 · payee add · filed by /);
  });

  it("cfo_policy: the version in force, the cards with a raise the CFO approved, the settings in words and the decisions", async () => {
    const r = await tool(edge(), "cfo_policy");
    const s = r.structuredContent as { agent_cards: { agent: string; per_purchase: string; per_month: string; currency: string }[]; settings: { setting: string; value: string; by: string }[]; decisions: Json };
    expect(s.agent_cards).toEqual([expect.objectContaining({ agent: "buyer", per_purchase: "75.00", per_month: "500.00", currency: "EUR" }), expect.objectContaining({ agent: "solo", per_purchase: "40.00", per_month: "", currency: "EUR", last4: "" })]);
    expect(s.settings.map((x) => [x.setting, x.value])).toEqual([["fx_floor", "1000"], ["bank_name", "Test Bank"], ["note", ""]]);
    expect((r.structuredContent as { policy_history: { version: number; sha256: string }[] }).policy_history[0]).toMatchObject({ version: 0, sha256: "" });
    expect(s.decisions).toEqual({ approved: 1, rejected: 1, expired: 0 });
    expect(text(r)).toMatch(/Policy version 2 since 1 Nov 2026 \(bbbbbbbbbbbb…\)\./);
    expect(text(r)).toMatch(/- fx floor: 1,000\.00/);
    expect(text(r)).toMatch(/- bank name: Test Bank/);
  });

  it("spend by agent: supplier invoices as one line, an agent's card, and a declined charge counted, not added", async () => {
    const r = await tool(edge(), "spend_breakdown", { by: "agent" });
    const items = (r.structuredContent as { items: { key: string; currency: string; amount: string; count: number; declined: number }[] }).items;
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "invoices", currency: "EUR", amount: "121.50", count: 1 }),
      expect.objectContaining({ key: "invoices", currency: "USD", amount: "70.00", count: 1 }),
    ]));
    expect(items.some((i) => i.declined === 1 && i.amount === "0.00")).toBe(true);
    expect(text(r)).toMatch(/1 declined/);
    const bySupplier = (await tool(edge(), "spend_breakdown", { by: "supplier" })).structuredContent as { items: { label: string }[] };
    expect(bySupplier.items.map((i) => i.label)).toEqual(expect.arrayContaining(["Full Supplier", "Waiting Supplier", "Cloud Host"]));
    expect(text(await tool(ctx({ tenant: "t_emptyco01", company: "Empty BV", demo: false, now: NOW }), "spend_breakdown"))).toMatch(/^Spend by agent: nothing out\./);
  });

  it("payment_audit_trail and explain_payment, by the invoice's id: every step in words, the booking, the CFO's passkey", async () => {
    const trail = await tool(edge(), "payment_audit_trail", { id: "AP-0002" });
    const steps = (trail.structuredContent as { steps: { event: string; who: string; text: string }[] }).steps;
    const said = Object.fromEntries(steps.map((x) => [`${x.event}:${x.text}`, x.who]));
    expect(Object.keys(said)).toEqual(expect.arrayContaining([
      "transfer.fee:The bank's fee: EUR 0.50 (at most EUR 1.00 was approved)", "transfer.fee:The bank's fee: EUR 0.50",
      "transfer.status:Transfer awx-tr-1 is paid", "transfer.status:Transfer awx-tr-1 is ",
      "transfer.created:Transfer awx-tr-1 created at the bank", "ap.review_note:Checked by Purser's code; status ready to pay",
      "ap.review_note:Checked by Vera; status ", "ap.review_note:Checked by a person; status ", "proposal.executing:P-0002 being carried out",
      "something.odd_happened:something odd happened",
    ]));
    expect(steps.find((x) => x.event === "transfer.created")!.who).toBe("Purser (Airwallex)");
    expect(steps.find((x) => x.event === "something.odd_happened")!.who).toBe("Purser's code");
    expect(text(trail)).toMatch(/- booked: ledger entry 1 on 4 Nov 2026/);
    expect(trail.content.filter((x) => x.type === "resource_link").map((x) => x.uri)).toEqual(["purser://payments/tx-out-1", "purser://invoices/AP-0002"]);
    const why = await tool(edge(), "explain_payment", { id: "P-0002" });
    expect(text(why)).toMatch(/^The company paid Full Supplier EUR 121\.00 on 4 Nov 2026 for invoice F-2 \(AP-0002\) via airwallex_transfer; paid\./);
    expect(text(why)).toMatch(/The CFO approved P-0002 on 3 Nov 2026 by signing its exact terms with Face ID \(terms aaaaaaaaaaaa…\)\./);
    expect(text(why)).toMatch(/Booked in ledger entry 1 \(accounts 1600, 1100\)\./);
    expect(text(why)).toMatch(/Reconciliation: matched to AP-0002; flags: late\./);
    expect(text(why)).toMatch(/Proof at the rail: awx-tr-1\./);
  });

  it("explain_payment of money in, an internal move and a payment still waiting for the CFO", async () => {
    const inn = text(await tool(edge(), "explain_payment", { id: "tx-in-1" }));
    expect(inn).toMatch(/^A Customer paid the company EUR 500\.00 on 10 Nov 2026 for Customer payment via sepa; settled\./);
    expect(inn).toMatch(/No CFO approval was needed: within the agent's card limit\./);
    expect(inn).toMatch(/Not booked yet\./);
    expect(inn).toMatch(/Reconciliation: unknown\./);
    const own = text(await tool(edge(), "explain_payment", { id: "tx-int-1" }));
    expect(own).toMatch(/^EUR 20\.00 moved between the company's own accounts on 11 Nov 2026 via Own transfer; settled\./);
    const waiting = text(await tool(edge(), "explain_payment", { id: "tx-out-2" }));
    expect(waiting).toMatch(/It needs the CFO's Face ID and has none yet \(the CFO's passkey\)\./);
    expect(waiting).toMatch(/Booked in ledger entries 1, 2 \(accounts 1600\)\./);
    expect(codeOf(await tool(edge(), "explain_payment", { id: "nothing-here" }))).toBe("not_found");
    expect(codeOf(await tool(edge(), "payment_audit_trail", { id: "nothing-here" }))).toBe("not_found");
    const card = await tool(edge(), "payment_audit_trail", { id: "tx-card-1" });
    expect(card.content.filter((x) => x.type === "resource_link").map((x) => x.uri)).toEqual(["purser://payments/tx-card-1"]);
    expect(text(await tool(ctx({ tenant: EDGE, company: "Edge Case BV", demo: true, now: NOW }), "explain_payment", { id: "tx-in-1" }))).toMatch(/Demo data, no real money\.$/m);
    expect(text(await tool(ctx({ tenant: EDGE, company: "Edge Case BV", demo: true, now: NOW }), "payment_audit_trail", { id: "tx-in-1" }))).toMatch(/\(demo data\)\./);
  });
});

describe("the reading tools on a company of plain rows, counted", () => {
  const edge = () => ctx({ tenant: EDGE, company: "Edge Case BV", demo: false, now: NOW });
  const empty = () => ctx({ tenant: "t_emptyco01", company: "Empty BV", demo: false, now: NOW });

  it("company_overview and agent_decisions say how many decisions code made without a model, and the duplicate stopped", async () => {
    const o = text(await tool(edge(), "company_overview"));
    expect(o).toMatch(/; 1 duplicate stopped\./);
    expect(o).toMatch(/of them by code's fallback \(no model\)\./);
    expect(text(await tool(edge(), "agent_decisions"))).toMatch(/decisions? by agents in all, 2 of them by code's fallback \(no model\)\./);
  });

  it("what_needs_attention says some is overdue; an empty company has none of anything", async () => {
    expect(text(await tool(edge(), "what_needs_attention"))).toMatch(/some overdue\./);
    const e = text(await tool(empty(), "what_needs_attention"));
    expect(e).toMatch(/0 invoices waiting for the CFO's Face ID, nothing overdue\./);
    expect(e).toMatch(/^Open none · due within 7 days none · within 30 days none · overdue none\./m);
  });

  it("cash_position counts money in the main currency, fees in it only, and a malformed amount as nothing", async () => {
    const r = await tool(edge(), "cash_position");
    const s = r.structuredContent as { currency: string; money_in: string; money_out: string; net_cash: string; since: string };
    expect(s.currency).toBe("EUR");
    expect(s.money_in).toBe("500.00");
    // 121.00 + 0.50 fee, 10.00, 5.00 (its USD fee left out), and the malformed amount as 0.
    expect(s.money_out).toBe("136.50");
    expect(s.since).toBe("2026-11-04T09:00:00Z");
    // The open items in EUR by due day: 200.00 in within the first week, 50.00 out in the second, 30.00 in the third; USD left out.
    const proj = (r.structuredContent as { open: { receivables: string; payables: string }; projection: { expected_in: string; due_out: string }[] });
    expect(proj.open).toEqual({ receivables: "230.00", payables: "50.00" });
    expect(proj.projection.map((w) => [w.expected_in, w.due_out])).toEqual([["200.00", "0.00"], ["0.00", "50.00"], ["30.00", "0.00"], ["0.00", "0.00"]]);
    expect(text(await tool(edge(), "books_report", { report: "payables" }))).toMatch(/2 open payables at 20 Nov 2026\.\n- U-1 · USD 70\.00 · due 30 Nov 2026 · not due\n- B-1 · EUR 50\.00 · due 1 Dec 2026 · not due/);
    const e = (await tool(empty(), "cash_position")).structuredContent as { currency: string; since: string | null; movements: number };
    expect(e).toMatchObject({ currency: "EUR", since: null, movements: 0 });
  });

  it("cfo_policy of a company with no records: no version, no cards, no settings", async () => {
    const r = await tool(empty(), "cfo_policy");
    expect(text(r)).toMatch(/No policy version recorded yet\./);
    expect(text(r)).toMatch(/Decisions so far: 0 approved, 0 rejected, 0 expired\./);
  });

  it("spend by agent names the agent's own card and puts what no agent made under Other", async () => {
    const items = ((await tool(edge(), "spend_breakdown", { by: "agent" })).structuredContent as { items: { key: string; label: string; amount: string }[] }).items;
    expect(items.find((i) => i.key === "buyer")).toMatchObject({ amount: "15.00" });
    expect(items.find((i) => i.key === "buyer")!.label).toMatch(/, own card$/);
    expect(items.find((i) => i.key === "other")).toMatchObject({ label: "Other" });
    const sup = ((await tool(edge(), "spend_breakdown", { by: "supplier" })).structuredContent as { items: { label: string }[] }).items;
    expect(sup.map((i) => i.label)).toContain("Unknown");
  });
});

describe("the propose tools", () => {
  const proposal = { id: "P-0042", kind: "supplier_payment", status: "PENDING", terms_sha256: "d".repeat(64), challenge: "secret-challenge", facts: [["Payee", "Bare Supplier"], ["Amount", "EUR 100.00"]] as [string, string][], warnings: ["the supplier is new"] };
  function engine(o: { refuse?: string } = {}): EngineApi {
    return {
      invoice: async (id: string) => (id === "AP-0001" ? { id } : null),
      propose: async () => (o.refuse ? { ok: false, reason: o.refuse } : { ok: true, proposal }),
      proposal: async (id: string) => (id === "P-0042" ? proposal : null),
    } as unknown as EngineApi;
  }
  const proposer = (o: Partial<McpCtx> = {}) => ctx({ tenant: EDGE, company: "Edge Case BV", demo: false, now: NOW, purpose: "claude-propose", ...o });

  it("files the payment and says nothing is paid; the challenge a passkey signs never leaves", async () => {
    const r = await tool(proposer({ engine: engine() }), "propose_invoice_payment", { invoice_id: "AP-0001" });
    expect(text(r)).toMatch(/^Filed P-0042 for the CFO\. Nothing is paid until the CFO approves these exact terms with Face ID/);
    expect(text(r)).toMatch(/- Payee: Bare Supplier\n- Amount: EUR 100\.00\nWarning: the supplier is new/);
    expect(r.structuredContent).toMatchObject({ proposal: { id: "P-0042", terms_sha256: "d".repeat(64) }, paid: false });
    expect(JSON.stringify(r)).not.toContain("secret-challenge");
    const st = await tool(proposer({ engine: engine() }), "payment_proposal", { proposal_id: "P-0042" });
    expect(text(st)).toMatch(/^P-0042: PENDING\./);
    expect(JSON.stringify(st)).not.toContain("secret-challenge");
    expect(codeOf(await tool(proposer({ engine: engine() }), "payment_proposal", { proposal_id: "P-0001" }))).toBe("not_found");
  });

  it("refuses on the demo company, without an engine (a runner's company), for an unknown invoice, and in the engine's words", async () => {
    expect(codeOf(await tool(proposer({ demo: true, engine: engine() }), "propose_invoice_payment", { invoice_id: "AP-0001" }))).toBe("demo_read_only");
    expect(codeOf(await tool(proposer({ engine: null }), "propose_invoice_payment", { invoice_id: "AP-0001" }))).toBe("runner_only");
    expect(codeOf(await tool(proposer({ engine: null }), "payment_proposal", { proposal_id: "P-0042" }))).toBe("runner_only");
    expect(codeOf(await tool(proposer({ engine: engine() }), "propose_invoice_payment", { invoice_id: "AP-0077" }))).toBe("not_found");
    const held = await tool(proposer({ engine: engine({ refuse: "the invoice is held for a person" }) }), "propose_invoice_payment", { invoice_id: "AP-0001" });
    expect(codeOf(held)).toBe("refused");
    expect(text(held)).toMatch(/^Purser did not file AP-0001: the invoice is held for a person\. Nothing was proposed\./);
  });

  it("an engine that fails mid-call fails the request; it is not a refusal", async () => {
    const down = { invoice: async () => { throw new Error("the engine is away"); } } as unknown as EngineApi;
    await expect(tool(proposer({ engine: down }), "propose_invoice_payment", { invoice_id: "AP-0001" })).rejects.toThrow("the engine is away");
  });
});
