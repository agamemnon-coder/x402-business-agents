// One Airwallex batch transfer (src/executors/airwallexBatch.ts): which lines may go in one at all, the read-back's
// set and currency checks, the resume comparison for a batch already past DRAFTING, and the refusals before anything
// is called (no batch, not a batch, nothing at Airwallex to follow). Pure where it can be; no network.
import { describe, expect, it } from "vitest";
import { FakeBatchTransfers, toBatch, toItem } from "../src/airwallex/batchTransfers.js";
import { openDb } from "../src/db/open.js";
import { compareReadBack, compareSubmitted, describeBatchStatus, executeAsOneAirwallexBatch, followAirwallexBatch, lineShapeRefusal } from "../src/executors/airwallexBatch.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const S = "s".repeat(64);
const terms = (rq: string, amount = "100.00") => ({ transfer_request_id: rq, beneficiary_id: `ben-${rq}`, amount, fee_max: "20.00", reference: `INV-${rq}`, invoice_no: `INV-${rq}`, reason: "x" }) as never;
const line = (rq: string, amount?: string) => ({ proposal_id: `P-${rq}`, terms_sha256: `${rq}`.padEnd(64, "a"), terms: terms(rq, amount) });
const quote = (payerPays: number, src = "EUR", dst = "EUR") => ({ amount_payer_pays: payerPays, fee_amount: 13.4, fee_currency: "EUR", source_currency: src, transfer_currency: dst });
const batchOf = (n: number, quotes = [quote(113.4 * n)], sha = S) =>
  toBatch({ id: "b1", request_id: "r", status: "DRAFTING", total_item_count: n, valid_item_count: n, metadata: { approval_sha256: sha }, quote_summary: { quotes } });
const itemOf = (rq: string, status = "VALIDATED", amount = 100, extra: Record<string, unknown> = {}) => toItem({
  id: `i-${rq}`, request_id: rq, status, ...extra,
  transfer_draft: { beneficiary_id: `ben-${rq}`, transfer_amount: amount, transfer_currency: "EUR", source_currency: "EUR", transfer_method: "SWIFT", reference: `INV-${rq}`, reason: "x",
    fee_amount: 13.4, fee_currency: "EUR", amount_payer_pays: amount + 13.4, metadata: { approval_sha256: `${rq}`.padEnd(64, "a") } },
});

describe("which lines go into one Airwallex batch", () => {
  const eurSwift = { currency: "EUR", method: "SWIFT" };
  it("takes a plain EUR SWIFT invoice payment", () => {
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "invoice_payment", terms: eurSwift })).toBeNull();
  });
  it("sends anything else line by line, and says why", () => {
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "invoice_payment", terms: { ...eurSwift, currency: "USD" } })).toBe("P-1 is not a EUR SWIFT payment");
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "invoice_payment", terms: { ...eurSwift, method: "LOCAL" } })).toBe("P-1 is not a EUR SWIFT payment");
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "invoice_payment", terms: { ...eurSwift, platform_fee: { amount: "1.00" } } })).toMatch(/carries a Purser fee/);
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "invoice_payment", terms: { ...eurSwift, paying_account: "acct_1" } })).toMatch(/pays from a connected account/);
  });
});

describe("the read-back before submit: the set of items and the quote's currencies", () => {
  it("agrees for two lines that match exactly", () => {
    expect(compareReadBack([line("a"), line("b")], S, batchOf(2), [itemOf("a"), itemOf("b")])).toEqual([]);
  });

  it("names an item the CFO did not sign, a line held twice, and a count that differs", () => {
    const d = compareReadBack([line("a")], S, batchOf(1), [itemOf("a"), itemOf("a"), itemOf("z")]).join("\n");
    expect(d).toMatch(/Airwallex holds 3 items, the CFO signed 1/);
    expect(d).toMatch(/item i-z \(z\) is not a line the CFO signed/);
    expect(d).toMatch(/P-a: Airwallex holds 2 items under a/);
  });

  it("names a signed line Airwallex does not hold, and its validity count", () => {
    const d = compareReadBack([line("a"), line("b")], S, { ...batchOf(2), validItemCount: 1 }, [itemOf("a")]).join("\n");
    expect(d).toMatch(/Airwallex counts 1 valid of 2 items, the CFO signed 2/);
    expect(d).toMatch(/P-b: Airwallex holds 0 items under b/);
  });

  it("refuses an item that is not validated, with Airwallex's own errors", () => {
    const d = compareReadBack([line("a")], S, batchOf(1), [{ ...itemOf("a", "VALIDATION_FAILED"), errors: ["beneficiary inactive"] }]);
    expect(d).toEqual(["P-a (INV-a): item is VALIDATION_FAILED (beneficiary inactive)"]);
  });

  it("refuses a quote in another currency, even when the totals agree", () => {
    expect(compareReadBack([line("a")], S, batchOf(1, [quote(113.4, "USD", "EUR")]), [itemOf("a")])).toEqual(["Airwallex quotes a currency other than EUR"]);
    expect(compareReadBack([line("a")], S, batchOf(1, [quote(113.4, "EUR", "GBP")]), [itemOf("a")])).toEqual(["Airwallex quotes a currency other than EUR"]);
  });

  it("names an amount at Airwallex that is not the signed one, to the cent", () => {
    const d = compareReadBack([line("a")], S, batchOf(1, [quote(113.41)]), [itemOf("a", "VALIDATED", 100.01)]);
    expect(d).toContain("P-a (INV-a): amount at Airwallex is 100.01, signed 100.00");
  });
});

describe("a batch already past DRAFTING (a resume)", () => {
  it("agrees with the signed items, whether or not Airwallex still shows the drafts", () => {
    expect(compareSubmitted([line("a")], S, batchOf(1), [itemOf("a")])).toEqual([]);
    expect(compareSubmitted([line("a")], S, batchOf(1), [{ ...itemOf("a", "BOOKED"), draft: null }])).toEqual([]);
  });

  it("names a batch hash that is not the one signed, and a draft that changed", () => {
    const d = compareSubmitted([line("a")], S, batchOf(1, undefined, "t".repeat(64)), [itemOf("a", "BOOKED", 250)]);
    expect(d[0]).toBe(`the batch at Airwallex carries approval hash ${"t".repeat(64)}, the CFO signed ${S}`);
    expect(d).toContain("P-a (INV-a): amount at Airwallex is 250.00, signed 100.00");
  });

  it("names a batch with no hash at all, and an item nobody signed", () => {
    const d = compareSubmitted([line("a")], S, { ...batchOf(1), metadata: {} }, [itemOf("a"), itemOf("x")]);
    expect(d).toContain(`the batch at Airwallex carries approval hash none, the CFO signed ${S}`);
    expect(d).toContain("item i-x (x) is not a line the CFO signed");
  });
});

describe("the batch's status in words", () => {
  it("says what each status means for the money", () => {
    expect(describeBatchStatus("DRAFTING")).toBe("being drafted at Airwallex; nothing submitted");
    expect(describeBatchStatus("BOOKING")).toBe("booking at Airwallex");
    expect(describeBatchStatus("PARTIALLY_BOOKED")).toBe("partially booked at Airwallex");
    expect(describeBatchStatus("APPROVAL_REJECTED")).toBe("rejected in Airwallex's approval workflow; not paid");
    expect(describeBatchStatus("SOMETHING_NEW")).toBe("something_new");
  });
});

describe("refusals before anything is called", () => {
  it("refuses with the flag turned off, a proposal that is not a batch, and a batch with nothing at Airwallex to follow", async () => {
    const db = openDb(":memory:");
    const batches = new FakeBatchTransfers();
    const rails = { batches, rail: new FakeAirwallex() };
    await expect(executeAsOneAirwallexBatch(db, rails, "P-0001", { env: { AIRWALLEX_BATCH_TRANSFER: "off" } })).rejects.toThrow(/AIRWALLEX_BATCH_TRANSFER is not on; the batch runs line by line/);
    await expect(executeAsOneAirwallexBatch(db, rails, "P-0001", { env: { AIRWALLEX_BATCH_TRANSFER: "on" } })).rejects.toThrow("P-0001 is not a payment batch");
    await expect(followAirwallexBatch(db, batches, "P-0001")).rejects.toThrow("P-0001 has no Airwallex batch");
    expect(batches.calls).toEqual([]);
  });
});
