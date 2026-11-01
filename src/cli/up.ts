// npm run up [-- <relay options>]: the runner for a live run, kept up. First the health checks (chain, finality,
// facilitator, Airwallex, Claude key); then npm run relay with the same ledger (KIT11_DB) and keys
// (KIT11_KEYS_DIR); when the runner stops for any reason it is started again after a short wait, at most
// MAX_RESTARTS times in ten minutes. Ctrl-C stops both. While the runner is down, the dashboard says
// "runner offline" and points to the recorded run, so a demo can carry on.
// Options after -- go to the first start only (e.g. --enrol); restarts never reopen an enrolment window.

import { envWithoutOrigin } from "../provenance/origin.js";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const tsx = resolve(root, "node_modules/.bin/tsx");
const MAX_RESTARTS = 5;
const WINDOW_MS = 10 * 60_000;
const at = () => new Date().toISOString().slice(11, 19);

if (!process.env.KIT11_DB || !process.env.KIT11_KEYS_DIR) {
  console.error("npm run up needs KIT11_DB (the ledger) and KIT11_KEYS_DIR (an absolute keys folder) for the world to run.");
  process.exit(2);
}

console.log(`${at()} up       health checks`);
const health = spawnSync(tsx, [resolve(root, "src/cli/health.ts")], { stdio: "inherit", env: process.env, cwd: root });
if (health.status !== 0) {
  console.error(`${at()} up       a required check failed; the runner is not started. The recorded run stays at /demo.`);
  process.exit(1);
}

let child: ChildProcess | null = null;
let stopping = false;
const starts: number[] = [];
const firstArgs = process.argv.slice(2);

function start(first: boolean): void {
  starts.push(Date.now());
  child = spawn(tsx, [resolve(root, "src/cli/relay.ts"), ...(first ? firstArgs : [])], { stdio: "inherit", env: envWithoutOrigin(), cwd: root });
  console.log(`${at()} up       runner started (pid ${child.pid})`);
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    const recent = starts.filter((t) => Date.now() - t < WINDOW_MS).length;
    if (recent > MAX_RESTARTS) {
      console.error(`${at()} up       the runner stopped ${recent} times in ten minutes (last: ${signal ?? `exit ${code}`}); giving up. The dashboard shows it offline and points to the recorded run.`);
      process.exit(1);
    }
    const wait = Math.min(30_000, 2_000 * 2 ** (recent - 1));
    console.error(`${at()} up       runner stopped (${signal ?? `exit ${code}`}); starting it again in ${wait / 1000} s`);
    setTimeout(() => start(false), wait);
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill("SIGTERM");
    else process.exit(0);
  });
}
start(true);
