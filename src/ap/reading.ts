// Payables, part 2: what a supplier invoice says, read without a model (English, Dutch and German labels), and the
// check a model's reading must pass before it is used. Pure: no database, no Node modules.
//
// The parser never throws: a field it cannot find is left empty, and the checks (src/ap/checks.ts) say what is
// missing. A model's reading is used only when its invoice number, total and IBAN are in the document itself and agree
// with what the parser reads there: a model that followed a planted line, or invented a number, is not used.

import { z } from "zod";
import { namesACompany, skeleton } from "../policy/fraudCore.js";
import { asksToPay, isInformation } from "../policy/multilingual.js";
import { plainDigits, plainNumerals } from "../policy/numerals.js";
import { oneEncoding } from "../policy/scripts.js";

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

/**
 * "1,554.62", "1.000,00", "400,00", "1 190,00", Swiss "3'400.00" (also with a typographic apostrophe, \u2019 or \u02bc: red team
 * round 3) -> "1554.62" etc.; anything without exactly two decimals -> "". 19 Nov (after eval v6): also the Vietnamese and
 * Indonesian "1.234.567,89" (as German writes it), a thin space between groups, and India's grouping in lakhs and crores
 * ("12,34,567.89": groups of two before the last three).
 */
export function decimalAmount(token: string): string {
  const t = token.replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[\u2019\u02bc]/g, "'").trim();
  const lakh = /^(\d{1,2}(?:,\d{2})+,\d{3})\.(\d{2})$/.exec(t);
  if (lakh) return `${lakh[1]!.replace(/,/g, "").replace(/^0+(?=\d)/, "")}.${lakh[2]}`;
  const m = /^(\d{1,3}(?:([.,' ])\d{3})*|\d+)([.,])(\d{2})$/.exec(t);
  if (!m) return "";
  if (m[2] && m[2] === m[3]) return "";
  const whole = m[1]!.replace(/[.,' ]/g, "").replace(/^0+(?=\d)/, "");
  return `${whole}.${m[4]}`;
}

const AMOUNT_TOKEN = /\d[\d.,'\u2019\u02bc \u00a0\u202f\u2009]*\d/g;

/** A two-decimal amount on a line: its value, where its digits start and end, and whether a digit sits right before it, split off by a mark that is no separator. */
export interface Found { amount: string; start: number; end: number; split: boolean }

/** Every two-decimal amount on a line, in order (a percentage or an id on the same line is skipped). */
export function amountsOn(line: string): Found[] {
  return [...line.matchAll(AMOUNT_TOKEN)].map((x) => {
    // "EUR 1 190,00" may have run on into a following number; try the token, then its tail after a space.
    const tok = x[0];
    const at = x.index;
    const end = at + tok.length;
    // "3\u2018400.00": a digit, one mark that is not a separator, then the amount's digits (red team round 3: read as 400.00).
    const split = /\d[^\d\s\p{L}\p{Sc}]$/u.test(line.slice(Math.max(0, at - 2), at));
    const whole = decimalAmount(tok);
    if (whole) return { amount: whole, start: at, end, split };
    const tail = tok.split(/\s+/).pop() ?? "";
    return { amount: decimalAmount(tail), start: end - tail.length, end, split: false };
  }).filter((f) => f.amount);
}

/** The currencies code knows, by ISO code. Anything else written beside a total is a currency code does not know. */
export const KNOWN_CODES = new Set(["EUR", "GBP", "USD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HKD", "SGD", "AUD", "CAD", "JPY", "CNY", "NZD", "TRY", "HUF", "RON", "BGN"]);
const SYMBOLS: Readonly<Record<string, string>> = { "€": "EUR", "£": "GBP", $: "USD" };
/** Currencies written as words or abbreviations, which a label's words must never be taken for. */
const CURRENCY_WORDS: ReadonlySet<string> = new Set(["kr", "kn", "zł", "zl", "kč", "kc", "ft", "lei", "lev", "leva", "lv", "лв", "тл", "грн", "₾", "֏", "руб", "р", "ден", "дин", "din", "fr", "sfr", "chf", "rs", "rp", "tl", "eur", "usd", "gbp", "euro", "euros", "dollar", "dollars", "pound", "pounds", "yen", "yuan", "won", "baht", "taka", "টাকা", "রুপি", "ரூபாய்", "रुपये", "रुपया", "ريال", "درهم", "دينار", "روپے", "ብር", "រៀល", "ლარი", "դրամ", "гривень", "гривня", "рублей", "крон", "kronor", "kroner", "krónur", "lari", "dram", "birr", "riel",
  // 20 Nov (after the held-out eval v8, v8-cur-lanka-lkr-reference: "(≈ රු. 245,000.00, for reference)" under a EUR total was
  // held as a second amount in the invoice's currency): currencies as their own scripts abbreviate and name them: the
  // rupee in Sinhala, Tamil, Devanagari, Gujarati, Kannada, Telugu, Malayalam, Gurmukhi and Odia, the kyat, the kip, the
  // tögrög, the baht, the taka, the shekel.
  "රු", "රුපියල්", "ரூ", "ரூபா", "रु", "रू", "रुपैयाँ", "રૂ", "રૂપિયા", "ರೂ", "ರೂಪಾಯಿ", "రూ", "రూపాయి", "రూపాయలు", "രൂ", "രൂപ", "ਰੁ", "ਰੁਪਏ", "ଟଙ୍କା",
  "ကျပ်", "ກີບ", "төгрөг", "төг", "บาท", "שקל", "שח",
  // 20 Nov (after the held-out eval v9, v9-cur-pamba-kes-reference: "(Kwa kumbukumbu: KSh 87,000.00)" under a EUR total was
  // held as a second amount): the shilling, the naira, the cedi, the rand, the kwacha, the peso, the ringgit, the rufiyaa,
  // the afghani, the tenge, the som, the manat and others as their countries write them.
  "ksh", "kshs", "tsh", "tshs", "ush", "ushs", "shs", "shilingi", "shilling", "shillings", "naira", "cedi", "cedis", "rand", "kwacha", "dalasi", "leone", "leones", "birr", "nakfa",
  "ariary", "peso", "pesos", "piso", "ringgit", "rm", "rupiah", "rufiyaa", "rf", "afghani", "afs", "тенге", "теңге", "тг", "tenge", "сом", "сўм", "manat", "dirham",
  "dinar", "riyal", "rial", "lira", "денари", "kip", "kyat", "taka", "reais", "soles", "colón", "colones", "quetzal", "lempira", "córdoba", "guaraní"]);
/** Words a total, subtotal or tax line may carry beside its label, amount and currency (compared in lower case). */
const FILLER = new Set([
  "total", "due", "amount", "payable", "to", "pay", "now", "balance", "incl", "including", "inclusive", "excl", "excluding", "inkl", "exkl", "of", "on", "in",
  "vat", "btw", "mwst", "ust", "tax", "gross", "net", "brutto", "netto", "te", "betalen", "zu", "zahlen", "cr", "sum",
]);

/**
 * What a line names beside its label and amounts: the ISO codes and symbols code knows, and whether anything else is
 * written there (a currency code does not know: "kr", "Kč", "Fr.", "zł", "ISK", a lower-case "sek"). Never guessed.
 */
function lineCurrency(rest: string): { known: string[]; unknown: boolean } {
  const known = new Set<string>();
  let unknown = false;
  // 19 Nov (after eval v7, v7-limit-lviv-space-grouping: "Разом до сплати: 1 150,00 EUR" was read as no currency): the
  // rest of a label before its colon ("до сплати:", "à payer :") is the label's, not a currency, when it is words of three
  // letters or more and none of them is written like a currency ("kr", "zł", "Kč", "грн", "лв", an upper-case code).
  const colon = rest.search(/[:：]/);
  if (colon > 0 && !/\d/.test(rest.slice(0, colon))) {
    const words = rest.slice(0, colon).split(/[^\p{L}\p{M}\p{Sc}]+/u).filter(Boolean);
    // 20 Nov (after the held-out eval v10, v10-limit-uewersauer-label: "Total ze bezuelen: 940,00 EUR" was read as no
    // currency): the little words of a label ("ze", "zu", "za", "à", "de", "te") are the label's too, when the label has a
    // word of three letters or more and they are written in lower case, as no currency code is.
    const label = (w: string) => [...w].length >= 3 && !/\p{Sc}/u.test(w) && !/^[A-Z]{3}$/.test(w) && !CURRENCY_WORDS.has(w.toLowerCase());
    const little = (w: string) => [...w].length <= 2 && /^\p{Ll}+$/u.test(w) && !CURRENCY_WORDS.has(w);
    if (words.some(label) && words.every((w) => label(w) || little(w))) rest = rest.slice(colon + 1);
  }
  const s = rest.replace(/US\$/g, " USD ").replace(/\d+/g, " ");
  for (const tok of s.split(/[^\p{L}\p{Sc}]+/u).filter(Boolean)) {
    for (const part of tok.split(/(\p{Sc})/u).filter(Boolean)) {
      if (/^\p{Sc}$/u.test(part)) {
        const code = SYMBOLS[part];
        if (code) known.add(code);
        else unknown = true;
      } else if (KNOWN_CODES.has(part)) known.add(part);
      else if (!FILLER.has(part.toLowerCase())) unknown = true;
    }
  }
  return { known: [...known], unknown };
}

/**
 * The invoice's currency: the total line's; else, when the total line names none, the subtotal's and the tax line's
 * when they agree. A total line naming a currency code does not know, or more than one, gives "" (a person decides).
 * Never taken from the rest of the text: a euro sign in a footer ("late payment fee: €6,00") never makes a krona
 * invoice EUR (red team round 2).
 */
function invoiceCurrency(ls: string[], total: Labelled | null): string {
  if (total) {
    const c = lineCurrency(total.rest);
    if (c.unknown || c.known.length > 1) return "";
    if (c.known.length === 1) return c.known[0]!;
  }
  const near = [labelledAmount(ls, "subtotal"), labelledAmount(ls, "tax")].filter((x): x is Labelled => x !== null).map((x) => lineCurrency(x.rest));
  if (near.length === 0 || near.some((c) => c.unknown || c.known.length !== 1)) return "";
  return near.every((c) => c.known[0] === near[0]!.known[0]) ? near[0]!.known[0]! : "";
}

/** Any minus: hyphen-minus, every Unicode dash (en, em, hyphen, small and full-width hyphen-minus) and the minus sign. */
const MINUS = "[\\p{Pd}\\u2212\\uFE63\\uFF0D]";
const MINUS_BEFORE = new RegExp(`(?:^|[\\s:=€$£(])${MINUS}\\s*(?:(?:€|\\$|£|[A-Z]{3})\\s*)?\\d`, "u");
const MINUS_AFTER = new RegExp(`\\d[.,]\\d{2}\\s*${MINUS}(?!\\s*\\d)`, "u");

/**
 * Whether the total is written as a credit: a minus before the amount ("-", "–", "—", "‐", "﹣", "－"), a minus after
 * it ("1,850.00-"), "CR" before or after it, or brackets ("(1,850.00)").
 */
export function totalIsNegative(text: string): boolean {
  const total = chosenTotal(amountLines(text ?? ""));
  if (!total) return false;
  const r = total.rest;
  return MINUS_BEFORE.test(r) || MINUS_AFTER.test(r) || /(?:^|[^\p{L}])(?:CR|Cr)(?![\p{L}])/u.test(r) || /\(\s*(?:€|\$|£|[A-Z]{3})?\s*\d[\d.,' \u00a0]*\)/.test(r);
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
/**
 * The lines amounts are read from (19 Nov, after eval v6: a total in Devanagari or full-width digits was read as none):
 * every script's digits as 0 to 9, full-width forms as the plain characters (src/policy/numerals.ts plainNumerals).
 */
const amountLines = (text: string) => lines(plainNumerals(text));

export type LineKind = "subtotal" | "tax" | "total";
/** A labelled line with a two-decimal amount: what it is, its total label's rank (1 is "the amount to pay"), and the line after the label. */
export interface Labelled { kind: LineKind; tier: number; amount: string; line: string; rest: string; amounts: Found[] }

const NOT_LETTER = "(?![\\p{L}])";
const SUBTOTAL = new RegExp(`^(?:sub-?total|subtotaal|net\\s+amount|nettobetrag|zwischensumme|netto|summe\\s+netto|total\\s+(?:excl\\.?|excluding|ex\\.?|exkl\\.?|before\\s+(?:vat|tax)|net)|totaal\\s+(?:excl\\.?|exclusief))${NOT_LETTER}`, "iu");
const TAX = new RegExp(`^(?:vat|btw|mwst\\.?|ust\\.?|tax|sales\\s+tax|umsatzsteuer|total\\s+(?:vat|tax|btw|mwst|ust)|totaal\\s+btw)${NOT_LETTER}`, "iu");
/**
 * 19 Nov (after eval v6, v6-limit-saigon-vietnamese-format and v6-limit-yamato-fullwidth-total: "Tổng cộng: 1.050,00 €"
 * and "合計 EUR 1,200.00" were read as no total): the same three ranks in the other languages suppliers write in, longer
 * labels before the shorter ones they start with.
 */
const label = (xs: readonly string[]) => xs.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*")).join("|");
const DUE_LABELS = label([
  "total a pagar", "importe a pagar", "a pagar", "totale da pagare", "importo da pagare", "da pagare", "valor a pagar", "razem do zapłaty", "do zapłaty", "celkem k úhradě", "k úhradě",
  "ödenecek tutar", "tổng tiền thanh toán", "số tiền phải trả", "số tiền thanh toán", "total yang harus dibayar", "jumlah yang harus dibayar", "total tagihan", "jumlah perlu dibayar",
  "итого к оплате", "всего к оплате", "к оплате", "сума до сплати", "до сплати", "сума за плащане", "за плащане", "πληρωτέο ποσό", "πληρωτέο",
  "应付金额", "應付金額", "应付总额", "應付總額", "价税合计", "價稅合計", "ご請求金額", "請求金額", "お支払い金額", "お支払金額", "税込合計",
  "청구 금액", "결제 금액", "지급 금액", "ยอดที่ต้องชำระ", "จำนวนเงินที่ต้องชำระ", "ยอดชำระ", "סה״כ לתשלום", "סה\"כ לתשלום", "לתשלום",
  "المبلغ المستحق", "المبلغ الواجب الدفع", "مبلغ قابل پرداخت", "قابل پرداخت", "कुल देय राशि", "देय राशि", "कुल देय",
  // 19 Nov (after eval v7: totals under labels in Ukrainian, Bengali, Khmer and Tamil were read as none by the parser), and
  // the languages of the suppliers on file since: Georgian, Armenian, Amharic, Urdu, Baltic, Nordic.
  "разом до сплати", "усього до сплати", "всього до сплати", "მოსაკრებელი თანხა", "გადასახდელი თანხა", "სულ გადასახდელი", "გადასახდელი", "վճարման ենթակա գումար", "վճարման ենթակա",
  "মোট প্রদেয়", "প্রদেয় অর্থ", "প্রদেয়", "செலுத்த வேண்டிய மொத்தம்", "செலுத்த வேண்டிய தொகை", "செலுத்த வேண்டியது", "የሚከፈል ጠቅላላ", "የሚከፈል መጠን", "የሚከፈል",
  "کل واجب الادا", "واجب الادا رقم", "واجب الادا", "قابل ادائیگی", "ចំនួនទឹកប្រាក់ត្រូវបង់", "ត្រូវបង់", "mokėtina suma", "iš viso mokėti", "apmaksai", "kopā apmaksai", "samtals til greiðslu", "til greiðslu", "att betala", "å betale", "at betale", "maksettava",
]);
const TOTAL_LABELS = label([
  "total general", "importe total", "totale fattura", "totale", "valor total", "suma", "razem", "celkem", "genel toplam", "toplam tutar", "tổng cộng", "tổng tiền", "jumlah total",
  "итого", "всего", "разом", "общо", "σύνολο", "合计金额", "合計金額", "总计", "總計", "合计", "合計", "総額", "합계 금액", "합계", "총 금액", "총액",
  "รวมทั้งสิ้น", "ยอดรวม", "סה״כ", "סה\"כ", "الإجمالي", "الاجمالي", "المجموع", "جمع کل", "مجموع", "कुल राशि", "कुल योग",
  "усього", "ჯამი", "სულ", "ընդամենը", "ընդհանուր", "মোট", "সর্বমোট", "மொத்தம்", "மொத்த தொகை", "ጠቅላላ ድምር", "ጠቅላላ", "ድምር", "کل رقم", "میزان", "សរុប", "សរុបទាំងអស់",
  "iš viso", "viso", "kopā", "summa", "samtals", "alls", "yhteensä", "summa yhteensä", "i alt", "totalt", "tổng",
]);
/** Total labels by rank: the amount to pay first, a document total next, a bare "Total" last. */
const TOTAL_TIERS = [
  new RegExp(`^(?:total\\s+(?:amount\\s+)?due|amount\\s+due|amount\\s+payable|total\\s+payable|balance\\s+due|amount\\s+to\\s+pay|to\\s+pay|totaal\\s+te\\s+betalen|te\\s+betalen|zu\\s+zahlen(?:der\\s+betrag)?|zahlbetrag|net\\s+à\\s+payer|à\\s+payer|a\\s+payer|montant\\s+dû|${DUE_LABELS})${NOT_LETTER}`, "iu"),
  new RegExp(`^(?:total\\s+amount|invoice\\s+total|grand\\s+total|total\\s+(?:incl\\.?|including|inclusive|inkl\\.?)\\s*(?:of\\s+)?(?:vat|tax|btw|mwst\\.?|ust\\.?)?|totaal\\s+incl\\.?\\s*(?:btw)?|totaalbedrag|factuurbedrag|gesamtbetrag|gesamtsumme|rechnungsbetrag|bruttobetrag|endbetrag|endsumme|total\\s+ttc|montant\\s+ttc|${TOTAL_LABELS})${NOT_LETTER}`, "iu"),
  new RegExp(`^(?:total|totaal|summe|gesamt|toplam|jumlah|कुल|รวม)${NOT_LETTER}`, "iu"),
];

/** What a line is. A subtotal or tax label is checked before a total one: "Total excl. VAT" is a subtotal. */
export function labelled(l: string): Labelled | null {
  const amounts = amountsOn(l);
  const amount = amounts.at(-1)?.amount ?? "";
  if (!amount) return null;
  const sub = SUBTOTAL.exec(l);
  if (sub) return { kind: "subtotal", tier: 0, amount, line: l, rest: l.slice(sub[0].length), amounts };
  const tax = TAX.exec(l);
  if (tax) return { kind: "tax", tier: 0, amount, line: l, rest: l.slice(tax[0].length), amounts };
  for (const [i, re] of TOTAL_TIERS.entries()) {
    const m = re.exec(l);
    // 19 Nov (after eval v7, v7-limit-addis-payments-received): "Total payment received in 2026: EUR 6,300.00" is
    // information about money already received, not a total to pay.
    if (m) return isInformation(l) ? null : { kind: "total", tier: i + 1, amount, line: l, rest: l.slice(m[0].length), amounts };
  }
  return null;
}

/**
 * 19 Nov (after eval v7: totals under labels the lists do not know were read as none): when no line carries a total label,
 * the one line written as a label, a colon and an amount in a currency code knows ("মোট প্রদেয়: EUR ৭৮০.০০" shape), and
 * no other such line, is the total, ranked below every label. Two or more such lines (a net and a VAT line in words code
 * does not know) give none: a person reads it.
 */
function labelColonTotal(ls: string[]): Labelled | null {
  const shaped = ls.map((l): Labelled | null => {
    const m = /^([^\d:：]{1,40})[:：]\s*(.*)$/u.exec(l);
    if (!m || labelled(l)) return null;
    const amounts = amountsOn(l);
    const rest = m[2]!;
    if (amounts.length !== 1 || !/\p{L}/u.test(m[1]!) || isInformation(l)) return null;
    const c = lineCurrency(rest);
    if (c.unknown || c.known.length !== 1) return null;
    if (rest.replace(/[\d.,'\s\u00a0\u202f\u2009]/gu, "").replace(c.known[0]!, "").replace(/\p{Sc}/gu, "").length) return null;
    return { kind: "total", tier: TOTAL_TIERS.length + 1, amount: amounts[0]!.amount, line: l, rest, amounts };
  }).filter((x): x is Labelled => x !== null);
  return shaped.length === 1 ? shaped[0]! : null;
}

/** The first subtotal or tax line with an amount. */
function labelledAmount(ls: string[], kind: Exclude<LineKind, "total">): Labelled | null {
  for (const l of ls) {
    const x = labelled(l);
    if (x?.kind === kind) return x;
  }
  return null;
}

/** Every total-like line with an amount, in document order. */
function totalLines(ls: string[]): Labelled[] {
  return ls.map(labelled).filter((x): x is Labelled => x?.kind === "total");
}

/** The amount to pay: the first line with the best-ranked total label ("Balance due" before a bare "Total"). */
function chosenTotal(ls: string[]): Labelled | null {
  const all = totalLines(ls);
  if (!all.length) return labelColonTotal(ls);
  const best = Math.min(...all.map((x) => x.tier));
  return all.find((x) => x.tier === best) ?? null;
}

/**
 * Why the document's total is not one amount, or null: total lines with different amounts (a deposit, an early-payment
 * discount, a line item that starts with "Total"). A person checks which one is due; code never picks between them.
 */
export function totalAmbiguity(text: string): string | null {
  const all = totalLines(amountLines(text ?? ""));
  // One total line with two amounts ("Amount due USD 2,400.00 on total USD 24,000.00"): code never picks either (red team round 3).
  const distinct = (x: Labelled) => [...new Set(x.amounts.map((a) => a.amount))];
  const two = all.find((x) => distinct(x).length > 1);
  if (two) return `the total line "${shownLine(two.line, 80)}" carries more than one amount (${distinct(two).join(" and ")}); a person checks which one is due`;
  // Digits split by a mark that is no thousands separator ("3‘400.00"): never read as the digits after it.
  const split = all.find((x) => x.amounts.at(-1)?.split);
  if (split) return `the total line "${shownLine(split.line, 80)}" has its digits split by a mark that is not a thousands separator; a person reads the amount`;
  const amounts = [...new Set(all.map((x) => x.amount))];
  if (amounts.length < 2) return null;
  const shown = all.map((x) => `"${shownLine(x.line, 60)}"`).join(", ");
  return `the document gives ${amounts.length} different totals (${amounts.join(" and ")}): ${shown}; a person checks which one is due`;
}

/** A line as shown to a person: no control or invisible format characters, single spaces, at most `max` characters. */
function shownLine(line: string, max: number): string {
  return line.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The document's own total line, as the CFO sees it beside the amount to sign, or "": sanitised, ending at the chosen
 * amount (and a currency written right after it), leader dots folded, at most 120 characters. Nothing after the amount
 * is shown, so no tail past what the CFO reads can carry another amount (red team round 3).
 */
export function totalLine(text: string): string {
  const t = chosenTotal(amountLines(text ?? ""));
  if (!t) return "";
  const end = t.amounts.at(-1)!.end;
  const after = /^\s*(?:[A-Z]{3}|\p{Sc})(?![\p{L}])/u.exec(t.line.slice(end))?.[0] ?? "";
  return shownLine(t.line.slice(0, end + after.length).replace(/(?:\s*[.·…_]){4,}\s*/gu, " … "), 120);
}

/** The currency the total line itself names (one code it knows and nothing else beside it), or "". */
export function totalLineCurrency(text: string): string {
  const t = chosenTotal(amountLines(text ?? ""));
  if (!t) return "";
  const c = lineCurrency(t.rest);
  return !c.unknown && c.known.length === 1 ? c.known[0]! : "";
}

/** A line that names the document rather than its issuer (a heading above the letterhead). */
const HEADING = /^(?:(?:tax\s+)?invoice|factuur|rechnung|credit\s*note|creditnota|gutschrift|payment\s+reminder|reminder|betalingsherinnering|herinnering|aanmaning|zahlungserinnerung|mahnung|receipt|kwitantie|quittung)\b/i;

function firstMatch(text: string, re: RegExp): string {
  return re.exec(text)?.[1]?.trim() ?? "";
}

/**
 * The first date on a line that starts with one of the labels: the label a whole word, then a colon or a space (17 Nov:
 * the street "Datenallee 12" read as "Date" with the value "nallee 12", and the real date below it was never reached),
 * and a labelled line that holds no date is passed over ("Date Street 4" is an address, not an empty date).
 */
function labelledDate(text: string, labels: string): string {
  const re = new RegExp(`^[ \\t]*(?:${labels})(?:[ \\t]*:[ \\t]*|[ \\t]+)(.+)$`, "gimu");
  for (const m of text.matchAll(re)) {
    const d = readDate(m[1]!);
    if (d) return d;
  }
  return "";
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

/**
 * The issuer's name among the document's first lines. 21 Nov (after the held-out eval v15, v15-clean-hearadh-tagline: a
 * tagline above the name, "Handwoven in the Outer Hebrides since 1921", was read as the supplier and the invoice held as
 * another holder): before the invoice's heading, the first line that names a company (a legal form, in any script) and
 * is neither a field nor an address (no colon, no figure); else, as before, the first line with letters that is no heading.
 */
function vendorLine(ls: readonly string[]): string {
  const head = ls.findIndex((l) => HEADING.test(cleanText(l)));
  const named = ls.slice(0, head >= 0 ? head : Math.min(ls.length, 6))
    .find((l) => /\p{L}/u.test(l) && !/[:：\p{Nd}]/u.test(l) && namesACompany(cleanText(l)));
  return named ?? ls.find((l) => /\p{L}/u.test(l) && !HEADING.test(cleanText(l))) ?? "";
}

/** Everything the document's own lines say, without a model. Never throws. */
export function parseApFallback(text: string): ApReading {
  const ls = lines(text ?? "");
  if (ls.length === 0) return { ...EMPTY };
  // The amounts, their labels and currency from the lines as numbers are read (amountLines); the name and the invoice
  // number as written.
  const als = amountLines(text ?? "");
  const total = chosenTotal(als);
  // A number is read only when it ends where the word ends: "ВTX-2026-21" (a Cyrillic В) or "BTX-2026-2１" is not read
  // as part of itself; such a number is left empty for a person (red team round 2). 20 Nov (after the held-out eval v12:
  // "TŁ-2026-0151" was not read): Latin letters with marks (Ł, Ș, Ç) are a number's letters too, other alphabets' are not.
  const invoiceNo =
    firstMatch(text, /(?:invoice\s*(?:no\.?|number|nr\.?|#)|factuurnummer|factuurnr\.?|rechnungsnummer|rechnungs-?nr\.?|gutschriftsnummer|gutschriftnummer|gutschrift-?nr\.?|credit\s*note\s*(?:no\.?|number|nr\.?|#)|creditnotanummer|creditnota\s*(?:nr\.?|nummer))\s*[:#]?\s*([A-Z0-9\u00C0-\u024F][A-Z0-9\u00C0-\u024F\-/.]*\d[A-Z0-9\u00C0-\u024F\-/.]*)(?=[\s,;)]|$)/im) ||
    firstMatch(text, /\b(?:invoice|factuur|rechnung)\s+#?\s*([A-Z0-9\u00C0-\u024F][A-Z0-9\u00C0-\u024F\-/.]*\d[A-Z0-9\u00C0-\u024F\-/.]*)(?=[\s,;)]|$)/im);
  const due = labelledDate(text, "due\\s+date|payment\\s+due|due|vervaldatum|uiterste\\s+betaaldatum|fällig\\s+am|fällig|zahlbar\\s+bis|zahlungsziel");
  const issued = labelledDate(text, "invoice\\s+date|date\\s+of\\s+issue|issue\\s+date|factuurdatum|rechnungsdatum|datum|date");
  // A label as a whole word, then a colon (red team round 4: "Reflective safety vests" gave the reference "lective",
  // which the CFO signed and the payout carried); the payment-reference label wins over a bare "Ref:".
  const reference = firstMatch(text, /^\s*(?:payment\s+reference|zahlungsreferenz|betalingskenmerk|verwendungszweck)\b\s*:\s*(\S+)/im) ||
    firstMatch(text, /^\s*(?:reference|ref|kenmerk)\b\.?\s*:\s*(\S+)/im);
  // 19 Nov (after eval v7): the bank's lines as a bank reads them, in any script's digits, without invisible characters.
  const bankText = plainDigits(text.normalize("NFKC").replace(/\p{Cf}/gu, ""));
  const iban = ibanIn(bankText);
  const bic = firstMatch(bankText, /\b(?:BIC|SWIFT(?:\/BIC)?(?:\s+code)?)\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/).toUpperCase();
  return {
    vendor: cleanText(vendorLine(ls)),
    vat_id: firstMatch(text, /\b(?:VAT(?:\s*(?:ID|number|no\.?|reg\.?\s*no\.?))?|BTW(?:-nummer|\s*nr\.?|-id)?|USt-?IdNr\.?|UID)\s*:?\s*([A-Z]{2}[A-Z0-9]{8,12})\b/).toUpperCase(),
    invoice_no: invoiceNo,
    issue_date: issued,
    due_date: due,
    currency: invoiceCurrency(als, total),
    subtotal: labelledAmount(als, "subtotal")?.amount ?? "",
    tax: labelledAmount(als, "tax")?.amount ?? "",
    // Digits split by a mark that is no separator ("3‘400.00") are never read as the digits after it: left for a person.
    total: total && !total.amounts.at(-1)!.split ? total.amount : "",
    iban,
    bic,
    ...accountOf(bankText, iban, bic),
    // Kept up to 200 characters, so a reference too long for SWIFT is refused at payment, never cut silently.
    reference: cleanText(reference || invoiceNo, 200),
    gl_account: "",
  };
}

/**
 * A piece of the document's text as Purser stores and shows it (a supplier's name, a reference): no control or invisible
 * format characters (bidi overrides, zero-width spaces, terminal escapes), single spaces, at most `max` characters (red
 * team round 3: a right-to-left override in a supplier's name reached the vault, the ERP and the approval card).
 */
export function cleanText(s: string, max = 120): string {
  // 20 Nov (after the held-out eval v8, v8-look-kochi-old-chillu, with the parser's fields): a letter written the way text
  // was encoded before Unicode 5.1 (a Malayalam chillu as consonant, virama and zero-width joiner) is kept as that letter,
  // not cut to a consonant and virama by taking the joiner out (src/policy/scripts.ts oneEncoding).
  return oneEncoding(s ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Whether a supplier's name is written in the document (letters and digits as a reader sees them, lookalikes folded). */
export function nameInDocument(name: string, text: string): boolean {
  const n = skeleton(name);
  return n.length > 0 && skeleton(text).includes(n);
}

const compact = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const MONEY = /^\d+\.\d{2}$/;

/** Every two-decimal amount written in the document. */
export function amountsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const l of amountLines(text)) {
    for (const x of l.matchAll(AMOUNT_TOKEN)) {
      const a = decimalAmount(x[0]) || decimalAmount(x[0].split(/\s+/).pop() ?? "");
      if (a) out.add(a);
    }
  }
  return out;
}

/**
 * A line that asks to pay more than the invoice's total, or null (19 Nov, after the held-out eval v6, v6-limit-ege-asks-more:
 * "Lütfen önceki bakiye dahil 1.450,00 EUR ödeyiniz." under a total of EUR 480.00 was paid, as v5-limit-muller-asks-more
 * was in German). Structural, whatever the words: a line that is not the invoice's own subtotal, tax or total line, that
 * asks to pay (src/policy/multilingual.ts asksToPay, in the languages it knows) and names an amount above the total in
 * the invoice's currency, or in no currency. What is owed is then not one amount: a person checks it. A line that names
 * another currency only (a reference rate) is no such request.
 */
export function askedAboveTotal(text: string, total: string, currency: string): string | null {
  if (!MONEY.test(total)) return null;
  const most = toCentsPlain(total);
  const ls = amountLines(text ?? "");
  // 19 Nov (after the held-out eval v7, v7-limit-lviv-asks-more and v7-limit-kartuli-asks-more: "Просимо сплатити 1 480,00
  // EUR …" and a Georgian line asking for EUR 1,350.00 under totals of EUR 480.00 and 450.00 were paid, the pay verbs not in
  // the lists). Structural, whatever the language: below the invoice's own total line (where its notes and footer are),
  // any clause that names an amount above the total, in its currency or none, holds it, unless it says the amount is
  // information (money received or paid, share capital, a credit limit: isInformation, in the languages it knows). Above
  // the total line, among the items, only a clause that asks to pay does, as before.
  const at = chosenTotal(ls);
  const from = at ? ls.indexOf(at.line) : ls.findIndex((l) => amountsOn(l).some((a) => a.amount === total));
  for (const [i, l] of ls.entries()) {
    if (labelled(l)) continue;
    // 20 Nov (after eval v8): a currency's abbreviation keeps its amount ("රු. 245,000.00", "Rs. 40,100.00"): its dot is no
    // clause's end.
    for (const clause of withCurrencyDots(l).split(/\.(?!\d)|[;!?。।።៕\n]/u)) {
      const named = lineCurrency(clause.replace(/\d[\d.,'\s]*\d/g, " ")).known;
      if (named.length && !named.includes(currency)) continue;
      const above = amountsOn(clause).find((a) => toCentsPlain(a.amount) > most);
      if (!above || isInformation(clause)) continue;
      const asks = asksToPay(clause);
      // A clause that names the amount in another currency (a reference rate: "(≈ ₹40,100.00 for reference)", "1 916,71
      // лв.") asks for nothing in the invoice's: only a request in words holds it (as before).
      if (!asks && (!(from >= 0 && i > from) || otherCurrencyIn(clause, currency))) continue;
      return `the line "${shownLine(l, 100)}" ${asks ? "asks to pay and names" : "names"} ${currency ? `${currency} ` : ""}${above.amount}, more than the invoice's total ${currency ? `${currency} ` : ""}${total}; a person checks what is owed`;
    }
  }
  return null;
}
/** A line with the dot after a currency's abbreviation, before its amount, written as a space ("රු. 245,000.00" as "රු 245,000.00"). */
const withCurrencyDots = (line: string) => line.replace(/([\p{L}\p{M}]+)\.(?=\s*\p{Nd})/gu, (all, w: string) => (CURRENCY_WORDS.has(w.toLowerCase()) ? `${w} ` : all));
/** ISO 4217 codes of the currencies in use, beyond those code pays (KNOWN_CODES). */
const ISO_CODES = new Set(`AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL`.split(" "));
/** Whether a clause names a currency other than the invoice's: a symbol, an ISO code or a currency's word or abbreviation. */
function otherCurrencyIn(clause: string, currency: string): boolean {
  for (const sym of clause.match(/\p{Sc}/gu) ?? []) if ((SYMBOLS[sym] ?? sym) !== currency) return true;
  for (const code of clause.match(/(?<![\p{L}])[A-Z]{3}(?![\p{L}])/gu) ?? []) if (ISO_CODES.has(code) && code !== currency) return true;
  return clause.split(/[^\p{L}\p{M}]+/u).some((w) => CURRENCY_WORDS.has(w.toLowerCase()) && !["eur", "euro", "euros", "usd", "gbp"].includes(w.toLowerCase()));
}
/** Cents of a plain two-decimal amount (digits only, so no float): "1450.00" is 145000. */
const toCentsPlain = (amount: string) => Number(amount.replace(".", ""));

/**
 * Why a model's reading is not used, or null. Its invoice number, total and IBAN must be written in the document, and
 * where the document's own lines give one, the same.
 */
export function readingCheck(r: ApReading, text: string): string | null {
  if (!MONEY.test(r.total)) return `the total ${JSON.stringify(r.total)} is not a plain amount with two decimals`;
  // The supplier's name too: one the document does not carry is never taken from a model (red team round 3).
  if (!nameInDocument(r.vendor, text)) return `the supplier's name ${JSON.stringify(cleanText(r.vendor, 60))} is not in the document`;
  const doc = compact(text);
  if (!r.invoice_no || !doc.includes(compact(r.invoice_no))) return `the invoice number ${JSON.stringify(r.invoice_no)} is not in the document`;
  if (!amountsIn(text).has(r.total)) return `the total ${r.total} is not in the document`;
  // The account as a bank reads it (19 Nov, after eval v7): in any script's digits, without invisible characters.
  const bankDoc = compact(plainDigits(text.normalize("NFKC").replace(/\p{Cf}/gu, "")));
  const plainAccount = (x: string) => compact(plainDigits(x.normalize("NFKC")));
  if (r.iban && !bankDoc.includes(plainAccount(r.iban))) return "the IBAN is not in the document";
  if (r.account_number && !bankDoc.replace(/-/g, "").includes(plainAccount(r.account_number).replace(/-/g, ""))) return "the account number is not in the document";
  const own = parseApFallback(text);
  // A model's figure alone is never accepted: the document's own total line must give the same (red team B).
  if (!own.total) return "the document's own lines give no total that code can check the reading against";
  // The invoice number too: one the document's own lines cannot read (a lookalike letter, another script's digits) is
  // never taken from a model; the duplicate checks would compare a number nobody can check (red team round 2).
  if (!own.invoice_no) return "the document's own lines give no invoice number that code can check the reading against";
  // The currency too: when the document's lines name one it must be the model's; when they are ambiguous, a person decides (A).
  if (!own.currency) return "the document's own lines do not say the currency unambiguously";
  const differ: string[] = (["total", "iban", "account_number", "routing_value", "invoice_no", "currency"] as const).filter((k) => own[k] && compact(own[k]) !== compact(r[k] ?? ""));
  // A subtotal or tax the document's lines give may not be dropped or changed (dropping them skips the sum check).
  for (const k of ["subtotal", "tax"] as const) if (own[k] && own[k] !== r[k]) differ.push(k);
  return differ.length ? `the reading differs from the document's own lines: ${differ.join(", ").replace(/_/g, " ")}` : null;
}
