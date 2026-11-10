// The world's invoices as documents: a PDF with the invoice's text as its text layer (pdfkit), and an e-mail
// (RFC 822) with that PDF attached, the way a mail client saves one. Both go through the real inbox path.
import PDFDocument from "pdfkit";

export function pdfOf(text: string): Promise<Buffer> {
  const doc = new PDFDocument({ info: { CreationDate: new Date("2026-11-01T00:00:00Z"), Title: "Test invoice (fake)" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  for (const line of text.split("\n")) doc.text(line);
  doc.end();
  return done;
}

export function emlWith(pdf: Buffer, o: { filename: string; from: string; to: string; subject: string }): Buffer {
  const b = "=_purser_e2e";
  return Buffer.from([
    `From: ${o.from}`, `To: ${o.to}`, `Subject: ${o.subject}`, "Date: Tue, 10 Nov 2026 09:00:00 +0100", "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/plain; charset=utf-8", "", "Please find our invoice attached. (Test e-mail, fictional supplier.)",
    `--${b}`, `Content-Type: application/pdf; name="${o.filename}"`, `Content-Disposition: attachment; filename="${o.filename}"`,
    "Content-Transfer-Encoding: base64", "", pdf.toString("base64").replace(/.{76}/g, "$&\r\n"), `--${b}--`, "",
  ].join("\r\n"));
}
