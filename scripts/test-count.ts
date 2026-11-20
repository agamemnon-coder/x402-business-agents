// The suite's count in one place: docs/assets/test-summary.json, written from a full run's own vitest report by
// `npm run readme-draft -- --tests <vitest json>`. The site's stats band (src/redesign/scale.ts) reads it; this script
// writes the same number into the README (its line under "Verify it yourself"; since 13 Nov the README has no tests
// badge, only CI, license and live demo), docs/claims.md's Tests row (the old value goes to its history) and
// docs/submission/demo-day.md, so no count is typed by hand, and completes the summary with what it is a run of (its
// scope, command and machine, below). test/test-count.test.ts fails when they differ.
//   npm run test-count            (writes them)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
export const SUMMARY = "docs/assets/test-summary.json";
export interface Summary {
  total: number; passed: number; failed: number; skipped: number; files: number; commit: string;
  /** What the count is a run of, how it was made and on what machine (since 20 Nov; `described` fills them in). */
  scope?: string; command?: string; environment?: string;
}
export const summary = (root = ROOT): Summary => JSON.parse(readFileSync(resolve(root, SUMMARY), "utf8")) as Summary;

// What this count is a run of (audit, 20 Nov): the full suite, never the coverage run, whose own record
// (docs/evidence/coverage.json, `run`) names its commit, command and machine. `npm run readme-draft -- --tests` writes
// these with the counts, and the machine it runs on; `npm run test-count` fills in a summary written before that, the
// machine then "not recorded" rather than guessed.
export const RUN_SCOPE = "the full suite: every test file vitest.config.ts includes, without coverage; not the coverage run, which is recorded separately in docs/evidence/coverage.json";
export const RUN_COMMAND = "npx vitest run --reporter=json --outputFile.json=<file>, then npm run readme-draft -- --tests <file> and npm run test-count";
export const ENV_NOT_RECORDED = "not recorded: this summary was written before it recorded the machine the run was on";
/** The summary with its scope, command and machine; values it already holds are kept. */
export const described = (s: Summary): Summary => ({ ...s, scope: s.scope ?? RUN_SCOPE, command: s.command ?? RUN_COMMAND, environment: s.environment ?? ENV_NOT_RECORDED });
export const summaryJson = (s: Summary) => `${JSON.stringify(s, null, 2)}\n`;

/** The README's words for the count: "**N tests passing**, S skipped, in F files". */
export const readmeLine = (s: Summary) => `**${s.passed} tests passing**, ${s.skipped} skipped, in ${s.files} files (the last full run, on commit \`${s.commit}\`: [summary](docs/assets/test-summary.json))`;
export const claimsValue = (s: Summary) => `${s.passed} passing, ${s.skipped} skipped (they run only on local D1, \`npm run test:d1\`), in ${s.files} files, on commit \`${s.commit}\` (${SUMMARY})`;

const RE = {
  line: /\*\*\d+ tests (?:passing\*\*, \d+ skipped, in \d+ files \(the last full run, on commit `[0-9a-f]+`: \[summary\]\(docs\/assets\/test-summary\.json\)\)|in \d+ files, all passing\*\*)/,
  claims: /^\| Tests \| [^|]+ \|/m,
  demo: /`npm run verify`; \d+ tests \|/,
};

/** Each file with the summary's count written in; throws when a place to write it is missing. */
export function apply(s: Summary, files: { readme: string; claims: string; demo: string }): { readme: string; claims: string; demo: string } {
  for (const [k, re, text] of [["README line", RE.line, files.readme], ["claims row", RE.claims, files.claims], ["demo-day row", RE.demo, files.demo]] as const)
    if (!re.test(text)) throw new Error(`test-count: no ${k} to write`);
  return {
    readme: files.readme.replace(RE.line, readmeLine(s)),
    claims: withHistory(files.claims, claimsValue(s)),
    demo: files.demo.replace(RE.demo, `\`npm run verify\`; ${s.passed} tests |`),
  };
}

/** The Tests row with the new value; the value it replaces goes first in "The test count, earlier values". */
function withHistory(claims: string, value: string): string {
  const was = RE.claims.exec(claims)![0].replace(/^\| Tests \| /, "").replace(/ \|$/, "");
  const next = claims.replace(RE.claims, `| Tests | ${value} |`);
  if (was === value) return next;
  const head = "Each earlier count, newest first, as it stood:\n\n";
  if (!next.includes(head)) throw new Error("test-count: no \"The test count, earlier values\" section in docs/claims.md");
  return next.replace(head, `${head}- ${was}.\n`);
}

const PATHS = { readme: "README.md", claims: "docs/claims.md", demo: "docs/submission/demo-day.md" } as const;
export const read = (root = ROOT) => ({ readme: readFileSync(resolve(root, PATHS.readme), "utf8"), claims: readFileSync(resolve(root, PATHS.claims), "utf8"), demo: readFileSync(resolve(root, PATHS.demo), "utf8") });

function main(): void {
  const s = described(summary()), out = apply(s, read());
  if (summaryJson(s) !== readFileSync(resolve(ROOT, SUMMARY), "utf8")) writeFileSync(resolve(ROOT, SUMMARY), summaryJson(s));
  for (const k of Object.keys(PATHS) as (keyof typeof PATHS)[]) writeFileSync(resolve(ROOT, PATHS[k]), out[k]);
  console.log(`test-count: ${s.passed} passing, ${s.skipped} skipped, ${s.files} files (commit ${s.commit}) written to ${Object.values(PATHS).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
