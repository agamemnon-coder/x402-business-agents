// The runner's books() and the ledger agree on closing cash when a receivable was paid before the first balance read
// (review 153): that payment is inside the read balance. The ledger books it (ar:pay), so its opening leaves it out;
// books() is built from the journal, which has no receivables payment, so its opening must keep it.
import { describe, expect, it } from "vitest";
import { books } from "../src/accounting/books.js";
import { openDb } from "../src/db/open.js";
import { syncLedger } from "../src/ledger/feed.js";
import { cashByCurrency } from "../src/ledger/reports.js";
import { issueInvoice, matchPayment } from "../src/receivables/ar.js";

const now = new Date("2026-11-26T09:00:00Z");

describe("books() and a receivables payment before the first balance read", () => {
  it("closes on the balance read, as the ledger does on the same data", async () => {
    const db = openDb(":memory:");
    await issueInvoice(db, { invoice_no: "NW-1001", customer: "Alpenweg", currency: "EUR", net_cents: 100_000, vat_code: "S21", issue_date: "2026-11-01", due_date: "2026-12-01" }, null, now);
    expect(matchPayment(db, { payment_id: "p1", currency: "EUR", amount_cents: 121_000, reference: "NW-1001", payer: "Alpenweg", received_at: "2026-11-26T08:00:00Z" }, now).outcome).toBe("MATCHED");
    // Airwallex read after the payment: EUR 5,000.00, the 1,210.00 received included.
    db.prepare("INSERT INTO balance_snapshots (taken_at, label, json) VALUES (?, ?, ?)").run("2026-11-26T09:00:00.000Z", "first", JSON.stringify({ EUR: { availableCents: 500_000 } }));
    const eur = books(db).cash.find((c) => c.currency === "EUR");
    expect(eur).toMatchObject({ account: "1200", opening_cents: 500_000, closing_cents: 500_000 });
    syncLedger(db, now);
    expect(cashByCurrency(db).filter((c) => c.currency === "EUR")).toEqual([{ account: "1200", currency: "EUR", balance_cents: eur!.closing_cents }]);
  });
});
