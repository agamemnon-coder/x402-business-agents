// npm run fuzz [-- --only <id>] [-- --seed <n>] [-- --path <path>] [-- --runs <n>] [-- --no-write]
// The fuzzing set (src/fuzz/properties.ts): the invoice reader's deterministic path, canonical terms and their SHA-256,
// the proof-bundle and receipt verifiers on real committed artifacts, the webhook signature checks and the MCP input
// schemas, with fast-check at 10,000 to 50,000 runs per property (the PDF round trip fewer), each within a time limit.
// Writes docs/evidence/fuzzing.md and .json (unless --no-write, --only or --runs). Exit 1 when a property fails: a
// finding, never hidden. In process; no network.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fuzzContext, fuzzMarkdown, fuzzReport, runFuzz, sweepArtifacts } from "../fuzz/run.js";

const ROOT = resolve(import.meta.dirname, "../..");
export const FUZZ_OUT = "docs/evidence/fuzzing";

if (process.argv[1]?.endsWith("fuzz.ts")) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const print = console.log.bind(console);
  console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"ts":')) return; print(...a); };
  console.warn = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"ts":')) return; print(...a); };
  const only = arg("--only"), seed = arg("--seed"), path = arg("--path"), runs = arg("--runs");
  const results = await runFuzz({ ...(only ? { only } : {}), ...(seed ? { seed: Number(seed) } : {}), ...(path ? { path } : {}), ...(runs ? { runs: Number(runs) } : {}), log: (r) => {
    print(`${r.status === "PASS" ? "held  " : "FAILED"} ${r.id.padEnd(30)} ${String(r.runs_done).padStart(6)} runs  ${(r.ms / 1000).toFixed(1).padStart(6)} s${r.interrupted ? "  (time limit)" : ""}${r.notes ? `  ${r.notes}` : ""}`);
    if (r.status === "FAIL") print(`       ${r.error}\n       counterexample: ${r.counterexample}\n       replay: --only ${r.id} --seed ${r.seed} --path ${r.path}`);
  } });
  const ctx = fuzzContext();
  const report = fuzzReport(results, ctx, new Date().toISOString().slice(0, 10), await sweepArtifacts(ctx));
  for (const x of report.sweep.still_valid) print(`still valid after one change: ${x.kind} ${x.change} ${x.path} (${x.artifacts})`);
  print(`\n${report.totals.properties} properties, ${report.totals.runs} runs: ${report.totals.passed} held, ${report.totals.failed} failed`);
  if (!process.argv.includes("--no-write") && !only && !runs && !path) {
    writeFileSync(join(ROOT, `${FUZZ_OUT}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(ROOT, `${FUZZ_OUT}.md`), fuzzMarkdown(report));
    print(`written: ${FUZZ_OUT}.md and .json`);
  }
  process.exit(report.totals.failed ? 1 : 0);
}
