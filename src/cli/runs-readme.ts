// Writes docs/runs/README.md, the list of live runs, from the records (src/redesign/runs.ts). test/runs-page.test.ts
// fails when the file and the records disagree.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runsReadme } from "../redesign/runs.js";

writeFileSync(resolve(import.meta.dirname, "../../docs/runs/README.md"), runsReadme());
console.log("wrote docs/runs/README.md");
