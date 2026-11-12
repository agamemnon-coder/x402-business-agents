// Property tests for the bookkeeping integrations (master list 725): whole cents go to Moneybird, Exact Online and T:0
// and come back as the same cents for every amount fast-check can think of, debits equal credits in every T:0 entry,
// and a second sync of the same books sends nothing. Fakes and recording transports only: no network.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { doubleEntry } from "../src/accounting/books.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { buildEntries } from "../src/accounting/t0.js";
import { CHART } from "../src/config/gl.js";
import { openDb } from "../src/db/open.js";
import { staticToken } from "../src/erp/auth.js";
import { RecordingTransport, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import { ExactConnector, type ExactConfig } from "../src/erp/exact.js";
import type { PurchaseInvoice } from "../src/erp/model.js";
import { fromMoney, MoneybirdConnector, toMoney, type MoneybirdConfig } from "../src/erp/moneybird.js";
import { syncAll, type SyncItem } from "../src/erp/sync.js";
import { sampleInvoice, sampleVendor } from "./fakes/erp.js";
import { FakeMoneybird, TAX } from "./fakes/moneybird.js";

const RUNS = { numRuns: 300 };
const noSleep = async () => {};
/** Net amounts of one invoice line, in cents: from one cent to ten million euro, the edges weighted. */
const netCents = fc.oneof(fc.integer({ min: 1, max: 1_000_000_000 }), fc.constantFrom(1, 5, 49, 50, 99, 100, 101, 999_999));
/** VAT the way the books compute it (whole cents, half up), for 21 % and 9 %. */
const vatOf = (net: number, pct: number) => Math.round((net * pct) / 100);
const lines = fc.array(fc.tuple(netCents, fc.constantFrom(21, 9)), { minLength: 1, maxLength: 5 });

function invoiceOf(ls: [number, number][], n: number): PurchaseInvoice {
  const base = sampleInvoice();
  const out = ls.map(([net, pct], i) => ({ description: `Line ${i + 1}`, glAccount: "6200", vatCode: pct === 21 ? "NL21" as const : "NL9" as const, netCents: net, vatCents: vatOf(net, pct) }));
  const netSum = out.reduce((s, l) => s + l.netCents, 0), vatSum = out.reduce((s, l) => s + l.vatCents, 0);
  return { ...base, id: `INV-${n}`, number: `BT-P-${n}`, lines: out, totals: { netCents: netSum, vatCents: vatSum, grossCents: netSum + vatSum } };
}

describe("Moneybird: the cents round trip", () => {
  it("toMoney then fromMoney gives back the same cents, sign included", () => {
    // Breaks if: the money string loses a leading zero in the cents, or the sign.
    fc.assert(fc.property(fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), (c) => {
      expect(fromMoney(toMoney(c))).toBe(c);
    }), { numRuns: 1000 });
  });

  it("a purchase invoice sent to Moneybird reads back with every line's net and the totals to the cent; a second sync sends nothing", async () => {
    // Breaks if: the connector sends amounts as floats, or rounds a line, or posts an unchanged invoice again.
    let n = 0;
    await fc.assert(fc.asyncProperty(lines, async (ls) => {
      const fake = new FakeMoneybird();
      const cfg: MoneybirdConfig = {
        baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR",
        taxRates: { NL21: TAX[0]!.id, NL9: TAX[1]!.id, NL0: TAX[2]!.id }, glMap: {}, projects: {}, ignoreCostCentres: true,
      };
      const c = new MoneybirdConnector(cfg, fake.transport, staticToken(fake.token));
      const db = openDb(":memory:");
      const inv = invoiceOf(ls, ++n);
      const items: SyncItem[] = [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: inv }];
      const first = await syncAll(db, c, items, { sleep: noSleep });
      expect(first.map((r) => r.outcome)).toEqual(["pushed", "pushed"]);
      const stored = [...fake.invoices.values()];
      expect(stored).toHaveLength(1);
      expect(stored[0]!.details.map((d) => fromMoney(d.price)! * Number(d.amount))).toEqual(inv.lines.map((l) => l.netCents));
      expect(fromMoney(stored[0]!.total_price_excl_tax)).toBe(inv.totals.netCents);
      expect(fromMoney(stored[0]!.total_price_incl_tax)).toBe(inv.totals.grossCents);
      const writes = () => fake.transport.sent.filter((r) => r.method !== "GET").length;
      const before = writes();
      const second = await syncAll(db, c, items, { sleep: noSleep });
      expect(second.map((r) => r.outcome)).toEqual(["unchanged", "unchanged"]);
      expect(writes()).toBe(before);
    }), { numRuns: 60 });
  });
});

describe("Exact Online: the cents round trip", () => {
  const BASE = "https://start.exactonline.nl/api/v1/123456";
  const config: ExactConfig = {
    baseUrl: "https://start.exactonline.nl", division: 123456, purchaseJournal: "60", bankJournals: { "1200": "20" }, generalJournal: "90",
    vatCodes: { NL21: "2", NL9: "1", NL0: "0", EU_RC: "6", NONEU_RC: "7", EXEMPT: "0", NONE: "0" }, glMap: {}, apAccount: "1600", documentType: 20, paymentSign: -1,
  };
  const ok = (d: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify({ d }) });
  const GL = [{ ID: "aaaaaaaa-0000-0000-0000-000000006200", Code: "6200", Description: "Inkoop" }];
  const refs = { vendor: () => "11111111-2222-3333-4444-555555555555", invoice: () => "99999999-8888-7777-6666-555555555555" };

  it("every purchase entry line's AmountFC and VATAmountFC, read back as cents, are the line's own cents", async () => {
    // Breaks if: the euro amounts Exact takes are computed with float arithmetic that drifts, or rounded per line.
    await fc.assert(fc.asyncProperty(lines, async (ls) => {
      const tr = new RecordingTransport((req: HttpRequest) => {
        if (req.method === "GET" && req.url.startsWith(`${BASE}/financial/GLAccounts`)) return ok({ results: GL });
        if (req.url.endsWith("/documents/Documents")) return ok({ ID: "doc-guid" }, 201);
        if (req.url.endsWith("/documents/DocumentAttachments")) return ok({ ID: "att-guid" }, 201);
        if (req.url.endsWith("/purchaseentry/PurchaseEntries")) return ok({ EntryID: "entry-guid" }, 201);
        throw new Error(`unexpected ${req.url}`);
      });
      const inv = invoiceOf(ls, 1);
      await new ExactConnector(config, tr, staticToken("tok")).pushPurchaseInvoice(inv, refs);
      const entry = JSON.parse(tr.sent.find((r) => r.url.endsWith("/purchaseentry/PurchaseEntries"))!.body as string) as { PurchaseEntryLines: { AmountFC: number; VATAmountFC: number }[] };
      // A JSON number is what Exact reads: the cents are the number times 100, exactly, with no float residue in the text.
      expect(entry.PurchaseEntryLines.map((l) => [Math.round(l.AmountFC * 100), Math.round(l.VATAmountFC * 100)])).toEqual(inv.lines.map((l) => [l.netCents, l.vatCents]));
      for (const l of entry.PurchaseEntryLines) for (const v of [l.AmountFC, l.VATAmountFC]) expect(String(v)).toMatch(/^\d+(\.\d{1,2})?$/);
    }), { numRuns: 200 });
  });
});

describe("T:0: the cents round trip, balanced, and stable", () => {
  const map = new Map(Object.keys(CHART).map((c) => [c, `gl_${c}`]));
  const line = (o: Partial<JournalLine>): JournalLine => ({
    date: "2026-11-12T10:00:00Z", source: "card", ref: "r", description: "d", counterparty: "c", agent: "sourcing", cost_centre: "",
    gl_account: "6100", gl_name: "Software", bank_account: "1200", amount: "-1.00", currency: "EUR", proof: "p", approval: "", rule: "", ...o,
  });
  const cents = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
  /** A day of card payments and refunds in EUR, each its own entry. */
  const day = fc.array(fc.tuple(fc.integer({ min: 1, max: 100_000_000 }), fc.boolean()), { minLength: 1, maxLength: 8 })
    .map((xs) => xs.map(([c, out], i) => line({ ref: `txn_${i}`, proof: `txn_${i}`, amount: cents(out ? -c : c) })));

  it("in the functional currency, every line's atoms are its cents, and each entry's debits equal its credits", () => {
    // Breaks if: the atoms per unit are applied twice, or a line's side is flipped.
    fc.assert(fc.property(day, (ls) => {
      const postings = doubleEntry(ls);
      const entries = buildEntries(postings, map, "EUR", () => 1, { atomsPerUnit: 100 });
      const byEntry = new Map<string, number[]>();
      for (const p of postings) byEntry.set(p.entry, [...(byEntry.get(p.entry) ?? []), p.debit_cents || p.credit_cents]);
      expect(entries.map((e) => e.request.lines.map((l) => l.amount_atoms))).toEqual([...byEntry.values()]);
      for (const e of entries) {
        const sum = (side: string) => e.request.lines.filter((l) => l.line_type === side).reduce((s, l) => s + l.amount_atoms, 0);
        expect(sum("debit")).toBe(sum("credit"));
      }
    }), RUNS);
  });

  it("converted at any rate, each entry still balances to the atom and keeps the original cents beside it", () => {
    // Breaks if: the rounding gap between debit and credit lines is no longer closed.
    fc.assert(fc.property(day, fc.double({ min: 0.01, max: 1_000, noNaN: true }), (ls, rate) => {
      const postings = doubleEntry(ls);
      // A line that would be zero after conversion is refused for the whole push, never posted as zero.
      if (postings.some((p) => Math.round((p.debit_cents || p.credit_cents) * rate) === 0)) {
        expect(() => buildEntries(postings, map, "USD", () => rate, { atomsPerUnit: 100 })).toThrow(/zero in USD/);
        return;
      }
      const entries = buildEntries(postings, map, "USD", () => rate, { atomsPerUnit: 100 });
      for (const e of entries) {
        const sum = (side: string) => e.request.lines.filter((l) => l.line_type === side).reduce((s, l) => s + l.amount_atoms, 0);
        expect(sum("debit")).toBe(sum("credit"));
        expect(e.request.lines.every((l) => Number.isSafeInteger(l.transaction_amount_atoms) && l.transaction_amount_atoms! > 0)).toBe(true);
      }
    }), RUNS);
  });

  it("builds the same journal numbers and idempotency keys from the same books, so a re-sync is recognised", () => {
    // Breaks if: an entry's number depends on anything but its content (a clock, a counter, the order of runs).
    fc.assert(fc.property(day, (ls) => {
      const a = buildEntries(doubleEntry(ls), map, "EUR", () => 1);
      const b = buildEntries(doubleEntry(ls), map, "EUR", () => 1);
      expect(b.map((e) => [e.jeNumber, e.idempotencyKey])).toEqual(a.map((e) => [e.jeNumber, e.idempotencyKey]));
      expect(new Set(a.map((e) => e.jeNumber)).size).toBe(a.length);
    }), RUNS);
  });
});
