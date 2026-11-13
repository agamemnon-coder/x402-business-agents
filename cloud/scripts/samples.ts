// npm run cloud:samples: writes cloud/src/engine/samples.gen.ts, the hands-on demo's sample invoices as PDFs (base64),
// because the Worker reads no files. The texts, titles and measured outcomes are in src/engine/tryWorld.ts; the PDFs
// are made by the same writer the engine uses for "write your own" (src/engine/invoicePdf.ts, deterministic).
// test/engine-try-world.test.ts holds the file up to date and every sample to its outcome.
import { writeFileSync } from "node:fs";
import { SAMPLE_SOURCES, samplePdf, samplesFile } from "../../src/engine/tryWorld.js";

const pdfs = await Promise.all(SAMPLE_SOURCES.map(async (s) => (await samplePdf(s)).toString("base64")));
writeFileSync(new URL("../src/engine/samples.gen.ts", import.meta.url), samplesFile(pdfs));
