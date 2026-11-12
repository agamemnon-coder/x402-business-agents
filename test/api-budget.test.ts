// D26 (Max, 2 November): about $250 of the remaining API credit, split over blocks, with $30 kept back; a counter per
// block from the cost recorded per Claude call, and a warning at 80%. Breaks if spend is lost, a block can silently go
// over its share, or the reserve is counted as spendable.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUDGET_BLOCKS, budgetStatus, recordSpend } from "../src/claude/budget.js";

const file = () => join(mkdtempSync(join(tmpdir(), "budget-")), "spend.jsonl");

describe("the API budget per block (D26)", () => {
  it("splits about $250 over the blocks and keeps $30 back", () => {
    // 12 November: the payables agents' live eval got its own block of $8 (npm run ap-agent-evals), beside the D26 $250.
    expect(BUDGET_BLOCKS).toEqual({ evals: 80, redteam: 60, soak: 50, reviews: 30, try: 30, "ap-agents": 8 });
    expect(Object.values(BUDGET_BLOCKS).reduce((a, b) => a + b, 0)).toBe(258);
  });
  it("adds up what each block spent, from the cost recorded per call", () => {
    const f = file();
    recordSpend(f, { block: "evals", usd_micros: 1_500_000, what: "agent evals" });
    recordSpend(f, { block: "evals", usd_micros: 500_000, what: "variation seed 1" });
    recordSpend(f, { block: "redteam", usd_micros: 250_000, what: "attack 1" });
    const s = budgetStatus(f);
    expect(s.blocks.evals).toMatchObject({ spentUsd: 2, capUsd: 80, warn: false, over: false });
    expect(s.blocks.redteam).toMatchObject({ spentUsd: 0.25 });
    expect(s.totalUsd).toBe(2.25);
  });
  it("warns at 80% of a block and says when a block is over", () => {
    const f = file();
    recordSpend(f, { block: "reviews", usd_micros: 24_000_000, what: "claims review" });
    expect(budgetStatus(f).blocks.reviews).toMatchObject({ warn: true, over: false });
    recordSpend(f, { block: "reviews", usd_micros: 7_000_000, what: "deck review" });
    expect(budgetStatus(f).blocks.reviews).toMatchObject({ warn: true, over: true });
  });
  it("refuses an unknown block, so no spend goes uncounted", () => {
    expect(() => recordSpend(file(), { block: "misc" as never, usd_micros: 1, what: "x" })).toThrow(/unknown budget block/);
  });
});
