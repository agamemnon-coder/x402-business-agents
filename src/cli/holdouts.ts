// npm run holdouts [-- --only id[,id]] [--no-claude]: D26's ten unseen situations on simulated rails, with real Claude
// (src/evals/holdouts.ts). Results: docs/runs/holdouts/<date>/<id>.json and summary.md; each one's cost goes into the
// evals block of docs/runs/api-budget.jsonl, and the run stops once that block has reached its cap. Resumable: a
// holdout already on file (any date) is skipped. --no-claude runs code's fallbacks only, writing nothing under docs/.
// The live candidates run on Metal testnet and the Airwallex sandbox through the dry-run harness, not here.

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeClient } from "../claude/reader.js";
import { HOLDOUTS, holdoutsMarkdown, runHoldouts, type HoldoutResult } from "../evals/holdouts.js";

const args = process.argv.slice(2);
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "").split(",").filter(Boolean) : HOLDOUTS.map((h) => h.id);
const unknown = only.filter((id) => !HOLDOUTS.some((h) => h.id === id));
if (unknown.length) { console.error(`no holdout ${unknown.join(", ")}; there are: ${HOLDOUTS.map((h) => h.id).join(", ")}`); process.exit(2); }
const dry = args.includes("--no-claude");
const client = dry ? null : claudeClient();
if (!dry && !client) { console.error("KIT11_ANTHROPIC_API_KEY is not set (or run --no-claude for code's fallbacks)"); process.exit(2); }

const repo = resolve(import.meta.dirname, "../..");
const date = new Date().toISOString().slice(0, 10);
const root = dry ? mkdtempSync(join(tmpdir(), "holdouts-no-claude-")) : join(repo, "docs/runs/holdouts");
const outDir = join(root, date);
const spendFile = dry ? join(root, "api-budget.jsonl") : join(repo, "docs/runs/api-budget.jsonl");

console.log(`holdouts: ${only.join(", ")} on simulated rails, ${dry ? "no Claude" : "real Claude"}; results in ${outDir}`);
const r = await runHoldouts({ root, outDir, spendFile, ids: only, client, log: (l) => console.log(`  ${l}`) });
if (r.skipped.length) console.log(`skipped (already on file): ${r.skipped.join(", ")}`);
const all = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(outDir, f), "utf8")) as HoldoutResult) : [];
if (all.length) writeFileSync(join(outDir, "summary.md"), holdoutsMarkdown(all, date));
console.log(`${r.ran.filter((x) => x.safe).length} of ${r.ran.length} safe; ${(r.ran.reduce((s, x) => s + x.cost_usd_micros, 0) / 1e6).toFixed(4)} USD`);
if (r.stopped) { console.error(`STOPPED: ${r.stopped}`); process.exit(3); }
if (r.ran.some((x) => !x.safe)) process.exit(1);
