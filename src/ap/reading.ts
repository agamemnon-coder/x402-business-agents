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
  /** Where there is no IBAN (a US, Chinese or UK account): the account number, without spaces, or "". */
  account_number: string;
  /** "aba", "sort_code" or "cnaps" when the invoice names a routing code, else "". */
  routing_type: string;
  routing_value: string;
  /** ISO 3166 alpha-2 country of the bank: from the IBAN, a "Bank country" line or the BIC, or "". */
  bank_country: string;
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
  account_number: z.string(),
  routing_type: z.string(),
  routing_value: z.string(),
  bank_country: z.string(),
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
    "Where the invoice gives no IBAN: account_number without spaces, routing_type (aba, sort_code or cnaps) and routing_value as written, bank_country as the ISO 3166 code of the bank's country.",
    `gl_account: the one expense account that fits best, from this list only: ${chart}.`,
  ].join("\n");
}

const EMPTY: ApReading = { vendor: "", vat_id: "", invoice_no: "", issue_date: "", due_date: "", currency: "", subtotal: "", tax: "", total: "", iban: "", bic: "", account_number: "", routing_type: "", routing_value: "", bank_country: "", reference: "", gl_account: "" };

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

function currencyOf(line: string): string {
  if (/€|\bEUR\b/i.test(line)) return "EUR";
  if (/£|\bGBP\b/i.test(line)) return "GBP";
  if (/\bUSD\b|US\$|\$/i.test(line)) return "USD";
  const iso = /\b(CHF|SEK|NOK|DKK|PLN|CZK|HKD|SGD|AUD|CAD|JPY|CNY|NZD|TRY)\b/.exec(line);
  return iso ? iso[1]! : "";
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

const TOTAL = /^(?:total\s+due|amount\s+due|balance\s+due|total\s+amount|grand\s+total|totaal\s+te\s+betalen|te\s+betalen|totaalbedrag|gesamtbetrag|rechnungsbetrag|zu\s+zahlen|endbetrag|total|totaal)(?![a-z])/i;
const SUBTOTAL = /^(?:sub-?total|subtotaal|net\s+amount|nettobetrag|zwischensumme|netto)(?![a-z])/i;
const TAX = /^(?:vat|btw|mwst\.?|ust\.?|tax|sales\s+tax|umsatzsteuer)(?![a-z])/i;

function firstMatch(text: string, re: RegExp): string {
  return re.exec(text)?.[1]?.trim() ?? "";
}

/** The IBAN after an "IBAN" label, the longest prefix of the run that passes its checksum. */
function ibanIn(text: string): string {
  const m = /IBAN[ \t]*:?[ \t]*([A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){10,30})/i.exec(text);
  if (!m) return "";
  const run = m[1]!.replace(/\s+/g, "").toUpperCase();
  for (let n = run.length; n >= 15; n--) if (ibanValid(run.slice(0, n))) return run.slice(0, n);
  return run;
}

/** ISO 13616 mod-97 check. */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** An account without an IBAN (US, China, UK), its routing code, and the bank's country. */
function accountOf(text: string, iban: string, bic: string): Pick<ApReading, "account_number" | "routing_type" | "routing_value" | "bank_country"> {
  const number = firstMatch(text, /(?:account\s*(?:no\.?|number|nr\.?|#)|acct\.?\s*no\.?|rekeningnummer|kontonummer)\s*:?\s*([A-Z0-9][A-Z0-9 -]{4,40}[A-Z0-9])\s*$/im)
    .replace(/[\s-]/g, "").toUpperCase();
  const aba = firstMatch(text, /\b(?:ABA(?:\s*(?:routing\s*)?(?:no\.?|number))?|routing\s*(?:no\.?|number))\s*:?\s*(\d{9})\b/i);
  const sort = firstMatch(text, /\bsort\s*code\s*:?\s*(\d{2}[- ]?\d{2}[- ]?\d{2})\b/i).replace(/[- ]/g, "");
  const cnaps = firstMatch(text, /\bCNAPS(?:\s*code)?\s*:?\s*(\d{12})\b/i);
  const routing = aba ? { routing_type: "aba", routing_value: aba } : sort ? { routing_type: "sort_code", routing_value: sort } : cnaps ? { routing_type: "cnaps", routing_value: cnaps } : { routing_type: "", routing_value: "" };
  const named = firstMatch(text, /^\s*(?:bank\s+country|country\s+of\s+(?:the\s+)?bank)\s*:?\s*([A-Z]{2})\b/im).toUpperCase();
  const country = iban ? iban.slice(0, 2) : named || (bic.length >= 6 ? bic.slice(4, 6) : "");
  return { account_number: iban ? "" : number, ...routing, bank_country: country };
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
  const iban = ibanIn(text);
  const bic = firstMatch(text, /\b(?:BIC|SWIFT(?:\/BIC)?(?:\s+code)?)\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/).toUpperCase();
  return {
    vendor: ls.find((l) => /\p{L}/u.test(l) && !HEADING.test(l)) ?? "",
    vat_id: firstMatch(text, /\b(?:VAT(?:\s*(?:ID|number|no\.?|reg\.?\s*no\.?))?|BTW(?:-nummer|\s*nr\.?|-id)?|USt-?IdNr\.?|UID)\s*:?\s*([A-Z]{2}[A-Z0-9]{8,12})\b/).toUpperCase(),
    invoice_no: invoiceNo,
    issue_date: issued ? readDate(issued) : "",
    due_date: due ? readDate(due) : "",
    currency: total ? currencyOf(total.line) || currencyOf(text) : currencyOf(text),
    subtotal: labelledAmount(ls, SUBTOTAL)?.amount ?? "",
    tax: labelledAmount(ls, TAX)?.amount ?? "",
    total: total?.amount ?? "",
    iban,
    bic,
    ...accountOf(text, iban, bic),
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
  if (r.account_number && !doc.replace(/-/g, "").includes(compact(r.account_number).replace(/-/g, ""))) return "the account number is not in the document";
  const own = parseApFallback(text);
  const differ = (["total", "iban", "account_number", "routing_value"] as const).filter((k) => own[k] && r[k] && compact(own[k]) !== compact(r[k]));
  return differ.length ? `the reading differs from the document's own lines: ${differ.join(", ")}` : null;
}
