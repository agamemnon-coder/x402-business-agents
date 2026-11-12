// The AP world's documents as files: a text PDF (a text layer, as an accounting package writes it), a scan-like PDF (the
// same text drawn in dots, no text layer, as a scanner makes it), or an e-mail (RFC 822) with the PDF attached.

import PDFDocument from "pdfkit";
import { glyph } from "./font5x7.js";
import { invoiceText, type WorldDoc } from "./generate.js";

function render(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  // A fixed creation date: the same document gives the same bytes.
  const doc = new PDFDocument({ size: "A4", info: { CreationDate: new Date("2026-11-01T00:00:00Z") } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;
}

export const textPdf = (text: string): Promise<Buffer> => render((doc) => { for (const line of text.split("\n")) doc.text(line); });

/** Upper case without accents, as the dot font holds it. */
export const scanCase = (text: string) => text.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").toUpperCase();

/** The text drawn as dots: readable on the page, nothing for a text extractor. */
export const scanPdf = (text: string): Promise<Buffer> => render((doc) => {
  const dot = 1.6, gap = 0.4, cell = dot + gap;
  let y = 50;
  doc.fillColor("#222");
  for (const line of scanCase(text).split("\n")) {
    let x = 50;
    for (const ch of line) {
      const g = glyph(ch);
      if (g) g.forEach((row, ry) => row.forEach((on, rx) => { if (on) doc.rect(x + rx * cell, y + ry * cell, dot, dot); }));
      x += 6 * cell;
    }
    doc.fill();
    y += 10 * cell;
  }
});

export function emlWith(pdf: Buffer, filename: string, mail: { from: string; subject: string; body: string }, date: string): Buffer {
  const b = "=_apworld_boundary";
  return Buffer.from([
    `From: ${mail.from}`, "To: payables@northwind.example", `Subject: ${mail.subject}`, `Date: ${new Date(`${date}T08:30:00Z`).toUTCString()}`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=utf-8", "", mail.body,
    `--${b}`, `Content-Type: application/pdf; name="${filename}"`, `Content-Disposition: attachment; filename="${filename}"`, "Content-Transfer-Encoding: base64", "",
    pdf.toString("base64").replace(/.{76}/g, "$&\r\n"), `--${b}--`, "",
  ].join("\r\n"));
}

export interface RenderedDoc { bytes: Buffer; filename: string; mime: string; meta: Record<string, string> }

export async function renderDoc(d: WorldDoc, day: string): Promise<RenderedDoc> {
  const text = invoiceText(d.invoice);
  const pdf = d.form === "scan" ? await scanPdf(text) : await textPdf(text);
  const filename = `${d.invoice.no}${d.event === "duplicate" ? "-copy" : d.event === "changed_amount" ? "-v2" : ""}.pdf`;
  if (d.carrier === "eml") return { bytes: emlWith(pdf, filename, d.mail!, day), filename: `${d.id}.eml`, mime: "message/rfc822", meta: { world_doc: d.id } };
  return { bytes: pdf, filename, mime: "application/pdf", meta: { world_doc: d.id } };
}
