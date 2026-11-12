// npm run budget: the Claude spend per block (docs/runs/api-budget.jsonl), with a warning at 80% of a block, the hard stop
// at $140 of the $150 ceiling, and the spend per day and per run.
import { resolve } from "node:path";
import { BUDGET_CEILING_USD, BUDGET_STOP_USD, DAILY_CAPS_USD, budgetStatus, spendPerDay, spendPerRun, type BudgetBlock } from "../claude/budget.js";

export const BUDGET_FILE = resolve(import.meta.dirname, "../../docs/runs/api-budget.jsonl");
const s = budgetStatus(BUDGET_FILE);
for (const [b, x] of Object.entries(s.blocks)) {
  const dayCap = DAILY_CAPS_USD[b as BudgetBlock];
  console.log(`${b.padEnd(9)} $${x.spentUsd.toFixed(2).padStart(6)} of $${x.capUsd}${dayCap ? ` (at most $${dayCap} a day)` : ""}${x.over ? "  OVER" : x.warn ? "  80% reached" : ""}`);
}
console.log(`total     $${s.totalUsd.toFixed(2)} of $${BUDGET_STOP_USD}: the hard stop (ceiling $${BUDGET_CEILING_USD}; the rest is not spendable)${s.stopped ? "  STOPPED" : ""}`);
console.log("\nper day (UTC):");
for (const [d, m] of Object.entries(spendPerDay(BUDGET_FILE))) console.log(`  ${d}  $${(m.total ?? 0).toFixed(2)}`);
const runs = Object.entries(spendPerRun(BUDGET_FILE));
if (runs.length) {
  console.log("\nper run:");
  for (const [r, x] of runs) console.log(`  ${r.padEnd(28)} ${x.block.padEnd(9)} $${x.usd.toFixed(2)} (${x.lines} calls)`);
}
