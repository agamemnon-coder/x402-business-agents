// npm run airwallex:coverage [-- --no-write] [-- --sites]
// The Airwallex API coverage table: every distinct Airwallex endpoint the code calls (a static scan), each marked LIVE
// (a committed run record holds a call to it, with the first date and record), TESTED ONLY (a test names it) or CODE
// ONLY. Offline, no keys, no network: it reads the files git tracks and the API trail (src/airwallex/apiTrail.ts).
// Writes docs/evidence/airwallex-api-coverage.md and .json (unless --no-write). --sites prints every call site found.
// The rules are in src/proof/awxCoverage.ts and tested in test/airwallex-coverage.test.ts.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { apiTrail } from "../airwallex/apiTrail.js";
import { classify, coverageMarkdown, normalizePath, parseJsonl, recordMentions, scanCode, scanTest, type LiveMention, type Scan, type TestHit, type Verb } from "../proof/awxCoverage.js";

const ROOT = resolve(import.meta.dirname, "../..");
export const COVERAGE_OUT = "docs/evidence/airwallex-api-coverage";

/** The files git tracks, so the scan is the same on every checkout (no build output, no local files). */
const tracked = (): string[] => execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

export const SOURCE_ROOTS = ["src/", "cloud/src/", "worker/src/", "scripts/"];
export const RECORD_ROOTS = ["docs/runs/", "docs/evidence/", "docs/demo/"];
/** This report's own output: never read back as a record. */
const OWN = [`${COVERAGE_OUT}.json`, "docs/evidence/tamper-matrix.json"];

export function buildCoverage() {
  const files = tracked();
  const isTest = (f: string) => /\.test\.ts$/.test(f) || f.startsWith("test/") || /\/test\//.test(f);
  const sources = files.filter((f) => SOURCE_ROOTS.some((r) => f.startsWith(r)) && f.endsWith(".ts") && !f.endsWith(".d.ts") && !isTest(f));
  // This report's own test is left out: its fixtures name endpoints on purpose, to test the rules, and would count as tests.
  const tests = files.filter((f) => (f.startsWith("test/") || /\.test\.ts$/.test(f)) && f.endsWith(".ts") && !f.startsWith("docs/") && f !== "test/airwallex-coverage.test.ts");
  const records = files.filter((f) => RECORD_ROOTS.some((r) => f.startsWith(r)) && /\.(json|jsonl)$/.test(f) && !OWN.includes(f));

  const scan: Scan = { sites: [], dynamic: [] };
  for (const f of sources) { const s = scanCode(read(f), f); scan.sites.push(...s.sites); scan.dynamic.push(...s.dynamic); }
  const hits: TestHit[] = tests.flatMap((f) => scanTest(read(f), f));

  // The API trail is the project's own reading of the run records it knows (it also folds the read-back's ids into
  // paths and names the VIC record's /pa/{id}/{id} as the PaymentIntent it was): its reading is used for those records,
  // and the generic one (recordMentions) for every other record.
  const trail = apiTrail().runs;
  const trailRecords = new Set(trail.map((r) => r.record));
  const live: LiveMention[] = [];
  for (const r of trail) for (const c of r.calls) {
    const path = normalizePath(c.path);
    if (!path || c.path.includes("{kind}")) continue;
    live.push({ method: c.method as Verb, path, record: r.record, at: c.at ?? r.iso, how: `the API trail (${r.key})` });
  }
  for (const f of records.filter((x) => !trailRecords.has(x))) {
    const text = read(f);
    const values = f.endsWith(".jsonl") ? parseJsonl(text) : (() => { try { return [JSON.parse(text) as unknown]; } catch { return []; } })();
    for (const v of values) live.push(...recordMentions(v, f));
  }
  return { coverage: classify(scan, hits, live, { sourceFiles: sources.length, testFiles: tests.length, records: records.length }), scan };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("airwallexCoverage.ts")) {
  const { coverage: c, scan } = buildCoverage();
  if (process.argv.includes("--sites")) for (const s of [...scan.sites].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) console.log(`${s.file}:${s.line}  ${s.method} ${s.path}  (${s.how})`);
  for (const e of c.endpoints) console.log(`${e.status.padEnd(11)}  ${e.endpoint.padEnd(52)} ${e.firstLive ? `${e.firstLive.date} ${e.firstLive.record}` : e.firstTest ?? ""}`);
  const t = c.totals;
  console.log(`\n${t.endpoints} endpoints: ${t.live} LIVE (sandbox), ${t.testedOnly} TESTED ONLY, ${t.codeOnly} CODE ONLY; ${t.dynamicSites} dynamic call sites; ${c.recordsOnly.length} endpoints in records not found by the scan.`);
  if (!process.argv.includes("--no-write")) {
    writeFileSync(join(ROOT, `${COVERAGE_OUT}.json`), `${JSON.stringify(c, null, 2)}\n`);
    writeFileSync(join(ROOT, `${COVERAGE_OUT}.md`), `${coverageMarkdown(c)}\n`);
    console.log(`wrote ${COVERAGE_OUT}.md and .json`);
  }
}
