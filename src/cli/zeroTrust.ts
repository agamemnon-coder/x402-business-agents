// npm run zero-trust: runs the zero-trust matrix (test/zero-trust.test.ts) with every key unset, then writes the
// report from what it measured: docs/zero-trust/report.json and docs/zero-trust.md (src/zerotrust/report.ts builds both
// from the model and the run's results; nothing in them is typed).
//
// The files are stable: when the committed files are already what this run generates, the day and the commit aside,
// they are left as they are. `--check` writes nothing and exits 1 when they differ.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { REPORT_JSON, REPORT_MARKDOWN, generate, type MatrixResults } from "../zerotrust/report.js";

/** No live call can be made from the matrix: the keys the rest of the repository reads are taken out of its environment. */
const KEYS = ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY"];
const MATRIX = "test/zero-trust.test.ts";

const root = resolve(import.meta.dirname, "../..");
const check = process.argv.includes("--check");
const read = (path: string) => (existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : null);
const git = (...args: string[]) => { const r = spawnSync("git", args, { cwd: root, encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };

/** The commit the matrix runs on; said so when the tree holds changes that are not committed (the report's own two files aside). */
function commit(): string {
  const head = git("rev-parse", "--short", "HEAD");
  if (!head) return "unknown";
  const dirty = git("status", "--porcelain", "--", ".", `:!${REPORT_JSON}`, `:!${REPORT_MARKDOWN}`);
  return dirty ? `${head} with uncommitted changes` : head;
}

const dir = mkdtempSync(join(tmpdir(), "zero-trust-"));
try {
  const out = join(dir, "results.json");
  const env: NodeJS.ProcessEnv = { ...process.env, ZERO_TRUST_OUT: out };
  for (const k of KEYS) delete env[k];
  // Writing: the committed report is about to be replaced, so the matrix's own comparison with it is skipped.
  if (check) delete env.ZERO_TRUST_REPORT;
  else env.ZERO_TRUST_REPORT = "write";
  const now = { date: new Date().toISOString().slice(0, 10), commit: commit() };
  const ran = spawnSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", MATRIX], { cwd: root, env, stdio: "inherit" });
  if (ran.status !== 0) {
    console.error(check
      ? `zero-trust: the matrix failed (${MATRIX}); its last tests hold the committed report to this run, so read its output above`
      : `zero-trust: the matrix failed (${MATRIX}); no report was written`);
    process.exit(1);
  }
  const results = JSON.parse(readFileSync(out, "utf8")) as MatrixResults;
  const committed = { json: read(REPORT_JSON), markdown: read(REPORT_MARKDOWN) };
  const { changed, files } = generate(results, now, committed);
  const s = results.summary!;
  console.log(`zero-trust: ${s.attacks_run} attacks run, ${s.attacks_stopped} stopped; ${s.layers} layers; minimum depth ${s.minimum_depth}; `
    + `${s.hostile_tool_calls_tried} hostile tool calls, ${s.hostile_tool_calls_refused_by_code} refused by code, ${s.hostile_tool_calls_unsafe_by_ledger_verdict} unsafe by the ledger verdict`);
  if (!changed) {
    console.log(`zero-trust: ${REPORT_MARKDOWN} and ${REPORT_JSON} are up to date; left as they are`);
  } else if (check) {
    const differs = [[REPORT_MARKDOWN, committed.markdown, files.markdown], [REPORT_JSON, committed.json, files.json]].filter(([, a, b]) => a !== b).map(([path]) => path);
    console.error(`zero-trust: the committed report is not what this run generates (${differs.join(", ")}): run npm run zero-trust and commit both files`);
    process.exit(1);
  } else {
    mkdirSync(dirname(resolve(root, REPORT_JSON)), { recursive: true });
    writeFileSync(resolve(root, REPORT_JSON), files.json);
    writeFileSync(resolve(root, REPORT_MARKDOWN), files.markdown);
    console.log(`zero-trust: wrote ${REPORT_MARKDOWN} and ${REPORT_JSON} (matrix run on ${now.date}, at commit ${now.commit})`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
