// The PDF text reader a host can hand in (src/ap/pdfText.ts usePdfReader): a runtime without worker threads sets its
// own reader (src/ap/pdfTextInline.ts reads on the calling thread with the same library calls). The decode budget is
// checked first either way, and with no reader set the worker thread reads, as before.
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_MAX_PAGES, pdfText, usePdfReader, type PdfReader } from "../src/ap/pdfText.js";
import { readPdfInline } from "../src/ap/pdfTextInline.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

/** A PDF whose one content stream inflates to `size` zero bytes (the bomb of test/ap-redteam2.test.ts). */
function deflateBomb(size: number): Buffer {
  const data = deflateSync(Buffer.alloc(size));
  const head = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n4 0 obj << /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, "latin1");
  const tail = Buffer.from("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
  return Buffer.concat([head, data, tail]);
}

afterEach(() => {
  usePdfReader(null);
  vi.doUnmock("node:module");
  vi.resetModules();
});

describe("the inline PDF reader", () => {
  it("gives the same text and page count as the worker thread", async () => {
    const pdf = await pdfOf(EN);
    const byWorker = await pdfText(pdf);
    const inline = await readPdfInline(pdf, PDF_MAX_PAGES);
    expect(byWorker.text).toMatch(/BTX-2026-21/);
    expect(inline).toEqual(byWorker);
  });

  it("leaves the caller's bytes as they were", async () => {
    const pdf = await pdfOf(EN);
    const before = Buffer.from(pdf);
    await readPdfInline(pdf, PDF_MAX_PAGES);
    expect(Buffer.compare(pdf, before)).toBe(0);
  });

  it("refuses a PDF with more pages than it is told to read", async () => {
    await expect(readPdfInline(await pdfOf(EN), 0)).rejects.toThrow(/1 pages, more than the 0 read/);
  });
});

describe("a reader handed in by the host", () => {
  it("reads every PDF once it is set, with the page limit", async () => {
    const pdf = await pdfOf(EN);
    const calls: [number, number][] = [];
    const reader: PdfReader = (bytes, maxPages) => { calls.push([bytes.length, maxPages]); return Promise.resolve({ text: "read by the host", pages: 1 }); };
    usePdfReader(reader);
    expect(await pdfText(pdf)).toEqual({ text: "read by the host", pages: 1 });
    expect(calls).toEqual([[pdf.length, PDF_MAX_PAGES]]);
  });

  it("reads through the inline reader as through the worker thread", async () => {
    const pdf = await pdfOf(EN);
    const byWorker = await pdfText(pdf);
    usePdfReader(readPdfInline);
    expect(await pdfText(pdf)).toEqual(byWorker);
  });

  it("still refuses a deflate bomb before the reader sees it", async () => {
    let seen = 0;
    usePdfReader((...a) => { seen++; return readPdfInline(...a); });
    await expect(pdfText(deflateBomb(8 * 1024 * 1024), { maxDecodedBytes: 1024 * 1024 })).rejects.toThrow(/decoded/);
    expect(seen).toBe(0);
    // The reader goes on with the next PDF.
    expect((await pdfText(await pdfOf(EN))).text).toMatch(/BTX-2026-21/);
    expect(seen).toBe(1);
  });

  it("usePdfReader(null) puts the worker thread back", async () => {
    const pdf = await pdfOf(EN);
    let seen = 0;
    usePdfReader(() => { seen++; return Promise.resolve({ text: "read by the host", pages: 1 }); });
    await pdfText(pdf);
    usePdfReader(null);
    expect((await pdfText(pdf)).text).toMatch(/BTX-2026-21/);
    expect(seen).toBe(1);
  });

  it("the module loads and reads where the library's path cannot be worked out (no module path, as in a Worker's bundle)", async () => {
    vi.resetModules();
    vi.doMock("node:module", () => ({ createRequire: () => { throw new Error("no module path in this runtime"); } }));
    const fresh = await import("../src/ap/pdfText.js");
    fresh.usePdfReader(() => Promise.resolve({ text: "read by the host", pages: 1 }));
    expect((await fresh.pdfText(await pdfOf(EN))).text).toBe("read by the host");
    // Only the worker thread needs the path: without a reader it is asked for, and the reason comes back.
    fresh.usePdfReader(null);
    await expect(fresh.pdfText(await pdfOf(EN))).rejects.toThrow(/no module path in this runtime/);
  });
});
