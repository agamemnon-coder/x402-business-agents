// Night batch, temporary: re-runs the worlds with a finding (sim-31, sim-38) after the fix, 3 times each, in their own folder.
import { join, resolve } from "node:path";
import { claudeClient } from "../claude/reader.js";
import { newCtx, runSim } from "../evals/simWorld.js";
import { recordInFlight, runBatch, writeSummary } from "../evals/variationRunner.js";
const client = claudeClient()!;
const repo = resolve(import.meta.dirname, "../..");
const root = join(repo, "docs/runs/variation-after-fix");
const outDir = join(root, "2026-11-02");
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { recordInFlight(); process.exit(130); });
const r = await runBatch({ root, outDir, spendFile: join(repo, "docs/runs/api-budget.jsonl"), seeds: [31, 38], repeat: 3, log: (l) => console.log(`  ${l}`),
  run: async (spec, w) => { const ctx = newCtx(spec, client); ctx.budgetLeftMicros = w.budgetLeftMicros; w.ledger(ctx.db); return (await runSim(spec, { client, ctx })).result; } });
console.log(writeSummary(outDir, "2026-11-02"), r.ran.map((x) => `${x.label}: ${x.safety.unsafe} unsafe`).join("; "), r.stopped ?? "");
