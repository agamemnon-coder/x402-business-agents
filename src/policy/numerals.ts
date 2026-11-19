// Numbers as other scripts and locales write them (19 Nov, after the held-out adversarial eval v6, docs/evals/adversarial-v6.md:
// with the fields read by Purser's own parser, a total printed in Devanagari digits "EUR ७५०.००", one in full-width forms
// "合計 ＥＵＲ １，２００．００" and one in the Vietnamese way under a Vietnamese label "Tổng cộng: 1.050,00 €" were read as no total
// and held). The root cause: the parser read the ASCII digits 0 to 9 only, so any other script's digits ended a number.
// Every decimal digit Unicode knows (general category Nd) is a digit here, whatever its script; full-width forms are the
// plain characters they show; the Arabic decimal and thousands separators are "." and ",". The grouping conventions
// themselves ("1.234.567,89", "1 234 567,89", "1'234'567.89", India's "12,34,567.89") are read by src/ap/reading.ts
// decimalAmount. Pure: no Node modules.

/**
 * The value of one decimal digit of any script (Unicode general category Nd), or null. Unicode encodes every script's
 * decimal digits as one run of ten, 0 to 9 in order (and some scripts' runs one after another, as the mathematical
 * digits are): a digit's value is its distance from the start of its run of digits, modulo ten.
 */
export function digitValue(ch: string): number | null {
  const cp = ch.codePointAt(0);
  if (cp === undefined || !/^\p{Nd}$/u.test(ch)) return null;
  let start = cp;
  while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/** Every decimal digit of any script (Arabic-Indic, Persian, Devanagari, Bengali, Tamil, Thai, Myanmar, full-width …) written as 0 to 9. */
export function plainDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (d) => (/[0-9]/.test(d) ? d : String(digitValue(d) ?? d)));
}

/** Full-width forms of ASCII (U+FF01 to U+FF5E) as the characters they show, and the ideographic space as a space. */
const fullWidthToAscii = (text: string) => text.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, " ");

/**
 * A text with its numbers as the parser reads them: every script's digits as 0 to 9, full-width letters, digits and
 * punctuation as the plain ones (so "ＥＵＲ １，２００．００" is "EUR 1,200.00"), the Arabic decimal separator (U+066B) as "."
 * and the Arabic thousands separator (U+066C) as ",". Only the lines amounts are read from are read this way: the
 * supplier's name, the invoice number and the screens read the text as it is written.
 */
export function plainNumerals(text: string): string {
  return plainDigits(fullWidthToAscii(text)).replace(/\u066B/g, ".").replace(/\u066C/g, ",");
}
