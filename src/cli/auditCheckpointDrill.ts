// npm run audit:checkpoint-drill [-- record]: signed audit checkpoints switched on for a runner's ledger file and run
// through the runner's code, then each attack on copies of it (src/e2e/checkpointDrill.ts). No network: nothing reaches
// Airwallex, Alta or a phone, and no money moves. The key is made in a temporary directory and deleted afterwards.
//
//   (no argument)   runs the drill and prints every step
//   record          runs it and writes docs/runs/<CHECKPOINT_DRILL_DATE or today>-checkpoint-drill.json and .md
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cmd = process.argv[2] ?? "run";
if (cmd !== "run" && cmd !== "record") { console.error("usage: npm run audit:checkpoint-drill [-- record]"); process.exit(2); }
const repo = resolve(import.meta.dirname, "../..");
for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_DB"]) delete process.env[k];
globalThis.fetch = (async (i: unknown) => { throw new Error(`checkpoint drill: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;

const { runCheckpointDrill, checkpointDrillRecord, renderCheckpointDrill } = await import("../e2e/checkpointDrill.js");
const res = await runCheckpointDrill({ log: (l) => console.log(l) });
const failed = res.steps.filter((s) => !s.pass);
console.log(`SUMMARY  ${res.steps.length} steps, ${res.steps.length - failed.length} passed, ${failed.length} failed`);
if (cmd === "record") {
  const date = process.env.CHECKPOINT_DRILL_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("CHECKPOINT_DRILL_DATE is YYYY-MM-DD"); process.exit(2); }
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } })();
  const rec = checkpointDrillRecord(res, { date, commit, node: process.version, platform: `${process.platform} ${process.arch}` });
  const base = resolve(repo, "docs/runs", `${date}-checkpoint-drill`);
  writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderCheckpointDrill(rec));
  console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
}
process.exit(failed.length ? 1 : 0);
