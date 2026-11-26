// The GDPR record of processing activities (26 Nov; Art. 30): each processing activity Purser performs, with its
// purpose, legal basis, data subjects, data, recipients, transfers, retention and security. Its tables come from the
// inventory of docs/security/data-classification.md: test/compliance-gdpr.test.ts holds every Secret and Restricted row
// of that inventory to exactly one activity, and each activity's recipients to the providers of the third-party
// register (docs/compliance/third-parties.json), whose locations give the transfers. docs/compliance/gdpr.md shows the
// record between its markers (npm run compliance:controls writes it).

import { readFileSync } from "node:fs";
import { loadRegister, type Register } from "./thirdParties.js";

export const CLASSIFICATION = "docs/security/data-classification.md";

/** One row of the classification inventory: its tables, its level and its personal, financial or credential columns. */
export interface InventoryRow { tables: string[]; level: string; columns: string[] }

export function inventory(md = readFileSync(CLASSIFICATION, "utf8")): InventoryRow[] {
  const at = md.indexOf("## Inventory");
  return md.slice(at).split("\n").filter((l) => /^\| `/.test(l)).map((l) => {
    const cells = l.split("|").map((c) => c.trim());
    const ticks = (c: string) => [...c.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]!);
    return { tables: ticks(cells[1]!), level: cells[2]!, columns: ticks(cells[3]!) };
  });
}

export interface Activity {
  id: string;
  name: string;
  purpose: string;
  basis: string;
  subjects: string;
  data: string;
  /** Inventory rows, by their first table. */
  rows: string[];
  /** Provider ids of the third-party register that receive this data. */
  recipients: string[];
  retention: string;
}

const BOOKS = "the books: seven years, to 31 December ([retention](retention.md), [Cloud](../privacy/retention.md))";

export const ACTIVITIES: readonly Activity[] = [
  {
    id: "R1", name: "Accounts and sign-in to Purser Cloud", purpose: "Let the company's people sign in, with roles, and keep their access safe",
    basis: "Art. 6(1)(b) contract with the company; (f) security", subjects: "The company's staff (owners, CFO, accountants, viewers)",
    data: "Name, e-mail, role, passkeys' public keys, sessions, linked sign-in accounts (subject, e-mail), network (cut)",
    rows: ["users", "identity_links", "api_keys"], recipients: ["cloudflare", "google", "microsoft", "apple"],
    retention: "while the person has access; erased or pseudonymised at once on erasure or offboarding ([Cloud](../privacy/retention.md))",
  },
  {
    id: "R2", name: "Payment approvals", purpose: "Let the CFO and a second person approve the exact terms of a payment with a passkey, and keep the proof",
    basis: "Art. 6(1)(c) bookkeeping and (f) the company's interest in proving who approved", subjects: "Approvers (CFO, second approver)",
    data: "A label per passkey, its public key, each signature over a terms hash, the approver's name on the approval",
    rows: ["passkeys"], recipients: ["cloudflare"], retention: BOOKS,
  },
  {
    id: "R3", name: "Accounts payable and bookkeeping", purpose: "Read supplier invoices, check them, pay them and keep the books",
    basis: "Art. 6(1)(b) contracts with suppliers; (c) bookkeeping (Art. 2:10 BW, Art. 52 AWR)", subjects: "Suppliers who are natural persons (sole traders), the suppliers' contacts",
    data: "Names, addresses, bank details (IBAN, BIC; on the runner the last four and a hash where the full number is not needed), invoices, documents and the e-mails they came in",
    rows: ["invoices", "documents", "ap_invoices", "beneficiaries", "erp_sync", "books_connections"],
    recipients: ["anthropic", "airwallex", "cloudflare", "t0", "moneybird", "xero", "intuit", "exact", "odoo", "microsoft", "google"],
    retention: BOOKS,
  },
  {
    id: "R4", name: "Agent payments, cards and refunds", purpose: "Let the agents pay within the CFO's limits, on cards, on chain and by transfer, and refund customers",
    basis: "Art. 6(1)(b) contracts; (c) bookkeeping", subjects: "Customers who are refunded, payees, the agents' cardholders (placeholders in the sandbox)",
    data: "Amounts, payees, wallet addresses (public testnet), card transactions (merchant, last four), refund recipients",
    rows: ["proposals", "cards", "sales", "metal_accounts", "agent_tokens", "task_tokens", "principals"],
    recipients: ["airwallex", "visa-airi", "alta", "cloudflare"], retention: BOOKS,
  },
  {
    id: "R5", name: "Disputes and the agents' work", purpose: "Handle customer disputes and keep what the agents said and did",
    basis: "Art. 6(1)(b) contract; (f) investigating a disputed payment", subjects: "Customers in a dispute, suppliers quoted in a message",
    data: "Claims and evidence, agents' messages (may quote invoice data), the relay's inbox and webhook bodies",
    rows: ["disputes", "agent_messages", "inbox", "do_state", "authority_maps", "compliance_summaries"], recipients: ["anthropic", "cloudflare", "airwallex"],
    retention: "disputes with the books; the agents' messages a year ([retention](retention.md))",
  },
  {
    id: "R6", name: "Security monitoring", purpose: "Detect and slow attacks, and keep the security log",
    basis: "Art. 6(1)(f) security of the service (Recital 49)", subjects: "Users and visitors",
    data: "Network address (cut to its network where kept), route, outcome, user agent",
    rows: ["security_log", "hits"], recipients: ["cloudflare"], retention: "the platform's security log a year; rate windows a day ([Cloud](../privacy/retention.md))",
  },
  {
    id: "R7", name: "Approval alerts", purpose: "Tell the approver a payment waits, with a link and nothing that approves",
    basis: "Art. 6(1)(b) contract (an alert the company switched on)", subjects: "The people the company names as alert targets",
    data: "Phone number, e-mail address, chat webhook, push subscription; the alert's message (amount, payee, link)",
    rows: ["alert_targets", "chat_hooks", "push_subs"], recipients: ["resend", "twilio", "slack", "microsoft", "cloudflare"],
    retention: "until an owner removes them; deleted at offboarding ([Cloud](../privacy/retention.md))",
  },
  {
    id: "R8", name: "The hands-on demo", purpose: "Run the public demo with made-up companies and limit its abuse",
    basis: "Art. 6(1)(f) running and protecting a public demo", subjects: "Visitors of the demo",
    data: "A salted hash of the visitor's address for the day, a visitor token's hash, optional feedback (up to 200 characters)",
    rows: ["try_companies"], recipients: ["cloudflare"], retention: "the demo companies 24 hours; the day's salt a day; feedback has no automatic deletion yet ([Cloud](../privacy/retention.md#open-items))",
  },
  {
    id: "R9", name: "Accounts receivable", purpose: "Send the company's invoices, match the payments that come in, and remind customers who have not paid",
    basis: "Art. 6(1)(b) contracts with customers; (c) bookkeeping", subjects: "Customers who are natural persons (sole traders), the customers' contacts",
    data: "Customers' names and contact e-mail, invoice amounts, payments received and how they were matched, reminders sent",
    rows: ["ar_invoices"], recipients: ["airwallex", "cloudflare"], retention: BOOKS,
  },
];

/** Where each recipient is, from the register: a third country is anything the register does not place in the EU. */
export function transfers(r: Register = loadRegister()): { id: string; name: string; location: string; third_country: boolean }[] {
  return r.providers.map((p) => ({ id: p.id, name: p.name, location: p.location, third_country: /United States/.test(p.location) }));
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The record of processing activities and the transfers, as Markdown, for docs/compliance/gdpr.md. */
export function ropaMarkdown(r: Register = loadRegister()): string {
  const name = (id: string) => r.providers.find((p) => p.id === id)?.name ?? id;
  const inv = inventory();
  const L: string[] = ["<!-- ropa:start: generated by npm run compliance:controls from src/compliance/gdpr.ts; do not edit by hand -->", ""];
  L.push("| Id | Activity | Purpose | Legal basis | Data subjects | Personal data | Tables (data-classification.md) | Recipients | Kept |", "|---|---|---|---|---|---|---|---|---|");
  for (const a of ACTIVITIES) {
    const tables = a.rows.flatMap((first) => inv.find((x) => x.tables[0] === first)?.tables ?? [first]);
    L.push(`| ${a.id} | **${cell(a.name)}** | ${cell(a.purpose)} | ${cell(a.basis)} | ${cell(a.subjects)} | ${cell(a.data)} | ${tables.length} tables: ${tables.slice(0, 6).map((t) => `\`${t}\``).join(", ")}${tables.length > 6 ? ", …" : ""} | ${cell(a.recipients.map(name).join(", "))} | ${a.retention} |`);
  }
  L.push("", "Transfers outside the EU, per recipient (locations from the [third-party register](third-parties.md)):", "");
  L.push("| Recipient | Location | Outside the EU | Transfer mechanism recorded |", "|---|---|---|---|");
  const used = new Set(ACTIVITIES.flatMap((a) => a.recipients));
  for (const t of transfers(r).filter((x) => used.has(x.id))) {
    const outside = t.third_country ? "**yes**" : /not pinned|provider's|not documented|Sandbox|Through|testnet/.test(t.location) ? "not known: the location is not recorded (in full)" : "no";
    L.push(`| ${t.name} | ${cell(t.location)} | ${outside} | ${t.third_country ? "**none** (gap: GDPR Art. 44)" : "none recorded"} |`);
  }
  L.push("", "<!-- ropa:end -->");
  return L.join("\n");
}
