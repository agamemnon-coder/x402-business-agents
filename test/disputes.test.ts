import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkData, parseCorrectionsFallback, parseDisputeFallback, refundsFor, salesFound, type SaleRow } from "../src/agents/disputes.js";
import { openDb } from "../src/db/open.js";
import { servedCheck } from "../src/data/stock.js";

const read = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8");

describe("dispute (S2)", () => {
  it("reads the claims, not the injected instruction", () => {
    const d = parseDisputeFallback(read("summit-dispute-email.txt"));
    expect(d.sale_refs).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(d.claims).toEqual(["never_placed", "wrong_data"]);
    expect(d.requested_action).toBe("refund_all");
    expect(JSON.stringify(d)).not.toMatch(/dEaD/i);
  });

  it("refunds exactly the three sales with wrong data", () => {
    const sales: SaleRow[] = Array.from({ length: 12 }, (_, i) => {
      const seq = i + 5;
      return { sale_id: 100 + seq, seq, price_cents: 5, payer: "0xc", tx_hash: "0x0", signed_offer: "", requirements_json: null,
        body_json: JSON.stringify({ stock: servedCheck(seq, false) }) };
    });
    const corrections = parseCorrectionsFallback(read("stockline-corrections.txt"));
    expect(corrections.map((c) => c.seq)).toEqual([7, 10, 13]);
    // The notice's values are the true ones the generator holds.
    for (const c of corrections) expect({ on_hand: c.on_hand, reserved: c.reserved }).toEqual({ on_hand: servedCheck(c.seq, true).on_hand, reserved: servedCheck(c.seq, true).reserved });
    const refunds = refundsFor(sales, checkData(sales, corrections));
    expect(refunds.map((r) => r.seq)).toEqual([7, 10, 13]);
    expect(refunds.reduce((s, r) => s + r.amount_cents, 0)).toBe(15);
  });

  it("refuses to judge a stored stock level that is not a whole number of units", () => {
    const sale: SaleRow = { sale_id: 1, seq: 7, price_cents: 5, payer: "0xc", tx_hash: "0x0", signed_offer: "", requirements_json: null,
      body_json: JSON.stringify({ stock: { ...servedCheck(7, true), on_hand: "93" } }) };
    expect(() => checkData([sale], parseCorrectionsFallback(read("stockline-corrections.txt")))).toThrow(/whole number/);
  });

  it("refunds nothing when the delivered data matches the correction", () => {
    const sale: SaleRow = { sale_id: 1, seq: 7, price_cents: 5, payer: "0xc", tx_hash: "0x0", signed_offer: "", requirements_json: null,
      body_json: JSON.stringify({ stock: servedCheck(7, true) }) };
    expect(refundsFor([sale], checkData([sale], parseCorrectionsFallback(read("stockline-corrections.txt"))))).toEqual([]);
  });
});

describe("salesFound (dry-96: a customer disputes order numbers we never sold)", () => {
  it("returns the delivered sales and names the numbers with no delivered sale, so nothing is refunded for them", () => {
    const db = openDb(":memory:");
    const add = (seq: number, status: string) => db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('/v1/stock', 5, '0x1', '/v1/stock', ?, ?, 'x')").run(JSON.stringify({ seq }), status);
    add(5, "DELIVERED"); add(6, "ABORTED_NO_CHARGE"); add(7, "DELIVERED");
    const r = salesFound(db, [5, 6, 7, 8]);
    expect(r.sales.map((s) => s.seq)).toEqual([5, 7]);
    expect(r.missing).toEqual([6, 8]);
  });

  it("still refuses a number sold twice", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 2; i++) db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('/v1/stock', 5, '0x1', '/v1/stock', ?, 'DELIVERED', 'x')").run(JSON.stringify({ seq: 9 }));
    expect(() => salesFound(db, [9])).toThrow(/found 2/);
  });
});
