// The vault's folder layout (docs/superpowers/specs/2026-11-08-vault-design.md): one fixed tree, the same on a laptop,
// in the cloud and in a customer's Drive, readable without Purser. Every segment is made safe here: an invoice's own
// words (a supplier name, an invoice number) can never climb out of its folder or break a file system.

const MAX_SEGMENT = 120;
const RESERVED = new Set(["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

/** One path segment, safe on Windows, macOS, Linux, Drive and OneDrive. The same input always gives the same output. */
export function safeSegment(raw: string): string {
  let s = raw.normalize("NFC")
    // Invisible format characters (a right-to-left override, a zero-width space) never reach a file name: a name that
    // reads one way and sorts or opens another (red team round 3).
    .replace(/\p{Cf}/gu, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT).replace(/[.\s]+$/g, "");
  if (!s) return "_";
  if (RESERVED.has(s.toUpperCase().replace(/\..*$/, ""))) s = `_${s}`;
  return s;
}

const join = (...parts: string[]) => parts.map(safeSegment).join("/");

export function quarterOf(day: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(day);
  if (!m) throw new Error(`not a date: ${day}`);
  return `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
}

const yearOf = (day: string) => day.slice(0, 4);

export interface InvoiceName { vendor: string; invoice_no: string; date: string; currency: string; total: string; blocked: boolean }

/**
 * The folders for invoices and payments, in the company's language: Dutch by default (a Dutch company's accountant
 * reads them), English for a company set to English (the hands-on demo's test companies). A file already filed keeps
 * its path: the vault finds earlier files by their key (src/vault/build.ts), never by the folder's name.
 */
export const FOLDERS = {
  nl: { invoices: "Inkoopfacturen", blocked: "_Geblokkeerd", payments: "Betalingen" },
  en: { invoices: "Purchase invoices", blocked: "_Blocked", payments: "Payments" },
} as const;
export type FolderLang = keyof typeof FOLDERS;

export function invoicePath(company: string, i: InvoiceName, lang: FolderLang = "nl"): string {
  const F = FOLDERS[lang];
  const folder = i.blocked ? [F.invoices, F.blocked, i.vendor] : [F.invoices, i.vendor];
  return join(company, yearOf(i.date), quarterOf(i.date), ...folder, `${i.date} ${i.invoice_no} ${i.currency} ${i.total}.pdf`);
}

export function paymentPath(company: string, p: { vendor: string; invoice_no: string; date: string }, lang: FolderLang = "nl"): string {
  return join(company, yearOf(p.date), quarterOf(p.date), FOLDERS[lang].payments, `${p.date} ${p.vendor} ${p.invoice_no}.pdf`);
}

export function monthReportPath(company: string, month: string): string {
  return join(company, yearOf(month), quarterOf(`${month}-01`), "Rapporten", `${month} Maandrapport.pdf`);
}

/** The month pack (src/ledger/pack.ts) beside the month report. */
export function monthPackPath(company: string, month: string): string {
  return join(company, yearOf(month), quarterOf(`${month}-01`), "Rapporten", `${month} Maandpakket.pdf`);
}

/** The accountant's export of a month's journal (src/ledger/accountantExport.ts), as CSV or JSON. */
export function monthExportPath(company: string, month: string, ext: "csv" | "json"): string {
  return join(company, yearOf(month), quarterOf(`${month}-01`), "Rapporten", `${month} Journaal voor de accountant.${ext}`);
}

/** `quarter` as the ledger writes it: 2026Q4. */
export function vatPath(company: string, quarter: string): string {
  const q = `${quarter.slice(0, 4)}-${quarter.slice(4)}`;
  return join(company, quarter.slice(0, 4), q, "Rapporten", `${q} Btw-overzicht.pdf`);
}

export function yearReportPath(company: string, year: number): string {
  return join(company, String(year), `${year} Jaarrapport.pdf`);
}

export function suppliersPath(company: string, day: string): string {
  return join(company, yearOf(day), `Leveranciers ${day}.pdf`);
}

export function yearIndexPath(company: string, year: number): string {
  return join(company, String(year), "index.json");
}

/** The name a corrected version gets beside the original: " (correctie)", then " (correctie 2)", and so on. */
export function correctionName(path: string, n: number): string {
  const dot = path.lastIndexOf(".");
  const [base, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  return `${base} (correctie${n > 1 ? ` ${n}` : ""})${ext}`;
}

/** The same name for a second, different document: the payables id beside it. */
export function withId(path: string, id: string): string {
  const dot = path.lastIndexOf(".");
  return `${path.slice(0, dot)} (${safeSegment(id)})${path.slice(dot)}`;
}
