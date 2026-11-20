// npm run mutation (docs/evidence/mutation-testing.md): mutation testing of the money-critical modules, offline.
// 1. Stryker (stryker.config.mjs) mutates the TypeScript modules, one group at a time (MUTATION_GROUP: hashfirst,
//    terms, approval-decide, executor-checks, saga, available, … in stryker.config.mjs), and runs each group's tests
//    (vitest.mutation.config.ts): every test file that imports one of the group's modules.
//    Stryker is not a dependency of the repository: it is installed once into its own folder (STRYKER_PREFIX, by default
//    under the system's temp folder), never into node_modules, and its vitest is pointed at the repository's own, so the
//    tests run on the same vitest as `npm test`.
// 2. scripts/mutation-proof-verifier.ts mutates the proof-bundle verifier, plain JavaScript in a string Stryker cannot
//    reach.
// 3. The summary: per file, mutants total, killed, survived, timed out, without coverage, and the score, written to
//    reports/mutation/summary.json (the full reports stay in reports/mutation/, not committed).
// 4. --record: the committed record, docs/evidence/mutation-testing.json, from the completed runs' reports (below).
// Flags: --group executor-checks,saga (only those groups), --summary-only (re-summarise the last run's reports),
// --no-proof (Stryker only), --no-stryker (the verifier only), --record (write the record only; runs nothing).

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
    // A file split over several groups by line range (the approval groups) adds up over them.
    for (const [f, v] of Object.entries(report.files)) files[f] = [...(files[f] ?? []), ...v.mutants.map((m) => m.status)];
  }
  const all = count(Object.values(files).flat());
  const proof = existsSync(PROOF_REPORT) ? JSON.parse(readFileSync(PROOF_REPORT, "utf8")) as { total: number; killed: number; timeout: number; survived: number; score: number } : null;
  const summary = { stryker: { version: STRYKER_VERSION, all, files: Object.fromEntries(Object.entries(files).map(([f, st]) => [f, count(st)])) }, proof_verifier: proof && { total: proof.total, killed: proof.killed, timeout: proof.timeout, survived: proof.survived, score: proof.score } };
  writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

// The committed record (docs/evidence/mutation-testing.json), written by --record from the reports of completed runs only:
// reports/mutation/<group>.before.json (the run before the group's mutation-kills tests) and <group>.after.json (the
// incremental run after them), and the classification of every mutant left (scripts/mutation-survivors.json, keyed by
// file:line:column|mutator|replacement). A group with no completed run is listed as not run; nothing is carried over.
export const RECORD = "docs/evidence/mutation-testing.json";
export const CLASSES = "scripts/mutation-survivors.json";
export const MEASURED = "2026-11-20";

interface FullMutant extends StrykerMutant { id: string; location: { start: { line: number; column: number }; end: { line: number; column: number } } }
interface FullReport { files: Record<string, { source: string; mutants: FullMutant[] }>; testFiles?: Record<string, unknown> }
type Class = { class: "equivalent" | "unreachable" | "uncovered" | "real defect"; why: string };

export const mutantKey = (file: string, m: FullMutant): string => `${file}:${m.location.start.line}:${m.location.start.column}|${m.mutatorName}|${m.replacement ?? ""}`;

function original(source: string, m: FullMutant): string {
  const lines = source.split("\n");
  const { start, end } = m.location;
  const text = start.line === end.line ? lines[start.line - 1]!.slice(start.column - 1, end.column - 1) : `${lines[start.line - 1]!.slice(start.column - 1)}…`;
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function groupRecord(name: string, mutate: string[], classes: Record<string, Class>): Record<string, unknown> {
  const read = (phase: string): FullReport | null => {
    const at = join(REPORTS, `${name}.${phase}.json`);
    return existsSync(at) ? JSON.parse(readFileSync(at, "utf8")) as FullReport : null;
  };
  const before = read("before");
  const after = read("after");
  const tests = (r: FullReport | null) => (r?.testFiles ? Object.keys(r.testFiles).map((f) => f.replace(/^.*?(test\/)/, "$1")).sort() : null);
  const counts = (r: FullReport | null) => r && Object.fromEntries(Object.entries(r.files).map(([f, v]) => [f, count(v.mutants.map((m) => m.status))]));
  const left = after && Object.entries(after.files).flatMap(([f, v]) => v.mutants.filter((m) => m.status === "Survived" || m.status === "NoCoverage").map((m) => {
    const c = classes[mutantKey(f, m)];
    return { file: f, line: m.location.start.line, status: m.status, mutator: m.mutatorName, original: original(v.source, m), replacement: (m.replacement ?? "").slice(0, 140), class: c?.class ?? "not classified", why: c?.why ?? "" };
  }));
  const testsBefore = tests(before);
  const testsAfter = tests(after);
  return {
    status: after ? "complete" : before ? "before only: the run after the new tests did not finish" : "not run",
    command: `MUTATION_INCREMENTAL=1 npm run mutation -- --group ${name} --no-proof`,
    mutate,
    tests_before: testsBefore,
    tests_added: testsAfter && testsBefore ? testsAfter.filter((t) => !testsBefore.includes(t)) : null,
    before: counts(before),
    after: counts(after),
    left_after: left,
  };
}

function writeRecord(groups: Record<string, { mutate: string[] }>, names: string[]): void {
  const classes = existsSync(CLASSES) ? JSON.parse(readFileSync(CLASSES, "utf8")) as Record<string, Class> : {};
  const old = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) as Record<string, unknown> : {};
  const made = Object.fromEntries(names.map((g) => [g, groupRecord(g, groups[g]!.mutate, classes)]));
  const done = names.filter((g) => made[g]!.status === "complete");
  const open = names.filter((g) => made[g]!.status !== "complete");
  const unclassified = Object.values(made).flatMap((g) => (g.left_after as { class: string }[] | null) ?? []).filter((s) => s.class === "not classified").length;
  const record = {
    measured: MEASURED,
    tool: { stryker_core: STRYKER_VERSION, vitest_runner: STRYKER_VERSION, vitest: "5.1.0", harness: "scripts/mutation-proof-verifier.ts (51 fixed text mutations)" },
    status: open.length
      ? `partial: ${done.length} of ${names.length} groups measured before and after their new tests (${done.join(", ")}); not finished: ${open.map((g) => `${g} (${made[g]!.status})`).join(", ")}`
      : `complete: all ${names.length} groups measured before and after their new tests`,
    settings: {
      coverage_analysis: "perTest", concurrency: 2, ignore_static: true, mutators: "Stryker defaults", incremental: true, timeout_ms: 20000,
      tests: "every test file that imports a module of the group (stryker.config.mjs importers), plus its mutation-kills file",
      order: "a file that failed in the last run first, then the fastest (vitest.mutation.config.ts); the order changes run time, not results",
    },
    unclassified_left: unclassified,
    groups: made,
    earlier: { note: "19 November, narrow test lists, before the new tests; not re-run on 20 November", verifier: (old.earlier as Record<string, unknown> | undefined)?.verifier ?? (old.groups as Record<string, unknown> | undefined)?.verifier, payee: (old.earlier as Record<string, unknown> | undefined)?.payee ?? (old.groups as Record<string, unknown> | undefined)?.payee },
    proof_verifier: old.proof_verifier,
  };
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${RECORD}: ${record.status}; ${unclassified} mutants left unclassified`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv);
  const { GROUPS } = (await import(pathToFileURL(resolve("stryker.config.mjs")).href)) as { GROUPS: Record<string, { mutate: string[] }> };
  if (flags.has("--record")) {
    // The groups of 20 November's run: all but the two measured on 19 November (verifier, payee), kept under "earlier".
    writeRecord(GROUPS, Object.keys(GROUPS).filter((g) => g !== "verifier" && g !== "payee"));
    return;
  }
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
