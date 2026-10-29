// npm run demo:record -- "<run name>": records the demo story (K5 replay) from the ledger (KIT11_DB) into
// docs/demo/story.json. The public demo page (/demo) plays that file back, so the demo never depends on a live run.
// Only public facts are recorded (src/demo/story.ts); the file is committed and scanned like any other.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { buildStory } from "../demo/story.js";

const run = process.argv[2] ?? "recorded run";
const story = buildStory(openDb(), run);
const out = resolve(import.meta.dirname, "../../docs/demo/story.json");
writeFileSync(out, JSON.stringify(story, null, 2) + "\n");
console.log(`recorded ${story.steps.length} steps (${story.steps.map((s) => s.id).join(", ")}) from ${story.audit.rows} audit rows into docs/demo/story.json`);
