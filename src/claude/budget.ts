// D26 (Max, 2 November): the API credit left for the product's own Claude calls, split per block, with $30 kept back
// for Thursday, the extra run and /try while the jury looks. Every script that spends records its cost here (the cost
// each Claude call already reports, in micro-dollars); `npm run budget` prints the counters and warns at 80%.

import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * Dollars per block (about $250 in all). 12 November: $4 for the Coder agent's evals (npm run coder-evals), and
 * "ap-agents", the live eval of the payables agents (npm run ap-agent-evals), with the $8 that eval was given, on top of
 * the D26 split.
 */
export const BUDGET_BLOCKS = { evals: 80, redteam: 60, soak: 50, reviews: 30, try: 30, coder: 4, "ap-agents": 8 } as const;
export type BudgetBlock = keyof typeof BUDGET_BLOCKS;
export const BUDGET_RESERVE_USD = 30;
const WARN_AT = 0.8;

export interface Spend { block: BudgetBlock; usd_micros: number; what: string }

/** Appends one spend (a JSON line). An unknown block is an error, so nothing is spent outside the plan. */
export function recordSpend(file: string, s: Spend, at = new Date()): void {
  if (!(s.block in BUDGET_BLOCKS)) throw new Error(`unknown budget block: ${String(s.block)}`);
  if (!Number.isSafeInteger(s.usd_micros) || s.usd_micros < 0) throw new Error(`bad spend: ${s.usd_micros}`);
  appendFileSync(file, `${JSON.stringify({ ...s, at: at.toISOString() })}\n`);
}

export interface BlockStatus { spentUsd: number; capUsd: number; warn: boolean; over: boolean }

export function budgetStatus(file: string): { blocks: Record<BudgetBlock, BlockStatus>; totalUsd: number } {
  const micros = Object.fromEntries(Object.keys(BUDGET_BLOCKS).map((b) => [b, 0])) as Record<BudgetBlock, number>;
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const s = JSON.parse(line) as Spend;
      if (s.block in micros) micros[s.block] += s.usd_micros;
    }
  }
  const usd = (m: number) => Math.round(m / 10_000) / 100;
  const blocks = Object.fromEntries((Object.keys(BUDGET_BLOCKS) as BudgetBlock[]).map((b) => {
    const cap = BUDGET_BLOCKS[b];
    const spent = usd(micros[b]);
    return [b, { spentUsd: spent, capUsd: cap, warn: micros[b] >= cap * WARN_AT * 1e6, over: micros[b] > cap * 1e6 }];
  })) as Record<BudgetBlock, BlockStatus>;
  return { blocks, totalUsd: usd(Object.values(micros).reduce((a, b) => a + b, 0)) };
}
