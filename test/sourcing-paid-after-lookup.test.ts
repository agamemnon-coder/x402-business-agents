// The dashboard = the chain, for the Sourcing mandate too (night batch follow-up, 2 November): a purchase whose answer was
// lost, then found settled by its nonce, is recorded with what Metal paid. Before, its row said 0.00 while its hold was
// settled, so the ledger, the dashboard and the budget counted 0.02 less than the chain.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/metal/mandate.js", async (orig) => ({
  ...(await orig<object>()),
  activeMandate: async () => ({ agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "", keyFile: "", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" }),
}));
vi.mock("../src/metal/pay.js", async (orig) => ({
  ...(await orig<object>()),
  // Purser's guard reserves the offer's 0.02; then the supplier's answer is lost.
  payUnderMandate: async (_m: unknown, _url: string, _init: unknown, guard?: (cents: number, payTo: string) => string | null) => {
    const blocked = guard ? guard(2, "0x0000000000000000000000000000000000000001") : null;
    if (blocked) return { kind: "refused", reason: blocked, status: 0, body: "" };
    return { kind: "in_doubt", reason: "seller answered 502 without a settlement", status: 502, body: "", nonce: `0x${"0".repeat(63)}7` };
  },
  // The facilitator's list says it settled.
  findSettlementByNonce: async () => ({ id: `eip155:63825:eip3009:0xb5d5:0x56:0x${"0".repeat(63)}7`, payer: "0x56", payTo: "0x01", amount: String(2n * 10n ** 16n), transaction: `0x${"ef".repeat(32)}`, settledAt: 0 }),
}));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { SourcingAgent } = await import("../src/agents/sourcing.js");
const { mandateAvailability, mandatePayments } = await import("../src/policy/available.js");

describe("a purchase found settled after a lost answer", () => {
  it("is recorded with what was paid, so the ledger counts what Metal counts", async () => {
    const db = openDb(":memory:");
    audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
    await new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001").buy(4);
    expect(db.prepare("SELECT outcome, price_cents, tx_hash FROM upstream_purchases").all()).toEqual([{ outcome: "PAID", price_cents: 2, tx_hash: `0x${"ef".repeat(32)}` }]);
    expect(db.prepare("SELECT status FROM holds").all()).toEqual([{ status: "SETTLED" }]);
    expect(mandateAvailability(db, "sourcing")).toMatchObject({ paidCents: 2, pendingCents: 0, heldCents: 0, availableCents: 998 });
    expect(mandatePayments(db, "sourcing")).toEqual([{ what: "purchase 1", cents: 2, tx: `0x${"ef".repeat(32)}`, nonce: `0x${"0".repeat(63)}7`, state: "paid" }]);
  });
});
