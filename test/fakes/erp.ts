// Test data for the ERP connectors: one supplier, one invoice with two lines (21% and 9% VAT), its payment and a
// balanced journal entry. Test money only; the IBAN is the well-known German example number.
import { createHash } from "node:crypto";
import type { JournalEntry, Payment, PurchaseInvoice, Vendor } from "../../src/erp/model.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const TEST_IBAN = "DE89370400440532013000";

export function sampleVendor(): Vendor {
  return {
    id: "V-1", name: "Bergtex Textil GmbH", vatId: "DE123456789", iban: TEST_IBAN, ibanLast4: "3000", ibanSha256: sha(TEST_IBAN),
    bic: "COBADEFFXXX", currency: "EUR", defaultGl: "6200", country: "DE", email: "billing@example.com",
  };
}

export function sampleInvoice(): PurchaseInvoice {
  return {
    id: "INV-1", vendorId: "V-1", number: "BT-2026-0042", issueDate: "2026-11-02", dueDate: "2026-12-02", currency: "EUR",
    lines: [
      { description: "Rain jackets, 40 pieces", glAccount: "6200", vatCode: "NL21", netCents: 100_000, vatCents: 21_000, costCentre: "CC100" },
      { description: "Printed catalogues", glAccount: "6900", vatCode: "NL9", netCents: 20_000, vatCents: 1_800 },
    ],
    totals: { netCents: 120_000, vatCents: 22_800, grossCents: 142_800 },
    documentSha256: sha("the invoice PDF"), paymentReference: "RF18 0000 0000 0042",
    pdf: { fileName: "BT-2026-0042.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
  };
}

export function samplePayment(): Payment {
  return { id: "PAY-1", invoiceId: "INV-1", vendorId: "V-1", date: "2026-11-20", amountCents: 142_800, currency: "EUR", bankAccount: "1200", airwallexTransferId: "03360bfa-afce-457b-89d1-e1097fbe3985" };
}

export function sampleJournal(): JournalEntry {
  return {
    id: "JE-1", date: "2026-11-20", currency: "EUR", memo: "SWIFT fee, Airwallex", sourceRef: "03360bfa-afce-457b-89d1-e1097fbe3985",
    lines: [
      { glAccount: "6800", debitCents: 1342, creditCents: 0, description: "Bank and transfer fees" },
      { glAccount: "1200", debitCents: 0, creditCents: 1342, description: "Airwallex EUR" },
    ],
  };
}
