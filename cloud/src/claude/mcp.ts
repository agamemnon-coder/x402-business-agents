// Connect any AI: Purser as a remote MCP server (POST /mcp, Streamable HTTP, JSON answers, no session). Claude, ChatGPT,
// Cursor, VS Code, Gemini CLI, Windsurf or any MCP client reads the company's books and, with a token that allows it,
// PROPOSES an invoice's payment. Nothing here approves, pays, changes a limit or writes to the books: every payment
// still waits for the CFO's passkey (Face ID) in Purser Cloud, and that approval is a WebAuthn signature over the
// payment's exact terms, which no token can make.
//
// Dual-era (MCP 2026-07-28, basic/versioning): a request that carries its protocol version in params._meta is served
// statelessly by the current revision (server/discover, the mirrored Mcp-Method / Mcp-Name headers checked against the
// body, resultType and serverInfo on every result, ttlMs and cacheScope on lists and reads); an initialize request
// selects the legacy revisions (2025-11-25 back to 2024-11-05), which this server also answers without a session.
// The protocol is small enough to answer here without the SDK's transport (nothing new in the Worker's bundle).
//
// Every error carries one stable code from ERROR_CODES, whichever way it travels: a tool's own refusal is a result with
// isError, its sentence first and then {"error":{"code","message","next"}} as a second text item (structuredContent is
// kept for successful results, so a client that checks it against the outputSchema never trips on an error); a request
// the server cannot take is a JSON-RPC error whose data carries the same code. docs/mcp.md lists them.

import { z } from "zod";
import type { Caller } from "../auth.js";
import { iconsOf } from "../brand.js";
import { dashboard, decisionLog } from "../dashboard.js";
import { BadRequest, insights, listInvoices, listTransactions, oneInvoice, report } from "../read.js";
import { auditTrail, cashPosition, cfoPolicy, explain, findPayment, pendingApprovals, quarterOf, spendBy } from "./insight.js";
import type { TenantDb } from "../tenant.js";
import type { EngineApi } from "../engine/api.js";
import { listResources, NoResource, readResource, RESOURCE_TEMPLATES } from "./resources.js";

/** The current revision: version, identity and capabilities ride on every request (no initialize). */
export const MODERN_VERSIONS = ["2026-07-28"] as const;
/** The revisions that open with initialize; an unknown version asked for there gets the newest of these. */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
/** Every protocol version this server speaks, newest first. */
export const PROTOCOL_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS] as const;
export const SERVER_VERSION = "1.2.0";

export interface McpCtx {
  /** The cloud's own address: the server's icons are served from it. */
  origin?: string;
  caller: Caller;
  db: TenantDb;
  now: Date;
  company: string;
  engine: EngineApi | null;
  demo: boolean;
  /** The protocol version this request is served in (set per request by mcpAnswer). */
  version?: string;
}

type Json = Record<string, unknown>;
/** A resource a result points to (MCP resource_link, 2025-06-18 and later): the client may read it with resources/read. */
export interface Link { uri: string; name: string; title?: string; description?: string; mimeType?: string }
interface ToolResult { content: ({ type: "text"; text: string } | ({ type: "resource_link" } & Link))[]; structuredContent?: Json; isError?: boolean; links?: Link[] }
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  /** The shape of structuredContent (JSON Schema): every successful result conforms to it. */
  outputSchema: Json;
  args: z.ZodType<Json>;
  readOnly: boolean;
  run(ctx: McpCtx, args: Json): Promise<ToolResult>;
}

/** Tool annotations (MCP 2025-03-26 and later): a reading tool changes nothing and may be called again freely; the one
 *  tool that files something only adds a proposal for the CFO, which nothing here can approve. None reaches outside
 *  Purser (openWorldHint false), and none destroys anything. */
export function annotationsOf(t: { title: string; readOnly: boolean }): { title: string; readOnlyHint: boolean; destructiveHint: false; idempotentHint: boolean; openWorldHint: false } {
  return { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false };
}

/**
 * The one list of error codes. A tool's refusal carries one in {"error":{"code"}} (its second text item); a JSON-RPC
 * error carries one in data.code. Clients can branch on the code; the sentence is for people.
 */
export const ERROR_CODES = {
  invalid_arguments: "The arguments do not fit the tool's inputSchema. Fix them and call again.",
  not_found: "No invoice, payment or proposal in this company's books has that id.",
  could_not_answer: "The books could not answer that question as asked (for example a filter with no meaning).",
  refused: "Purser refused to file the proposal (the invoice is held, already waiting or paid). Nothing was proposed.",
  demo_read_only: "The demo company is read only: nothing can be proposed in it.",
  runner_only: "This company's payments are filed on its own runner, not in the cloud, so nothing can be proposed here.",
  unknown_tool: "No tool by that name; tools/list shows the tools this token has.",
  needs_propose_token: "The tool files a proposal; this token reads only. A token made to propose files payments, never approves them.",
  not_available_over_mcp: "Approving, paying, changing a limit or writing to the books is never possible over MCP, for any token: the CFO approves with a passkey in Purser Cloud.",
  unknown_prompt: "No prompt by that name; prompts/list shows them.",
  missing_argument: "A required parameter or prompt argument is missing or malformed.",
  invalid_cursor: "The cursor is not one this server gave; pass the previous page's nextCursor, or none.",
  resource_not_found: "No resource at that URI; resources/list and resources/templates/list show what there is.",
  unknown_method: "The server does not answer that method.",
  invalid_request: "The body is not a JSON-RPC request this server takes.",
  parse_error: "The body is not JSON.",
  header_mismatch: "A mirrored header (MCP-Protocol-Version, Mcp-Method, Mcp-Name) is missing or disagrees with the body.",
  unsupported_protocol_version: "The protocol version is not one this server speaks; data.supported lists them.",
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * A result as a phone chat reads it (owner, 13 Nov): one plain sentence first, then a few short lines, money as
 * "EUR 1,793.00". The whole record goes along as structuredContent, for a client that reads data.
 */
const answer = (sentence: string, data: Json, lines: string[] = [], links: Link[] = []): ToolResult => ({ content: [{ type: "text", text: [sentence, ...lines].join("\n") }], structuredContent: data, ...(links.length ? { links } : {}) });
/** Money as people read it: "EUR 1,793.00". */
export const eur = (amount: string | number, currency = "EUR"): string => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fromCents = (cents: number, currency = "EUR") => eur(cents / 100, currency);
/** A day as "23 Nov 2026". */
const dayWords = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const centsMap = (m: Record<string, number> | undefined) => Object.entries(m ?? {}).map(([cur, c]) => fromCents(c, cur)).join(" + ") || "none";
/** "(demo data)" after the company's name, unless its name already says demo. */
const demoTag = (c: McpCtx) => (c.demo && !/demo/i.test(c.company) ? " (demo data)" : "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
interface Inv { id: string; vendor: string; invoice_no: string; currency: string; total: string; tax?: string; subtotal?: string; due_date: string; issue_date?: string; status: string; status_words?: string; findings?: { level?: string; message: string }[]; paid_at?: string | null; gl_account?: string; proposal_id?: string | null; read_by?: string }
const invLine = (i: Inv) => `${i.id} · ${i.vendor} · ${i.invoice_no} · ${eur(i.total, i.currency)} · due ${dayWords(i.due_date)} · ${i.status_words ?? i.status}`;
interface Tx { id: string; at: string; direction: string; rail_label?: string; rail: string; amount: string; currency: string; counterparty: string; status_words?: string; status: string; approval?: { authority?: string } }
const txLine = (t: Tx) => `${dayWords(t.at)} · ${t.direction === "in" ? "in" : t.direction === "out" ? "out" : t.direction} ${eur(t.amount, t.currency)} · ${t.counterparty} · ${t.rail_label ?? t.rail} · ${t.status_words ?? t.status}`;
/** A tool's refusal: the sentence first, then the same error as JSON with its code (and what to do next, when known). */
const refuse = (code: ErrorCode, sentence: string, extra: { next?: string; next_tool?: string } = {}): ToolResult =>
  ({ content: [{ type: "text", text: sentence }, { type: "text", text: JSON.stringify({ error: { code, message: sentence, ...extra } }) }], isError: true });
const params = (o: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q;
};

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as YYYY-MM-DD");
const ID = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/, "an id as Purser shows it, like AP-0004");
const LIMIT = z.number().int().min(1).max(100);
const dayProp = (what: string, example = "2026-11-30") => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: `${what}, as YYYY-MM-DD`, examples: [example] });
const limitProp = { type: "integer", minimum: 1, maximum: 100, description: "How many at most, 1 to 100 (default 10)", examples: [10] };
/** A page's cursor: opaque to the client, so an example is given only where its shape is plain (an invoice id). */
const cursorProp = (example?: string) => ({ type: "string", maxLength: 200, description: "The next_cursor of the previous page, to read on; leave out for the first page", ...(example ? { examples: [example] } : {}) });
/** An id as Purser shows it; the same rule as ID below. */
const idProp = (description: string, examples: string[]) => ({ type: "string", pattern: "^[A-Za-z0-9_.:-]{1,120}$", description, examples });
const quarterProp = (description: string) => ({ type: "string", pattern: "^\\d{4}Q[1-4]$", description, examples: ["2026Q4"] });
const REPORTS = ["pnl", "balance", "trial", "vat", "payables", "receivables"] as const;
const obj = (properties: Json, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
/** An output shape: the named fields are promised, more may come along. */
const shape = (properties: Json, required: string[] = Object.keys(properties)) => ({ type: "object", properties, required });
const S = { type: "string" }, I = { type: "integer" }, NS = { anyOf: [{ type: "string" }, { type: "null" }] };
const arr = (items: Json = { type: "object" }) => ({ type: "array", items });
const PAGE = shape({ items: arr({ type: "object" }), next_cursor: NS });
/** The resources a result names, so a client can open them (purser:// URIs, read with resources/read). */
export const RES = {
  overview: { uri: "purser://company/overview", name: "company-overview", title: "Company overview", mimeType: "application/json" },
  cash: { uri: "purser://cash", name: "cash", title: "Cash and its projection", mimeType: "application/json" },
  approvals: { uri: "purser://approvals/pending", name: "pending-approvals", title: "What waits for the CFO", mimeType: "application/json" },
  policy: { uri: "purser://policy", name: "cfo-policy", title: "The CFO's policy, in plain words", mimeType: "text/markdown" },
  book: (r: string) => ({ uri: `purser://books/${r}`, name: `books-${r}`, title: ({ pnl: "Profit and loss", balance: "Balance sheet", trial: "Trial balance", payables: "Open payables", receivables: "Open receivables" } as Record<string, string>)[r] ?? r, mimeType: "application/json" }),
  vat: (q: string) => ({ uri: `purser://books/vat/${q}`, name: `vat-${q}`, title: `VAT overview ${q}`, mimeType: "application/json" }),
  invoice: (id: string, title?: string) => ({ uri: `purser://invoices/${encodeURIComponent(id)}`, name: `invoice-${id}`, title: title ?? `Invoice ${id}`, mimeType: "application/json" }),
  payment: (id: string, title?: string) => ({ uri: `purser://payments/${encodeURIComponent(id)}`, name: `payment-${id}`, title: title ?? `Payment ${id}`, mimeType: "application/json" }),
};

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
    const v = r as { quarter: string; owed_5a_cents: number; input_5b_cents: number; balance_5c_cents: number; uncoded_lines: number; notice?: string; foreign_vat?: { lines: number; base_cents: number; vat_cents: number } };
    return [`${company}: VAT overview ${v.quarter}, balance ${fromCents(v.balance_5c_cents)} (an overview, not a filing).`, r as Json, [
      `Owed (5a) ${fromCents(v.owed_5a_cents)} · input VAT (5b) ${fromCents(v.input_5b_cents)} · balance (5c) ${fromCents(v.balance_5c_cents)}.`,
      ...(v.foreign_vat?.lines ? [`Foreign VAT, outside the Dutch return: ${fromCents(v.foreign_vat.vat_cents)} on ${fromCents(v.foreign_vat.base_cents)} (${plural(v.foreign_vat.lines, "line")}; a German supplier's 19%, booked to 1515 to reclaim through the EU refund).`] : []),
      ...(v.uncoded_lines ? [`${plural(v.uncoded_lines, "line")} without a VAT code are not counted; a person codes them before filing.`] : [])]];
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
    description: "The company's start screen in one answer: money in and out and net cash day by day, spend by who started it (each agent's own card, supplier invoices the CFO approved), payments per week by how each was allowed, invoices by state, and the newest decisions in words. Every figure is counted from the company's own records. Takes no arguments. Read only.",
    inputSchema: obj({}),
    outputSchema: shape({ currency: S, as_of: NS, since: NS, money: shape({ in: S, out: S, net: S }), cash: arr(shape({ day: S, in: S, out: S, net: S })), spend: arr(shape({ label: S, amount: S, count: I })), invoices: { type: "object" }, agents: shape({ decisions: I, by_fallback: I }), feed: arr(shape({ at: S, who: S, text: S })) }),
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
      return answer(`${c.company}${c.demo && !/demo/i.test(c.company) ? " (demo data)" : ""}: net ${eur(d.money.net, cur)}, ${plural(inv.waiting_cfo!.count, "invoice")} waiting for the CFO's Face ID.`, d as unknown as Json, lines, [RES.overview, RES.approvals]);
    },
  },
  {
    name: "list_invoices",
    title: "Supplier invoices",
    description: "The company's supplier invoices by id, 10 a page unless limit says otherwise: supplier, number, amount, due day and status (waiting_cfo: filed for the CFO's Face ID; needs_vendor: the supplier is new; paid). Filter by status and due days; read on with next_cursor. Use get_invoice for one invoice's checks and history. Read only.",
    inputSchema: obj({ status: { type: "string", pattern: "^[a-z_]{2,40}$", description: "Only invoices with this status, a word like waiting_cfo, needs_vendor, needs_review, blocked or paid", examples: ["waiting_cfo"] }, due_from: dayProp("Only invoices due on or after this day", "2026-11-01"), due_to: dayProp("Only invoices due on or before this day"), limit: limitProp, cursor: cursorProp("AP-0010") }),
    outputSchema: PAGE,
    args: z.object({ status: z.string().regex(/^[a-z_]{2,40}$/, "a status word like waiting_cfo or paid").optional(), due_from: DAY.optional(), due_to: DAY.optional(), limit: LIMIT.optional(), cursor: z.string().max(200).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const page = await listInvoices(c.db, params({ ...a, limit: a.limit ?? 10 })) as { items: Inv[]; next_cursor: string | null };
      return answer(`${plural(page.items.length, "invoice")}${a.status ? ` with status ${String(a.status)}` : ""}${page.next_cursor ? "; more with next_cursor" : ""}.`, page as unknown as Json, page.items.map(invLine), page.items.map((i) => RES.invoice(i.id, `${i.vendor} ${i.invoice_no}`)));
    },
  },
  {
    name: "get_invoice",
    title: "One invoice",
    description: "One supplier invoice by its id (like AP-0004): what Purser read from it (supplier, number, net, VAT, total, due day), the checks it ran and what they found, its status and its earlier versions. list_invoices shows the ids. Read only.",
    inputSchema: obj({ id: idProp("The invoice's id as Purser shows it, like AP-0004 (list_invoices shows them)", ["AP-0004"]) }, ["id"]),
    outputSchema: shape({ invoice: shape({ id: S, vendor: S, invoice_no: S, currency: S, total: S, due_date: S, status: S }) }),
    args: z.object({ id: ID }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const inv = await oneInvoice(c.db, a.id as string) as Inv | null;
      if (!inv) return refuse("not_found", `There is no invoice ${String(a.id)} in ${c.company}'s books.`, { next_tool: "list_invoices" });
      const lines = [
        `${inv.vendor} · invoice ${inv.invoice_no}${inv.issue_date ? ` of ${dayWords(inv.issue_date)}` : ""} · due ${dayWords(inv.due_date)}.`,
        `Total ${eur(inv.total, inv.currency)}${inv.tax ? ` (net ${eur(inv.subtotal ?? "0", inv.currency)}, VAT ${eur(inv.tax, inv.currency)})` : ""}${inv.gl_account ? ` · booked to ${inv.gl_account}` : ""}.`,
        `Status: ${inv.status_words ?? inv.status}${inv.paid_at ? `, paid ${dayWords(inv.paid_at)}` : ""}${inv.proposal_id ? ` · proposal ${inv.proposal_id}` : ""}.`,
        inv.findings?.length ? `Checks found: ${inv.findings.map((f) => f.message).join("; ")}` : "Checks: nothing found.",
      ];
      return answer(`${inv.id}: ${inv.vendor}, ${eur(inv.total, inv.currency)}, ${inv.status_words ?? inv.status}.`, { invoice: inv as unknown as Json }, lines, [RES.invoice(inv.id, `${inv.vendor} ${inv.invoice_no}`)]);
    },
  },
  {
    name: "list_transactions",
    title: "Money movements",
    description: "The transactions register: every money movement on every rail (bank transfer, card, stablecoin), newest first, 10 a page unless limit says otherwise, each with its approval, booking and proof. Filter by rail, currency and days; read on with next_cursor. The ids it shows work in explain_payment and payment_audit_trail. Read only.",
    inputSchema: obj({ rail: { type: "string", pattern: "^[a-z_]{2,40}$", description: "Only this rail, a word like airwallex_transfer or metal", examples: ["airwallex_transfer"] }, currency: { type: "string", pattern: "^[A-Z]{3,4}$", description: "Only this currency, as its code", examples: ["EUR"] }, from: dayProp("Only movements on or after this day", "2026-11-01"), to: dayProp("Only movements on or before this day"), limit: limitProp, cursor: cursorProp() }),
    outputSchema: PAGE,
    args: z.object({ rail: z.string().regex(/^[a-z_]{2,40}$/, "a rail word like airwallex_transfer or metal").optional(), currency: z.string().regex(/^[A-Z]{3,4}$/, "a currency code like EUR").optional(), from: DAY.optional(), to: DAY.optional(), limit: LIMIT.optional(), cursor: z.string().max(200).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const page = await listTransactions(c.db, params({ ...a, limit: a.limit ?? 10 })) as { items: Tx[]; next_cursor: string | null };
      return answer(`${plural(page.items.length, "money movement")}, newest first${page.next_cursor ? "; more with next_cursor" : ""}.`, page as unknown as Json, page.items.map(txLine), page.items.map((t) => RES.payment(t.id, `${t.counterparty} ${eur(t.amount, t.currency)}`)));
    },
  },
  {
    name: "books_report",
    title: "The books",
    description: "A report computed from the ledger: pnl (profit and loss, this year to date), balance (balance sheet), trial (trial balance), vat (a quarter's VAT; the current quarter when quarter is left out), payables or receivables (open items, aged). Read only.",
    inputSchema: obj({ report: { type: "string", enum: [...REPORTS], description: "Which report: pnl, balance, trial, vat, payables or receivables", examples: ["pnl"] }, quarter: quarterProp("For vat only: the quarter, like 2026Q4 (default: the current one)") }, ["report"]),
    outputSchema: shape({ report: { type: "string", enum: [...REPORTS] } }),
    args: z.object({ report: z.enum(REPORTS), quarter: z.string().regex(/^\d{4}Q[1-4]$/, "a quarter like 2026Q4").optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      // The demo company's books end on its own last day, as its overview does.
      const at = c.demo ? c.now.toISOString().slice(0, 10) : undefined;
      const quarter = a.report === "vat" ? (a.quarter as string | undefined) ?? quarterOf(c.now.toISOString()) : undefined;
      const r: Json = { report: a.report, ...(await report(c.db, a.report as string, params({ quarter, to: at, as_of: at }), c.now)) as Json };
      const [sentence, data, lines] = bookLines(c.company, a.report as string, r);
      return answer(sentence, data, lines, [a.report === "vat" ? RES.vat(String(r.quarter ?? a.quarter ?? "")) : RES.book(a.report as string)]);
    },
  },
  {
    name: "agent_decisions",
    title: "What the agents decided",
    description: "The newest decisions in the company's audit trail, in words, newest first: who decided (an agent, the CFO, or Purser's code), what, and when, with how many the agents made in all. A decision code made when no model answered says so; it is never called Claude's. Read only.",
    inputSchema: obj({ limit: { ...limitProp, description: "How many entries at most, 1 to 100 (default 20, short enough for a phone)", examples: [20] } }),
    outputSchema: shape({ agent_decisions: I, by_fallback: I, entries_total: I, items: arr(shape({ at: S, who: S, text: S, by: S })) }),
    args: z.object({ limit: LIMIT.optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const rows = await c.db.select<{ seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }>("audit_rows", {}, { order: ["seq"] });
      // The same counts as the Overview (decisionLog): the agents' decisions in all, then the newest entries shown.
      const log = decisionLog(rows);
      const items = log.entries.slice(0, (a.limit as number | undefined) ?? 20);
      const fallback = log.by_fallback ? `, ${log.by_fallback} of them by code's fallback (no model)` : "";
      return answer(`${plural(log.agent_decisions, "decision")} by agents in all${fallback}. The newest ${items.length} of ${log.entries.length} audit entries:`, { agent_decisions: log.agent_decisions, by_fallback: log.by_fallback, entries_total: log.entries.length, items }, items.map((f) => `- ${dayWords(f.at)} · ${f.who}: ${f.text}`));
    },
  },
  {
    name: "what_needs_attention",
    title: "What needs attention",
    description: "Payables at a glance, per currency in cents: what is open, due within 7 and 30 days, overdue, how many invoices wait for the CFO, a new supplier's check or a person, and what is blocked and why. Takes no arguments. Read only.",
    inputSchema: obj({}),
    outputSchema: shape({ as_of: S, open_cents: { type: "object" }, due_7_days_cents: { type: "object" }, due_30_days_cents: { type: "object" }, overdue_cents: { type: "object" }, waiting: shape({ for_cfo: I, for_supplier_check: I, for_a_person: I }), blocked_by_reason: { type: "object" } }),
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

  {
    name: "cash_position",
    title: "Cash and its projection",
    description: "Net cash in the main currency (money in minus money out on every rail, fees included, since the first movement Purser recorded; not a bank balance), the last 30 days' net flow, and a week-by-week projection from the books' open receivables and payables by due day. A projection from due days, not a forecast model. Read only.",
    inputSchema: obj({ weeks: { type: "integer", minimum: 1, maximum: 13, description: "How many weeks to project, 1 to 13 (default 4)", examples: [4] } }),
    outputSchema: shape({ currency: S, as_of: S, net_cash: S, money_in: S, money_out: S, net_flow_last_30_days: S, open: shape({ receivables: S, payables: S }), projection: arr(shape({ week_from: S, week_to: S, expected_in: S, due_out: S, net: S, projected_net_cash: S })), basis: S }),
    args: z.object({ weeks: z.number().int().min(1).max(13).optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const p = await cashPosition(c.db, c.now, (a.weeks as number | undefined) ?? 4) as { currency: string; as_of: string; net_cash: string; net_flow_last_30_days: string; open: { receivables: string; payables: string }; projection: { week_to: string; expected_in: string; due_out: string; projected_net_cash: string }[] };
      const cur = p.currency, last = p.projection.at(-1)!;
      return answer(`${c.company}${demoTag(c)}: net cash ${eur(p.net_cash, cur)} as of ${dayWords(p.as_of)}; projected ${eur(last.projected_net_cash, cur)} by ${dayWords(last.week_to)} from due days.`, p as unknown as Json, [
        `Last 30 days' net flow ${eur(p.net_flow_last_30_days, cur)} · open receivables ${eur(p.open.receivables, cur)} · open payables ${eur(p.open.payables, cur)}.`,
        ...p.projection.map((w) => `- to ${dayWords(w.week_to)}: in ${eur(w.expected_in, cur)}, out ${eur(w.due_out, cur)}, then ${eur(w.projected_net_cash, cur)}`),
        "A projection from due days in the books, not a bank balance or a model.",
      ], [RES.cash]);
    },
  },
  {
    name: "pending_approvals",
    title: "What waits for the CFO's approval",
    description: "Read only: the invoices filed for the CFO's Face ID and every other proposal with no decision yet (a new supplier, a card limit, a policy change), each with a link to approve it in Purser Cloud. You cannot approve: only the CFO can, with Face ID, in Purser Cloud. Takes no arguments.",
    inputSchema: obj({}),
    outputSchema: shape({ invoices: arr(shape({ id: S, vendor: S, currency: S, total: S, due_date: S, approve_in: S })), proposals: arr(shape({ id: S, kind: S, filed_at: S, approve_in: S })), how_to_approve: S }),
    args: z.object({}).strict(),
    readOnly: true,
    run: async (c) => {
      const p = await pendingApprovals(c.db, c.origin ?? "") as { invoices: { id: string; vendor: string; currency: string; total: string; due_date: string; approve_in: string }[]; proposals: { id: string; kind: string; filed_by: string; approve_in: string }[] };
      const n = p.invoices.length + p.proposals.length;
      return answer(`${plural(n, "item")} waiting for the CFO's Face ID${c.demo ? " (demo data)" : ""}. Approve each in Purser Cloud; no AI can approve.`, p as unknown as Json, [
        ...p.invoices.map((i) => `- ${i.id} · ${i.vendor} · ${eur(i.total, i.currency)} · due ${dayWords(i.due_date)} · approve in ${i.approve_in}`),
        ...p.proposals.map((x) => `- ${x.id} · ${x.kind.replace(/_/g, " ")} · filed by ${x.filed_by} · approve in ${x.approve_in}`),
      ], [RES.approvals, ...p.invoices.map((i) => RES.invoice(i.id, `${i.vendor}, waiting for the CFO`))]);
    },
  },
  {
    name: "cfo_policy",
    title: "The CFO's policy, in plain words",
    description: "The rules Purser holds every payment to, in plain words, and what the company's records say the CFO set: the policy version in force, each agent's card limits, the treasury settings and how many proposals were approved, rejected or expired. Takes no arguments. Read only: no tool changes the policy or a limit.",
    inputSchema: obj({}),
    outputSchema: shape({ rules: arr(S), rules_source: S, policy_version: { anyOf: [{ type: "object" }, { type: "null" }] }, agent_cards: arr(shape({ agent: S, name: S, currency: S, per_purchase: S, per_month: S })), settings: arr(shape({ setting: S, value: S, at: S })), decisions: shape({ approved: I, rejected: I, expired: I }) }),
    args: z.object({}).strict(),
    readOnly: true,
    run: async (c) => {
      const p = await cfoPolicy(c.db) as { rules: string[]; policy_version: { version: number; at: string; sha256: string } | null; agent_cards: { name: string; currency: string; per_purchase: string; per_month: string }[]; settings: { setting: string; value: string }[]; decisions: { approved: number; rejected: number; expired: number } };
      return answer(`${c.company}${demoTag(c)}: every supplier payment needs the CFO's Face ID; agents spend only on their own cards, within limits.`, p as unknown as Json, [
        ...p.rules.map((r) => `- ${r}`),
        p.policy_version ? `Policy version ${p.policy_version.version} since ${dayWords(p.policy_version.at)} (${p.policy_version.sha256.slice(0, 12)}…).` : "No policy version recorded yet.",
        ...p.agent_cards.map((k) => `- ${k.name}: ${eur(k.per_purchase, k.currency)} a purchase, ${eur(k.per_month, k.currency)} a month`),
        ...p.settings.map((x) => `- ${x.setting.replace(/_/g, " ")}: ${/^\d+(\.\d+)?$/.test(x.value) ? Number(x.value).toLocaleString("en-GB", { minimumFractionDigits: 2 }) : x.value}`),
        `Decisions so far: ${p.decisions.approved} approved, ${p.decisions.rejected} rejected, ${p.decisions.expired} expired.`,
      ], [RES.policy]);
    },
  },
  {
    name: "spend_breakdown",
    title: "Spend by agent or supplier",
    description: "Money that moved out, grouped by agent (each agent's own card; supplier invoices the CFO approved as one line) or by supplier, per currency, fees included, with declined charges counted. Optionally between two days. Read only.",
    inputSchema: obj({ by: { type: "string", enum: ["agent", "supplier"], description: "Group by agent or by supplier (default agent)", examples: ["supplier"] }, from: dayProp("Only money out on or after this day", "2026-11-01"), to: dayProp("Only money out on or before this day") }),
    outputSchema: shape({ by: S, items: arr(shape({ key: S, label: S, currency: S, amount: S, count: I, declined: I })), totals: { type: "object" }, basis: S }),
    args: z.object({ by: z.enum(["agent", "supplier"]).optional(), from: DAY.optional(), to: DAY.optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const by = (a.by as "agent" | "supplier" | undefined) ?? "agent";
      const p = await spendBy(c.db, by, (a.from as string | undefined) ?? null, (a.to as string | undefined) ?? null) as { items: { label: string; currency: string; amount: string; count: number; declined: number }[]; totals: Record<string, string> };
      return answer(`Spend by ${by}${c.demo ? " (demo data)" : ""}: ${Object.entries(p.totals).map(([cur, v]) => eur(v, cur)).join(" + ") || "nothing"} out${a.from || a.to ? ` (${a.from ? dayWords(a.from as string) : "start"} to ${a.to ? dayWords(a.to as string) : "now"})` : ""}.`, p as unknown as Json,
        p.items.slice(0, 12).map((i) => `- ${i.label}: ${eur(i.amount, i.currency)} (${plural(i.count, "payment")}${i.declined ? `, ${i.declined} declined` : ""})`));
    },
  },
  {
    name: "vat_summary",
    title: "VAT summary",
    description: "A quarter's VAT from the ledger, as the Dutch return's rubrics: owed (5a), input VAT (5b) and the balance (5c), foreign VAT kept outside the return, and lines without a VAT code. An overview, not a filing. The current quarter when none is given. Read only.",
    inputSchema: obj({ quarter: quarterProp("The quarter, like 2026Q4 (default: the current one)") }),
    outputSchema: shape({ quarter: S, owed_5a_cents: I, input_5b_cents: I, balance_5c_cents: I, uncoded_lines: I }),
    args: z.object({ quarter: z.string().regex(/^\d{4}Q[1-4]$/, "a quarter like 2026Q4").optional() }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const quarter = (a.quarter as string | undefined) ?? quarterOf(c.now.toISOString());
      const r = await report(c.db, "vat", params({ quarter }), c.now) as Json;
      const [sentence, data, lines] = bookLines(c.company, "vat", r);
      return answer(sentence, data, lines, [RES.vat(quarter)]);
    },
  },
  {
    name: "payment_audit_trail",
    title: "A payment's audit trail",
    description: "Every recorded step of one payment, in order: the invoice received and checked, the proposal filed, the CFO's Face ID approval (or the agent's card limit that allowed it), the transfer at the bank, the booking in the ledger. Find it by the payment's id, its invoice's id (AP-0004) or its proposal's id (P-0003). list_transactions shows payment ids; an unpaid invoice has no trail yet. Read only.",
    inputSchema: obj({ id: idProp("A payment id (from list_transactions), an invoice id like AP-0004, or a proposal id like P-0003", ["AP-0004", "P-0003"]) }, ["id"]),
    outputSchema: shape({ payment: shape({ id: S, at: S, amount: S, currency: S, counterparty: S }), approval: { type: "object" }, steps: arr(shape({ seq: I, at: S, who: S, event: S, text: S, row_hash: S })), books: arr(shape({ entry_id: I, posting_date: S, entry_hash: S })) }),
    args: z.object({ id: ID }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const t = await findPayment(c.db, a.id as string);
      if (!t) return refuse("not_found", `No payment in ${c.company}'s books is ${String(a.id)}, or paid that invoice or proposal. list_transactions shows the payment ids; an unpaid invoice has no trail yet.`, { next_tool: "list_transactions" });
      const trail = await auditTrail(c.db, t) as { steps: { at: string; who: string; text: string }[]; books: { entry_id: number; posting_date: string }[] };
      return answer(`${plural(trail.steps.length, "recorded step")} for ${t.counterparty}, ${eur(t.amount, t.currency)} on ${dayWords(t.at)}${c.demo ? " (demo data)" : ""}.`, trail as unknown as Json, [
        ...trail.steps.map((x) => `- ${dayWords(x.at)} · ${x.who}: ${x.text}`),
        ...trail.books.map((e) => `- booked: ledger entry ${e.entry_id} on ${dayWords(e.posting_date)}`),
      ], [RES.payment(t.id, `${t.counterparty} ${eur(t.amount, t.currency)}`), ...(t.invoice?.ap_id ? [RES.invoice(t.invoice.ap_id)] : [])]);
    },
  },
  {
    name: "explain_payment",
    title: "Explain this payment",
    description: "One payment in plain words: who was paid (or paid the company), how much, why, who allowed it and how (the CFO's Face ID over the exact terms, or an agent within its card's limits), where it is booked and whether it reconciles. Find it by the payment's id, its invoice's id (AP-0004) or its proposal's id (P-0003). Read only.",
    inputSchema: obj({ id: idProp("A payment id (from list_transactions), an invoice id like AP-0004, or a proposal id like P-0003", ["P-0008", "AP-0004"]) }, ["id"]),
    outputSchema: shape({ payment: { type: "object" }, explanation: shape({ what: S, allowed_by: S, booked: S, reconciliation: S }), approval: { type: "object" }, steps: arr(), books: arr() }),
    args: z.object({ id: ID }).strict(),
    readOnly: true,
    run: async (c, a) => {
      const t = await findPayment(c.db, a.id as string);
      if (!t) return refuse("not_found", `No payment in ${c.company}'s books is ${String(a.id)}, or paid that invoice or proposal. list_transactions shows the payment ids.`, { next_tool: "list_transactions" });
      const e = explain(t, await auditTrail(c.db, t));
      return answer(e.sentence + (c.demo ? " Demo data, no real money." : ""), e.data, e.lines, [RES.payment(t.id, `${t.counterparty} ${eur(t.amount, t.currency)}`), ...(t.invoice?.ap_id ? [RES.invoice(t.invoice.ap_id)] : [])]);
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
    description: "File a supplier invoice's payment for the CFO's approval: the one tool that adds anything, and only a proposal. Nothing is paid: the CFO approves the exact terms with a passkey (Face ID) in Purser Cloud, or it expires. Purser refuses an invoice that is held, already waiting or paid, and says why. You cannot approve. Needs a token made to propose; never on the demo company.",
    inputSchema: obj({ invoice_id: idProp("The invoice's id, like AP-0004 (list_invoices shows them)", ["AP-0004"]) }, ["invoice_id"]),
    outputSchema: shape({ proposal: shape({ id: S, kind: S, status: S, terms_sha256: S }), paid: { const: false }, next: S }),
    args: z.object({ invoice_id: ID }).strict(),
    readOnly: false,
    run: async (c, a) => {
      if (c.demo) return refuse("demo_read_only", "The demo company is read only: nothing can be proposed in it.");
      if (!c.engine) return refuse("runner_only", NO_ENGINE);
      const id = a.invoice_id as string;
      if (!(await c.engine.invoice(id))) return refuse("not_found", `There is no invoice ${id} in ${c.company}'s Purser.`, { next_tool: "list_invoices" });
      const out = await c.engine.propose(id);
      if (!out.ok) return refuse("refused", `Purser did not file ${id}: ${out.reason}. Nothing was proposed.`, { next: "Tell your user why; check where it stands with get_invoice or pending_approvals." });
      return answer(`Filed ${out.proposal.id} for the CFO. Nothing is paid until the CFO approves these exact terms with Face ID in Purser Cloud; tell your user so.`,
        { proposal: proposalOut(out.proposal), paid: false, next: "The CFO approves or lets it expire in Purser Cloud (Invoices). Call payment_proposal to see its status." },
        [...out.proposal.facts.map(([k, v]) => `- ${k}: ${v}`), ...out.proposal.warnings.map((w) => `Warning: ${w}`)]);
    },
  },
  {
    name: "payment_proposal",
    title: "A payment proposal's status",
    description: "Where a payment proposal stands: waiting for the CFO, approved and paid, refused or expired, with the terms it is for and their SHA-256 (the hash the CFO's passkey signs over). Needs a token made to propose. Read only.",
    inputSchema: obj({ proposal_id: idProp("The proposal's id, like P-0009 (propose_invoice_payment gives it)", ["P-0009"]) }, ["proposal_id"]),
    outputSchema: shape({ proposal: shape({ id: S, kind: S, status: S, terms_sha256: S }) }),
    args: z.object({ proposal_id: ID }).strict(),
    readOnly: true,
    run: async (c, a) => {
      if (!c.engine) return refuse("runner_only", NO_ENGINE);
      const p = await c.engine.proposal(a.proposal_id as string);
      return p ? answer(`${p.id}: ${p.status}.`, { proposal: proposalOut(p) }, p.facts.map(([k, v]) => `- ${k}: ${v}`)) : refuse("not_found", `There is no proposal ${String(a.proposal_id)}.`, { next_tool: "pending_approvals" });
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
    "Start with company_overview or pending_approvals (purser://connection says what this connection can do); explain_payment and payment_audit_trail take a payment, invoice (AP-…) or proposal (P-…) id; the books, invoices, payments and the CFO's policy are also resources (purser://).",
    "You cannot approve, pay, change a limit or write to the books: every payment needs the CFO's Face ID in Purser Cloud, and you must say so when a payment comes up.",
    c.demo ? "This is the demo company: made-up data from a simulated month, no real money. Say so when you show its figures." : "Amounts are the company's own records; quote them as they are."].join(" ");
}

/** Ready-made prompts a client shows (owner, 13 Nov): each asks for the tools that answer it, in plain words. */
export const PROMPTS = [
  { name: "cfo_weekly_brief", title: "CFO weekly brief", description: "This week in five short lines: money in and out, what waits for your Face ID, what is due, what was refused, and what the agents decided.", arguments: [] as { name: string; description: string; required: boolean }[],
    text: () => "Give me my CFO weekly brief from Purser. Call company_overview, what_needs_attention and agent_decisions. Then answer in five short lines: money in and out, what waits for my Face ID, what is due within 7 days, anything refused or blocked, and the agents' notable decisions. Quote amounts exactly as Purser gives them (EUR 1,793.00), and say so if it is the demo company." },
  { name: "needs_face_id", title: "What needs my Face ID?", description: "The invoices waiting for the CFO's approval, with supplier, amount and due day.", arguments: [],
    text: () => "What needs my Face ID in Purser? Call pending_approvals. List each one: supplier or kind, amount, due day, and its link. Then say that I approve each in Purser Cloud with Face ID, and that you cannot approve." },
  { name: "explain_invoice", title: "Explain this invoice", description: "One invoice in plain words: who, what, how much, VAT, when due, what Purser's checks found, and where it stands.", arguments: [{ name: "invoice_id", description: "The invoice's id, like AP-0004", required: true }],
    text: (a: Record<string, string>) => `Explain invoice ${a.invoice_id} from Purser in plain words. Call get_invoice with id ${a.invoice_id}. Say who it is from, the amount and its VAT, when it is due, what Purser's checks found, and where it stands (paid, waiting for my Face ID, or waiting for a new supplier). Keep it short.` },
  { name: "explain_payment", title: "Explain this payment", description: "One payment in plain words: who was paid, why, who allowed it and how, and its audit trail.", arguments: [{ name: "payment_id", description: "A payment id, an invoice id like AP-0004 or a proposal id like P-0003", required: true }],
    text: (a: Record<string, string>) => `Explain payment ${a.payment_id} from Purser in plain words. Call explain_payment with id ${a.payment_id}, then payment_audit_trail with the same id. Say who was paid and why, who allowed it and how (the CFO's Face ID over the exact terms, or an agent within its card's limits), where it is booked, and whether it reconciles. Keep it short.` },
  { name: "cash_outlook", title: "Cash outlook", description: "Net cash now and the next four weeks from due days, with what waits for approval.", arguments: [],
    text: () => "Give me my cash outlook from Purser. Call cash_position and pending_approvals. Answer in four short lines: net cash now, the lowest projected week and why, what is due out soon, and what waits for my Face ID. Say that the projection comes from due days, not a bank balance, and say so if it is the demo company." },
];

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
export interface McpOut { status: number; body: unknown }
const META = "io.modelcontextprotocol/";
/** A JSON-RPC error; data always carries the stable string code (ERROR_CODES), and what else the client can act on. */
const rpcError = (id: unknown, code: number, message: string, why: ErrorCode, data: Json = {}) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, data: { code: why, ...data } } });

/** A tool name that asks for what no MCP tool here can do, for any token: approve, pay, change a limit or write. */
const NEVER_OVER_MCP = /^(approve|authori[sz]e|confirm|reject|cancel|pay|make|execute|send|transfer|refund|sign|release|freeze|unfreeze|raise|set|change|update|edit|write|create|add|insert|delete|remove|post|book)(_|$)|(^|_)(approve|approval|pay|payout|sign|limit)(_|$)/i;
/** What the server says to such a call: the safety model, and the one thing an AI can do instead. */
export const NEVER_SENTENCE = "Purser's MCP server never approves, pays, changes a limit or writes to the books, for any token: every payment needs the CFO's passkey (Face ID) over its exact terms in Purser Cloud. To get an invoice paid, a token made to propose can file it with propose_invoice_payment; then tell your user the CFO approves it.";
/** MCP's own error codes (2026-07-28, schema.ts): the reserved -32020 to -32099 range. */
export const HEADER_MISMATCH = -32020, UNSUPPORTED_PROTOCOL_VERSION = -32022;

const identity = (c: McpCtx) => ({ name: "purser", title: "Purser", version: SERVER_VERSION, description: "Read a company's books in Purser: invoices, payments, cash, VAT, approvals and the CFO's policy. Never approves or pays; with a propose-scoped token it can file a payment for the CFO's approval.",
  ...(c.origin ? { websiteUrl: c.origin, icons: iconsAt(c.origin) } : {}) });
export const iconsAt = iconsOf;
const capabilities = { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { subscribe: false, listChanged: false } };
const modern = (v: string | undefined) => !!v && (MODERN_VERSIONS as readonly string[]).includes(v);
/** resource_link came with 2025-06-18; an older client gets text and structured data only (it ignores the latter). */
const hasLinks = (v: string | undefined) => !v || v >= "2025-06-18";

/** Cursors: an opaque, signed-free offset (lists are the same for every request with this token). */
const cursorOf = (n: number) => btoa(`o:${n}`).replace(/=+$/, "");
function offsetOf(cursor: unknown): number | null {
  if (cursor === undefined || cursor === null) return 0;
  if (typeof cursor !== "string" || cursor.length > 40) return null;
  try { const m = /^o:(\d{1,6})$/.exec(atob(cursor)); return m ? Number(m[1]) : null; } catch { return null; }
}
export const PAGE_SIZE = { tools: 50, prompts: 50, resources: 50, templates: 50 };
function page<T>(all: T[], cursor: unknown, size: number): { items: T[]; nextCursor?: string } | null {
  const at = offsetOf(cursor);
  if (at === null || at > all.length) return null;
  return { items: all.slice(at, at + size), ...(at + size < all.length ? { nextCursor: cursorOf(at + size) } : {}) };
}

/** A tool's result as the protocol carries it: text first, then links (for clients that know them), structured data. */
function wire(r: ToolResult, version: string | undefined): Json {
  const content = [...r.content, ...(hasLinks(version) ? (r.links ?? []).map((l) => ({ type: "resource_link" as const, ...l })) : [])];
  return { content, ...(r.structuredContent ? { structuredContent: r.structuredContent } : {}), ...(r.isError ? { isError: true } : {}) };
}

/** Lists cache within one token for five minutes; reads and discovery a minute. Never shared across tokens. */
const cache = (ms: number) => ({ ttlMs: ms, cacheScope: "private" as const });

async function call(c: McpCtx, m: Rpc & { id: string | number; method: string }, p: Json, isModern: boolean): Promise<{ status?: number; body: Json }> {
  const ok = (result: Json, cacheMs?: number) => ({ body: { jsonrpc: "2.0", id: m.id, result: isModern ? { resultType: "complete", ...result, ...(cacheMs !== undefined ? cache(cacheMs) : {}), _meta: { [`${META}serverInfo`]: identity(c) } } : result } });
  const bad = (code: number, message: string, why: ErrorCode, data?: Json) => ({ body: rpcError(m.id, code, message, why, data) });
  const rctx = { db: c.db, now: c.now, demo: c.demo, origin: c.origin ?? "", company: c.company, canPropose: c.caller.purpose === "claude-propose" };
  switch (m.method) {
    case "server/discover":
      return ok({ supportedVersions: [...PROTOCOL_VERSIONS], capabilities, instructions: instructions(c), ...(isModern ? {} : { serverInfo: identity(c) }) }, 60_000);
    case "ping": return ok({});
    case "tools/list": {
      const pg = page(toolsFor(c.caller), p.cursor, PAGE_SIZE.tools);
      if (!pg) return bad(-32602, "invalid cursor: pass the nextCursor of the previous page, or none for the first", "invalid_cursor");
      return ok({ tools: pg.items.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema,
        ...(c.origin ? { icons: iconsAt(c.origin) } : {}),
        annotations: annotationsOf(t) })), ...(pg.nextCursor ? { nextCursor: pg.nextCursor } : {}) }, 300_000);
    }
    case "tools/call": {
      if (typeof p.name !== "string") return bad(-32602, "tools/call needs params.name, a tool's name from tools/list", "missing_argument");
      const tool = toolsFor(c.caller).find((t) => t.name === p.name);
      if (!tool) {
        const name = p.name.slice(0, 80);
        if (PROPOSE_TOOLS.some((t) => t.name === name)) return bad(-32602, `no tool ${name}: this token reads only; a token made to propose files payments (never approves them)`, "needs_propose_token", { tool: name });
        if (NEVER_OVER_MCP.test(name)) return bad(-32602, `no tool ${name}; tools/list shows the tools this token has. ${NEVER_SENTENCE}`, "not_available_over_mcp", { tool: name });
        return bad(-32602, `no tool ${name}; tools/list shows the tools this token has`, "unknown_tool", { tool: name });
      }
      const args = tool.args.safeParse(p.arguments ?? {});
      if (!args.success) return ok(wire(refuse("invalid_arguments", `The arguments do not fit ${tool.name}: ${args.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ")}. Fix them and call again.`, { next: "Fix the arguments as the tool's inputSchema says and call again." }), c.version));
      try {
        return ok(wire(await tool.run(c, args.data), c.version));
      } catch (e) {
        if (e instanceof BadRequest) return ok(wire(refuse("could_not_answer", `${tool.name} could not answer: ${e.message}.`), c.version));
        throw e;
      }
    }
    case "prompts/list": {
      const pg = page(PROMPTS, p.cursor, PAGE_SIZE.prompts);
      if (!pg) return bad(-32602, "invalid cursor: pass the nextCursor of the previous page, or none for the first", "invalid_cursor");
      return ok({ prompts: pg.items.map((x) => ({ name: x.name, title: x.title, description: x.description, ...(c.origin ? { icons: iconsAt(c.origin) } : {}), ...(x.arguments.length ? { arguments: x.arguments } : {}) })), ...(pg.nextCursor ? { nextCursor: pg.nextCursor } : {}) }, 300_000);
    }
    case "prompts/get": {
      const x = PROMPTS.find((y) => y.name === p.name);
      if (!x) return bad(-32602, `no prompt ${String(p.name).slice(0, 80)}; prompts/list shows them`, "unknown_prompt");
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Record<string, unknown>;
      for (const a of x.arguments) if (a.required && !(typeof args[a.name] === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(args[a.name] as string))) return bad(-32602, `the prompt ${x.name} needs ${a.name}: ${a.description}`, "missing_argument", { argument: a.name });
      return ok({ description: x.description, messages: [{ role: "user", content: { type: "text", text: x.text(args as Record<string, string>) } }] });
    }
    case "resources/list": {
      const pg = page(await listResources(rctx), p.cursor, PAGE_SIZE.resources);
      if (!pg) return bad(-32602, "invalid cursor: pass the nextCursor of the previous page, or none for the first", "invalid_cursor");
      return ok({ resources: pg.items.map((r) => ({ ...r, ...(c.origin ? { icons: iconsAt(c.origin) } : {}) })), ...(pg.nextCursor ? { nextCursor: pg.nextCursor } : {}) }, 60_000);
    }
    case "resources/templates/list": {
      const pg = page(RESOURCE_TEMPLATES, p.cursor, PAGE_SIZE.templates);
      if (!pg) return bad(-32602, "invalid cursor: pass the nextCursor of the previous page, or none for the first", "invalid_cursor");
      return ok({ resourceTemplates: pg.items, ...(pg.nextCursor ? { nextCursor: pg.nextCursor } : {}) }, 300_000);
    }
    case "resources/read": {
      if (typeof p.uri !== "string" || p.uri.length > 300) return bad(-32602, "resources/read needs params.uri, a purser:// URI from resources/list", "missing_argument");
      try {
        return ok({ contents: [await readResource(rctx, p.uri)] }, 60_000);
      } catch (e) {
        // Resource not found: -32602 since 2026-07-28, -32002 before it.
        if (e instanceof NoResource) return bad(isModern ? -32602 : -32002, `Resource not found: ${e.message}`, "resource_not_found", { uri: p.uri });
        throw e;
      }
    }
    default:
      return { status: isModern ? 404 : undefined, body: rpcError(m.id, -32601, `no method ${m.method.slice(0, 80)}; this server answers server/discover, tools/*, prompts/* and resources/*${isModern ? "" : ", initialize and ping"}`, "unknown_method") };
  }
}

/** The mirrored Mcp-Name value, decoded from its Base64 sentinel form when it carries one. */
function headerName(v: string | null): string | null {
  if (v === null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(m[1]!), (ch) => ch.charCodeAt(0))); } catch { return "\u0000invalid"; }
}

/** A request in the current revision: its _meta and its headers must agree (Streamable HTTP, Server Validation). */
async function modernOne(c: McpCtx, m: Rpc, headers: Headers): Promise<McpOut> {
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  const meta = (p._meta && typeof p._meta === "object" ? p._meta : {}) as Json;
  const id = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
  const mismatch = (message: string) => ({ status: 400, body: rpcError(id, HEADER_MISMATCH, `Header mismatch: ${message}`, "header_mismatch") });
  const bodyVersion = meta[`${META}protocolVersion`], headerVersion = headers.get("mcp-protocol-version");
  if (typeof bodyVersion !== "string") return mismatch(`the MCP-Protocol-Version header says ${headerVersion ?? "nothing"}, but params._meta["${META}protocolVersion"] is missing`);
  if (headerVersion === null) return mismatch("the MCP-Protocol-Version header is required");
  if (headerVersion !== bodyVersion) return mismatch(`MCP-Protocol-Version header '${headerVersion}' does not match the body's '${bodyVersion}'`);
  if (!modern(bodyVersion)) return { status: 400, body: rpcError(id, UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version ${bodyVersion}: this server speaks ${MODERN_VERSIONS.join(", ")} per request, and ${LEGACY_VERSIONS.join(", ")} after initialize`, "unsupported_protocol_version", { supported: [...PROTOCOL_VERSIONS], requested: bodyVersion }) };
  if (typeof m.method !== "string") return { status: 400, body: rpcError(id, -32600, "not a JSON-RPC request: method is missing", "invalid_request") };
  const method = headers.get("mcp-method");
  if (method === null) return mismatch("the Mcp-Method header is required");
  if (method !== m.method) return mismatch(`Mcp-Method header '${method}' does not match body value '${m.method}'`);
  if (["tools/call", "prompts/get", "resources/read"].includes(m.method)) {
    const want = m.method === "resources/read" ? p.uri : p.name, got = headerName(headers.get("mcp-name"));
    if (got === null) return mismatch(`the Mcp-Name header is required for ${m.method}`);
    if (got !== want) return mismatch(`Mcp-Name header value '${got.slice(0, 80)}' does not match body value '${String(want).slice(0, 80)}'`);
  }
  if (id === null) return { status: 202, body: null }; // a notification: taken, no answer
  const out = await call({ ...c, version: bodyVersion }, { ...m, id, method: m.method }, p, true);
  return { status: out.status ?? 200, body: out.body };
}

/** A request in a legacy revision (initialize, then plain requests; no session is kept). */
async function legacyOne(c: McpCtx, m: Rpc, headerVersion: string | null): Promise<Json | null> {
  const isRequest = typeof m.method === "string" && (typeof m.id === "string" || typeof m.id === "number");
  if (typeof m.method === "string" && m.id === undefined) return null; // a notification: taken, no answer
  if (!isRequest) return m.method === undefined && ("result" in m || "error" in m) ? null : rpcError(m.id, -32600, "not a JSON-RPC request", "invalid_request");
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as Json;
  if (m.method === "initialize") {
    const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
    const version = (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
    return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: version, capabilities, serverInfo: identity(c), instructions: instructions(c) } };
  }
  const version = headerVersion ?? "2025-03-26";
  return (await call({ ...c, version }, m as Rpc & { id: string | number; method: string }, p, false)).body;
}

/**
 * One POST to /mcp. A body whose request carries params._meta[protocolVersion] (or a current-revision header) is served
 * by the current revision; anything else (initialize, and the requests after it) by the legacy ones. Batches are legacy
 * only (2025-03-26); 202 when the body held only notifications or answers.
 */
export async function mcpAnswer(c: McpCtx, text: string, headers: Headers = new Headers()): Promise<McpOut> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { status: 400, body: rpcError(null, -32700, "Parse error: the body is not JSON", "parse_error") }; }
  const headerVersion = headers.get("mcp-protocol-version");
  const batch = Array.isArray(parsed);
  const msgs = (batch ? parsed : [parsed]) as Rpc[];
  if (!msgs.length || msgs.length > 20 || msgs.some((x) => !x || typeof x !== "object")) return { status: 400, body: rpcError(null, -32600, "Invalid request: one JSON-RPC message, or (before 2025-06-18) a batch of 1 to 20", "invalid_request") };
  const metaVersion = (x: Rpc) => { const pm = (x.params as Json | undefined)?._meta as Json | undefined; return pm && typeof pm === "object" ? pm[`${META}protocolVersion`] : undefined; };
  const isModern = !batch && msgs[0]!.method !== "initialize" && (metaVersion(msgs[0]!) !== undefined || modern(headerVersion ?? undefined));
  if (isModern) return modernOne(c, msgs[0]!, headers);
  if (batch && msgs.some((x) => metaVersion(x) !== undefined)) return { status: 400, body: rpcError(null, -32600, "Invalid request: a batch is not part of protocol 2026-07-28; send one request per POST", "invalid_request") };
  if (headerVersion !== null && !(LEGACY_VERSIONS as readonly string[]).includes(headerVersion)) {
    return { status: 400, body: rpcError(null, UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version ${headerVersion}`, "unsupported_protocol_version", { supported: [...PROTOCOL_VERSIONS], requested: headerVersion }) };
  }
  const out: Json[] = [];
  for (const m of msgs) { const r = await legacyOne(c, m, headerVersion); if (r) out.push(r); }
  if (!out.length) return { status: 202, body: null };
  return { status: 200, body: batch ? out : out[0] };
}
