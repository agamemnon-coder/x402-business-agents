// npm run receivables -- issue | match | aging | dunning | review (docs/receivables.md). Test money, Airwallex sandbox.
//   issue --no NW-1001 --customer "Alpenweg Sport AG" --currency EUR --net 1240.00 --due 2026-12-31 [--vat S21]
//         [--email ap@example.com] [--issue-date YYYY-MM-DD] [--no-link]
//         books the invoice (debtors against revenue and VAT) and, with the sandbox keys, makes its payment link.
//   match [--days 7] [--file payments.json]   reads the settled deposits of the last days from Airwallex (read-only)
//         or a JSON file of payments, matches each once, books it, and switches off the links of invoices now paid.
//   aging [--as-of YYYY-MM-DD]                aged debtors, 0-30 / 31-60 / 61-90 / 90+ days past due, per currency.
//   dunning [--as-of YYYY-MM-DD]              reminder drafts at due + 3, + 10, + 20 days. Drafts only: nothing is sent.
//   review                                    payments waiting for a person (held in suspense until then).
// Customer contact addresses and payer names are not printed in full; the ledger is KIT11_DB.

import { readFileSync } from "node:fs";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { listDeposits } from "../airwallex/deposits.js";
import { openDb } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { AR_BUCKETS, agedDebtors, arInvoice, draftReminders, issueInvoice, maskEmail, retireDoneLinks, reviewQueue, routeDeposit, type IncomingPayment } from "../receivables/ar.js";

export async function runAr(mode: string, args: string[]): Promise<number> {
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const today = new Date().toISOString().slice(0, 10);
  const asOf = arg("--as-of") ?? today;
  const db = openDb();
  const cfg = fromEnv();
  const api = cfg ? new Airwallex(cfg) : null;

  if (mode === "issue") {
    const no = arg("--no"), customer = arg("--customer"), currency = arg("--currency"), net = arg("--net"), due = arg("--due");
    if (!no || !customer || !currency || !net || !due) {
      console.error('usage: npm run receivables -- issue --no NW-1001 --customer "Name" --currency EUR --net 1240.00 --due YYYY-MM-DD [--vat S21] [--email …] [--no-link]');
      return 2;
    }
    const links = args.includes("--no-link") ? null : api;
    const r = await issueInvoice(db, { invoice_no: no, customer, contact_email: arg("--email") ?? null, currency, net_cents: toCents(net), vat_code: arg("--vat") ?? "S21", issue_date: arg("--issue-date") ?? today, due_date: due }, links);
    console.log(`${r.invoice.invoice_no} issued: ${r.invoice.currency} ${fromCents(r.invoice.amount_cents)} due ${r.invoice.due_date}, booked as ledger entry ${r.entry_id} (debtors 1300 / revenue 4200${r.invoice.amount_cents > r.invoice.net_cents ? " / output VAT 2210" : ""}); test money`);
    console.log(r.link ? `payment link (Airwallex sandbox, single use): ${r.link.url}` : r.link_problem ?? (links ? "no link" : "no payment link: no Airwallex sandbox keys, or --no-link"));
    return 0;
  }

  if (mode === "match") {
    let payments: (IncomingPayment & { global_account_id: string | null })[];
    const file = arg("--file");
    if (file) {
      payments = (JSON.parse(readFileSync(file, "utf8")) as IncomingPayment[]).map((p) => ({ ...p, global_account_id: null }));
    } else {
      if (!api) { console.error("no Airwallex sandbox keys: give --file payments.json, or set the keys; nothing was matched"); return 1; }
      const days = Math.min(31, Number(arg("--days") ?? "7"));
      const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");
      const now = new Date();
      payments = (await listDeposits(api, { from: iso(new Date(now.getTime() - days * 86_400_000)), to: iso(now) }))
        .filter((d) => d.status === "SETTLED" && d.amountCents > 0)
        .map((d) => ({ payment_id: d.id, currency: d.currency, amount_cents: d.amountCents, reference: d.reference, payer: d.payer, received_at: d.createdAt ?? now.toISOString(), global_account_id: d.globalAccountId }));
    }
    for (const p of payments) {
      const r = routeDeposit(db, { deposit_id: p.payment_id, global_account_id: p.global_account_id, currency: p.currency, amount_cents: p.amount_cents, reference: p.reference, payer: p.payer, received_at: p.received_at });
      console.log(`${r.outcome.padEnd(18)} ${p.currency} ${fromCents(p.amount_cents).padStart(10)}  ${p.payment_id.slice(0, 12)}  ${r.by === "ar" ? r.detail : "older receivables ledger"}`);
    }
    if (api) for (const no of await retireDoneLinks(db, api)) console.log(`payment link of ${no} switched off (no longer open)`);
    console.log(`${payments.length} payment(s) read; waiting for a person: ${reviewQueue(db).length}`);
    return 0;
  }

  if (mode === "aging") {
    const a = agedDebtors(db, asOf);
    console.log(`Aged debtors on ${a.as_of} (days past due; not yet due counts in 0-30). Test money.`);
    for (const [cur, t] of Object.entries(a.totals)) console.log(`  ${cur}  ${AR_BUCKETS.map((b) => `${b}: ${fromCents(t[b])}`).join("  ")}  (not yet due ${fromCents(a.not_due[cur] ?? 0)})`);
    for (const r of a.rows) console.log(`  ${r.invoice_no.padEnd(14)} ${r.customer.slice(0, 28).padEnd(28)} ${r.currency} ${fromCents(r.open_cents).padStart(10)}  due ${r.due_date}  ${String(r.days_overdue).padStart(3)} days  ${r.bucket}`);
    if (!a.rows.length) console.log("  nothing open");
    return 0;
  }

  if (mode === "dunning") {
    const drafts = draftReminders(db, asOf);
    console.log(`Reminder drafts due by ${asOf} (due + 3, + 10, + 20 days). DRAFTS ONLY: Purser sends nothing; a person reviews and sends.`);
    for (const d of drafts) console.log(`\n--- ${d.invoice_no}, reminder ${d.stage} (from ${d.due_on}); to ${maskEmail(arInvoice(db, d.invoice_no)?.contact_email ?? null)}\n${d.draft}`);
    if (!drafts.length) console.log("  none due");
    return 0;
  }

  if (mode === "review") {
    const q = reviewQueue(db);
    console.log(`Payments waiting for a person (in suspense, 2900, until identified): ${q.length}`);
    for (const r of q) console.log(`  ${r.payment_id.slice(0, 12)}  ${r.currency} ${r.amount.padStart(10)}  ${r.reason}`);
    return 0;
  }
  console.error(`unknown mode ${mode}`);
  return 2;
}
