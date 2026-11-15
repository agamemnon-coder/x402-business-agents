// npm run cloud:proof: /try's "Proof in numbers" figures, read from the run records (src/redesign/tryProof.ts), into
// cloud/src/try/proof.gen.ts for the Worker. test/try-proof.test.ts fails when the file is behind its records.
import { writeFileSync } from "node:fs";
import { tryProofFile } from "../../src/redesign/tryProof.js";

writeFileSync("cloud/src/try/proof.gen.ts", tryProofFile());
