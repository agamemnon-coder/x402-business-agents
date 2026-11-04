// npm run variation -- --sim 40 --seed-start 1 [--repeat 1]: D26's variation test on simulated rails, with real Claude.
//   --sim 2              a trial: two worlds
//   --repeat N           each seed N times (the same world again: the spread of choices)
//   --live               live worlds are not run here: they run on Metal testnet and the Airwallex sandbox through the
//                        dry-run harness (docs/variation.md says what a live world needs)
//   --no-claude          the harness alone, with code's fallbacks; nothing is spent and nothing is written under docs/
//   --out <name>         the batch's directory under docs/runs/variation/ (default: today's date)
//   --rerun              run every seed again on the code as it is now, even if on file elsewhere (a re-run after a
//                        fix); still resumable: only the runs already in the --out directory are skipped
// Results: docs/runs/variation/<date>/sim-<seed>.json and summary.md. Each world's cost goes into the evals block of
// docs/runs/api-budget.jsonl; the batch stops before a world once that block has reached its cap. Resumable: a seed
// already on file under docs/runs/variation/ (any date) is skipped. Never in CI.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeClient } from "../claude/reader.js";
import { newCtx, runSim } from "../evals/simWorld.js";
import { recordInFlight, runBatch, writeSummary } from "../evals/variationRunner.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback);

if (args.includes("--live")) {
  console.log("Live worlds are not run by this command: run via the dry-run harness (Metal testnet and the Airwallex sandbox, D26's permission for test worlds). docs/variation.md lists what a live world needs.");
  process.exit(0);
}
const count = Number(opt("--sim", "0"));
const start = Number(opt("--seed-start", "1"));
const repeat = Number(opt("--repeat", "1"));
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(start) || start < 1 || !Number.isInteger(repeat) || repeat < 1) {
  console.error("usage: npm run variation -- --sim <n> [--seed-start <s>] [--repeat <r>] [--no-claude] | --live");
  process.exit(2);
}
const out = opt("--out", "");
if (out && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(out)) { console.error("--out takes a directory name under docs/runs/variation/ (letters, digits, . _ -)"); process.exit(2); }
const rerun = args.includes("--rerun");
const dry = args.includes("--no-claude");
const client = dry ? null : claudeClient();
if (!dry && !client) { console.error("KIT11_ANTHROPIC_API_KEY is not set (or run --no-claude for the harness alone)"); process.exit(2); }

const repo = resolve(import.meta.dirname, "../..");
const date = new Date().toISOString().slice(0, 10);
const root = dry ? mkdtempSync(join(tmpdir(), "variation-no-claude-")) : join(repo, "docs/runs/variation");
const outDir = join(root, out || date);
const spendFile = dry ? join(root, "api-budget.jsonl") : join(repo, "docs/runs/api-budget.jsonl");

const seeds = Array.from({ length: count }, (_, i) => start + i);
console.log(`variation: ${count} simulated-rail world${count === 1 ? "" : "s"} (seeds ${start}-${start + count - 1}${repeat > 1 ? `, each ${repeat} times` : ""}), ${dry ? "no Claude" : "real Claude"}${rerun ? ", a re-run (runs on file elsewhere are not skipped)" : ""}; results in ${outDir}`);
// Ctrl-C or a kill: the world in flight's spend is recorded from its ledger before the process ends.
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { recordInFlight(); console.error(`stopped by ${sig}; the world in flight's spend is recorded`); process.exit(130); });
const r = await runBatch({
  root, outDir, spendFile, seeds, repeat, rerun, log: (l) => console.log(`  ${l}`),
  run: async (spec, w) => {
    const ctx = newCtx(spec, client);
    ctx.budgetLeftMicros = w.budgetLeftMicros;
    w.ledger(ctx.db);
    return (await runSim(spec, { client, ctx })).result;
  },
});
if (r.skipped.length) console.log(`skipped (already on file): ${r.skipped.join(", ")}`);
const summary = writeSummary(outDir, date);
const unsafe = r.ran.reduce((s, x) => s + x.safety.unsafe + x.safety.double_payments + x.safety.missing_origin, 0);
console.log(`${r.ran.length} run, ${unsafe} unsafe or double or without origin; ${(r.ran.reduce((s, x) => s + x.cost_usd_micros, 0) / 1e6).toFixed(4)} USD; ${summary}`);
if (r.stopped) { console.error(`STOPPED: ${r.stopped}`); process.exit(3); }
if (unsafe) process.exit(1);
