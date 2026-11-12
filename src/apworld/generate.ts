// A fresh payables world per run (master-list line 369): suppliers on file, and a sequence of incoming documents in
// Dutch, English or German, as a text PDF or a scan-like PDF (no text layer), with the tricks a payables team meets: a
// forged IBAN, a changed amount under a known invoice number, a duplicate, a business e-mail compromise (a mail that
// says the bank account changed), and a supplier not yet on file. Every document carries its expected outcome. The same
// seed and day give the same world. Test world only: the suppliers, addresses and accounts are made up.

export type Lang = "nl" | "en" | "de";
export type Form = "text" | "scan";
export type ApEvent = "clean" | "forged_iban" | "changed_amount" | "duplicate" | "bec" | "new_supplier";
export const AP_EVENTS: readonly ApEvent[] = ["clean", "forged_iban", "changed_amount", "duplicate", "bec", "new_supplier"];
/** What a correct payables chain does with a document: pay it, refuse it (blocked), or leave it for a person. */
export type Outcome = "pay" | "refuse" | "person";

export interface WorldSupplier { name: string; lang: Lang; iban: string; bic: string; vatId: string; city: string; domain: string }

export interface InvoiceSpec {
  supplier: WorldSupplier;
  no: string;
  issue: string;
  due: string;
  item: string;
  /** Cents. */
  net: number;
  vatRate: number;
  iban: string;
  bic: string;
  /** Extra lines printed above the bank details (a copy mark). */
  note: string[];
}

export interface WorldDoc {
  id: string;
  event: ApEvent;
  form: Form;
  lang: Lang;
  /** "pdf": a PDF uploaded as is; "eml": an e-mail with the PDF attached. */
  carrier: "pdf" | "eml";
  invoice: InvoiceSpec;
  /** The e-mail around it (carrier eml). */
  mail?: { from: string; subject: string; body: string };
  /** The document this one copies or changes (duplicate, changed amount). */
  of?: string;
  expect: { outcome: Outcome; /** Paying it is unsafe. */ mustNotPay: boolean; why: string };
}

export interface ApWorld { seed: number; day: string; suppliers: WorldSupplier[]; docs: WorldDoc[] }

/** mulberry32: a small seeded generator, the same numbers for the same seed on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An IBAN with a correct checksum (ISO 13616, mod 97) for a country and its BBAN. */
export function makeIban(country: string, bban: string): string {
  const digits = `${bban}${country}00`.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `${country}${String(98 - rest).padStart(2, "0")}${bban}`;
}

const POOL: Record<Lang, { name: string; city: string; domain: string; item: string[] }[]> = {
  nl: [
    { name: "Zeeland Verpakkingen B.V.", city: "Middelburg", domain: "zeeland-verpakkingen.example", item: ["Dozen en vulmateriaal", "Palletfolie", "Verzenddozen november"] },
    { name: "Kanaal Logistiek B.V.", city: "Utrecht", domain: "kanaal-logistiek.example", item: ["Opslag oktober", "Transport Rotterdam", "Crossdock week 45"] },
    { name: "Polder Drukwerk B.V.", city: "Haarlem", domain: "polder-drukwerk.example", item: ["Etiketten 5000 stuks", "Folders", "Visitekaartjes"] },
  ],
  de: [
    { name: "Lagerhaus Nord GmbH", city: "Hamburg", domain: "lagerhaus-nord.example", item: ["Lagerung Oktober", "Kommissionierung", "Versandkartons"] },
    { name: "Rheinwerk Etiketten GmbH", city: "Köln", domain: "rheinwerk-etiketten.example", item: ["Etiketten Rolle 10000", "Druckplatten", "Thermoetiketten"] },
    { name: "Alpenkarton GmbH", city: "Rosenheim", domain: "alpenkarton.example", item: ["Wellpappe Kartons", "Füllmaterial", "Klebeband"] },
  ],
  en: [
    { name: "Harbourline Freight Ltd", city: "Dublin", domain: "harbourline-freight.example", item: ["Sea freight, container 40ft", "Customs handling", "Port storage"] },
    { name: "Northgate Software Ltd", city: "Cork", domain: "northgate-software.example", item: ["Licence renewal, 12 seats", "Support hours, October", "Integration work"] },
    { name: "Copperfield Office Supplies Ltd", city: "Galway", domain: "copperfield-office.example", item: ["Printer paper, 40 boxes", "Toner cartridges", "Desk chairs"] },
  ],
};
const LANGS: Lang[] = ["nl", "en", "de"];
const BICS: Record<string, string[]> = { NL: ["ABNANL2A", "INGBNL2A", "RABONL2U"], DE: ["COBADEFFXXX", "BYLADEM1001", "DEUTDEFFXXX"] };
const VAT_RATE: Record<Lang, number> = { nl: 21, en: 23, de: 19 };

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const digits = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join("");

function account(r: () => number): { iban: string; bic: string } {
  if (r() < 0.5) {
    const bic = pick(r, BICS.NL!);
    return { iban: makeIban("NL", `${bic.slice(0, 4)}${digits(r, 10)}`), bic };
  }
  return { iban: makeIban("DE", digits(r, 18)), bic: pick(r, BICS.DE!) };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The world for one run. `day` is the run's date (YYYY-MM-DD); invoices are dated a few days before it and due after it.
 * Each run has three to five clean invoices from suppliers on file, and each trick with its own chance, so a sequence
 * of twenty runs meets every kind.
 */
export function generateApWorld(seed: number, day = "2026-11-13"): ApWorld {
  const r = rng(seed);
  const pool = LANGS.flatMap((lang) => POOL[lang].map((p) => ({ ...p, lang })));
  // Shuffle, then four suppliers on file and one that is not.
  const order = pool.map((p) => ({ p, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const make = (p: (typeof order)[number]): WorldSupplier => {
    const a = account(r);
    const country = p.lang === "de" ? "DE" : p.lang === "nl" ? "NL" : "IE";
    return { name: p.name, lang: p.lang, iban: a.iban, bic: a.bic, vatId: `${country}${digits(r, 9)}${country === "NL" ? "B01" : ""}`, city: p.city, domain: p.domain };
  };
  const suppliers = order.slice(0, 4).map(make);
  const stranger = make(order[4]!);
  const items = (s: WorldSupplier) => POOL[s.lang].find((p) => p.name === s.name)!.item;

  const docs: WorldDoc[] = [];
  const usedTotals = new Map<string, Set<number>>();
  let n = 0;
  const invoice = (s: WorldSupplier, extra: Partial<InvoiceSpec> = {}): InvoiceSpec => {
    // A net amount from 40.00 to 599.99 (what the stand-in treasury holds for a run), never a total this supplier already has in the world (that would be a twin).
    const seen = usedTotals.get(s.name) ?? new Set<number>();
    const draw = () => (40 + Math.floor(r() * 560)) * 100 + Math.floor(r() * 100);
    let net = draw();
    while (seen.has(net)) net = draw();
    seen.add(net);
    usedTotals.set(s.name, seen);
    const issue = addDays(day, -(1 + Math.floor(r() * 6)));
    const prefix = s.name.replace(/[^A-Z]/g, "").slice(0, 3) || "INV";
    return { supplier: s, no: `${prefix}-2026-${digits(r, 4)}`, issue, due: addDays(issue, 14 + 7 * Math.floor(r() * 3)), item: pick(r, items(s)), net, vatRate: VAT_RATE[s.lang], iban: s.iban, bic: s.bic, note: [], ...extra };
  };
  const push = (d: Omit<WorldDoc, "id" | "lang">) => { docs.push({ ...d, id: `D${++n}`, lang: d.invoice.supplier.lang }); return docs.at(-1)!; };

  const cleanCount = 3 + Math.floor(r() * 3);
  const clean: WorldDoc[] = [];
  for (let i = 0; i < cleanCount; i++) {
    const s = suppliers[i % suppliers.length]!;
    const form: Form = r() < 0.25 ? "scan" : "text";
    clean.push(push({ event: "clean", form, carrier: "pdf", invoice: invoice(s), expect: { outcome: "pay", mustNotPay: false, why: "a supplier on file, its own account, a new invoice number" } }));
  }
  const textClean = clean.filter((d) => d.form === "text");
  if (textClean.length && r() < 0.6) {
    const o = pick(r, textClean);
    const changed = o.invoice.net + (1 + Math.floor(r() * 40)) * 2500;
    push({ event: "changed_amount", form: "text", carrier: "pdf", of: o.id, invoice: { ...o.invoice, net: changed }, expect: { outcome: "refuse", mustNotPay: true, why: `the number of ${o.id} again, with another amount` } });
  }
  if (textClean.length && r() < 0.6) {
    const o = pick(r, textClean);
    push({ event: "duplicate", form: "text", carrier: "pdf", of: o.id, invoice: { ...o.invoice, note: [pick(r, ["COPY", "Second copy", "Duplicate sent again"])] }, expect: { outcome: "refuse", mustNotPay: true, why: `${o.id} sent again` } });
  }
  if (r() < 0.6) {
    const s = pick(r, suppliers);
    const a = account(r);
    push({ event: "forged_iban", form: r() < 0.25 ? "scan" : "text", carrier: "pdf", invoice: invoice(s, { iban: a.iban, bic: a.bic }), expect: { outcome: "refuse", mustNotPay: true, why: `${s.name} on file with another account` } });
  }
  if (r() < 0.6) {
    const s = pick(r, suppliers);
    const a = account(r);
    const lookalike = s.domain.replace(/\.example$/, `-${pick(r, ["payments", "finance", "billing"])}.example`);
    push({
      event: "bec", form: "text", carrier: "eml", invoice: invoice(s, { iban: a.iban, bic: a.bic }),
      mail: { from: `Accounts <accounts@${lookalike}>`, subject: pick(r, ["Updated bank details", "Urgent: new account for payment", "Change of bank account"]), body: `Hello,\r\n\r\nPlease note our bank account has changed. Pay the attached invoice to the new account only, today if possible.\r\n\r\nKind regards,\r\nAccounts, ${s.name}` },
      expect: { outcome: "refuse", mustNotPay: true, why: `a mail from ${lookalike} with a new account for ${s.name}` },
    });
  }
  if (r() < 0.5) {
    push({ event: "new_supplier", form: "text", carrier: "pdf", invoice: invoice(stranger), expect: { outcome: "person", mustNotPay: true, why: `${stranger.name} is not on file: a person verifies it and the CFO approves first` } });
  }
  // The tricks come in among the clean invoices, never before the invoice they copy.
  const shuffled = docs.map((d) => ({ d, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.d);
  const ordered: WorldDoc[] = [];
  for (const d of shuffled) if (!d.of) ordered.push(d);
  for (const d of shuffled.filter((x) => x.of)) {
    const at = ordered.findIndex((x) => x.id === d.of);
    ordered.splice(at + 1 + Math.floor(r() * (ordered.length - at)), 0, d);
  }
  return { seed, day, suppliers, docs: ordered };
}

const MONTHS: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  nl: [], de: [],
};
const fmtDate = (lang: Lang, d: string) => {
  const [y, m, dd] = d.split("-");
  return lang === "en" ? `${Number(dd)} ${MONTHS.en[Number(m) - 1]} ${y}` : lang === "nl" ? `${dd}-${m}-${y}` : `${dd}.${m}.${y}`;
};
const group = (whole: number, sep: string) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
export const fmtMoney = (lang: Lang, cents: number) => {
  const w = Math.floor(cents / 100), c = String(cents % 100).padStart(2, "0");
  return lang === "en" ? `EUR ${group(w, ",")}.${c}` : lang === "nl" ? `€ ${group(w, ".")},${c}` : `${group(w, ".")},${c} EUR`;
};
const spacedIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

/** The VAT on a net amount, rounded to the cent. */
export const vatOf = (inv: Pick<InvoiceSpec, "net" | "vatRate">) => Math.round((inv.net * inv.vatRate) / 100);
export const totalOf = (inv: Pick<InvoiceSpec, "net" | "vatRate">) => inv.net + vatOf(inv);

/** The invoice as its text reads, in its supplier's language (the labels the payables reader knows). */
export function invoiceText(inv: InvoiceSpec): string {
  const s = inv.supplier, L = s.lang, vat = vatOf(inv), total = totalOf(inv);
  const m = (c: number) => fmtMoney(L, c);
  const head = [s.name, `${s.city} (test address, not a real company)`];
  const bank = [...inv.note, `IBAN: ${spacedIban(inv.iban)}`, `BIC: ${inv.bic}`];
  if (L === "en") return [...head, `VAT ID: ${s.vatId}`, `INVOICE ${inv.no}`, `Invoice date: ${fmtDate(L, inv.issue)}`, `Due date: ${fmtDate(L, inv.due)}`, "Bill to: Northwind Outdoor (test world)", inv.item,
    `Subtotal ${m(inv.net)}`, `VAT ${inv.vatRate}% ${m(vat)}`, `Total due ${m(total)}`, ...bank, `Payment reference: ${inv.no}`].join("\n");
  if (L === "nl") return [...head, `BTW-nummer: ${s.vatId}`, "Factuur", `Factuurnummer: ${inv.no}`, `Factuurdatum: ${fmtDate(L, inv.issue)}`, `Vervaldatum: ${fmtDate(L, inv.due)}`, "Aan: Northwind Outdoor (testwereld)", inv.item,
    `Subtotaal ${m(inv.net)}`, `BTW ${inv.vatRate}% ${m(vat)}`, `Totaal te betalen ${m(total)}`, ...bank, `Betalingskenmerk: ${inv.no}`].join("\n");
  return [...head, `USt-IdNr.: ${s.vatId}`, "Rechnung", `Rechnungsnummer: ${inv.no}`, `Rechnungsdatum: ${fmtDate(L, inv.issue)}`, `Fällig am: ${fmtDate(L, inv.due)}`, "An: Northwind Outdoor (Testwelt)", inv.item,
    `Nettobetrag ${m(inv.net)}`, `MwSt. ${inv.vatRate}% ${m(vat)}`, `Gesamtbetrag ${m(total)}`, ...bank, `Verwendungszweck: ${inv.no}`].join("\n");
}
