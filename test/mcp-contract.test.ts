// The MCP server's contract with any client (19 Nov, owner: "nicer and tighter, for all AI agents"). It holds, for every
// tool a token can have: a precise description, an input schema that is a closed object whose every property is
// described and carries examples, examples that the schema and the server's own argument check both accept, and
// annotations that say what the tool does (reading tools read only and idempotent; the one proposing tool adds, never
// destroys; none reaches outside Purser). Every error carries one stable code from ERROR_CODES, in the same shape each
// time. And the safety model, unchanged: a call that would approve, pay, change a limit or write is refused for every
// token, saying so; a reading token cannot propose; the demo company proposes nothing; a proposal pays nothing.
/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC answers are read loosely here; each test checks their shape */
import { Ajv } from "ajv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_CONNECTOR_TOKEN, type Caller } from "../cloud/src/auth.js";
import { annotationsOf, ERROR_CODES, NEVER_SENTENCE, PROMPTS, toolsFor } from "../cloud/src/claude/mcp.js";
import { connectionMarkdown } from "../cloud/src/claude/resources.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const proposeCaller = { purpose: "claude-propose" } as unknown as Caller;
const readCaller = { purpose: "claude" } as unknown as Caller;
const ALL = toolsFor(proposeCaller);
const READS = toolsFor(readCaller);
type Prop = { type?: string; description?: string; examples?: unknown[]; enum?: unknown[]; pattern?: string };
type Schema = { type: string; properties: Record<string, Prop>; required: string[]; additionalProperties: boolean };

describe("every tool's description, schema and annotations", () => {
  it("has the seventeen tools in a fixed order: fifteen that read (route_money_out last), then the one that proposes and the one that reads a proposal", () => {
    expect(READS.length).toBe(15);
    expect(READS.at(-1)!.name).toBe("route_money_out");
    expect(ALL.map((t) => t.name).slice(15)).toEqual(["propose_invoice_payment", "payment_proposal"]);
    expect(ALL.slice(0, 15).map((t) => t.name)).toEqual(READS.map((t) => t.name));
  });

  for (const t of ALL) {
    it(`${t.name}: a name, title and description any client can show and an AI can choose by`, () => {
      expect(t.name).toMatch(/^[a-z][a-z_]{2,63}$/);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.title.length).toBeLessThanOrEqual(60);
      expect(t.description.length).toBeGreaterThanOrEqual(80);
      expect(t.description.length).toBeLessThanOrEqual(600);
      // Each description says what it may not do or what it changes: read only, or what a proposal is.
      expect(t.description).toMatch(t.readOnly ? /Read only|You cannot approve|Takes no arguments/ : /Nothing is paid.*You cannot approve/);
    });

    it(`${t.name}: a closed input schema, every property described with examples the schema and the server both accept`, () => {
      const s = t.inputSchema as unknown as Schema;
      expect(s.type).toBe("object");
      expect(s.additionalProperties).toBe(false);
      for (const r of s.required) expect(Object.keys(s.properties)).toContain(r);
      const ajv = new Ajv({ strict: false, allErrors: true });
      const validate = ajv.compile(s);
      for (const [name, p] of Object.entries(s.properties)) {
        expect({ name, described: (p.description ?? "").length > 10 }).toEqual({ name, described: true });
        // A cursor is opaque: an example only where its shape is plain. Everything else has at least one.
        if (name !== "cursor") expect({ name, examples: Array.isArray(p.examples) && p.examples.length > 0 }).toEqual({ name, examples: true });
        for (const ex of p.examples ?? []) {
          const args = { ...Object.fromEntries(s.required.map((r) => [r, s.properties[r]!.examples![0]])), [name]: ex };
          expect({ name, ex, schema: validate(args) ? null : ajv.errorsText(validate.errors) }).toEqual({ name, ex, schema: null });
          expect({ name, ex, server: t.args.safeParse(args).success }).toEqual({ name, ex, server: true });
        }
      }
      // An argument the schema does not name is refused by both.
      const extra = { ...Object.fromEntries(s.required.map((r) => [r, s.properties[r]!.examples![0]])), approve: true };
      expect(validate(extra)).toBe(false);
      expect(t.args.safeParse(extra).success).toBe(false);
    });

    it(`${t.name}: annotations that say what it does`, () => {
      const a = annotationsOf(t);
      expect(a).toEqual({ title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false });
      expect(t.outputSchema).toMatchObject({ type: "object" });
    });
  }

  it("only propose_invoice_payment is not read-only, and only a token made to propose has it", () => {
    expect(ALL.filter((t) => !t.readOnly).map((t) => t.name)).toEqual(["propose_invoice_payment"]);
    expect(READS.every((t) => t.readOnly)).toBe(true);
    // No tool, for any token, is named for approving, paying, changing a limit or writing.
    expect(ALL.map((t) => t.name).filter((n) => /^(approve|pay|make|execute|sign|write|update|delete|create|transfer|refund|set|raise|change)(_|$)|(^|_)approve(_|$)|limit/.test(n))).toEqual([]);
  });

  it("each prompt asks only for tools that exist, and names its arguments", () => {
    const names = new Set(ALL.map((t) => t.name));
    for (const p of PROMPTS) {
      const text = p.text(Object.fromEntries(p.arguments.map((a) => [a.name, "AP-0004"])));
      const asked = [...text.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]!).filter((w) => /^(company|list|get|books|agent|what|cash|pending|cfo|spend|vat|payment|explain)_/.test(w));
      expect(asked.length).toBeGreaterThan(0);
      for (const n of asked) expect({ prompt: p.name, tool: n, exists: names.has(n) }).toEqual({ prompt: p.name, tool: n, exists: true });
      for (const a of p.arguments) expect(a.description.length).toBeGreaterThan(10);
    }
  });

  it("the error codes are one list, each with what it means", () => {
    for (const [k, v] of Object.entries(ERROR_CODES)) {
      expect(k).toMatch(/^[a-z_]+$/);
      expect(v.length).toBeGreaterThan(20);
    }
  });

  it("the connection resource states the safety model for every kind of token", () => {
    for (const [demo, can] of [[true, false], [false, false], [false, true]] as const) {
      const md = connectionMarkdown("Acme", demo, can);
      expect(md).toMatch(/What no AI can do here, for any token/);
      expect(md).toMatch(/approve a payment/);
      expect(md).toMatch(/CFO's passkey \(Face ID\)/);
      expect(md).toMatch(can ? /may propose an invoice's payment/ : /It cannot propose anything/);
      if (demo) expect(md).toMatch(/demo company: made-up data/);
    }
  });
});

let c: TestCloud;
let A: TestTenant;
let reader: string, proposer: string;
const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) =>
  (await c.req("POST", "/mcp", { key: token, body: { jsonrpc: "2.0", id: 1, method, params }, headers: { accept: "application/json, text/event-stream", origin: "null-omit" } })).json as { result?: any; error?: { code: number; message: string; data: { code: string } & Record<string, unknown> } };
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => rpc(token, "tools/call", { name, arguments: args });
/** A tool's refusal, as the server shapes every one: the sentence, then {"error":{"code","message"}} as JSON. */
function toolError(r: { result?: any }): { code: string; message: string; next?: string; next_tool?: string } {
  const res = r.result as { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: unknown };
  expect(res.isError).toBe(true);
  expect(res.structuredContent).toBeUndefined();
  expect(res.content.map((x) => x.type)).toEqual(["text", "text"]);
  const e = (JSON.parse(res.content[1]!.text) as { error: { code: string; message: string } }).error;
  expect(e.message).toBe(res.content[0]!.text);
  expect(Object.keys(ERROR_CODES)).toContain(e.code);
  return e;
}

beforeAll(async () => {
  c = testCloud({ engine: true });
  A = await c.tenant("contract");
  reader = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "reads" } })).json.token as string;
  proposer = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "proposes", propose: true } })).json.token as string;
  const up = await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
  expect(up.status).toBe(200);
});
afterAll(() => c.close());

describe("the server lists what the code declares", () => {
  it("tools/list gives each tool its schema and annotations exactly, for each kind of token", async () => {
    for (const [tok, want] of [[DEMO_CONNECTOR_TOKEN, READS], [reader, READS], [proposer, ALL]] as const) {
      const tools = (await rpc(tok, "tools/list")).result.tools as { name: string; inputSchema: unknown; annotations: unknown; description: string }[];
      expect(tools.map((t) => t.name)).toEqual(want.map((t) => t.name));
      for (const t of tools) {
        const own = want.find((x) => x.name === t.name)!;
        expect({ n: t.name, schema: t.inputSchema, ann: t.annotations, d: t.description }).toEqual({ n: t.name, schema: own.inputSchema, ann: annotationsOf(own), d: own.description });
      }
    }
  });

  it("purser://connection is listed first and says what this token can do", async () => {
    const first = (await rpc(reader, "resources/list")).result.resources[0];
    expect(first).toMatchObject({ uri: "purser://connection", mimeType: "text/markdown" });
    const read = async (tok: string) => (await rpc(tok, "resources/read", { uri: "purser://connection" })).result.contents[0].text as string;
    expect(await read(reader)).toMatch(/It cannot propose anything/);
    expect(await read(proposer)).toMatch(/may propose an invoice's payment/);
    expect(await read(DEMO_CONNECTOR_TOKEN)).toMatch(/demo company: made-up data/);
  });
});

describe("refusals: nothing approves, pays, changes a limit or writes, for any token", () => {
  const WRITES = ["approve_payment", "approve_proposal", "pay_invoice", "pay", "make_payment", "execute_payment", "transfer_funds", "send_payout", "sign_terms",
    "set_card_limit", "raise_limit", "update_policy", "change_limit", "create_journal_entry", "post_ledger_entry", "write_books", "delete_invoice", "add_vendor", "reject_proposal", "release_payment"];

  it("refuses every write or pay attempt with not_available_over_mcp and says the CFO's passkey is needed", async () => {
    for (const tok of [DEMO_CONNECTOR_TOKEN, reader, proposer]) {
      for (const name of WRITES) {
        const r = await call(tok, name, { invoice_id: "AP-0001", proposal_id: "P-0001", amount: "1.00" });
        expect({ name, code: r.error?.code, why: r.error?.data.code, tool: r.error?.data.tool }).toEqual({ name, code: -32602, why: "not_available_over_mcp", tool: name });
        expect(r.error!.message).toContain(NEVER_SENTENCE);
        expect(r.result).toBeUndefined();
      }
    }
  });

  it("an unknown read is unknown_tool; proposing with a reading token is needs_propose_token", async () => {
    expect((await call(reader, "list_suppliers")).error).toMatchObject({ code: -32602, data: { code: "unknown_tool", tool: "list_suppliers" } });
    for (const tok of [DEMO_CONNECTOR_TOKEN, reader]) {
      for (const name of ["propose_invoice_payment", "payment_proposal"]) {
        const r = await call(tok, name, { invoice_id: "AP-0001", proposal_id: "P-0001" });
        expect({ name, why: r.error?.data.code, msg: /this token reads only/.test(r.error?.message ?? "") }).toEqual({ name, why: "needs_propose_token", msg: true });
      }
    }
  });

  it("an argument that tries to approve, or any argument the schema does not name, is invalid_arguments, for every tool", async () => {
    for (const t of ALL) {
      const s = t.inputSchema as unknown as Schema;
      const args = { ...Object.fromEntries(s.required.map((r) => [r, s.properties[r]!.examples![0]])), approve: true, pay: true };
      const e = toolError(await call(proposer, t.name, args));
      expect({ t: t.name, code: e.code, msg: /The arguments do not fit/.test(e.message), next: !!e.next }).toEqual({ t: t.name, code: "invalid_arguments", msg: true, next: true });
    }
  });

  it("a proposal pays nothing; filing it twice is refused; a missing invoice is not_found; the demo proposes nothing", async () => {
    const first = await call(proposer, "propose_invoice_payment", { invoice_id: "AP-0001" });
    expect(first.result.isError).toBeUndefined();
    expect(first.result.structuredContent.paid).toBe(false);
    const id = first.result.structuredContent.proposal.id as string;
    const twice = toolError(await call(proposer, "propose_invoice_payment", { invoice_id: "AP-0001" }));
    expect(twice).toMatchObject({ code: "refused", message: expect.stringMatching(/Nothing was proposed/) });
    expect(toolError(await call(proposer, "propose_invoice_payment", { invoice_id: "AP-0404" }))).toMatchObject({ code: "not_found", next_tool: "list_invoices" });
    expect(toolError(await call(proposer, "payment_proposal", { proposal_id: "P-9999" }))).toMatchObject({ code: "not_found" });
    // Still only waiting for the CFO: no MCP call approved or paid it.
    const held = await c.req("GET", `/v1/engine/proposals/${id}`, { key: A.session });
    expect((held.json.proposal as { status: string }).status).not.toMatch(/approved|executed|paid/);
    expect(JSON.stringify(first)).not.toMatch(/challenge/);
  });

  it("reads that find nothing say not_found and the tool to look with", async () => {
    expect(toolError(await call(DEMO_CONNECTOR_TOKEN, "get_invoice", { id: "AP-9999" }))).toMatchObject({ code: "not_found", next_tool: "list_invoices" });
    expect(toolError(await call(DEMO_CONNECTOR_TOKEN, "explain_payment", { id: "P-9999" }))).toMatchObject({ code: "not_found", next_tool: "list_transactions" });
    expect(toolError(await call(DEMO_CONNECTOR_TOKEN, "payment_audit_trail", { id: "AP-9999" }))).toMatchObject({ code: "not_found", next_tool: "list_transactions" });
  });

  it("protocol errors carry a code from the same list", async () => {
    expect((await rpc(reader, "prompts/get", { name: "nope" })).error!.data.code).toBe("unknown_prompt");
    expect((await rpc(reader, "prompts/get", { name: "explain_invoice", arguments: {} })).error!.data).toEqual({ code: "missing_argument", argument: "invoice_id" });
    expect((await rpc(reader, "resources/read", { uri: "purser://nope" })).error!.data).toMatchObject({ code: "resource_not_found", uri: "purser://nope" });
    expect((await rpc(reader, "tools/list", { cursor: "nope" })).error!.data.code).toBe("invalid_cursor");
    expect((await rpc(reader, "no/such")).error!.data.code).toBe("unknown_method");
    expect((await rpc(reader, "tools/call", {})).error!.data.code).toBe("missing_argument");
  });
});
