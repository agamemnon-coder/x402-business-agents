// The PDF reader for a runtime without worker threads (the engine in a Cloudflare Durable Object): the same unpdf calls
// as the worker thread in src/ap/pdfText.ts, on the calling thread. The host sets it once at start with
// usePdfReader(readPdfInline); nothing in the Node runner imports this file. What it does not have is the worker
// thread's own time and memory limits: there the platform's limits on a request apply. The decode budget of pdfText()
// is checked before this reader is called.

import { extractText, getDocumentProxy } from "unpdf";
import type { PdfReader } from "./pdfText.js";

export const readPdfInline: PdfReader = async (bytes, maxPages) => {
  // A copy: the library may take over the bytes it is given, and the caller keeps its own.
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
