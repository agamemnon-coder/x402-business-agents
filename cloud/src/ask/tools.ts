// Ask Purser's tools (21 Nov): what the agent may read, and nothing else. Every one READS:
//   search_docs        more passages of Purser's public docs (the knowledge pack, ./pack.gen.ts)
//   the books          the MCP server's reading tools (../claude/mcp.ts READ_TOOLS: overview, invoices, payments, the
//                      books, VAT, cash, what waits for the CFO, the CFO's policy, spend, decisions, audit trails), run over
//                      the DEMO company only: made-up data from a simulated month, the same rows its console shows a guest
//   agents             the demo company's agents, their card limits and newest decisions (../consoleData.ts agentsOf)
//   run_records        the recorded runs the console's Tokenisation view shows (../consoleData.ts tokenisation)
// No tool pays, approves, proposes, changes a limit or writes: the MCP server's one proposing tool is not among them,
// the demo company is read only, and the public chat never reads a signed-in company. A result goes to Claude as text,
// clipped, numbered as a source the answer cites, and labelled as demo data.
import type { AskChunk } from "../../../src/ask/pack.js";
import { READ_TOOLS, type Tool as McpTool, type ToolResult } from "../claude/mcp.js";
import { agentsOf, tokenisation } from "../consoleData.js";
import { DEMO_END, DEMO_NAME, DEMO_TENANT, ensureDemoCompany } from "../guest/guest.js";
import type { Blobs, Sql } from "../store.js";
import { TenantDb } from "../tenant.js";
import { retrieve } from "./core.js";
import { quickActions, type AskContext } from "./context.js";
import type { ToolDef } from "./model.js";

/** A tool result's text at most, so a round's prompt stays bounded (./limits.ts prices the worst case). */
export const TOOL_RESULT_MAX = 6_000;
/** Tool calls in one round, and in one question, at most. */
export const TOOLS_PER_ROUND = 4;
export const TOOLS_PER_QUESTION = 10;

export const DEMO_LABEL = "demo company: made-up data from a simulated month, no real money; read only";

/** The demo company's books, as each MCP tool reads them; the proposing tools are never here. */
const BOOK_TOOLS = READ_TOOLS.filter((t) => t.readOnly);

/** What the UI shows for a step: "Read invoices", and how much it read. */
type Summary = (args: Record<string, unknown>, data: Record<string, unknown> | undefined) => { label: string; detail: string };
const rows = (n: unknown, one = "row", many = `${one}s`) => { const k = Array.isArray(n) ? n.length : typeof n === "number" ? n : 0; return `${k} ${k === 1 ? one : many}`; };
const SUMMARY: Record<string, Summary> = {
  search_docs: (a, d) => ({ label: "Searched the docs", detail: `${rows(d?.found, "passage")}${a.query ? ` · "${String(a.query).slice(0, 40)}"` : ""}` }),
  company_overview: () => ({ label: "Read the company overview", detail: "money in, out, invoices" }),
  list_invoices: (a, d) => ({ label: "Read invoices", detail: `${rows(d?.items)}${a.status ? ` · ${String(a.status)}` : ""}` }),
  get_invoice: (a) => ({ label: `Read invoice ${String(a.id ?? "")}`.trim(), detail: "checks and status" }),
  list_transactions: (_a, d) => ({ label: "Read payments", detail: rows(d?.items) }),
  books_report: (a) => ({ label: "Read the books", detail: String(a.report ?? "") }),
  agent_decisions: (_a, d) => ({ label: "Read agent decisions", detail: rows(d?.items, "entry", "entries") }),
  what_needs_attention: () => ({ label: "Checked what needs attention", detail: "open, due, blocked" }),
  cash_position: (_a, d) => ({ label: "Read cash and its projection", detail: rows(d?.projection, "week") }),
  pending_approvals: (_a, d) => ({ label: "Read what waits for the CFO", detail: `${(Array.isArray(d?.invoices) ? d.invoices.length : 0) + (Array.isArray(d?.proposals) ? d.proposals.length : 0)} waiting` }),
  cfo_policy: (_a, d) => ({ label: "Read the CFO's policy", detail: rows(d?.rules, "rule") }),
  spend_breakdown: (a, d) => ({ label: `Read spend by ${String(a.by ?? "agent")}`, detail: rows(d?.items, "group") }),
  vat_summary: (_a, d) => ({ label: "Read the VAT summary", detail: String(d?.quarter ?? "") }),
  payment_audit_trail: (a, d) => ({ label: `Read the audit trail of ${String(a.id ?? "")}`.trim(), detail: rows(d?.steps, "step") }),
  explain_payment: (a) => ({ label: `Explained ${String(a.id ?? "a payment")}`, detail: "who allowed it, how" }),
  agents: (_a, d) => ({ label: "Read agents and their limits", detail: rows(d?.agents, "agent") }),
  run_records: () => ({ label: "Read the run records", detail: "3 records" }),
};

export interface ToolCtx { sql: Sql; blobs?: Blobs; origin: string; now?: Date }
export interface ToolRun {
  /** For Claude: the result as text, its source number first. */
  text: string;
  isError: boolean;
  /** For the visitor: one compact step ("Read invoices · 12 rows"). */
  step: { tool: string; label: string; detail: string; ok: boolean };
  /** New sources the result adds (search_docs's passages, or the demo company's record it read). */
  sources: { title: string; url: string; kind: "doc" | "data"; chunk?: AskChunk }[];
}

const SEARCH: ToolDef = {
  name: "search_docs",
  description: "Search Purser's public docs (README, llms.txt, docs/) by keywords. Returns the best passages, numbered as sources to cite. Use it when the passages already given do not answer the question. Read only.",
  input_schema: { type: "object", properties: { query: { type: "string", maxLength: 200, description: "A few keywords, like \"Face ID approval passkey\"" } }, required: ["query"], additionalProperties: false },
};
const AGENTS: ToolDef = {
  name: "agents",
  description: "The demo company's agents (made-up data): each one's job, what it may and may not do, its card limits as issued, its status and its newest decisions with who decided (Claude, or Purser's code when no model answered). Takes no arguments. Read only.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};
const RUNS: ToolDef = {
  name: "run_records",
  description: "Purser's recorded runs, each labelled as its record labels it (test money, testnet, sandbox): the invoice token on Alta (formerly Metal) testnet (mint, finance, settle), the agents' Airwallex sandbox cards and their limits, and the Visa credential run via Airi. Takes no arguments. Read only.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

/** The tools Claude is given, in one fixed order (so the prompt cache holds). */
export const ASK_TOOLS: readonly ToolDef[] = [
  SEARCH,
  ...BOOK_TOOLS.map((t) => ({ name: t.name, description: `${t.description} Over the ${DEMO_LABEL}.`, input_schema: t.inputSchema })),
  AGENTS,
  RUNS,
];
export const ASK_TOOL_NAMES = new Set(ASK_TOOLS.map((t) => t.name));

const clip = (s: string, n = TOOL_RESULT_MAX) => (s.length > n ? `${s.slice(0, n - 40).replace(/\s\S*$/, "")}\n… (the rest left out)` : s);
const textOf = (r: ToolResult) => r.content.filter((x): x is { type: "text"; text: string } => x.type === "text").map((x) => x.text).join("\n");
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";

/** The demo company's agents as short lines Claude reads. */
function agentLines(d: { agents?: { name: string; role: string; job: string; may: string[]; may_not: string[]; status: string; card: { currency: string; per_purchase: string | null; per_month: string | null } | null; decisions: { at: string; text: string; decided_by: string | null }[] }[]; controls?: string }): string {
  const out: string[] = [];
  for (const a of d.agents ?? []) {
    out.push(`${a.name} (${a.role}), ${a.status}: ${a.job}`);
    if (a.card) out.push(`  card limits: ${a.card.currency} ${a.card.per_purchase ?? "?"} a purchase, ${a.card.currency} ${a.card.per_month ?? "?"} a month`);
    if (a.may.length) out.push(`  may: ${a.may.join("; ")}`);
    if (a.may_not.length) out.push(`  may not: ${a.may_not.join("; ")}`);
    for (const x of a.decisions.slice(0, 3)) out.push(`  - ${x.at.slice(0, 10)} ${x.text}${x.decided_by ? ` (decided by ${x.decided_by})` : ""}`);
  }
  if (d.controls) out.push(d.controls);
  return out.join("\n");
}

/** The run records as short lines, each with its label and its record's link. */
function runLines(t: ReturnType<typeof tokenisation>): string {
  const r = t as { invoice_token: { label: string; recorded_at: string; invoice: { invoice_no: string; amount: string; currency: string }; face_value: string; discount: string; stages: { label: string; on_chain: boolean }[]; verified: boolean; record: string }; agent_cards: { label: string; read_at: string; cards: { holder: string; status: string; limits: string[] }[]; record: string }; visa_credential: { label: string; run: string; at: string; purchases: { what: string; amount: string; outcome: string | null; reason: string | null }[]; record: string } };
  const it = r.invoice_token, ac = r.agent_cards, v = r.visa_credential;
  return [
    `Invoice token (${it.label}), recorded ${it.recorded_at.slice(0, 10)}: invoice ${it.invoice.invoice_no}, ${it.invoice.currency} ${it.invoice.amount}; face value ${it.face_value}; discount ${it.discount}.`,
    `  stages: ${it.stages.map((s) => `${s.label}${s.on_chain ? " (on chain)" : ""}`).join(", ")}; verified: ${it.verified ? "yes" : "no"}. Record: ${it.record}`,
    `Agents' cards (${ac.label}), read ${ac.read_at.slice(0, 10)}: ${ac.cards.map((c) => `${c.holder} ${c.status} ${c.limits.join(", ")}`).join("; ")}. Record: ${ac.record}`,
    `Visa credential via Airi (${v.label}), run ${v.run} on ${v.at.slice(0, 10)}: ${v.purchases.map((p) => `${p.what} ${p.amount} → ${p.outcome ?? "no outcome"}${p.reason ? ` (${p.reason})` : ""}`).join("; ")}. Record: ${v.record}`,
  ].join("\n");
}

/**
 * Runs one tool call Claude made, by name and input; `n` is the source number its result takes. Never throws: a tool
 * that fails or is unknown is a tool error Claude reads (and the visitor sees as a step that did not work).
 */
export async function runAskTool(ctx: ToolCtx, name: string, input: unknown, n: number, seen: ReadonlySet<number> = new Set()): Promise<ToolRun> {
  const args = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const sum = SUMMARY[name] ?? (() => ({ label: name, detail: "" }));
  const fail = (why: string): ToolRun => ({ text: why, isError: true, step: { tool: name, ...sum(args, undefined), detail: "could not read", ok: false }, sources: [] });
  if (!ASK_TOOL_NAMES.has(name)) return fail(`There is no tool ${name}. The tools are read only: ${[...ASK_TOOL_NAMES].join(", ")}.`);
  try {
    if (name === "search_docs") {
      const q = typeof args.query === "string" ? args.query.slice(0, 200) : "";
      if (!q.trim()) return fail("search_docs needs a query of a few keywords.");
      const found = retrieve(q, 4).filter((c) => !seen.has(c.id)).slice(0, 3);
      if (!found.length) return { text: "No passage of Purser's docs fits that search. If the passages you have do not answer, say the docs don't say.", isError: false, step: { tool: name, ...sum(args, { found: [] }), ok: true }, sources: [] };
      const text = found.map((c, i) => `<source n="${n + i}" title="${c.title.replace(/"/g, "'")}" url="${c.url}">\n${c.text.replace(/<\/?source/gi, "")}\n</source>`).join("\n");
      return { text, isError: false, step: { tool: name, ...sum(args, { found }), ok: true }, sources: found.map((c) => ({ title: c.title, url: c.url, kind: "doc" as const, chunk: c })) };
    }
    // The demo company, made on first use as a guest's sign-in makes it (and read as of its last day, as /mcp reads it).
    if (ctx.blobs) await ensureDemoCompany(ctx.sql, ctx.blobs, ctx.now ?? new Date());
    const db = new TenantDb(ctx.sql, DEMO_TENANT);
    const head = (title: string) => `<source n="${n}" title="${title}" kind="data">\n${DEMO_NAME}: ${DEMO_LABEL}.\n`;
    const consoleUrl = `${ctx.origin.replace(/\/$/, "")}/`;
    if (name === "agents") {
      const d = (await agentsOf(db)) as Parameters<typeof agentLines>[0] & Record<string, unknown>;
      const title = "Demo company · agents and limits";
      return { text: `${head(title)}${clip(agentLines(d))}\n</source>`, isError: false, step: { tool: name, ...sum(args, d), ok: true }, sources: [{ title, url: consoleUrl, kind: "data" }] };
    }
    if (name === "run_records") {
      const title = "Purser's run records";
      return { text: `<source n="${n}" title="${title}" kind="data">\n${clip(runLines(tokenisation()))}\n</source>`, isError: false, step: { tool: name, ...sum(args, undefined), ok: true }, sources: [{ title, url: `${REPO}docs/runs/2026-11-12-tokenize.md`, kind: "data" }] };
    }
    const tool = BOOK_TOOLS.find((t) => t.name === name) as McpTool;
    const parsed = tool.args.safeParse(args);
    if (!parsed.success) return fail(`The arguments do not fit ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}.`);
    const r = await tool.run({ origin: ctx.origin, caller: { tenantId: DEMO_TENANT, kind: "session", principal: "ask-purser", scopes: new Set(["read"]), user: null, purpose: "ask-purser" } as never, db, now: new Date(DEMO_END), company: DEMO_NAME, engine: null, demo: true }, parsed.data);
    const title = `Demo company · ${tool.title}`;
    if (r.isError) return { text: clip(textOf(r).split("\n")[0] ?? "That read found nothing."), isError: true, step: { tool: name, ...sum(args, undefined), detail: "nothing found", ok: false }, sources: [] };
    return { text: `${head(title)}${clip(textOf(r))}\n</source>`, isError: false, step: { tool: name, ...sum(parsed.data, r.structuredContent), ok: true }, sources: [{ title, url: consoleUrl, kind: "data" }] };
  } catch {
    return fail(`${name} could not be read right now. Answer with what you have, and say what you could not read.`);
  }
}

// ---- Without a model: a question about the demo company's records, answered by code ----

/** A question asking for the demo company's records ("which invoices wait for the CFO?"), not how Purser works. */
const ASKS_RECORDS = /\b(demo( company)?|northwind|our|my|the company'?s?)\b|^\s*(show|list|give|which|how (many|much))\b|^\s*what('?s| is| are) (the )?(current|latest|open|pending|waiting|overdue|total|newest|biggest|largest)\b/i;
const ROUTES: [RegExp, string, Record<string, unknown>][] = [
  [/\b(wait|waits|waiting|pending|approvals?|to approve)\b/i, "pending_approvals", {}],
  [/\b(overdue|attention|due (soon|this week)|blocked)\b/i, "what_needs_attention", {}],
  [/\b(cash|runway|projection|net flow)\b/i, "cash_position", {}],
  [/\bvat\b/i, "vat_summary", {}],
  [/\bbalance sheet\b/i, "books_report", { report: "balance" }],
  [/\b(p&l|profit|loss|books|ledger)\b/i, "books_report", { report: "pnl" }],
  [/\b(spend|spent|spending)\b/i, "spend_breakdown", {}],
  [/\b(agents?|cards?|limits?)\b/i, "agents", {}],
  [/\bdecisions?\b/i, "agent_decisions", { limit: 10 }],
  [/\b(policy|rules)\b/i, "cfo_policy", {}],
  [/\binvoices?\b/i, "list_invoices", {}],
  [/\b(payments?|transactions?|money (in|out))\b/i, "list_transactions", {}],
  [/\b(overview|summary|doing|balance)\b/i, "company_overview", {}],
];
const DATA_WORD = /\b(invoices?|payments?|transactions?|cash|balance|spend|spent|agents?|cards?|limits?|decisions?|approvals?|pending|waits?|waiting|vat|ledger|books|p&l|profit|overdue|policy|suppliers?)\b/i;

/**
 * A quick action's question (./context.ts) without a model: the read it names. A record's id is read only in the demo
 * company (a guest's console), whose records these tools read; in a person's own company it is never looked up here.
 */
function quickRead(question: string, c: AskContext): { tool: string; args: Record<string, unknown> } | null | undefined {
  const q = quickActions(c).find((x) => x.q === question.trim());
  if (!q) return undefined;
  const id = c.demo && c.id && question.includes(c.id) ? c.id : null;
  if (q.key === "status") return id ? (c.kind === "payment" ? { tool: "explain_payment", args: { id } } : { tool: "get_invoice", args: { id } }) : question.includes("{") || c.id ? null : { tool: "pending_approvals", args: {} };
  if (q.key === "transactions") return id ? { tool: "payment_audit_trail", args: { id } } : c.id && !c.demo && c.kind === "invoice" ? null : { tool: "list_transactions", args: {} };
  if (id) return { tool: "explain_payment", args: { id } };
  if (c.id && !c.demo && (c.kind === "invoice" || c.kind === "payment")) return null;
  return c.kind === "policy" ? { tool: "cfo_policy", args: {} } : c.kind === "agents" ? { tool: "agents", args: {} } : { tool: "agent_decisions", args: { limit: 5 } };
}

/** The one read that answers a records question without a model, or null (then the docs answer). */
export function localRead(question: string, context: AskContext | null = null): { tool: string; args: Record<string, unknown> } | null {
  // A quick action decides alone: its read, or none (an own company's record is never looked up here).
  const quick = context ? quickRead(question, context) : undefined;
  if (quick !== undefined) return quick;
  if (!ASKS_RECORDS.test(question) || !DATA_WORD.test(question)) return null;
  for (const [re, tool, args] of ROUTES) if (re.test(question)) return { tool, args };
  return null;
}

/** A tool's result as a visitor reads it: the lines inside its <source>, without the tags. */
export const resultForPeople = (text: string) => text.replace(/<source[^>]*>\n?/g, "").replace(/<\/source>/g, "").trim();
