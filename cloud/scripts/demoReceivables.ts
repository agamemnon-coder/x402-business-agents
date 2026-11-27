// The demo company's sales invoices and the payments that came in for them: one story for its books and its Receivables
// page. cloud/scripts/guestSeed.ts books them on the demo company's own ledger, day by day among its other steps, and
// cloud/scripts/moneyLoopSeed.ts builds the Receivables page from the same list, so the ledger's open receivables and the
// page's are the same per currency. Both run the runner's own code (src/receivables/ar.ts): invoices issued and booked
// (no payment link: nothing reaches Airwallex), payments matched by reference and by amount, one short within tolerance,
// one partly paid, one overpaid and one that names no invoice (both to the review queue).
// The customer and payer names stay here and in the runner's tables: the ledger names an invoice by its number, and the
// snapshot by number and amount. Demo data: no real money, no real customer.
import type { DB } from "../../src/db/open.js";
import { issueInvoice, matchPayment } from "../../src/receivables/ar.js";

// Every invoice is issued inside the demo's five weeks (from 10 Oct), so the opening balances stay its first entries.
type Sale = [invoice: string, customer: string, currency: string, netCents: number, vatCode: string, issued: string, due: string];
export const DEMO_SALES: Sale[] = [
  ["NW-2026-131", "Summit Outfitters", "EUR", 98_347, "S21", "2026-10-10", "2026-10-20"],
  ["NW-2026-132", "Alpine Sports Retail", "EUR", 69_860, "S21", "2026-10-10", "2026-10-23"],
  ["NW-2026-133", "Fjord Outdoor AS", "EUR", 132_231, "S0", "2026-10-13", "2026-10-27"],
  ["NW-2026-134", "Highland Trail Ltd", "GBP", 64_000, "S0", "2026-10-16", "2026-10-30"],
  ["NW-2026-135", "Summit Outfitters", "EUR", 132_231, "S21", "2026-10-20", "2026-11-03"],
  ["NW-2026-136", "Kustlijn Buitensport BV", "EUR", 78_512, "S21", "2026-10-22", "2026-11-05"],
  ["NW-2026-137", "Alpine Sports Retail", "EUR", 176_860, "S21", "2026-10-14", "2026-10-28"],
  ["NW-2026-138", "Highland Trail Ltd", "GBP", 98_000, "S0", "2026-10-30", "2026-11-20"],
  ["NW-2026-139", "Rocky Ridge Supply Inc", "USD", 145_000, "S0", "2026-11-02", "2026-12-02"],
  ["NW-2026-140", "Fjord Outdoor AS", "EUR", 155_000, "S0", "2026-11-04", "2026-11-25"],
  ["NW-2026-141", "Kustlijn Buitensport BV", "EUR", 265_488, "S21", "2026-11-10", "2026-12-10"],
];

const open = (db: DB, no: string) => (db.prepare("SELECT amount_cents - paid_cents AS c FROM ar_invoices WHERE invoice_no = ?").get(no) as { c: number }).c;
/** A payment into a Global Account; its amount can depend on what is open when it arrives. */
type Payment = [id: string, currency: string, cents: (db: DB) => number, reference: string | null, day: string];
export const DEMO_PAYMENTS: Payment[] = [
  ["dep_demo_131", "EUR", (db) => open(db, "NW-2026-131"), "Invoice NW-2026-131", "2026-10-19"],
  ["dep_demo_132", "EUR", (db) => open(db, "NW-2026-132") - 120, "Invoice NW-2026-132", "2026-10-24"], // short by EUR 1.20: within tolerance, written off
  ["dep_demo_133", "EUR", (db) => open(db, "NW-2026-133"), "nw-2026-133 thank you", "2026-10-27"],
  ["dep_demo_134", "GBP", (db) => open(db, "NW-2026-134"), null, "2026-10-31"], // no reference: the one open GBP invoice of exactly this amount
  ["dep_demo_135", "EUR", () => 80_000, "NW-2026-135", "2026-11-04"], // partly paid: the rest stays open
  ["dep_demo_136", "EUR", (db) => open(db, "NW-2026-136") + 5_000, "NW-2026-136", "2026-11-06"], // overpaid by EUR 50.00: the excess to review
  ["dep_demo_901", "EUR", () => 42_500, "Order 7781 November", "2026-11-09"], // names no invoice, no exact amount: to review
];

/** Invoices are issued at 09:00 on their day, payments arrive at 11:00 (UTC). */
export const ISSUE_HOUR = 9;
export const PAY_HOUR = 11;

/** The story in date order: each step issues one invoice or matches one payment, `now` being when Purser does it. */
export interface DemoArStep { day: string; hour: number; run: (db: DB, now: Date) => Promise<{ currency: string; received_cents: number }> }
export const DEMO_AR_STEPS: DemoArStep[] = [
  ...DEMO_SALES.map(([no, customer, currency, net, vat, issued, due]): DemoArStep => ({
    day: issued, hour: ISSUE_HOUR,
    run: async (db, now) => { await issueInvoice(db, { invoice_no: no, customer, currency, net_cents: net, vat_code: vat, issue_date: issued, due_date: due }, null, now); return { currency, received_cents: 0 }; },
  })),
  ...DEMO_PAYMENTS.map(([id, currency, cents, reference, day]): DemoArStep => ({
    day, hour: PAY_HOUR,
    run: async (db, now) => {
      const amount = cents(db);
      // Payer names never leave the runner; the demo's payer is a placeholder all the same.
      matchPayment(db, { payment_id: id, currency, amount_cents: amount, reference, payer: "Demo payer", received_at: `${day}T${String(PAY_HOUR).padStart(2, "0")}:00:00.000Z` }, now);
      return { currency, received_cents: amount };
    },
  })),
].sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour);
