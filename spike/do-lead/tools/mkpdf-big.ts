// SPIKE: a 200-page text PDF (the engine reads at most PDF_MAX_PAGES = 200) and a 201-page one, for the reader's timing in workerd.
//   npx tsx spike/do-lead/tools/mkpdf-big.ts
import PDFDocument from "pdfkit";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const make = (pages: number): Promise<Buffer> => new Promise((done) => {
  const doc = new PDFDocument({ info: { CreationDate: new Date("2026-11-01T00:00:00Z") } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  doc.on("end", () => done(Buffer.concat(chunks)));
  for (let p = 0; p < pages; p++) {
    if (p) doc.addPage();
    for (let l = 0; l < 45; l++) doc.fontSize(9).text(`Page ${p + 1} line ${l + 1}: item ${p * 45 + l} of a long statement, quantity 3, unit price EUR 12.50, amount EUR 37.50`);
  }
  doc.end();
});
for (const n of [200, 201]) { const b = await make(n); writeFileSync(resolve(out, `big-${n}p.pdf`), b); console.log(n, b.length); }
