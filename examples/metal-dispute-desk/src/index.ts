// A seller's Dispute desk for agent payments on Metal: decide per payment, from evidence, whether to refund and why.
// See ../README.md for the rules, a usage example and what this does not prove.
export { CLAIM_WORDS, decideDispute, type DisputeClaim, type DisputeDecision, type EvidencePack, type SaleDecision } from "./decide.js";
export { firstUseOf, gatherEvidence, orderKey, packFor, type LedgerSale, type MandateCheck, type MandateCheckResult } from "./evidence.js";
export { orderOf } from "./order.js";
export { routeRefundBatch, type RefundRoute } from "./refunds.js";
