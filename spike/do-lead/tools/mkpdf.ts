// SPIKE: renders two of the repository's fraud fixtures to PDF (Node, the tests' own pdfOf), for the joined probe.
//   npx tsx spike/do-lead/tools/mkpdf.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pdfOf } from "../../../test/fakes/pdf.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const [src, out] of [["fixtures/bergtex-invoice-BTX-2027-01-BANKCHANGE.txt", "bankchange.pdf"], ["fixtures/hard/bergtex-invoice-renumbered.txt", "renumbered.pdf"]] as const) {
  const pdf = await pdfOf(readFileSync(resolve(root, src), "utf8"));
  writeFileSync(resolve(root, "spike/do-lead/fixtures", out), pdf);
  console.log(out, pdf.length);
}
