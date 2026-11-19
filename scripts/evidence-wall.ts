// npm run evidence:wall: /proof's evidence wall, every figure read from its committed record
// (src/redesign/evidenceWallData.ts), into docs/evidence/evidence-wall.json, which /proof renders. Run it again after a
// new record (a new recording of the /try walks under docs/runs is added up with the others); test/evidence-wall.test.ts
// fails while the file is behind its records.
// It also rewrites llms.txt's section "## The evidence wall, from the records" from the same file.
import { readFileSync, writeFileSync } from "node:fs";
import { evidenceWall, evidenceWallFile } from "../src/redesign/evidenceWallData.js";
import { WALL_FILE, evidenceWallLlms, withWallSection } from "../src/redesign/evidenceWall.js";

const wall = evidenceWall();
writeFileSync(WALL_FILE, evidenceWallFile(wall));
writeFileSync("llms.txt", withWallSection(readFileSync("llms.txt", "utf8"), evidenceWallLlms(wall)));
console.log(`wrote ${WALL_FILE} and llms.txt's evidence section`);
