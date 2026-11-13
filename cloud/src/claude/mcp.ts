// Connect Claude: Purser as a remote MCP server (POST /mcp, Streamable HTTP, stateless, JSON answers). Claude (claude.ai
// as a custom connector, Claude Desktop, Claude Code) reads the company's books and, with a token that allows it,
// PROPOSES an invoice's payment. Nothing here approves, pays, changes a limit or writes to the books: every payment
// still waits for the CFO's passkey (Face ID) in Purser Cloud, and that approval is a WebAuthn signature over the
// payment's exact terms, which no token can make.
//
// The protocol is small enough to answer here without the SDK's transport (nothing new in the Worker's bundle):
// initialize, ping, tools/list and tools/call, one JSON-RPC message or a batch per POST; notifications are taken with
// 202. No session is kept (no Mcp-Session-Id): every request carries its token and is checked as any API call is.

import { z } from "zod";
import type { Caller } from "../auth.js";
import { dashboard, feedLine } from "../dashboard.js";
import { insights, listInvoices, listTransactions, oneInvoice, report } from "../read.js";
import type { TenantDb } from "../tenant.js";
import type { EngineApi } from "../engine/api.js";

/** The protocol versions this server speaks, newest first; an unknown version asked for gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface McpCtx {
  caller: Caller;
  db: TenantDb;
  now: Date;
  company: string;
  engine: EngineApi | null;
  demo: boolean;
}

type Json = Record<string, unknown>;
interface ToolResult { content: { type: "text"; text: string }[]; structuredContent?: Json; isError?: boolean }
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  args: z.ZodType<Json>;
  readOnly: boolean;
  run(ctx: McpCtx, args: Json): Promise<ToolResult>;
}

const answer = (sentence: string, data: Json): ToolResult => ({ content: [{ type: "text", text: `${sentence}\n\n${JSON.stringify(data)}` }], structuredContent: data });
const refuse = (sentence: string): ToolResult => ({ content: [{ type: "text", text: sentence }], isError: true });
const params = (o: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q;
};

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as YYYY-MM-DD");
const ID = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/, "an id as Purser shows it, like AP-0004");
const LIMIT = z.number().int().min(1).max(100);
const dayProp = (what: string) => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: what });
const limitProp = { type: "integer", minimum: 1, maximum: 100, description: "How many at most (default 25)" };
const cursorProp = { type: "string", description: "The next_cursor of the previous page, to read on" };
const obj = (properties: Json, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const READ_TOOLS: Tool[] = [
  {
    name: "company_overview",
    title: "Company overview",
    description: "The company's start screen in one answer: money in and out and net cash day by day, spend by who started it (each agent's own card, supplier invoices the CFO approved), payments per week by how each was allowed, invoices by state, and the newest decisions in words. Every figure is counted from the company's own records.",
    inputSchema: obj({}),
    args: z.object({}).strict(),
    readOnly: true,
    run: async (c) => answer(`${c.company}: the overview, counted from its own records.`, (await dashboard(c.db)) as Json),
  },
  {
    name: "list_invoices",
    title: "Supplier invoices",
    description: "The company's supplier invoices, newest first: supplier, number, amount, due day and status (for example waiting_cfo: filed for the CFO's Face ID; needs_vendor: the supplier is new; paid). Filter by status and due days.",
    inputSchema: obj({ status: { type: "string", description: "Only this status, e.g. waiting_cfo, needs_vendor, paid" }, due_from: dayProp("Due on or after this day"), due_to: dayProp("Due on or before this day"), limit: limitProp, cursor: cursorProp }),
    args: z.object({ status: z.string().max(40).optional(), due_from: DAY.optional(), due_to: DAY.optional(), limit: LIMIT.optional(), cursor: z.string().max(200).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const page = await listInvoices(c.db, params({ ...a, limit: a.limit ?? 25 })) as { items: unknown[]; next_cursor: string | null };
      return answer(`${page.items.length} invoice(s)${page.next_cursor ? "; more with the next_cursor" : ""}.`, page as unknown as Json);
    },
  },
  {
    name: "get_invoice",
    title: "One invoice",
    description: "One supplier invoice by its id (like AP-0004), with what Purser read from it, its checks and its earlier versions.",
    inputSchema: obj({ id: { type: "string", description: "The invoice's id, like AP-0004" } }, ["id"]),
    args: z.object({ id: ID }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const inv = await oneInvoice(c.db, a.id as string);
      return inv ? answer(`Invoice ${String(a.id)}.`, { invoice: inv }) : refuse(`There is no invoice ${String(a.id)} in ${c.company}'s books.`);
    },
  },
  {
    name: "list_transactions",
    title: "Money movements",
    description: "The transactions register: every money movement on every rail (bank transfer, card, stablecoin), newest first, with its approval, booking and proof. Filter by rail, currency and days.",
    inputSchema: obj({ rail: { type: "string", description: "Only this rail" }, currency: { type: "string", description: "Only this currency, like EUR" }, from: dayProp("From this day"), to: dayProp("Up to this day"), limit: limitProp, cursor: cursorProp }),
    args: z.object({ rail: z.string().max(40).optional(), currency: z.string().regex(/^[A-Z]{3,5}$/).optional(), from: DAY.optional(), to: DAY.optional(), limit: LIMIT.optional(), cursor: z.string().max(200).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const page = await listTransactions(c.db, params({ ...a, limit: a.limit ?? 25 })) as { items: unknown[]; next_cursor: string | null };
      return answer(`${page.items.length} movement(s)${page.next_cursor ? "; more with the next_cursor" : ""}.`, page as unknown as Json);
    },
  },
  {
    name: "books_report",
    title: "The books",
    description: "A report computed from the ledger: pnl (profit and loss), balance (balance sheet), trial (trial balance), vat (a quarter's VAT, e.g. quarter 2026Q4), payables or receivables.",
    inputSchema: obj({ report: { type: "string", enum: ["pnl", "balance", "trial", "vat", "payables", "receivables"] }, quarter: { type: "string", pattern: "^\\d{4}Q[1-4]$", description: "For vat: the quarter, like 2026Q4" } }, ["report"]),
    args: z.object({ report: z.enum(["pnl", "balance", "trial", "vat", "payables", "receivables"]), quarter: z.string().regex(/^\d{4}Q[1-4]$/).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => answer(`${c.company}: ${String(a.report)}, from the ledger.`, { report: a.report, ...(await report(c.db, a.report as string, params({ quarter: a.quarter }))) as Json }),
  },
  {
    name: "agent_decisions",
    title: "What the agents decided",
    description: "The newest decisions in the company's audit trail, in words, newest first: who decided (an agent, the CFO, or Purser's code), what, and when. A decision code made when no model answered says so; it is never called Claude's.",
    inputSchema: obj({ limit: limitProp }),
    args: z.object({ limit: LIMIT.optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const rows = await c.db.select<{ seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }>("audit_rows", {}, { order: ["seq"] });
      const items = rows.map(feedLine).filter((x) => x !== null).reverse().slice(0, (a.limit as number | undefined) ?? 25);
      return answer(`${items.length} decision(s), newest first.`, { items });
    },
  },
  {
    name: "what_needs_attention",
    title: "What needs attention",
    description: "Payables at a glance: what is open, due within 7 and 30 days, overdue, waiting for the CFO or a new supplier, blocked, and spend per supplier.",
    inputSchema: obj({}),
    args: z.object({}).strict(),
    readOnly: true,
    run: async (c) => answer(`${c.company}: what is open, due and waiting.`, (await insights(c.db, c.now)) as Json),
  },
];

/** Without the challenge a passkey signs: Claude needs the terms, never the means of approving them. */
const proposalOut = (p: { id: string; kind: string; status: string; terms_sha256: string; facts: [string, string][]; warnings: string[] }) =>
  ({ id: p.id, kind: p.kind, status: p.status, terms_sha256: p.terms_sha256, facts: p.facts, warnings: p.warnings });
const NO_ENGINE = "This company's payments are filed by Purser on the company's own computer (its runner), not in the cloud, so nothing was proposed. Ask your user to file it in Purser.";

const PROPOSE_TOOLS: Tool[] = [
  {
    name: "propose_invoice_payment",
    title: "Propose an invoice's payment",
    description: "File a supplier invoice's payment for the CFO's approval. Nothing is paid: the CFO approves the exact terms with Face ID in Purser Cloud, or it expires. Purser refuses an invoice that is held, already waiting or paid, and says why. You cannot approve.",
    inputSchema: obj({ invoice_id: { type: "string", description: "The invoice's id, like AP-0004 (list_invoices shows them)" } }, ["invoice_id"]),
    args: z.object({ invoice_id: ID }).strict(),
    readOnly: false,
    run: async (c, a) => {
      if (c.demo) return refuse("The demo company is read only: nothing can be proposed in it.");
      if (!c.engine) return refuse(NO_ENGINE);
      const id = a.invoice_id as string;
      if (!(await c.engine.invoice(id))) return refuse(`There is no invoice ${id} in ${c.company}'s Purser.`);
      const out = await c.engine.propose(id);
      if (!out.ok) return refuse(`Purser did not file ${id}: ${out.reason}. Nothing was proposed.`);
      return answer(`Filed ${out.proposal.id} for the CFO. Nothing is paid until the CFO approves these exact terms with Face ID in Purser Cloud; tell your user so.`,
        { proposal: proposalOut(out.proposal), paid: false, next: "The CFO approves or lets it expire in Purser Cloud (Invoices). Call payment_proposal to see its status." });
    },
  },
  {
    name: "payment_proposal",
    title: "A payment proposal's status",
    description: "Where a payment proposal stands: waiting for the CFO, approved and paid, refused or expired, with the terms it is for.",
    inputSchema: obj({ proposal_id: { type: "string", description: "The proposal's id, like P-0009" } }, ["proposal_id"]),
    args: z.object({ proposal_id: ID }).strict(),
    readOnly: true,
    run: async (c, a) => {
      if (!c.engine) return refuse(NO_ENGINE);
      const p = await c.engine.proposal(a.proposal_id as string);
      return p ? answer(`${p.id}: ${p.status}.`, { proposal: proposalOut(p) }) : refuse(`There is no proposal ${String(a.proposal_id)}.`);
    },
  },
];

/** The tools this caller's token gives: reading always; proposing only with a token made to propose, never in the demo. */
export function toolsFor(caller: Caller): Tool[] {
  return caller.purpose === "claude-propose" ? [...READ_TOOLS, ...PROPOSE_TOOLS] : READ_TOOLS;
}

function instructions(c: McpCtx): string {
  const can = c.caller.purpose === "claude-propose"
    ? "read the books and propose an invoice's payment for the CFO's approval"
    : "read the books";
  return [`You are connected to Purser for ${c.company}. You can ${can}.`,
    "You cannot approve, pay, change a limit or write to the books: every payment needs the CFO's Face ID in Purser Cloud, and you must say so when a payment comes up.",
    c.demo ? "This is the demo company: made-up data from a simulated month, no real money. Say so when you show its figures." : "Amounts are the company's own records; quote them as they are."].join(" ");
}

interface Rpc { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function one(c: McpCtx, m: Rpc): Promise<Json | null> {
  const isRequest = typeof m.method === "string" && (typeof m.id === "string" || typeof m.id === "number");
  if (typeof m.method === "string" && m.id === undefined) return null; // a notification: taken, no answer
  if (!isRequest) return m.method === undefined && ("result" in m || "error" in m) ? null : rpcError(m.id, -32600, "not a JSON-RPC request");
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  switch (m.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "purser", title: "Purser", version: "1.0.0" }, instructions: instructions(c) } };
    }
    case "ping": return { jsonrpc: "2.0", id: m.id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: m.id, result: { tools: toolsFor(c.caller).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false } })) } };
    case "tools/call": {
      const tool = toolsFor(c.caller).find((t) => t.name === p.name);
      if (!tool) return rpcError(m.id, -32602, `no tool ${String(p.name)}`);
      const args = tool.args.safeParse(p.arguments ?? {});
      if (!args.success) return { jsonrpc: "2.0", id: m.id, result: refuse(`The arguments do not fit: ${args.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ")}`) };
      return { jsonrpc: "2.0", id: m.id, result: await tool.run(c, args.data) };
    }
    default: return rpcError(m.id, -32601, `no method ${m.method}`);
  }
}

/** One POST to /mcp: a JSON-RPC message or a batch; 202 when it held only notifications or answers. */
export async function mcpAnswer(c: McpCtx, text: string): Promise<{ status: number; body: unknown }> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { status: 400, body: rpcError(null, -32700, "the body is not JSON") }; }
  const batch = Array.isArray(parsed);
  const msgs = (batch ? parsed : [parsed]) as Rpc[];
  if (!msgs.length || msgs.length > 20 || msgs.some((x) => !x || typeof x !== "object")) return { status: 400, body: rpcError(null, -32600, "one JSON-RPC message, or a batch of 1 to 20") };
  const out: Json[] = [];
  for (const m of msgs) { const r = await one(c, m); if (r) out.push(r); }
  if (!out.length) return { status: 202, body: null };
  return { status: 200, body: batch ? out : out[0] };
}
