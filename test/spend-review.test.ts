// Card spend per merchant and category (awards item 5): what each agent's card paid where, and a merchant charged the
// same amount again a month later is flagged as a subscription the CFO can stop.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { spendReview } from "../src/agents/spendReview.js";

const T = (d: number) => new Date(Date.UTC(2026, 9, 1) + d * 86_400_000).toISOString();
function world() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'h', 'card-1', '4001', 'n', 'EUR', 5000, 10000, 'ACTIVE', ?, ?)").run(T(0), T(0));
  const tx = db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES (?, 'card-1', 'sourcing', ?, ?, ?, 'EUR', ?, ?, 'poll', ?, ?)");
  tx.run("t1", "Packwise", "5734", 1999, "APPROVED", 1, T(0), T(0));
  tx.run("t2", "Packwise", "5734", 1999, "APPROVED", 1, T(30), T(30));
  tx.run("t3", "Packwise", "5734", 4500, "FAILED", 0, T(31), T(31));
  tx.run("t4", "Skyline Air", "4511", 12000, "APPROVED", 1, T(5), T(5));
  return db;
}

describe("card spend review", () => {
  it("sums approved spend per merchant and category, per agent, and counts declines apart", () => {
    const r = spendReview(world());
    expect(r.rows.map((x) => [x.merchant, x.category, x.charges, x.total, x.declined])).toEqual([
      ["Skyline Air", "Airlines", 1, "120.00", 0],
      ["Packwise", "Software", 2, "39.98", 1],
    ]);
    expect(r.rows[1]).toMatchObject({ agent: "Sourcing agent", currency: "EUR" });
  });

  it("flags the same amount at the same merchant about a month apart as a subscription, with a way to stop it", () => {
    const r = spendReview(world());
    expect(r.rows.find((x) => x.merchant === "Packwise")!.subscription).toBe(true);
    expect(r.rows.find((x) => x.merchant === "Skyline Air")!.subscription).toBe(false);
    expect(r.suggestions).toEqual([expect.stringMatching(/Packwise charges the Sourcing agent's card 19\.99 EUR every month.*stop/i)]);
  });

  it("is empty, not an error, on a ledger without cards", () => {
    expect(spendReview(openDb(":memory:"))).toEqual({ rows: [], suggestions: [] });
  });
});
