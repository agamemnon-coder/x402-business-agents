// npm run evidence:wall: /proof's evidence wall, every figure read from its committed record
// (src/redesign/evidenceWallData.ts), into docs/evidence/evidence-wall.json, which /proof renders. Run it again after a
// new record (a new recording of the /try walks under docs/runs is added up with the others); test/evidence-wall.test.ts
// fails while the file is behind its records.
import { writeFileSync } from "node:fs";
import { evidenceWallFile } from "../src/redesign/evidenceWallData.js";
import { WALL_FILE } from "../src/redesign/evidenceWall.js";

writeFileSync(WALL_FILE, evidenceWallFile());
console.log(`wrote ${WALL_FILE}`);
