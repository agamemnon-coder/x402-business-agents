// npm run evidence:wall: /proof's evidence wall, every figure read from its committed record
// (src/redesign/evidenceWallData.ts), into docs/evidence/evidence-wall.json, which /proof renders. Run it again after a
// new record (a new recording of the /try walks under docs/runs is added up with the others); test/evidence-wall.test.ts
// fails while the file is behind its records.
// It also rewrites the README's wall line (under the proof strip) and llms.txt's section "## The evidence wall, from the
// records" from the same file. 21 Nov 2026 (Max: "the second architecture animation can go"): it no longer draws the
// README's evidence map (docs/assets/readme/evidence-map-*.svg); the map stays on /proof.
import { readFileSync, writeFileSync } from "node:fs";
import { evidenceWall, evidenceWallFile } from "../src/redesign/evidenceWallData.js";
import { WALL_FILE, evidenceWallLlms, readmeWallLine, withReadmeWallLine, withWallSection } from "../src/redesign/evidenceWall.js";

const wall = evidenceWall();
writeFileSync(WALL_FILE, evidenceWallFile(wall));
writeFileSync("llms.txt", withWallSection(readFileSync("llms.txt", "utf8"), evidenceWallLlms(wall)));
writeFileSync("README.md", withReadmeWallLine(readFileSync("README.md", "utf8"), readmeWallLine(wall)));
console.log(`wrote ${WALL_FILE}, the README's wall line and llms.txt's evidence section`);
