// What an invoice's printed lines add up to, against the total it asks to be paid (red team, 19 Nov: one line item of
// EUR 1,850.00 under a total of EUR 8,150.00 was read by its total and sent to the CFO with nothing flagged). Read by
// plain code from the document's text: the lines with an amount between its header and its totals block, then the
// totals block down to the total line (its subtotal, VAT, shipping and discount lines). src/ap/checkerCore.ts holds
// the invoice for a person (totals_mismatch) when they do not add up within a cent. Whatever code cannot read
// reliably, it leaves alone (no answer, no finding): an amount without two decimals, a quantity with one price, a
// deposit, another currency, an invoice that says it continues elsewhere, an unpriced line where the lines come short.
// No Node modules: the Worker bundles it.

import { TOTALS } from "./period.js";
import { amountsOn, labelled, type Found } from "./reading.js";

/** Cents: the lines, what the totals block adds to them, and the total; and whether the two agree. */
export interface LineTotals {
  /** The item lines' amounts added up (a discount line subtracted). */
  lines: number;
  /** The lines plus the VAT, shipping and discount lines the totals block prints before the total. */
  withTotals: number;
  total: number;
  /** Whether the lines agree with the total within a cent: alone, with the totals block's lines, or with its subtotal. */
  agree: boolean;
}

/** The most two printed sums may differ by and still agree: a cent, for rounding. */
export const LINE_TOLERANCE_CENTS = 1;

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
/** A line under a label ("Bill to: …", "Due date: …"): the header, not a line item. */
const LABEL = /^[^:]{1,40}:\s/;
const TAX_WORD = /^(?:vat|btw|mwst|ust|tva|iva|tax|sales tax|umsatzsteuer|incl\.?\s+(?:vat|btw|mwst|ust|tax))\b/;
/** An invoice that says it prints only part of its lines. */
const PARTIAL = /\b(carried forward|brought forward|ubertrag|uebertrag|continued|continues|page \d+ of \d+|seite \d+ von \d+|pagina \d+ van \d+|see (?:the )?attached|attached specification|specification attached|siehe anlage|zie bijlage|voir annexe|further items|more items|other items|weitere positionen|overige posten|and \d+ more)\b/;
/** Money already paid or set off: what is due is not the lines. */
const SET_OFF = /\b(deposit|down payment|advance payment|prepaid|already paid|paid on account|payment received|anzahlung|abschlag\w*|bereits (?:bezahlt|gezahlt)|aanbetaling|vooruitbetaald|reeds betaald|acompte|anticipo|deja paye|gutschrift|credit note|creditnota|avoir)\b/;
const DISCOUNT = /\b(discount|rebate|korting|rabatt|nachlass|skonto|remise|descuento|sconto|reduction)\b/;
/** A price per unit: the line's one amount may be the price of one, not of all. */
const PER_UNIT = /\d\s*[x×*]\s+(?:[a-z]{3}\s*|[€$£]\s*)?\d|\d\s+[x×*]\s*(?:[a-z]{3}\s*|[€$£]\s*)?\d|@|\b(?:per|je|pro|par|a|à)\s+(?:pc|pcs|piece|unit|stk|stuck|stuk|st|m|kg|h|hr|hour|uur|stunde|month|monat|maand)\b|\/\s*(?:pc|pcs|unit|stk|stuk|st|m|kg|h|hr|month)\b/i;
/** Money written without two decimals ("EUR 300", "300,- €"), on a line with no two-decimal amount. */
const LOOSE_MONEY = /(?:[€$£]|\b(?:eur|usd|gbp|chf|sek|nok|dkk|pln)\b)\s*\d|\d\s*(?:[€$£]|\b(?:eur|usd|gbp|chf|sek|nok|dkk|pln)\b)|\d,-/i;
const CURRENCIES = /[€$£]|\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|HKD|SGD|AUD|CAD|JPY|CNY|NZD|TRY|HUF|RON|BGN)\b/g;
const SYMBOL: Readonly<Record<string, string>> = { "€": "EUR", $: "USD", "£": "GBP" };
/** A column heading: words only ("Description  Amount", "Pos Article Qty Unit price Net"). */
const HEADING = /^(?:pos\.?|no\.?|nr\.?|#|item|items|article|artikel|description|beschreibung|omschrijving|leistung|bezeichnung|designation|descripcion|descrizione|qty|quantity|menge|anzahl|aantal|unit|units|price|preis|einzelpreis|prijs|amount|betrag|bedrag|montant|importe|importo|net|netto|total|gesamt|totaal|vat|btw|mwst|tax|eur|usd|gbp|[\s/()])+$/;

const cents = (amount: string) => {
  const [whole, rest] = amount.split(".");
  return Number(whole) * 100 + Number(rest);
};

/** Whether the amount on the line is written as negative: a minus or "CR" before or after it, or in brackets. */
function negative(line: string, a: Found): boolean {
  const before = line.slice(0, a.start);
  const after = line.slice(a.end);
  return /[-−–—]\s*(?:[€$£]|[A-Z]{3})?\s*$/u.test(before) || /^\s*-(?!\s*\d)/.test(after)
    || (/\(\s*(?:[€$£]|[A-Z]{3})?\s*$/u.test(before) && /^\s*\)/.test(after)) || /^\s*CR\b/.test(after);
}

/** Whether the line names another currency than the invoice's. */
const otherCurrency = (line: string, currency: string) => [...line.matchAll(CURRENCIES)].some((m) => (SYMBOL[m[0]] ?? m[0]) !== currency);

/**
 * The invoice's lines against its total, or null when there is nothing to compare or code cannot read the lines
 * reliably. `total` is the amount the reading says is due (two decimals), `currency` its currency ("" for any).
 */
export function lineTotals(text: string, total: string, currency = ""): LineTotals | null {
  if (typeof text !== "string" || !/^\d+\.\d{2}$/.test(total ?? "") || PARTIAL.test(fold(text))) return null;
  const ls = text.split(/\r?\n/).map((l) => l.replace(/[\u00a0\u202f]/g, " ").trim()).filter(Boolean);
  const blockAt = ls.findIndex((l) => labelled(l) !== null || TOTALS.test(fold(l)));
  if (blockAt < 0) return null;
  // The lines: after the header (its last labelled line before the first amount: "Bill to: …", "Due date: …"), up to
  // the totals block.
  const before = ls.slice(0, blockAt);
  const firstAmount = before.findIndex((l) => amountsOn(l).length > 0);
  if (firstAmount < 0) return null;
  let start = 0;
  for (let i = 0; i < firstAmount; i++) if (LABEL.test(before[i]!)) start = i + 1;

  let lines = 0;
  let unpriced = false;
  for (const l of before.slice(start)) {
    const f = fold(l);
    const amounts = amountsOn(l);
    if (!amounts.length) {
      if (!/\p{L}/u.test(l) || HEADING.test(f)) continue; // a rule ("-----") or a column heading
      if (LOOSE_MONEY.test(l)) return null; // an amount code cannot read
      // A description run on from or onto a priced line ("(annual prepayment)", "Data licence, November 2026:"), or a
      // line that may be an item printed without its price.
      if (!/^\(|[:,]$/.test(l) && !LABEL.test(l)) unpriced = true;
      continue;
    }
    if (amounts.some((a) => a.split) || SET_OFF.test(f) || (currency && otherCurrency(l, currency))) return null;
    const last = amounts.at(-1)!;
    // Several amounts (a quantity's price and the line's): the line's is the last and the largest; else not known.
    const values = amounts.map((a) => cents(a.amount));
    if (values.length > 1 && cents(last.amount) < Math.max(...values)) return null;
    if (values.length === 1 && PER_UNIT.test(l)) return null;
    lines += negative(l, last) || DISCOUNT.test(f) ? -cents(last.amount) : cents(last.amount);
  }

  // The totals block, down to the line that says the total the reading has.
  const want = cents(total);
  let extras = 0;
  let tax = 0;
  const subtotals: number[] = [];
  let found = false;
  for (const l of ls.slice(blockAt)) {
    const f = fold(l);
    const amounts = amountsOn(l);
    if (!amounts.length) {
      if (/\p{L}/u.test(l) && !LABEL.test(l) && LOOSE_MONEY.test(l)) return null;
      continue;
    }
    if (amounts.some((a) => a.split) || SET_OFF.test(f) || (currency && otherCurrency(l, currency))) return null;
    const last = amounts.at(-1)!;
    const value = cents(last.amount);
    const kind = labelled(l)?.kind ?? null;
    if (kind === "total" && value === want) { found = true; break; }
    const isTax = kind === "tax" || TAX_WORD.test(f);
    if (isTax) tax += negative(l, last) ? -value : value;
    else if (kind !== null || TOTALS.test(f)) subtotals.push(value);
    else extras += negative(l, last) || DISCOUNT.test(f) ? -value : value;
  }
  if (!found) return null;

  const near = (a: number, b: number) => Math.abs(a - b) <= LINE_TOLERANCE_CENTS;
  const withTotals = lines + extras + tax;
  const agree = near(lines, want) || near(lines + extras, want) || near(lines + tax, want) || near(withTotals, want) || subtotals.some((s) => near(lines, s));
  // An unpriced line where the lines come short: perhaps an item printed without its price; code says nothing.
  if (!agree && unpriced && lines < want) return null;
  return { lines, withTotals, total: want, agree };
}
