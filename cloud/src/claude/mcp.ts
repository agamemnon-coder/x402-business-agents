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
  /** The cloud's own address: the server's icons are served from it. */
  origin?: string;
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

/**
 * A result as a phone chat reads it (owner, 13 Nov): one plain sentence first, then a few short lines, money as
 * "EUR 1,793.00". The whole record goes along as structuredContent, for a client that reads data.
 */
const answer = (sentence: string, data: Json, lines: string[] = []): ToolResult => ({ content: [{ type: "text", text: [sentence, ...lines].join("\n") }], structuredContent: data });
/** Money as people read it: "EUR 1,793.00". */
export const eur = (amount: string | number, currency = "EUR"): string => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fromCents = (cents: number, currency = "EUR") => eur(cents / 100, currency);
/** A day as "23 Nov 2026". */
const dayWords = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const centsMap = (m: Record<string, number> | undefined) => Object.entries(m ?? {}).map(([cur, c]) => fromCents(c, cur)).join(" + ") || "none";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
interface Inv { id: string; vendor: string; invoice_no: string; currency: string; total: string; tax?: string; subtotal?: string; due_date: string; issue_date?: string; status: string; status_words?: string; findings?: { level?: string; message: string }[]; paid_at?: string | null; gl_account?: string; proposal_id?: string | null; read_by?: string }
const invLine = (i: Inv) => `${i.id} · ${i.vendor} · ${i.invoice_no} · ${eur(i.total, i.currency)} · due ${dayWords(i.due_date)} · ${i.status_words ?? i.status}`;
interface Tx { at: string; direction: string; rail_label?: string; rail: string; amount: string; currency: string; counterparty: string; status_words?: string; status: string; approval?: { authority?: string } }
const txLine = (t: Tx) => `${dayWords(t.at)} · ${t.direction === "in" ? "in" : t.direction === "out" ? "out" : t.direction} ${eur(t.amount, t.currency)} · ${t.counterparty} · ${t.rail_label ?? t.rail} · ${t.status_words ?? t.status}`;
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

/** A ledger report in a few lines: the totals first, then its largest rows. */
function bookLines(company: string, name: string, r: Record<string, unknown>): [string, Json, string[]] {
  type Acc = { account: string; name: string; cents: number };
  const by = (r.by_currency ?? {}) as Record<string, { revenue_cents?: number; expense_cents?: number; result_cents?: number; assets_cents?: number; liabilities_cents?: number; equity_cents?: number; balanced?: boolean; accounts?: Acc[] }>;
  const top = (cur: string, accs: Acc[] = []) => [...accs].sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents)).slice(0, 5).map((x) => `- ${x.account} ${x.name}: ${fromCents(x.cents, cur)}`);
  if (name === "pnl") {
    const lines = Object.entries(by).flatMap(([cur, v]) => [`${cur}: revenue ${fromCents(v.revenue_cents ?? 0, cur)} · expenses ${fromCents(v.expense_cents ?? 0, cur)} · result ${fromCents(v.result_cents ?? 0, cur)}`, ...top(cur, v.accounts)]);
    const main = Object.entries(by)[0];
    return [`${company}: profit and loss ${dayWords(r.from as string)} to ${dayWords(r.to as string)}${main ? `, result ${fromCents(main[1].result_cents ?? 0, main[0])}` : ""}.`, r as Json, lines];
  }
  if (name === "balance") {
    const lines = Object.entries(by).flatMap(([cur, v]) => [`${cur}: assets ${fromCents(v.assets_cents ?? 0, cur)} · liabilities ${fromCents(v.liabilities_cents ?? 0, cur)} · equity ${fromCents(v.equity_cents ?? 0, cur)} · result ${fromCents(v.result_cents ?? 0, cur)}${v.balanced ? " · balanced" : " · NOT balanced"}`, ...top(cur, v.accounts)]);
    return [`${company}: balance sheet at ${dayWords(r.to as string)}.`, r as Json, lines];
  }
  if (name === "vat") {
    const v = r as { quarter: string; owed_5a_cents: number; input_5b_cents: number; balance_5c_cents: number; uncoded_lines: number; notice?: string };
    return [`${company}: VAT overview ${v.quarter}, balance ${fromCents(v.balance_5c_cents)} (an overview, not a filing).`, r as Json, [`Owed (5a) ${fromCents(v.owed_5a_cents)} · input VAT (5b) ${fromCents(v.input_5b_cents)} · balance (5c) ${fromCents(v.balance_5c_cents)}.`, ...(v.uncoded_lines ? [`${plural(v.uncoded_lines, "line")} without a VAT code are not counted; a person checks the overview first.`] : [])]];
  }
  if (name === "payables" || name === "receivables") {
    const a = r as { as_of: string; items: { party: string; doc_ref: string; currency: string; due_date: string; open_cents: number; bucket: string }[] };
    return [`${company}: ${plural(a.items.length, name === "payables" ? "open payable" : "open receivable")} at ${dayWords(a.as_of)}.`, r as Json, a.items.slice(0, 10).map((i) => `- ${i.doc_ref} · ${fromCents(i.open_cents, i.currency)} · due ${dayWords(i.due_date)} · ${i.bucket}`)];
  }
  const rows = (r.rows ?? []) as unknown[];
  return [`${company}: trial balance at ${dayWords(r.to as string)}, ${plural(rows.length, "account")}.`, r as Json, []];
}

const READ_TOOLS: Tool[] = [
  {
    name: "company_overview",
    title: "Company overview",
    description: "The company's start screen in one answer: money in and out and net cash day by day, spend by who started it (each agent's own card, supplier invoices the CFO approved), payments per week by how each was allowed, invoices by state, and the newest decisions in words. Every figure is counted from the company's own records.",
    inputSchema: obj({}),
    args: z.object({}).strict(),
    readOnly: true,
    run: async (c) => {
      const d = (await dashboard(c.db, c.demo ? { asOf: c.now.toISOString() } : {})) as { currency: string; as_of: string | null; since: string | null; money: { in: string; out: string; net: string }; invoices: Record<string, { count: number; amount: string }> & { duplicates_stopped: number }; spend: { label: string; amount: string; count: number; declined: number }[]; agents: { decisions: number; by_fallback: number }; feed: { at: string; who: string; text: string }[] };
      const cur = d.currency, inv = d.invoices;
      const lines = [
        `Money in ${eur(d.money.in, cur)} · out ${eur(d.money.out, cur)} · net ${eur(d.money.net, cur)}${d.since ? ` (${dayWords(d.since)} to ${dayWords(d.as_of)})` : ""}.`,
        `Invoices: ${inv.paid!.count} paid (${eur(inv.paid!.amount, cur)}), ${inv.waiting_cfo!.count} waiting for the CFO's Face ID (${eur(inv.waiting_cfo!.amount, cur)}), ${inv.needs_vendor!.count} waiting for a new supplier (${eur(inv.needs_vendor!.amount, cur)})${inv.duplicates_stopped ? `; ${plural(inv.duplicates_stopped, "duplicate")} stopped` : ""}.`,
        `Spend: ${d.spend.slice(0, 4).map((x) => `${x.label} ${eur(x.amount, cur)}`).join(" · ")}.`,
        `Decisions: ${d.agents.decisions} by agents${d.agents.by_fallback ? `, ${d.agents.by_fallback} of them by code's fallback (no model)` : ""}.`,
        ...d.feed.slice(0, 3).map((f) => `- ${dayWords(f.at)} · ${f.who}: ${f.text}`),
      ];
      return answer(`${c.company}${c.demo && !/demo/i.test(c.company) ? " (demo data)" : ""}: net ${eur(d.money.net, cur)}, ${plural(inv.waiting_cfo!.count, "invoice")} waiting for the CFO's Face ID.`, d as unknown as Json, lines);
    },
  },
  {
    name: "list_invoices",
    title: "Supplier invoices",
    description: "The company's supplier invoices, newest first: supplier, number, amount, due day and status (for example waiting_cfo: filed for the CFO's Face ID; needs_vendor: the supplier is new; paid). Filter by status and due days.",
    inputSchema: obj({ status: { type: "string", description: "Only this status, e.g. waiting_cfo, needs_vendor, paid" }, due_from: dayProp("Due on or after this day"), due_to: dayProp("Due on or before this day"), limit: limitProp, cursor: cursorProp }),
    args: z.object({ status: z.string().max(40).optional(), due_from: DAY.optional(), due_to: DAY.optional(), limit: LIMIT.optional(), cursor: z.string().max(200).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const page = await listInvoices(c.db, params({ ...a, limit: a.limit ?? 10 })) as { items: Inv[]; next_cursor: string | null };
      return answer(`${plural(page.items.length, "invoice")}${a.status ? ` with status ${String(a.status)}` : ""}${page.next_cursor ? "; more with next_cursor" : ""}.`, page as unknown as Json, page.items.map(invLine));
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
      const inv = await oneInvoice(c.db, a.id as string) as Inv | null;
      if (!inv) return refuse(`There is no invoice ${String(a.id)} in ${c.company}'s books.`);
      const lines = [
        `${inv.vendor} · invoice ${inv.invoice_no}${inv.issue_date ? ` of ${dayWords(inv.issue_date)}` : ""} · due ${dayWords(inv.due_date)}.`,
        `Total ${eur(inv.total, inv.currency)}${inv.tax ? ` (net ${eur(inv.subtotal ?? "0", inv.currency)}, VAT ${eur(inv.tax, inv.currency)})` : ""}${inv.gl_account ? ` · booked to ${inv.gl_account}` : ""}.`,
        `Status: ${inv.status_words ?? inv.status}${inv.paid_at ? `, paid ${dayWords(inv.paid_at)}` : ""}${inv.proposal_id ? ` · proposal ${inv.proposal_id}` : ""}.`,
        inv.findings?.length ? `Checks found: ${inv.findings.map((f) => f.message).join("; ")}` : "Checks: nothing found.",
      ];
      return answer(`${inv.id}: ${inv.vendor}, ${eur(inv.total, inv.currency)}, ${inv.status_words ?? inv.status}.`, { invoice: inv as unknown as Json }, lines);
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
      const page = await listTransactions(c.db, params({ ...a, limit: a.limit ?? 10 })) as { items: Tx[]; next_cursor: string | null };
      return answer(`${plural(page.items.length, "money movement")}, newest first${page.next_cursor ? "; more with next_cursor" : ""}.`, page as unknown as Json, page.items.map(txLine));
    },
  },
  {
    name: "books_report",
    title: "The books",
    description: "A report computed from the ledger: pnl (profit and loss), balance (balance sheet), trial (trial balance), vat (a quarter's VAT, e.g. quarter 2026Q4), payables or receivables.",
    inputSchema: obj({ report: { type: "string", enum: ["pnl", "balance", "trial", "vat", "payables", "receivables"] }, quarter: { type: "string", pattern: "^\\d{4}Q[1-4]$", description: "For vat: the quarter, like 2026Q4" } }, ["report"]),
    args: z.object({ report: z.enum(["pnl", "balance", "trial", "vat", "payables", "receivables"]), quarter: z.string().regex(/^\d{4}Q[1-4]$/).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      // The demo company's books end on its own last day, as its overview does.
      const at = c.demo ? c.now.toISOString().slice(0, 10) : undefined;
      const r: Json = { report: a.report, ...(await report(c.db, a.report as string, params({ quarter: a.quarter, to: at, as_of: at }), c.now)) as Json };
      const [sentence, data, lines] = bookLines(c.company, a.report as string, r);
      return answer(sentence, data, lines);
    },
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
      return answer(`${plural(items.length, "decision")}, newest first.`, { items }, items.map((f) => `- ${dayWords(f.at)} · ${f.who}: ${f.text}`));
    },
  },
  {
    name: "what_needs_attention",
    title: "What needs attention",
    description: "Payables at a glance: what is open, due within 7 and 30 days, overdue, waiting for the CFO or a new supplier, blocked, and spend per supplier.",
    inputSchema: obj({}),
    args: z.object({}).strict(),
    readOnly: true,
    run: async (c) => {
      const n = (await insights(c.db, c.now)) as { as_of: string; open_cents: Record<string, number>; due_7_days_cents: Record<string, number>; due_30_days_cents: Record<string, number>; overdue_cents: Record<string, number>; waiting: { for_cfo: number; for_supplier_check: number; for_a_person: number }; blocked_by_reason: Record<string, number> };
      const blocked = Object.values(n.blocked_by_reason ?? {}).reduce((k, x) => k + x, 0);
      const lines = [
        `Open ${centsMap(n.open_cents)} · due within 7 days ${centsMap(n.due_7_days_cents)} · within 30 days ${centsMap(n.due_30_days_cents)} · overdue ${centsMap(n.overdue_cents)}.`,
        `Waiting: ${n.waiting.for_cfo} for the CFO's Face ID, ${n.waiting.for_supplier_check} for a new supplier's check, ${n.waiting.for_a_person} for a person. Blocked: ${blocked}.`,
      ];
      return answer(`As of ${dayWords(n.as_of)}: ${plural(n.waiting.for_cfo, "invoice")} waiting for the CFO's Face ID, ${Object.keys(n.overdue_cents ?? {}).length ? "some overdue" : "nothing overdue"}.`, n as unknown as Json, lines);
    },
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
        { proposal: proposalOut(out.proposal), paid: false, next: "The CFO approves or lets it expire in Purser Cloud (Invoices). Call payment_proposal to see its status." },
        [...out.proposal.facts.map(([k, v]) => `- ${k}: ${v}`), ...out.proposal.warnings.map((w) => `Warning: ${w}`)]);
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
      return p ? answer(`${p.id}: ${p.status}.`, { proposal: proposalOut(p) }, p.facts.map(([k, v]) => `- ${k}: ${v}`)) : refuse(`There is no proposal ${String(a.proposal_id)}.`);
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

/** Ready-made prompts a client shows (owner, 13 Nov): each asks for the tools that answer it, in plain words. */
export const PROMPTS = [
  { name: "cfo_weekly_brief", title: "CFO weekly brief", description: "This week in five short lines: money in and out, what waits for your Face ID, what is due, what was refused, and what the agents decided.", arguments: [] as { name: string; description: string; required: boolean }[],
    text: () => "Give me my CFO weekly brief from Purser. Call company_overview, what_needs_attention and agent_decisions. Then answer in five short lines: money in and out, what waits for my Face ID, what is due within 7 days, anything refused or blocked, and the agents' notable decisions. Quote amounts exactly as Purser gives them (EUR 1,793.00), and say so if it is the demo company." },
  { name: "needs_face_id", title: "What needs my Face ID?", description: "The invoices waiting for the CFO's approval, with supplier, amount and due day.", arguments: [],
    text: () => "What needs my Face ID in Purser? Call list_invoices with status waiting_cfo, and what_needs_attention. List each one: supplier, amount, due day. Then say that I approve each in Purser Cloud with Face ID, and that you cannot approve." },
  { name: "explain_invoice", title: "Explain this invoice", description: "One invoice in plain words: who, what, how much, VAT, when due, what Purser's checks found, and where it stands.", arguments: [{ name: "invoice_id", description: "The invoice's id, like AP-0004", required: true }],
    text: (a: Record<string, string>) => `Explain invoice ${a.invoice_id} from Purser in plain words. Call get_invoice with id ${a.invoice_id}. Say who it is from, the amount and its VAT, when it is due, what Purser's checks found, and where it stands (paid, waiting for my Face ID, or waiting for a new supplier). Keep it short.` },
];

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
      const serverInfo = { name: "purser", title: "Purser", version: "1.1.0", ...(c.origin ? { websiteUrl: c.origin, icons: [{ src: `${c.origin}/icon.png`, mimeType: "image/png", sizes: ["512x512"] }, { src: `${c.origin}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }] } : {}) };
      return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo, instructions: instructions(c) } };
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
    case "prompts/list":
      return { jsonrpc: "2.0", id: m.id, result: { prompts: PROMPTS.map((x) => ({ name: x.name, title: x.title, description: x.description, ...(x.arguments.length ? { arguments: x.arguments } : {}) })) } };
    case "prompts/get": {
      const x = PROMPTS.find((y) => y.name === p.name);
      if (!x) return rpcError(m.id, -32602, `no prompt ${String(p.name)}`);
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Record<string, unknown>;
      for (const a of x.arguments) if (a.required && !(typeof args[a.name] === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(args[a.name] as string))) return rpcError(m.id, -32602, `the prompt needs ${a.name} (an id like AP-0004)`);
      return { jsonrpc: "2.0", id: m.id, result: { description: x.description, messages: [{ role: "user", content: { type: "text", text: x.text(args as Record<string, string>) } }] } };
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
