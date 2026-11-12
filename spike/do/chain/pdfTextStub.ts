// workerd only (wrangler alias "./pdfText.js" -> this file): the PDF text reader's stand-in for this spike. The real
// one (src/ap/pdfText.ts) runs unpdf in a node:worker_threads Worker; reading PDFs inside workerd is the other
// explorer's question. Here the text of a document is handed in with it (read by the real reader, in Node) and looked
// up by the bytes' hash, so the checks, the payment and the terms run on exactly the text the runner would have read.
import { createHash } from "crypto";

export const isPdf = (bytes: Uint8Array) => bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
export const PDF_MAX_PAGES = 200;
export const PDF_MAX_MS = 10_000;
export const PDF_MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const PDF_WORKER_HEAP_MB = 256;
export interface PdfTextOptions { timeoutMs?: number; maxDecodedBytes?: number }
export function checkDecodedSize(): void { /* not checked in the stand-in */ }

type Source = (sha256: string) => { text: string; pages: number } | undefined;
let source: Source = () => undefined;
/** Where the stand-in finds a document's text: content-addressed, so one source can serve every Durable Object. */
export function setPdfTextSource(s: Source): void { source = s; }

export function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const known = source(sha);
  return known ? Promise.resolve(known) : Promise.reject(new Error(`spike stand-in: no text was handed in for document ${sha.slice(0, 12)}`));
}
