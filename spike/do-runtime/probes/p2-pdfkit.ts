// SPIKE probe 2: the vault's PDFs (src/vault/pdf.ts on pdfkit 0.20.2) generated in workerd, compared with Node's.
import { DurableObject } from "cloudflare:workers";
import * as pdfkit from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
import HelveticaOblique from "pdfkit/standard-fonts/HelveticaOblique";
import receiptData from "../fixtures/receipt-data.json";
import monthData from "../fixtures/month-data.json";
import node from "../fixtures/node-results.json";
import { monthReportPdf, receiptPdf } from "../../../src/vault/pdf.js";
import { json, sha256, steps } from "./_util.js";

export class Engine extends DurableObject {}

const text = async (bytes: Uint8Array) => {
  const lib = await import("unpdf");
  const pdf = await lib.getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await lib.extractText(pdf, { mergePages: true });
  return { text: String(text).split("\u0000").join("").trim(), pages: totalPages };
};

export default {
  async fetch(req: Request): Promise<Response> {
    const { out, step } = steps(req);
    out.pdfkit_exports = Object.keys(pdfkit);
    // A. Exactly as the engine calls it today.
    await step("A_receipt_as_is", async () => (await receiptPdf(node.company, receiptData as never, "nl")).length);
    // B. With the one thing pdfkit's browser build asks for: the standard fonts registered once at start.
    await step("B_registerStdFonts", () => { (pdfkit as unknown as { registerStdFonts(...f: unknown[]): void }).registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique); return "registered Helvetica, Helvetica-Bold, Helvetica-Oblique"; });
    await step("B_receipt", async () => {
      const a = await receiptPdf(node.company, receiptData as never, "nl"), b = await receiptPdf(node.company, receiptData as never, "nl");
      const [sa, sb] = [await sha256(a), await sha256(b)];
      const t = await text(a);
      return {
        bytes: a.length, node_bytes: node.receipt.bytes, sha256: sa, node_sha256: node.receipt.sha256, byte_identical_to_node: sa === node.receipt.sha256,
        deterministic_here: sa === sb, node_deterministic: node.receipt.deterministic, text_equal_to_node: t.text === node.receipt.text, pages: t.pages, isBuffer: Buffer.isBuffer(a),
        header: Buffer.from(a.subarray(0, 8)).toString("latin1"),
        ...(t.text === node.receipt.text ? {} : { got: t.text.slice(0, 500), want: node.receipt.text.slice(0, 500) }),
      };
    });
    await step("B_month_report", async () => {
      const a = await monthReportPdf(node.company, monthData as never, "nl");
      const t = await text(a);
      return { bytes: a.length, node_bytes: node.month.bytes, byte_identical_to_node: (await sha256(a)) === node.month.sha256, text_equal_to_node: t.text === node.month.text, pages: t.pages };
    });
    await step("B_receipt_english", async () => (await text(await receiptPdf(node.company, receiptData as never, "en"))).text.slice(0, 120));
    out.node_ms = { receipt: node.receipt.ms };
    return json(out);
  },
};
