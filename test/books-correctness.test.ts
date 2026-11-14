// The books, after the CFO review (14 Nov): VAT at no Dutch rate never lands on Dutch input VAT (1510, box 5b), and an
// invoice that reads "Paid" leaves nothing open on 2100.
import { mkdtempSync, rmSync } from "node:fs";
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
