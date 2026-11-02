// A harmless stand-in for a world's runner (test/runner-stop-real.test.ts): it becomes its world's own process group
// as relay.ts and up.ts do, takes the ledger's runner lock, starts a child in its group (as the runner starts the
// agents), and then only waits. It moves nothing and reaches no network.
import { spawn } from "node:child_process";
import { openDb } from "../../src/db/open.js";
import { osProcesses } from "../../src/ops/processes.js";
import { asWorldGroup, holdRunnerLock } from "../../src/ops/runnerLock.js";

const group = await asWorldGroup(() => undefined);
const db = openDb();
holdRunnerLock(db, db.name, "relay", group, osProcesses);
spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.on("SIGTERM", () => process.exit(0));
console.log(`READY ${process.pid} ${group.pgid}`);
setInterval(() => undefined, 1000);
