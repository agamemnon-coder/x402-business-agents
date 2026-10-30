// npm run receivables -- demo | poll: the receivables agent (awards item 5) against the Airwallex sandbox.
//   demo: opens three retailer invoices (EUR, GBP), has the sandbox simulate four incoming payments into Northwind's
//         Global Accounts (one exact in EUR, one exact in GBP, one short, one with no invoice), then polls and matches.
//   poll: reads the Global Accounts' deposits since the first open invoice and matches the ones not yet recorded.
// Read-only towards Airwallex except the sandbox's own simulation endpoint and, once, creating a GBP Global Account.
// The ledger is KIT11_DB.

import { randomUUID } from "node:crypto";
import { openReceivable, matchReceipt, receivablesView } from "../agents/receivables.js";
import { setKnownGlobalAccounts } from "../policy/airwallexEvents.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";

type GA = { id: string; status: string; country_code?: string; supported_features?: { currency: string }[]; required_features?: { currency: string }[] };
type AwxDeposit = { id: string; amount: number | string; currency: string; reference?: string | null; status: string; global_account_id?: string; payer_name?: string | null; created_at?: string };

const cfg = fromEnv();
if (!cfg) {
  console.error("The Airwallex sandbox keys are not set; nothing was done.");
  process.exit(1);
}
const awx = new Airwallex(cfg);
const db = openDb();
const mode = process.argv[2] ?? "poll";

/** Northwind's Global Account in a currency: the active one that supports it, or a new one (GBP is created once). */
async function globalAccount(currency: "EUR" | "GBP", country: string): Promise<string> {
  const list = await awx.call<{ items: GA[] }>("GET", "/global_accounts", undefined, { status: "ACTIVE", page_size: "100" });
  const found = list.items.find((g) => [...(g.supported_features ?? []), ...(g.required_features ?? [])].some((f) => f.currency === currency));
  if (found) return found.id;
  const created = await awx.call<GA>("POST", "/global_accounts/create", { request_id: randomUUID(), country_code: country, nick_name: `Northwind ${currency}`, required_features: [{ currency, transfer_method: "LOCAL" }] });
  console.log(`created a ${currency} Global Account (${created.id.slice(0, 8)}…)`);
  return created.id;
}

const accounts = { EUR: await globalAccount("EUR", "NL"), GBP: await globalAccount("GBP", "GB") };
// The deposit webhooks are matched only into these accounts (src/policy/airwallexEvents.ts); the poll below is the backup.
setKnownGlobalAccounts(db, Object.values(accounts));

if (mode === "demo") {
  const now = new Date();
  const due = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const invoices = [
    { invoice_no: "NW-R-101", customer: "Alpenweg Sport AG", currency: "EUR", amount_cents: 124_000, due_date: due },
    { invoice_no: "NW-R-102", customer: "Fellside Outdoor Ltd", currency: "GBP", amount_cents: 86_050, due_date: due },
    { invoice_no: "NW-R-103", customer: "Kustlijn Buitensport BV", currency: "EUR", amount_cents: 51_000, due_date: due },
  ];
  for (const i of invoices) openReceivable(db, i, now);
  console.log(`opened ${invoices.map((i) => `${i.invoice_no} (${i.customer}, ${fromCents(i.amount_cents)} ${i.currency})`).join("; ")}`);
  // The retailers' payments, as the sandbox simulates them arriving by SEPA and Faster Payments.
  const payments = [
    { account: accounts.EUR, amount: "1240.00", reference: "Invoice NW-R-101 Alpenweg", payer: "Alpenweg Sport AG" },
    { account: accounts.GBP, amount: "860.50", reference: "NW-R-102", payer: "Fellside Outdoor Ltd" },
    { account: accounts.EUR, amount: "500.00", reference: "nw-r-103", payer: "Kustlijn Buitensport BV" },
    { account: accounts.EUR, amount: "25.00", reference: "Payment", payer: "Unknown sender" },
  ];
  for (const p of payments) {
    const d = await awx.call<{ id: string; status: string }>("POST", "/simulation/deposit/create", { global_account_id: p.account, amount: Number(p.amount), reference: p.reference, payer_name: p.payer, status: "SETTLED" });
    console.log(`sandbox deposit ${d.id.slice(0, 8)}… ${p.amount} "${p.reference}" ${d.status}`);
  }
}

// Poll: every deposit into the two Global Accounts since the first open invoice, matched once.
const first = (db.prepare("SELECT MIN(issued_at) AS t FROM receivables").get() as { t: string | null }).t;
if (!first) {
  console.log("No open invoices: nothing to match.");
  process.exit(0);
}
const since = new Date(Date.parse(first) - 60_000).toISOString();
const mine = new Set(Object.values(accounts));
for (let page = 0; page < 20; page++) {
  const r = await awx.call<{ has_more: boolean; items: AwxDeposit[] }>("GET", "/deposits", undefined, { from_created_at: since, page_num: String(page), page_size: "100" });
  for (const d of r.items) {
    if (d.status !== "SETTLED" || (d.global_account_id && !mine.has(d.global_account_id)) || !["EUR", "GBP"].includes(d.currency)) continue;
    const m = matchReceipt(db, {
      deposit_id: d.id, global_account_id: d.global_account_id ?? null, currency: d.currency, amount_cents: toCents(Number(d.amount).toFixed(2)),
      reference: d.reference ?? null, payer: d.payer_name ?? null, received_at: d.created_at ?? new Date().toISOString(),
    });
    console.log(`${m.outcome.padEnd(14)} ${d.id.slice(0, 8)}…  ${redactSecrets(m.detail)}`);
  }
  if (!r.has_more) break;
}
const v = receivablesView(db);
console.log(`\nopen: ${v.open.map((o) => `${o.invoice_no} ${o.paid}/${o.amount} ${o.currency}`).join("; ") || "none"}; escalated to the CFO: ${v.escalated}`);
