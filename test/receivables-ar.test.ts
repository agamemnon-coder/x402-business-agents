// Receivables, money in (src/receivables/ar.ts): an invoice is issued and booked, its Airwallex payment link made (a
// mocked client: nothing leaves the machine), a payment arrives, is matched and booked in double entry; partial and
// over-payments, payments to review, aged debtors and reminder drafts. Breaks if a payment is booked twice, if money
// that names no invoice reaches revenue, if a short payment beyond the tolerance closes an invoice, if a reminder is
// anything but a draft, or if a customer's contact address or name reaches the audit log or the console.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { openReceivable } from "../src/agents/receivables.js";
import { trialBalance } from "../src/ledger/reports.js";
import { agedDebtors, arBucket, dunningDates, draftReminders, issueInvoice, matchPayment, reviewQueue, retireDoneLinks, routeDeposit, toleranceCents, type IncomingPayment } from "../src/receivables/ar.js";
import { ledgerForecast } from "../src/treasury/advisor.js";

const now = new Date("2026-11-26T09:00:00Z");
const EMAIL = "jane.doe@alpenweg.example";

class MockLinks {
  calls: { method: string; path: string; body?: unknown }[] = [];
  answer: (body: Record<string, unknown>) => Record<string, unknown> = (b) => ({ ...b, id: `plink_${this.calls.length}`, url: `https://checkout.sandbox.example/plink_${this.calls.length}`, active: true });
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path, body });
    if (path.endsWith("/deactivate")) return { id: path.split("/")[3], active: false, amount: 0, currency: "EUR" } as T;
    return this.answer(body as Record<string, unknown>) as T;
  }
}

async function world(): Promise<{ db: DB; links: MockLinks }> {
  const db = openDb(":memory:");
  const links = new MockLinks();
  await issueInvoice(db, { invoice_no: "NW-1001", customer: "Alpenweg Sport AG", contact_email: EMAIL, currency: "EUR", net_cents: 100_000, vat_code: "S21", issue_date: "2026-11-01", due_date: "2026-12-01" }, links, now);
  await issueInvoice(db, { invoice_no: "NW-1002", customer: "Fellside Outdoor Ltd", currency: "GBP", net_cents: 50_000, vat_code: "S0", issue_date: "2026-11-02", due_date: "2026-12-02" }, links, now);
  await issueInvoice(db, { invoice_no: "NW-1003", customer: "Kustlijn Buitensport BV", currency: "EUR", net_cents: 30_000, vat_code: "S0", issue_date: "2026-11-03", due_date: "2026-12-03" }, links, now);
  return { db, links };
}
const pay = (id: string, currency: string, cents: number, reference: string | null): IncomingPayment => ({ payment_id: id, currency, amount_cents: cents, reference, payer: "Jane Doe", received_at: "2026-11-26T08:00:00Z" });
const balance = (db: DB, account: string, currency: string) => {
  const r = trialBalance(db).find((x) => x.account === account && x.currency === currency);
  return r ? r.debit_cents - r.credit_cents : 0;
};

afterEach(() => vi.restoreAllMocks());

describe("issuing an invoice", () => {
  it("books debtors against revenue and VAT, and makes a single-use link for exactly the invoice", async () => {
    const { db, links } = await world();
    expect(links.calls[0]).toMatchObject({ method: "POST", path: "/pa/payment_links/create", body: { amount: 1210, currency: "EUR", reference: "NW-1001", reusable: false } });
    expect(db.prepare("SELECT amount_cents, status, link_active FROM ar_invoices WHERE invoice_no = 'NW-1001'").get()).toEqual({ amount_cents: 121_000, status: "OPEN", link_active: 1 });
    expect(balance(db, "1300", "EUR")).toBe(121_000 + 30_000);
    expect(balance(db, "4200", "EUR")).toBe(-130_000);
    expect(balance(db, "2210", "EUR")).toBe(-21_000);
    await expect(issueInvoice(db, { invoice_no: "NW-1001", customer: "x", currency: "EUR", net_cents: 1, vat_code: "S0", issue_date: "2026-11-01", due_date: "2026-12-01" }, null, now)).rejects.toThrow(/already issued/);
  });

  it("keeps no link that is not exactly the invoice", async () => {
    const db = openDb(":memory:");
    const links = new MockLinks();
    links.answer = (b) => ({ ...b, id: "plink_bad", url: "https://x", amount: 1, active: true });
    const r = await issueInvoice(db, { invoice_no: "NW-2001", customer: "Alpenweg Sport AG", currency: "EUR", net_cents: 10_000, vat_code: "S0", issue_date: "2026-11-01", due_date: "2026-12-01" }, links, now);
    expect(r.link).toBeNull();
    expect(r.link_problem).toMatch(/not this invoice/);
    expect(links.calls.at(-1)!.path).toBe("/pa/payment_links/plink_bad/deactivate");
  });
});

describe("matching a payment", () => {
  it("issue → link → payment → matched → booked: bank against debtors, once, and the link switched off", async () => {
    const { db, links } = await world();
    expect(matchPayment(db, pay("dep-1", "EUR", 121_000, "Invoice nw 1001 thanks"), now)).toMatchObject({ outcome: "MATCHED", invoice_no: "NW-1001", applied_cents: 121_000, repeat: false });
    expect(matchPayment(db, pay("dep-1", "EUR", 121_000, "Invoice nw 1001 thanks"), now)).toMatchObject({ outcome: "MATCHED", repeat: true });
    expect(db.prepare("SELECT status, paid_cents FROM ar_invoices WHERE invoice_no = 'NW-1001'").get()).toEqual({ status: "PAID", paid_cents: 121_000 });
    expect(balance(db, "1200", "EUR")).toBe(121_000);
    expect(balance(db, "1300", "EUR")).toBe(30_000);
    expect((db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE source_key = 'ar:pay:dep-1'").get() as { n: number }).n).toBe(1);
    expect(await retireDoneLinks(db, links, now)).toEqual(["NW-1001"]);
    expect(db.prepare("SELECT link_active FROM ar_invoices WHERE invoice_no = 'NW-1001'").get()).toEqual({ link_active: 0 });
  });

  it("matches by amount when no invoice is named and exactly one open invoice fits; never guesses between two", async () => {
    const { db } = await world();
    expect(matchPayment(db, pay("dep-2", "GBP", 50_000, "PAYMENT"), now)).toMatchObject({ outcome: "MATCHED", invoice_no: "NW-1002", rule: expect.stringMatching(/exactly this amount/) });
    await issueInvoice(db, { invoice_no: "NW-1004", customer: "Kustlijn Buitensport BV", currency: "EUR", net_cents: 30_000, vat_code: "S0", issue_date: "2026-11-04", due_date: "2026-12-04" }, null, now);
    expect(matchPayment(db, pay("dep-3", "EUR", 30_000, null), now)).toMatchObject({ outcome: "REVIEW", invoice_no: null });
    expect(reviewQueue(db).map((r) => r.reason)).toEqual(["no invoice named and 2 open invoices are open for exactly this amount"]);
  });

  it("closes a short payment within the tolerance and writes the difference off; beyond it, the rest stays open", async () => {
    const { db } = await world();
    expect(toleranceCents(121_000)).toBe(200);
    expect(toleranceCents(30_000)).toBe(150);
    expect(matchPayment(db, pay("dep-4", "EUR", 120_850, "NW-1001"), now)).toMatchObject({ outcome: "MATCHED_TOLERANCE", applied_cents: 120_850, written_off_cents: 150 });
    expect(db.prepare("SELECT status FROM ar_invoices WHERE invoice_no = 'NW-1001'").get()).toEqual({ status: "PAID" });
    expect(balance(db, "6800", "EUR")).toBe(150);
    expect(matchPayment(db, pay("dep-5", "EUR", 20_000, "NW-1003"), now)).toMatchObject({ outcome: "PARTIAL", applied_cents: 20_000, written_off_cents: 0 });
    expect(db.prepare("SELECT status, paid_cents FROM ar_invoices WHERE invoice_no = 'NW-1003'").get()).toEqual({ status: "PARTIAL", paid_cents: 20_000 });
    expect(matchPayment(db, pay("dep-6", "EUR", 10_000, "rest of NW-1003"), now)).toMatchObject({ outcome: "MATCHED" });
    expect(balance(db, "1300", "EUR")).toBe(0);
  });

  it("applies what is open of an overpayment and holds the excess in suspense, for the CFO to refund or credit", async () => {
    const { db } = await world();
    expect(matchPayment(db, pay("dep-7", "GBP", 60_000, "NW-1002"), now)).toMatchObject({ outcome: "OVERPAID", applied_cents: 50_000, suspense_cents: 10_000 });
    expect(balance(db, "2900", "GBP")).toBe(-10_000);
    expect(balance(db, "1202", "GBP")).toBe(60_000);
    expect(reviewQueue(db)).toEqual([expect.objectContaining({ payment_id: "dep-7", reason: expect.stringMatching(/overpaid by GBP 100\.00/) })]);
  });

  it("sends an unknown payment, one in the wrong currency and one for a paid invoice to review, in suspense, never revenue", async () => {
    const { db } = await world();
    const revenue = balance(db, "4200", "EUR");
    expect(matchPayment(db, pay("dep-8", "EUR", 2_500, "deposit"), now).outcome).toBe("REVIEW");
    expect(matchPayment(db, pay("dep-9", "EUR", 50_000, "NW-1002"), now).outcome).toBe("REVIEW");
    matchPayment(db, pay("dep-10", "EUR", 121_000, "NW-1001"), now);
    expect(matchPayment(db, pay("dep-11", "EUR", 121_000, "NW-1001 again"), now).outcome).toBe("REVIEW");
    expect(reviewQueue(db).map((r) => [r.payment_id, r.reason])).toEqual([
      ["dep-11", "NW-1001 is already paid"], ["dep-8", "no invoice named and no open invoice is open for exactly this amount"], ["dep-9", "NW-1002 is invoiced in GBP, the payment is in EUR"],
    ]);
    expect(balance(db, "2900", "EUR")).toBe(-(2_500 + 50_000 + 121_000));
    expect(balance(db, "4200", "EUR")).toBe(revenue);
  });

  it("routes a deposit naming an older receivable to the older matcher, and its own invoices to this one, each once", async () => {
    const { db } = await world();
    openReceivable(db, { invoice_no: "NW-R-101", customer: "Alpenweg Sport AG", currency: "EUR", amount_cents: 124_000, due_date: "2026-12-29" }, now);
    const dep = (id: string, ref: string, cents: number) => ({ deposit_id: id, global_account_id: "ga", currency: "EUR", amount_cents: cents, reference: ref, payer: "x", received_at: "2026-11-26T08:00:00Z" });
    expect(routeDeposit(db, dep("d-old", "NW-R-101", 124_000), now)).toMatchObject({ by: "receivables", outcome: "MATCHED" });
    expect(routeDeposit(db, dep("d-new", "NW-1003", 30_000), now)).toMatchObject({ by: "ar", outcome: "MATCHED" });
    expect(routeDeposit(db, dep("d-new", "NW-1003", 30_000), now)).toMatchObject({ by: "ar", outcome: "MATCHED" });
    expect(routeDeposit(db, dep("d-old", "NW-R-101", 124_000), now)).toMatchObject({ by: "receivables" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ar_payments").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM receipts").get()).toEqual({ n: 1 });
  });
});

describe("aged debtors and reminders", () => {
  it("ages open invoices by days past due into 0-30, 31-60, 61-90 and 90+, per currency", async () => {
    const { db } = await world();
    expect([0, 30, 31, 60, 61, 90, 91].map(arBucket)).toEqual(["0-30", "0-30", "31-60", "31-60", "61-90", "61-90", "90+"]);
    matchPayment(db, pay("dep-12", "EUR", 10_000, "NW-1003"), now);
    const a = agedDebtors(db, "2027-02-05");
    expect(a.rows.map((r) => [r.invoice_no, r.days_overdue, r.bucket, r.open_cents])).toEqual([["NW-1001", 66, "61-90", 121_000], ["NW-1002", 65, "61-90", 50_000], ["NW-1003", 64, "61-90", 20_000]]);
    expect(a.totals).toEqual({ EUR: { "0-30": 0, "31-60": 0, "61-90": 141_000, "90+": 0 }, GBP: { "0-30": 0, "31-60": 0, "61-90": 50_000, "90+": 0 } });
    const early = agedDebtors(db, "2026-11-26");
    expect(early.totals.EUR!["0-30"]).toBe(141_000);
    expect(early.not_due).toEqual({ EUR: 141_000, GBP: 50_000 });
  });

  it("drafts reminders at due + 3, + 10 and + 20 days, once each, for open invoices only, and sends nothing", async () => {
    const { db } = await world();
    expect(dunningDates("2026-12-01")).toEqual([{ stage: 1, on: "2026-12-04" }, { stage: 2, on: "2026-12-11" }, { stage: 3, on: "2026-12-21" }]);
    expect(draftReminders(db, "2026-12-03", now)).toEqual([]);
    const d = draftReminders(db, "2026-12-11", now);
    expect(d.map((x) => [x.invoice_no, x.stage, x.due_on])).toEqual([["NW-1001", 1, "2026-12-04"], ["NW-1002", 1, "2026-12-05"], ["NW-1003", 1, "2026-12-06"], ["NW-1001", 2, "2026-12-11"]]);
    expect(d[0]!.draft).toMatch(/EUR 1210\.00 was due on 2026-12-01/);
    expect(d[0]!.draft).toMatch(/https:\/\/checkout\.sandbox\.example\//);
    expect(d[0]!.draft).toMatch(/not sent by Purser/);
    expect(draftReminders(db, "2026-12-11", now)).toHaveLength(4);
    matchPayment(db, pay("dep-13", "EUR", 121_000, "NW-1001"), now);
    expect(draftReminders(db, "2026-12-31", now).map((x) => x.invoice_no)).not.toContain("NW-1001");
    expect(() => db.prepare("UPDATE ar_dunning SET status = 'SENT'").run()).toThrow(/CHECK/);
  });
});

describe("privacy and the forecast", () => {
  it("never writes a customer's contact address, its name or the payer's name to the audit log or the console", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const { db } = await world();
    matchPayment(db, pay("dep-14", "EUR", 121_000, "NW-1001"), now);
    matchPayment(db, pay("dep-15", "EUR", 999, "who knows"), now);
    draftReminders(db, "2027-01-31", now);
    const audit = (db.prepare("SELECT payload_json || ' ' || COALESCE(subject, '') AS t FROM audit_log").all() as { t: string }[]).map((r) => r.t).join("\n");
    const printed = [...log.mock.calls, ...err.mock.calls].flat().join("\n");
    for (const pii of [EMAIL, "Alpenweg", "Jane Doe"]) {
      expect(audit).not.toContain(pii);
      expect(printed).not.toContain(pii);
    }
    expect(audit).toContain("NW-1001");
  });

  it("feeds open customer invoices into the treasury forecast as expected cash", async () => {
    const { db } = await world();
    matchPayment(db, pay("dep-16", "EUR", 20_000, "NW-1003"), now);
    const f = ledgerForecast(db, "2026-11-26");
    expect(f.currencies.find((c) => c.currency === "EUR")!.in_cents).toBe(121_000 + 10_000);
    expect(f.currencies.find((c) => c.currency === "EUR")!.opening_cents).toBe(20_000);
  });
});
