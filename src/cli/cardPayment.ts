// npm run card-payment -- [invoice_no]: a customer pays one Northwind invoice by card through Airwallex payment
// acceptance, in the sandbox, with Airwallex's documented success test card (src/airwallex/acceptance.ts). Needs
// AIRWALLEX_PAYMENT_ACCEPTANCE=on and the sandbox keys; a live run also sets AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG.
// Opens the invoice in the ledger (KIT11_DB) if it is not there, then: create, confirm, read back, book only if SUCCEEDED.
// Prints ids and statuses only; never a key, a token or a card number.

import { openReceivable } from "../agents/receivables.js";
import { AcceptanceRest, collectInvoiceByCard } from "../airwallex/acceptance.js";
import { fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { redactSecrets } from "../lib/redact.js";

const cfg = fromEnv();
if (!cfg) {
  console.error("The Airwallex sandbox keys are not set; nothing was done.");
  process.exit(1);
}
const invoiceNo = process.argv[2] ?? "NW-R-PA1";
const db = openDb();
openReceivable(db, { invoice_no: invoiceNo, customer: "Fjord & Fell Outfitters (test customer)", currency: "EUR", amount_cents: 2_490, due_date: "2026-12-10" });
try {
  const r = await collectInvoiceByCard(db, new AcceptanceRest(cfg), invoiceNo);
  console.log(JSON.stringify({ invoice_no: invoiceNo, payment_intent_id: r.payment_intent_id, status: r.status, booked: r.booked, outcome: r.outcome, detail: r.detail, test_money: true }, null, 2));
} catch (err) {
  console.error(redactSecrets(String((err as Error).message)));
  process.exit(1);
}
