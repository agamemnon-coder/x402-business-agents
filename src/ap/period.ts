// What an invoice says it bills for, in time: the months of its service period ("Lagerung Dezember 2026", "Service
// period: 01.10.2026 - 31.10.2026") and the dates of its deliveries ("geleverd 15-09-2026", "Lieferdatum: 15.09.2026"),
// read from its printed text by plain code. 19 Nov (adversarial eval v3): the duplicate and split checks
// (src/ap/checkerCore.ts) use them, so a monthly invoice for another month is no copy of last month's, and a delivery
// invoiced again two months later is compared with the invoice of that delivery. Its own invoice date and due date are
// never a period. No imports, so the Worker bundles it.

const MONTHS: Readonly<Record<string, number>> = Object.fromEntries([
  ["january", "januar", "januari", "janvier", "enero", "gennaio", "janeiro", "jan"],
  ["february", "februar", "februari", "fevrier", "febrero", "febbraio", "fevereiro", "feb"],
  ["march", "marz", "maerz", "maart", "mars", "marzo", "marco", "mar"],
  ["april", "avril", "abril", "aprile", "apr"],
  ["may", "mai", "mei", "mayo", "maggio", "maio"],
  ["june", "juni", "juin", "junio", "giugno", "junho", "jun"],
  ["july", "juli", "juillet", "julio", "luglio", "julho", "jul"],
  ["august", "augustus", "aout", "agosto", "aug"],
  ["september", "septembre", "septiembre", "settembre", "setembro", "sep", "sept"],
  ["october", "oktober", "octobre", "octubre", "ottobre", "outubro", "okt", "oct"],
  ["november", "novembre", "noviembre", "novembro", "nov"],
  ["december", "dezember", "decembre", "diciembre", "dicembre", "dezembro", "dec", "dez"],
].flatMap((names, i) => names.map((n) => [n, i + 1] as const)));

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");
const ym = (y: number, m: number) => `${y}-${pad(m)}`;
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const plausible = (y: number, m: number, d = 1) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** A line that names the invoice's own date or its due date: never a period or a delivery. */
const OWN_DATES = /\b(invoice date|date of invoice|due( date)?|payable by|issued?|rechnungsdatum|datum|f(a|ae)llig|zahlbar|factuurdatum|vervaldatum|vervaldag|te betalen voor|date de facture|echeance|fecha|vencimiento|data( (de|di) )?(fattura|emissao|vencimento)|scadenza)\b/i;
const PERIOD_WORDS = /\b(period|periode|zeitraum|leistungszeitraum|abrechnungszeitraum|service|services|storage|lagerung|rent|miete|huur|subscription|abonnement|abo|maintenance|wartung|onderhoud|month|monat|maand|mois|mes|mese)\b/i;
const DELIVERY_WORDS = /\b(delivered|delivery( date)?|shipped|dispatched|geleverd|levering|leverdatum|leveringsdatum|geliefert|lieferung|lieferdatum|leistungsdatum|livr(e|ee|aison)|entregad[oa]|entrega|consegna|consegnat[oa])\b/i;

/** Dates written out in a line, each as YYYY-MM-DD: 15.09.2026, 15-09-2026, 15/09/2026, 2026-09-15, 15 September 2026. */
function datesIn(line: string): string[] {
  const out: string[] = [];
  const l = fold(line);
  for (const m of l.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) if (plausible(+m[1]!, +m[2]!, +m[3]!)) out.push(ymd(+m[1]!, +m[2]!, +m[3]!));
  for (const m of l.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) if (plausible(+m[3]!, +m[2]!, +m[1]!)) out.push(ymd(+m[3]!, +m[2]!, +m[1]!));
  for (const m of l.matchAll(/\b(\d{1,2})\.?\s+([a-z]+)\.?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[2]!];
    if (month && plausible(+m[3]!, month, +m[1]!)) out.push(ymd(+m[3]!, month, +m[1]!));
  }
  return out;
}

/** "Month YYYY" with no day before it ("Lagerung Dezember 2026"), each as YYYY-MM. */
function monthsIn(line: string): string[] {
  const out: string[] = [];
  const l = fold(line);
  for (const m of l.matchAll(/\b([a-z]+)\.?\s+(\d{4})\b/g)) {
    if (/\d\.?\s*$/.test(l.slice(0, m.index))) continue; // "17 November 2026" is a date, not a period
    const month = MONTHS[m[1]!];
    if (month && plausible(+m[2]!, month)) out.push(ym(+m[2]!, month));
  }
  return out;
}

const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();

/**
 * The months an invoice says it bills for (YYYY-MM, sorted): a month and year without a day on a line of its own items
 * ("Storage November 2026"), and the first date on a line that names a period ("Leistungszeitraum: 01.10.2026 -
 * 31.10.2026"). Lines with the invoice's own date or due date are left out. Empty: none printed.
 */
export function servicePeriods(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (OWN_DATES.test(fold(line)) && !PERIOD_WORDS.test(line)) continue;
    if (DELIVERY_WORDS.test(line)) continue;
    out.push(...monthsIn(line));
    if (PERIOD_WORDS.test(line)) {
      const first = datesIn(line)[0];
      if (first) out.push(first.slice(0, 7));
    }
  }
  return uniqSorted(out);
}

/** The delivery dates an invoice prints (YYYY-MM-DD, sorted): dates on a line that says delivered or delivery. */
export function deliveryDates(text: string): string[] {
  return uniqSorted(text.split("\n").filter((line) => DELIVERY_WORDS.test(fold(line))).flatMap(datesIn));
}

/** Whether two invoices bill for different periods: only when both print one and they share no month. */
export function periodsDiffer(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  return !a.some((x) => b.includes(x));
}

/** The first line of an invoice's totals block: its subtotal, tax or total with an amount, in the languages suppliers write in (not "BTW-nummer"). */
const TOTALS = /^(sub-?total|subtotaal|nettobetrag|netto(betrag)?|net (amount|total)|total|totaal|gesamt\w*|summe|rechnungsbetrag|sous-total|montant|total ht|base imponible|importe|imponibile|totale|valor|mwst|ust|btw|vat|tva|iva|amount due|balance due)(?![-\w])(?=.*\d[.,]\d{2}(?!\d))/i;
/** A line under a label ("Bill to: …", "An: …"): a header or a footer, never a line item. */
const LABELLED = /^[^:]{1,40}:\s/;

/**
 * The lines an invoice bills, as printed: the lines after its own dates and before its totals that are not under a
 * label, folded (no case, accents or extra spaces). 19 Nov, third round (adversarial eval v4, v4-dup-zeeland-plus-150): a
 * copy EUR 1.50 dearer under a new number on the same day, with the same lines, is a possible duplicate
 * (src/ap/checkerCore.ts). An invoice that prints no lines (/try's written ones) has none.
 */
export function itemLines(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim());
  const end = lines.findIndex((l) => TOTALS.test(fold(l)));
  if (end < 0) return [];
  let start = 0;
  for (let i = 0; i < end; i++) if (OWN_DATES.test(fold(lines[i]!))) start = i + 1;
  return lines.slice(start, end).filter((l) => l && !LABELLED.test(l)).map((l) => fold(l).replace(/\s+/g, " "));
}

/** Whether two invoices' printed lines are the same, in any order. */
export const sameLines = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
