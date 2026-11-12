// The Claude budget (master-list line 422, 12 November): a $150 ceiling with a hard stop at $140, a block per kind of
// spend, a day cap for the jury demo, and spend per day and per run. Breaks if spend is lost, a block can silently go over
// its share, the stop can be passed, or the part above the stop is counted as spendable.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUDGET_BLOCKS, BUDGET_CEILING_USD, BUDGET_RESERVE_USD, BUDGET_STOP_USD, DAILY_CAPS_USD,
  assertSpendAllowed, budgetStatus, recordSpend, spendPerDay, spendPerRun, spendRefusal,
} from "../src/claude/budget.js";

const file = () => join(mkdtempSync(join(tmpdir(), "budget-")), "spend.jsonl");
const DAY1 = new Date("2026-11-13T09:00:00Z");
const DAY2 = new Date("2026-11-14T09:00:00Z");

describe("the Claude budget: $150 ceiling, hard stop at $140", () => {
  it("splits exactly $140 over the blocks; the $10 above it is not spendable", () => {
    expect(BUDGET_CEILING_USD).toBe(150);
    expect(BUDGET_STOP_USD).toBe(140);
    expect(BUDGET_RESERVE_USD).toBe(10);
    expect(Object.values(BUDGET_BLOCKS).reduce((a, b) => a + b, 0)).toBe(BUDGET_STOP_USD);
    expect(BUDGET_BLOCKS).toHaveProperty("chain");
    // 12 November: the Coder evals keep their $4 block, the payables agents' live eval its $8, and the ledger agents
    // their $10 (taken from the jury demo's `try` block).
    expect(BUDGET_BLOCKS).toMatchObject({ coder: 4, "ap-agents": 8, "ledger-agents": 10, try: 28 });
    expect(DAILY_CAPS_USD.try).toBe(15);
  });

  it("sets no block below what the committed spend log already holds for it", () => {
    const s = budgetStatus(resolve(import.meta.dirname, "../docs/runs/api-budget.jsonl"));
    for (const [b, x] of Object.entries(s.blocks)) expect(x.capUsd, b).toBeGreaterThanOrEqual(x.spentUsd);
  });

  it("refuses any new spend once the recorded total reaches $140, in every block", () => {
    const f = file();
    recordSpend(f, { block: "try", usd_micros: 28_000_000, what: "demo" });
    recordSpend(f, { block: "ledger-agents", usd_micros: 10_000_000, what: "ledger" });
    recordSpend(f, { block: "chain", usd_micros: 25_000_000, what: "chain" });
    recordSpend(f, { block: "soak", usd_micros: 25_000_000, what: "soak" });
    recordSpend(f, { block: "evals", usd_micros: 25_000_000, what: "evals" });
    recordSpend(f, { block: "redteam", usd_micros: 10_000_000, what: "redteam" });
    recordSpend(f, { block: "ap-agents", usd_micros: 8_000_000, what: "ap" });
    recordSpend(f, { block: "reviews", usd_micros: 5_000_000, what: "reviews" });
    recordSpend(f, { block: "coder", usd_micros: 3_990_000, what: "coder" });
    expect(budgetStatus(f).totalUsd).toBe(139.99);
    expect(spendRefusal(f, "coder", 0, DAY2)).toBeNull();
    expect(spendRefusal(f, "coder", 10_000, DAY2)).toBeNull();
    expect(spendRefusal(f, "coder", 20_000, DAY2)).toMatch(/stops at \$140/);
    recordSpend(f, { block: "coder", usd_micros: 10_000, what: "coder" });
    const s = budgetStatus(f);
    expect(s.totalUsd).toBeGreaterThanOrEqual(140);
    expect(s.stopped).toBe(true);
    for (const b of Object.keys(BUDGET_BLOCKS)) {
      expect(spendRefusal(f, b, 0, DAY2), b).toMatch(/stops at \$140/);
      expect(s.blocks[b as keyof typeof BUDGET_BLOCKS].over, b).toBe(true);
    }
    expect(() => assertSpendAllowed(f, "soak", 0, DAY2)).toThrow(/stops at \$140/);
  });

  it("refuses a spend that would take a block past its cap, and one at its cap", () => {
    const f = file();
    recordSpend(f, { block: "soak", usd_micros: 24_500_000, what: "19 runs" });
    expect(spendRefusal(f, "soak", 400_000)).toBeNull();
    expect(spendRefusal(f, "soak", 600_000)).toMatch(/soak block is at its cap/);
    recordSpend(f, { block: "soak", usd_micros: 500_000, what: "run 20" });
    expect(spendRefusal(f, "soak")).toMatch(/soak block is at its cap/);
    expect(spendRefusal(f, "chain")).toBeNull();
  });

  it("counts the Coder evals' spend in its own block, and says when it is over its $4", () => {
    const f = file();
    recordSpend(f, { block: "coder", usd_micros: 3_900_000, what: "coder-evals haiku,sonnet" });
    expect(budgetStatus(f).blocks.coder).toMatchObject({ spentUsd: 3.9, capUsd: 4, warn: true, over: false });
    expect(budgetStatus(f).blocks.evals.spentUsd).toBe(0);
    recordSpend(f, { block: "coder", usd_micros: 200_000, what: "one more case" });
    expect(budgetStatus(f).blocks.coder.over).toBe(true);
  });

  it("caps the jury demo at $15 a UTC day, and opens again the next day", () => {
    const f = file();
    recordSpend(f, { block: "try", usd_micros: 14_000_000, what: "jury visits" }, DAY1);
    expect(spendRefusal(f, "try", 900_000, DAY1)).toBeNull();
    expect(spendRefusal(f, "try", 1_100_000, DAY1)).toMatch(/day cap is reached/);
    recordSpend(f, { block: "try", usd_micros: 1_000_000, what: "jury visits" }, DAY1);
    expect(spendRefusal(f, "try", 0, DAY1)).toMatch(/\$15\.00 of \$15 on 2026-11-13/);
    expect(spendRefusal(f, "try", 0, DAY2)).toBeNull();
    // Other blocks have no day cap.
    recordSpend(f, { block: "chain", usd_micros: 20_000_000, what: "chain runs" }, DAY1);
    expect(spendRefusal(f, "chain", 0, DAY1)).toBeNull();
  });

  it("refuses an unknown block, when recording and when asking", () => {
    expect(() => recordSpend(file(), { block: "misc" as never, usd_micros: 1, what: "x" })).toThrow(/unknown budget block/);
    expect(spendRefusal(file(), "misc")).toMatch(/unknown budget block: misc/);
    expect(spendRefusal(file(), "toString")).toMatch(/unknown budget block/);
    expect(spendRefusal(file(), "soak", -1)).toMatch(/bad spend estimate/);
  });

  it("adds up spend per block, per UTC day and per run; a line of an unknown block still counts toward the total", () => {
    const f = file();
    recordSpend(f, { block: "soak", usd_micros: 1_500_000, what: "run 1", run: "soak-1" }, DAY1);
    recordSpend(f, { block: "soak", usd_micros: 500_000, what: "run 1 again", run: "soak-1" }, DAY1);
    recordSpend(f, { block: "redteam", usd_micros: 250_000, what: "attack 1" }, DAY2);
    const s = budgetStatus(f);
    expect(s.blocks.soak).toMatchObject({ spentUsd: 2, capUsd: 25, warn: false, over: false });
    expect(s.totalUsd).toBe(2.25);
    expect(spendPerDay(f)).toEqual({ "2026-11-13": { total: 2, soak: 2 }, "2026-11-14": { total: 0.25, redteam: 0.25 } });
    expect(spendPerRun(f)).toEqual({ "soak-1": { block: "soak", usd: 2, lines: 2 } });
    const raw = readFileSync(f, "utf8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("warns at 80% of a block and says when a block is over", () => {
    const f = file();
    recordSpend(f, { block: "reviews", usd_micros: 4_100_000, what: "claims review" });
    expect(budgetStatus(f).blocks.reviews).toMatchObject({ warn: true, over: false });
    recordSpend(f, { block: "reviews", usd_micros: 1_000_000, what: "deck review" });
    expect(budgetStatus(f).blocks.reviews).toMatchObject({ warn: true, over: true });
  });
});
