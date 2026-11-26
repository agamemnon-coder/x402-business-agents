// npm run compliance:controls: renders the control map (src/compliance/controls.ts, the single source) to
// docs/compliance/controls.md. test/compliance-controls.test.ts fails when the file is behind its source.
import { writeFileSync } from "node:fs";
import { controlsMarkdown } from "../compliance/controls.js";

writeFileSync("docs/compliance/controls.md", controlsMarkdown());
console.log("docs/compliance/controls.md");
