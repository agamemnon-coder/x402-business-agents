// The canonical model the ERP connectors speak (ERP connectors design, 8 November). The payables inbox and the
// bookkeeping core map their own records to these four shapes; every connector maps these shapes to its ERP. Money is
// integer cents plus a currency code: never a float inside Purser. Only at the very edge, in an ERP's JSON body, does
// `amount` write cents as a two-decimal number, which JavaScript represents exactly enough for that (cents / 100).

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { sha256Hex } from "../lib/terms.js";

/** VAT treatments Purser knows. Each connector maps them to its ERP's own VAT codes (a setting, never a guess). */
export const VAT_CODES = ["NL21", "NL9", "NL0", "EU_RC", "NONEU_RC", "EXEMPT", "NONE"] as const;
export type VatCode = (typeof VAT_CODES)[number];

export interface Vendor {
  /** Purser's own id for the supplier. */
  id: string;
  name: string;
  vatId?: string;
  /** The full IBAN, only when the supplier's bank account is to be sent to the ERP; never hashed into contentHash. */
  iban?: string;
  ibanLast4?: string;
  ibanSha256?: string;
  bic?: string;
  currency: string;
  /** The supplier's usual expense account in Purser's chart (src/config/gl.ts). */
  defaultGl?: string;
  country?: string;
  email?: string;
}

export interface InvoiceLine {
  description: string;
  /** An account in Purser's chart; each connector maps it to the ERP's account. */
  glAccount: string;
  vatCode: VatCode;
  netCents: number;
  vatCents: number;
  costCentre?: string;
}

export interface PurchaseInvoice {
  id: string;
  vendorId: string;
  /** The supplier's own invoice number. */
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  lines: InvoiceLine[];
  totals: { netCents: number; vatCents: number; grossCents: number };
  /** SHA-256 of the original document, as stored by Purser. */
  documentSha256: string;
  paymentReference?: string;
  /** The PDF itself, attached where the ERP takes attachments. Not part of contentHash (its hash is). */
  pdf?: { fileName: string; bytes: Uint8Array };
}

export interface Payment {
  id: string;
  invoiceId: string;
  vendorId: string;
  date: string;
  amountCents: number;
  currency: string;
  /** The bank account in Purser's chart the money left from (e.g. 1200, Airwallex EUR). */
  bankAccount: string;
  airwallexTransferId?: string;
}

export interface JournalLine {
  glAccount: string;
  debitCents: number;
  creditCents: number;
  description?: string;
  costCentre?: string;
  vatCode?: VatCode;
}

/** One currency per entry: every ERP here takes one currency per journal entry. */
export interface JournalEntry {
  id: string;
  date: string;
  currency: string;
  memo: string;
  /** What the entry comes from: a transfer id, a document hash, an invoice number. */
  sourceRef: string;
  lines: JournalLine[];
}

export type ObjectKind = "vendor" | "invoice" | "payment" | "journal";
export type CanonicalObject = Vendor | PurchaseInvoice | Payment | JournalEntry;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const whole = (n: number) => Number.isSafeInteger(n);
/** A control or invisible format character (a bidi override, a zero-width space, a terminal escape): never sent to an ERP. */
const HIDDEN = /[\p{Cc}\p{Cf}]/u;
const hiddenIn = (who: string, fields: Record<string, string | undefined>): string[] =>
  Object.entries(fields).filter(([, v]) => v !== undefined && HIDDEN.test(v)).map(([k]) => `${who}: the ${k} holds control or direction characters`);

function dateOk(d: string): boolean {
  return DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
}

/** Cents as the two-decimal number an ERP's JSON body carries. Refuses anything but whole cents. */
export function amount(cents: number): number {
  if (!whole(cents)) throw new Error(`amount: ${cents} is not whole cents`);
  return Number((cents / 100).toFixed(2));
}

export function validateVendor(v: Vendor): string[] {
  const e: string[] = [];
  if (!v.id) e.push("vendor: no id");
  if (!v.name?.trim()) e.push("vendor: no name");
  e.push(...hiddenIn(`vendor ${v.id}`, { name: v.name, "VAT number": v.vatId }));
  if (!CURRENCY.test(v.currency)) e.push(`vendor ${v.id}: currency ${JSON.stringify(v.currency)} is not a three-letter code`);
  if (v.ibanSha256 !== undefined && !HEX64.test(v.ibanSha256)) e.push(`vendor ${v.id}: the IBAN hash is not SHA-256 hex`);
  if (v.iban !== undefined && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v.iban)) e.push(`vendor ${v.id}: the IBAN is malformed`);
  if (v.bic !== undefined && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(v.bic)) e.push(`vendor ${v.id}: the BIC is malformed`);
  return e;
}

export function validateInvoice(inv: PurchaseInvoice): string[] {
  const e: string[] = [];
  const who = `invoice ${inv.id}`;
  if (!inv.id || !inv.vendorId || !inv.number?.trim()) e.push(`${who}: id, vendor and number are required`);
  if (!dateOk(inv.issueDate) || !dateOk(inv.dueDate)) e.push(`${who}: issue and due date must be YYYY-MM-DD`);
  if (!CURRENCY.test(inv.currency)) e.push(`${who}: currency ${JSON.stringify(inv.currency)} is not a three-letter code`);
  if (!HEX64.test(inv.documentSha256)) e.push(`${who}: the document hash is not SHA-256 hex`);
  if (inv.lines.length === 0) e.push(`${who}: no lines`);
  e.push(...hiddenIn(who, { number: inv.number, ...Object.fromEntries(inv.lines.map((l, i) => [`description of line ${i + 1}`, l.description])) }));
  const nums = [...inv.lines.flatMap((l) => [l.netCents, l.vatCents]), inv.totals.netCents, inv.totals.vatCents, inv.totals.grossCents];
  if (!nums.every(whole)) {
    e.push(`${who}: every amount must be whole cents`);
    return e;
  }
  for (const [i, l] of inv.lines.entries()) {
    if (!l.glAccount) e.push(`${who}: line ${i + 1} has no GL account`);
    if (!(VAT_CODES as readonly string[]).includes(l.vatCode)) e.push(`${who}: line ${i + 1} has an unknown VAT code ${JSON.stringify(l.vatCode)}`);
  }
  const net = inv.lines.reduce((s, l) => s + l.netCents, 0);
  const vat = inv.lines.reduce((s, l) => s + l.vatCents, 0);
  if (net !== inv.totals.netCents) e.push(`${who}: the net of the lines (${net}) is not the net total (${inv.totals.netCents})`);
  if (vat !== inv.totals.vatCents) e.push(`${who}: the VAT of the lines (${vat}) is not the VAT total (${inv.totals.vatCents})`);
  if (inv.totals.netCents + inv.totals.vatCents !== inv.totals.grossCents) e.push(`${who}: net plus VAT is not the gross total`);
  return e;
}

export function validatePayment(p: Payment): string[] {
  const e: string[] = [];
  const who = `payment ${p.id}`;
  if (!p.id || !p.invoiceId || !p.vendorId) e.push(`${who}: id, invoice and vendor are required`);
  if (!dateOk(p.date)) e.push(`${who}: the date must be YYYY-MM-DD`);
  if (!whole(p.amountCents)) e.push(`${who}: the amount must be whole cents`);
  else if (p.amountCents <= 0) e.push(`${who}: the amount must be more than zero`);
  if (!CURRENCY.test(p.currency)) e.push(`${who}: currency ${JSON.stringify(p.currency)} is not a three-letter code`);
  if (!p.bankAccount) e.push(`${who}: no bank account`);
  return e;
}

export function validateJournal(j: JournalEntry): string[] {
  const e: string[] = [];
  const who = `journal entry ${j.id}`;
  if (!j.id) e.push("journal entry: no id");
  if (!dateOk(j.date)) e.push(`${who}: the date must be YYYY-MM-DD`);
  if (!CURRENCY.test(j.currency)) e.push(`${who}: currency ${JSON.stringify(j.currency)} is not a three-letter code`);
  if (j.lines.length < 2) e.push(`${who}: needs at least two lines`);
  if (!j.lines.every((l) => whole(l.debitCents) && whole(l.creditCents))) {
    e.push(`${who}: every amount must be whole cents`);
    return e;
  }
  for (const [i, l] of j.lines.entries()) {
    if (!l.glAccount) e.push(`${who}: line ${i + 1} has no GL account`);
    if (l.debitCents < 0 || l.creditCents < 0 || (l.debitCents > 0) === (l.creditCents > 0)) e.push(`${who}: line ${i + 1} must be either a debit or a credit, above zero`);
  }
  const d = j.lines.reduce((s, l) => s + l.debitCents, 0);
  const c = j.lines.reduce((s, l) => s + l.creditCents, 0);
  if (d !== c) e.push(`${who} does not balance: debits ${d}, credits ${c}`);
  return e;
}

export function validate(kind: ObjectKind, o: CanonicalObject): string[] {
  switch (kind) {
    case "vendor": return validateVendor(o as Vendor);
    case "invoice": return validateInvoice(o as PurchaseInvoice);
    case "payment": return validatePayment(o as Payment);
    case "journal": return validateJournal(o as JournalEntry);
  }
}

/**
 * What an ERP would see of an object, without the PDF or the full IBAN: the document's hash (documentSha256) and the
 * IBAN's hash stand in for them. Whether the PDF's file is on this machine is not content, so it is not in here.
 */
function hashable(kind: ObjectKind, o: CanonicalObject): Json {
  if (kind === "invoice") {
    const { pdf: _pdf, ...rest } = o as PurchaseInvoice;
    return rest as unknown as Json;
  }
  if (kind === "vendor") {
    const { iban: _iban, ...rest } = o as Vendor;
    return rest as unknown as Json;
  }
  return o as unknown as Json;
}

const hashOf = (kind: ObjectKind, what: Json) => sha256Hex(jcs({ kind, object: JSON.parse(JSON.stringify(what)) as Json }));

/** SHA-256 over the RFC 8785 canonical JSON of what an ERP would see: same content, same hash, in any key order. */
export function contentHash(kind: ObjectKind, o: CanonicalObject): string {
  return hashOf(kind, hashable(kind, o));
}

/**
 * The hash as it was made until 12 November 2026. For an invoice it also held whether a PDF went along (`pdf`: its
 * file name, or null), so the same invoice hashed differently on a machine without the file. The sync runner still
 * recognises a row sent under it (src/erp/sync.ts); nothing new is hashed this way.
 */
export function contentHashBefore(kind: ObjectKind, o: CanonicalObject, pdf: { fileName: string } | null): string {
  if (kind !== "invoice") return contentHash(kind, o);
  return hashOf(kind, { ...(hashable(kind, o) as Record<string, Json>), pdf: pdf ? { fileName: pdf.fileName } : null });
}
