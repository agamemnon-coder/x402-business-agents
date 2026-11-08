// Payables: the text layer of a PDF (library unpdf, pinned). A scan has none; OCR is a later step.

import { extractText, getDocumentProxy } from "unpdf";

export const isPdf = (bytes: Uint8Array) => bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

/** The most pages read from one PDF; an invoice has a few. */
export const PDF_MAX_PAGES = 200;
/** The longest a PDF may take to read. */
export const PDF_MAX_MS = 10_000;

/** The PDF's text, pages joined; throws when the file is not a PDF it can open, has too many pages or takes too long. */
export async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`reading the PDF took longer than ${PDF_MAX_MS / 1000} s`)), PDF_MAX_MS); });
  try {
    return await Promise.race([read(bytes), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function read(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  // A copy: the PDF library may take over (detach) the buffer it is given.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > PDF_MAX_PAGES) throw new Error(`the PDF has ${pdf.numPages} pages, more than the ${PDF_MAX_PAGES} read`);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: text.split("\u0000").join("").trim(), pages: totalPages };
  } finally {
    await pdf.cleanup?.();
  }
}
