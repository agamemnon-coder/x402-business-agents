// The hands-on demo's world (purser-try): the sample invoices a visitor picks from, the suppliers a visitor's company
// has on file, and "write your own", an invoice typed by the visitor in the same layout as the clean sample. Every
// outcome is the engine's: a sample's `expect` was measured by running it through the engine
// (test/engine-try-world.test.ts holds them), and a composed invoice goes through the same inbox as any upload.
//
// Test data only. The suppliers are the payees the engine's seed puts on file (src/agents/euroBill.ts
// ALLOWLISTED_PAYEES): their IBANs are published test IBANs, not anyone's account. The samples are labelled
// "Test invoice (fake)" in their PDF's properties (src/e2e/documents.ts).
//
// Host-agnostic: no node: import; the PDF writer is the one the samples script uses (pdfkit through pdfOf).
import { ALLOWLISTED_PAYEES } from "../agents/euroBill.js";
import { ibanValid } from "../ap/reading.js";

export interface Sample {
  key: string;
  /** What the visitor does, never what the engine will answer. */
  title: string;
  filename: string;
  /** What the engine answered when the sample was chosen, after the seed and the samples before it in this order. */
  expect: { kind: string; status?: string; finding?: string };
  base64: string;
}

/** A supplier on file, as the visitor's "write your own" offers it. Its IBAN is a published test IBAN. */
export interface SupplierOnFile { key: string; name: string; iban: string; bic: string }

/** The key a supplier on file is offered under: the first word of its name. */
export const supplierKey = (name: string): string => name.split(/\s+/)[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The seeded payees, with the street and city the composed invoice's letterhead shows. */
export const SEEDED_SUPPLIERS = ALLOWLISTED_PAYEES.map((p) => ({ key: supplierKey(p.name), name: p.name, iban: p.iban, bic: p.bic, street: p.address.street, city: `${p.address.postcode} ${p.address.city}` }));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return `${d} ${MONTHS[m - 1]} ${y}`; };
const groups = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();
const eur = (cents: number) => `EUR ${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;

export interface InvoiceFields { supplier: { name: string; street: string; city: string; bic: string }; invoiceNo: string; amountCents: number; issueDate: string; dueDate: string; iban: string }

/** An invoice's text in the clean sample's layout (test/fakes/apInvoices.ts EN): letterhead, number, dates, VAT at 19%, bank details. */
export function invoiceText(f: InvoiceFields): string {
  const subtotal = Math.round(f.amountCents / 1.19);
  return [
    f.supplier.name,
    `${f.supplier.street}, ${f.supplier.city}`,
    `INVOICE ${f.invoiceNo}`,
    `Invoice date: ${longDate(f.issueDate)}`,
    `Due date: ${longDate(f.dueDate)}`,
    `Subtotal ${eur(subtotal)}`,
    `VAT 19% ${eur(f.amountCents - subtotal)}`,
    `Total due ${eur(f.amountCents)}`,
    `IBAN: ${groups(f.iban)}`,
    `BIC: ${f.supplier.bic}`,
    `Payment reference: ${f.invoiceNo}`,
  ].join("\n");
}

const BERGTEX = SEEDED_SUPPLIERS.find((s) => s.key === "bergtex")!;
/** The clean sample, on file and payable; the others are variations of it, so each tells one thing. The pages'
 * illustration shows this invoice (cloud/src/scene.ts). */
export const CLEAN: InvoiceFields = { supplier: BERGTEX, invoiceNo: "BTX-2026-21", amountCents: 185_000, issueDate: "2026-11-09", dueDate: "2026-11-30", iban: BERGTEX.iban };
/** A new supplier's invoice in its own (Dutch) layout; its IBAN is a published test IBAN. */
const NEW_SUPPLIER = `Zeeland Verpakkingen B.V.
BTW-nummer: NL123456789B01
Factuur
Factuurnummer: ZV-4471
Factuurdatum: 09-11-2026
Vervaldatum: 30-11-2026
Subtotaal € 400,00
BTW 21% € 84,00
Totaal te betalen € 484,00
IBAN: NL91 ABNA 0417 1643 00
BIC: ABNANL2A
Betalingskenmerk: ZV-4471`;

/** The tray, in order: the clean one first, so "the same file again" means something. */
export const SAMPLE_SOURCES: { key: string; title: string; filename: string; text: string; expect: Sample["expect"] }[] = [
  { key: "clean", title: "A supplier's invoice", filename: "bergtex-BTX-2026-21.pdf", text: invoiceText(CLEAN), expect: { kind: "invoice", status: "ready" } },
  { key: "again", title: "The same invoice, sent twice", filename: "bergtex-BTX-2026-21.pdf", text: invoiceText(CLEAN), expect: { kind: "duplicate_document" } },
  { key: "renumbered", title: "The same invoice under a new number", filename: "bergtex-BTX-2026-21A.pdf", text: invoiceText({ ...CLEAN, invoiceNo: "BTX-2026-21A" }), expect: { kind: "invoice", status: "needs_review", finding: "possible_duplicate" } },
  { key: "bank", title: "An invoice with new bank details", filename: "bergtex-BTX-2026-22.pdf", text: invoiceText({ ...CLEAN, invoiceNo: "BTX-2026-22", amountCents: 238_000, iban: "DE44500105175407324931" }), expect: { kind: "invoice", status: "blocked", finding: "possible_fraud" } },
  { key: "unknown", title: "An invoice from a new supplier", filename: "zeeland-ZV-4471.pdf", text: NEW_SUPPLIER, expect: { kind: "invoice", status: "needs_vendor", finding: "new_supplier" } },
];

/** The generated file (cloud/src/engine/samples.gen.ts), from the sources and their PDFs. */
export function samplesFile(pdfs: string[]): string {
  const items: Sample[] = SAMPLE_SOURCES.map((s, i) => ({ key: s.key, title: s.title, filename: s.filename, expect: s.expect, base64: pdfs[i]! }));
  return `// Generated by npm run cloud:samples from src/engine/tryWorld.ts (SAMPLE_SOURCES). Do not edit.\n// Test invoices (fake), rendered to PDF by src/e2e/documents.ts pdfOf; test/engine-try-world.test.ts holds this file up to date.\nimport type { Sample } from "../../../src/engine/tryWorld.js";\n\nexport const SAMPLES: Sample[] = ${JSON.stringify(items, null, 1)};\n`;
}

/** What a visitor types for "write your own". */
export interface ComposeInput { supplier_key: string; invoice_no: string; amount: string; issue_date: string; due_date: string; iban: string }
export type ComposeRefusal = { refused: { field: keyof ComposeInput; message: string } };

const DAY = 86_400_000;
const isoDay = (s: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : t;
};

/** The typed fields checked, each refusal naming its field; on success the invoice's fields. */
export function checkCompose(i: ComposeInput, suppliers: SupplierOnFile[], now: Date): InvoiceFields | ComposeRefusal {
  const no = (field: keyof ComposeInput, message: string): ComposeRefusal => ({ refused: { field, message } });
  const s = suppliers.find((x) => x.key === i.supplier_key);
  const letterhead = SEEDED_SUPPLIERS.find((x) => x.key === i.supplier_key);
  if (!s || !letterhead) return no("supplier_key", "supplier_key is not a supplier on file in this company");
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{0,31}$/.test(i.invoice_no)) return no("invoice_no", "invoice_no is 1 to 32 letters, digits, dashes or slashes, starting with a letter or digit");
  if (!/^\d{1,9}\.\d{2}$/.test(i.amount)) return no("amount", "amount is in euros with two decimals, such as 1850.00");
  const cents = Math.round(Number(i.amount) * 100);
  // The cap: the simulated bank holds USD 25,000 with a USD floor of 20,000 (src/agents/euroBill.ts), so a larger
  // payment would escalate at the floor. Said plainly, as the page says it (cloud/src/tryCopy.ts INVOICE.amountCap).
  if (cents > 500_000) return no("amount", "Demo invoices go up to EUR 5,000.");
  if (cents < 100) return no("amount", "amount is from 1.00 to 5000.00 euros");
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  for (const field of ["issue_date", "due_date"] as const) {
    const t = isoDay(i[field]);
    if (t === null) return no(field, `${field} is a date as YYYY-MM-DD`);
    if (Math.abs(t - today) > 60 * DAY) return no(field, `${field} is within 60 days of today`);
  }
  if (isoDay(i.due_date)! < isoDay(i.issue_date)!) return no("due_date", "due_date is on or after issue_date");
  const iban = i.iban.replace(/\s+/g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) || !ibanValid(iban)) return no("iban", "iban is 15 to 34 letters and digits with a valid check (mod 97)");
  return { supplier: { name: s.name, street: letterhead.street, city: letterhead.city, bic: s.bic }, invoiceNo: i.invoice_no, amountCents: cents, issueDate: i.issue_date, dueDate: i.due_date, iban };
}
