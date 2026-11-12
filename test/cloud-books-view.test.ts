// The Books screen's timeline and three-way line (master list 137, 134), as the very text the page runs: one line per
// document, newest first, amounts computed from the ledger's own lines; the three-way line carried as computed data.
import { describe, expect, it } from "vitest";
import { BOOKS_VIEW_JS, booksViewData } from "../cloud/src/booksView.js";
import { t0Check, moneybirdCheck, T0_READBACK_2026_11_10, threeWayLine } from "../src/accounting/recordedChecks.js";
import { ledgerRows } from "../src/ledger/core.js";
import { vaultWorld } from "./fakes/vaultWorld.js";
import { openDb } from "../src/db/open.js";
import { purchaseInvoice, settleOpenItem } from "../src/ledger/documents.js";
import { reverseEntry } from "../src/ledger/core.js";
import { toCents } from "../src/lib/money.js";

interface Doc { key: string; doc_ref: string | null; party: string | null; date: string; kind: string; amount: Record<string, number>; status: string; entries: { entry_id: number }[]; rail_refs: string[]; approval_sha256: string | null }
const B = new Function(`${BOOKS_VIEW_JS}\nreturn { docTimeline };`)() as { docTimeline(e: unknown[]): Doc[] };
const NOW = new Date("2026-11-12T10:00:00Z");

describe("the entries as a timeline", () => {
  it("gives one line per document with the gross owed, the supplier and paid or open, newest first", () => {
    const db = openDb(":memory:");
    const buy = (ref: string, day: string, net: number) => purchaseInvoice(db, { supplier: `Supplier ${ref} (test)`, doc_ref: ref, date: day, due_date: "2026-12-01", currency: "EUR", created_by: "test", lines: [{ account: "6900", net_cents: net, vat_code: "P21" }] }, NOW);
    buy("A-1", "2026-11-01", 10_000);
    buy("B-2", "2026-11-03", 20_000);
    settleOpenItem(db, { kind: "pay", party: "Supplier A-1 (test)", doc_ref: "A-1", amount_cents: 12_100, currency: "EUR", bank: "1200", date: "2026-11-05", created_by: "test" }, NOW);
    buy("C-3", "2026-11-04", 5_000);
    reverseEntry(db, 4, "entered twice", "test", NOW);
    const docs = B.docTimeline(ledgerRows(db) as unknown[]);
    expect(docs.map((d) => [d.doc_ref, d.status, d.amount.EUR ?? null])).toEqual([
      ["C-3", "reversed", null],
      ["A-1", "paid", 12_100],
      ["B-2", "open", 24_200],
    ]);
    expect(docs[1]!.party).toBe("Supplier A-1 (test)");
    expect(docs[1]!.entries.map((e) => e.entry_id)).toEqual([3, 1]);
  });

  it("reads the vault world's paid invoice as paid, with its own total", async () => {
    const w = await vaultWorld();
    const docs = B.docTimeline(ledgerRows(w.db) as unknown[]);
    const paid = docs.filter((d) => d.kind === "payable");
    expect(paid.length).toBeGreaterThan(0);
    const inv = w.db.prepare("SELECT total FROM ap_invoices WHERE id = ?").get(w.paidId) as { total: string };
    const cents = toCents(inv.total);
    expect(paid.find((d) => d.status === "paid")!.amount.EUR).toBe(cents);
  }, 60_000);
});

describe("the three-way line on the page", () => {
  it("carries the computed line: the tick and its label, or the differences and no tick", () => {
    expect(booksViewData().three_way).toEqual({ tick: true, text: threeWayLine().text, label: threeWayLine().label, differences: [] });
    const off = threeWayLine([t0Check(T0_READBACK_2026_11_10.map((r, i) => (i === 0 ? { ...r, t0: "11,144,700.06" } : r))), moneybirdCheck()]);
    expect(booksViewData(off).three_way).toMatchObject({ tick: false, differences: ["T0: Account 11120 (1200), net: Purser 11,144,700.05, T0 11,144,700.06"] });
  });
});
