// PDFs for the payables tests, made with pdfkit: one with the given text as its text layer, and one with no text
// at all (as a scanner makes it).
import PDFDocument from "pdfkit";

function render(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ info: { CreationDate: new Date("2026-11-01T00:00:00Z") } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;
}

export const pdfOf = (text: string): Promise<Buffer> => render((doc) => { for (const line of text.split("\n")) doc.text(line); });
export const scanPdf = (): Promise<Buffer> => render((doc) => { doc.rect(50, 50, 300, 200).fill("#888"); });

/** An e-mail (RFC 822) with one PDF attached, as a mail client saves it. */
export function emlWith(pdf: Buffer, filename = "invoice.pdf", body = "Please find our invoice attached."): Buffer {
  const b = "=_boundary_42";
  return Buffer.from([
    "From: Accounts <accounts@supplier.example>",
    "To: payables@northwind.example",
    "Subject: Invoice",
    "Date: Mon, 02 Nov 2026 09:00:00 +0100",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    `--${b}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${b}--`,
    "",
  ].join("\r\n"));
}
