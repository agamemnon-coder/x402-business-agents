// SPIKE probe 1: the text layer of a PDF, as the engine reads it (src/ap/pdfText.ts: unpdf in a worker thread), in workerd.
import { DurableObject } from "cloudflare:workers";
import invoicePdf from "../fixtures/invoice.pdf";
import receiptPdf from "../fixtures/receipt.node.pdf";
import node from "../fixtures/node-results.json";
import { json, steps } from "./_util.js";

export class Engine extends DurableObject {}

const copy = (b: ArrayBuffer) => new Uint8Array(b.slice(0));

export default {
  async fetch(req: Request): Promise<Response> {
    const { out, step } = steps(req);
    // A. The engine's module exactly as it is on origin/platform.
    let engine: typeof import("../../../src/ap/pdfText.js") | null = null;
    await step("A_engine_module_loads", async () => { engine = await import("../../../src/ap/pdfText.js"); return Object.keys(engine); });
    if (engine) {
      const m = engine as typeof import("../../../src/ap/pdfText.js");
      await step("A_checkDecodedSize_zlib_budget", () => { m.checkDecodedSize(copy(invoicePdf)); m.checkDecodedSize(copy(receiptPdf)); return "within budget"; });
      await step("A_checkDecodedSize_refuses_bomb", () => { try { m.checkDecodedSize(copy(receiptPdf), 64); return "NOT refused"; } catch (e) { return `refused: ${(e as Error).message.slice(0, 90)}`; } });
      await step("A_pdfText_worker_thread", async () => { const r = await m.pdfText(copy(invoicePdf), { timeoutMs: 4000 }); return { equalToNode: r.text === node.invoice.text, pages: r.pages }; }, 8000);
    }
    // C. The engine's own pdfText() with the seam of this spike: usePdfReader(readPdfInline) (src/ap/pdfTextInline.ts).
    if (engine) {
      const m = engine as typeof import("../../../src/ap/pdfText.js");
      await step("C_usePdfReader_inline", async () => { const { readPdfInline } = await import("../../../src/ap/pdfTextInline.js"); m.usePdfReader(readPdfInline); return "set"; });
      await step("C_engine_pdfText_invoice", async () => { const r = await m.pdfText(copy(invoicePdf)); return { equalToNode: r.text === node.invoice.text, pages: r.pages }; });
      await step("C_engine_pdfText_receipt", async () => { const r = await m.pdfText(copy(receiptPdf)); return { equalToNode: r.text === node.receipt.text, pages: r.pages }; });
      await step("C_engine_pdfText_still_refuses_bomb", async () => { try { await m.pdfText(copy(receiptPdf), { maxDecodedBytes: 64 }); return "NOT refused"; } catch (e) { return `refused: ${(e as Error).message.slice(0, 80)}`; } });
      await step("C_engine_pdfText_not_a_pdf", async () => { try { await m.pdfText(new TextEncoder().encode("hello, not a pdf")); return "NOT refused"; } catch (e) { return `refused: ${(e as Error).message.slice(0, 80)}`; } });
      await step("C_isPdf", () => m.isPdf(copy(invoicePdf)) && !m.isPdf(new Uint8Array([1, 2, 3, 4, 5, 6])));
    }
    // B. The same unpdf calls the engine's worker thread makes, on this thread.
    const inline = async (bytes: Uint8Array) => {
      const lib = await import("unpdf");
      const pdf = await lib.getDocumentProxy(bytes);
      try {
        const { text, totalPages } = await lib.extractText(pdf, { mergePages: true });
        return { text: String(text).split("\u0000").join("").trim(), pages: totalPages };
      } finally { await (pdf as { cleanup?: () => Promise<void> }).cleanup?.(); await (pdf as { destroy?: () => Promise<void> }).destroy?.(); }
    };
    await step("B_unpdf_inline_invoice", async () => { const r = await inline(copy(invoicePdf)); return { equalToNode: r.text === node.invoice.text, pages: r.pages, chars: r.text.length, ...(r.text === node.invoice.text ? {} : { got: r.text, want: node.invoice.text }) }; });
    await step("B_unpdf_inline_receipt", async () => { const r = await inline(copy(receiptPdf)); return { equalToNode: r.text === node.receipt.text, pages: r.pages, chars: r.text.length }; });
    await step("B_unpdf_inline_again", async () => { const r = await inline(copy(invoicePdf)); return { equalToNode: r.text === node.invoice.text }; });
    out.node_ms = { invoice_pdfText: node.invoice.ms };
    return json(out);
  },
};
