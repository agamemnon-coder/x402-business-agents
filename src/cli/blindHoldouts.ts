// npm run blind-holdouts [-- --only H2,H10] [--no-claude]: the blind holdouts of 3 November that run on simulated rails
// (src/evals/blindHoldouts.ts), with real Claude. Results: docs/runs/holdouts/2026-11-03-blind/sim/<id>.json; each
// world's cost goes into the evals block of docs/runs/api-budget.jsonl, and nothing runs once that block is at its cap.
// A result already on file is not run again. --no-claude runs code's fallbacks only and writes nothing under docs/.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { budgetStatus, recordSpend } from "../claude/budget.js";
import { claudeClient } from "../claude/reader.js";
import { BLIND_SIMS, runBlindSim } from "../evals/blindHoldouts.js";

const args = process.argv.slice(2);
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "").split(",").filter(Boolean) : BLIND_SIMS.map((b) => b.id);
const unknown = only.filter((id) => !BLIND_SIMS.some((b) => b.id === id));
if (unknown.length) { console.error(`no blind holdout ${unknown.join(", ")}; there are: ${BLIND_SIMS.map((b) => b.id).join(", ")}`); process.exit(2); }
const dry = args.includes("--no-claude");
const client = dry ? null : claudeClient();
if (!dry && !client) { console.error("KIT11_ANTHROPIC_API_KEY is not set (or run --no-claude for code's fallbacks)"); process.exit(2); }

const repo = resolve(import.meta.dirname, "../..");
const outDir = dry ? mkdtempSync(join(tmpdir(), "blind-no-claude-")) : join(repo, "docs/runs/holdouts/2026-11-03-blind/sim");
const spendFile = dry ? join(outDir, "api-budget.jsonl") : join(repo, "docs/runs/api-budget.jsonl");
mkdirSync(outDir, { recursive: true });
for (const id of only) {
  const file = join(outDir, `${id}.json`);
  if (existsSync(file)) { console.log(`${id}: on file already, not run again`); continue; }
  const b = budgetStatus(spendFile).blocks.evals;
  if (b.over || b.spentUsd >= b.capUsd) { console.error(`STOPPED: the evals block is at its cap (${b.spentUsd.toFixed(2)} of ${b.capUsd} USD)`); process.exit(3); }
  const r = await runBlindSim(BLIND_SIMS.find((x) => x.id === id)!, client, Math.round((b.capUsd - b.spentUsd) * 1e6));
  if (r.cost_usd_micros > 0) recordSpend(spendFile, { block: "evals", usd_micros: r.cost_usd_micros, what: `blind holdout ${id} (simulated)` });
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  console.log(`${id} ${r.title}: ${r.pass ? "PASS" : "FAIL"}${r.unsafe.length ? `; UNSAFE ${r.unsafe.join("; ")}` : ""}${r.fails.length ? `; ${r.fails.join("; ")}` : ""}; ${(r.cost_usd_micros / 1e6).toFixed(4)} USD`);
  if (r.stopped_early) { console.error(`STOPPED: ${r.stopped_early}`); process.exit(3); }
}
