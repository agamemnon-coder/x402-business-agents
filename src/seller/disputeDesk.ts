// The Dispute desk (Alta jury input, 30 October): when a customer questions an agent's purchase, Northwind as the
// seller decides from what it can prove, on its own terms. The evidence per payment is Alta's: the order the
// customer's agent signed (amount, payee, resource), the payment checked on chain against the mandate the customer's
// owner bound (verifyMandatePayment), the settlement, and what was delivered (the hash of the stored data). Code
// decides; a model may explain; a refund above the CFO's limits waits for Face ID like any other.
//
// The rules themselves live in examples/metal-dispute-desk (the same code, packaged for any seller on Alta), and
// Purser uses that one copy; test/metal-dispute-desk-parity.test.ts breaks if the two could ever differ.

export {
  CLAIM_WORDS, decideDispute, orderOf,
  type DisputeClaim, type DisputeDecision, type EvidencePack, type SaleDecision,
} from "../../examples/metal-dispute-desk/src/index.js";
