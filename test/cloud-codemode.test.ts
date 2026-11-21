// Code Mode for Purser's own read tools (docs/codemode.md, cloud/src/claude/codemode.ts, /mcp/codemode). It holds:
// the typed API is generated from the read tools only (never a tool that proposes, approves or pays) and is valid
// TypeScript; search answers the matching methods; the Dynamic Worker is started with no network, no env, no
// compatibility flag and Cloudflare's CPU and subrequest limits; the host's call function refuses anything off the
// allow-list, state-changing names, malformed or smuggled arguments, a call too many, an answer too large and a call
// after the run ended, whatever a compromised isolate sends; the isolate's answer is checked field by field (size,
// JSON, logs capped and redacted); a run that hangs is stopped; every run leaves one log line without the code or the
// data; and /mcp/codemode takes the connector tokens only (not the demo's public token, not a session), reads only the
// token's own company, and says when this deployment has no Worker Loader.
//
// The real isolate (Worker Loader in local workerd) is test/cloud-codemode-workerd.test.ts. Here the code runs in
// IN_PROCESS below: plain JavaScript in this test's own process, NOT a sandbox, only to drive the host's checks.
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";
import { apiDeclarations, checkAnswer, CODEMODE_LIMITS, hostCall, runCode, sandboxModules, SANDBOX_COMPATIBILITY_DATE, searchApi, taskBody, tsType, workerLoaderExecutor, type CallRecord, type CodeLoader, type CodeTool, type SandboxExecutor } from "../cloud/src/claude/codemode.js";
import { CODEMODE_TOOLS } from "../cloud/src/claude/codemodeMcp.js";
import { codeModeTools, toolsFor } from "../cloud/src/claude/mcp.js";
import { CODEMODE_MCP_PATH, CODEMODE_MCP_PER_MINUTE } from "../cloud/src/claude/routes.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

type CallFn = (name: unknown, argsJson: unknown) => Promise<string>;
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<unknown>;

/** The test's stand-in for the isolate: the same answer shape as the Dynamic Worker's main.js. NOT a sandbox. */
const IN_PROCESS: SandboxExecutor = {
  kind: "test-in-process",
  async run({ code, toolNames, call }) {
    const logs: string[] = [];
    const purser = Object.freeze(Object.fromEntries(toolNames.map((n) => [n, async (args?: unknown) => {
      const r = JSON.parse(await call(n, args === undefined ? "" : JSON.stringify(args))) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
      if (!r.ok) throw Object.assign(new Error(r.error!.message), { name: "PurserError", code: r.error!.code });
      return r.data;
    }])));
    try {
      const v = await new AsyncFunction("purser", "console", taskBody(code))(purser, { log: (...a: unknown[]) => logs.push(a.map(String).join(" ")) });
      return { ok: true, json: JSON.stringify(v ?? null), logs };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { ok: false, code: err.name === "PurserError" ? err.code : "code_threw", message: err.message, logs };
    }
  },
};
/** A compromised isolate: ignores the purser object and calls the host's function directly with whatever it likes. */
const direct = (fn: (call: CallFn) => Promise<unknown>): SandboxExecutor => ({ kind: "test-direct", run: async ({ call }) => ({ ok: true, json: JSON.stringify(await fn(call)), logs: [] }) });

const tools = codeModeTools();
const who = { tenant: "t_test", principal: "k_test" };

describe("the typed API", () => {
  it("comes from the read tools only: every /mcp read tool, none that proposes, approves or pays, even for a token made to propose", () => {
    const api = apiDeclarations(tools);
    const proposeTools = toolsFor({ purpose: "claude-propose" } as Parameters<typeof toolsFor>[0]).filter((t) => !t.readOnly);
    expect(proposeTools.map((t) => t.name)).toContain("propose_invoice_payment");
    for (const t of tools) expect(api, t.name).toContain(`  ${t.name}(`);
    for (const t of proposeTools) expect(api).not.toContain(t.name);
    expect(tools.every((t) => t.readOnly)).toBe(true);
    expect(api).not.toMatch(/\bapprove\s*\(|\bpay\s*\(/);
  });

  it("is valid TypeScript, with the arguments' and answers' types", () => {
    const api = apiDeclarations(tools);
    const sf = ts.createSourceFile("purser.d.ts", api, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    expect((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    expect(api).toMatch(/get_invoice\(args: \{[\s\S]*?id: string;[\s\S]*?\}\): Promise</);
    expect(api).toMatch(/list_invoices\(args\?: \{[\s\S]*?limit\?: number;/);
    expect(api).toMatch(/books_report\(args: \{[\s\S]*?report: "pnl" \| "balance" \| "trial" \| "vat" \| "payables" \| "receivables";/);
    expect(api).toContain("company_overview(): Promise<");
    expect(api).toContain("declare class PurserError extends Error");
  });

  it("JSON Schema to TypeScript: unions, nullable, arrays, open and closed objects; a description cannot close its comment", () => {
    expect(tsType({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
    expect(tsType({ type: ["string", "number"] })).toBe("string | number");
    expect(tsType({ type: "array", items: { anyOf: [{ type: "string" }, { type: "integer" }] } })).toBe("(string | number)[]");
    expect(tsType({ type: "object" })).toBe("Record<string, unknown>");
    expect(tsType({ type: "object", properties: { a: { type: "boolean" } }, additionalProperties: false })).toBe("{\n  a?: boolean;\n}");
    expect(tsType({ type: "object", properties: { "x-y": { type: "string" } }, required: ["x-y"] })).toContain('"x-y": string;');
    expect(tsType({ type: "object", properties: { a: { type: "string", description: "evil */ declare const x: 1; /*" } } })).not.toContain("evil */");
    expect(tsType(null)).toBe("unknown");
    expect(tsType({ type: "weird" })).toBe("unknown");
  });

  it("search: the methods every word matches, the whole API with no words, nothing for no match; it reads no data", () => {
    const inv = searchApi(tools, "invoice");
    expect(inv.tools).toEqual(expect.arrayContaining(["list_invoices", "get_invoice"]));
    expect(inv.api).toContain("get_invoice(");
    expect(inv.api).not.toContain("vat_summary(");
    expect(searchApi(tools, "").tools).toEqual(tools.map((t) => t.name));
    expect(searchApi(tools, "zebra quantum")).toMatchObject({ tools: [], api: "" });
    expect(searchApi(tools, "propose").tools).toEqual([]);
  });
});

describe("the isolate", () => {
  it("is a fresh Dynamic Worker with no network, no env, no compatibility flag, and Cloudflare's CPU and subrequest limits", async () => {
    const seen: Parameters<CodeLoader["load"]>[0][] = [];
    let disposed = 0;
    const loader: CodeLoader = { load: (code) => { seen.push(code); return { getEntrypoint: () => ({ evaluate: async (call: CallFn) => ({ ok: true, json: JSON.stringify(typeof call), logs: [] }), [Symbol.dispose]: () => { disposed++; } }), [Symbol.dispose]: () => { disposed++; } }; } };
    const ex = workerLoaderExecutor(loader);
    expect(ex.kind).toBe("worker-loader");
    const r = await runCode({ tools, ctx: {} as never, code: "return 1", executor: ex, who, log: () => undefined });
    expect(r).toMatchObject({ ok: true, result: "function", sandbox: "worker-loader" });
    await runCode({ tools, ctx: {} as never, code: "return 2", executor: ex, who, log: () => undefined });
    expect(seen).toHaveLength(2);
    expect(disposed).toBe(4);
    for (const s of seen) {
      expect(s).toMatchObject({ compatibilityDate: SANDBOX_COMPATIBILITY_DATE, compatibilityFlags: [], mainModule: "main.js", env: {}, globalOutbound: null, limits: { cpuMs: CODEMODE_LIMITS.cpuMs, subRequests: CODEMODE_LIMITS.subRequests } });
      expect(Object.keys(s.modules).sort()).toEqual(["main.js", "task.js"]);
    }
    expect(seen[0]!.globalOutbound).toBeNull();
  });

  it("its modules name only the allowed tools and carry no secret; the code is the task's body", () => {
    const m = sandboxModules("return 42", tools.map((t) => t.name));
    expect(m["main.js"]).toContain(JSON.stringify(tools.map((t) => t.name)));
    expect(m["main.js"]).not.toMatch(/propose|approve|secret|token|env\./i);
    expect(m["task.js"]).toBe("export default async function task(purser, PurserError) {\nreturn 42\n}\n");
    expect(taskBody("async () => { return 1; }")).toBe("return await (async () => { return 1; })();");
    expect(taskBody("async function main() { return 1 }")).toBe("return await (async function main() { return 1 })();");
    expect(taskBody("const a = 1; return a")).toBe("const a = 1; return a");
  });
});

describe("the host's call function, whatever the isolate sends", () => {
  const books = { calls: 0 };
  const fake: CodeTool<{ tenant: string }>[] = [
    { name: "get_invoice", title: "One", description: "d", readOnly: true, inputSchema: { type: "object" }, outputSchema: { type: "object" },
      args: (codeModeTools().find((t) => t.name === "get_invoice")!.args), run: async (c, a) => { books.calls++; return a.id === `${c.tenant}-1` ? { content: [{ type: "text", text: "ok" }], structuredContent: { id: a.id } } : { content: [{ type: "text", text: "no such invoice" }, { type: "text", text: JSON.stringify({ error: { code: "not_found", message: "no" } }) }], isError: true }; } },
    { name: "huge", title: "Huge", description: "d", readOnly: true, inputSchema: { type: "object" }, outputSchema: { type: "object" }, args: tools.find((t) => t.name === "company_overview")!.args,
      run: async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { x: "y".repeat(CODEMODE_LIMITS.answerBytes) } }) },
    { name: "boom", title: "Boom", description: "d", readOnly: true, inputSchema: { type: "object" }, outputSchema: { type: "object" }, args: tools.find((t) => t.name === "company_overview")!.args,
      run: async () => { throw new Error("db password=hunter2 failed"); } },
    { name: "propose_invoice_payment", title: "P", description: "d", readOnly: false, inputSchema: { type: "object" }, outputSchema: { type: "object" }, args: tools[0]!.args, run: async () => { throw new Error("must never run"); } },
    { name: "proposed_by_mistake", title: "P", description: "d", readOnly: true, inputSchema: { type: "object" }, outputSchema: { type: "object" }, args: tools[0]!.args, run: async () => { throw new Error("must never run"); } },
  ];
  const budget = () => ({ calls: 0, bytes: 0, closed: false, records: [] as CallRecord[] });
  const send = async (call: CallFn, name: unknown, args?: unknown) => JSON.parse(await call(name, args)) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };

  it("refuses names off the allow-list, state-changing names, and names that are not names, before any tool runs", async () => {
    const call = hostCall(fake, { tenant: "A" }, budget(), () => 0, () => false);
    for (const n of ["propose_invoice_payment", "approve_payment", "pay_invoice", "set_limit", "payment_proposal"]) expect((await send(call, n, "{}")).error!.code, n).toBe("not_available_in_code_mode");
    for (const n of ["constructor", "__proto__", "toString", "hasOwnProperty", "proposed_by_mistake", "GET_INVOICE", "get_invoice ", "../get_invoice", "", 42, null, { name: "get_invoice" }]) expect((await send(call, n, "{}")).error!.code, String(n)).toBe("unknown_tool");
    expect(books.calls).toBe(0);
  });

  it("refuses arguments that are not one object, that smuggle a prototype or a company, or that are too long", async () => {
    const call = hostCall(fake, { tenant: "A" }, budget(), () => 0, () => false);
    for (const a of ["[]", "1", "null", "\"x\"", "{nope", 7, "x".repeat(CODEMODE_LIMITS.argsChars + 1)]) expect((await send(call, "get_invoice", a)).error!.code, String(a).slice(0, 20)).toBe("invalid_arguments");
    expect((await send(call, "get_invoice", JSON.stringify({ id: "A-1", tenant: "B" }))).error!.code).toBe("invalid_arguments");
    expect((await send(call, "get_invoice", '{"__proto__":{"polluted":1},"id":"A-1"}')).error!.code).toBe("invalid_arguments");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(books.calls).toBe(0);
    expect(await send(call, "get_invoice", JSON.stringify({ id: "A-1" }))).toEqual({ ok: true, data: { id: "A-1" } });
  });

  it("answers only from the caller's company: another's id is not found", async () => {
    const asA = hostCall(fake, { tenant: "A" }, budget(), () => 0, () => false);
    expect((await send(asA, "get_invoice", JSON.stringify({ id: "B-1" }))).error!.code).toBe("not_found");
    const asB = hostCall(fake, { tenant: "B" }, budget(), () => 0, () => false);
    expect(await send(asB, "get_invoice", JSON.stringify({ id: "B-1" }))).toEqual({ ok: true, data: { id: "B-1" } });
  });

  it("a call too many, an answer too large, a tool that fails (without its details), a call after the run ended", async () => {
    const b = budget();
    const call = hostCall(fake, { tenant: "A" }, b, () => 0, () => false);
    expect((await send(call, "huge", "")).error!.code).toBe("answer_too_large");
    const boom = await send(call, "boom", "");
    expect(boom.error!.code).toBe("tool_failed");
    expect(JSON.stringify(boom)).not.toContain("hunter2");
    for (let i = b.calls; i < CODEMODE_LIMITS.toolCalls; i++) await send(call, "get_invoice", JSON.stringify({ id: "A-1" }));
    expect((await send(call, "get_invoice", JSON.stringify({ id: "A-1" }))).error!.code).toBe("too_many_calls");
    const late = budget();
    const lateCall = hostCall(fake, { tenant: "A" }, late, () => 0, () => false);
    late.closed = true;
    expect((await send(lateCall, "get_invoice", JSON.stringify({ id: "A-1" }))).error!.code).toBe("late_call");
  });

  it("a compromised isolate calling the host directly gets the same refusals in a whole run", async () => {
    const r = await runCode({ tools: fake, ctx: { tenant: "A" }, who, log: () => undefined, code: "x",
      executor: direct(async (call) => Promise.all(["propose_invoice_payment", "constructor", "get_invoice"].map(async (n) => JSON.parse(await call(n, JSON.stringify({ id: "B-1" }))) as unknown))) });
    expect(r.ok).toBe(true);
    expect((r.result as { error?: { code: string } }[]).map((x) => x.error?.code)).toEqual(["not_available_in_code_mode", "unknown_tool", "not_found"]);
    expect(r.calls.map((x) => x.outcome)).toEqual(["not_available_in_code_mode", "unknown_tool", "not_found"]);
  });
});

describe("a run's answer and its failures", () => {
  it("the isolate's answer is checked: its size, its JSON, its logs (capped and redacted)", () => {
    expect(checkAnswer({ ok: true, json: JSON.stringify("x".repeat(CODEMODE_LIMITS.outputBytes)) })).toMatchObject({ ok: false, error: { code: "output_too_large" } });
    expect(checkAnswer({ ok: true, json: "{not json" })).toMatchObject({ ok: false, error: { code: "result_not_json" } });
    expect(checkAnswer({ ok: true, json: { forged: true } })).toMatchObject({ ok: false, error: { code: "result_not_json" } });
    expect(checkAnswer({ ok: false, code: "made_up_code", message: 5 })).toMatchObject({ ok: false, error: { code: "code_threw" } });
    expect(checkAnswer("nonsense")).toMatchObject({ ok: false, error: { code: "sandbox_failed" } });
    expect(checkAnswer(null)).toMatchObject({ ok: false, error: { code: "sandbox_failed" } });
    const logs = checkAnswer({ ok: true, json: "1", logs: [...Array.from({ length: 100 }, (_, i) => `line ${i}`), 42, "Bearer pck_abcdefghijk"] }).logs;
    expect(logs).toHaveLength(CODEMODE_LIMITS.logLines);
    const red = checkAnswer({ ok: true, json: "1", logs: ["auth Bearer pck_abcdefghijklmnop", "y".repeat(1000)] }).logs;
    expect(red[0]).not.toContain("pck_abcdefghijklmnop");
    expect(red[1]!.length).toBe(CODEMODE_LIMITS.logLineChars);
  });

  it("no code, no sandbox, a sandbox that dies, a run that hangs: each says so, and nothing is read", async () => {
    const quiet = { tools, ctx: {} as never, who, log: () => undefined };
    for (const code of [undefined, "", "   ", 7, "x".repeat(CODEMODE_LIMITS.codeChars + 1)]) expect(await runCode({ ...quiet, code, executor: IN_PROCESS })).toMatchObject({ ok: false, error: { code: "invalid_code" } });
    expect(await runCode({ ...quiet, code: "return 1", executor: null })).toMatchObject({ ok: false, error: { code: "sandbox_unavailable" }, sandbox: "none" });
    const dies = (msg: string): SandboxExecutor => ({ kind: "x", run: async () => { throw new Error(msg); } });
    expect(await runCode({ ...quiet, code: "1", executor: dies("Worker exceeded CPU time limit.") })).toMatchObject({ error: { code: "sandbox_failed", message: "the isolate ran out of CPU time" } });
    expect(await runCode({ ...quiet, code: "1", executor: dies("Worker exceeded memory limit.") })).toMatchObject({ error: { code: "sandbox_failed", message: "the isolate ran out of memory" } });
    expect(await runCode({ ...quiet, code: "1", executor: dies("SyntaxError: Unexpected token '{'") })).toMatchObject({ error: { code: "code_threw" } });
    expect(await runCode({ ...quiet, code: "1", executor: dies("internal /secret/path") })).toMatchObject({ error: { code: "sandbox_failed", message: "the isolate stopped or could not load the code" } });
    vi.useFakeTimers();
    try {
      const hang = runCode({ ...quiet, code: "1", executor: { kind: "x", run: () => new Promise(() => undefined) } });
      await vi.advanceTimersByTimeAsync(CODEMODE_LIMITS.wallMs + 1);
      expect(await hang).toMatchObject({ ok: false, error: { code: "timeout" } });
      // A test may ask for a shorter limit, never a longer one.
      const longer = runCode({ ...quiet, code: "1", wallMs: CODEMODE_LIMITS.wallMs * 10, executor: { kind: "x", run: () => new Promise(() => undefined) } });
      await vi.advanceTimersByTimeAsync(CODEMODE_LIMITS.wallMs + 1);
      expect(await longer).toMatchObject({ error: { code: "timeout" } });
    } finally { vi.useRealTimers(); }
  });

  it("one log line per run: tools, calls, outcome, the code's hash; never the code, its arguments or the answers", async () => {
    const lines: Record<string, unknown>[] = [];
    const fakeTool: CodeTool<null>[] = [{ name: "get_invoice", title: "x", description: "x", readOnly: true, inputSchema: { type: "object" }, outputSchema: { type: "object" }, args: tools.find((t) => t.name === "get_invoice")!.args,
      run: async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { vendor: "Bergtex GmbH", iban: "DE89370400440532013000" } }) }];
    const r = await runCode({ tools: fakeTool, ctx: null, who, executor: IN_PROCESS, code: "const SECRET_MARKER = 1; const a = await purser.get_invoice({ id: 'AP-0042' }); return a.vendor", log: (level, event, f) => { lines.push({ level, event, ...f }); } });
    expect(r).toMatchObject({ ok: true, result: "Bergtex GmbH" });
    expect(lines).toEqual([expect.objectContaining({ level: "info", event: "codemode.run", tenant: "t_test", principal: "k_test", sandbox: "test-in-process", calls: 1, tools: "get_invoice", refused: 0, outcome: "ok", code_chars: expect.any(Number), output_bytes: 14 })]);
    expect(lines[0]!.code_sha256).toMatch(/^[0-9a-f]{16}$/);
    for (const leak of ["SECRET_MARKER", "AP-0042", "Bergtex", "DE89"]) expect(JSON.stringify(lines)).not.toContain(leak);
  });
});

describe("POST /mcp/codemode", () => {
  let c: TestCloud;
  let A: TestTenant, B: TestTenant;
  let readerA: string, proposerA: string, readerB: string;
  const rpc = async (token: string | null, method: string, params: Record<string, unknown> = {}) =>
    c.req("POST", CODEMODE_MCP_PATH, { key: token, body: { jsonrpc: "2.0", id: 3, method, params }, headers: { accept: "application/json, text/event-stream", origin: "null-omit" } });
  const exec = async (token: string, code: string) => {
    const r = await rpc(token, "tools/call", { name: "execute", arguments: { code } });
    expect(r.status).toBe(200);
    const res = (r.json as { result: { content: { text: string }[]; isError?: boolean } }).result;
    return { isError: !!res.isError, run: JSON.parse(res.content[0]!.text) as { ok: boolean; result?: unknown; error?: { code: string; message: string }; calls: { tool: string; outcome: string }[] } };
  };

  beforeAll(async () => {
    c = testCloud();
    A = await c.tenant("northwind");
    B = await c.tenant("otherco");
    readerA = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "Claude (code)" } })).json.token as string;
    proposerA = (await c.req("POST", "/v1/claude/connectors", { key: A.session, body: { name: "Claude (proposes)", propose: true } })).json.token as string;
    readerB = (await c.req("POST", "/v1/claude/connectors", { key: B.session, body: { name: "Claude (B)" } })).json.token as string;
    // Each company's books (test data): A has AP-0001, B has AP-0007.
    const inv = async (tenant: string, id: string, vendor: string, total: string) => {
      const body = { id, vendor, invoice_no: `${id}-N`, currency: "EUR", total, due_date: "2026-11-25", status: "waiting_cfo", proposal_id: null };
      const row: Record<string, string | number | null> = { tenant_id: tenant, id, vendor, invoice_no: body.invoice_no, due_date: body.due_date, currency: "EUR", total, status: "waiting_cfo", doc_sha256: "0".repeat(64),
        received_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", version: 1, body_json: JSON.stringify(body), body_sha256: "1".repeat(64) };
      const keys = Object.keys(row);
      await c.env.sql.run(`INSERT INTO invoices (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]!));
    };
    await inv(A.id, "AP-0001", "Bergtex", "1850.00");
    await inv(B.id, "AP-0007", "Other Co", "999.00");
    c.env.codemode = IN_PROCESS;
  });
  afterAll(() => c.close());

  it("speaks MCP with two tools, search and execute, both read only", async () => {
    const init = await rpc(readerA, "initialize", { protocolVersion: "2025-06-18" });
    expect(init.json).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "purser-codemode" } } });
    expect(String((init.json.result as { instructions: string }).instructions)).toMatch(/Code Mode.*Face ID/);
    const list = await rpc(readerA, "tools/list");
    expect((list.json.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools.map((t) => [t.name, t.annotations.readOnlyHint])).toEqual([["search", true], ["execute", true]]);
    expect(CODEMODE_TOOLS.map((t) => t.name)).toEqual(["search", "execute"]);
    expect((await rpc(readerA, "ping")).json.result).toEqual({});
    const unknown = await rpc(readerA, "tools/call", { name: "propose_invoice_payment", arguments: {} });
    expect(unknown.json).toMatchObject({ error: { code: -32602 } });
    expect(JSON.stringify(unknown.json)).toMatch(/passkey/);
  });

  it("search gives the typed API; execute runs code against this company's books", async () => {
    const s = await rpc(readerA, "tools/call", { name: "search", arguments: { query: "invoices" } });
    const found = JSON.parse((s.json.result as { content: { text: string }[] }).content[0]!.text) as { tools: string[]; api: string };
    expect(found.tools).toContain("list_invoices");
    expect(found.api).toContain("declare const purser");
    const r = await exec(readerA, "const p = await purser.list_invoices({ limit: 100 }); return { n: p.items.length, ids: p.items.map((i) => i.id) }");
    expect(r.isError).toBe(false);
    expect(r.run).toMatchObject({ ok: true, result: { n: 1, ids: ["AP-0001"] } });
    const one = await exec(readerA, "const i = await purser.get_invoice({ id: 'AP-0001' }); return { vendor: i.invoice.vendor, total: i.invoice.total }");
    expect(one.run).toMatchObject({ ok: true, result: { total: expect.any(String) } });
  });

  it("another company's token cannot read this company's invoice, and no argument names a company", async () => {
    expect((await exec(readerB, "return (await purser.list_invoices()).items.map((i) => i.id)")).run).toMatchObject({ ok: true, result: ["AP-0007"] });
    expect((await exec(readerA, "return (await purser.list_invoices()).items.map((i) => i.id)")).run).toMatchObject({ ok: true, result: ["AP-0001"] });
    expect((await exec(readerB, "return await purser.get_invoice({ id: 'AP-0001' })")).run).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await exec(readerB, `return await purser.list_invoices({ tenant: "${A.id}" })`)).run).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
  });

  it("a token made to propose still only reads here: proposing from code is not offered", async () => {
    const r = await exec(proposerA, "return Object.keys(purser)");
    expect(r.run.result).not.toContain("propose_invoice_payment");
    expect(r.run.result).toEqual(codeModeTools().map((t) => t.name));
    expect((await exec(proposerA, "return await purser.propose_invoice_payment({ invoice_id: 'AP-0001' })")).run).toMatchObject({ ok: false, error: { code: "code_threw" } });
    // Nothing changed in the books.
    expect(await c.env.sql.first("SELECT status, version FROM invoices WHERE tenant_id = ? AND id = 'AP-0001'", [A.id])).toEqual({ status: "waiting_cfo", version: 1 });
  });

  it("without a Worker Loader, execute says so and reads nothing; search still answers", async () => {
    const keep = c.env.codemode;
    c.env.codemode = undefined;
    try {
      const r = await exec(readerA, "return await purser.list_invoices()");
      expect(r).toMatchObject({ isError: true, run: { ok: false, error: { code: "sandbox_unavailable" }, calls: [] } });
      expect((await rpc(readerA, "tools/call", { name: "search", arguments: {} })).status).toBe(200);
    } finally { c.env.codemode = keep; }
  });

  it("takes the connector tokens only: not the demo's public token, not a session or an API key, not anonymous", async () => {
    expect((await rpc(DEMO_CONNECTOR_TOKEN, "tools/list")).status).toBe(403);
    expect((await rpc(A.session, "tools/list")).status).toBe(403);
    expect((await rpc(A.key, "tools/list")).status).toBe(403);
    expect((await rpc(null, "tools/list")).status).toBe(401);
    expect((await c.req("GET", "/v1/invoices", { key: readerA })).status).toBe(403);
  });

  it("the arguments are checked; a bad body is refused; a notification is taken", async () => {
    const bad = await rpc(readerA, "tools/call", { name: "execute", arguments: { code: "return 1", tenant: "x" } });
    expect((bad.json.result as { isError: boolean }).isError).toBe(true);
    const bad2 = await rpc(readerA, "tools/call", { name: "search", arguments: { query: 5 } });
    expect((bad2.json.result as { isError: boolean }).isError).toBe(true);
    expect((await c.req("POST", CODEMODE_MCP_PATH, { key: readerA, body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { origin: "null-omit" } })).status).toBe(202);
    expect(CODEMODE_MCP_PER_MINUTE).toBeGreaterThan(0);
  });
});
