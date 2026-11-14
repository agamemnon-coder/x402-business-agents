// The books, after the CFO review (14 Nov): VAT at no Dutch rate never lands on Dutch input VAT (1510, box 5b), and an
// invoice that reads "Paid" leaves nothing open on 2100.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { accrualEntries, apJournal, SEEDED_PAID_REASON } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, setStatus, type ApInvoiceRow } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { toCents } from "../src/lib/money.js";
import { syncLedger } from "../src/ledger/feed.js";
import { inBaseCurrency, statementView, type BooksStatementFile } from "../src/vault/statementPdf.js";
import { NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-14T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const net = (es: { account: string; debit: string; credit: string }[], account: string) => es.filter((e) => e.account === account).reduce((n, e) => n + (e.debit ? toCents(e.debit) : 0) - (e.credit ? toCents(e.credit) : 0), 0);

const row = (o: Partial<ApInvoiceRow>): ApInvoiceRow => ({
  id: "AP-0009", doc_sha256: "x", doc_kind: "invoice", vendor: "Bergtex Textil GmbH", invoice_no: "BTX-1", issue_date: "2026-11-02", due_date: "2026-11-16",
  currency: "EUR", subtotal: "1554.62", tax: "295.38", total: "1850.00", gl_account: "6200", cost_centre: "CC300", status: "ready", findings: [],
  received_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-03T10:00:00Z", reading: { vat_id: "" }, coding: null, ...o,
} as unknown as ApInvoiceRow);

describe("VAT at no Dutch rate", () => {
  it("a German 19% with no VAT id read goes to 1515, never 1510", () => {
    const es = accrualEntries(row({}));
    expect(net(es, "1510")).toBe(0);
    expect(net(es, "1515")).toBe(29538);
  });
  it("with the German VAT id read: 1515 as before", () => {
    expect(net(accrualEntries(row({ reading: { vat_id: "DE123456789" } } as never)), "1515")).toBe(29538);
  });
  it("Dutch 21% stays Dutch input VAT on 1510", () => {
    const es = accrualEntries(row({ vendor: "Zeeland", subtotal: "400.00", tax: "84.00", total: "484.00" }));
    expect(net(es, "1510")).toBe(8400);
    expect(net(es, "1515")).toBe(0);
  });
  it("any other foreign rate (Belgian 12%) goes to 1515 too", () => {
    expect(net(accrualEntries(row({ subtotal: "260.00", tax: "31.20", total: "291.20" })), "1515")).toBe(3120);
  });
});

describe("an invoice seeded as paid (a test company's history, no money moved)", () => {
  let dir: string;
  let db: DB;
  let deps: InboxDeps;
  beforeEach(async () => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "books-correct-"));
    db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    deps = { dir, reader: parserOnly, now: () => now };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function seeded(reason: string) {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(NL), filename: "nl.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    setStatus(db, out.invoice.id, "paid", "system", { paid_at: now.toISOString(), reason }, now);
    return apInvoice(db, out.invoice.id)!;
  }

  it("is settled against owner's equity: 2100 nets to zero in the journal and in the ledger", async () => {
    const inv = await seeded(`${SEEDED_PAID_REASON} paid before this test company started (simulated, no money moved)`);
    const es = apJournal(db).filter((e) => e.invoice_id === inv.id);
    expect(net(es, "2100")).toBe(0);
    expect(net(es, "3000")).toBe(-toCents(inv.total));
    expect(es.find((e) => e.account === "3000")!.memo).toMatch(/simulated, no money moved/);
    syncLedger(db, now);
    const open = db.prepare("SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS n FROM ledger_lines WHERE account = '2100'").get() as { n: number };
    expect(open.n).toBe(0);
    // Once only: a second sync posts nothing new.
    const before = (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n;
    syncLedger(db, now);
    expect((db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n).toBe(before);
  });

  it("a paid invoice with no payout that was not seeded gets no invented settlement", async () => {
    const inv = await seeded("marked paid by a person");
    expect(apJournal(db).filter((e) => e.invoice_id === inv.id && e.event === "payment")).toEqual([]);
  });
});

describe("another currency in the company's statement", () => {
  const file = (JSON.parse(readFileSync(new URL("../docs/runs/2026-11-13-books-month.json", import.meta.url), "utf8")) as { books: BooksStatementFile }).books;
  it("the GBP expenses and their reverse charge are in the EUR statement at the conversion's rate, and money in transit is cleared", () => {
    const { file: eur, note } = inBaseCurrency(file);
    expect(note).toBe("GBP translated into EUR at the rate of the conversion that bought it: EUR 982.80 for GBP 840.00 (1.17), so money in transit is cleared.");
    expect(eur.balance.map((b) => b.currency)).toEqual(["EUR", "USD"]);
    expect(eur.balance[0]!.accounts.some((a) => a.account === "1590")).toBe(false);
    const pnl = eur.pnl.find((p) => p.currency === "EUR")!;
    // EUR 2,750.00 on 6150 already, plus GBP 840.00 at 1.17.
    expect(pnl.accounts.find((a) => a.account === "6150")!.amount).toBe("3732.80");
    expect(Number(pnl.expense)).toBeCloseTo(Number(file.pnl[0]!.expense) + 982.8, 2);
    // GBP 176.40 reverse charge, both sides: EUR 206.39 (176.40 x 1.17 = 206.388).
    const a = (n: string) => Number(eur.balance[0]!.accounts.find((x) => x.account === n)!.amount);
    expect(a("1510") - Number(file.balance[0]!.accounts.find((x) => x.account === "1510")!.amount)).toBeCloseTo(206.39, 2);
    expect(a("2210") - Number(file.balance[0]!.accounts.find((x) => x.account === "2210")!.amount)).toBeCloseTo(206.39, 2);
    expect(statementView(file)!.balances).toBe(true);
  });
  it("leaves the file as it is when no single conversion explains money in transit", () => {
    const two = structuredClone(file);
    two.balance[2]!.accounts.push({ account: "1590", name: "Money in transit", type: "asset", amount: "-10.00" });
    expect(inBaseCurrency(two)).toEqual({ file: two, note: null });
  });
});

describe("an invoice waiting for its new supplier to be verified", () => {
  it("is accrued (owed from the day it came in); one with a finding to review or a block is not", async () => {
    const { bookable } = await import("../src/ap/books.js");
    const wait = { level: "wait", code: "new_supplier", detail: "" } as const;
    expect(bookable({ status: "needs_vendor", findings: [wait], total: "484.00" } as never)).toBe(true);
    expect(bookable({ status: "needs_vendor", findings: [wait, { level: "warn", code: "overdue", detail: "" }], total: "484.00" } as never)).toBe(true);
    expect(bookable({ status: "needs_vendor", findings: [wait, { level: "review", code: "unusual_amount", detail: "" }], total: "484.00" } as never)).toBe(false);
    expect(bookable({ status: "blocked", findings: [{ level: "block", code: "duplicate", detail: "" }], total: "484.00" } as never)).toBe(false);
  });
});

describe("a SEPA supplier's EUR", () => {
  it("is paid locally by IBAN in every SEPA country, with the IBAN's own length checked; a country outside SEPA still has no route", async () => {
    const { chooseRoute, validateDetails } = await import("../src/payouts/routes.js");
    for (const [country, iban] of [["BE", "BE68539007547034"], ["FR", "FR1420041010050500013M02606"], ["IE", "IE29AIBK93115212345678"]] as const) {
      const d = { country, currency: "EUR", accountName: "Supplier SA", iban };
      const r = chooseRoute(d);
      if (!r.ok) throw new Error(r.reason);
      expect(r.route).toMatchObject({ country, method: "LOCAL", currency: "EUR", clearing: "SEPA" });
      expect(validateDetails(d, r.route)).toEqual([]);
      expect(validateDetails({ ...d, iban: iban.slice(0, -1) }, r.route)[0]).toMatch(/IBAN has \d+ characters/);
    }
    expect(chooseRoute({ country: "BR", currency: "EUR", accountName: "Fornecedor", iban: "BR1800360305000010009795493C1" }).ok).toBe(false);
  });
});
