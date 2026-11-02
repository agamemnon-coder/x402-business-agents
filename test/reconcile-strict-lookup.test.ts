// Review, 2 November: reconcile used the loose look-up, which reads a list that ignores the request_id filter as
// "nothing". It now uses the strict one; a look-up that cannot be confirmed is reported, never read as "no transfer".
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { reconcile } from "../src/finance/reconcile.js";

describe("reconcile's look-up of a payout row with no transfer id", () => {
  it("reports a look-up it cannot confirm instead of throwing or reading it as nothing", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('X-1', 'x', '1.00', 'EUR', '2026-01-01', 'x', 'x', 'x', 'RECEIVED')").run();
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('rid-1', 'X-1', '1.00', 'EUR', 'SWIFT', '20.00', 'SUBMITTING', 'h', '2026-11-02T00:00:00.000Z')").run();
    const r = await reconcile(db, {
      transfer: async () => ({ status: "PAID", amountCents: 0, currency: "EUR" }),
      transferByRequestId: async () => { throw new Error("the list holds another request_id: not filtered"); },
    });
    expect(r.differences).toEqual([expect.objectContaining({ ref: "rid-1", outside: expect.stringContaining("could not be confirmed") })]);
  });
});
