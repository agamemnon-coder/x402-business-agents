// Airwallex Spend Bills over REST (src/airwallex/bills.ts AirwallexBillsRest), what is refused rather than guessed: an
// account without a legal entity, a list without items, a list longer than twenty pages (nothing is matched on a part),
// two vendors under one external_id, an upload answered without a file id. And Airwallex's fields read with nothing
// made up: a missing field stays empty, amounts become two decimals, a bill's id is escaped in its path.
// test/airwallex-bills.test.ts covers the genuine flow.
import { describe, expect, it } from "vitest";
import { AirwallexBillsRest, MAX_LIST_PAGES, toBill } from "../src/airwallex/bills.js";
import { Airwallex } from "../src/airwallex/client.js";

type Reply = { status: number; body: unknown };
function client(replies: Reply[] | ((url: string) => Reply)) {
  const urls: string[] = [];
  const impl = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "t" }), { status: 201 });
    urls.push(u);
    const r = typeof replies === "function" ? replies(u) : replies.shift();
    if (!r) throw new Error("no more replies");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { rest: new AirwallexBillsRest(new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: impl, minGapMs: 0, sleep: async () => {} })), urls };
}

describe("what is refused rather than guessed", () => {
  it("an account without a legal entity", async () => {
    const { rest } = client([{ status: 200, body: { id: "acct_x", account_details: null } }]);
    await expect(rest.legalEntityId()).rejects.toThrow("Airwallex's account answered without a legal_entity_id");
  });

  it("a list without items, and one with more than twenty pages: nothing is matched on part of it", async () => {
    await expect(client([{ status: 200, body: { page_after: null } }]).rest.findBills("x")).rejects.toThrow("Airwallex's /spend/bills list came without items");
    const endless = client(() => ({ status: 200, body: { items: [], page_after: "next" } }));
    await expect(endless.rest.findVendor("purser-vendor-x")).rejects.toThrow(`Airwallex's /spend/vendors list has more than ${MAX_LIST_PAGES} pages; nothing was matched`);
    expect(endless.urls).toHaveLength(MAX_LIST_PAGES);
  });

  it("two vendors under one external_id; one is the vendor, none is none", async () => {
    const two = client([{ status: 200, body: { items: [{ id: "v1", external_id: "purser-vendor-a" }, { id: "v2", external_id: "purser-vendor-a" }], page_after: null } }]);
    await expect(two.rest.findVendor("purser-vendor-a")).rejects.toThrow("Airwallex holds 2 vendors with external_id purser-vendor-a");
    const one = client([{ status: 200, body: { items: [{ id: "v1", external_id: "purser-vendor-a" }, { id: "v9", external_id: "other" }] } }]);
    expect(await one.rest.findVendor("purser-vendor-a")).toEqual({ id: "v1", externalId: "purser-vendor-a", name: "", status: "" });
    const none = client([{ status: 200, body: { items: [] } }]);
    expect(await none.rest.findVendor("purser-vendor-a")).toBeUndefined();
  });

  it("an upload answered without a file id; a size that is not a number is not made up", async () => {
    await expect(client([{ status: 201, body: { size: 3 } }]).rest.uploadAttachment({ bytes: new Uint8Array([1]), fileName: "a.pdf", notes: "n" })).rejects.toThrow("Airwallex's file upload answered without a file_id");
    expect(await client([{ status: 201, body: { file_id: "f1", size: "3" } }]).rest.uploadAttachment({ bytes: new Uint8Array([1]), fileName: "a.pdf", notes: "n" })).toEqual({ fileId: "f1", size: null });
  });
});

describe("Airwallex's fields, read as they are", () => {
  it("a bill with nothing but its id stays empty, never filled in", () => {
    expect(toBill({ id: "b1" })).toEqual({ id: "b1", externalId: "", invoiceNumber: "", status: "", syncStatus: "", currency: "", amount: "", dueDate: "", issuedDate: "", vendorId: "", description: null, createdAt: null, updatedAt: null, attachmentIds: [], payments: [] });
  });

  it("amounts in two decimals, from a number or a string; a payment's transfer when it names one", () => {
    const b = toBill({ id: "b1", billing_amount: 240.5, bill_payments: [{ id: "p1", amount: "12", transfer: { transfer_id: "tr_1" } }, { id: "p2", amount: null }] });
    expect(b.amount).toBe("240.50");
    expect(b.payments).toEqual([{ id: "p1", type: "", amount: "12.00", currency: "", transferId: "tr_1" }, { id: "p2", type: "", amount: "", currency: "", transferId: null }]);
  });

  it("a bill's id is escaped in its path", async () => {
    const { rest, urls } = client([{ status: 200, body: { id: "b/1" } }]);
    await rest.getBill("b/1?x=1");
    expect(urls[0]).toBe("https://api.sandbox.airwallex.com/api/v1/spend/bills/b%2F1%3Fx%3D1");
  });
});
