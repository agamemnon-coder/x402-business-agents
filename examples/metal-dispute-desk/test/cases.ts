// The table of dispute cases with the decision each must get. It is run against this example's decideDispute
// (decide.test.ts) and, in the Purser repository, against Purser's own export (test/metal-dispute-desk-parity.test.ts),
// so the two cannot drift apart. Plain data only: no chain, no network.
import type { DisputeClaim, DisputeDecision, EvidencePack } from "../src/index.js";

export const CUSTOMER = "0x00000000000000000000000000000000000000c1";
export const SELLER = "0x828c7de12cab8149aa516958433f6eee23aec875";

/** One questioned payment the seller can fully back: a valid signed order for 0.05, paid once, inside the mandate. */
export function pack(over: Partial<EvidencePack> & { sale_id: number }): EvidencePack {
  return {
    seq: over.sale_id, charged_cents: 5, paid_at: "2026-10-30T07:06:03.759Z", payer: CUSTOMER, tx: `0x${"a".repeat(63)}${over.sale_id}`,
    request: `GET /v1/stock?seq=${over.sale_id}`,
    order: { present: true, valid: true, amount_cents: 5, pay_to: SELLER, resource: "GET /v1/stock", nonce: `n-${over.sale_id}`, first_use_sale: over.sale_id },
    mandate: { within: true, payer_is_customer: true, principal: CUSTOMER, bound_tx: `0x${"b".repeat(64)}`, detail: "all steps pass" },
    delivery: { body_sha256: "c".repeat(64), matches: true, delivered_at: "2026-10-30T07:06:03.759Z" },
    settlement: { settlement_id: `s-${over.sale_id}`, tx: `0x${"a".repeat(63)}${over.sale_id}` },
    human: { owner_bound: true, passkey: null },
    data_wrong: false,
    ...over,
  };
}

const base = pack({ sale_id: 1 });

export interface DisputeCaseRow {
  name: string;
  claim: DisputeClaim;
  packs: EvidencePack[];
  outcome: DisputeDecision["outcome"];
  /** Refund per payment, in the order given. */
  refunds: number[];
  /** What the reason for each payment must say (same order; null: not checked). */
  why: (RegExp | null)[];
}

export const CASES: DisputeCaseRow[] = [
  {
    name: "never ordered, but a valid signed order inside the customer's mandate is in hand",
    claim: "never_ordered", packs: [pack({ sale_id: 1 }), pack({ sale_id: 2 })],
    outcome: "rejected", refunds: [0, 0], why: [/^Not refunded: your agent gave us a signed order for 0\.05 to us \(GET \/v1\/stock\).*mandate your account bound\.$/, null],
  },
  {
    name: "never ordered, and one order does not verify",
    claim: "never_ordered", packs: [pack({ sale_id: 1 }), pack({ sale_id: 2, order: { ...base.order, first_use_sale: 2, valid: false } })],
    outcome: "partial_refund", refunds: [0, 5], why: [null, /no valid signed order from your agent/],
  },
  {
    name: "never ordered, and no signed order at all",
    claim: "never_ordered", packs: [pack({ sale_id: 1, order: { ...base.order, present: false, valid: false } })],
    outcome: "refund", refunds: [5], why: [/cannot prove it was ordered/],
  },
  {
    name: "never ordered, and the payment did not verify inside the mandate",
    claim: "never_ordered", packs: [pack({ sale_id: 1, mandate: { ...base.mandate, within: false, detail: "step 4 fails" } })],
    outcome: "refund", refunds: [5], why: [/^Refunded: the payment did not verify inside your mandate \(step 4 fails\)\.$/],
  },
  {
    name: "never ordered, and the payer is not the customer",
    claim: "never_ordered", packs: [pack({ sale_id: 1, mandate: { ...base.mandate, payer_is_customer: false } })],
    outcome: "refund", refunds: [5], why: [/did not verify inside your mandate/],
  },
  {
    name: "wrong price, but charged what the agent signed for",
    claim: "wrong_price", packs: [pack({ sale_id: 1 })],
    outcome: "rejected", refunds: [0], why: [/^Not refunded: your agent signed for 0\.05 and was charged 0\.05\.$/],
  },
  {
    name: "wrong price, charged more than signed: the difference",
    claim: "wrong_price", packs: [pack({ sale_id: 1, charged_cents: 7 })],
    outcome: "partial_refund", refunds: [2], why: [/^Refunded the difference: your agent signed for 0\.05, we charged 0\.07\.$/],
  },
  {
    name: "wrong price, signed for nothing: never more than was charged",
    claim: "wrong_price", packs: [pack({ sale_id: 1, charged_cents: 7, order: { ...base.order, amount_cents: 0 } })],
    outcome: "refund", refunds: [7], why: [/signed for 0\.00, we charged 0\.07/],
  },
  {
    name: "not authorised, but inside the mandate the owner bound",
    claim: "not_authorised", packs: [pack({ sale_id: 1 })],
    outcome: "rejected", refunds: [0], why: [/owner bound on chain \(0xbbbbbbbb….*chain refuses any payment outside it\.$/],
  },
  {
    name: "not authorised, and outside the mandate",
    claim: "not_authorised", packs: [pack({ sale_id: 1, mandate: { ...base.mandate, within: false, detail: "step 4 fails" } })],
    outcome: "refund", refunds: [5], why: [/^Refunded: the payment did not verify inside the mandate \(step 4 fails\)\.$/],
  },
  {
    name: "wrong data: only the sales the supplier's correction shows wrong",
    claim: "wrong_data", packs: [pack({ sale_id: 1 }), pack({ sale_id: 2, data_wrong: true })],
    outcome: "partial_refund", refunds: [0, 5], why: [/matches the supplier's data/, /supplier's correction shows/],
  },
  {
    name: "forged order: the second use of a signed order is a replay",
    claim: "forged_order", packs: [pack({ sale_id: 1 }), pack({ sale_id: 2, order: { ...base.order, first_use_sale: 1 } })],
    outcome: "partial_refund", refunds: [0, 5], why: [/verifies against your agent's mandate key and was used once/, /already used for sale 1; a second payment on it is a replay/],
  },
  {
    name: "a replay is refunded whatever the claim",
    claim: "wrong_data", packs: [pack({ sale_id: 2, order: { ...base.order, first_use_sale: 1 } })],
    outcome: "refund", refunds: [5], why: [/already used for sale 1/],
  },
  {
    name: "double charged: the second charge for the same request",
    claim: "double_charged", packs: [pack({ sale_id: 1 }), pack({ sale_id: 2, request: "GET /v1/stock?seq=1" })],
    outcome: "partial_refund", refunds: [0, 5], why: [/^Not refunded: the only charge for this request\.$/, /^Refunded: the same request as sale 1, charged twice\.$/],
  },
  {
    name: "double charged, but charged once",
    claim: "double_charged", packs: [pack({ sale_id: 1 })],
    outcome: "rejected", refunds: [0], why: [/only charge/],
  },
  {
    name: "never refunded twice: already refunded in full",
    claim: "never_ordered", packs: [pack({ sale_id: 1, order: { ...base.order, valid: false }, refunded_cents: 5 })],
    outcome: "rejected", refunds: [0], why: [/Already refunded \(0\.05\)\.$/],
  },
  {
    name: "never above what is left: already refunded in part",
    claim: "never_ordered", packs: [pack({ sale_id: 1, order: { ...base.order, valid: false }, refunded_cents: 2 })],
    outcome: "partial_refund", refunds: [3], why: [/Already refunded in part \(0\.02\)\.$/],
  },
  {
    name: "nothing questioned",
    claim: "never_ordered", packs: [],
    outcome: "rejected", refunds: [], why: [],
  },
];
