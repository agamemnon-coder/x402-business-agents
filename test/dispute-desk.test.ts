// The Dispute desk (Alta jury input, 30 October): Northwind as the seller settles a questioned agent purchase on its
// own terms. Code reads the evidence and decides; a model only explains; a refund above the CFO's limits waits for
// Face ID. Each test breaks if the seller pays out without a reason in the evidence, or keeps money it cannot prove.
import { describe, expect, it } from "vitest";
import { decideDispute, orderOf, type EvidencePack } from "../src/seller/disputeDesk.js";

const CUSTOMER = "0x00000000000000000000000000000000000000c1";
const pack = (over: Partial<EvidencePack> & { sale_id: number }): EvidencePack => ({
  seq: over.sale_id, charged_cents: 5, paid_at: "2026-10-30T07:06:03.759Z", payer: CUSTOMER, tx: `0x${"a".repeat(63)}${over.sale_id}`,
  request: `GET /v1/stock?seq=${over.sale_id}`,
  order: { present: true, valid: true, amount_cents: 5, pay_to: "0x828c7de12cab8149aa516958433f6eee23aec875", resource: "GET /v1/stock", nonce: `n-${over.sale_id}`, first_use_sale: over.sale_id },
  mandate: { within: true, payer_is_customer: true, principal: CUSTOMER, bound_tx: `0x${"b".repeat(64)}`, detail: "all steps pass" },
  delivery: { body_sha256: "c".repeat(64), matches: true, delivered_at: "2026-10-30T07:06:03.759Z" },
  settlement: { settlement_id: `s-${over.sale_id}`, tx: `0x${"a".repeat(63)}${over.sale_id}` },
  human: { owner_bound: true, passkey: null },
  data_wrong: false,
  ...over,
});
const refundOf = (d: ReturnType<typeof decideDispute>, id: number) => d.per_sale.find((s) => s.sale_id === id)!;

describe("the seller's own terms", () => {
  it("rejects 'my agent never ordered this' when a valid signed order, inside the customer's mandate, is in hand", () => {
    const d = decideDispute("never_ordered", [pack({ sale_id: 1 }), pack({ sale_id: 2 })]);
    expect(d.outcome).toBe("rejected");
    expect(d.refund_cents).toBe(0);
    expect(refundOf(d, 1).why).toMatch(/signed order.*mandate/i);
  });

  it("refunds a sale the seller cannot back with a valid signed order", () => {
    const d = decideDispute("never_ordered", [pack({ sale_id: 1 }), pack({ sale_id: 2, order: { ...pack({ sale_id: 2 }).order, valid: false } })]);
    expect(d.outcome).toBe("partial_refund");
    expect(refundOf(d, 2)).toMatchObject({ refund_cents: 5 });
    expect(refundOf(d, 2).why).toMatch(/no valid signed order/i);
    expect(refundOf(d, 1).refund_cents).toBe(0);
  });

  it("rejects 'the price was wrong' when the signed order names the price charged, and refunds the difference when it does not", () => {
    expect(decideDispute("wrong_price", [pack({ sale_id: 1 })]).outcome).toBe("rejected");
    const d = decideDispute("wrong_price", [pack({ sale_id: 1, charged_cents: 7 })]);
    expect(refundOf(d, 1)).toMatchObject({ refund_cents: 2 });
    expect(refundOf(d, 1).why).toMatch(/signed for 0\.05.*charged 0\.07/);
  });

  it("rejects 'my agent was not authorised' when the payment is inside the mandate the customer's owner bound", () => {
    const d = decideDispute("not_authorised", [pack({ sale_id: 1 })]);
    expect(d.outcome).toBe("rejected");
    expect(refundOf(d, 1).why).toMatch(/owner bound.*chain refuses/i);
    const out = decideDispute("not_authorised", [pack({ sale_id: 1, mandate: { ...pack({ sale_id: 1 }).mandate, within: false, detail: "step 4 fails" } })]);
    expect(refundOf(out, 1).refund_cents).toBe(5);
  });

  it("refunds only the sales whose delivered data was shown to be wrong", () => {
    const d = decideDispute("wrong_data", [pack({ sale_id: 1 }), pack({ sale_id: 2, data_wrong: true })]);
    expect(d.outcome).toBe("partial_refund");
    expect(d.per_sale.map((s) => s.refund_cents)).toEqual([0, 5]);
  });

  it("refunds the second use of a reused (replayed) signed order, and any order that does not verify", () => {
    const first = pack({ sale_id: 1 });
    const replay = pack({ sale_id: 2, order: { ...first.order, first_use_sale: 1 } });
    const d = decideDispute("forged_order", [first, replay]);
    expect(refundOf(d, 1).refund_cents).toBe(0);
    expect(refundOf(d, 2)).toMatchObject({ refund_cents: 5 });
    expect(refundOf(d, 2).why).toMatch(/already used for sale 1/);
  });

  it("refunds a double charge for the same request, keeps the first", () => {
    const d = decideDispute("double_charged", [pack({ sale_id: 1 }), pack({ sale_id: 2, request: "GET /v1/stock?seq=1" })]);
    expect(d.per_sale.map((s) => s.refund_cents)).toEqual([0, 5]);
    expect(refundOf(d, 2).why).toMatch(/same request as sale 1/);
    expect(decideDispute("double_charged", [pack({ sale_id: 1 })]).outcome).toBe("rejected");
  });

  // Breaks if a refund could go anywhere but the payer, or exceed what was paid.
  it("never refunds more than was charged, and only to the payer", () => {
    const d = decideDispute("wrong_price", [pack({ sale_id: 1, charged_cents: 7, order: { ...pack({ sale_id: 1 }).order, amount_cents: 0 } })]);
    expect(refundOf(d, 1).refund_cents).toBeLessThanOrEqual(7);
    expect(d.refund_to).toBe(CUSTOMER);
  });
});

describe("reading a signed order", () => {
  it("reads the amount, payee and resource the customer's agent signed", () => {
    const jwt = (o: object) => `x.${Buffer.from(JSON.stringify(o)).toString("base64url")}.y`;
    const checkout = jwt({ amount: "50000000000000000", id: "0x828c7DE12cab8149AA516958433F6EEe23aEC875", extra: { resource: "GET /v1/stock" } });
    const disclosure = Buffer.from(JSON.stringify(["salt", { vct: "mandate.checkout.1", checkout_jwt: checkout }])).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ nonce: "n1" })).toString("base64url");
    expect(orderOf(`${header}.${body}.sig~${disclosure}~`)).toEqual({ amount_cents: 5, pay_to: "0x828c7de12cab8149aa516958433f6eee23aec875", resource: "GET /v1/stock", nonce: "n1" });
    expect(orderOf(null)).toBeNull();
    expect(orderOf("garbage")).toBeNull();
  });
});
