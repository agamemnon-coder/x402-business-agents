// The reconciliation's less common rows (src/finance/reconcile.ts): refunds and reversals at Airwallex are not charges;
// a charge whose amount or outcome differs is a difference; sales, refunds and sweeps are each checked on chain; a
// payment whose accounts the ledger does not know is a difference without asking the chain; refunds held at Alta for
// over two hours are followed (never counted as refunded), with or without a transaction or an RPC; and with no keys
// and no RPC every area says it was skipped.
import { describe, expect, it } from "vitest";
import type { CardTransaction } from "../src/airwallex/issuing.js";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { heldRefunds, heldThenRefused, reconcile } from "../src/finance/reconcile.js";

const now = new Date("2026-11-03T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const B = "0x00000000000000000000000000000000000000b1";
const W = "0x00000000000000000000000000000000000000d1";
const R = "0x00000000000000000000000000000000000000e1";

function ledger(o: { sweep?: boolean } = {}): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = OFF");
  db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business')").run(B);
  if (o.sweep !== false) db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'sweep')").run(W);
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'h', 'card-1', '4001', 'n', 'EUR', 3000, 10000, 'ACTIVE', ?, ?)").run(ago(90), ago(90));
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES ('ct-1', 'card-1', 'sourcing', 'Packwise', '5734', 1999, 'EUR', 'APPROVED', 1, 'webhook', ?, ?)").run(ago(30), ago(30));
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, tx_hash, request_url, request_params_json, status, created_at) VALUES (1, '/stock', 5, ?, '0xs1', 'u', '{}', 'DELIVERED', ?)").run(R, ago(50));
  db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (1, 1, 'refund-1', 5, ?, 'PAID', '0xr1')").run(R);
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sweep-1', 20, '0xw1', 'PAID', ?)").run(ago(40));
  return db;
}
const card = (over: Partial<CardTransaction>): CardTransaction => ({ transactionId: "ct-1", cardId: "card-1", amountCents: 1999, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION", occurredAt: ago(30), ...over });

describe("the reconciliation's less common rows", () => {
  it("skips every area it has no keys or RPC for, and says so", async () => {
    const r = await reconcile(ledger(), {}, now);
    expect(r.checked).toBe(0);
    expect(r.skipped).toEqual(expect.arrayContaining(["Airwallex transfers (no Airwallex keys)", "Airwallex's ledger (no Airwallex keys)", "card transactions (no Airwallex keys)", "Metal payments (no RPC)"]));
  });

  it("a refund or reversal at Airwallex is not a charge; a charge whose amount or outcome differs is a difference", async () => {
    const r = await reconcile(ledger(), { cardTransactions: async () => [card({ amountCents: 2099 }), card({ transactionId: "rf-1", type: "REFUND", amountCents: 1999 }), card({ transactionId: "rv-1", type: "REVERSAL" })] }, now);
    expect(r.differences).toEqual([{ area: "card", ref: "ct-1", ledger: "approved 19.99", outside: "approved 20.99" }]);
    const declined = await reconcile(ledger(), { cardTransactions: async () => [card({ approved: false, status: "DECLINED" })] }, now);
    expect(declined.differences).toEqual([{ area: "card", ref: "ct-1", ledger: "approved 19.99", outside: "declined 19.99" }]);
  });

  it("checks sales, refunds and sweeps on chain, each between the accounts the ledger names", async () => {
    const asked: string[] = [];
    const r = await reconcile(ledger(), { chainTransfer: async (tx, from, to, cents) => { asked.push(`${tx} ${from.slice(-2)}→${to.slice(-2)} ${cents}`); return tx === "0xw1" ? "no transfer to the sweep wallet" : null; } }, now);
    expect(asked.sort()).toEqual([`0xr1 b1→e1 5`, `0xs1 e1→b1 5`, `0xw1 b1→d1 20`].sort());
    expect(r.checked).toBe(3);
    expect(r.differences).toEqual([{ area: "metal", ref: "sweep-1", ledger: "sweep of 0.20 USDZ in 0xw1…", outside: "no transfer to the sweep wallet" }]);
  });

  it("a payment between accounts the ledger does not know is a difference, without asking the chain", async () => {
    const asked: string[] = [];
    const r = await reconcile(ledger({ sweep: false }), { chainTransfer: async (tx) => { asked.push(tx); return null; } }, now);
    expect(asked).not.toContain("0xw1");
    expect(r.differences).toContainEqual({ area: "metal", ref: "sweep-1", ledger: "sweep of 0.20 USDZ", outside: "the ledger does not know both accounts" });
  });

  it("follows refunds held at Alta for over two hours, by their transaction, and never counts them refunded", async () => {
    const db = ledger();
    for (const [id, tx] of [[2, "0xh2"], [3, null], [4, "0xh4"]] as const) {
      db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, tx_hash, request_url, request_params_json, status, created_at) VALUES (?, '/stock', 5, ?, ?, 'u', '{}', 'DELIVERED', ?)").run(id, R, `0xs${id}`, ago(300));
      db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (?, ?, ?, 5, ?, 'HELD', ?)").run(id, id, `refund-${id}`, R, tx);
    }
    audit(db, "support", "refund.held", "2", { payment_id: "refund-2" }, new Date(ago(180)));
    audit(db, "support", "refund.held", "4", { payment_id: "refund-4" }, new Date(ago(10)));
    expect(heldRefunds(db, now).map((h) => h.payment_id)).toEqual(["refund-2", "refund-3"]);
    const r = await reconcile(db, { chainTransfer: async (tx) => (tx === "0xh2" ? null : "?") }, now);
    expect(r.held).toEqual([
      { ref: "refund-2", since: ago(180), chain: "the transfer is on chain as recorded" },
      { ref: "refund-3", since: null, chain: "no transaction yet" },
    ]);
    const noRpc = await reconcile(db, {}, now);
    expect(noRpc.held![0]).toEqual({ ref: "refund-2", since: ago(180), chain: "not looked up (no RPC)" });
    db.prepare("UPDATE refunds SET outcome = 'REFUSED', refusal_reason = 'mandate revoked' WHERE refund_id = 2").run();
    expect(heldThenRefused(db)).toEqual([{ sale_id: 2, payment_id: "refund-2", reason: "mandate revoked" }]);
  });
});
