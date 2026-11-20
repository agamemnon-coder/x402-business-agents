// npm run proof:index: writes docs/evidence/proof-index.md, every figure on /proof with its record and how to check it,
// from the page as built (src/proof/proofIndex.ts). Offline. test/proof-index.test.ts fails when the file is stale.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { proofIndexMd } from "../proof/proofIndex.js";
import { PROOF_INDEX_FILE, proofPage } from "../redesign/proof.js";

writeFileSync(resolve(import.meta.dirname, "../..", PROOF_INDEX_FILE), proofIndexMd(proofPage()));
console.log(`wrote ${PROOF_INDEX_FILE}`);
