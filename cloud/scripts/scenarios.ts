// npm run cloud:scenarios: writes cloud/src/try/scenarios.gen.ts, the scenario library's invoices as PDFs (base64),
// because the Worker reads no files. The texts and right answers are in src/try/scenarios/; the PDFs are made by the
// same writer as the samples (src/e2e/documents.ts pdfOf, deterministic). test/try-scenarios.test.ts holds the file up
// to date and every scenario's right answer to the engine's own answer.
import { writeFileSync } from "node:fs";
import { pdfOf } from "../../src/e2e/documents.js";
import { LIBRARY, scenariosFile } from "../../src/try/scenarios/library.js";

const pdfs = await Promise.all(LIBRARY.map((s) => Promise.all(s.files.map(async (f) => (await pdfOf(f.text)).toString("base64")))));
writeFileSync(new URL("../src/try/scenarios.gen.ts", import.meta.url), scenariosFile(pdfs));
