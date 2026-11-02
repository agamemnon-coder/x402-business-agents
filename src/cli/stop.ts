// npm run stop -- <world | ledger path> [--grace <seconds>]: stops exactly that world's run, and nothing else.
//   npm run stop -- live-1                 the world whose ledger is data/live-1.sqlite
//   npm run stop -- /path/to/world.sqlite  a ledger by its path
// The world's runner lock (src/ops/runnerLock.ts) names its process group; every process in it must carry the lock's run
// token, or nothing is signalled. SIGTERM to that group, a wait (--grace, default 90 s: a running execution finishes
// first), SIGKILL to the same group only if it is still there, then a check with ps that nothing of it is left, and
// the lock is removed. Exit 0 only when the world is verifiably stopped (or was not running).

import { hostname } from "node:os";
import { resolve } from "node:path";
import { osProcesses, ownPgid } from "../ops/processes.js";
import { stopWorld } from "../ops/stopWorld.js";

const args = process.argv.slice(2);
const g = args.indexOf("--grace");
const grace = g >= 0 ? Number(args[g + 1]) : 90;
const target = args.filter((a, i) => !a.startsWith("--") && !(g >= 0 && i === g + 1))[0];
if (!target || !Number.isFinite(grace) || grace < 0) {
  console.error("usage: npm run stop -- <world, e.g. live-1 | ledger path> [--grace <seconds>]");
  process.exit(2);
}
// A bare name is a world under data/; a path (with a slash, or ending in .sqlite) is a ledger. Never a default.
const ledger = /[/\\]|\.sqlite$/.test(target) ? resolve(process.cwd(), target) : resolve(import.meta.dirname, "../../data", `${target}.sqlite`);
const at = () => new Date().toISOString().slice(11, 19);
const r = await stopWorld(ledger, {
  table: osProcesses, host: hostname(), ownPgid: ownPgid(),
  sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), now: () => Date.now(),
  log: (line) => console.log(`${at()} stop     ${line}`),
  graceMs: grace * 1000,
});
console.log(`${at()} ${r.ok ? "STOPPED " : "NOT DONE"} ${r.message}`);
process.exit(r.ok ? 0 : 1);
