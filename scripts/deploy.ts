// npm run deploy: the documented, repeatable deploy of both Workers (ASVS 4.0.3 V1.14.4, V14.1.1; docs/runbook.md,
// "Deploy"). Run by the owner on their own computer with their wrangler login; it holds no secret and prints none.
//
// 1. Refuses a tree with uncommitted changes, or a commit that is not on origin/main (after fetching it).
// 2. Deploys purser-try (cloud/wrangler.try.jsonc), then kit11 (npm run relay:deploy), each with the commit's short sha
//    and the build time stamped in as Worker vars (GIT_SHA, BUILT_AT): never secrets.
// 3. Checks each live health answer (purser-try /v1/health, kit11 /health) until it reports that commit (a minute at
//    most), and that it carries the baseline security headers. Exits non-zero on any refusal or failed check.
//
// npm run deploy -- --check-only: only step 3, against the commit checked out (to check what is live).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

export interface Target { name: string; config: string; health: string }
export const TARGETS: Target[] = [
  { name: "purser-try", config: "cloud/wrangler.try.jsonc", health: "/v1/health" },
  { name: "kit11", config: "worker/wrangler.jsonc", health: "/health" },
];
/** Headers every answer of both Workers carries (cloud/src/baseHeaders.ts, worker/src/core.ts COMMON_HEADERS). */
export const BASELINE_HEADERS = ["strict-transport-security", "x-content-type-options"];

const short = (sha: string) => sha.slice(0, 12);

/** Why this tree may not be deployed, or null. */
export function deployRefusal(a: { dirty: string[]; sha: string; onOriginMain: boolean }): string | null {
  if (!/^[0-9a-f]{40}$/.test(a.sha)) return "no commit checked out";
  if (a.dirty.length) return `the tree has uncommitted changes (${a.dirty.slice(0, 3).join("; ")}): commit them to main first`;
  if (!a.onOriginMain) return `commit ${short(a.sha)} is not on origin/main: deploy only what was merged`;
  return null;
}

/** The wrangler arguments that stamp the commit and the build time into a Worker. */
export function stampArgs(sha: string, now: Date): string[] {
  return ["--var", `GIT_SHA:${short(sha)}`, "--var", `BUILT_AT:${now.toISOString()}`];
}

/** What is wrong with a live health answer for this commit; empty when it is right. */
export function liveProblems(r: { status: number; headers: Headers; body: unknown }, sha: string): string[] {
  const out: string[] = [];
  const got = (r.body as { build?: { sha?: unknown } } | null)?.build?.sha;
  if (typeof got !== "string" || !got) out.push("the live health reports no commit (build.sha)");
  else if (got !== short(sha)) out.push(`the live health reports ${got}, not ${short(sha)}`);
  for (const h of BASELINE_HEADERS) if (!r.headers.get(h)) out.push(`the live answer lacks ${h}`);
  return out;
}

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" });

/** The Worker's own address, from its config (ORIGIN) or, for kit11, its workers.dev address. */
async function originOf(t: Target): Promise<string> {
  if (t.name === "kit11") return (await import("../src/relay/config.js")).relayConfig().then((c) => c.url);
  const text = readFileSync(t.config, "utf8");
  const m = /"ORIGIN"\s*:\s*"(https:\/\/[^"]+)"/.exec(text);
  if (!m) throw new Error(`${t.config} names no ORIGIN`);
  return m[1]!;
}

async function checkLive(t: Target, sha: string): Promise<string[]> {
  const url = `${await originOf(t)}${t.health}`;
  let problems: string[] = ["not reached"];
  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
      problems = liveProblems({ status: res.status, headers: res.headers, body: await res.json().catch(() => null) }, sha);
    } catch (e) { problems = [`${url}: ${e instanceof Error ? e.message : String(e)}`]; }
    if (!problems.length) return [];
    await new Promise((r) => setTimeout(r, 5000));
  }
  return problems.map((p) => `${t.name}: ${p}`);
}

if (process.argv[1]?.endsWith("deploy.ts")) {
  const checkOnly = process.argv.includes("--check-only");
  const sha = git(["rev-parse", "HEAD"]).stdout.trim();
  if (!checkOnly) {
    git(["fetch", "--quiet", "origin", "main"]);
    const refusal = deployRefusal({
      dirty: git(["status", "--porcelain"]).stdout.split("\n").filter(Boolean),
      sha,
      onOriginMain: git(["merge-base", "--is-ancestor", sha, "origin/main"]).status === 0,
    });
    if (refusal) { console.error(`deploy refused: ${refusal}`); process.exit(2); }
    const stamp = stampArgs(sha, new Date());
    const steps: [string, string[]][] = [
      ["npm", ["run", "cloud:pdfjs"]],
      [process.execPath, ["worker/node_modules/wrangler/bin/wrangler.js", "deploy", "-c", "cloud/wrangler.try.jsonc", ...stamp]],
      ["npx", ["tsx", "src/cli/relay-deploy.ts", ...stamp]],
    ];
    for (const [cmd, args] of steps) {
      const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
      if (r.status !== 0) { console.error(`deploy stopped: ${cmd} ${args.slice(0, 3).join(" ")} failed (exit ${r.status})`); process.exit(1); }
    }
  }
  const problems = (await Promise.all(TARGETS.map((t) => checkLive(t, sha)))).flat();
  for (const p of problems) console.error(`post-deploy check: ${p}`);
  if (problems.length) process.exit(1);
  console.log(`live: ${TARGETS.map((t) => t.name).join(" and ")} at ${short(sha)}, baseline headers served`);
}
