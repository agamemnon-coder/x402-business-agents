// Payables, part 2: what a supplier invoice says, read without a model (English, Dutch and German labels), and the
// check a model's reading must pass before it is used. Pure: no database, no Node modules.
//
// The parser never throws: a field it cannot find is left empty, and the checks (src/ap/checks.ts) say what is
// missing. A model's reading is used only when its invoice number, total and IBAN are in the document itself and agree
// with what the parser reads there: a model that followed a planted line, or invented a number, is not used.

import { z } from "zod";

export interface ApReading {
  vendor: string;
  vat_id: string;
  invoice_no: string;
  /** YYYY-MM-DD, or "". */
  issue_date: string;
  /** YYYY-MM-DD, or "". */
  due_date: string;
  /** ISO 4217 code, or "". */
  currency: string;
  /** Plain decimals with two places ("1554.62"), or "". */
  subtotal: string;
  tax: string;
  total: string;
  /** Without spaces, upper case, or "". */
  iban: string;
  bic: string;
  reference: string;
  /** An expense account from the chart the model suggests; code accepts it only from the chart (src/ap/books.ts). */
  gl_account: string;
}

export const ApReadingSchema = z.object({
  vendor: z.string(),
  vat_id: z.string(),
  invoice_no: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  tax: z.string(),
  total: z.string(),
  iban: z.string(),
  bic: z.string(),
  reference: z.string(),
  gl_account: z.string(),
});

/** The model's instruction. The expense accounts are listed so a suggestion can be checked against the chart. */
export function apInstruction(expenseAccounts: Record<string, string>): string {
  const chart = Object.entries(expenseAccounts).map(([n, name]) => `${n} ${name}`).join("; ");
  return [
    "Extract this supplier invoice. Use an empty string for any field the document does not state.",
    "vendor: the issuing company's legal name. vat_id: the issuer's VAT number. invoice_no: the invoice number.",
    "issue_date and due_date as YYYY-MM-DD. currency: the ISO code of the total.",
    "subtotal, tax and total: plain decimals with two decimals and no thousands separators (total is the amount due).",
    "iban without spaces, bic, reference: the payment reference.",
    `gl_account: the one expense account that fits best, from this list only: ${chart}.`,
  ].join("\n");
}

const EMPTY: ApReading = { vendor: "", vat_id: "", invoice_no: "", issue_date: "", due_date: "", currency: "", subtotal: "", tax: "", total: "", iban: "", bic: "", reference: "", gl_account: "" };

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  januari: 1, februari: 2, maart: 3, mei: 5, juni: 6, juli: 7, augustus: 8, oktober: 10,
  januar: 1, februar: 2, märz: 3, maerz: 3, dezember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999)) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : "";
}

/** A written date as YYYY-MM-DD, or "": ISO, day-month-year with - . or /, or with the month in words. */
export function readDate(text: string): string {
  const s = text.trim().toLowerCase();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /(\d{1,2})\.?\s+([a-zäéû]+)\.?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2]!]) return ymd(Number(m[3]), MONTHS[m[2]!]!, Number(m[1]));
  m = /([a-zäéû]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1]!]) return ymd(Number(m[3]), MONTHS[m[1]!]!, Number(m[2]));
  return "";
}

/** "1,554.62", "1.000,00", "400,00", "1 190,00" -> "1554.62" etc.; anything without exactly two decimals -> "". */
export function decimalAmount(token: string): string {
  const t = token.replace(/[\u00a0\u202f]/g, " ").trim();
  const m = /^(\d{1,3}(?:([.,' ])\d{3})*|\d+)([.,])(\d{2})$/.exec(t);
  if (!m) return "";
  if (m[2] && m[2] === m[3]) return "";
  const whole = m[1]!.replace(/[.,' ]/g, "").replace(/^0+(?=\d)/, "");
  return `${whole}.${m[4]}`;
}

const AMOUNT_TOKEN = /\d[\d.,' \u00a0\u202f]*\d/g;

/** The last two-decimal amount on a line, or "" (a percentage or an id on the same line is skipped). */
function lastAmount(line: string): string {
  const found = [...line.matchAll(AMOUNT_TOKEN)].map((x) => {
    // "EUR 1 190,00" may have run on into a following number; try the token, then its tail after a space.
    const tok = x[0];
    const whole = decimalAmount(tok);
    if (whole) return whole;
    const tail = tok.split(/\s+/).pop() ?? "";
    return decimalAmount(tail);
  }).filter(Boolean);
  return found.at(-1) ?? "";
}

/** Every currency a line names: symbols and ISO codes. */
function currenciesOf(line: string): string[] {
  const out = new Set<string>();
  if (/€|\bEUR\b/i.test(line)) out.add("EUR");
  if (/£|\bGBP\b/i.test(line)) out.add("GBP");
  if (/\bUSD\b|US\$|\$/i.test(line)) out.add("USD");
  for (const m of line.matchAll(/\b(CHF|SEK|NOK|DKK|PLN|CZK|HKD|SGD|AUD|CAD|JPY|CNY|NZD|TRY|HUF|RON|BGN)\b/g)) out.add(m[1]!);
  return [...out];
}

/** The one currency a line names, or "" (none, or more than one). */
function currencyOf(line: string): string {
  const c = currenciesOf(line);
  return c.length === 1 ? c[0]! : "";
}

/**
 * The invoice's currency: the total line's; else the subtotal's or the tax line's when they agree; else the one
 * currency the whole text names. Several currencies and none on those lines: "" (a person decides). A euro sign in a
 * footer ("late payment fee: €40,00") never makes a SEK invoice EUR.
 */
function invoiceCurrency(ls: string[], total: { line: string } | null): string {
  if (total) {
    const c = currencyOf(total.line);
    if (c) return c;
  }
  const near = [labelledAmount(ls, SUBTOTAL), labelledAmount(ls, TAX)].flatMap((x) => (x ? [currencyOf(x.line)] : [])).filter(Boolean);
  if (near.length && near.every((c) => c === near[0])) return near[0]!;
  const all = new Set(ls.flatMap(currenciesOf));
  return all.size === 1 ? [...all][0]! : "";
}

/** Whether the total is written as negative ("-1,850.00", "EUR -1.850,00") or in brackets ("(1,850.00)"): a credit. */
export function totalIsNegative(text: string): boolean {
  const total = labelledAmount(lines(text ?? ""), TOTAL);
  if (!total) return false;
  return /(?:^|[\s:=€$£])[-\u2212\u2013]\s*(?:(?:€|\$|£|[A-Z]{3})\s*)?\d/.test(total.line) || /\(\s*(?:€|\$|£|[A-Z]{3})?\s*\d[\d.,' \u00a0]*\)/.test(total.line);
}


const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The first line that starts with one of the labels and carries a two-decimal amount. */
function labelledAmount(ls: string[], labels: RegExp): { amount: string; line: string } | null {
  for (const l of ls) {
    if (!labels.test(l)) continue;
    const amount = lastAmount(l);
    if (amount) return { amount, line: l };
  }
  return null;
}

/** A line that names the document rather than its issuer (a heading above the letterhead). */
const HEADING = /^(?:(?:tax\s+)?invoice|factuur|rechnung|credit\s*note|creditnota|gutschrift|payment\s+reminder|reminder|betalingsherinnering|herinnering|aanmaning|zahlungserinnerung|mahnung|receipt|kwitantie|quittung)\b/i;

const TOTAL = /^(?:total\s+due|amount\s+due|amount\s+payable|total\s+payable|balance\s+due|total\s+amount|invoice\s+total|grand\s+total|totaal\s+te\s+betalen|te\s+betalen|totaalbedrag|factuurbedrag|gesamtbetrag|gesamtsumme|rechnungsbetrag|zu\s+zahlen|endbetrag|endsumme|total|totaal)(?![a-z])/i;
const SUBTOTAL = /^(?:sub-?total|subtotaal|net\s+amount|nettobetrag|zwischensumme|netto)(?![a-z])/i;
const TAX = /^(?:vat|btw|mwst\.?|ust\.?|tax|sales\s+tax|umsatzsteuer)(?![a-z])/i;

function firstMatch(text: string, re: RegExp): string {
  return re.exec(text)?.[1]?.trim() ?? "";
}

/** The IBAN after an "IBAN" label, exactly as long as its country's IBANs are (a BIC on the same line is not read into it). */
function ibanIn(text: string): string {
  const m = /IBAN[ \t]*:?[ \t]*([A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){10,30})/i.exec(text);
  if (!m) return "";
  const run = m[1]!.replace(/\s+/g, "").toUpperCase();
  const len = IBAN_LENGTHS[run.slice(0, 2)];
  return len && run.length >= len ? run.slice(0, len) : run;
}

/** IBAN length per country, from the SWIFT IBAN registry (ISO 13616). A country not listed is not accepted. */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

/** ISO 13616: a known country, its exact length, and the mod-97 check. */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (IBAN_LENGTHS[s.slice(0, 2)] !== s.length) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Everything the document's own lines say, without a model. Never throws. */
export function parseApFallback(text: string): ApReading {
  const ls = lines(text ?? "");
  if (ls.length === 0) return { ...EMPTY };
  const total = labelledAmount(ls, TOTAL);
  const invoiceNo =
    firstMatch(text, /(?:invoice\s*(?:no\.?|number|nr\.?|#)|factuurnummer|factuurnr\.?|rechnungsnummer|rechnungs-?nr\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/.]*\d[A-Z0-9\-/.]*)/i) ||
    firstMatch(text, /\b(?:invoice|factuur|rechnung)\s+#?\s*([A-Z0-9][A-Z0-9\-/.]*\d[A-Z0-9\-/.]*)/i);
  const due = firstMatch(text, /^\s*(?:due\s+date|payment\s+due|due|vervaldatum|uiterste\s+betaaldatum|fällig\s+am|fällig|zahlbar\s+bis|zahlungsziel)\s*:?\s*(.+)$/im);
  const issued = firstMatch(text, /^\s*(?:invoice\s+date|date\s+of\s+issue|issue\s+date|factuurdatum|rechnungsdatum|datum|date)\s*:?\s*(.+)$/im);
  const reference = firstMatch(text, /^\s*(?:payment\s+reference|reference|ref\.?|betalingskenmerk|kenmerk|verwendungszweck)\s*:?\s*(\S+)/im);
  return {
    vendor: ls.find((l) => /\p{L}/u.test(l) && !HEADING.test(l)) ?? "",
    vat_id: firstMatch(text, /\b(?:VAT(?:\s*(?:ID|number|no\.?|reg\.?\s*no\.?))?|BTW(?:-nummer|\s*nr\.?|-id)?|USt-?IdNr\.?|UID)\s*:?\s*([A-Z]{2}[A-Z0-9]{8,12})\b/).toUpperCase(),
    invoice_no: invoiceNo,
    issue_date: issued ? readDate(issued) : "",
    due_date: due ? readDate(due) : "",
    currency: invoiceCurrency(ls, total),
    subtotal: labelledAmount(ls, SUBTOTAL)?.amount ?? "",
    tax: labelledAmount(ls, TAX)?.amount ?? "",
    total: total?.amount ?? "",
    iban: ibanIn(text),
    bic: firstMatch(text, /\b(?:BIC|SWIFT(?:\/BIC)?)\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/).toUpperCase(),
    reference: reference || invoiceNo,
    gl_account: "",
  };
}

const compact = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const MONEY = /^\d+\.\d{2}$/;

/** Every two-decimal amount written in the document. */
export function amountsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const l of lines(text)) {
    for (const x of l.matchAll(AMOUNT_TOKEN)) {
      const a = decimalAmount(x[0]) || decimalAmount(x[0].split(/\s+/).pop() ?? "");
      if (a) out.add(a);
    }
  }
  return out;
}

/**
 * Why a model's reading is not used, or null. Its invoice number, total and IBAN must be written in the document, and
 * where the document's own lines give one, the same.
 */
export function readingCheck(r: ApReading, text: string): string | null {
  if (!MONEY.test(r.total)) return `the total ${JSON.stringify(r.total)} is not a plain amount with two decimals`;
  const doc = compact(text);
  if (!r.invoice_no || !doc.includes(compact(r.invoice_no))) return `the invoice number ${JSON.stringify(r.invoice_no)} is not in the document`;
  if (!amountsIn(text).has(r.total)) return `the total ${r.total} is not in the document`;
  if (r.iban && !doc.includes(compact(r.iban))) return "the IBAN is not in the document";
  const own = parseApFallback(text);
  // A model's figure alone is never accepted: the document's own total line must give the same (red team B).
  if (!own.total) return "the document's own lines give no total that code can check the reading against";
  // The currency too: when the document's lines name one it must be the model's; when they are ambiguous, a person decides (A).
  if (!own.currency) return "the document's own lines do not say the currency unambiguously";
  const differ: string[] = (["total", "iban", "invoice_no", "currency"] as const).filter((k) => own[k] && compact(own[k]) !== compact(r[k] ?? ""));
  // A subtotal or tax the document's lines give may not be dropped or changed (dropping them skips the sum check).
  for (const k of ["subtotal", "tax"] as const) if (own[k] && own[k] !== r[k]) differ.push(k);
  return differ.length ? `the reading differs from the document's own lines: ${differ.join(", ").replace(/_/g, " ")}` : null;
}
