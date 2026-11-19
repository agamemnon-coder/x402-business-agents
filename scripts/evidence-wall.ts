// npm run evidence:wall: /proof's evidence wall, every figure read from its committed record
// (src/redesign/evidenceWallData.ts), into docs/evidence/evidence-wall.json, which /proof renders. Run it again after a
// new record (a new recording of the /try walks under docs/runs is added up with the others); test/evidence-wall.test.ts
// fails while the file is behind its records.
// It also draws the README's evidence map (docs/assets/readme/evidence-map-*.svg), rewrites its line under the judge path and llms.txt's section "## The evidence wall, from the records" from the same file.
import { readFileSync, writeFileSync } from "node:fs";
import { evidenceWall, evidenceWallFile } from "../src/redesign/evidenceWallData.js";
import { WALL_FILE, evidenceWallLlms, readmeWallLine, withReadmeWallLine, withWallSection } from "../src/redesign/evidenceWall.js";
import { README_MAP_FILES, evidenceMapSvgFile, readmeMapLine } from "../src/redesign/evidenceMap.js";

const wall = evidenceWall();
writeFileSync(WALL_FILE, evidenceWallFile(wall));
writeFileSync("llms.txt", withWallSection(readFileSync("llms.txt", "utf8"), evidenceWallLlms(wall)));
// The README's evidence map, light and dark, drawn from the file just written (src/redesign/evidenceMap.ts).
for (const theme of ["light", "dark"] as const) writeFileSync(README_MAP_FILES[theme], evidenceMapSvgFile(theme, wall));
writeFileSync("README.md", withReadmeWallLine(readFileSync("README.md", "utf8"), readmeWallLine(wall), readmeMapLine(wall)));
console.log(`wrote ${WALL_FILE}, the README's evidence map (light, dark), its wall line and llms.txt's evidence section`);
