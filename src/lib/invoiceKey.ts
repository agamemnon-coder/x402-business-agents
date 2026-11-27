import { CONFUSABLES, skeleton } from "../policy/fraudCore.js";

/** Any dash, with the spaces around it: one "-" in an invoice number as compared. */
const DASH = /\s*[‐-―−﹘﹣－-]\s*/g;

/**
 * An invoice number as a duplicate check compares it: Unicode-normalised, invisible format characters (zero-width
 * spaces, soft hyphens) removed, upper case, any dash as "-", no spaces around it.
 */
export function invoiceKey(invoiceNo: string): string {
  return invoiceNo.normalize("NFKC").replace(/\p{Cf}/gu, "").toUpperCase().replace(DASH, "-").replace(/\s+/g, "");
}

/**
 * A payment reference's words, normalised as invoiceKey normalises a number (Unicode, invisible characters, upper case,
 * any dash as "-") but split wherever a character cannot be part of an invoice number (spaces, punctuation other than
 * "-" and "/"), with a dash or slash at a word's ends dropped. Review of 26 Nov: a reference names an invoice only as a
 * whole word, so "NW-1077" never names NW-10.
 */
export function referenceTokens(reference: string): string[] {
  return reference.normalize("NFKC").replace(/\p{Cf}/gu, "").toUpperCase().replace(DASH, "-")
    .split(/[^\p{L}\p{N}/-]+/u).map((t) => t.replace(/^[-/]+|[-/]+$/g, "")).filter(Boolean);
}

/** Whether a payment reference names this invoice number as a whole word. */
export const referenceNames = (reference: string, invoiceNo: string): boolean => referenceTokens(reference).includes(invoiceKey(invoiceNo));

/**
 * A word of the reference shaped like one of these invoice numbers (the same letters before its first "-" or "/", and
 * a digit) that is none of them: "NW-1077" when NW-10 and NW-11 are on file. Null when there is none.
 */
export function unknownInvoiceWord(reference: string, invoiceNos: readonly string[]): string | null {
  const keys = new Set(invoiceNos.map(invoiceKey));
  const prefixes = new Set([...keys].map((k) => /^[\p{L}]+[-/]/u.exec(k)?.[0]).filter((x): x is string => !!x));
  return referenceTokens(reference).find((t) => !keys.has(t) && /\p{N}/u.test(t) && [...prefixes].some((p) => t.startsWith(p))) ?? null;
}

/** A decimal digit of any script ("٢", "२", "２") as its value, or null. Unicode keeps each script's 0-9 in one run of ten. */
function digitValue(ch: string): number | null {
  if (!/^\p{Nd}$/u.test(ch)) return null;
  let cp = ch.codePointAt(0)!;
  let start = cp;
  while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
  cp -= start;
  return cp % 10;
}

/**
 * One character as a reader sees it in a number: any script's digit as its ASCII digit; a lookalike letter as its Latin
 * one (the fraud check's confusables: Cyrillic "В" is "b"); and "O" as zero, "I" and "l" as one, which a number's
 * reader cannot tell apart (red team round 2: "ВTX-2026-21", "BTX-2O26-21", "BTX-2026-2l", "BTX-٢٠٢٦-٢١").
 */
function seen(ch: string): string {
  const d = digitValue(ch);
  if (d !== null) return String(d);
  const lower = ch.toLowerCase();
  const latin = CONFUSABLES[lower] ?? lower;
  return latin === "o" ? "0" : latin === "l" || latin === "i" ? "1" : latin;
}

/**
 * The same number however it is punctuated or written (red team, 8 November: "BTX-2026-021", "BTX/2026/21",
 * "BTX.2026.21" and "BTX202621" are one invoice; round 2: lookalike letters and other scripts' digits too): what a
 * reader sees, letters and digits only, leading zeros dropped from each group of digits. Coarser than invoiceKey, so a
 * match on this alone is a possible duplicate for a person, never proof of one.
 */
export function invoiceKeyLoose(invoiceNo: string): string {
  const shown = [...invoiceKey(invoiceNo).normalize("NFKD").replace(/\p{M}/gu, "")].map(seen).join("");
  const groups = shown.match(/[\p{L}]+|\d+/gu) ?? [];
  return groups.map((g) => (/^\d+$/.test(g) ? g.replace(/^0+(?=\d)/, "") : g)).join("");
}

/** Whether two invoice numbers are the same invoice however punctuated (the guard before any money moves). */
export function sameInvoiceNo(a: string, b: string): boolean {
  return invoiceKeyLoose(a) === invoiceKeyLoose(b);
}

/** The separator the payables inbox puts between a supplier's number and its name in the payment ledger (src/ap/ledgerKey.ts). */
export const LEDGER_SEPARATOR = " · ";

/** Who an invoice in the payment ledger is from, as far as is known: the supplier's name and its account's hash. */
export interface LedgerParty { vendor?: string | null; accountSha256?: string | null }

/** A ledger number split into the supplier's own number and, for the inbox's form "NUM · Supplier", the supplier. */
export function ledgerParts(ledgerNo: string): { no: string; vendor: string | null } {
  const at = ledgerNo.lastIndexOf(LEDGER_SEPARATOR);
  return at < 0 ? { no: ledgerNo, vendor: null } : { no: ledgerNo.slice(0, at), vendor: ledgerNo.slice(at + LEDGER_SEPARATOR.length).trim() || null };
}

/**
 * Whether two payment-ledger numbers are the same invoice (red team round 3: the inbox files "BTX-2026-21 · Bergtex
 * Textil GmbH", Kit 11 the bare "BTX-2026-21", and each guard missed the other): the supplier's numbers are the same
 * however written, and the supplier is the same, by name (its skeleton) or by the account it is paid to (a supplier on
 * file under a second name: round 3). An invoice whose supplier is not known matches any supplier's: before money
 * moves, the guard errs on refusing.
 */
export function sameLedgerInvoice(a: string, aParty: LedgerParty, b: string, bParty: LedgerParty): boolean {
  const x = ledgerParts(a);
  const y = ledgerParts(b);
  if (!sameInvoiceNo(x.no, y.no)) return false;
  const xv = x.vendor ?? aParty.vendor ?? null;
  const yv = y.vendor ?? bParty.vendor ?? null;
  if (!xv || !yv) return true;
  if (skeleton(xv) === skeleton(yv)) return true;
  return !!aParty.accountSha256 && aParty.accountSha256 === bParty.accountSha256;
}

/** The one ledger read negotiatedOriginal makes (a better-sqlite3 handle; no import, so the Worker bundles this file). */
export interface LedgerReader { prepare(sql: string): { get(...params: unknown[]): unknown } }

/**
 * The bill a payment-ledger number pays when it is a negotiation's agreed invoice (src/negotiate/rails.ts agreedInvoiceNo:
 * "<original>-<sha8>"): the original number its signed terms name, negotiation.original_invoice_no; else null. 27 Nov
 * (red team, runner finding 2): the bill as issued and its agreed invoice are one bill, paid once.
 */
export function negotiatedOriginal(db: LedgerReader, invoiceNo: string): string | null {
  const r = db.prepare(`SELECT json_extract(terms_json, '$.negotiation.original_invoice_no') AS o FROM proposals
    WHERE kind IN ('invoice_payment', 'supplier_payment') AND json_extract(terms_json, '$.invoice_no') = ?
      AND json_extract(terms_json, '$.negotiation.original_invoice_no') IS NOT NULL LIMIT 1`).get(invoiceNo) as { o?: unknown } | undefined;
  return typeof r?.o === "string" && r.o ? r.o : null;
}

/** One entry of the payment ledger as the duplicate guards compare it: its number, who it is from, and its bill's original number when it is an agreed invoice. */
export interface LedgerBill { no: string; party: LedgerParty; original: string | null }

/**
 * Whether two ledger entries pay the same bill: the same invoice (sameLedgerInvoice), or one is a negotiation's agreed
 * invoice of the other, or both are agreed invoices of one original (27 Nov, red team, runner finding 2).
 */
export function sameBill(a: LedgerBill, b: LedgerBill): boolean {
  const xs = a.original ? [a.no, a.original] : [a.no];
  const ys = b.original ? [b.no, b.original] : [b.no];
  return xs.some((x) => ys.some((y) => sameLedgerInvoice(x, a.party, y, b.party)));
}
