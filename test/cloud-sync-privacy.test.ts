// Data minimisation on the way to Purser Cloud (GDPR Art. 5(1)(c)): a customer's or payer's name, contact e-mail or
// bank account never leaves the runner in a sync batch (src/cloudsync/client.ts batchesFor). Both receivables flows are
// run with named customers and payers: the older matcher (src/agents/receivables.ts, through the journal and the ledger
// feed) and the receivables module (src/receivables/ar.ts, with the money loop snapshot). The cloud gets invoice numbers
// and amounts; the names stay in the runner's own tables. Breaks if a name, an e-mail or an IBAN of theirs reaches the
// ledger entries, the transactions register, the audit rows or the money loop, or if a receipt booked earlier under its
// payer's name stops reconciling. Test money only; every person here is made up.
import { describe, expect, it } from "vitest";
import { matchReceipt, openReceivable } from "../src/agents/receivables.js";
import { batchesFor } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { FEED_ACTOR, syncLedger } from "../src/ledger/feed.js";
import { transactionRegister } from "../src/money/register.js";
import { authorityMap } from "../src/policy/authorityMap.js";
import { issueInvoice, matchPayment } from "../src/receivables/ar.js";
import { moneyLoopSnapshot } from "../src/treasury/cloudSnapshot.js";

const NOW = new Date("2026-11-27T12:00:00Z");
const EMPTY = { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] };

// Customers who are natural persons (sole traders), their contacts, and the people who paid.
const CUSTOMERS = ["Marit Jansen Sport", "Anna Bakker Outdoor", "Ruud Smit Fietsen"];
const PAYERS = ["Marit Jansen", "Pieter de Vries", "Anna Bakker", "Joost Visser"];
const EMAILS = ["anna@bakker-outdoor.example", "p.devries@example.nl", "joost@visser.example"];
const IBANS = ["NL91ABNA0417164300", "NL20INGB0001234567"];
const spaced = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

async function world(db: DB): Promise<void> {
  // The older matcher: two invoices to named customers, a payment in full, one short, and one that names no invoice
  // with the payer's own account and address in its reference.
  openReceivable(db, { invoice_no: "NW-R-301", customer: CUSTOMERS[0]!, currency: "EUR", amount_cents: 50_000, due_date: "2026-11-30" }, NOW);
  openReceivable(db, { invoice_no: "NW-R-302", customer: CUSTOMERS[2]!, currency: "EUR", amount_cents: 30_000, due_date: "2026-11-30" }, NOW);
  const dep = (id: string, cents: number, reference: string, payer: string) => ({ deposit_id: id, global_account_id: "ga_eur", currency: "EUR", amount_cents: cents, reference, payer, received_at: "2026-11-20T10:00:00Z" });
  matchReceipt(db, dep("dep_p1", 50_000, "Invoice NW-R-301", PAYERS[0]!), NOW);
  matchReceipt(db, dep("dep_p2", 20_000, "NW-R-302 part", PAYERS[0]!), NOW);
  matchReceipt(db, dep("dep_p3", 12_500, `${PAYERS[1]} ${spaced(IBANS[0]!)} ${EMAILS[1]} order 12`, PAYERS[1]!), NOW);
  // The receivables module: an invoice to a named customer with a contact address, paid in full, and a payment to
  // review whose reference carries its payer's name, account and address.
  await issueInvoice(db, { invoice_no: "NW-2026-501", customer: CUSTOMERS[1]!, contact_email: EMAILS[0]!, currency: "EUR", net_cents: 40_000, vat_code: "S21", issue_date: "2026-11-02", due_date: "2026-11-16" }, null, NOW);
  await issueInvoice(db, { invoice_no: "NW-2026-502", customer: CUSTOMERS[2]!, currency: "EUR", net_cents: 10_000, vat_code: "S0", issue_date: "2026-11-02", due_date: "2026-12-16" }, null, NOW);
  matchPayment(db, { payment_id: "pay_p1", currency: "EUR", amount_cents: 48_400, reference: "NW-2026-501", payer: PAYERS[2]!, received_at: "2026-11-21T10:00:00Z" }, NOW);
  matchPayment(db, { payment_id: "pay_p2", currency: "EUR", amount_cents: 7_700, reference: `${PAYERS[3]} ${IBANS[1]} ${EMAILS[2]}`, payer: PAYERS[3]!, received_at: "2026-11-22T10:00:00Z" }, NOW);
  syncLedger(db, NOW);
}

describe("a sync batch for Purser Cloud", () => {
  it("names no customer or payer, and carries none of their e-mail addresses or accounts", async () => {
    const db = openDb(":memory:");
    await world(db);
    const batches = batchesFor(db, EMPTY, { now: NOW, authority: authorityMap, moneyLoop: (d, n) => moneyLoopSnapshot(d, n) });
    const json = JSON.stringify(batches);
    // The batches hold what they should: the receipts, the payments and their bookings, by invoice number.
    for (const no of ["NW-R-301", "NW-R-302", "NW-2026-501"]) expect(json).toContain(no);
    expect(batches[0]).toHaveProperty("money_loop");
    for (const s of [...CUSTOMERS, ...PAYERS, ...EMAILS, ...IBANS, ...IBANS.map(spaced)]) expect(json, s).not.toContain(s);
    // Parts of a name are names too: no surname of theirs, in any case.
    for (const s of ["Jansen", "Vries", "Bakker", "Visser", "Smit"]) expect(json.toLowerCase(), s).not.toContain(s.toLowerCase());
    // The runner keeps them, where it needs them.
    expect(db.prepare("SELECT customer FROM receivables WHERE invoice_no = 'NW-R-301'").get()).toEqual({ customer: CUSTOMERS[0] });
    expect(db.prepare("SELECT payer FROM receipts WHERE deposit_id = 'dep_p3'").get()).toEqual({ payer: PAYERS[1] });
    expect(db.prepare("SELECT contact_email FROM ar_invoices WHERE invoice_no = 'NW-2026-501'").get()).toEqual({ contact_email: EMAILS[0] });
  });

  it("leaves a receipt booked earlier under its payer's name standing, still reconciled", async () => {
    const db = openDb(":memory:");
    openReceivable(db, { invoice_no: "NW-R-301", customer: CUSTOMERS[0]!, currency: "EUR", amount_cents: 50_000, due_date: "2026-11-30" }, NOW);
    matchReceipt(db, { deposit_id: "dep_old", global_account_id: "ga_eur", currency: "EUR", amount_cents: 50_000, reference: "NW-R-301", payer: PAYERS[0]!, received_at: "2026-11-20T10:00:00Z" }, NOW);
    // As the ledger feed booked it before: the revenue line named the payer.
    const old = postEntry(db, { date: "2026-11-20T10:00:00Z", description: "Payment of invoice NW-R-301", created_by: FEED_ACTOR, source_key: "receipt|dep_old|4200|1200|EUR", doc_ref: "dep_old", lines: [
      { account: "1200", debit: 50_000, currency: "EUR" }, { account: "4200", credit: 50_000, currency: "EUR", party: PAYERS[0]!, memo: "retailer payment: matched to its invoice" }] }, NOW);
    expect(syncLedger(db, NOW)).toMatchObject({ posted: 0, reversed: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE reverses = ?").get(old.entry_id)).toEqual({ n: 0 });
    const row = transactionRegister(db).rows.find((r) => r.id === "receipt:dep_old")!;
    expect(row).toMatchObject({ reconciliation: "matched", counterparty: "" });
    expect(row.booking?.entry_ids).toEqual([old.entry_id]);
  });
});
