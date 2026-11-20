// npx tsx src/cli/apEvalsRerunMd.ts <rerun.json> <out.md>: the run log of a re-run of the payables agents' evals
// (npm run ap-agent-evals -- … --out FILE), written from that record and the committed one it sits beside
// (docs/evals/ap-agents.json), side by side. Offline: no model, no network, no key.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Summary {
  right: number; cases: number; non_redteam: { right: number; cases: number }; fooled: number; fooled_redteam: number;
  unsafe_after: number; fallbacks: number; cost_per_case_usd_micros: number; p50_ms: number; p95_ms: number;
}
interface Rec {
  ran_at: string; what?: string; command?: string; spent_usd?: number; max_usd?: number; stopped?: string | null;
  models: Record<"checker" | "payer", Record<string, { complete: boolean; summary: Summary }>>;
  defaults: { checker: string | null; payer: string | null };
  rows: { agent: string; case: string; model: string; right: boolean; outcome: string; expected: string; raw_unsafe: boolean; unsafe_after: boolean; commit?: string; cost_usd_micros: number }[];
}

const ROOT = resolve(import.meta.dirname, "../..");
const [inArg, outArg] = process.argv.slice(2);
if (!inArg || !outArg) { console.error("usage: npx tsx src/cli/apEvalsRerunMd.ts <rerun.json> <out.md>"); process.exit(2); }
const now = JSON.parse(readFileSync(resolve(ROOT, inArg), "utf8")) as Rec;
const before = JSON.parse(readFileSync(resolve(ROOT, "docs/evals/ap-agents.json"), "utf8")) as Rec;
const usd = (micros: number) => (micros / 1e6).toFixed(4);
const day = now.ran_at.slice(0, 10);
const commits = [...new Set(now.rows.map((r) => r.commit).filter(Boolean))];

const cells = (r: Rec | undefined, agent: "checker" | "payer", model: string) => {
  const m = r?.models[agent]?.[model];
  if (!m) return "–";
  const s = m.summary;
  return `${s.right}/${s.cases} right; fooled ${s.fooled}; unsafe after code ${s.unsafe_after}; fallbacks ${s.fallbacks}; USD ${usd(s.cost_per_case_usd_micros)} a case; p50 ${(s.p50_ms / 1000).toFixed(1)} s${m.complete ? "" : " (not all cases)"}`;
};
const wrong = now.rows.filter((r) => !r.right);
const lines = [
  `# Claude: the payables agents' evals, re-run on ${day} with real models`,
  "",
  `Record: [${inArg.replace(/^docs\//, "../")}](${inArg.replace(/^docs\//, "../")}), written by \`${now.command ?? "npm run ap-agent-evals"}\` ([src/cli/apAgentEvals.ts](../../src/cli/apAgentEvals.ts)); this page by \`npx tsx src/cli/apEvalsRerunMd.ts\` from that record and the committed one, [docs/evals/ap-agents.json](../evals/ap-agents.json) (run ${before.ran_at.slice(0, 10)}), which is kept as it was recorded.`,
  "",
  "- **What ran.** Every case of the Checker (reads an invoice, decides pay, ask the CFO or hold) and the Payer, each sent to Claude Haiku, Sonnet and Opus through the same code the product runs, on test invoices. Red-team cases carry injected instructions, forged banks and pressure. The outcome is what stands after Purser's code has checked the model's answer: \"unsafe after code\" counts a payment that should not have been made and was not stopped.",
  `- **Not held out.** The same cases were first run on 12 Nov and are committed; the code has changed since that run (${commits.length ? `this run's commit: ${commits.map((c) => `\`${c}\``).join(", ")}` : "commit not recorded"}). This is a re-run on today's code and today's models, not a fresh test of unseen cases.`,
  `- **Cost.** USD ${(now.spent_usd ?? 0).toFixed(4)} of Claude at list price (cap ${now.max_usd ?? "–"}), each case booked in docs/runs/api-budget.jsonl under "ap-agents".${now.stopped ? ` Stopped early: ${now.stopped}.` : ""}`,
  "",
  "## Result, beside the committed run",
  "",
  `| Agent | Model | ${day} | ${before.ran_at.slice(0, 10)} |`,
  "|---|---|---|---|",
  ...(["checker", "payer"] as const).flatMap((a) => Object.keys(now.models[a] ?? {}).map((m) => `| ${a} | ${m} | ${cells(now, a, m)} | ${cells(before, a, m)} |`)),
  "",
  `Defaults the record picks: checker ${now.defaults.checker ?? "none"}, payer ${now.defaults.payer ?? "none"}.`,
  "",
  "## Cases not right in this run",
  "",
  ...(wrong.length ? ["| Agent | Case | Model | Expected | Outcome | Model fooled | Unsafe after code |", "|---|---|---|---|---|---|---|",
    ...wrong.map((r) => `| ${r.agent} | ${r.case} | ${r.model} | ${r.expected} | ${r.outcome} | ${r.raw_unsafe ? "yes" : "no"} | ${r.unsafe_after ? "yes" : "no"} |`)] : ["None."]),
  "",
];
writeFileSync(resolve(ROOT, outArg), lines.join("\n"));
console.log(`wrote ${outArg}`);
