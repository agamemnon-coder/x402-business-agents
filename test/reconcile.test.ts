// Light daily reconciliation (finance item 5): the ledger against Airwallex and Metal, flow by flow.
import { describe, expect, it } from "vitest";
import type { CardTransaction } from "../src/airwallex/issuing.js";
import { openDb, type DB } from "../src/db/open.js";
import { lastReconciliation, reconcile } from "../src/finance/reconcile.js";

const now = new Date("2026-11-03T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const B = "0x00000000000000000000000000000000000000b1";
const S = "0x00000000000000000000000000000000000000s1".replace("s", "5");
const C = "0x00000000000000000000000000000000000000c1";

function ledger(): DB {
  const db = openDb(":memory:");
  // A fixture ledger: the transfer's invoice row is not needed here.
  db.pragma("foreign_keys = OFF");
  for (const [a, r] of [[B, "business"], [S, "supplier"], [C, "customer"]]) db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, ?)").run(a, r);
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-1', 'rq-1', 'BTX-2026-11', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'ab', ?)").run(ago(60));
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'h', 'card-1', '4001', 'n', 'EUR', 3000, 10000, 'ACTIVE', ?, ?)").run(ago(90), ago(90));
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, purpose, source, occurred_at, recorded_at) VALUES ('ct-1', 'card-1', 'sourcing', 'Packwise', '5734', 1999, 'EUR', 'APPROVED', 1, NULL, NULL, 'webhook', ?, ?)").run(ago(30), ago(30));
  db.prepare("INSERT INTO upstream_purchases (price_cents, nonce, tx_hash, outcome, created_at) VALUES (4, 'n1', '0xaaa', 'PAID', ?)").run(ago(20));
  return db;
}
const tx = (over: Partial<CardTransaction>): CardTransaction => ({ transactionId: "ct-1", cardId: "card-1", amountCents: 1999, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION", occurredAt: ago(30), ...over });
const good = {
  transfer: async () => ({ status: "PAID", amountCents: 185000, currency: "EUR" }),
  cardTransactions: async () => [tx({})],
  chainTransfer: async () => null,
};

describe("daily reconciliation", () => {
  it("finds no difference when every flow matches, and says so in the audit log", async () => {
    const db = ledger();
    const r = await reconcile(db, good, now);
    expect(r).toMatchObject({ checked: 3, differences: [], skipped: [] });
    expect(lastReconciliation(db)).toMatchObject({ at: now.toISOString(), checked: 3, differences: 0 });
  });

  it("raises a difference for a transfer whose status or amount differs at Airwallex", async () => {
    const r = await reconcile(ledger(), { ...good, transfer: async () => ({ status: "FAILED", amountCents: 185000, currency: "EUR" }) }, now);
    expect(r.differences).toEqual([{ area: "airwallex transfer", ref: "tr-1", ledger: "EUR 1850.00, PAID", outside: "EUR 1850.00, FAILED" }]);
  });

  it("checks card transactions both ways, by either of Airwallex's ids, and gives fresh ones time to arrive", async () => {
    const db = ledger();
    const r = await reconcile(db, { ...good, cardTransactions: async () => [
      tx({ transactionId: "ct-new", legacyId: "ct-1" }), // the same one under its newer id
      tx({ transactionId: "ct-2", amountCents: 4500, occurredAt: ago(20) }), // approved at Airwallex, never recorded
      tx({ transactionId: "ct-3", amountCents: 900, occurredAt: ago(1) }), // still on its way
    ] }, now);
    expect(r.differences).toEqual([{ area: "card", ref: "ct-2", ledger: "not recorded", outside: "approved EUR 45.00 at Packwise on the sourcing card" }]);
    const gone = await reconcile(ledger(), { ...good, cardTransactions: async () => [] }, now);
    expect(gone.differences).toEqual([{ area: "card", ref: "ct-1", ledger: "approved 19.99", outside: "not listed by Airwallex" }]);
  });

  it("raises a difference for a Metal payment whose receipt does not carry the transfer, and logs each one", async () => {
    const db = ledger();
    const r = await reconcile(db, { ...good, chainTransfer: async (_tx, from, to, cents) => (cents === 4 && from === B && to === S ? "no *USDZ transfer of 0.04 in the receipt" : null) }, now);
    expect(r.differences).toEqual([{ area: "metal", ref: "purchase 1", ledger: "supplier purchase of 0.04 USDZ in 0xaaa…", outside: "no *USDZ transfer of 0.04 in the receipt" }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'reconcile.difference'").get()).toEqual({ n: 1 });
  });

  it("says which areas it could not check", async () => {
    const r = await reconcile(ledger(), {}, now);
    expect(r.skipped).toEqual(["Airwallex transfers (no Airwallex keys)", "card transactions (no Airwallex keys)", "Metal payments (no RPC)"]);
  });
});
