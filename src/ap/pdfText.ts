// Payables: the text layer of a PDF (library unpdf, pinned). A scan has none; OCR is a later step.

import { extractText, getDocumentProxy } from "unpdf";

export const isPdf = (bytes: Uint8Array) => bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

/** The PDF's text, pages joined; throws when the file is not a PDF it can open. */
export async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  // A copy: the PDF library may take over (detach) the buffer it is given.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: text.split("\u0000").join("").trim(), pages: totalPages };
  } finally {
    await pdf.cleanup?.();
  }
}
