// POST /mcp/codemode: Purser's own read tools in Code Mode (docs/codemode.md), a remote MCP server with two tools.
//   search:  the typed TypeScript API generated from Purser's read tools (all of it, or the methods a query matches).
//   execute: runs the model's code against that API in a fresh Cloudflare Dynamic Worker (./codemode.ts): no network,
//            no secret, only this company's books, read only, within limits; it returns only what the code returns.
// Streamable HTTP, JSON answers, no session; the same connector tokens as /mcp (./routes.ts), never the demo company's
// public token. Nothing here proposes, approves, pays or writes: every payment needs the CFO's passkey (Face ID).
import { BadRequest } from "../read.js";
import { CODEMODE_ERRORS, CODEMODE_LIMITS, runCode, searchApi, type SandboxExecutor } from "./codemode.js";
import { codeModeTools, LEGACY_VERSIONS, MODERN_VERSIONS, type McpCtx } from "./mcp.js";

export const CODEMODE_MCP_VERSION = "0.1.0";
type Json = Record<string, unknown>;

/** The two tools, as tools/list shows them. */
export const CODEMODE_TOOLS = [
  {
    name: "search",
    title: "Search Purser's typed read API",
    description: "Get the TypeScript declarations of Purser's read API for this company (invoices, money movements, the books and VAT, cash, approvals waiting for the CFO, the CFO's policy, agents' decisions, a payment's audit trail): `declare const purser: { list_invoices(args?: {...}): Promise<{...}>; ... }`. A few words narrow it to the matching methods; none gives the whole API. Calls nothing and reads no data.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200, description: "Words to look for in method names, descriptions and parameters (e.g. \"invoices due\"); empty gives the whole API" } }, additionalProperties: false },
    annotations: { title: "Search Purser's typed read API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "execute",
    title: "Run code against Purser's read API",
    description: `Run JavaScript against the API search shows: the body of an async function (or one \`async () => { ... }\`) that awaits purser.<method>(args) and returns plain JSON data, e.g. \`const p = await purser.list_invoices({ status: "waiting_cfo", limit: 100 }); return p.items.map((i) => ({ id: i.id, total: i.total }));\`. A refused call throws a PurserError with a code. It runs in an isolated Cloudflare Dynamic Worker: no network, no secrets, this company's books only, read only; at most ${CODEMODE_LIMITS.toolCalls} calls, ${CODEMODE_LIMITS.wallMs / 1000} s and ${CODEMODE_LIMITS.outputBytes} bytes of result. Nothing here proposes, approves or pays: the CFO approves every payment with Face ID in Purser Cloud.`,
    inputSchema: { type: "object", required: ["code"], additionalProperties: false, properties: { code: { type: "string", minLength: 1, maxLength: CODEMODE_LIMITS.codeChars, description: "The code: an async function's body that returns JSON data" } } },
    annotations: { title: "Run code against Purser's read API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

const instructions = (company: string) => `Purser's books for ${company}, read only, in Code Mode: call search for the typed API, then execute with code that calls purser.<method>(...) and returns only what you need. The code runs in an isolate with no network and no secrets. Nothing here can propose, approve, pay or change anything: every payment needs the CFO's Face ID in Purser Cloud; say so when a payment comes up.`;

export interface CodemodeMcpCtx { mcp: McpCtx; executor: SandboxExecutor | null }
export interface CodemodeMcpOut { status: number; body: unknown }

const text = (data: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(data) }], ...(isError ? { isError: true } : { structuredContent: data as Json }) });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function codemodeMcpAnswer(ctx: CodemodeMcpCtx, body: string): Promise<CodemodeMcpOut> {
  let m: Json;
  try { m = JSON.parse(body) as Json; } catch { return { status: 400, body: rpcError(null, -32700, "parse error: the body is not JSON") }; }
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string") return { status: 400, body: rpcError(m && !Array.isArray(m) ? m.id : null, -32600, "invalid request: one JSON-RPC 2.0 request per POST") };
  if (m.id === undefined) return { status: 202, body: null };
  const id = m.id;
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  const ok = (result: Json) => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
  const serverInfo = { name: "purser-codemode", title: "Purser: the books in Code Mode (read only)", version: CODEMODE_MCP_VERSION };
  const tools = codeModeTools();
  switch (m.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      const version = (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
      return ok({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo, instructions: instructions(ctx.mcp.company) });
    }
    case "server/discover": return ok({ supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities: { tools: { listChanged: false } }, serverInfo, instructions: instructions(ctx.mcp.company) });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: CODEMODE_TOOLS });
    case "tools/call": {
      const args = (p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {}) as Json;
      if (p.name === "search") {
        if (Object.keys(args).some((k) => k !== "query") || (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200))) return ok(text({ error: { code: "invalid_arguments", message: "search takes { query?: string of at most 200 characters }" } }, true));
        return ok(text({ company: ctx.mcp.company, ...(ctx.mcp.demo ? { demo: true } : {}), ...searchApi(tools, (args.query as string | undefined) ?? "") }));
      }
      if (p.name === "execute") {
        if (Object.keys(args).some((k) => k !== "code")) return ok(text({ error: { code: "invalid_code", message: "execute takes { code: string }" } }, true));
        const run = await runCode({ tools, ctx: ctx.mcp, code: args.code, executor: ctx.executor, who: { tenant: ctx.mcp.caller.tenantId, principal: ctx.mcp.caller.principal }, isBadRequest: (e) => e instanceof BadRequest });
        return ok(text(run, !run.ok));
      }
      const name = String(p.name).slice(0, 60);
      return { status: 200, body: rpcError(id, -32602, `no tool ${name}: this server has search and execute only. ${CODEMODE_ERRORS.not_available_in_code_mode}`) };
    }
    default: return { status: 200, body: rpcError(id, -32601, `method not found: ${String(m.method).slice(0, 60)}`) };
  }
}
