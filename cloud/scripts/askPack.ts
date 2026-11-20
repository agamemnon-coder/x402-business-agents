// npm run cloud:ask-pack: Ask Purser's knowledge pack, read from the repository's public docs (src/ask/pack.ts), into
// cloud/src/ask/pack.gen.ts for the Worker. test/cloud-ask.test.ts fails when the file is behind its sources.
import { writeFileSync } from "node:fs";
import { askPackFile } from "../../src/ask/pack.js";

writeFileSync("cloud/src/ask/pack.gen.ts", askPackFile());
