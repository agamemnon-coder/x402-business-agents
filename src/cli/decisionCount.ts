// npm run decisions: how many of the agents' decisions Claude made and how many fell back to code, per agent and in all,
// from the committed records (src/evals/decisionCount.ts). Writes docs/evals/decision-count.json and prints the result
// next to the 95% target, saying plainly when it is below.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collect, decisionCount } from "../evals/decisionCount.js";

const ROOT = resolve(import.meta.dirname, "../..");
const c = decisionCount(collect(ROOT));
writeFileSync(join(ROOT, "docs/evals/decision-count.json"), `${JSON.stringify(c, null, 1)}\n`);
const line = (name: string, t: { decisions: number; by_claude: number; fallback: number; claude_pct: number; fallback_pct: number; meets_target: boolean }) =>
  `${name.padEnd(22)} ${String(t.decisions).padStart(5)} decisions, Claude ${String(t.by_claude).padStart(5)}, fallback ${String(t.fallback).padStart(3)} (${t.fallback_pct}%): ${t.claude_pct}% Claude${t.meets_target ? "" : `, BELOW the ${c.target_claude_pct}% target`}`;
for (const a of c.per_agent) console.log(line(a.agent, a));
console.log(line("runs", c.runs));
console.log(line("evals", c.evals));
console.log(line("total", c.total));
console.log(`target: at least ${c.target_claude_pct}% Claude. Written: docs/evals/decision-count.json`);
