// npm run compliance:controls: renders the control map (src/compliance/controls.ts, the single source) to
// docs/compliance/controls.md, the third-party register (docs/compliance/third-parties.json) to third-parties.md, and
// the generated blocks of docs/compliance/README.md (the dashboard) and docs/compliance/gdpr.md (the record of
// processing). The tests fail when a file is behind its source.
import { readFileSync, writeFileSync } from "node:fs";
import { controlsMarkdown, dashboardMarkdown, frameworksBlock, replaceBlock } from "../compliance/controls.js";
import { ropaMarkdown } from "../compliance/gdpr.js";
import { retentionBlock } from "../compliance/retention.js";
import { registerMarkdown } from "../compliance/thirdParties.js";

writeFileSync("docs/compliance/controls.md", controlsMarkdown());
writeFileSync("docs/compliance/third-parties.md", registerMarkdown());
for (const [file, name, block] of [["docs/compliance/README.md", "dashboard", dashboardMarkdown()], ["docs/compliance/gdpr.md", "ropa", ropaMarkdown()], ["docs/compliance/retention.md", "retention", retentionBlock()], ["docs/governance.md", "frameworks", frameworksBlock()], ["docs/compliance.md", "frameworks", frameworksBlock()]] as const) {
  writeFileSync(file, replaceBlock(readFileSync(file, "utf8"), name, block));
}
console.log("docs/compliance/controls.md, third-parties.md, README.md (dashboard), gdpr.md (record of processing)");
