// POST /mcp/airwallex: the Airwallex sandbox, read only, as a remote MCP server in "Code Mode" style (docs/codemode.md).
// Two tools, search and execute (./awxCodemode.ts), instead of one tool per endpoint. Streamable HTTP, JSON answers, no
// session; the same connector tokens as /mcp (cloud/src/claude/routes.ts), never the demo company's public token.
// Nothing here can write: GET reads of the sandbox only, checked before anything is sent; money moves only through
// Purser's limits and the CFO's passkey (Face ID).
import { AwxReadRefused, MAX_CALLS, MAX_ITEMS, redact, runPlan, searchSpec, type AwxReadPort, type Plan } from "./awxCodemode.js";
import { LEGACY_VERSIONS, MODERN_VERSIONS } from "./mcp.js";

export const AWX_MCP_VERSION = "0.1.0";
type Json = Record<string, unknown>;

/** The two tools, as tools/list shows them (also what scripts/codemode-tokens.ts counts). */
export const AWX_CODEMODE_TOOLS = [
  {
    name: "search",
    title: "Search the Airwallex read API",
    description: "Search the read-only Airwallex sandbox API this server can call (an OpenAPI subset: balances, account details, financial transactions, FX rates and conversions, transfers, beneficiaries, cards). Give a few words (e.g. \"transfers status\"); get back the matching operations with method, path, parameters and response. No query lists every operation. Calls nothing.",
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200, description: "Words to look for in paths, summaries and parameters; empty lists all operations" } }, additionalProperties: false },
    annotations: { title: "Search the Airwallex read API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "execute",
    title: "Run a read plan against the Airwallex sandbox",
    description: `Run a plan of up to ${MAX_CALLS} GET calls against the Airwallex sandbox (test money) and get back only what you select. Each call: { method: "GET", path (from search, ids filled in), query?, select? (field paths to keep), where? ([{ field, equals }]), aggregate? ({ sum: field, group_by?: field }), limit? (default 50, max ${MAX_ITEMS}) }. Read only: any other method, path or host is refused and then no call is made. A declarative plan, not code. Payments happen only in Purser, with the CFO's Face ID.`,
    inputSchema: {
      type: "object", required: ["calls"], additionalProperties: false,
      properties: {
        calls: {
          type: "array", minItems: 1, maxItems: MAX_CALLS,
          items: {
            type: "object", required: ["method", "path"], additionalProperties: false,
            properties: {
              as: { type: "string", pattern: "^[A-Za-z0-9_-]{1,40}$", description: "A name for this call's result" },
              method: { type: "string", enum: ["GET"] },
              path: { type: "string", maxLength: 120, description: "An API path from search, e.g. /transfers or /transfers/{uuid}" },
              query: { type: "object", additionalProperties: { type: ["string", "number"] } },
              select: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
              where: { type: "array", maxItems: 5, items: { type: "object", required: ["field", "equals"], properties: { field: { type: "string", maxLength: 80 }, equals: { type: ["string", "number", "boolean", "null"] } }, additionalProperties: false } },
              aggregate: { type: "object", properties: { sum: { type: "string", maxLength: 80 }, group_by: { type: "string", maxLength: 80 } }, additionalProperties: false },
              limit: { type: "integer", minimum: 1, maximum: MAX_ITEMS },
            },
          },
        },
      },
    },
    annotations: { title: "Run a read plan against the Airwallex sandbox", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
] as const;

const INSTRUCTIONS = "Read-only Airwallex SANDBOX (test money). Use search to find an operation, then execute with a plan of GET calls; select only the fields you need. Nothing here can pay, convert, create or change anything: payments go through Purser, and anything over the CFO's limit needs the CFO's Face ID.";

export interface AwxMcpCtx { port: AwxReadPort | null }
export interface AwxMcpOut { status: number; body: unknown }

const text = (data: unknown, isError = false) => ({ content: [{ type: "text", text: redact(JSON.stringify(data)) }], ...(isError ? { isError: true } : {}) });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message: redact(message) } });

export async function awxMcpAnswer(ctx: AwxMcpCtx, body: string): Promise<AwxMcpOut> {
  let m: Json;
  try { m = JSON.parse(body) as Json; } catch { return { status: 400, body: rpcError(null, -32700, "parse error: the body is not JSON") }; }
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string") return { status: 400, body: rpcError(m && !Array.isArray(m) ? m.id : null, -32600, "invalid request: one JSON-RPC 2.0 request per POST") };
  if (m.id === undefined) return { status: 202, body: null };
  const id = m.id;
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  const ok = (result: Json) => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
  const serverInfo = { name: "purser-airwallex-read", title: "Purser: Airwallex sandbox (read only)", version: AWX_MCP_VERSION };
  switch (m.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      const version = (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
      return ok({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo, instructions: INSTRUCTIONS });
    }
    case "server/discover": return ok({ supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities: { tools: { listChanged: false } }, serverInfo, instructions: INSTRUCTIONS });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: AWX_CODEMODE_TOOLS });
    case "tools/call": {
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Json;
      if (p.name === "search") {
        if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200)) return ok(text({ error: "query must be a string of at most 200 characters" }, true));
        return ok(text(searchSpec(args.query as string | undefined)));
      }
      if (p.name === "execute") {
        try {
          return ok(text(await runPlan(ctx.port, args as unknown as Plan)));
        } catch (e) {
          if (e instanceof AwxReadRefused) return ok(text({ error: "refused", reason: e.reason, calls_made: 0 }, true));
          return ok(text({ error: "the plan could not be run" }, true));
        }
      }
      return { status: 200, body: rpcError(id, -32602, `no tool ${String(p.name).slice(0, 60)}: this server has search and execute only`) };
    }
    default: return { status: 200, body: rpcError(id, -32601, `method not found: ${String(m.method).slice(0, 60)}`) };
  }
}
