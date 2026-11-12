// SPIKE (spike-do-runtime): the PDF reader for a runtime without worker threads (a Cloudflare Durable Object). The same
// unpdf calls as the worker thread in src/ap/pdfText.ts, on the calling thread: usePdfReader(readPdfInline) at start.
// Nothing in the Node runner imports this file. What it loses is the worker thread's own time and memory limits: there
// the platform's limits on the request apply (docs: CPU time per request, 128 MB per isolate).

import { extractText, getDocumentProxy } from "unpdf";
import type { PdfReader } from "./pdfText.js";

export const readPdfInline: PdfReader = async (bytes, maxPages) => {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > maxPages) throw new Error(`the PDF has ${pdf.numPages} pages, more than the ${maxPages} read`);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: String(text).split("\u0000").join("").trim(), pages: totalPages };
  } finally {
    await (pdf as { cleanup?: () => Promise<void> }).cleanup?.();
    await (pdf as { destroy?: () => Promise<void> }).destroy?.();
  }
};
