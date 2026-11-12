// Master list 77: one cent changed after the CFO's Face ID is refused at all three locks, and each refusal points at the
// same signed hash: payment (the executor's terms check), booking (the ledger's terms lock) and tokenizing (the mint's
// ledger check). In-memory ledgers, a virtual test passkey and the fake Airwallex: no network, no money.
import { describe, expect, it } from "vitest";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { purchaseInvoice, settleOpenItem } from "../src/ledger/documents.js";
import { LedgerRefused, ledgerRows } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { signedTermsRefusal } from "../src/ledger/termsLock.js";
import { approvedInvoice, mintRecord, MintRefused, testnetFaceValue } from "../src/tokenize/record.js";
import { standInLedger } from "../src/tokenize/standIn.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { apJournal } from "../src/ap/books.js";
import { vaultWorld } from "./fakes/vaultWorld.js";
import type { DB } from "../src/db/open.js";
import { fromCents, toCents } from "../src/lib/money.js";

const signedHash = (db: DB, id: string) => (db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ?").get(id) as { approved_sha256: string }).approved_sha256;

/** The one-cent change: the stored terms say 240.01 where the CFO signed 240.00. */
function addOneCent(db: DB, id: string, from: string, to: string): void {
  const row = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string };
  expect(row.terms_json).toContain(`"${from}"`);
  db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(row.terms_json.replace(`"${from}"`, `"${to}"`), id);
}

describe("one cent changed after approval: three locks, one signed hash", () => {
  it("is refused at payment, at booking and at tokenizing, each against the hash the CFO signed", async () => {
    const l = await standInLedger();
    const signed = signedHash(l.db, l.proposalId);
    expect(signed).toMatch(/^[0-9a-f]{64}$/);
    const inv = approvedInvoice(l.db, l.proposalId);
    // Before the change: the token record would carry the signed hash, and booking may post.
    const before = mintRecord(inv, { document: l.document, creditor: `0x${"11".repeat(20)}`, payer: `0x${"22".repeat(20)}`, salt: Buffer.alloc(32, 7), debtorName: "N", faceValue: testnetFaceValue(inv.amountCents, 100) });
    expect(before.termsHash).toBe(`0x${signed}`);
    expect(signedTermsRefusal(l.db, l.proposalId, { amount_cents: 24000, currency: "EUR" })).toBeNull();

    addOneCent(l.db, l.proposalId, "240.00", "240.01");

    // Lock 1, payment: the executor refuses before Airwallex is called, naming the signed hash.
    const awx = new FakeAirwallex();
    await expect(executeInvoicePayment(l.db, awx, null, l.proposalId)).rejects.toThrow(`terms do not match the approved hash ${signed}`);
    expect(l.db.prepare("SELECT COUNT(*) AS n FROM transfers").get()).toEqual({ n: 0 });

    // Lock 2, booking: the accrual and the payment entry are refused with a plain sentence quoting the signed hash.
    const entries = ledgerRows(l.db).length;
    const book = () => purchaseInvoice(l.db, { supplier: inv.vendor, doc_ref: inv.invoiceNo, date: "2026-11-10", due_date: "2026-11-24", currency: "EUR", created_by: "test", proposal_id: l.proposalId, lines: [{ account: "6900", net_cents: 24000, vat_code: "P0" }] });
    expect(book).toThrow(LedgerRefused);
    expect(book).toThrow(`but the CFO signed ${signed}`);
    const pay = () => settleOpenItem(l.db, { kind: "pay", party: inv.vendor, doc_ref: inv.invoiceNo, amount_cents: 24000, currency: "EUR", bank: "1200", date: "2026-11-11", created_by: "test", proposal_id: l.proposalId });
    expect(pay).toThrow(`but the CFO signed ${signed}`);
    expect(ledgerRows(l.db)).toHaveLength(entries);

    // Lock 3, tokenizing: the mint's ledger check refuses the changed terms; the token, had it been minted before, carries
    // the signed hash the other two locks quote.
    expect(() => approvedInvoice(l.db, l.proposalId)).toThrow(MintRefused);
    expect(() => approvedInvoice(l.db, l.proposalId)).toThrow(/do not hash to its terms hash/);
    expect(before.termsHash.slice(2)).toBe(signed);
  }, 60_000);

  it("books the untouched invoice, and holds back a paid one whose terms changed afterwards: nothing posted or reversed", async () => {
    const w = await vaultWorld();
    const signed = signedHash(w.db, w.proposalId);
    expect(apJournal(w.db).some((e) => e.invoice_id === w.paidId)).toBe(true);
    const entries = ledgerRows(w.db).length;
    const terms = w.db.prepare("SELECT json_extract(terms_json, '$.amount') AS amount FROM proposals WHERE proposal_id = ?").get(w.proposalId) as { amount: string };
    addOneCent(w.db, w.proposalId, terms.amount, fromCents(toCents(terms.amount) + 1));

    const r = syncLedger(w.db, w.now);
    expect(r.posted).toBe(0);
    expect(r.reversed).toBe(0);
    expect(r.refused).toHaveLength(1);
    expect(r.refused![0]).toContain(`but the CFO signed ${signed}`);
    expect(ledgerRows(w.db)).toHaveLength(entries);
    // The payables export does not book it either.
    expect(apJournal(w.db).some((e) => e.invoice_id === w.paidId)).toBe(false);
  }, 60_000);

  it("refuses an invoice whose amount differs from the signed terms, even when the terms themselves are untouched", async () => {
    const l = await standInLedger();
    const signed = signedHash(l.db, l.proposalId);
    expect(signedTermsRefusal(l.db, l.proposalId, { amount_cents: 24001, currency: "EUR" })).toBe(`Not booked: the invoice says 24001 cents, but the terms the CFO signed (${signed}) say 24000 cents.`);
    expect(signedTermsRefusal(l.db, l.proposalId, { amount_cents: 24000, currency: "USD" })).toContain("are in EUR");
    expect(signedTermsRefusal(l.db, "P-9999")).toBeNull();
  }, 60_000);
});
