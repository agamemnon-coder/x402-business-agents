// The ISO 20022 export of a paid invoice (src/finance/iso20022.ts) with the least the ledger can hold: no Alta credit
// before it (one leg only), no conversion, no approval on file (the reference falls back to the payout's request id), no
// fee recorded, no beneficiary row (the invoice's own BIC and vendor, the IBAN shown as unknown) and a transfer id that
// is not a UUID (no UETR). A long invoice number is cut to the field's 35 characters. An unpaid invoice is refused.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { pacs008ForInvoice } from "../src/finance/iso20022.js";

function bare(invoiceNo = "INV-1") {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES (?, 'Acme Supplies Ltd', '100.00', 'EUR', '2026-11-30', 'h', 'ABNANL2A', NULL, 'd', 'RECEIVED')").run(invoiceNo);
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('tr_plain_1', 'abcdef12-3456-7890-abcd-ef1234567890', ?, '100.00', 'EUR', 'SWIFT', '20.00', NULL, 'PAID', ?, '2026-11-19T10:00:00.000Z')").run(invoiceNo, "c".repeat(64));
  return db;
}

describe("a pacs.008 for a paid invoice with the least the ledger holds", () => {
  it("has one leg, no UETR, no charges, the invoice's own BIC and vendor, and a reference from the request id", () => {
    const now = new Date("2026-11-19T11:00:00.123Z");
    const r = pacs008ForInvoice(bare(), "INV-1", now);
    expect(r.legs).toEqual({ metal: null, airwallex: "tr_plain_1" });
    expect(r.reference).toBe("PURSER-abcdef12-INV-1");
    expect(r.xml).toContain("<NbOfTxs>1</NbOfTxs>");
    expect(r.xml).toContain("<CreDtTm>2026-11-19T11:00:00Z</CreDtTm>");
    expect(r.xml).not.toContain("<UETR>");
    expect(r.xml).not.toContain("<ChrgsInf>");
    expect(r.xml).not.toContain("prs:AirwallexConversion");
    expect(r.xml).not.toContain("prs:Proposal");
    expect(r.xml).not.toContain("prs:MetalTx");
    expect(r.xml).toContain("<BICFI>ABNANL2A</BICFI>");
    expect(r.xml).toContain("<Cdtr><Nm>Acme Supplies Ltd</Nm></Cdtr>");
    expect(r.xml).toContain("<Id>****????</Id>");
    expect(r.xml).toContain("<InstrId>abcdef1234567890abcdef1234567890</InstrId>");
  });

  it("cuts a long invoice number to the field's 35 characters", () => {
    const long = `INV-${"9".repeat(60)}`;
    const r = pacs008ForInvoice(bare(long), long);
    expect(r.reference).toHaveLength(35);
    expect(r.xml).toContain(`<EndToEndId>${long.slice(0, 35)}</EndToEndId>`);
  });

  it("refuses an invoice with no paid transfer", () => {
    expect(() => pacs008ForInvoice(bare(), "INV-404")).toThrow("no paid transfer for invoice INV-404");
  });
});
