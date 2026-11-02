// How Purser reads a number a person typed: one reader for every place that takes a typed amount or count (the Try
// page, Ask Purser, the CFO's policy in plain words, supplier invoices). Red team, 2 November: "2.500 SKUs" became 3
// stock checks on Try, "€2.5" was read as 25 and "0.0400 EUR" as 400. People here write Dutch ("1.850,00") and English
// ("1,850.00") notation, so both are read, by these rules, in this order. Nothing is ever rounded: a number is read
// exactly, or refused with the reason.
//
//   1. Digits only: a whole number ("2500").
//   2. Both a dot and a comma: the last one is the decimal mark, the other groups thousands ("1.850,00", "1,850.00").
//      Groups must be three digits ("1.85,00" is refused).
//   3. One mark, more than once: it groups thousands ("1.000.000"), in groups of three, or the number is refused.
//   4. One mark, once, with 1, 2 or 4+ digits after it: the decimal mark ("2,50", "2.50", "2.5", "0.0400").
//   5. One mark, once, with exactly 3 digits after it ("2.500", "2,500"): thousands, unless
//      a. the part before it is 0 or more than 3 digits ("0.045", "1234.500"): then it is a decimal mark;
//      b. the field is money (cents) with no currency sign or code next to it, and another number in the same message
//         uses that same mark as its decimal mark ("0.04 each ... 2.500"): then 2.50 and 2,500.00 are both plausible,
//         and it is refused as ambiguous. A currency sign or code ("€2.500", "2.500 EUR", "$2.500") settles it as
//         thousands: money is written with two decimals at most. A count settles it as thousands: a count of checks,
//         seats or SKUs is a whole number, so "2.500 SKUs" is 2,500 (and the cost cap then decides).
//   6. The field: a count must come out whole ("2,5 checks" is refused); money must fit in cents ("0.045" is refused,
//      not rounded; "0.0400" is 0.04 exactly).
// Invoices are stricter (`invoice`): a decimal part is exactly two digits, and a space may group thousands.

export type NumberField = "count" | "money";
export type DecimalMark = "." | ",";
/** `value` is cents for money, the whole number for a count. */
export type NumberReading = { ok: true; value: number } | { ok: false; why: string };

export interface ReadContext {
  /** The message writes a currency sign or code next to this number (rule 5b). */
  currency?: boolean;
  /** Marks that other numbers in the same message use as their decimal mark (rule 5b). */
  decimalMarksElsewhere?: ReadonlySet<DecimalMark>;
  /** Invoices: decimals exactly two digits; a space (or a no-break space) may group thousands. */
  invoice?: boolean;
}

const CURRENCY_BEFORE = /^(?:EUR|USDZ|USD|€|\$)\s*/i;
const CURRENCY_AFTER = /\s*(?:EUR|USDZ|USD|euros?|dollars?|€|\$)$/i;
const SPACES = /[\u00a0\u202f]/g;

const fmtCents = (c: number) => `${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(c % 100).padStart(2, "0")}`;

/** Thousands grouped by one mark, in groups of three: "1.000.000", "2,500", "1 850". */
const GROUPED: Record<string, RegExp> = { ".": /^\d{1,3}(?:\.\d{3})+$/, ",": /^\d{1,3}(?:,\d{3})+$/, " ": /^\d{1,3}(?: \d{3})+$/ };

/** The shape of a written number: its whole digits, its decimal digits, and what (if anything) was ambiguous. */
type Shape = { whole: string; frac: string; mark: DecimalMark | null; ambiguous: DecimalMark | null } | { bad: string };

function shapeOf(s: string, invoice: boolean): Shape {
  if (!(invoice ? /^\d[\d., ]*$/ : /^\d[\d.,]*$/).test(s) || /[., ]$/.test(s)) return { bad: `${s} is not a number` };
  const seps = [...new Set(s.replace(/\d/g, ""))];
  const grouped = (body: string, g: string) => GROUPED[g]?.test(body) ?? false;
  const notGroups = { bad: `${s} cannot be read: its dots and commas are not groups of three digits` };
  if (seps.length === 0) return { whole: s, frac: "", mark: null, ambiguous: null };
  if (seps.length > 2) return notGroups;
  if (seps.length === 2) {
    const d = s[Math.max(s.lastIndexOf("."), s.lastIndexOf(","), s.lastIndexOf(" "))]!;
    if (d === " " || s.split(d).length !== 2) return notGroups;
    const [body, frac] = s.split(d) as [string, string];
    const g = seps.find((x) => x !== d)!;
    if (!grouped(body, g)) return notGroups;
    return { whole: body.split(g).join(""), frac, mark: d as DecimalMark, ambiguous: null };
  }
  const c = seps[0]!;
  const parts = s.split(c);
  if (parts.length > 2 || c === " ") return grouped(s, c) ? { whole: parts.join(""), frac: "", mark: null, ambiguous: null } : notGroups;
  const [before, after] = parts as [string, string];
  const mark = c as DecimalMark;
  if (after.length !== 3 || /^0/.test(before) || before.length > 3) return { whole: before, frac: after, mark, ambiguous: null };
  return { whole: before + after, frac: "", mark: null, ambiguous: mark };
}

/**
 * Reads one written number (it may carry a currency sign or code: "€2.500", "1.850,00 EUR") as money in cents or as a
 * whole count, by the rules above; a refusal says why in words a person can act on.
 */
export function readNumber(written: string, field: NumberField, ctx: ReadContext = {}): NumberReading {
  let s = written.trim().replace(SPACES, " ");
  const bare = s.replace(CURRENCY_BEFORE, "").replace(CURRENCY_AFTER, "");
  const currency = bare !== s || !!ctx.currency;
  s = bare.trim();
  const shape = shapeOf(s, !!ctx.invoice);
  if ("bad" in shape) return { ok: false, why: shape.bad };
  if (shape.ambiguous && field === "money" && !currency && !ctx.invoice && ctx.decimalMarksElsewhere?.has(shape.ambiguous)) {
    const small = Number(`${shape.whole.slice(0, -3)}.${shape.whole.slice(-3)}`);
    return { ok: false, why: `${s} could be ${small.toFixed(2)} or ${fmtCents(Number(shape.whole) * 100)}: this message also writes "${shape.ambiguous}" as a decimal point. Write it with a currency sign (€${s}) or without the dot or comma` };
  }
  const frac = shape.frac.replace(/0+$/, "");
  let value: number;
  if (field === "count") {
    if (frac !== "") return { ok: false, why: `${s} is not a whole number, and a count must be one` };
    value = Number(shape.whole);
  } else {
    if (ctx.invoice && shape.mark !== null && shape.frac.length !== 2) return { ok: false, why: `${s} does not have two decimals` };
    if (frac.length > 2) return { ok: false, why: `${s} has more decimals than cents; it would have to be rounded, so it is not used` };
    value = Number(shape.whole) * 100 + Number(frac.padEnd(2, "0"));
  }
  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, why: `${s} is too large` };
}

/** A number as written in a message, where it is, and the currency written next to it (if any). */
export interface NumberToken { raw: string; index: number; end: number; currency: "EUR" | "USD" | null }

const TOKEN = /\d[\d.,]*\d|\d/g;

/** Every number written in a text, in order, with the currency sign or code next to it. */
export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const index = m.index;
    const end = index + m[0].length;
    const before = text.slice(Math.max(0, index - 6), index);
    const after = text.slice(end, end + 9);
    const b = /(?:^|[^A-Za-z])(EUR|USDZ|USD|€|\$)\s?$/i.exec(before)?.[1];
    const a = /^\s?(€|\$|eur(?:os?)?|usdz?|dollars?)(?![A-Za-z])/i.exec(after)?.[1];
    const sign = (b ?? a ?? "").toLowerCase();
    const currency = sign === "" ? null : sign === "€" || sign.startsWith("eur") ? "EUR" : "USD";
    out.push({ raw: m[0], index, end, currency });
  }
  return out;
}

/** The decimal mark a written number uses beyond doubt, or null (none, or rule 5: it may be a thousands mark). */
export function decimalMarkOf(raw: string): DecimalMark | null {
  const shape = shapeOf(raw, false);
  return "bad" in shape ? null : shape.mark;
}

/** Each number of a text read as `field`, in the context of the whole text (rule 5b looks at the other numbers). */
export function readAllIn(text: string, field: NumberField): (NumberToken & { reading: NumberReading })[] {
  const tokens = numberTokens(text);
  return tokens.map((t, i) => {
    const elsewhere = new Set(tokens.filter((_, j) => j !== i).map((o) => decimalMarkOf(o.raw)).filter((m): m is DecimalMark => m !== null));
    return { ...t, reading: readNumber(t.raw, field, { decimalMarksElsewhere: elsewhere, currency: t.currency !== null }) };
  });
}

/** Every number in a text, read as money. */
export const moneyIn = (text: string) => readAllIn(text, "money");

/** The cents of every number in a text that reads as money (ambiguous and malformed ones are left out). */
export function centsWritten(text: string): number[] {
  return moneyIn(text).flatMap((m) => (m.reading.ok ? [m.reading.value] : []));
}

/**
 * Whether `cents` is an amount the text writes: yes, or no with the reason. When a number in the text could be this
 * amount but is ambiguous (rule 5b), the reason says so, instead of "not in the message".
 */
export function writtenAmount(text: string, cents: number): { ok: true } | { ok: false; why: string | null } {
  const all = moneyIn(text);
  if (all.some((m) => m.reading.ok && m.reading.value === cents)) return { ok: true };
  for (const m of all) {
    if (m.reading.ok) continue;
    const alone = readNumber(m.raw, "money");
    if (alone.ok && alone.value === cents) return { ok: false, why: m.reading.why };
  }
  return { ok: false, why: null };
}
