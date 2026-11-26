// npm run cloud:card-art: writes the Obsidian card art's shared shapes (cloud/src/cardArtBuild.ts) to
// cloud/src/agentCardArt.gen.ts, so the Worker carries fixed strings and no generator. test/cloud-card-art.test.ts fails
// when the generated file and the builder disagree.
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { cardArtDefs, cardArtGenSource } from "../src/cardArtBuild.js";

const out = new URL("../src/agentCardArt.gen.ts", import.meta.url);
writeFileSync(out, cardArtGenSource());
const defs = cardArtDefs();
console.log(`wrote cloud/src/agentCardArt.gen.ts: ${defs.length} bytes of SVG, ${gzipSync(defs).length} gzipped`);
