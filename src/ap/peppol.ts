// Peppol receive (19 Nov): an incoming UBL 2.1 invoice or credit note in Peppol BIS Billing 3.0, as an Access Point
// delivers it, read strictly and filed in the payables inbox like any other invoice (src/ap/inbox.ts ingestDocument).
//
// 1. The XML is parsed by src/ap/xmlStrict.ts: no DTD, no entities beyond XML's five, UTF-8 only, size and depth caps.
//    A document that is not well-formed, or not a UBL Invoice-2 or CreditNote-2, is refused: nothing is filed.
// 2. The fields are taken from their UBL places (no model reads anything): they are the reading the checks run on.
// 3. The business rules of EN 16931 and Peppol BIS 3.0 that decide what is paid are checked in code (the list is
//    PEPPOL_RULES below): the totals (BR-CO-10 to BR-CO-16), the VAT breakdown (BR-CO-14, BR-CO-17, BR-CO-18 and each
//    category's taxable amount, BR-S-08 and its siblings), every amount in the invoice currency (PEPPOL-EN16931-R051) and
//    that currency an ISO 4217 code (BR-CL-04), two decimals (BR-DEC), a line's net amount (PEPPOL-EN16931-R120), a due
//    date or terms when something is due (BR-CO-25), an account for a credit transfer (BR-61). Purser adds its own for
//    payment: a SEPA credit transfer's account must be an IBAN with a valid checksum, and any account written as an IBAN
//    must pass it; a payee who is not the seller (factoring), more than one account to pay, or a direct debit each hold
//    the invoice for a person. Any rule broken holds the invoice for a person; a credit note is never paid.
// 4. A plain-text rendering of the invoice (seller, number, dates, lines, notes, totals, the account) goes with it, so
//    every check that reads a document's words (injection, bank-change and pressure language, item lines, service
//    periods) reads a Peppol invoice too.
//
// Not covered: the full EN 16931 and Peppol schematrons (several hundred rules, code lists of every kind), XSD
// validation, and embedded attachments (an AdditionalDocumentReference's binary object is not opened). An Access Point
// validates incoming messages against the full set before it delivers them; these checks are Purser's own, for what
// it pays. docs/integrations/peppol.md says what receiving takes.

import type { Finding } from "./checkerCore.js";
import { ibanValid, type ApReading } from "./reading.js";
import { attr, child, kids, parseXmlStrict, XmlRefused, type XmlElement, type XmlLimits } from "./xmlStrict.js";

export const UBL_NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  creditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
} as const;
/** BT-24 for Peppol BIS Billing 3.0 (PEPPOL-EN16931-R004). */
export const BIS3_CUSTOMIZATION = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
/** BT-23 for the billing process (PEPPOL-EN16931-R001 requires one; R007 its form). */
export const BIS3_PROFILE = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
/** The size a Peppol document may have here: far above an invoice with an embedded PDF of a few pages. */
export const PEPPOL_MAX_BYTES = 8 * 1024 * 1024;
const LIMITS: XmlLimits = { maxBytes: PEPPOL_MAX_BYTES, maxDepth: 32, maxElements: 20_000, maxAttrs: 16, maxNameLength: 128, maxTextLength: PEPPOL_MAX_BYTES };

/** The rules checked here, each with what it says (EN 16931-1, Peppol BIS Billing 3.0, and Purser's own for payment). */
export const PEPPOL_RULES: Readonly<Record<string, string>> = {
  "PEPPOL-EN16931-R001": "Business process (BT-23, cbc:ProfileID) must be provided",
  "PEPPOL-EN16931-R004": "Specification identifier (BT-24) must be Peppol BIS Billing 3.0's",
  "BR-02": "An invoice shall have an invoice number (BT-1)",
  "BR-03": "An invoice shall have an issue date (BT-2), a valid date",
  "BR-04": "An invoice shall have a type code (BT-3)",
  "BR-05": "An invoice shall have an invoice currency code (BT-5)",
  "BR-CL-04": "The invoice currency code shall be an ISO 4217 code",
  "BR-06": "An invoice shall contain the seller's name (BT-27)",
  "BR-07": "An invoice shall contain the buyer's name (BT-44)",
  "BR-12": "Sum of invoice line net amount (BT-106) shall be present",
  "BR-13": "Invoice total amount without VAT (BT-109) shall be present",
  "BR-14": "Invoice total amount with VAT (BT-112) shall be present",
  "BR-15": "Amount due for payment (BT-115) shall be present",
  "BR-16": "An invoice shall have at least one invoice line",
  "BR-53": "If a VAT accounting currency (BT-6) is given, the total VAT in it (BT-111) shall be provided",
  "PEPPOL-EN16931-R051": "Every amount's currencyID shall be the invoice currency (BT-5), except the total VAT in accounting currency (BT-111)",
  "BR-DEC": "Amounts BT-106 to BT-115, BT-116, BT-117, BT-131, BT-92 and BT-99 have at most two decimals",
  "PEPPOL-EN16931-R120": "Line net amount (BT-131) = quantity × (net price / base quantity) + line charges − line allowances, rounded to two decimals",
  "BR-CO-10": "Sum of invoice line net amount (BT-106) = Σ invoice line net amounts (BT-131)",
  "BR-CO-11": "Sum of allowances on document level (BT-107) = Σ document level allowance amounts (BT-92)",
  "BR-CO-12": "Sum of charges on document level (BT-108) = Σ document level charge amounts (BT-99)",
  "BR-CO-13": "Invoice total amount without VAT (BT-109) = BT-106 − BT-107 + BT-108",
  "BR-CO-14": "Invoice total VAT amount (BT-110) = Σ VAT category tax amounts (BT-117)",
  "BR-CO-15": "Invoice total amount with VAT (BT-112) = BT-109 + BT-110",
  "BR-CO-16": "Amount due for payment (BT-115) = BT-112 − paid amount (BT-113) + rounding amount (BT-114)",
  "BR-CO-17": "VAT category tax amount (BT-117) = VAT category taxable amount (BT-116) × rate (BT-119) / 100, rounded to two decimals (the schematron allows ±1)",
  "BR-CO-18": "An invoice shall have at least one VAT breakdown group (BG-23)",
  "BR-xx-08": "Each VAT breakdown's taxable amount (BT-116) = Σ line net amounts + document charges − document allowances of that category and rate (BR-S-08, BR-Z-08, BR-E-08, BR-AE-08, BR-K-08, BR-G-08, BR-O-08)",
  "BR-CO-25": "When the amount due (BT-115) is positive, a payment due date (BT-9) or payment terms (BT-20) shall be present",
  "BR-61": "A credit transfer (payment means 30 or 58) shall have a payment account identifier (BT-84)",
  "PURSER-IBAN": "Purser's own: a SEPA credit transfer's account (58) is an IBAN with a valid ISO 13616 checksum, and any account written as an IBAN passes it",
};

export interface PeppolViolation { rule: string; message: string }

export interface PeppolLine { id: string; name: string; description: string; quantity: string; net: string; category: string; percent: string }
export interface PeppolPayment { code: string; paymentId: string; account: string; accountName: string; bic: string; dueDate: string }
export interface PeppolInvoice {
  kind: "invoice" | "credit_note";
  typeCode: string;
  id: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  customizationId: string;
  profileId: string;
  seller: { name: string; tradingName: string; vatId: string; endpoint: string; address: string };
  buyer: { name: string };
  /** BG-10, when the invoice names a payee other than the seller. */
  payee: { name: string } | null;
  payments: PeppolPayment[];
  terms: string;
  notes: string[];
  orderReference: string;
  lines: PeppolLine[];
  totals: { lineExtension: string; taxExclusive: string; taxInclusive: string; allowance: string; charge: string; prepaid: string; rounding: string; payable: string; tax: string };
  vat: { category: string; percent: string; taxable: string; tax: string }[];
}

export interface PeppolResult {
  invoice: PeppolInvoice;
  /** The business rules broken; empty when all the rules checked here hold. */
  violations: PeppolViolation[];
  /** The fields as Purser's checks take them (src/ap/reading.ts ApReading). */
  reading: ApReading;
  /** The invoice as plain text, for the checks that read words. */
  text: string;
  /** What the inbox files with it: each broken rule, and Purser's own payment flags, held for a person. */
  findings: Finding[];
}

export class PeppolRefused extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PeppolRefused";
  }
}

/** Whether bytes look like an XML document (after an optional BOM and whitespace): the inbox then reads them as Peppol. */
export function looksLikeXml(bytes: Uint8Array): boolean {
  let k = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) k = 3;
  while (k < bytes.length && k < 64 && (bytes[k] === 0x20 || bytes[k] === 0x09 || bytes[k] === 0x0a || bytes[k] === 0x0d)) k++;
  return bytes[k] === 0x3c && (bytes[k + 1] === 0x3f || (bytes[k + 1]! >= 0x41 && bytes[k + 1]! <= 0x7a));
}

// ── Decimal arithmetic on strings: amounts are exact, never floating point ──

const SCALE = 6;
const ONE = 10n ** BigInt(SCALE);
/** A decimal string as an integer of millionths; null when it is not a plain decimal. */
function micro(s: string): bigint | null {
  const m = /^\s*([+-])?(\d{1,15})(?:\.(\d{1,6}))?\s*$/.exec(s);
  if (!m) return null;
  const v = BigInt(m[2]!) * ONE + BigInt((m[3] ?? "").padEnd(SCALE, "0"));
  return m[1] === "-" ? -v : v;
}
const decimals = (s: string) => /\.(\d+)\s*$/.exec(s)?.[1]?.length ?? 0;
/** Rounded half away from zero to two decimals, still in millionths. */
function round2(v: bigint): bigint {
  const unit = 10n ** BigInt(SCALE - 2);
  const q = v / unit, r = v % unit;
  const half = unit / 2n;
  return (r >= half ? q + 1n : r <= -half ? q - 1n : q) * unit;
}
/** Millionths as a plain decimal with two places ("1656.25"). */
function money(v: bigint): string {
  const c = round2(v) / 10n ** BigInt(SCALE - 2);
  const neg = c < 0n, a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}
const fmt = (s: string) => { const v = micro(s); return v === null ? "" : money(v); };

// ── Reading the UBL ──

const { cac, cbc } = UBL_NS;
const t = (el: XmlElement | null | undefined) => (el?.text ?? "").trim();
const at = (el: XmlElement | null | undefined, ...path: [string, string][]): XmlElement | null => {
  let cur: XmlElement | null = el ?? null;
  for (const [ns, local] of path) cur = child(cur, ns, local);
  return cur;
};
const C = (local: string): [string, string] => [cac, local];
const B = (local: string): [string, string] => [cbc, local];
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Parses and checks a Peppol UBL document; throws PeppolRefused when it cannot be read as one. */
export function receivePeppol(bytes: Uint8Array | string): PeppolResult {
  let root: XmlElement;
  try {
    root = parseXmlStrict(bytes, LIMITS);
  } catch (e) {
    if (e instanceof XmlRefused) throw new PeppolRefused(`not read: ${e.message}`, `xml_${e.code}`);
    throw e;
  }
  const isInvoice = root.ns === UBL_NS.invoice && root.local === "Invoice";
  const isCredit = root.ns === UBL_NS.creditNote && root.local === "CreditNote";
  if (!isInvoice && !isCredit) throw new PeppolRefused(`not a UBL 2.1 invoice or credit note: the root is {${root.ns.slice(0, 80)}}${root.local.slice(0, 40)}`, "not_ubl");

  const v: PeppolViolation[] = [];
  const broke = (rule: string, message: string) => v.push({ rule, message });
  const currency = t(child(root, cbc, "DocumentCurrencyCode"));
  const taxCurrency = t(child(root, cbc, "TaxCurrencyCode"));

  // Every amount element, wherever it is: the currency check (R051) and the two decimals (BR-DEC) read them all.
  const amounts: { el: XmlElement; path: string }[] = [];
  const walk = (el: XmlElement, path: string) => {
    for (const c of el.children) {
      const p = `${path}/${c.local}`;
      if (c.ns === cbc && attr(c, "currencyID") !== null) amounts.push({ el: c, path: p });
      walk(c, p);
    }
  };
  walk(root, root.local);

  const supplier = at(root, C("AccountingSupplierParty"), C("Party"));
  const sellerVat = kids(supplier, cac, "PartyTaxScheme").find((x) => t(at(x, C("TaxScheme"), B("ID"))).toUpperCase() === "VAT");
  const addr = at(supplier, C("PostalAddress"));
  const typeCode = t(child(root, cbc, isInvoice ? "InvoiceTypeCode" : "CreditNoteTypeCode"));
  const payments: PeppolPayment[] = kids(root, cac, "PaymentMeans").map((pm) => ({
    code: t(child(pm, cbc, "PaymentMeansCode")),
    paymentId: t(child(pm, cbc, "PaymentID")),
    account: t(at(pm, C("PayeeFinancialAccount"), B("ID"))).replace(/\s+/g, ""),
    accountName: t(at(pm, C("PayeeFinancialAccount"), B("Name"))),
    bic: t(at(pm, C("PayeeFinancialAccount"), C("FinancialInstitutionBranch"), B("ID"))).replace(/\s+/g, "").toUpperCase(),
    dueDate: t(child(pm, cbc, "PaymentDueDate")),
  }));
  const lmt = child(root, cac, "LegalMonetaryTotal");
  const T = (local: string) => t(child(lmt, cbc, local));
  // BT-110 is the TaxTotal in the invoice currency; a second one in the accounting currency is BT-111.
  const taxTotals = kids(root, cac, "TaxTotal");
  const docTax = taxTotals.find((x) => attr(child(x, cbc, "TaxAmount"), "currencyID") === currency) ?? taxTotals[0] ?? null;
  const lineName = isInvoice ? "InvoiceLine" : "CreditNoteLine";
  const qtyName = isInvoice ? "InvoicedQuantity" : "CreditedQuantity";
  const lineEls = kids(root, cac, lineName);
  const lines: PeppolLine[] = lineEls.map((l) => ({
    id: t(child(l, cbc, "ID")), name: t(at(l, C("Item"), B("Name"))), description: t(at(l, C("Item"), B("Description"))),
    quantity: t(child(l, cbc, qtyName)), net: t(child(l, cbc, "LineExtensionAmount")),
    category: t(at(l, C("Item"), C("ClassifiedTaxCategory"), B("ID"))), percent: t(at(l, C("Item"), C("ClassifiedTaxCategory"), B("Percent"))),
  }));
  const payeeName = t(at(root, C("PayeeParty"), C("PartyName"), B("Name")));
  const invoice: PeppolInvoice = {
    kind: isCredit || typeCode === "381" ? "credit_note" : "invoice", typeCode,
    id: t(child(root, cbc, "ID")), issueDate: t(child(root, cbc, "IssueDate")),
    dueDate: t(child(root, cbc, "DueDate")) || payments.find((p) => p.dueDate)?.dueDate || "",
    currency, customizationId: t(child(root, cbc, "CustomizationID")), profileId: t(child(root, cbc, "ProfileID")),
    seller: {
      name: t(at(supplier, C("PartyLegalEntity"), B("RegistrationName"))), tradingName: t(at(supplier, C("PartyName"), B("Name"))),
      vatId: t(child(sellerVat ?? null, cbc, "CompanyID")), endpoint: t(child(supplier, cbc, "EndpointID")),
      address: [t(child(addr, cbc, "StreetName")), t(child(addr, cbc, "AdditionalStreetName")), [t(child(addr, cbc, "PostalZone")), t(child(addr, cbc, "CityName"))].filter(Boolean).join(" "), t(at(addr, C("Country"), B("IdentificationCode")))].filter(Boolean).join(", "),
    },
    buyer: { name: t(at(root, C("AccountingCustomerParty"), C("Party"), C("PartyLegalEntity"), B("RegistrationName"))) },
    payee: payeeName || child(root, cac, "PayeeParty") ? { name: payeeName || t(at(root, C("PayeeParty"), C("PartyLegalEntity"), B("RegistrationName"))) } : null,
    payments,
    terms: t(at(root, C("PaymentTerms"), B("Note"))),
    notes: kids(root, cbc, "Note").map(t).filter(Boolean),
    orderReference: t(at(root, C("OrderReference"), B("ID"))),
    lines,
    totals: {
      lineExtension: T("LineExtensionAmount"), taxExclusive: T("TaxExclusiveAmount"), taxInclusive: T("TaxInclusiveAmount"), allowance: T("AllowanceTotalAmount"),
      charge: T("ChargeTotalAmount"), prepaid: T("PrepaidAmount"), rounding: T("PayableRoundingAmount"), payable: T("PayableAmount"), tax: t(child(docTax, cbc, "TaxAmount")),
    },
    vat: kids(docTax, cac, "TaxSubtotal").map((s) => ({
      category: t(at(s, C("TaxCategory"), B("ID"))), percent: t(at(s, C("TaxCategory"), B("Percent"))), taxable: t(child(s, cbc, "TaxableAmount")), tax: t(child(s, cbc, "TaxAmount")),
    })),
  };

  // ── Presence and form ──
  if (!invoice.profileId) broke("PEPPOL-EN16931-R001", "no business process (cbc:ProfileID)");
  if (invoice.customizationId !== BIS3_CUSTOMIZATION) broke("PEPPOL-EN16931-R004", `the specification identifier is "${invoice.customizationId.slice(0, 120)}", not Peppol BIS Billing 3.0's`);
  if (!invoice.id) broke("BR-02", "no invoice number");
  if (!isDate(invoice.issueDate)) broke("BR-03", invoice.issueDate ? `the issue date "${invoice.issueDate.slice(0, 20)}" is not a date` : "no issue date");
  if (!typeCode) broke("BR-04", "no type code");
  if (!currency) broke("BR-05", "no invoice currency code");
  else if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) broke("BR-CL-04", `the invoice currency "${currency.slice(0, 10)}" is not an ISO 4217 code`);
  if (!invoice.seller.name) broke("BR-06", "no seller name (cac:PartyLegalEntity/cbc:RegistrationName)");
  if (!invoice.buyer.name) broke("BR-07", "no buyer name");
  for (const [rule, local] of [["BR-12", "LineExtensionAmount"], ["BR-13", "TaxExclusiveAmount"], ["BR-14", "TaxInclusiveAmount"], ["BR-15", "PayableAmount"]] as const) if (!T(local)) broke(rule, `no ${local} in the totals`);
  if (!lines.length) broke("BR-16", "no invoice line");
  if (invoice.dueDate && !isDate(invoice.dueDate)) broke("BR-03", `the due date "${invoice.dueDate.slice(0, 20)}" is not a date`);
  if (taxCurrency && taxCurrency !== currency && !taxTotals.some((x) => attr(child(x, cbc, "TaxAmount"), "currencyID") === taxCurrency)) broke("BR-53", `VAT accounting currency ${taxCurrency} given, but no total VAT in it`);

  // ── Currency and decimals on every amount ──
  const bt111 = taxTotals.find((x) => x !== docTax && !kids(x, cac, "TaxSubtotal").length);
  for (const { el, path } of amounts) {
    const cur = attr(el, "currencyID")!;
    const allowedOther = taxCurrency && el.local === "TaxAmount" && bt111 && bt111.children.includes(el) && cur === taxCurrency;
    if (currency && cur !== currency && !allowedOther) broke("PEPPOL-EN16931-R051", `${path} is in ${cur.slice(0, 10)}, not ${currency}`);
    if (micro(t(el)) === null) broke("BR-DEC", `${path} "${t(el).slice(0, 30)}" is not a decimal amount`);
  }
  const twoDecimals: [string, string][] = [
    ...(["LineExtensionAmount", "TaxExclusiveAmount", "TaxInclusiveAmount", "AllowanceTotalAmount", "ChargeTotalAmount", "PrepaidAmount", "PayableRoundingAmount", "PayableAmount"].map((x) => [`LegalMonetaryTotal/${x}`, T(x)] as [string, string])),
    ["TaxTotal/TaxAmount", invoice.totals.tax],
    ...invoice.vat.flatMap((x) => [["TaxSubtotal/TaxableAmount", x.taxable], ["TaxSubtotal/TaxAmount", x.tax]] as [string, string][]),
    ...lines.map((l) => [`${lineName} ${l.id}/LineExtensionAmount`, l.net] as [string, string]),
    ...kids(root, cac, "AllowanceCharge").map((a) => ["AllowanceCharge/Amount", t(child(a, cbc, "Amount"))] as [string, string]),
  ];
  for (const [where, s] of twoDecimals) if (s && decimals(s) > 2) broke("BR-DEC", `${where} "${s}" has more than two decimals`);

  // ── The sums ──
  const sum = (xs: (bigint | null)[]) => xs.reduce<bigint>((a, b) => a + (b ?? 0n), 0n);
  const docAc = kids(root, cac, "AllowanceCharge").map((a) => ({
    charge: t(child(a, cbc, "ChargeIndicator")).toLowerCase() === "true", amount: micro(t(child(a, cbc, "Amount"))),
    category: t(at(a, C("TaxCategory"), B("ID"))), percent: t(at(a, C("TaxCategory"), B("Percent"))),
  }));
  const m = (s: string) => (s ? micro(s) : 0n);
  const lineSum = sum(lines.map((l) => micro(l.net)));
  const allowances = sum(docAc.filter((a) => !a.charge).map((a) => a.amount));
  const charges = sum(docAc.filter((a) => a.charge).map((a) => a.amount));
  const lx = m(invoice.totals.lineExtension), ax = m(invoice.totals.allowance), cx = m(invoice.totals.charge), te = m(invoice.totals.taxExclusive);
  const ti = m(invoice.totals.taxInclusive), tax = m(invoice.totals.tax), pre = m(invoice.totals.prepaid), rnd = m(invoice.totals.rounding), pay = m(invoice.totals.payable);
  const eq = (rule: string, got: bigint | null, want: bigint, what: string) => { if (got !== null && got !== want) broke(rule, `${what}: ${money(got)} printed, ${money(want)} by the rule`); };
  if (invoice.totals.lineExtension && lines.length) eq("BR-CO-10", lx, lineSum, "sum of line net amounts (BT-106)");
  if (invoice.totals.allowance || allowances) eq("BR-CO-11", ax ?? 0n, allowances, "sum of document allowances (BT-107)");
  if (invoice.totals.charge || charges) eq("BR-CO-12", cx ?? 0n, charges, "sum of document charges (BT-108)");
  if (invoice.totals.taxExclusive && lx !== null) eq("BR-CO-13", te, (lx ?? 0n) - (ax ?? 0n) + (cx ?? 0n), "total without VAT (BT-109)");
  if (docTax) eq("BR-CO-14", tax, sum(invoice.vat.map((x) => micro(x.tax))), "total VAT (BT-110) against the VAT breakdown");
  if (invoice.totals.taxInclusive && te !== null) eq("BR-CO-15", ti, (te ?? 0n) + (tax ?? 0n), "total with VAT (BT-112)");
  if (invoice.totals.payable && ti !== null) eq("BR-CO-16", pay, (ti ?? 0n) - (pre ?? 0n) + (rnd ?? 0n), "amount due (BT-115)");
  if (!invoice.vat.length) broke("BR-CO-18", "no VAT breakdown (cac:TaxSubtotal)");

  // ── The VAT breakdown, per category and rate ──
  const pct = (s: string) => (s ? micro(s) ?? 0n : 0n);
  const keyOf = (category: string, percent: string) => `${category.toUpperCase()}|${pct(percent)}`;
  for (const g of invoice.vat) {
    const taxable = micro(g.taxable), gtax = micro(g.tax);
    if (taxable === null || gtax === null) continue;
    const k = keyOf(g.category, g.percent);
    const want = sum(lines.filter((l) => keyOf(l.category, l.percent) === k).map((l) => micro(l.net)))
      + sum(docAc.filter((a) => a.charge && keyOf(a.category, a.percent) === k).map((a) => a.amount))
      - sum(docAc.filter((a) => !a.charge && keyOf(a.category, a.percent) === k).map((a) => a.amount));
    if (taxable !== want) broke(`BR-${g.category.toUpperCase() || "xx"}-08`, `VAT breakdown ${g.category} ${g.percent || ""}: taxable ${money(taxable)} printed, ${money(want)} from the lines and document allowances and charges`);
    const expected = round2((taxable * pct(g.percent)) / (100n * ONE));
    const diff = gtax > expected ? gtax - expected : expected - gtax;
    if (diff > ONE) broke("BR-CO-17", `VAT breakdown ${g.category} ${g.percent || ""}: tax ${money(gtax)} printed, ${money(expected)} = ${money(taxable)} × ${g.percent || "0"}%`);
  }

  // ── Each line's net amount (R120) ──
  for (const l of lineEls) {
    const qty = micro(t(child(l, cbc, qtyName)));
    const price = micro(t(at(l, C("Price"), B("PriceAmount"))));
    const baseRaw = t(at(l, C("Price"), B("BaseQuantity")));
    const base = baseRaw ? micro(baseRaw) : ONE;
    const net = micro(t(child(l, cbc, "LineExtensionAmount")));
    if (qty === null || price === null || !base || net === null) continue;
    const ac = kids(l, cac, "AllowanceCharge").map((a) => ({ charge: t(child(a, cbc, "ChargeIndicator")).toLowerCase() === "true", amount: micro(t(child(a, cbc, "Amount"))) ?? 0n }));
    const want = round2((qty * price) / base + sum(ac.filter((a) => a.charge).map((a) => a.amount)) - sum(ac.filter((a) => !a.charge).map((a) => a.amount)));
    if (net !== want) broke("PEPPOL-EN16931-R120", `line ${t(child(l, cbc, "ID")).slice(0, 20)}: net ${money(net)} printed, ${money(want)} from quantity × price`);
  }

  // ── Payment ──
  if ((pay ?? 0n) > 0n && !invoice.dueDate && !invoice.terms) broke("BR-CO-25", "an amount is due but there is no due date and no payment terms");
  for (const p of payments) {
    if ((p.code === "30" || p.code === "58") && !p.account) broke("BR-61", `payment means ${p.code} (credit transfer) without an account (BT-84)`);
    const looksIban = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(p.account.toUpperCase());
    if (p.code === "58" && p.account && !ibanValid(p.account)) broke("PURSER-IBAN", `SEPA credit transfer to "${p.account.slice(0, 40)}", which is not a valid IBAN`);
    else if (looksIban && !ibanValid(p.account)) broke("PURSER-IBAN", `the account "${p.account.slice(0, 40)}" is written as an IBAN but its checksum or length is wrong`);
  }

  // ── Purser's flags for payment ──
  const findings: Finding[] = v.map((x) => ({ code: "peppol_rule", level: "review", detail: `${x.rule.startsWith("PURSER-") ? "Purser's payment rule" : "Peppol BIS 3.0 rule"} ${x.rule} broken: ${x.message}. A person checks the invoice with the supplier before anything is paid` }));
  const sameName = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (invoice.payee && !(sameName(invoice.payee.name, invoice.seller.name) || sameName(invoice.payee.name, invoice.seller.tradingName))) {
    findings.push({ code: "peppol_payee_not_seller", level: "review", detail: `the invoice names a payee, "${invoice.payee.name.slice(0, 80)}", who is not the seller (factoring or a collection agent): a person confirms with the supplier on a number on file` });
  }
  const accounts = new Set(payments.filter((p) => p.account).map((p) => p.account.toUpperCase()));
  if (accounts.size > 1) findings.push({ code: "peppol_several_accounts", level: "review", detail: `the invoice names ${accounts.size} accounts to pay: a person chooses the one on file` });
  const debit = payments.find((p) => p.code === "49" || p.code === "59");
  if (debit) findings.push({ code: "peppol_direct_debit", level: "review", detail: `payment means ${debit.code}: the supplier collects it by direct debit, so a transfer as well would pay it twice; a person checks` });
  if (invoice.kind === "invoice" && (pay ?? 0n) < 0n) findings.push({ code: "credit_note", level: "review", detail: "a negative amount due: the supplier owes this, nothing is paid; a person sets it against the next invoice" });

  const reading = readingOf(invoice);
  return { invoice, violations: v, reading, text: renderText(invoice), findings };
}

/** The fields Purser's checks take, from their UBL places. */
function readingOf(x: PeppolInvoice): ApReading {
  const pay = x.payments.find((p) => (p.code === "30" || p.code === "58" || p.code === "31" || p.code === "42") && p.account) ?? x.payments.find((p) => p.account) ?? null;
  const acct = pay?.account.toUpperCase() ?? "";
  const iban = acct && ibanValid(acct) ? acct : "";
  return {
    vendor: x.seller.name || x.seller.tradingName, vat_id: x.seller.vatId, invoice_no: x.id, issue_date: isDate(x.issueDate) ? x.issueDate : "", due_date: isDate(x.dueDate) ? x.dueDate : "",
    currency: x.currency, subtotal: fmt(x.totals.taxExclusive), tax: fmt(x.totals.tax), total: fmt(x.totals.payable),
    iban, bic: pay?.bic ?? "", account_number: iban ? "" : acct, routing_type: "", routing_value: "",
    bank_country: iban ? iban.slice(0, 2) : /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(pay?.bic ?? "") ? pay!.bic.slice(4, 6) : "",
    reference: pay?.paymentId || x.id, gl_account: "",
  };
}

const group = (i: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const shown = (cur: string, s: string) => { const f = fmt(s); if (!f) return `${cur} ${s}`; const neg = f.startsWith("-"); const [i, d] = f.replace("-", "").split("."); return `${neg ? "-" : ""}${cur} ${group(i!)}.${d}`; };

/** The invoice as a supplier's document would print it, in English labels: the words every text check reads. */
function renderText(x: PeppolInvoice): string {
  const pay = x.payments.find((p) => p.account) ?? x.payments[0];
  const acct = pay?.account.toUpperCase() ?? "";
  return [
    x.seller.name || x.seller.tradingName,
    ...(x.seller.tradingName && x.seller.tradingName !== x.seller.name ? [x.seller.tradingName] : []),
    ...(x.seller.address ? [x.seller.address] : []),
    ...(x.seller.vatId ? [`VAT ID: ${x.seller.vatId}`] : []),
    `${x.kind === "credit_note" ? "CREDIT NOTE" : "INVOICE"} ${x.id}`,
    `Invoice date: ${x.issueDate}`,
    ...(x.dueDate ? [`Due date: ${x.dueDate}`] : []),
    ...(x.orderReference ? [`Order: ${x.orderReference}`] : []),
    "",
    ...x.lines.map((l) => [l.name, l.description].filter(Boolean).join(": ")),
    "",
    `Subtotal ${shown(x.currency, x.totals.taxExclusive)}`,
    `VAT ${shown(x.currency, x.totals.tax)}`,
    `Total due ${shown(x.currency, x.totals.payable)}`,
    "",
    ...x.notes,
    ...(x.terms ? [`Payment terms: ${x.terms}`] : []),
    ...(x.payee ? [`Payee: ${x.payee.name}`] : []),
    ...(pay?.accountName ? [`Account name: ${pay.accountName}`] : []),
    ...(acct ? [ibanValid(acct) ? `IBAN: ${acct.replace(/(.{4})/g, "$1 ").trim()}` : `Account number: ${acct}`] : []),
    ...(pay?.bic ? [`BIC: ${pay.bic}`] : []),
    `Payment reference: ${pay?.paymentId || x.id}`,
  ].join("\n");
}
