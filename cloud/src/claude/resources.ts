// MCP resources for Connect any AI: the books, the invoices, the payments and the CFO's policy as readable documents with
// purser:// URIs, so a client can attach them to a conversation (resources/list, resources/templates/list,
// resources/read). Read only, the caller's own company only, the same reads the tools make.

import { dashboard } from "../dashboard.js";
import { BadRequest, oneInvoice, report } from "../read.js";
import type { TenantDb } from "../tenant.js";
import { auditTrail, cashPosition, cfoPolicy, findPayment, pendingApprovals, quarterOf } from "./insight.js";

type Json = Record<string, unknown>;
export interface ResourceCtx { db: TenantDb; now: Date; demo: boolean; origin: string; company: string }
export interface Resource { uri: string; name: string; title: string; description: string; mimeType: string }
export interface ResourceTemplate { uriTemplate: string; name: string; title: string; description: string; mimeType: string }

/** A resource that does not exist (the caller's error, not the server's). */
export class NoResource extends Error {}

const BOOKS = ["pnl", "balance", "trial", "payables", "receivables"] as const;
const BOOK_WORDS: Record<string, string> = { pnl: "Profit and loss, this year to date", balance: "Balance sheet", trial: "Trial balance", payables: "Open payables, aged", receivables: "Open receivables, aged" };

/** The fixed resources, then one per invoice (newest last, as the books keep them). */
export async function listResources(c: ResourceCtx): Promise<Resource[]> {
  const q = quarterOf(c.now.toISOString());
  const fixed: Resource[] = [
    { uri: "purser://company/overview", name: "company-overview", title: "Company overview", description: "Money in and out, net cash by day, spend, invoices by state, the newest decisions.", mimeType: "application/json" },
    { uri: "purser://cash", name: "cash", title: "Cash and its projection", description: "Net cash and a 4-week projection from due days (not a bank balance).", mimeType: "application/json" },
    { uri: "purser://approvals/pending", name: "pending-approvals", title: "What waits for the CFO", description: "Invoices and proposals waiting for the CFO's Face ID, with where to approve them.", mimeType: "application/json" },
    { uri: "purser://policy", name: "cfo-policy", title: "The CFO's policy, in plain words", description: "The rules every payment is held to, the policy version, agents' card limits.", mimeType: "text/markdown" },
    ...BOOKS.map((r) => ({ uri: `purser://books/${r}`, name: `books-${r}`, title: BOOK_WORDS[r]!, description: `${BOOK_WORDS[r]!}, computed from the ledger.`, mimeType: "application/json" })),
    { uri: `purser://books/vat/${q}`, name: `vat-${q}`, title: `VAT overview ${q}`, description: "The quarter's VAT as the Dutch return's rubrics. An overview, not a filing.", mimeType: "application/json" },
  ];
  const inv = await c.db.select<{ id: string; vendor: string; invoice_no: string; status: string }>("invoices", {}, { order: ["id"] });
  return [...fixed, ...inv.map((i) => ({ uri: `purser://invoices/${encodeURIComponent(i.id)}`, name: `invoice-${i.id}`, title: `${i.id} · ${i.vendor} ${i.invoice_no}`, description: `Supplier invoice ${i.invoice_no} from ${i.vendor} (${i.status}).`, mimeType: "application/json" }))];
}

export const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  { uriTemplate: "purser://invoices/{id}", name: "invoice", title: "One supplier invoice", description: "An invoice by its id (like AP-0004): what Purser read, its checks, its earlier versions.", mimeType: "application/json" },
  { uriTemplate: "purser://payments/{id}", name: "payment", title: "One payment and its trail", description: "A payment by its id, its invoice's id or its proposal's id: the movement, its approval, its audit trail and its booking.", mimeType: "application/json" },
  { uriTemplate: "purser://books/vat/{quarter}", name: "vat", title: "VAT overview for a quarter", description: "A quarter like 2026Q4, as the Dutch return's rubrics. An overview, not a filing.", mimeType: "application/json" },
  { uriTemplate: "purser://books/{report}", name: "books", title: "A ledger report", description: "pnl, balance, trial, payables or receivables.", mimeType: "application/json" },
];

/** The policy as a short document a person reads. */
function policyMarkdown(company: string, demo: boolean, p: Json): string {
  const v = p.policy_version as { version: number; at: string; sha256: string } | null;
  const cards = p.agent_cards as { name: string; currency: string; per_purchase: string; per_month: string }[];
  const settings = p.settings as { setting: string; value: string }[];
  return [`# ${company}: the CFO's policy${demo && !/demo/i.test(company) ? " (demo data)" : ""}`, "", ...(p.rules as string[]).map((r) => `- ${r}`), "", `_${String(p.rules_source)}_`, "",
    "## In force", v ? `Policy version ${v.version}, since ${v.at.slice(0, 10)} (sha256 ${v.sha256}).` : "No policy version recorded yet.", "",
    "## Agents' cards", ...(cards.length ? cards.map((k) => `- ${k.name}: ${k.currency} ${k.per_purchase} a purchase, ${k.currency} ${k.per_month} a month`) : ["- none issued"]), "",
    "## Settings", ...(settings.length ? settings.map((x) => `- ${x.setting}: ${x.value}`) : ["- none recorded"]), ""].join("\n");
}

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { throw new NoResource("the URI is not valid percent-encoding"); } };

/** One resource's contents, or NoResource. */
export async function readResource(c: ResourceCtx, uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
  const json = (data: unknown) => ({ uri, mimeType: "application/json", text: JSON.stringify(c.demo && data && typeof data === "object" ? { demo_data: true, ...(data as Json) } : data) });
  const at = c.demo ? c.now.toISOString().slice(0, 10) : undefined;
  let m: RegExpExecArray | null;
  try {
    if (uri === "purser://company/overview") return json(await dashboard(c.db, c.demo ? { asOf: c.now.toISOString() } : {}));
    if (uri === "purser://cash") return json(await cashPosition(c.db, c.now));
    if (uri === "purser://approvals/pending") return json(await pendingApprovals(c.db, c.origin));
    if (uri === "purser://policy") return { uri, mimeType: "text/markdown", text: policyMarkdown(c.company, c.demo, await cfoPolicy(c.db)) };
    if ((m = /^purser:\/\/books\/vat\/(\d{4}Q[1-4])$/.exec(uri))) return json(await report(c.db, "vat", new URLSearchParams({ quarter: m[1]! }), c.now));
    if ((m = /^purser:\/\/books\/([a-z]+)$/.exec(uri)) && (BOOKS as readonly string[]).includes(m[1]!)) {
      const q = new URLSearchParams();
      if (at) { q.set("to", at); q.set("as_of", at); }
      return json({ report: m[1], ...(await report(c.db, m[1]!, q, c.now)) as Json });
    }
    if ((m = /^purser:\/\/invoices\/([^/?#]+)$/.exec(uri))) {
      const inv = await oneInvoice(c.db, decode(m[1]!));
      if (inv) return json({ invoice: inv });
      throw new NoResource(`there is no invoice ${decode(m[1]!)} in ${c.company}'s books`);
    }
    if ((m = /^purser:\/\/payments\/([^/?#]+)$/.exec(uri))) {
      const t = await findPayment(c.db, decode(m[1]!));
      if (t) return json(await auditTrail(c.db, t));
      throw new NoResource(`no payment in ${c.company}'s books is ${decode(m[1]!)}`);
    }
  } catch (e) {
    if (e instanceof BadRequest) throw new NoResource(e.message);
    throw e;
  }
  throw new NoResource(`no resource ${uri}; resources/list and resources/templates/list show what there is`);
}
