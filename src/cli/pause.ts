// npm run pause -- sync: finishes a pause whose on-chain revoke failed (an RPC error, a restart): every agent the CFO
// paused whose Metal mandate is still bound gets it revoked now. Proposing a pause or a resume goes like any policy
// change (npm run policy -- set pause.<agent> on|off, then Face ID); this command only completes what was approved.
import { openDb } from "../db/open.js";
import { LivePauseChain } from "../metal/pauseChain.js";
import { pausedCredential, syncPauses } from "../policy/pause.js";

const db = openDb();
if (process.argv[2] !== "sync") {
  console.error("usage: npm run pause -- sync");
  process.exit(2);
}
const done = await syncPauses(db, new LivePauseChain(() => "resume-sync", (agent) => pausedCredential(db, agent)));
console.log(done.length ? `revoked on chain: ${done.join(", ")}` : "nothing to do: every paused agent's mandate is already revoked");
