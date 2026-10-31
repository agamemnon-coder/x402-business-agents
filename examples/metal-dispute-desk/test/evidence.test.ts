// Turning the seller's own ledger rows and the chain check into evidence packs. The chain check is a stand-in port here;
// no network is touched.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideDispute, firstUseOf, gatherEvidence, orderKey, packFor, type LedgerSale, type MandateCheck, type MandateCheckResult } from "../src/index.js";
import { CUSTOMER, SELLER } from "./cases.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const offer = (nonce: string) =>
  `${b64({ alg: "ES256" })}.${b64({ nonce })}.sig~${b64(["s", { vct: "mandate.checkout.1", checkout_jwt: `h.${b64({ amount: "50000000000000000", id: SELLER, extra: { resource: "GET /v1/stock" } })}.s` }])}~`;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function sale(id: number, over: Partial<LedgerSale> = {}): LedgerSale {
  const body = JSON.stringify({ seq: id, stock: { on_hand: 90 + id, reserved: 1 } });
  return {
    sale_id: id, seq: id, price_cents: 5, payer: CUSTOMER, tx_hash: `0x${String(id).padStart(64, "0")}`, signed_offer: offer(`n${id}`),
    body_json: body, body_sha256: sha(body), requirements_json: null, request_url: `http://127.0.0.1:4102/v1/stock?seq=${id}`,
    settlement_id: `s-${id}`, created_at: "2026-10-30T10:00:00.000Z", ...over,
  };
}
const passing = (s: LedgerSale): MandateCheckResult => ({
  sale_id: s.sale_id, seq: s.seq, tx: s.tx_hash, payer_is_customer: true, signed_order: !!s.signed_offer, within_mandate: !!s.signed_offer,
  mandate_principal: CUSTOMER, mandate_bound_tx: `0x${"b".repeat(64)}`, detail: "all steps pass",
});

describe("orderKey and firstUseOf", () => {
  it("keys a signed order by its nonce, or by its hash when it has none", () => {
    expect(orderKey(offer("n1"))).toBe("n1");
    expect(orderKey("not an offer")).toBe(sha("not an offer"));
  });

  it("remembers the first sale each signed order paid for, in ledger order", () => {
    const m = firstUseOf([{ sale_id: 3, signed_offer: offer("a") }, { sale_id: 4, signed_offer: offer("b") }, { sale_id: 5, signed_offer: offer("a") }]);
    expect([...m]).toEqual([["a", 3], ["b", 4]]);
  });
});

describe("packFor", () => {
  const firstUse = firstUseOf([sale(1), sale(2)]);

  it("builds the evidence for one sale from the ledger row and the chain check", () => {
    const s = sale(1);
    expect(packFor(s, passing(s), firstUse)).toEqual({
      sale_id: 1, seq: 1, charged_cents: 5, paid_at: s.created_at, payer: CUSTOMER, tx: s.tx_hash, request: "GET /v1/stock?seq=1",
      order: { present: true, valid: true, amount_cents: 5, pay_to: SELLER, resource: "GET /v1/stock", nonce: "n1", first_use_sale: 1 },
      mandate: { within: true, payer_is_customer: true, principal: CUSTOMER, bound_tx: `0x${"b".repeat(64)}`, detail: "all steps pass" },
      delivery: { body_sha256: s.body_sha256, matches: true, delivered_at: s.created_at },
      settlement: { settlement_id: "s-1", tx: s.tx_hash },
      human: { owner_bound: true, passkey: null },
      data_wrong: false,
    });
  });

  it("marks a reused order, a changed delivery, a missing check and an unparseable URL", () => {
    const replay = sale(9, { signed_offer: offer("n1") });
    expect(packFor(replay, passing(replay), firstUse).order.first_use_sale).toBe(1);
    expect(packFor(sale(2, { body_json: "tampered" }), passing(sale(2)), firstUse).delivery.matches).toBe(false);
    const unchecked = packFor(sale(2, { request_url: "stock?seq=2" }), undefined, firstUse);
    expect(unchecked).toMatchObject({ request: "stock?seq=2", order: { valid: false }, mandate: { within: false, detail: "not checked", principal: "", bound_tx: "" }, human: { owner_bound: false } });
  });

  it("has no order without a signed offer, and carries the passkey and wrong-data flags it is given", () => {
    const none = sale(3, { signed_offer: null });
    expect(packFor(none, passing(none), firstUse).order).toEqual({ present: false, valid: false, amount_cents: null, pay_to: null, resource: null, nonce: null, first_use_sale: null });
    const p = packFor(sale(1), passing(sale(1)), firstUse, { passkey: { label: "Summit owner", verified: true }, data_wrong: true });
    expect(p.human.passkey).toEqual({ label: "Summit owner", verified: true });
    expect(p.data_wrong).toBe(true);
  });
});

describe("gatherEvidence", () => {
  it("asks the injected chain check once for the questioned sales, then builds a pack each", async () => {
    const calls: [number[], string][] = [];
    const check: MandateCheck = async (sales, customer) => { calls.push([sales.map((s) => s.sale_id), customer]); return sales.map(passing); };
    const ledger = [sale(1), sale(2), sale(3, { signed_offer: offer("n1") })];
    const packs = await gatherEvidence([ledger[1]!, ledger[2]!], CUSTOMER, { check, signedOrders: ledger, dataWrong: new Set([2]), passkey: (s) => (s.sale_id === 3 ? { label: "k", verified: false } : null) });
    expect(calls).toEqual([[[2, 3], CUSTOMER]]);
    expect(packs.map((p) => [p.sale_id, p.order.first_use_sale, p.data_wrong, p.human.passkey])).toEqual([[2, 2, true, null], [3, 1, false, { label: "k", verified: false }]]);
    expect(decideDispute("forged_order", packs).per_sale.map((s) => s.refund_cents)).toEqual([0, 5]);
  });

  it("treats a sale the chain check did not answer for as unproven", async () => {
    const packs = await gatherEvidence([sale(1)], CUSTOMER, { check: async () => [], signedOrders: [sale(1)] });
    expect(decideDispute("never_ordered", packs)).toMatchObject({ outcome: "refund", refund_cents: 5 });
  });
});
