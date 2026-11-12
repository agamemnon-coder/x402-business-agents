import { describe, expect, it } from "vitest";
import { balanceRecord, readBalances } from "../src/cli/metalBalance.js";

const w = (n: number) => ({ label: `w${n}`, address: `0x${n.toString(16).padStart(40, "0")}`, source: "test" });

describe("metal-balance (read-only, capped)", () => {
  it("reads the block and each wallet, rounding down to the cent", async () => {
    let calls = 0;
    const r = await readBalances([w(1), w(2)], {
      block: async () => { calls++; return 123n; },
      balance: async () => { calls++; return 12_345_678_900_000_000_000n; },
    });
    expect(calls).toBe(3);
    expect(r.block).toBe(123n);
    expect(r.rows.map((x) => x.usdz)).toEqual(["12.34", "12.34"]);
    const md = balanceRecord(new Date("2026-11-12T14:00:00Z"), r.block, r.rows, calls);
    expect(md).toContain("block 123");
    expect(md).toContain("3 read-only RPC calls, cap 10");
  });

  it("refuses a list that would pass the 10-call cap before any call", async () => {
    let calls = 0;
    const read = { block: async () => { calls++; return 1n; }, balance: async () => { calls++; return 0n; } };
    await expect(readBalances(Array.from({ length: 10 }, (_, i) => w(i + 1)), read)).rejects.toThrow(/cap is 10/);
    expect(calls).toBe(0);
  });
});
