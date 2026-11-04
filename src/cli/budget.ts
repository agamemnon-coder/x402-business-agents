// npm run budget: the D26 counters per block (docs/runs/api-budget.jsonl), with a warning at 80% of a block.
import { resolve } from "node:path";
import { BUDGET_RESERVE_USD, budgetStatus } from "../claude/budget.js";

export const BUDGET_FILE = resolve(import.meta.dirname, "../../docs/runs/api-budget.jsonl");
const s = budgetStatus(BUDGET_FILE);
for (const [b, x] of Object.entries(s.blocks)) {
  console.log(`${b.padEnd(8)} $${x.spentUsd.toFixed(2).padStart(6)} of $${x.capUsd}${x.over ? "  OVER" : x.warn ? "  80% reached" : ""}`);
}
console.log(`total    $${s.totalUsd.toFixed(2)} (plus $${BUDGET_RESERVE_USD} kept back)`);
