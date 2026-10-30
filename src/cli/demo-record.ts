// npm run demo:record -- "<run name>": records the demo story (K5 replay) from the ledger (KIT11_DB) into
// docs/demo/story.json, and the CFO dashboard as it stood (with the landing page's figures) into docs/demo/snapshot.json. The public demo page (/demo) plays that file back, so the demo never depends on a live run.
// Only public facts are recorded (src/demo/story.ts); the file is committed and scanned like any other.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { buildStory } from "../demo/story.js";
import { buildRecorded } from "../demo/recorded.js";
import { oldNamesIn } from "../demo/oldNames.js";

const run = process.argv[2] ?? "recorded run";
const story = buildStory(openDb(), run);
// Guests see only the Northwind runs: a ledger that still carries the earlier example company is not recorded.
const old = oldNamesIn(JSON.stringify(story) + JSON.stringify(buildRecorded(openDb(), run)));
if (old.length) {
  console.error(`not recorded: this ledger shows names from before the rename (${old.join(", ")}); record a Northwind run`);
  process.exit(1);
}
const out = resolve(import.meta.dirname, "../../docs/demo/story.json");
writeFileSync(out, JSON.stringify(story, null, 2) + "\n");
console.log(`recorded ${story.steps.length} steps (${story.steps.map((s) => s.id).join(", ")}) from ${story.audit.rows} audit rows into docs/demo/story.json`);
const recorded = buildRecorded(openDb(), run);
writeFileSync(resolve(import.meta.dirname, "../../docs/demo/snapshot.json"), JSON.stringify(recorded, null, 2) + "\n");
console.log(`recorded the dashboard (${recorded.snapshot.feed.length} activity rows) and the landing figures ${JSON.stringify(recorded.proof)} into docs/demo/snapshot.json`);
