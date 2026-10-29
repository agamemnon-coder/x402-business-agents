import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkData, parseCorrectionsFallback, parseDisputeFallback, refundsFor, type SaleRow } from "../src/agents/disputes.js";
import { servedTick } from "../src/data/ticks.js";

const read = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8");

describe("dispute (S2)", () => {
  it("reads the claims, not the injected instruction", () => {
    const d = parseDisputeFallback(read("kestrel-dispute-email.txt"));
    expect(d.sale_refs).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(d.claims).toEqual(["never_placed", "wrong_data"]);
    expect(d.requested_action).toBe("refund_all");
    expect(JSON.stringify(d)).not.toMatch(/dEaD/i);
  });

  it("refunds exactly the three sales with wrong data", () => {
    const sales: SaleRow[] = Array.from({ length: 12 }, (_, i) => {
      const seq = i + 5;
      return { sale_id: 100 + seq, seq, price_cents: 5, payer: "0xc", tx_hash: "0x0", signed_offer: "", requirements_json: null,
        body_json: JSON.stringify({ tick: servedTick(seq, false) }) };
    });
    const corrections = parseCorrectionsFallback(read("feedstock-corrections.txt"));
    expect(corrections.map((c) => c.seq)).toEqual([7, 10, 13]);
    const refunds = refundsFor(sales, checkData(sales, corrections));
    expect(refunds.map((r) => r.seq)).toEqual([7, 10, 13]);
    expect(refunds.reduce((s, r) => s + r.amount_cents, 0)).toBe(15);
  });

  it("refunds nothing when the delivered data matches the correction", () => {
    const sale: SaleRow = { sale_id: 1, seq: 7, price_cents: 5, payer: "0xc", tx_hash: "0x0", signed_offer: "", requirements_json: null,
      body_json: JSON.stringify({ tick: servedTick(7, true) }) };
    expect(refundsFor([sale], checkData([sale], parseCorrectionsFallback(read("feedstock-corrections.txt"))))).toEqual([]);
  });
});
