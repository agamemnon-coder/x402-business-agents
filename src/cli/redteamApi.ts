// npm run redteam:api [-- --no-write] [-- --out <dir>]
// The red team v2 on the public /try API, on this computer only: the judge's offline server (npm run judge) and a stand-in
// for the hosted edge (src/redteamApi/net.ts), attacked over HTTP (src/redteamApi/attacks.ts): cross-company access,
// signature replay, another world's passkey, terms tampering at every step, double pay, rate limits, the admin route,
// CSRF and origin, malformed bodies, prompt injection through the reader's stand-in mode, path traversal, open
// redirects and the headers of every route. Each attack: expected, actual, PASS or FAIL.
// Writes docs/evidence/redteam-api.md and .json (unless --no-write), or into <dir> with --out (the nightly run,
// .github/workflows/nightly-evidence.yml: the committed evidence is left alone). Exit 1 when any attack is FAIL or ERROR: a finding,
// never hidden. No request leaves this machine (the npm script loads test/support/no-network.cjs as well).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHECK_PATHS, startJudge } from "./judge.js";
import { runAttacks, type AttackResult } from "../redteamApi/attacks.js";
import { edgeServer, loopbackAliases } from "../redteamApi/net.js";
import { reportMarkdown, reportOf } from "../redteamApi/report.js";

const ROOT = resolve(import.meta.dirname, "../..");
export const REDTEAM_API_OUT = "docs/evidence/redteam-api";

/** Both servers up, every attack run, both closed again. */
export async function redteamApi(log: (r: AttackResult) => void = () => {}): Promise<AttackResult[]> {
  const j = await startJudge(0);
  const edge = await edgeServer({ own_upload: "on" });
  try {
    const judge = { name: "judge" as const, base: j.url, origin: j.url, rpId: "localhost" };
    const e = { name: "edge" as const, base: edge.base, origin: edge.origin, rpId: "localhost" };
    return await runAttacks({ judge, edge: e, edgeServer: edge, pagePaths: CHECK_PATHS, aliases: await loopbackAliases(edge.base), log });
  } finally {
    j.server.closeAllConnections();
    j.server.close();
    await edge.close();
  }
}

if (process.argv[1]?.endsWith("redteamApi.ts")) {
  // Purser Cloud logs each request as a JSON line (cloud/src/log.ts); only its errors are shown here (the attacks make many refusals).
  const print = console.log.bind(console);
  console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"ts":')) return; print(...a); };
  console.warn = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith('{"ts":')) return; print(...a); };
  const write = !process.argv.includes("--no-write");
  const results = await redteamApi((r) => console.log(`${r.verdict.padEnd(5)} ${r.group.padEnd(24)} ${r.id}  ${r.actual.slice(0, 160)}`));
  const report = reportOf(results, new Date().toISOString().slice(0, 10));
  const t = report.totals;
  console.log(`\n${t.attacks} attacks: ${t.pass} PASS, ${t.fail} FAIL, ${t.error} ERROR`);
  if (write) {
    const outDir = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : undefined; })();
    const base = outDir ? join(resolve(outDir), "redteam-api") : join(ROOT, REDTEAM_API_OUT);
    if (outDir) mkdirSync(resolve(outDir), { recursive: true });
    writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(`${base}.md`, reportMarkdown(report));
    console.log(`written: ${base}.md and .json`);
  }
  process.exit(t.fail || t.error ? 1 : 0);
}
