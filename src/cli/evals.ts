// npm run evals: the agents' eval set (src/evals/cases.ts) with the real models when KIT11_ANTHROPIC_API_KEY is set
// (Haiku classifies, Sonnet reads, the code decides), otherwise with the deterministic parsers. Throwaway worlds
// only: nothing reaches Airwallex, Metal or a phone. The report goes to docs/evals/report.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runEvals } from "../evals/cases.js";
import { redactSecrets } from "../lib/redact.js";

const live = !!process.env.KIT11_ANTHROPIC_API_KEY;
console.log(live ? "Evals with the real models.\n" : "No KIT11_ANTHROPIC_API_KEY: evals with the deterministic parsers.\n");
const results = await runEvals();
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.title}${r.models.length ? `  [${r.models.join(", ")}]` : "  [parsers]"}`);
  console.log(`      ${redactSecrets(r.outcome).slice(0, 300)}`);
  if (r.why) console.log(`      why: ${redactSecrets(r.why).slice(0, 300)}`);
  for (const p of r.problems) console.log(`      PROBLEM: ${p}`);
}
const passed = results.filter((r) => r.pass).length;
const dir = resolve(import.meta.dirname, "../../docs/evals");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "report.json"), JSON.stringify({ ran_at: new Date().toISOString(), readers: live ? "models" : "parsers", passed, cases: results.length, results }, null, 2) + "\n");
console.log(`\n${passed} of ${results.length} cases pass. Report: docs/evals/report.json`);
process.exit(passed === results.length ? 0 : 1);
