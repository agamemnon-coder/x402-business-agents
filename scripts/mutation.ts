// npm run mutation (docs/evidence/mutation-testing.md): mutation testing of the money-critical modules, offline.
// 1. Stryker (stryker.config.mjs) mutates the TypeScript modules, one group at a time (MUTATION_GROUP: approval,
//    available, executor, verifier, payee), and runs each group's related tests (vitest.mutation.config.ts).
//    Stryker is not a dependency of the repository: it is installed once into its own folder (STRYKER_PREFIX, by default
//    under the system's temp folder), never into node_modules, and its vitest is pointed at the repository's own, so the
//    tests run on the same vitest as `npm test`.
// 2. scripts/mutation-proof-verifier.ts mutates the proof-bundle verifier, plain JavaScript in a string Stryker cannot
//    reach.
// 3. The summary: per file, mutants total, killed, survived, timed out, without coverage, and the score, written to
//    reports/mutation/summary.json (the full reports stay in reports/mutation/, not committed).
// Flags: --group approval,payee (only those groups), --summary-only (re-summarise the last run's reports),
// --no-proof (Stryker only), --no-stryker (the verifier only).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STRYKER_VERSION = "10.1.1";
const REPORTS = "reports/mutation";
const PROOF_REPORT = "reports/mutation/proof-verifier.json";
const SUMMARY = "reports/mutation/summary.json";

function run(cmd: string, args: string[], env: Record<string, string> = {}): void {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${String(r.status ?? r.signal)}`);
}

/** Stryker in its own folder, with the repository's vitest. Returns the stryker binary. */
function stryker(): string {
  const prefix = resolve(process.env.STRYKER_PREFIX ?? join(tmpdir(), `purser-stryker-${STRYKER_VERSION}`));
  const bin = join(prefix, "node_modules", ".bin", "stryker");
  if (!existsSync(bin)) {
    mkdirSync(prefix, { recursive: true });
    run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", `@stryker-mutator/core@${STRYKER_VERSION}`, `@stryker-mutator/vitest-runner@${STRYKER_VERSION}`]);
  }
  // npm installs vitest as the runner's peer; the runner must load the repository's own, or the tests would register
  // with another copy of vitest than the one running them.
  const theirs = join(prefix, "node_modules", "vitest");
  const ours = realpathSync(resolve("node_modules", "vitest"));
  let linked: boolean;
  try { linked = realpathSync(theirs) === ours; } catch { linked = false; }
  if (!linked) {
    rmSync(theirs, { recursive: true, force: true });
    symlinkSync(ours, theirs, "dir");
  }
  return bin;
}

interface StrykerMutant { status: string; mutatorName: string; location: { start: { line: number } }; replacement?: string }
interface Counts { total: number; killed: number; survived: number; timeout: number; no_coverage: number; ignored: number; errors: number; score: number; score_covered: number }

function count(statuses: string[]): Counts {
  const n = (s: string) => statuses.filter((x) => x === s).length;
  const killed = n("Killed");
  const timeout = n("Timeout");
  const survived = n("Survived");
  const noCoverage = n("NoCoverage");
  const detected = killed + timeout;
  const valid = detected + survived + noCoverage;
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    total: statuses.length, killed, survived, timeout, no_coverage: noCoverage, ignored: n("Ignored"),
    errors: n("CompileError") + n("RuntimeError"),
    score: valid ? round((100 * detected) / valid) : 0,
    score_covered: detected + survived ? round((100 * detected) / (detected + survived)) : 0,
  };
}

export function summarise(groups: string[]): Record<string, unknown> {
  const files: Record<string, string[]> = {};
  for (const g of groups) {
    const at = join(REPORTS, `${g}.json`);
    if (!existsSync(at)) continue;
    const report = JSON.parse(readFileSync(at, "utf8")) as { files: Record<string, { mutants: StrykerMutant[] }> };
    for (const [f, v] of Object.entries(report.files)) files[f] = v.mutants.map((m) => m.status);
  }
  const all = count(Object.values(files).flat());
  const proof = existsSync(PROOF_REPORT) ? JSON.parse(readFileSync(PROOF_REPORT, "utf8")) as { total: number; killed: number; timeout: number; survived: number; score: number } : null;
  const summary = { stryker: { version: STRYKER_VERSION, all, files: Object.fromEntries(Object.entries(files).map(([f, st]) => [f, count(st)])) }, proof_verifier: proof && { total: proof.total, killed: proof.killed, timeout: proof.timeout, survived: proof.survived, score: proof.score } };
  writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv);
  const { GROUPS } = (await import(pathToFileURL(resolve("stryker.config.mjs")).href)) as { GROUPS: Record<string, unknown> };
  const at = argv.indexOf("--group");
  const groups = at >= 0 ? argv[at + 1]!.split(",") : Object.keys(GROUPS);
  for (const g of groups) if (!(g in GROUPS)) throw new Error(`no group ${g}: ${Object.keys(GROUPS).join(", ")}`);
  if (!flags.has("--summary-only")) {
    if (!flags.has("--no-stryker")) {
      const bin = stryker();
      for (const g of groups) run(bin, ["run", "stryker.config.mjs"], { MUTATION_GROUP: g });
    }
    if (!flags.has("--no-proof")) run("npx", ["tsx", "scripts/mutation-proof-verifier.ts", "--out", PROOF_REPORT]);
  }
  const s = summarise(Object.keys(GROUPS)) as { stryker: { all: Counts }; proof_verifier: { total: number; killed: number; survived: number; score: number } | null };
  const a = s.stryker.all;
  console.log(`\nStryker ${STRYKER_VERSION}: ${a.total} mutants, ${a.killed} killed, ${a.timeout} timed out, ${a.survived} survived, ${a.no_coverage} without coverage, ${a.ignored} ignored (static); score ${a.score}% (${a.score_covered}% of covered).`);
  if (s.proof_verifier) console.log(`Proof-bundle verifier: ${s.proof_verifier.killed} of ${s.proof_verifier.total} killed, ${s.proof_verifier.survived} survived (${s.proof_verifier.score}%).`);
  console.log(`Summary: ${SUMMARY}`);
}

await main();
