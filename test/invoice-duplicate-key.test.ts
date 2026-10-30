// The same invoice sent again with a cosmetically different number (case, spaces, another dash) is still the same
// invoice: a duplicate is refused before anything moves (the red team's duplicate-evasion document, 30 October).
import { describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, invoiceKey } from "../src/agents/euroBill.js";
import { openDb } from "../src/db/open.js";

describe("duplicate invoices with a cosmetically different number", () => {
  it("normalises case, spaces and dash variants, and nothing else", () => {
    expect(invoiceKey(" btx-dup ")).toBe("BTX-DUP");
    expect(invoiceKey("BTX–DUP")).toBe("BTX-DUP");
    expect(invoiceKey("BTX — DUP")).toBe("BTX-DUP");
    expect(invoiceKey("BTX-2026-11")).not.toBe(invoiceKey("BTX-2026-12"));
  });

  it("refuses the variants of an invoice already paid", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('BTX-DUP', 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-30', 'h', 'b', 'd', 'PAID')").run();
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-d', 'rq-d', 'BTX-DUP', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'h', '2026-11-01T00:00:00Z')").run();
    for (const no of ["btx-dup ", "BTX–DUP", "btx dup".replace(" ", "-")]) expect(invoiceAlreadyHandled(db, no), no).toMatch(/already paid/);
    expect(invoiceAlreadyHandled(db, "BTX-DUP2")).toBeNull();
  });
});
