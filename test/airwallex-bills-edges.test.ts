// Airwallex Spend Bills (src/airwallex/bills.ts), the paths the main tests leave: an invoice number with nothing safe
// in it gives a file named "invoice.pdf"; a vendor with fields left out reads as empty; a bill without attachments is
// sent without the field; the REST client creates a vendor with the one legal entity; the in-memory stand-in keeps the
// sandbox's refusals (a file name too long, a bill for a vendor it does not hold, a request_id seen before, a bill it
// does not hold) and marks a bill paid once however often it is asked. No network.
import { describe, expect, it } from "vitest";
import { AirwallexBillsRest, attachmentName, billBody, FakeBills, type BillIn } from "../src/airwallex/bills.js";
import type { Airwallex } from "../src/airwallex/client.js";

const bill = (o: Partial<BillIn> = {}): BillIn => ({
  requestId: "req-1", externalId: "a".repeat(64), invoiceNumber: "BTX-1", currency: "EUR", total: "240.00", issuedDate: "2026-11-01", dueDate: "2026-11-30",
  legalEntityId: "le_1", vendorId: "ven_1", lineDescription: "Goods", description: "Paid by Purser", attachmentIds: [], ...o,
});

describe("bodies and names", () => {
  it("an invoice number with nothing safe in it is the file invoice.pdf", () => {
    expect(attachmentName("///")).toBe("invoice.pdf");
    expect(attachmentName(" BTX 2026/11 ")).toBe("BTX-2026-11.pdf");
  });

  it("a bill without attachments is sent without the field", () => {
    expect(billBody(bill())).not.toHaveProperty("attachments");
    expect(billBody(bill({ attachmentIds: ["file_1"] }))).toMatchObject({ attachments: ["file_1"] });
  });
});

describe("the REST client", () => {
  it("creates a vendor for the one legal entity, and reads one with fields left out as empty", async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const api = { call: async (method: string, path: string, body?: unknown) => { calls.push({ method, path, body }); return { id: "ven_9" }; } } as unknown as Airwallex;
    const v = await new AirwallexBillsRest(api).createVendor({ requestId: "r1", externalId: "purser-vendor-x", name: "Bergtex", legalEntityId: "le_1" });
    expect(v).toEqual({ id: "ven_9", externalId: "", name: "", status: "" });
    expect(calls).toEqual([{ method: "POST", path: "/spend/vendors/create", body: { request_id: "r1", external_id: "purser-vendor-x", name: "Bergtex", legal_entity_ids: ["le_1"], status: "ACTIVE", sync_status: "NOT_SYNCED" } }]);
  });
});

describe("the in-memory stand-in keeps the sandbox's refusals", () => {
  it("a file name too long, a bill for an unknown vendor, a request_id seen before, and a bill it does not hold", async () => {
    const f = new FakeBills();
    await expect(f.uploadAttachment({ bytes: new Uint8Array(3), fileName: `${"x".repeat(60)}.pdf` })).rejects.toMatchObject({ status: 400 });
    await expect(f.createBill(bill({ vendorId: "ven_404" }))).rejects.toMatchObject({ status: 400, code: "invalid_argument" });
    const v = await f.createVendor({ requestId: "rv", externalId: "purser-vendor-x", name: "Bergtex" });
    expect(await f.findVendor("purser-vendor-x")).toEqual(v);
    await expect(f.createVendor({ requestId: "rv", externalId: "other", name: "Other" })).rejects.toMatchObject({ status: 400, code: "invalid_argument" });
    await expect(f.getBill("bill_404")).rejects.toMatchObject({ status: 404 });
    await expect(f.markPaid("bill_404")).rejects.toMatchObject({ status: 404 });
  });

  it("marks a bill paid once, however often it is asked", async () => {
    const f = new FakeBills();
    const v = await f.createVendor({ requestId: "rv", externalId: "purser-vendor-x", name: "Bergtex" });
    const b = await f.createBill(bill({ vendorId: v.id }));
    expect((await f.markPaid(b.id)).payments).toHaveLength(1);
    const again = await f.markPaid(b.id);
    expect(again.status).toBe("PAID");
    expect(again.payments).toEqual([{ id: expect.stringMatching(/^bp_/), type: "EXTERNAL", amount: "240.00", currency: "EUR", transferId: null }]);
  });
});
