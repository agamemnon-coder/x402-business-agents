// What the ERP sync takes from Purser's own ledger (src/erp/source.ts): the allowlisted payees as vendors, the
// invoices, the PAID payouts as payments, and the GL journal's other movements as balanced journal entries, with ids
// that stay the same from run to run.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { validate } from "../src/erp/model.js";
import { ledgerItems } from "../src/erp/source.js";

function seeded() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben-1', 'Stockline Data GmbH', '2051', ?, 'BYLADEM1001', 'EUR', 'SWIFT')").run("b".repeat(64));
  db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, extracted_json, status) VALUES ('SL-2026-11', 'Stockline Data GmbH', '240.00', 'EUR', '2026-11-15', ?, 'BYLADEM1001', 'ben-1', ?, '{}', 'RECEIVED')").run("b".repeat(64), "d".repeat(64));
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('03360bfa-afce-457b-89d1-e1097fbe3985', 'req-1', 'SL-2026-11', '240.00', 'EUR', 'SWIFT', '20.00', 'EUR 13.42', 'PAID', ?, '2026-11-03T11:31:24.283Z')").run("a".repeat(64));
  return db;
}

describe("the ledger as an ERP source", () => {
  it("gives the payee, the invoice and its PAID payout, each valid for the canonical model", () => {
    const items = ledgerItems(seeded());
    const vendor = items.find((i) => i.kind === "vendor")!;
    expect(vendor.object).toMatchObject({ id: "ben-1", name: "Stockline Data GmbH", ibanLast4: "2051", bic: "BYLADEM1001", currency: "EUR", defaultGl: "6350" });
    const inv = items.find((i) => i.kind === "invoice")!;
    expect(inv.object).toMatchObject({ id: "SL-2026-11", vendorId: "ben-1", number: "SL-2026-11", currency: "EUR", totals: { netCents: 24000, vatCents: 0, grossCents: 24000 } });
    const pay = items.find((i) => i.kind === "payment")!;
    expect(pay.object).toMatchObject({ id: "req-1", invoiceId: "SL-2026-11", vendorId: "ben-1", date: "2026-11-03", amountCents: 24000, bankAccount: "1200", airwallexTransferId: "03360bfa-afce-457b-89d1-e1097fbe3985" });
    for (const i of items) expect({ id: i.object.id, errs: validate(i.kind, i.object) }).toEqual({ id: i.object.id, errs: [] });
  });

  it("gives the same ids on every run, and leaves out the invoice payouts (sent as payments) and test-token currencies", () => {
    const db = seeded();
    const a = ledgerItems(db).map((i) => `${i.kind}:${i.object.id}`);
    const b = ledgerItems(db).map((i) => `${i.kind}:${i.object.id}`);
    expect(a).toEqual(b);
    const journals = ledgerItems(db).filter((i) => i.kind === "journal");
    for (const j of journals) expect((j.object as { currency: string }).currency).toMatch(/^[A-Z]{3}$/);
    expect(journals.some((j) => j.object.id.startsWith("transfer:"))).toBe(false);
  });
});
