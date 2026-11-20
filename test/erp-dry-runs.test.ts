// A dry run of each ERP connector (src/erp/registry.ts dryRunConnector): with the example settings it sends nothing, and
// pushes a supplier, an invoice, its payment and a journal entry against plausible answers, so the requests a live run
// would send are there to read; looking an object up finds nothing. A live connector is never built without the run's
// call budget.
import { describe, expect, it } from "vitest";
import { dryRunConnector, liveConnector } from "../src/erp/registry.js";
import type { ConnectorName } from "../src/erp/connector.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

const refs = { vendor: () => "1001", invoice: () => "1002" };

describe("a dry run of each connector", () => {
  it.each(["exact", "bc", "odoo", "moneybird"] as ConnectorName[])("%s: pushes all four kinds against example answers and sends nothing", async (name) => {
    const { connector, transport, usesExampleSettings } = dryRunConnector(name, {});
    expect(usesExampleSettings).toBe(true);
    const ids = [
      await connector.pushVendor(sampleVendor()),
      await connector.pushPurchaseInvoice({ ...sampleInvoice(), lines: sampleInvoice().lines.map((l) => ({ ...l, costCentre: undefined })) }, refs),
      await connector.pushPayment(samplePayment(), refs),
      await connector.pushJournalEntry(sampleJournal()),
    ];
    for (const id of ids) expect(typeof id).toBe("string");
    expect(transport.sent.length).toBeGreaterThan(3);
    expect(await connector.findExisting("vendor", sampleVendor(), refs)).toBeNull();
  });

  it("a live connector is not built without the owner's go, the approved number and the call log", () => {
    for (const name of ["exact", "bc", "odoo"] as ConnectorName[]) {
      expect(() => liveConnector(name, {}, { send: async () => { throw new Error("no call"); } })).toThrow(/^a live run needs .*; nothing was called$/);
    }
  });
});
