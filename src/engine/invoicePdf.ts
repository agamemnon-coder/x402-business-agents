// The hands-on demo's invoices as a supplier would send them (owner, 13 Nov: "a proper enterprise invoice"): the seller's
// name and address block, the invoice's number and dates, who it is billed to, a line-item table, the VAT line and the
// total, the payment details, and a small "Demo · test money" footer. Test data only: the supplier is a payee the demo's
// seed puts on file (its IBAN a published test IBAN), and the PDF's properties say "Test invoice (fake)".
//
// The PDF is read by Purser like any upload (Claude, or the parser), so each line the reading needs is one run of text
// on one line, in reading order: "INVOICE <no>", "Invoice date: …", "Due date: …", "Subtotal EUR …", "VAT 19% EUR …",
// "Total due EUR …", "IBAN: …", "BIC: …", "Payment reference: …" (the same words as src/engine/tryWorld.ts invoiceText,
// which stays the text form; test/engine-invoice-pdf.test.ts reads this PDF back and parses it).
//
// Host-agnostic: pdfkit only, no node: import (the cloud's engine renders a composed invoice in its Worker).
import PDFDocument from "pdfkit";
import type { InvoiceFields } from "../config/trySample.js";

const INK = "#0b1220", MUTED = "#586174", LINE = "#e3e6ec", ACCENT = "#4f46e5", BAND = "#f1f3f7";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return `${d} ${MONTHS[m - 1]} ${y}`; };
export const eur = (cents: number) => `EUR ${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
const groups = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

/** What each seeded supplier sells: the one line of its invoice (test data). */
export const LINE_ITEMS: Record<string, string> = { bergtex: "Linen fabric, natural, as ordered", stockline: "Stock data licence, monthly" };
/** The VAT rate on the demo's invoices (a German supplier's 19%). */
export const VAT_RATE = 0.19;

/** Net and VAT of a gross amount at 19%, the VAT line being what is left: the same split as invoiceText. */
export function vatSplit(grossCents: number): { net: number; vat: number } {
  const net = Math.round(grossCents / (1 + VAT_RATE));
  return { net, vat: grossCents - net };
}

export interface InvoiceDoc { fields: InvoiceFields; supplierKey: string; billTo: string }

/** The invoice as a PDF, laid out like an enterprise invoice; deterministic (its dates come from the invoice). */
export function invoicePdf(d: InvoiceDoc): Promise<Buffer> {
  const f = d.fields, { net, vat } = vatSplit(f.amountCents);
  const at = new Date(`${f.issueDate}T00:00:00Z`);
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: "Test invoice (fake)", Author: f.supplier.name, Creator: "Purser demo", Producer: "Purser demo", CreationDate: at, ModDate: at } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  const L = 50, R = 545, W = R - L;

  // The seller's block, left; the document's title, right.
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(f.supplier.name, L, 50, { width: 300 });
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(`${f.supplier.street}, ${f.supplier.city}`, L, doc.y + 2, { width: 300 });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(ACCENT).text(`INVOICE ${f.invoiceNo}`, 300, 50, { width: R - 300, align: "right" });
  doc.font("Helvetica").fontSize(9.5).fillColor(INK);
  doc.text(`Invoice date: ${longDate(f.issueDate)}`, 300, 80, { width: R - 300, align: "right" });
  doc.text(`Due date: ${longDate(f.dueDate)}`, 300, doc.y + 1, { width: R - 300, align: "right" });

  // Billed to.
  let y = 130;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 12;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("BILL TO", L, y, { characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(d.billTo, L, y + 12, { width: 300 });
  y += 44;

  // The line items: description, quantity, unit price, amount (net).
  doc.rect(L, y, W, 22).fill(BAND);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED);
  doc.text("DESCRIPTION", L + 10, y + 7, { width: 260, lineBreak: false });
  doc.text("QTY", L + 280, y + 7, { width: 40, align: "right", lineBreak: false });
  doc.text("UNIT PRICE", L + 330, y + 7, { width: 75, align: "right", lineBreak: false });
  doc.text("AMOUNT", L + 410, y + 7, { width: W - 420, align: "right", lineBreak: false });
  y += 30;
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  doc.text(LINE_ITEMS[d.supplierKey] ?? "Goods and services as agreed", L + 10, y, { width: 260, lineBreak: false });
  doc.text("1", L + 280, y, { width: 40, align: "right", lineBreak: false });
  doc.text(eur(net), L + 330, y, { width: 75, align: "right", lineBreak: false });
  doc.text(eur(net), L + 410, y, { width: W - 420, align: "right", lineBreak: false });
  y += 22;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();

  // The totals, right: each one run of text, so the reading sees "Subtotal EUR …" on one line.
  y += 12;
  const total = (t: string, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(INK).text(t, 300, y, { width: R - 300, align: "right" }); y = doc.y + 5; };
  total(`Subtotal ${eur(net)}`);
  total(`VAT 19% ${eur(vat)}`);
  doc.moveTo(330, y).lineTo(R, y).strokeColor(INK).lineWidth(0.8).stroke();
  y += 6;
  total(`Total due ${eur(f.amountCents)}`, true);

  // Payment details.
  y += 18;
  doc.rect(L, y, W, 72).fill(BAND);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("PAYMENT DETAILS", L + 12, y + 10, { characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  doc.text(`IBAN: ${groups(f.iban)}`, L + 12, y + 24);
  doc.text(`BIC: ${f.supplier.bic}`, L + 12, doc.y + 2);
  doc.text(`Payment reference: ${f.invoiceNo}`, L + 12, doc.y + 2);

  // The footer: what this document is.
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Demo · test money. A test invoice made by Purser's hands-on demo; no real supplier, no real money.", L, 780, { width: W, align: "center", lineBreak: false });
  doc.end();
  return done;
}
