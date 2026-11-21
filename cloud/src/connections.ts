// Connections to other systems, read and export only (Connect any AI, part B, 13 Nov). Nothing here moves money, approves
// or writes to the books:
//   events     what a push from the runner changed, as business events for the company's signed webhook:
//              payment.paid (an invoice became paid), approval.needed (an invoice was filed for the CFO's Face ID),
//              books.closed (a year-end closing entry reached the ledger). Ids, amounts and days only; never a name.
//   chat       an event as a Slack (Block Kit) or Microsoft Teams (Adaptive Card) message: a FORMAT, for a team that
//              relays its webhook into chat itself; approval alerts (./alerts.ts) post the same formats to a Slack or
//              Teams incoming webhook an owner sets.
//   csv        supplier invoices and ledger journals as files Xero, QuickBooks Online and Exact Online import: FORMAT
//              EXPORTS, built from each product's published import columns (read 13 Nov), not live integrations.

import { isClosingKey } from "../../src/ledger/reports.js";
import type { SyncBatch } from "./sync.js";
import type { TenantDb } from "./tenant.js";

export const BUSINESS_EVENTS = ["payment.paid", "approval.needed", "books.closed"] as const;
export type BusinessEvent = { type: (typeof BUSINESS_EVENTS)[number]; data: Record<string, string> };

/** The invoices' statuses before a push, for the ids the push names (read before applySync). */
export async function statusesBefore(db: TenantDb, batch: SyncBatch): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const i of batch.invoices) {
    const r = await db.one<{ status: string }>("invoices", { id: i.id });
    if (r) out.set(i.id, r.status);
  }
  return out;
}

/**
 * The business events a push caused: compared with the statuses before it and with what the cloud now holds (a replayed
 * or older push changes nothing, so it raises nothing). The data are ids, amounts, currencies and days; the console link
 * says where to look, and approving stays the CFO's, in Purser Cloud, with Face ID.
 */
export async function eventsOf(db: TenantDb, batch: SyncBatch, before: Map<string, string>, ledgerHeadBefore: number, origin: string): Promise<BusinessEvent[]> {
  const events: BusinessEvent[] = [];
  for (const i of batch.invoices) {
    const now = await db.one<{ status: string; currency: string; total: string; due_date: string; body_json: string }>("invoices", { id: i.id });
    if (!now || now.status === before.get(i.id)) continue;
    const body = JSON.parse(now.body_json) as { proposal_id?: string | null; paid_at?: string | null };
    // A backlog's first push (an invoice the cloud never held, already paid) is history, not news.
    if (now.status === "paid" && before.has(i.id)) events.push({ type: "payment.paid", data: { invoice_id: i.id, amount: now.total, currency: now.currency, paid_at: body.paid_at ?? i.updated_at, ...(body.proposal_id ? { proposal_id: body.proposal_id } : {}), link: `${origin}/#/invoices` } });
    if (now.status === "waiting_cfo") events.push({ type: "approval.needed", data: { invoice_id: i.id, amount: now.total, currency: now.currency, due_date: now.due_date, ...(body.proposal_id ? { proposal_id: body.proposal_id } : {}), approve_in: `${origin}/#/invoices`, note: "Only the CFO approves, in Purser Cloud, with Face ID." } });
  }
  for (const e of batch.ledger_entries.filter((x) => x.entry_id > ledgerHeadBefore && isClosingKey(x.source_key))) {
    const stored = await db.one<{ entry_hash: string }>("ledger_entries", { entry_id: e.entry_id });
    if (stored?.entry_hash === e.entry_hash) events.push({ type: "books.closed", data: { year: e.source_key!.slice("close-year:".length), entry_id: String(e.entry_id), posting_date: e.posting_date, entry_hash: e.entry_hash, link: `${origin}/#/books` } });
  }
  return events;
}

const WORDS: Record<BusinessEvent["type"], (d: Record<string, string>) => { title: string; text: string; button: string; url: string }> = {
  "payment.paid": (d) => ({ title: "Payment paid", text: `Invoice ${d.invoice_id} was paid: ${d.currency} ${d.amount}${d.proposal_id ? ` (approved by the CFO as ${d.proposal_id})` : ""}.`, button: "Open in Purser", url: d.link ?? "" }),
  // An approval alert (./alerts.ts) adds the payee and why it waits; the signed webhook's event carries neither (no names).
  "approval.needed": (d) => ({ title: `${d.test_money ? "[TEST MONEY] " : ""}Waiting for the CFO's Face ID`,
    text: d.payee
      ? `${d.currency} ${d.amount} to ${d.payee} (invoice ${d.invoice_id}${d.due_date ? `, due ${d.due_date}` : ""}) waits for the CFO's approval. Why: ${d.why ?? ""} This message cannot approve anything: only the CFO's passkey (Face ID), in Purser Cloud, can.`
      : `Invoice ${d.invoice_id}, ${d.currency} ${d.amount}, due ${d.due_date}, waits for the CFO's approval. Only the CFO approves, in Purser Cloud, with Face ID.`,
    button: "Review in Purser Cloud", url: d.approve_in ?? "" }),
  "books.closed": (d) => ({ title: `Books closed for ${d.year}`, text: `The year-end closing entry for ${d.year} is in the ledger (entry ${d.entry_id}, ${d.posting_date}).`, button: "Open the books", url: d.link ?? "" }),
};

/** An event as a chat message: Slack's Block Kit (for an incoming webhook) or a Teams Adaptive Card (for a workflow). */
export function chatMessage(e: BusinessEvent, to: "slack" | "teams"): Record<string, unknown> {
  const w = WORDS[e.type](e.data);
  if (to === "slack") {
    return { text: `${w.title}: ${w.text}`, blocks: [
      { type: "header", text: { type: "plain_text", text: w.title } },
      { type: "section", text: { type: "mrkdwn", text: w.text } },
      ...(w.url.startsWith("https://") ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: w.button }, url: w.url }] }] : []),
      { type: "context", elements: [{ type: "mrkdwn", text: `Purser · ${e.type}` }] },
    ] };
  }
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5",
    body: [{ type: "TextBlock", text: w.title, weight: "Bolder", size: "Medium", wrap: true }, { type: "TextBlock", text: w.text, wrap: true }, { type: "TextBlock", text: `Purser · ${e.type}`, isSubtle: true, size: "Small" }],
    ...(w.url.startsWith("https://") ? { actions: [{ type: "Action.OpenUrl", title: w.button, url: w.url }] } : {}),
  } }] };
}

// CSV exports. RFC 4180: comma, CRLF, a field quoted when it holds a comma, quote or line break; a cell that would start
// a spreadsheet formula (= + - @ tab) is prefixed with ' (OWASP CSV injection) unless it is a plain number.
const cell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: (string | number | null | undefined)[][]) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const rate = (net: string, tax: string) => (Number(net) ? ((Number(tax) / Number(net)) * 100).toFixed(0) : "0");
const cents = (c: number) => (c / 100).toFixed(2);

export const CSV_FORMATS = { xero: ["bills", "journals"], quickbooks: ["bills"], exact: ["bills", "journals"] } as const;
export type CsvFormat = keyof typeof CSV_FORMATS;

export interface Bill { id: string; vendor: string; invoice_no: string; issue_date?: string; due_date: string; currency: string; subtotal?: string; tax?: string; total: string; gl_account?: string; doc_kind?: string; status: string }

/** Supplier invoices (not credit notes, not rejected), issued between two days, oldest first. */
export async function bills(db: TenantDb, from: string | null, to: string | null): Promise<Bill[]> {
  const rows = await db.select<{ id: string; body_json: string; status: string }>("invoices", {}, { order: ["id"] });
  return rows.map((r) => ({ ...(JSON.parse(r.body_json) as Bill), id: r.id, status: r.status }))
    .filter((b) => b.doc_kind !== "credit_note" && !["rejected", "blocked"].includes(b.status))
    .filter((b) => (!from || (b.issue_date ?? "") >= from) && (!to || (b.issue_date ?? "") <= to));
}

/** One file: the header row each product documents, one row per invoice (one line each: net, VAT, account). */
export async function billsCsv(db: TenantDb, format: CsvFormat, from: string | null, to: string | null): Promise<string> {
  const all = await bills(db, from, to);
  const net = (b: Bill) => b.subtotal ?? b.total, tax = (b: Bill) => b.tax ?? "0.00";
  const what = (b: Bill) => `${b.vendor} invoice ${b.invoice_no} (Purser ${b.id})`;
  if (format === "xero") {
    // Xero, "Import bills and credit notes": one row per line, grouped by InvoiceNumber; dates DD/MM/YYYY; amounts
    // tax-exclusive here (choose "Tax exclusive" at import); TaxType holds the rate until mapped to the org's tax rate.
    return csv(["*ContactName", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "TaxAmount", "Currency"],
      all.map((b) => [b.vendor, b.invoice_no, dmy(b.issue_date ?? ""), dmy(b.due_date), what(b), 1, net(b), b.gl_account ?? "", `${rate(net(b), tax(b))}%`, tax(b), b.currency]));
  }
  if (format === "quickbooks") {
    // QuickBooks Online, "Import bills": the columns are mapped in its import screen; these are its required ones.
    return csv(["Bill No", "Supplier", "Bill Date", "Due Date", "Account", "Line Description", "Line Amount", "Line Tax Code", "Line Tax Amount", "Currency"],
      all.map((b) => [b.invoice_no, b.vendor, dmy(b.issue_date ?? ""), dmy(b.due_date), b.gl_account ?? "", what(b), net(b), `${rate(net(b), tax(b))}%`, tax(b), b.currency]));
  }
  // Exact Online, "Inkoopboekingen" import template, its columns verbatim; dates year-month-day (Exact's D2), decimal dot (N1).
  return csv(["Dagboek: Code", "Boekjaar", "Periode", "Boekstuknummer", "Omschrijving: Kopregel", "Factuurdatum", "Vervaldatum", "Valuta", "Wisselkoers", "Betalingsconditie: Code", "Ordernummer", "Uw ref.", "Betalingsreferentie", "Code", "Naam", "Grootboekrekening", "Omschrijving", "BTW-code", "BTW-percentage", "Bedrag", "Aantal", "BTW-bedrag", "Opmerkingen", "Project", "Van", "Naar", "1099", "Kostenplaats: Code", "Kostenplaats: Omschrijving", "Kostendrager: Code", "Kostendrager: Omschrijving"],
    all.map((b) => { const d = b.issue_date ?? b.due_date; return ["", d.slice(0, 4), String(Number(d.slice(5, 7))), "", `${b.vendor} ${b.invoice_no}`, d, b.due_date, b.currency, "", "", "", b.invoice_no, "", "", b.vendor, b.gl_account ?? "", what(b), "", rate(net(b), tax(b)), net(b), 1, tax(b), `Purser ${b.id}`, "", "", "", "", "", "", "", ""]; }));
}

/** The ledger's entries between two days as journals: Xero manual journals (debit +, credit −) or Exact memoriaal. */
export async function journalsCsv(db: TenantDb, format: "xero" | "exact", from: string | null, to: string | null): Promise<string> {
  const entries = (await db.select<{ entry_id: number; posting_date: string; description: string }>("ledger_entries", {}, { order: ["entry_id"] }))
    .filter((e) => (!from || e.posting_date >= from) && (!to || e.posting_date <= to));
  const lines = await db.select<{ entry_id: number; line_no: number; account: string; currency: string; debit_cents: number; credit_cents: number; vat_code: string | null }>("ledger_lines", {}, { order: ["entry_id", "line_no"] });
  const by = new Map<number, typeof lines>();
  for (const l of lines) (by.get(l.entry_id) ?? by.set(l.entry_id, []).get(l.entry_id)!).push(l);
  const rows: (string | number)[][] = [];
  for (const e of entries) {
    const ls = by.get(e.entry_id) ?? [];
    ls.forEach((l, i) => {
      const amount = cents(l.debit_cents - l.credit_cents);
      if (format === "xero") rows.push([i === 0 ? `${e.description} (Purser entry ${e.entry_id})` : "", i === 0 ? dmy(e.posting_date) : "", e.description, l.account, l.vat_code ?? "", amount]);
      else rows.push(["", e.posting_date.slice(0, 4), String(Number(e.posting_date.slice(5, 7))), e.entry_id, l.currency, "", e.posting_date, l.account, e.description, `Purser ${e.entry_id}`, amount, "", l.vat_code ?? "", "", "", "", "", "", "", "", "", "", ""]);
    });
  }
  // Xero, "Add, import and post manual journals": Narration and Date on a journal's first row only; debits positive.
  if (format === "xero") return csv(["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount"], rows);
  // Exact Online, "Memoriaalboekingen" import template, its columns verbatim; one Bedrag, debit positive, credit negative.
  return csv(["Dagboek: Code", "Boekjaar", "Periode", "Boekstuknummer", "Valuta", "Wisselkoers", "Boekingsdatum", "Grootboekrekening", "Omschrijving", "Onze ref.", "Bedrag", "Aantal", "BTW-code", "BTW-percentage", "BTW-bedrag", "Opmerkingen", "Project", "Kostenplaats: Code", "Kostenplaats: Omschrijving", "Kostendrager: Code", "Kostendrager: Omschrijving", "Code", "Naam"], rows);
}

/**
 * The labels, honest and never upgraded (docs/integrations/README.md uses the same words, and test/connections-hub.test.ts
 * holds the two together): live (built and running), sandbox or testnet (live calls, test money, not production), format
 * export (a file or message in another product's documented format; no live connection to that product), built and not
 * tested live (the code exists and is tested against stand-ins), built and run once in a sandbox. Something planned is
 * not in this catalogue: the hub says "planned".
 */
export type ConnectionKind = "live" | "sandbox" | "testnet" | "format export" | "built, not tested live" | "built, run once in a sandbox";
/** The hub's groups, in its order. */
export const CONNECTION_GROUPS = ["rails", "ai", "api", "no-code", "accounting", "more"] as const;
export type ConnectionGroup = (typeof CONNECTION_GROUPS)[number];
export interface Connection {
  name: string; kind: ConnectionKind; direction: "read" | "export" | "notify"; group: ConnectionGroup; where: string; what: string;
  /** Its detailed guide in the repository, as a link (REPO_BLOB + a path test/connections-hub.test.ts finds on disk). */
  doc: string;
  /** A stable id: the console's actions and logos key on it. */
  id: string;
  /** What a company needs to connect it, in a sentence. */
  needs: string;
  /** The ids in GET /v1/connections/mine that say where it stands for one company; empty: nothing per company to connect. */
  company: string[];
  /** The dated run behind a live, sandbox, testnet or run-once label (a link to a file in the repository), when there is one. */
  record?: string;
}
/** A connection that moves money: only within the limits the CFO signed, or after the CFO's Face ID on the exact terms. */
export interface MoneyConnection extends Omit<Connection, "direction"> { direction: "pay" }
/** Not built yet (the hub's "planned" rows): named with what it needs, never with a stronger label. */
export interface PlannedConnection { id: string; name: string; group: ConnectionGroup; what: string; needs: string; doc: string }
type Extra = Pick<Connection, "id" | "needs" | "company" | "record">;

/**
 * Per connection, by name: its id, what a company needs to connect it, the per-company rows that say where it stands
 * (GET /v1/connections/mine, cloud/src/yourConnections.ts) and the dated run behind its label. test/connections-hub.test.ts
 * holds every catalogue entry to one of these, and every record to a file on disk.
 */
const EXTRA: Record<string, Omit<Extra, "record"> & { record?: string }> = {
  "Airwallex": { id: "airwallex", company: ["airwallex"], record: "docs/runs/2026-11-20-airwallex-soak.md", needs: "Purser's sandbox runs today. A company's own Airwallex account connects here by OAuth once the platform registers its Airwallex app." },
  "Alta (formerly Metal)": { id: "alta", company: [], record: "docs/runs/2026-11-19-alta-series.md", needs: "The runner with an Alta testnet RPC (METAL_RPC_URL) and a wallet per agent; test money only." },
  "Visa via Airwallex Airi": { id: "visa-airi", company: [], record: "docs/runs/2026-11-14-vic-5.md", needs: "The runner with KIT11_AIRI_RAIL=on, the Airwallex sandbox keys and Airi's test card." },
  "T:0 (outside ledger)": { id: "t0", company: [], record: "docs/runs/2026-11-14-t0-readback.md", needs: "A T:0 API key on the runner (T0_API_KEY); npm run t0 posts the journal and reads it back." },
  "Agent API on the runner (local MCP)": { id: "agent-api", company: [], record: "docs/runs/2026-10-29-agent-api.md", needs: "The runner: npm run -s mcp with KIT11_AGENT naming the outside agent; each card and raise waits for the CFO's Face ID." },
  "MCP server (Connect any AI)": { id: "mcp", company: ["mcp"], needs: "A connector token (Connect your AI, owners) or the client's OAuth sign-in." },
  "Claude": { id: "claude", company: ["mcp"], needs: "claude.ai: Settings, Connectors, Add custom connector, paste the /mcp address, then your connector token." },
  "ChatGPT": { id: "chatgpt", company: [], needs: "The /mcp address and a connector token; its exact steps are on Setup for each AI." },
  "Cursor": { id: "cursor", company: [], needs: "The Add to Cursor link on Setup for each AI and a connector token." },
  "VS Code": { id: "vscode", company: [], needs: "The Add to VS Code link on Setup for each AI and a connector token." },
  "Gemini CLI": { id: "gemini", company: [], needs: "gemini mcp add with the /mcp address and a connector token." },
  "Windsurf": { id: "windsurf", company: [], needs: "The /mcp address and a connector token in its MCP config." },
  "Airwallex sandbox, read only (Code Mode MCP)": { id: "awx-codemode", company: [], needs: "The same connector token, at /mcp/airwallex instead of /mcp." },
  "Purser's books in Code Mode (MCP)": { id: "codemode", company: [], needs: "The same connector token, at /mcp/codemode instead of /mcp, and the deployment's Worker Loader binding (LOADER); without it execute says so." },
  "Read API (REST) and its OpenAPI": { id: "rest", company: ["api_keys"], needs: "An API key with the read scope (Settings, API keys)." },
  "Webhooks": { id: "webhook", company: ["webhook"], needs: "An https address you own; Purser shows its signing secret once." },
  "TypeScript and Python SDKs": { id: "sdks", company: ["api_keys"], needs: "An API key (read, or read and propose) and the SDK from sdk/typescript or sdk/python." },
  "A2A Agent Card": { id: "a2a", company: [], needs: "Nothing: the card is public at /.well-known/agent.json." },
  "Zapier and Make (HTTP modules)": { id: "zapier-make", company: ["api_keys", "webhook"], needs: "A read and propose key and the signed webhook; the recipes are in the guide." },
  "n8n node": { id: "n8n", company: ["api_keys"], needs: "Build the node from integrations/n8n, link it into your n8n, and give it a read and propose key." },
  "Xero": { id: "xero-csv", company: [], needs: "Nothing to connect: download the CSV and import it in Xero." },
  "Xero (API)": { id: "xero-runner", company: [], needs: "The owner's Xero OAuth app on the runner." },
  "QuickBooks Online": { id: "quickbooks-csv", company: [], needs: "Nothing to connect: download the CSV and import it in QuickBooks Online." },
  "Exact Online (CSV)": { id: "exact-csv", company: [], needs: "Nothing to connect: download the CSV and import it with Exact's import template." },
  "Exact Online (API)": { id: "exact", company: ["exact"], needs: "The platform registers Purser Cloud's Exact app; then Connect Exact Online here, and the runner sets ERP_EXACT_OAUTH=on." },
  "Xero bills (connected in Purser Cloud)": { id: "xero", company: ["xero"], needs: "The platform registers Purser Cloud's Xero app; then Connect Xero here and pick the organisation." },
  "QuickBooks Online (API)": { id: "quickbooks", company: ["quickbooks"], needs: "The platform registers Purser Cloud's Intuit app; then Connect QuickBooks here. Sending bills is planned." },
  "Moneybird (API)": { id: "moneybird", company: ["moneybird"], record: "docs/runs/2026-11-12-moneybird-sandbox.md", needs: "A Moneybird API token with the documents scope on the runner; connecting here as well once the platform registers its Moneybird app." },
  "Business Central and Odoo (API)": { id: "bc-odoo", company: [], needs: "The company's Business Central or Odoo credentials on the runner; npm run erp -- sync --dry-run first." },
  "Peppol invoices (UBL, BIS Billing 3.0)": { id: "peppol-ubl", company: [], needs: "Nothing to connect: a UBL file goes into the payables inbox like a PDF." },
  "ISO 20022 pacs.008": { id: "iso20022", company: [], needs: "Nothing to connect: npm run iso20022 writes the message for a paid invoice." },
  "Slack and Microsoft Teams messages": { id: "slack-teams", company: ["slack", "teams"], needs: "Your own Slack incoming webhook or Teams Workflow URL (Slack and Teams, below)." },
  "Invoices by e-mail (forwarded from Gmail or Outlook)": { id: "inbox", company: ["inbox"], needs: "A mail domain routed to this cloud (the platform's step), then a forwarding rule in Gmail or Outlook." },
  "Sign in with Google, Microsoft and Apple": { id: "sign-in", company: ["sign_in_google", "sign_in_microsoft", "sign_in_apple"], needs: "The platform's OAuth apps; then each person links their own account with their passkey (Settings)." },
  "Approval alerts (e-mail, WhatsApp, Slack, Teams)": { id: "alerts", company: ["alerts"], needs: "An e-mail address, a WhatsApp number or a Slack or Teams webhook (Alerts, below); e-mail and WhatsApp need the platform's provider keys." },
  "Google Workspace and Microsoft 365": { id: "workplace", company: [], needs: "The owner's Google or Microsoft OAuth apps on the runner." },
  "Full export": { id: "export", company: [], needs: "Nothing: an owner downloads it in Settings, Your data." },
};
const withExtra = <T extends { name: string }>(c: T): T & Extra => {
  const x = EXTRA[c.name];
  if (!x) throw new Error(`connections: no id, needs and company for ${c.name}`);
  return { ...c, ...x, ...(x.record ? { record: `${REPO_BLOB}${x.record}` } : {}) };
};

/** Where the guides live: the repository on GitHub. */
export const REPO_BLOB = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The hub: every way in or out of Purser, each labelled, with a quickstart (docs/integrations/README.md). */
export const HUB_DOC = "docs/integrations/README.md";
const doc = (path: string) => `${REPO_BLOB}${path}`;

export interface ConnectionsCatalogue {
  rule: string; connections: Connection[];
  money_rule: string; money: MoneyConnection[];
  /** Not built yet (the hub's "planned" rows). */
  planned: PlannedConnection[];
  /** The hub (every connection with a quickstart) and the cloud's per-client setup page for AI over MCP. */
  hub: string; connect_ai: string;
}

/** Every connection Purser has to other systems, labelled honestly; built per request from constants (no work at load). */
export function connectionsCatalogue(origin: string): ConnectionsCatalogue {
  const client = (name: string, kind: ConnectionKind, anchor: string, what: string): Omit<Connection, keyof Extra> => ({ name, kind, direction: "read", group: "ai", where: `${origin}/connect-ai`, what, doc: doc(`docs/connect-claude.md#${anchor}`) });
  return {
    rule: "Every connection reads, notifies or exports. None moves money, approves a payment, changes a limit or writes to Purser's books; an accounting system receives drafts or entries a person there checks. Every payment needs the CFO's Face ID in Purser Cloud.",
    connections: ([
      { name: "T:0 (outside ledger)", kind: "sandbox", direction: "export", group: "rails", where: "npm run t0 (src/accounting/t0.ts, the runner)", what: "Purser's journal entries posted to T:0's shared sandbox entity and read back, account by account. A ledger: it moves no money.", doc: doc("docs/t0.md") },
      { name: "MCP server (Connect any AI)", kind: "live", direction: "read", group: "ai", where: `${origin}/mcp`, what: "Claude, ChatGPT, Cursor, VS Code, Gemini CLI, Windsurf and any MCP client read the books: 14 read tools, resources, prompts. OAuth 2.1 or a connector token.", doc: doc("docs/connect-any-ai.md") },
      client("Claude", "live", "claude", "claude.ai, the Claude apps and Claude Code, as a custom connector. Added by the owner in the Claude iOS app on 13 Nov."),
      client("ChatGPT", "built, not tested live", "chatgpt", "A custom MCP server with OAuth (Client ID Metadata Document). Set up from OpenAI's documentation; not yet tried live."),
      client("Cursor", "built, not tested live", "cursor", "mcp.json or the Add to Cursor link on /connect-ai. From Cursor's documentation; not yet tried live."),
      client("VS Code", "built, not tested live", "vs-code-github-copilot-agent-mode", "GitHub Copilot agent mode: the Add to VS Code link on /connect-ai or MCP: Add Server. From VS Code's documentation; not yet tried live."),
      client("Gemini CLI", "built, not tested live", "gemini-cli", "gemini mcp add --transport http. From the Gemini CLI documentation; not yet tried live."),
      client("Windsurf", "built, not tested live", "windsurf-now-devin-desktop", "serverUrl and headers in its MCP config. From Devin's documentation; not yet tried live."),
      { name: "Airwallex sandbox, read only (Code Mode MCP)", kind: "built, not tested live", direction: "read", group: "ai", where: `${origin}/mcp/airwallex`, what: "A second MCP server with two tools, search and execute: an AI reads the Airwallex sandbox (balances, transfers, FX, cards) with GET calls only, each checked before it is sent. Tested against a stand-in gateway; no live read is on record yet.", doc: doc("docs/codemode.md") },
      { name: "Purser's books in Code Mode (MCP)", kind: "built, not tested live", direction: "read", group: "ai", where: `${origin}/mcp/codemode`, what: "A third MCP server with two tools: search gives a typed TypeScript API generated from Purser's read tools, and execute runs the AI's code against it in a fresh Cloudflare Dynamic Worker (Worker Loader) with no network, no secrets and this company's books only. Read only: it never proposes, approves or pays. Tested in local workerd with a real Worker Loader; not yet run on Cloudflare, which needs the LOADER binding.", doc: doc("docs/codemode.md") },
      { name: "Read API (REST) and its OpenAPI", kind: "live", direction: "read", group: "api", where: `${origin}/v1/openapi.read.json`, what: "Invoices, documents, suppliers, payments, the transactions register, the ledger and its reports, for a read-scoped key.", doc: doc("docs/connections.md#the-read-apis-openapi") },
      { name: "Webhooks", kind: "live", direction: "notify", group: "api", where: `${origin}/v1/webhook`, what: `Signed POSTs (x-purser-signature: t=<seconds>,v1=<HMAC-SHA256 of t.body>) for three business events (${BUSINESS_EVENTS.join(", ")}), the runner's alerts and security events.`, doc: doc("docs/connections.md#webhooks") },
      { name: "TypeScript and Python SDKs", kind: "built, not tested live", direction: "read", group: "api", where: "sdk/typescript, sdk/python", what: "Clients for the API with no approve method, tested against Purser Cloud in-process.", doc: doc("docs/integrations/README.md#typescript-sdk") },
      { name: "A2A Agent Card", kind: "built, not tested live", direction: "read", group: "api", where: `${origin}/.well-known/agent.json`, what: "Purser's skills in the Agent2Agent card format, for discovery; each skill reads or proposes.", doc: doc("docs/integrations/README.md#a2a-agent-card") },
      { name: "Zapier and Make (HTTP modules)", kind: "built, not tested live", direction: "read", group: "no-code", where: "docs/integrations/no-code.md", what: "Recipes on the plain HTTP modules and the signed webhook, written from the OpenAPI document; the requests are tested in-process, not run in Zapier or Make.", doc: doc("docs/integrations/no-code.md") },
      { name: "n8n node", kind: "built, not tested live", direction: "read", group: "no-code", where: "integrations/n8n", what: "A community node with no approve operation; not yet built or published to npm.", doc: doc("integrations/n8n/README.md") },
      { name: "Xero", kind: "format export", direction: "export", group: "accounting", where: `${origin}/v1/export/csv/xero/bills`, what: "Bills and manual journals as CSV in Xero's import columns.", doc: doc("docs/connections.md#accounting-exports-format-exports") },
      { name: "Xero (API)", kind: "built, not tested live", direction: "export", group: "accounting", where: "src/workplace/xero.ts (the runner)", what: "Contacts and manual journals through Xero's API, tested against a mock; needs the owner's OAuth app.", doc: doc("docs/integrations/workplace.md") },
      { name: "QuickBooks Online", kind: "format export", direction: "export", group: "accounting", where: `${origin}/v1/export/csv/quickbooks/bills`, what: "Bills as CSV with QuickBooks' required import columns.", doc: doc("docs/connections.md#accounting-exports-format-exports") },
      { name: "Exact Online (CSV)", kind: "format export", direction: "export", group: "accounting", where: `${origin}/v1/export/csv/exact/bills`, what: "Purchase entries (Inkoopboekingen) and journals (Memoriaalboekingen) as CSV in Exact's import template columns.", doc: doc("docs/connections.md#accounting-exports-format-exports") },
      { name: "Exact Online (API)", kind: "built, not tested live", direction: "export", group: "accounting", where: `${origin}/v1/connect/exact/start; src/erp/exact.ts (the runner)`, what: "Each company's owner connects its own Exact Online administration in Purser Cloud (Connections, \"Connect Exact Online\"; tokens sealed per company); the runner's connector (ERP_EXACT_OAUTH=on) then posts purchase invoices and journals through Exact's REST API with that company's token. Not yet run against a live Exact administration.", doc: doc("docs/erp.md#exact-online") },
      { name: "Xero bills (connected in Purser Cloud)", kind: "built, not tested live", direction: "export", group: "accounting", where: `${origin}/v1/connect/xero/start, ${origin}/v1/connect/xero/bills`, what: "Each company's owner connects its own Xero organisation in Purser Cloud (Connections, \"Connect Xero\"; OAuth2 with PKCE, tokens sealed per company, refreshed, disconnect at any time) and sends its supplier invoices there as DRAFT bills. Purser never authorises or pays a bill in Xero. Tested with a stand-in shaped like Xero's documentation; not yet run against a Xero demo company.", doc: doc("docs/integrations/owner-setup.md#16-xero") },
      { name: "QuickBooks Online (API)", kind: "built, not tested live", direction: "export", group: "accounting", where: `${origin}/v1/connect/quickbooks/start`, what: "The connect flow only: each company's owner connects its own QuickBooks Online company (OAuth2, tokens sealed per company, refreshed, disconnect). Sending bills is planned; until then the QuickBooks CSV export. Not yet run against an Intuit sandbox company.", doc: doc("docs/integrations/quickbooks-plan.md") },
      { name: "Moneybird (API)", kind: "built, run once in a sandbox", direction: "export", group: "accounting", where: "src/erp/moneybird.ts (the runner); docs/moneybird.md", what: "The runner's connector posts purchase invoices and journal documents through Moneybird's API; run live once in a sandbox administration. Moneybird has no CSV import for these, so there is no Moneybird CSV.", doc: doc("docs/moneybird.md") },
      { name: "Business Central and Odoo (API)", kind: "built, not tested live", direction: "export", group: "accounting", where: "src/erp/businessCentral.ts, src/erp/odoo.ts (the runner)", what: "The runner's connectors for Microsoft Dynamics 365 Business Central and Odoo 17 and 18; not yet run against a live system.", doc: doc("docs/erp.md") },
      { name: "Peppol invoices (UBL, BIS Billing 3.0)", kind: "built, not tested live", direction: "read", group: "more", where: "src/ap/peppol.ts (the payables inbox)", what: "A Peppol invoice or credit note read from its UBL and checked like a PDF; tested on handcrafted files and the official examples, never received over the Peppol network.", doc: doc("docs/integrations/peppol.md") },
      { name: "ISO 20022 pacs.008", kind: "format export", direction: "export", group: "more", where: "npm run iso20022 (src/finance/iso20022.ts)", what: "One paid invoice as a pacs.008.001.08 message, validated against the official schema; pacs.008-shaped, not a message a bank sent.", doc: doc("docs/connections.md#accounting-exports-format-exports") },
      { name: "Slack and Microsoft Teams messages", kind: "built, not tested live", direction: "notify", group: "more", where: `${origin}/v1/chat-hooks`, what: `Each company's owner pastes its own Slack incoming webhook or Teams Workflow webhook URL (Connections, Slack and Teams); Purser posts its three business events (${BUSINESS_EVENTS.join(", ")}) there as Slack Block Kit or a Teams Adaptive Card, retried, capped per hour and switched off after 20 failures in a row. "Send a test" posts one message. A message links to Purser Cloud and never approves. Tested with stand-ins; no real channel has received a post yet.`, doc: doc("docs/connections.md#slack-and-microsoft-teams") },
      { name: "Invoices by e-mail (forwarded from Gmail or Outlook)", kind: "built, not tested live", direction: "read", group: "more", where: "<company>@<mail domain> (Settings, Company, Inbox)", what: "Each company forwards its supplier invoices from Gmail, Google Workspace, Outlook or Microsoft 365 to its own Purser address; Gmail's forwarding confirmation code shows in Settings. No mail domain is routed yet, and no SPF/DKIM/DMARC result is read.", doc: doc("docs/integrations/email-forwarding.md") },
      { name: "Sign in with Google, Microsoft and Apple", kind: "built, not tested live", direction: "read", group: "more", where: `${origin}/v1/auth/oidc`, what: "Each person links their own Google, Microsoft or Apple account while signed in with their passkey, then signs in with it to read only. Settings and approving still take the passkey. Tested against a stand-in provider.", doc: doc("docs/integrations/owner-setup.md#12-sign-in-with-google") },
      { name: "Approval alerts (e-mail, WhatsApp, Slack, Teams)", kind: "built, not tested live", direction: "notify", group: "more", where: `${origin}/v1/alerts`, what: "When a payment waits for the CFO's Face ID: the amount, the payee, why and a link to Purser Cloud, by e-mail (Resend), WhatsApp (Twilio) or a Slack or Teams incoming webhook an owner sets. Nothing in an alert approves. Tested with stand-ins; not yet sent live.", doc: doc("docs/cloud.md#approval-alerts") },
      { name: "Google Workspace and Microsoft 365", kind: "built, not tested live", direction: "read", group: "more", where: "src/workplace (the runner)", what: "Invoices in from Gmail, Drive, Outlook and OneDrive, a Sheets export and sign-in with Google as a viewer; tested against mocks, needs the owner's OAuth apps.", doc: doc("docs/integrations/workplace.md") },
      { name: "Full export", kind: "live", direction: "export", group: "more", where: `${origin}/v1/export`, what: "Every record of the company as staged JSON parts with signed links, for an owner.", doc: doc("docs/connections.md") },
    ] satisfies Omit<Connection, keyof Extra>[]).map(withExtra),
    money_rule: "Money moves only on these, and only within the limits the CFO signed or after the CFO's Face ID on the exact terms. Test money only: sandboxes and a testnet.",
    money: ([
      { name: "Airwallex", kind: "sandbox", direction: "pay", group: "rails", where: "src/airwallex (the runner; /try on the demo)", what: "Agent cards with the CFO's limits, FX quotes inside the signed terms, transfers that carry the hash the CFO signed, the payee's name check, Airwallex's approval as a second lock.", doc: doc("docs/airwallex.md") },
      { name: "Alta (formerly Metal)", kind: "testnet", direction: "pay", group: "rails", where: "src/metal (the runner)", what: "A mandate per agent on chain, x402 payments, limits changed only by two passkeys, the audit log's head anchored on chain.", doc: doc("docs/metal-award.md") },
      { name: "Visa via Airwallex Airi", kind: "sandbox", direction: "pay", group: "rails", where: "src/airi (the runner)", what: "Visa Intelligent Commerce through Airwallex's Airi: a credential Purser binds to one purchase, a test card; above the limit only after the CFO's Face ID.", doc: doc("docs/visa-award.md") },
      { name: "Agent API on the runner (local MCP)", kind: "sandbox", direction: "pay", group: "ai", where: "npm run -s mcp (stdio, the runner)", what: "An outside agent asks for a company card, pays with it and asks for a higher limit, under the CFO's policy; each card and each raise approved with Face ID. Run on the Airwallex sandbox on 29 Oct.", doc: doc("docs/agent-api.md") },
    ] satisfies Omit<MoneyConnection, keyof Extra>[]).map(withExtra),
    planned: [
      { id: "peppol-network", name: "Peppol network (an Access Point)", group: "more", what: "Receiving invoices over the Peppol network itself, not only as UBL files.", needs: "A certified Peppol Access Point, chosen and registered by the owner; nothing is wired yet.", doc: doc("docs/integrations/peppol.md#receiving-over-peppol-the-owners-step") },
    ],
    hub: doc(HUB_DOC),
    connect_ai: `${origin}/connect-ai`,
  };
}
