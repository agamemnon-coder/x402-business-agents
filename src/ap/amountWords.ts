// An amount written out in English words ("six hundred and forty euro only"), as invoices and cheques print it beside
// the figures (20 Nov, after the held-out eval v12, v12-limit-kilkenny-words-differ: "Amount due: nine hundred and forty
// euro only" under a total of EUR 640.00 was paid). Where the words and the figures differ, what is owed is not one
// amount: src/ap/checkerCore.ts holds the invoice for a person (ambiguous_total). Pure.

const UNITS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Readonly<Record<string, number>> = { hundred: 100, thousand: 1_000, million: 1_000_000 };
const WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(SCALES), "and", "a"].join("|")})`;
const NUMBER = `${WORD}(?:[\\s-]+${WORD})*`;
const MAJOR = "(?:euros?|dollars?|pounds?(?:\\s+sterling)?|francs?)";
const MINOR = "(?:cents?|pence|centimes?)";
const PHRASE = new RegExp(`\\b(${NUMBER})\\s+${MAJOR}\\b(?:[\\s,]+(?:and\\s+)?(${NUMBER})\\s+${MINOR}\\b)?`, "giu");

/** A number written in English words, or null when the words are no number ("and" alone). */
export function wordsToNumber(words: string): number | null {
  let total = 0, current = 0, seen = false;
  for (const w of words.toLowerCase().split(/[\s-]+/).filter(Boolean)) {
    if (w === "and") continue;
    if (w === "a") { current = Math.max(current, 1); continue; }
    if (w in UNITS) { current += UNITS[w]!; seen = true; continue; }
    const scale = SCALES[w];
    if (scale === undefined) return null;
    seen = true;
    if (scale === 100) current = Math.max(current, 1) * 100;
    else { total += Math.max(current, 1) * scale; current = 0; }
  }
  return seen ? total + current : null;
}

/** Each amount the text writes out in English words, in cents, with the words. */
export function amountsInWords(text: string): { cents: number; words: string }[] {
  const out: { cents: number; words: string }[] = [];
  for (const m of text.matchAll(PHRASE)) {
    const major = wordsToNumber(m[1]!);
    if (major === null) continue;
    const minor = m[2] ? wordsToNumber(m[2]) : 0;
    if (minor === null || minor > 99) continue;
    out.push({ cents: major * 100 + minor, words: m[0].trim() });
  }
  return out;
}

/** Why the amount in words is not the invoice's total, or null (no amount in words, or the same one). */
export function wordsDifferFromTotal(text: string, totalCents: number): string | null {
  const off = amountsInWords(text).find((a) => a.cents !== totalCents);
  return off ? `the invoice writes "${off.words}" in words, ${(off.cents / 100).toFixed(2)}, not its total ${(totalCents / 100).toFixed(2)}; a person checks what is owed` : null;
}
