// Connections to other systems, read and export only (Connect any AI, part B, 13 Nov). Nothing here moves money, approves
// or writes to the books:
//   events     what a push from the runner changed, as business events for the company's signed webhook:
//              payment.paid (an invoice became paid), approval.needed (an invoice was filed for the CFO's Face ID),
//              books.closed (a year-end closing entry reached the ledger). Ids, amounts and days only; never a name.
//   chat       an event as a Slack (Block Kit) or Microsoft Teams (Adaptive Card) message: a FORMAT, for a team that
//              relays its webhook into chat itself. Purser posts to no chat service.
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
  "approval.needed": (d) => ({ title: "Waiting for the CFO's Face ID", text: `Invoice ${d.invoice_id}, ${d.currency} ${d.amount}, due ${d.due_date}, waits for the CFO's approval. Only the CFO approves, in Purser Cloud, with Face ID.`, button: "Review in Purser Cloud", url: d.approve_in ?? "" }),
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

interface Bill { id: string; vendor: string; invoice_no: string; issue_date?: string; due_date: string; currency: string; subtotal?: string; tax?: string; total: string; gl_account?: string; doc_kind?: string; status: string }

/** Supplier invoices (not credit notes, not rejected), issued between two days, oldest first. */
async function bills(db: TenantDb, from: string | null, to: string | null): Promise<Bill[]> {
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

export interface Connection { name: string; kind: "live" | "format export" | "built, not tested live" | "built, run once in a sandbox"; direction: "read" | "export" | "notify"; where: string; what: string }

/** Every connection Purser has to other systems, labelled honestly: live, a format export, or built and not yet tried live. */
export function connectionsCatalogue(origin: string): { rule: string; connections: Connection[] } {
  return {
    rule: "Every connection reads or exports. None moves money, approves a payment, changes a limit or writes to the books: every payment needs the CFO's Face ID in Purser Cloud.",
    connections: [
      { name: "MCP server (Connect any AI)", kind: "live", direction: "read", where: `${origin}/mcp`, what: "Claude, ChatGPT, Cursor, VS Code, Gemini CLI, Windsurf and any MCP client read the books: 14 read tools, resources, prompts. OAuth 2.1 or a connector token." },
      { name: "Read API (REST) and its OpenAPI", kind: "live", direction: "read", where: `${origin}/v1/openapi.read.json`, what: "Invoices, documents, suppliers, payments, the transactions register, the ledger and its reports, for a read-scoped key." },
      { name: "Webhooks", kind: "live", direction: "notify", where: `${origin}/v1/webhook`, what: `Signed POSTs (x-purser-signature: t=<seconds>,v1=<HMAC-SHA256 of t.body>) for ${BUSINESS_EVENTS.join(", ")}, the runner's alerts and security events.` },
      { name: "Slack and Microsoft Teams messages", kind: "format export", direction: "notify", where: "docs/connections.md", what: "Each webhook event as a Slack Block Kit or Teams Adaptive Card message, for a team that relays the webhook into chat. Purser posts to no chat service." },
      { name: "Xero", kind: "format export", direction: "export", where: `${origin}/v1/export/csv/xero/bills`, what: "Bills and manual journals as CSV in Xero's import columns." },
      { name: "QuickBooks Online", kind: "format export", direction: "export", where: `${origin}/v1/export/csv/quickbooks/bills`, what: "Bills as CSV with QuickBooks' required import columns." },
      { name: "Exact Online (CSV)", kind: "format export", direction: "export", where: `${origin}/v1/export/csv/exact/bills`, what: "Purchase entries (Inkoopboekingen) and journals (Memoriaalboekingen) as CSV in Exact's import template columns." },
      { name: "Exact Online (API)", kind: "built, not tested live", direction: "export", where: "src/erp/exact.ts (the runner)", what: "The runner's connector posts purchase invoices and journals through Exact's REST API; not yet run against a live Exact administration." },
      { name: "Moneybird (API)", kind: "built, run once in a sandbox", direction: "export", where: "src/erp/moneybird.ts (the runner); docs/moneybird.md", what: "The runner's connector posts purchase invoices and journal documents through Moneybird's API; run live once in a sandbox administration. Moneybird has no CSV import for these, so there is no Moneybird CSV." },
      { name: "ISO 20022 pacs.008", kind: "format export", direction: "export", where: "npm run iso20022 (src/finance/iso20022.ts)", what: "One paid invoice as a pacs.008.001.08 message, validated against the official schema; pacs.008-shaped, not a message a bank sent." },
      { name: "Full export", kind: "live", direction: "export", where: `${origin}/v1/export`, what: "Every record of the company as staged JSON parts with signed links, for an owner." },
    ],
  };
}
