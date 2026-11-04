// dry-125, dry-131, dry-138: the world sent Summit's dispute about orders #5 to #16 while only a few had been sold, so
// the Support agent was asked about orders that never existed. Max (2 November): the dispute starts only once the orders
// it names were really sold to Summit. Breaks if the world can open a dispute naming an order that was not sold to it.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { disputeReady, SUMMIT_DISPUTE_SEQS } from "../src/agents/disputes.js";

const SUMMIT = "0x00000000000000000000000000000000000000aa";
const sell = (db: DB, seq: number, payer = SUMMIT, status = "DELIVERED") =>
  db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, ?, 'u', ?, ?, 'x')").run(payer, JSON.stringify({ seq }), status);

describe("Summit's dispute waits for the orders it names", () => {
  it("names #5 to #16, the Kit 11 scene's 12 orders", () => {
    expect(SUMMIT_DISPUTE_SEQS).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
  it("is not ready while any named order was not sold to Summit, and says which", () => {
    const db = openDb(":memory:");
    for (const s of [1, 2, 3, 4, 5]) sell(db, s);
    expect(disputeReady(db, SUMMIT)).toEqual({ ready: false, missing: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
  });
  it("does not count a sale to someone else, or one that was not delivered", () => {
    const db = openDb(":memory:");
    for (const s of SUMMIT_DISPUTE_SEQS) sell(db, s);
    db.prepare("DELETE FROM sales WHERE json_extract(request_params_json, '$.seq') IN (9, 12)").run();
    sell(db, 9, "0x00000000000000000000000000000000000000bb");
    sell(db, 12, SUMMIT, "ABORTED_NO_CHARGE");
    expect(disputeReady(db, SUMMIT)).toEqual({ ready: false, missing: [9, 12] });
  });
  it("is ready once all 12 were delivered to Summit", () => {
    const db = openDb(":memory:");
    for (const s of SUMMIT_DISPUTE_SEQS) sell(db, s);
    expect(disputeReady(db, SUMMIT)).toEqual({ ready: true, missing: [] });
  });
});
