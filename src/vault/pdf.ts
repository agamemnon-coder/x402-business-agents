// The vault's generated PDFs (pdfkit): a payment receipt, the month report, the quarter's VAT overview, the year report
// and the suppliers list. Dutch by default, English on request. Every figure comes from src/vault/data.ts; this file
// only lays it out. Deterministic: the creation date comes from the data, so the same data gives the same bytes. This
// build only talks to the Airwallex sandbox, so every page with a payment figure says it is test money.

import PDFDocument from "pdfkit";
import type { MonthData, ReceiptData, SuppliersData, YearData } from "./data.js";
import type { MonthPack } from "../ledger/pack.js";
import type { VatOverview } from "../ledger/reports.js";

export type Lang = "nl" | "en";

/** The PDFs' words in Dutch and English. */
export const PDF_STRINGS = {
  nl: {
    testMoney: "Testgeld (Airwallex sandbox)", testMoneyLine: "Alle bedragen in dit document zijn testgeld uit de Airwallex-sandbox; er is geen echt geld bewogen.",
    made: "Gemaakt door Purser uit de administratie: elk bedrag komt uit het grootboek of de inkoopadministratie.",
    receipt: "Betaalbewijs", supplier: "Leverancier", invoice: "Factuur", invoiceDate: "Factuurdatum", dueDate: "Vervaldatum", reference: "Betalingskenmerk",
    amount: "Bedrag", paidOn: "Betaald op", method: "Betaalwijze", transfer: "Airwallex-overboeking", fee: "Kosten (door Airwallex berekend)", account: "Rekening",
    fx: "Valuta omgewisseld", rate: "Koers", bought: "Gekocht", sold: "Verkocht", approval: "Goedkeuring", approvedBy: "Goedgekeurd door", how: "Hoe", when: "Wanneer",
    cosigner: "Tweede handtekening", passkey: "Face ID (passkey) op de exacte voorwaarden", typed: "getypte hashprefix (geen passkey)", proposal: "Voorstel",
    termsHash: "Hash van de voorwaarden", signed: "Ondertekende hash", verify: "Controleren: npm run verify controleert elke goedkeuring met Face ID opnieuw tegen de opgeslagen handtekening en de vastgelegde publieke sleutel, zonder netwerk.",
    noApproval: "Geen goedkeuring gevonden in de administratie.", none: "geen",
    credits: "Creditnota's (verrekend met de openstaande facturen van die leverancier)", openNet: "Nog open na creditnota's",
    month: "Maandrapport", received: "Ontvangen facturen", paid: "Betaald", open: "Nog open (stand aan het einde van de maand)", blocked: "Geblokkeerd", reasons: "Reden",
    spend: "Uitgaven per leverancier", fees: "Kosten overboekingen", fxTitle: "Valuta", conversions: "omwisselingen", pnl: "Winst en verlies (grootboek)", revenue: "Opbrengsten",
    expense: "Kosten", result: "Resultaat", count: "Aantal", status: "Status", nothing: "Niets in deze periode.",
    vat: "Btw-overzicht", rubric: "Rubriek", base: "Omzet/grondslag", vatAmt: "Btw", owed: "5a Verschuldigde btw", input: "5b Voorbelasting", balance: "5c Saldo",
    vatNotice: "Dit is een overzicht voor de btw-aangifte, berekend uit het grootboek. Het is geen aangifte: indienen bij de Belastingdienst is een latere, gecertificeerde stap, en een mens controleert dit overzicht eerst.",
    uncoded: "Regels zonder btw-code (een mens codeert ze)", otherCurrency: "Regels in een andere valuta dan EUR (een mens rekent ze om)",
    year: "Jaarrapport", beforeClose: "vóór de afsluitboeking", balanceSheet: "Balans per", assets: "Activa", liabilities: "Vreemd vermogen", equity: "Eigen vermogen",
    openResult: "Resultaat (nog niet afgesloten)", balanced: "Sluitend", notBalanced: "NIET sluitend", trial: "Proefbalans", debit: "Debet", credit: "Credit", saldo: "Saldo",
    suppliers: "Leveranciers", onDay: "Stand op", iban: "IBAN (laatste 4)", bic: "BIC", currency: "Valuta", invoices: "Facturen",
    pack: "Maandpakket", period: "Periode", periodLocked: "Afgesloten: er wordt niets meer in geboekt", lockedBy: "Afgesloten door", lockedAt: "Afgesloten op",
    periodOpen: "Deze periode is nog niet afgesloten: de bedragen kunnen nog veranderen.", preparation: "Voorbereiding, geen aangifte",
    payables: "Openstaande crediteuren (stand aan het einde van de maand)", party: "Partij", docRef: "Document", bucket: "Ouderdom", quarter: "Kwartaal",
    statusWord: { ACTIVE: "actief", REPLACED: "vervangen" } as Record<string, string>,
    apStatus: {
      blocked: "geblokkeerd", needs_review: "wacht op een mens", needs_vendor: "wacht op een nieuwe leverancier", ready: "klaar om te betalen",
      waiting_cfo: "wacht op Face ID van de CFO", paid: "betaald", rejected: "afgewezen",
    } as Record<string, string>,
  },
  en: {
    testMoney: "Test money (Airwallex sandbox)", testMoneyLine: "Every amount in this document is test money from the Airwallex sandbox; no real money moved.",
    made: "Made by Purser from the books: every amount comes from the ledger or the payables records.",
    receipt: "Payment receipt", supplier: "Supplier", invoice: "Invoice", invoiceDate: "Invoice date", dueDate: "Due date", reference: "Payment reference",
    amount: "Amount", paidOn: "Paid on", method: "Method", transfer: "Airwallex transfer", fee: "Fee (charged by Airwallex)", account: "Account",
    fx: "Currency exchanged", rate: "Rate", bought: "Bought", sold: "Sold", approval: "Approval", approvedBy: "Approved by", how: "How", when: "When",
    cosigner: "Second signature", passkey: "Face ID (passkey) on the exact terms", typed: "typed hash prefix (no passkey)", proposal: "Proposal",
    termsHash: "Terms hash", signed: "Signed hash", verify: "To check: npm run verify re-checks every Face ID approval against the stored signature and the pinned public key, offline.",
    noApproval: "No approval found in the books.", none: "none",
    credits: "Credit notes (set against that supplier's open invoices)", openNet: "Still open after credit notes",
    month: "Month report", received: "Invoices received", paid: "Paid", open: "Still open (as at the end of the month)", blocked: "Blocked", reasons: "Reason",
    spend: "Spend per supplier", fees: "Transfer fees", fxTitle: "Currency", conversions: "conversions", pnl: "Profit and loss (ledger)", revenue: "Revenue",
    expense: "Expenses", result: "Result", count: "Count", status: "Status", nothing: "Nothing in this period.",
    vat: "VAT overview", rubric: "Box", base: "Base", vatAmt: "VAT", owed: "5a VAT owed", input: "5b Input VAT", balance: "5c Balance",
    vatNotice: "An overview for the Dutch VAT return, computed from the ledger. It is not a filing: filing to the tax authority is a later, certified step, and a person checks the overview first.",
    uncoded: "Lines without a VAT code (a person codes them)", otherCurrency: "Lines in a currency other than EUR (a person converts them)",
    year: "Year report", beforeClose: "before the closing entry", balanceSheet: "Balance sheet on", assets: "Assets", liabilities: "Liabilities", equity: "Equity",
    openResult: "Result (not yet closed)", balanced: "Balances", notBalanced: "DOES NOT balance", trial: "Trial balance", debit: "Debit", credit: "Credit", saldo: "Balance",
    suppliers: "Suppliers", onDay: "As of", iban: "IBAN (last 4)", bic: "BIC", currency: "Currency", invoices: "Invoices",
    pack: "Month pack", period: "Period", periodLocked: "Closed: nothing more is posted into it", lockedBy: "Closed by", lockedAt: "Closed on",
    periodOpen: "This period is not closed yet: the numbers can still change.", preparation: "Preparation, not a filing",
    payables: "Open payables (as at the end of the month)", party: "Party", docRef: "Document", bucket: "Age", quarter: "Quarter",
    statusWord: { ACTIVE: "active", REPLACED: "replaced" } as Record<string, string>,
    apStatus: {
      blocked: "blocked", needs_review: "needs a person", needs_vendor: "waits for a new supplier", ready: "ready to pay",
      waiting_cfo: "waits for the CFO's Face ID", paid: "paid", rejected: "rejected",
    } as Record<string, string>,
  },
} as const;
const T = PDF_STRINGS;

/**
 * Which bank the money moved on: the Airwallex sandbox (a runner's, the default) or the stand-in bank of the cloud's
 * engine (src/engine/standInBank.ts), which never reaches Airwallex. Its pages say so, name no Airwallex transfer or
 * fee, and point to no `npm run verify` (the cloud's company has no runner to run it on).
 */
export type Bank = "sandbox" | "stand-in";
export const STAND_IN_STRINGS = {
  nl: {
    testMoney: "Testgeld (nagebootste bank)", testMoneyLine: "Alle bedragen in dit document zijn testgeld op een nagebootste bank, niet Airwallex; er is geen echt geld bewogen.",
    transfer: "Overboeking (nagebootste bank)", fee: "Kosten (door de nagebootste bank berekend)", verify: "",
  },
  en: {
    testMoney: "Test money (stand-in bank)", testMoneyLine: "Every amount in this document is test money on a stand-in bank, not Airwallex; no real money moved.",
    transfer: "Transfer (stand-in bank)", fee: "Fee (set by the stand-in bank)", verify: "",
  },
} as const;
const words = (lang: Lang, bank: Bank) => (bank === "stand-in" ? { ...T[lang], ...STAND_IN_STRINGS[lang] } : T[lang]);

/**
 * The chart's account names in Dutch, for the Dutch PDFs (screenshot pass S7); English stays as the chart has it. An
 * account without a Dutch name keeps its own.
 */
export const ACCOUNT_NAMES_NL: Readonly<Record<string, string>> = {
  "1200": "Bank: Airwallex EUR (incl. bedrijfskaarten)", "1201": "Bank: Airwallex USD", "1202": "Bank: Airwallex GBP",
  "1203": "Bank: Airwallex, overige valuta", "1210": "Bank: Metal-rekening (*USDZ, testnet)", "1220": "Bank: Metal clearing (*USDZ, testnet)",
  "1300": "Debiteuren", "1510": "Te vorderen btw (inkoopfacturen)", "1590": "Kruisposten (tussen eigen rekeningen)", "1700": "Voorraad",
  "2100": "Crediteuren (inkoopfacturen)", "2200": "Te betalen btw", "2210": "Af te dragen btw (aan klanten berekend)", "2900": "Nog niet geïdentificeerde ontvangsten",
  "3000": "Eigen vermogen: beginsaldi en inbreng eigenaar", "3100": "Ingehouden winst",
  "4000": "Omzet: voorraaddata aan winkeliers", "4100": "Terugbetalingen aan klanten", "4200": "Omzet: groothandel aan winkeliers",
  "5000": "Ingekochte voorraaddata (warehouse-API)", "6100": "Softwareabonnementen (bedrijfskaarten)", "6150": "Advertenties (bedrijfskaarten)",
  "6200": "Goederen van de fabrikant", "6300": "Reiskosten (taakkaarten)", "6350": "Datalicentie (Stockline, maandelijks)",
  "6800": "Bank- en overboekingskosten", "6900": "Overige inkoopfacturen", "8000": "Kostprijs van de omzet", "2150": "Gesimuleerde financier (testnet): financiering van factuurtokens",
  "7100": "Financieringskosten: korting op gefinancierde facturen", "7900": "Koersverschillen, gerealiseerd (winst of verlies)",
};

/** Why an invoice is blocked, in Dutch, by the finding's code (the code's own words stay the English; red team S7). */
export const BLOCK_REASONS_NL: Readonly<Record<string, string>> = {
  iban_invalid: "het IBAN klopt niet (controlegetal): een typefout of een vervalst nummer; er wordt niets op betaald",
  bank_details_invalid: "de bankgegevens zijn ongeldig; er wordt niets op betaald",
  sum_mismatch: "subtotaal plus btw is niet het totaal",
  duplicate: "dezelfde factuur staat al in de administratie; een tweede exemplaar wordt nooit betaald",
  payee_blocked: "deze leverancier is geblokkeerd in het CFO-beleid",
  bank_details_changed: "de factuur vraagt om betaling op een andere rekening dan bekend",
  lookalike_vendor: "de naam lijkt op die van een bekende leverancier, maar is het niet",
  mixed_scripts: "de naam van de leverancier bevat letters uit een ander alfabet",
  account_name_mismatch: "de rekeninghouder is niet de leverancier",
  unknown_vendor: "de leverancier is niet bekend",
};

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
/** A date as the PDF's language writes it: "2 november 2026" in Dutch (a time in UTC after it); English keeps the ISO date. */
export function pdfDate(iso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso ?? "");
  if (lang !== "nl" || !m) return iso;
  return `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]} ${m[1]}${m[4] ? `, ${m[4]}:${m[5]} UTC` : ""}`;
}
const METHOD_NL: Record<string, string> = { LOCAL: "Lokale overboeking", SWIFT: "SWIFT-overboeking" };

/** A blocked invoice's reason in the PDF's language: Dutch from its code where Purser has the words, else the code's English. */
export function blockedReason(f: { code: string; detail: string; signals: string[] }, lang: Lang): string {
  if (lang !== "nl") return f.detail;
  if (f.code === "possible_fraud") {
    const why = f.signals.map((c) => BLOCK_REASONS_NL[c]).filter(Boolean);
    return `mogelijke factuurfraude: ${why.length ? why.join("; ") : "de factuur wijkt af van wat over deze leverancier bekend is"}; er wordt niets betaald tot iemand de leverancier belt op een nummer dat al bekend is`;
  }
  return BLOCK_REASONS_NL[f.code] ?? f.detail;
}

export function accountName(account: string, name: string, lang: Lang): string {
  return lang === "nl" ? ACCOUNT_NAMES_NL[account] ?? name : name;
}

/** "EUR 1.850,00" (nl) or "EUR 1,850.00" (en), from a plain decimal like "1850.00" or "-12.50". */
export function formatMoney(currency: string, amount: string, lang: Lang = "nl"): string {
  const neg = amount.startsWith("-");
  const [int, dec = "00"] = amount.replace(/^-/, "").split(".") as [string, string?];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, lang === "nl" ? "." : ",");
  return `${currency ? `${currency} ` : ""}${neg ? "-" : ""}${grouped}${lang === "nl" ? "," : "."}${dec.padEnd(2, "0").slice(0, 2)}`;
}

/** "EUR 13.42" (as the ledger stores a fee) in the document's language. */
const money = (pair: string, lang: Lang) => { const [c, a] = pair.split(" ") as [string, string]; return formatMoney(c, a, lang); };
const cents = (n: number) => (n < 0 ? `-${(-n / 100).toFixed(2)}` : (n / 100).toFixed(2));

type Doc = PDFKit.PDFDocument;
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const WARN = "#b45309";

function render(title: string, created: string, draw: (doc: Doc) => void): Promise<Buffer> {
  const at = /^\d{4}-\d{2}-\d{2}/.test(created) ? new Date(`${created.slice(0, 10)}T00:00:00Z`) : new Date("2000-01-01T00:00:00Z");
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: title, Author: "Purser", Creator: "Purser", Producer: "Purser", CreationDate: at, ModDate: at } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;
}

function header(doc: Doc, company: string, title: string, sub: string, test: boolean, lang: Lang, bank: Bank = "sandbox") {
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(company.toUpperCase(), { characterSpacing: 1 });
  doc.moveDown(0.3).fillColor(INK).font("Helvetica-Bold").fontSize(20).text(title);
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(sub);
  if (test) {
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(50, y, 495, 34).fill("#fffbeb");
    doc.fillColor(WARN).font("Helvetica-Bold").fontSize(10).text(words(lang, bank).testMoney, 60, y + 6);
    doc.font("Helvetica").fontSize(8.5).text(words(lang, bank).testMoneyLine, 60, y + 19);
    doc.y = y + 40;
  }
  doc.moveDown(0.6).x = 50;
}

function section(doc: Doc, title: string) {
  if (doc.y > 720) doc.addPage();
  doc.moveDown(0.6).fillColor(INK).font("Helvetica-Bold").fontSize(12).text(title, 50);
  doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.5);
}

function kv(doc: Doc, rows: [string, string][]) {
  for (const [k, v] of rows) {
    if (doc.y > 760) doc.addPage();
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(k, 50, y, { width: 160 });
    const after = doc.y;
    doc.fillColor(INK).text(v, 215, y, { width: 330 });
    doc.y = Math.max(after, doc.y) + 3;
  }
}

/** A table: column widths in points (sum about 495); right-aligned columns by index. */
function table(doc: Doc, head: string[], rows: string[][], widths: number[], right: number[] = [], lang: Lang = "nl") {
  if (!rows.length) { doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(MUTED).text(T[lang].nothing, 50); doc.moveDown(0.3); return; }
  const line = (cells: string[], bold: boolean) => {
    if (doc.y > 770) doc.addPage();
    const y = doc.y;
    let x = 50;
    let bottom = y;
    cells.forEach((c, i) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? MUTED : INK)
        .text(c, x, y, { width: widths[i]! - 6, align: right.includes(i) ? "right" : "left" });
      bottom = Math.max(bottom, doc.y);
      x += widths[i]!;
    });
    doc.y = bottom + 3;
    doc.moveTo(50, doc.y - 1).lineTo(545, doc.y - 1).strokeColor(LINE).lineWidth(0.5).stroke();
  };
  line(head, true);
  for (const r of rows) line(r, false);
  doc.x = 50;
}

function footer(doc: Doc, lang: Lang) {
  doc.moveDown(1.2).font("Helvetica").fontSize(8).fillColor(MUTED).text(T[lang].made, 50, undefined, { width: 495 });
}

// ---------- documents ----------

export function receiptPdf(company: string, r: ReceiptData, lang: Lang = "nl", bank: Bank = "sandbox"): Promise<Buffer> {
  const t = words(lang, bank);
  return render(`${t.receipt} ${r.vendor} ${r.invoice_no}`, r.paid_at, (doc) => {
    header(doc, company, t.receipt, `${r.vendor} · ${t.invoice} ${r.invoice_no}`, true, lang, bank);
    section(doc, t.invoice);
    kv(doc, [[t.supplier, r.vendor], [t.invoice, r.invoice_no], [t.invoiceDate, r.invoice_date ? pdfDate(r.invoice_date, lang) : t.none], [t.dueDate, r.due_date ? pdfDate(r.due_date, lang) : t.none], [t.reference, r.reference || t.none],
      [t.account, r.account]]);
    section(doc, t.paid);
    kv(doc, [[t.amount, formatMoney(r.currency, r.amount, lang)], [t.paidOn, pdfDate(r.paid_at.slice(0, 10), lang)], [t.method, lang === "nl" ? METHOD_NL[r.method] ?? r.method : r.method], [t.transfer, r.transfer_id ?? t.none],
      [t.fee, r.fee && /^[A-Z]{3} \d+\.\d{2}$/.test(r.fee) ? money(r.fee, lang) : t.none]]);
    if (r.fx) {
      section(doc, t.fx);
      kv(doc, [[t.rate, r.fx.rate], [t.bought, money(r.fx.bought, lang)], [t.sold, money(r.fx.sold, lang)]]);
    }
    section(doc, t.approval);
    if (r.approval) {
      kv(doc, [[t.approvedBy, r.approval.approver], [t.how, r.approval.method === "passkey" ? t.passkey : `${r.approval.method}: ${t.typed}`], [t.when, pdfDate(r.approval.at, lang)],
        ...(r.cosigner ? [[t.cosigner, r.cosigner] as [string, string]] : []), [t.proposal, r.proposal_id], [t.termsHash, r.terms_sha256], [t.signed, r.approval.signed_sha256]]);
    } else kv(doc, [[t.approval, t.noApproval], [t.proposal, r.proposal_id], [t.termsHash, r.terms_sha256]]);
    if (t.verify) doc.moveDown(0.4).font("Helvetica").fontSize(9).fillColor(INK).text(t.verify, 50, undefined, { width: 495 });
    footer(doc, lang);
  });
}

function pnlBlock(doc: Doc, pnl: MonthData["pnl"], lang: Lang) {
  const t = T[lang];
  if (!pnl.length) { table(doc, [], [], [], [], lang); return; }
  for (const p of pnl) {
    table(doc, [t.account, "", p.currency], p.accounts.map((a) => [a.account, accountName(a.account, a.name, lang), formatMoney("", a.amount, lang)]), [60, 335, 100], [2], lang);
    kv(doc, [[t.revenue, formatMoney(p.currency, p.revenue, lang)], [t.expense, formatMoney(p.currency, p.expense, lang)], [t.result, formatMoney(p.currency, p.result, lang)]]);
  }
}

export function monthReportPdf(company: string, m: MonthData, lang: Lang = "nl", bank: Bank = "sandbox"): Promise<Buffer> {
  const t = T[lang];
  return render(`${t.month} ${m.month}`, m.to, (doc) => {
    header(doc, company, `${t.month} ${m.month}`, `${pdfDate(m.from, lang)} – ${pdfDate(m.to, lang)}`, true, lang, bank);
    section(doc, t.received);
    table(doc, [t.currency, t.count, t.amount], m.received.map((a) => [a.currency, String(a.count), formatMoney(a.currency, a.total, lang)]), [120, 120, 255], [1, 2], lang);
    section(doc, t.paid);
    table(doc, [t.supplier, t.invoice, t.paidOn, t.amount], m.paid.map((p) => [p.vendor, p.invoice_no, pdfDate(p.paid_on, lang), money(p.amount, lang)]), [175, 110, 90, 120], [3], lang);
    section(doc, t.open);
    table(doc, [t.supplier, t.invoice, t.dueDate, t.status, t.amount], m.open.map((o) => [o.vendor, o.invoice_no, o.due_date ? pdfDate(o.due_date, lang) : t.none, t.apStatus[o.status] ?? o.status.replace(/_/g, " "), money(o.amount, lang)]), [150, 95, 75, 75, 100], [4], lang);
    // Credit notes as their own lines, then the open total after them; a report with none shows neither.
    if (m.credits?.length) {
      section(doc, t.credits);
      table(doc, [t.supplier, t.invoice, t.amount], m.credits.map((c) => [c.vendor, c.invoice_no, money(c.amount, lang)]), [220, 135, 140], [2], lang);
      kv(doc, [[t.openNet, (m.open_net ?? []).map((a) => formatMoney(a.currency, a.total, lang)).join(", ") || t.none]]);
    }
    section(doc, t.blocked);
    table(doc, [t.supplier, t.invoice, t.amount, t.reasons], m.blocked.map((b) => [b.vendor, b.invoice_no, money(b.amount, lang), (b.why ?? b.reasons.map((detail) => ({ code: "", detail, signals: [] }))).map((f) => blockedReason(f, lang)).join("; ")]), [110, 85, 90, 210], [2], lang);
    section(doc, t.spend);
    table(doc, [t.supplier, t.count, t.amount], m.spend.map((s) => [s.vendor, String(s.count), formatMoney(s.currency, s.total, lang)]), [255, 80, 160], [1, 2], lang);
    section(doc, `${t.fees} · ${t.fxTitle}`);
    kv(doc, [[t.fees, m.fees.map((f) => formatMoney(f.currency, f.total, lang)).join(", ") || t.none],
      [t.fxTitle, m.fx.conversions ? `${m.fx.conversions} ${m.fx.conversions === 1 && lang === "nl" ? "omwisseling" : m.fx.conversions === 1 ? "conversion" : t.conversions}: ${t.bought} ${m.fx.bought.map((b) => formatMoney(b.currency, b.total, lang)).join(", ")}; ${t.sold} ${m.fx.sold.map((s) => formatMoney(s.currency, s.total, lang)).join(", ")}` : t.none]]);
    section(doc, t.pnl);
    pnlBlock(doc, m.pnl, lang);
    footer(doc, lang);
  });
}

export function vatPdf(company: string, v: VatOverview, lang: Lang = "nl"): Promise<Buffer> {
  const t = T[lang];
  return render(`${t.vat} ${v.quarter}`, v.to, (doc) => {
    header(doc, company, `${t.vat} ${v.quarter.replace("Q", "-Q")}`, `${v.from} – ${v.to}`, false, lang);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(WARN).text(t.vatNotice, 50, undefined, { width: 495 });
    section(doc, t.vat);
    table(doc, [t.rubric, t.base, t.vatAmt], Object.entries(v.rubrics).map(([k, x]) => [k, formatMoney("EUR", cents(x.base_cents), lang), formatMoney("EUR", cents(x.vat_cents), lang)]), [95, 200, 200], [1, 2], lang);
    kv(doc, [[t.owed, formatMoney("EUR", cents(v.owed_5a_cents), lang)], [t.input, formatMoney("EUR", cents(v.input_5b_cents), lang)], [t.balance, formatMoney("EUR", cents(v.balance_5c_cents), lang)],
      [t.uncoded, String(v.uncoded_lines)], [t.otherCurrency, String(v.other_currency_lines)]]);
    footer(doc, lang);
  });
}

export function yearReportPdf(company: string, y: YearData, lang: Lang = "nl", bank: Bank = "sandbox"): Promise<Buffer> {
  const t = T[lang];
  return render(`${t.year} ${y.year}`, `${y.year}-12-31`, (doc) => {
    header(doc, company, `${t.year} ${y.year}`, `${y.year}-01-01 – ${y.year}-12-31`, true, lang, bank);
    section(doc, `${t.pnl} (${t.beforeClose})`);
    pnlBlock(doc, y.pnl, lang);
    section(doc, `${t.balanceSheet} ${y.year}-12-31`);
    for (const b of y.balance) {
      table(doc, [t.account, "", b.currency], b.accounts.map((a) => [a.account, accountName(a.account, a.name, lang), formatMoney("", a.amount, lang)]), [60, 335, 100], [2], lang);
      kv(doc, [[t.assets, formatMoney(b.currency, b.assets, lang)], [t.liabilities, formatMoney(b.currency, b.liabilities, lang)], [t.equity, formatMoney(b.currency, b.equity, lang)],
        [t.openResult, formatMoney(b.currency, b.result, lang)], ["", b.balanced ? t.balanced : t.notBalanced]]);
    }
    section(doc, t.trial);
    table(doc, [t.account, "", t.currency, t.debit, t.credit, t.saldo], y.trial.map((r) => [r.account, accountName(r.account, r.name, lang), r.currency, formatMoney("", r.debit, lang), formatMoney("", r.credit, lang), formatMoney("", r.balance, lang)]),
      [45, 170, 45, 75, 75, 85], [3, 4, 5], lang);
    footer(doc, lang);
  });
}

/**
 * The month pack (src/ledger/pack.ts): the trial balance, the profit and loss, the balance sheet, the quarter's VAT
 * overview (a preparation, not a filing) and the open payables, every figure as the ledger's report functions give it.
 */
export function monthPackPdf(company: string, p: MonthPack, lang: Lang = "nl"): Promise<Buffer> {
  const t = T[lang];
  const amount = (currency: string, c: number) => formatMoney(currency, cents(c), lang);
  return render(`${t.pack} ${p.period.month}`, p.period.to, (doc) => {
    header(doc, company, `${t.pack} ${p.period.month}`, `${pdfDate(p.period.from, lang)} – ${pdfDate(p.period.to, lang)}`, true, lang);
    section(doc, t.period);
    if (p.period.locked) kv(doc, [[t.period, t.periodLocked], [t.lockedBy, p.period.locked_by ?? t.none], [t.lockedAt, p.period.locked_at ? pdfDate(p.period.locked_at, lang) : t.none]]);
    else doc.font("Helvetica-Bold").fontSize(9.5).fillColor(WARN).text(t.periodOpen, 50, undefined, { width: 495 });
    section(doc, `${t.trial} ${pdfDate(p.period.to, lang)}`);
    table(doc, [t.account, "", t.currency, t.debit, t.credit, t.saldo], p.trial.map((r) => [r.account, accountName(r.account, r.name, lang), r.currency, formatMoney("", cents(r.debit_cents), lang), formatMoney("", cents(r.credit_cents), lang), formatMoney("", cents(r.balance_cents), lang)]),
      [45, 170, 45, 75, 75, 85], [3, 4, 5], lang);
    section(doc, t.pnl);
    const pnl = Object.entries(p.pnl).sort(([a], [b]) => a.localeCompare(b));
    if (!pnl.length) table(doc, [], [], [], [], lang);
    for (const [currency, x] of pnl) {
      table(doc, [t.account, "", currency], x.accounts.map((a) => [a.account, accountName(a.account, a.name, lang), formatMoney("", cents(a.cents), lang)]), [60, 335, 100], [2], lang);
      kv(doc, [[t.revenue, amount(currency, x.revenue_cents)], [t.expense, amount(currency, x.expense_cents)], [t.result, amount(currency, x.result_cents)]]);
    }
    section(doc, `${t.balanceSheet} ${pdfDate(p.period.to, lang)}`);
    const balance = Object.entries(p.balance).sort(([a], [b]) => a.localeCompare(b));
    if (!balance.length) table(doc, [], [], [], [], lang);
    for (const [currency, b] of balance) {
      table(doc, [t.account, "", currency], b.accounts.map((a) => [a.account, accountName(a.account, a.name, lang), formatMoney("", cents(a.cents), lang)]), [60, 335, 100], [2], lang);
      kv(doc, [[t.assets, amount(currency, b.assets_cents)], [t.liabilities, amount(currency, b.liabilities_cents)], [t.equity, amount(currency, b.equity_cents)],
        [t.openResult, amount(currency, b.result_cents)], ["", b.balanced ? t.balanced : t.notBalanced]]);
    }
    section(doc, `${t.vat} ${p.vat.quarter.replace("Q", "-Q")} (${pdfDate(p.vat.from, lang)} – ${pdfDate(p.period.to, lang)}) · ${t.preparation}`);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(WARN).text(`${t.preparation}. ${t.vatNotice}`, 50, undefined, { width: 495 });
    doc.moveDown(0.4);
    table(doc, [t.rubric, t.base, t.vatAmt], Object.entries(p.vat.rubrics).map(([k, x]) => [k, amount("EUR", x.base_cents), amount("EUR", x.vat_cents)]), [95, 200, 200], [1, 2], lang);
    kv(doc, [[t.owed, amount("EUR", p.vat.owed_5a_cents)], [t.input, amount("EUR", p.vat.input_5b_cents)], [t.balance, amount("EUR", p.vat.balance_5c_cents)],
      [t.uncoded, String(p.vat.uncoded_lines)], [t.otherCurrency, String(p.vat.other_currency_lines)]]);
    section(doc, t.payables);
    table(doc, [t.party, t.docRef, t.dueDate, t.bucket, t.amount], p.payables.items.map((o) => [o.party, o.doc_ref, o.due_date ? pdfDate(o.due_date, lang) : t.none, o.bucket, amount(o.currency, o.open_cents)]),
      [130, 140, 75, 60, 90], [4], lang);
    footer(doc, lang);
  });
}

export function suppliersPdf(company: string, s: SuppliersData, dayOf: string, lang: Lang = "nl"): Promise<Buffer> {
  const t = T[lang];
  return render(`${t.suppliers} ${dayOf}`, dayOf, (doc) => {
    header(doc, company, t.suppliers, `${t.onDay} ${dayOf}`, false, lang);
    table(doc, [t.supplier, t.iban, t.bic, t.currency, t.status, t.invoices],
      s.rows.map((r) => [r.name, `•••• ${r.iban_last4}`, r.bic, r.currency, t.statusWord[r.status] ?? r.status.toLowerCase(), String(r.invoices)]), [150, 80, 90, 55, 70, 50], [5], lang);
    footer(doc, lang);
  });
}
