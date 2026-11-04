// npm run agent -- <sourcing|support|treasury> [--once]: one autonomous agent's loop, as its own process (D19). It wakes
// every few seconds to see whether anything reached it (a world event, a message from another agent) or its routine
// check is due; then it decides with Claude, within its tools, and each decision is one labelled row in the ledger.
// Needs KIT11_AUTONOMY=on and KIT11_AGENTS=on. Stops on SIGTERM after the wake in progress.

import { openDb } from "../db/open.js";
import { autonomyOn } from "../config/agents.js";
import { wake, worldReady, type AgentProfile } from "../autonomy/runtime.js";
import { liveSourcingWorld, sourcingProfile } from "../autonomy/sourcingProfile.js";
import { supportProfile, treasuryProfile } from "../autonomy/teamProfiles.js";
import { redactSecrets } from "../lib/redact.js";
import type { AgentName } from "../autonomy/bus.js";

const name = process.argv[2] as AgentName;
const once = process.argv.includes("--once");
if (!["sourcing", "support", "treasury"].includes(name)) { console.error("usage: npm run agent -- <sourcing|support|treasury> [--once]"); process.exit(2); }
if (!autonomyOn()) { console.error("the autonomous agents are off: set KIT11_AUTONOMY=on and KIT11_AGENTS=on"); process.exit(2); }
const db = openDb();
const tick = Number(process.env.KIT11_AGENT_TICK_MIN ?? "10") * 60_000;
const profile: AgentProfile = name === "sourcing" ? sourcingProfile(liveSourcingWorld(db), tick) : name === "treasury" ? treasuryProfile(tick * 3) : supportProfile(tick * 3);
const stamp = () => new Date().toISOString().slice(11, 19);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
console.log(`${stamp()} ${name} agent awake (${profile.model}); routine check every ${Math.round(profile.tickMs / 60_000)} min`);
let said = false;
while (!stopping) {
  // Before bootstrap there are no accounts or mandates to read: wait quietly instead of failing every few seconds.
  if (!worldReady(db)) {
    if (!said) { console.log(`${stamp()} ${name} waits until the world is set up (the three mandates bound)`); said = true; }
    if (once) break;
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }
  try {
    const w = await wake(db, profile);
    if (w) console.log(`${stamp()} ${name} ${w.source === "claude" ? "decided" : w.source}: ${redactSecrets(w.summary).slice(0, 300)}`);
  } catch (e) {
    console.log(`${stamp()} ${name} wake failed: ${redactSecrets((e as Error).message).slice(0, 300)}`);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(`${stamp()} ${name} agent stopped`);
