// npm run demo:record -- "<run name>": records the demo story (K5 replay) from the ledger (KIT11_DB) into
// docs/demo/story.json, the CFO dashboard as it stood (with the landing page's figures) into docs/demo/snapshot.json, and
// "How Purser uses Metal" (mandates, proofs, the Dispute desk case) into docs/demo/metal.json. The public demo page (/demo) plays that file back, so the demo never depends on a live run.
// Only public facts are recorded (src/demo/story.ts); the file is committed and scanned like any other.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { buildStory } from "../demo/story.js";
import { buildRecorded } from "../demo/recorded.js";
import { oldNamesIn } from "../demo/oldNames.js";
import { metalShowcase } from "../metal/showcase.js";

const run = process.argv[2] ?? "recorded run";
// The recording shows the ledger as it stood at its last entry: the same ledger records the same files, and the time
// on the pages is the run's, not the time someone pressed record.
const last = (openDb().prepare("SELECT MAX(ts) AS t FROM audit_log").get() as { t: string | null }).t;
const now = last ? new Date(new Date(last).getTime() + 1000) : new Date();
const story = buildStory(openDb(), run, now);
// Guests see only the Northwind runs: a ledger that still carries the earlier example company is not recorded.
const old = oldNamesIn(JSON.stringify(story) + JSON.stringify(buildRecorded(openDb(), run, now)) + JSON.stringify(metalShowcase(openDb())));
if (old.length) {
  console.error(`not recorded: this ledger shows names from before the rename (${old.join(", ")}); record a Northwind run`);
  process.exit(1);
}
const out = resolve(import.meta.dirname, "../../docs/demo/story.json");
writeFileSync(out, JSON.stringify(story, null, 2) + "\n");
console.log(`recorded ${story.steps.length} steps (${story.steps.map((s) => s.id).join(", ")}) from ${story.audit.rows} audit rows into docs/demo/story.json`);
const recorded = buildRecorded(openDb(), run, now);
writeFileSync(resolve(import.meta.dirname, "../../docs/demo/snapshot.json"), JSON.stringify(recorded, null, 2) + "\n");
console.log(`recorded the dashboard (${recorded.snapshot.feed.length} activity rows) and the landing figures ${JSON.stringify(recorded.proof)} into docs/demo/snapshot.json`);
const metal = { recorded_at: recorded.recorded_at, run, ...metalShowcase(openDb()) };
writeFileSync(resolve(import.meta.dirname, "../../docs/demo/metal.json"), JSON.stringify(metal, null, 2) + "\n");
console.log(`recorded ${metal.features.length} Metal features, ${metal.mandates.length} mandates and ${metal.dispute ? `case ${metal.dispute.case_id}` : "no dispute case"} into docs/demo/metal.json`);
