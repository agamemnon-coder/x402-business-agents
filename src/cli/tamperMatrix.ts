// npm run tamper-matrix [-- --no-write] [-- --no-cli]
// Every signed receipt and proof bundle committed in the repository, each signed field changed by the smallest step,
// every changed copy run through the verifier (src/proof/tamperMatrix.ts says which changes and how). Expected: each
// original verifies and every changed copy is refused. Offline, no keys. Writes docs/evidence/tamper-matrix.md and .json
// (unless --no-write); --no-cli skips running the command line itself on each original and its first changed copy.
// Exit 1 when any changed copy is accepted or any original does not verify: that is a finding, never hidden.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyChange, contentKey, findSigned, matrixMarkdown, tamperArtifact, termChanges, totalsOf, type ArtifactResult, type CliCheck, type Found, type Matrix } from "../proof/tamperMatrix.js";

const ROOT = resolve(import.meta.dirname, "../..");
export const MATRIX_OUT = "docs/evidence/tamper-matrix";
/** Generated reports: never searched for artifacts (they hold none, and reading them back would make the run depend on the last one). */
const OWN = [`${MATRIX_OUT}.json`, "docs/evidence/airwallex-api-coverage.json"];

/** Every signed artifact in a JSON file git tracks, each distinct one once, with the other places it appears. */
export function committedArtifacts(): { file: string; found: Found; alsoAt: string[] }[] {
  const files = execFileSync("git", ["ls-files", "-z", "--", "*.json"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter((f) => f && !OWN.includes(f)).sort();
  const seen = new Map<string, { file: string; found: Found; alsoAt: string[] }>();
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    if (!text.includes("purser.try-sign-receipt/v1") && !text.includes("purser.proof-bundle/v1")) continue;
    let json: unknown;
    try { json = JSON.parse(text); } catch { continue; }
    for (const found of findSigned(json)) {
      const k = contentKey(found.value), here = found.at === "$" ? f : `${f} (${found.at})`;
      const prev = seen.get(k);
      if (prev) prev.alsoAt.push(here);
      else seen.set(k, { file: f, found, alsoAt: [] });
    }
  }
  // A standalone file names the artifact before a record that embeds it.
  return [...seen.values()].map((x) => {
    if (x.found.at === "$") return x;
    const top = x.alsoAt.find((p) => !p.includes(" ("));
    if (!top) return x;
    return { file: top, found: { ...x.found, at: "$" }, alsoAt: [`${x.file} (${x.found.at})`, ...x.alsoAt.filter((p) => p !== top)] };
  }).sort((a, b) => a.file.localeCompare(b.file) || a.found.at.localeCompare(b.found.at));
}

/** The command line on the original and on its first changed copy: verify-receipt or verify-bundle, as a judge runs it. */
function cliChecks(a: ArtifactResult, found: Found): CliCheck[] {
  const script = found.kind === "receipt" ? "verifyReceipt.ts" : "verifyBundle.ts", cmd = found.kind === "receipt" ? "verify-receipt" : "verify-bundle";
  const dir = mkdtempSync(join(tmpdir(), "tamper-"));
  try {
    const run = (file: string) => spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli", script), file], { cwd: ROOT, encoding: "utf8", timeout: 120_000 }).status;
    const orig = join(dir, "original.json"), changed = join(dir, "changed.json");
    writeFileSync(orig, JSON.stringify(found.value));
    // One cent more on the amount, as a forger would try first; any first change where the terms carry no amount.
    const changes = termChanges(found.value.terms as Record<string, unknown>);
    const first = changes.find((c) => c.path.length === 1 && c.path[0] === "amount" && c.change === "+0.01") ?? changes[0]!;
    writeFileSync(changed, JSON.stringify(applyChange(found.value, first, "hash recomputed")));
    const label = a.at === "$" ? a.file : `${a.file} (${a.at})`;
    return [
      { file: label, what: `npm run ${cmd} on the original`, exit: run(orig), expected: 0 },
      { file: label, what: `npm run ${cmd} on terms.${first.path.join(".")} ${first.change}, hash recomputed`, exit: run(changed), expected: 1 },
    ];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function buildMatrix(withCli: boolean): Promise<Matrix> {
  const list = committedArtifacts();
  const artifacts: ArtifactResult[] = [];
  const cli: CliCheck[] = [];
  for (const x of list) {
    const r = await tamperArtifact(x.file, x.found, x.alsoAt);
    artifacts.push(r);
    if (withCli) cli.push(...cliChecks(r, x.found));
  }
  return { artifacts, totals: totalsOf(artifacts), cli };
}

if (process.argv[1]?.endsWith("tamperMatrix.ts")) {
  const m = await buildMatrix(!process.argv.includes("--no-cli"));
  for (const a of m.artifacts) console.log(`${a.original.ok ? "verifies" : "NOT VALID"}  ${a.kind.padEnd(7)} ${a.at === "$" ? a.file : `${a.file} (${a.at})`}: ${a.tried} changes, ${a.refused} refused, ${a.accepted} accepted`);
  for (const c of m.cli) console.log(`${c.exit === c.expected ? "ok  " : "FAIL"}  exit ${c.exit} (expected ${c.expected})  ${c.what}  ${c.file}`);
  const t = m.totals;
  console.log(`\n${t.artifacts} artifacts (${t.originalsValid} verify), ${t.tried} changed copies tried, ${t.refused} refused, ${t.accepted} accepted.`);
  const bad = t.accepted > 0 || t.originalsValid !== t.artifacts || m.cli.some((c) => c.exit !== c.expected);
  if (bad) console.log("FINDING: a changed copy was accepted, an original did not verify, or the command line disagreed. See the report.");
  if (!process.argv.includes("--no-write")) {
    writeFileSync(join(ROOT, `${MATRIX_OUT}.json`), `${JSON.stringify(m, null, 2)}\n`);
    writeFileSync(join(ROOT, `${MATRIX_OUT}.md`), `${matrixMarkdown(m)}\n`);
    console.log(`wrote ${MATRIX_OUT}.md and .json`);
  }
  process.exit(bad ? 1 : 0);
}
