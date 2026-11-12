// The demo world's three test companies and their supplier invoices. Everything here is invented: the suppliers, their
// addresses and their bank details are the ones the repository's test fixtures already use (fixtures/, test/fakes,
// src/e2e/world.ts), where the account numbers only pass their checksum. No real company, person or account.
//
// Each company gets the same ten documents a visitor should see, with its own suppliers, amounts and currency:
// October (closed): three invoices paid. November: one paid, one paid in a foreign currency with its FX, one waiting
// for the CFO's signature, one held as possible fraud (changed bank details), one refused as a duplicate, one from a
// new supplier waiting to be verified, and one credit note.

export interface Supplier {
  name: string;
  /** Its address and VAT id, only where a fixture gives one (none is made up here). */
  address?: string;
  vatId?: string;
  iban: string;
  bic: string;
  /** VAT on its invoices, in percent. */
  vat: 9 | 19 | 21;
  /** The start of its invoice numbers. */
  prefix: string;
  /** One line on every invoice: what was delivered. */
  goods: string;
}

/** A supplier outside the euro area, paid in its own currency (test/fakes/fxInvoices.ts). */
export interface ForeignSupplier {
  name: string;
  currency: string;
  /** The invoice's text: its number, total and dates filled in. */
  text: (o: { date: string; due: string }) => string;
  filename: string;
}

export interface CompanySpec {
  /** The company's address in the cloud (DEMO_SLUGS) and its fixed tenant id. */
  slug: string;
  tenantId: string;
  name: string;
  /** One line: what the company does. */
  profile: string;
  /** Its own policy: the EUR reserve floor the CFO set with the test passkey. */
  eurFloor: string;
  /** Test money on its stand-in account when the world starts, in cents. */
  openingEurCents: number;
  /** The main supplier (four invoices, one of them forged), the second (two invoices and the credit note), the new one. */
  a: Supplier;
  b: Supplier;
  c: Supplier;
  foreign: ForeignSupplier;
  /** Net amounts: a's three real invoices and the forged one, b's two, c's one; and the credit note's total. */
  net: { a: [string, string, string, string]; b: [string, string]; c: string; credit: string };
  /** The account the forged invoice asks to be paid on (fixtures/hard/bergtex-invoice-subtle-beneficiary.txt). */
  forged: { iban: string; bic: string };
}

const BERGTEX: Supplier = { name: "Bergtex Textil GmbH", address: "Textilweg 4, 72760 Reutlingen, Germany", vatId: "DE123456789", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX", vat: 19, prefix: "BTX-2026-", goods: "Down jackets, production lot" };
const ZEELAND: Supplier = { name: "Zeeland Verpakkingen B.V.", vatId: "NL123456789B01", iban: "NL91 ABNA 0417 1643 00", bic: "ABNANL2A", vat: 21, prefix: "ZV-", goods: "Shipping boxes and tape" };
const LAGERHAUS: Supplier = { name: "Lagerhaus Nord GmbH", vatId: "DE987654321", iban: "DE75 5121 0800 1245 1261 99", bic: "BYLADEM1001", vat: 19, prefix: "LN-2026-", goods: "Warehouse space, one month" };
const MOLENAAR: Supplier = { name: "Meelhandel Molenaar B.V. (test)", vatId: "NL987654321B01", iban: "NL02 ABNA 0123 4567 89", bic: "ABNANL2A", vat: 9, prefix: "MM-2026-", goods: "Wheat and rye flour" };
const EXPRESS: Supplier = { name: "Verpakking Express B.V. (test)", vatId: "NL112233445B01", iban: "NL20 INGB 0001 2345 67", bic: "INGBNL2A", vat: 21, prefix: "VE-", goods: "Paper bags and cake boxes" };
const ONDERDELEN: Supplier = { name: "Onderdelen Direct B.V. (test)", vatId: "NL556677889B01", iban: "NL44 RABO 0123 4567 89", bic: "RABONL2U", vat: 21, prefix: "OD-", goods: "Bicycle chains, tyres and brake pads" };
const STOCKLINE: Supplier = { name: "Stockline Data GmbH", address: "Datenallee 12, 10115 Berlin, Germany", iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001", vat: 19, prefix: "SLL-2026-", goods: "Stock software licence, one month" };

const PINECREST: ForeignSupplier = {
  name: "Pinecrest Outdoor Supply LLC", currency: "USD", filename: "pinecrest-PC-7781.pdf",
  text: (o) => `Pinecrest Outdoor Supply LLC
412 5th Avenue, Seattle WA 98104
INVOICE PC-7781
Invoice date: ${o.date}
Due date: ${o.due}
Total due USD 2,400.00
Account number: 50001121
ABA routing number: 021000021
Bank country: US
Payment reference: PC-7781`,
};
const HARBOUR: ForeignSupplier = {
  name: "Harbour Rope Ltd", currency: "GBP", filename: "harbour-rope-HR-0042.pdf",
  text: (o) => `Harbour Rope Ltd
3 Quay Street, Bristol BS1 4DB
INVOICE HR-0042
Invoice date: ${o.date}
Due date: ${o.due}
Subtotal GBP 800.00
VAT 20% GBP 160.00
Total due GBP 960.00
Account number: 31926819
Sort code: 60-16-13
Bank country: GB
Payment reference: HR-0042`,
};
const BURSA: ForeignSupplier = {
  name: "Bursa Tekstil AS", currency: "TRY", filename: "bursa-tekstil-BT-5531.pdf",
  text: (o) => `Bursa Tekstil AS
Organize Sanayi Bolgesi, Bursa
INVOICE BT-5531
Invoice date: ${o.date}
Due date: ${o.due}
Total due TRY 52,000.00
IBAN: TR33 0006 1005 1978 6457 8413 26
Payment reference: BT-5531`,
};

/** The three companies, in the order the demo lists them. */
export const DEMO_COMPANIES: CompanySpec[] = [
  {
    slug: "northwind-outdoor", tenantId: "t_demo_northwind_outdoor", name: "Northwind Outdoor (test company)", profile: "An outdoor shop that sells jackets and tents online.",
    eurFloor: "2000.00", openingEurCents: 2_400_000, a: BERGTEX, b: ZEELAND, c: LAGERHAUS, foreign: PINECREST,
    net: { a: ["1554.62", "1420.00", "1610.00", "1585.00"], b: ["400.00", "360.00"], c: "1000.00", credit: "121.00" },
    forged: { iban: "DE54 3704 0044 0523 0130 00", bic: "COBADEFFXXX" },
  },
  {
    slug: "bakery-de-test", tenantId: "t_demo_bakery_de_test", name: "Bakery De Test (test company)", profile: "A bakery with two shops that buys flour and packaging every week.",
    eurFloor: "1500.00", openingEurCents: 1_200_000, a: MOLENAAR, b: EXPRESS, c: ZEELAND, foreign: BURSA,
    net: { a: ["860.00", "790.00", "905.00", "880.00"], b: ["240.00", "275.00"], c: "310.00", credit: "60.50" },
    forged: { iban: "DE54 3704 0044 0523 0130 00", bic: "COBADEFFXXX" },
  },
  {
    slug: "fietslab-bike-workshop", tenantId: "t_demo_fietslab_bike_workshop", name: "Fietslab Bike Workshop (test company)", profile: "A bike workshop that repairs and sells city bikes.",
    eurFloor: "1000.00", openingEurCents: 900_000, a: ONDERDELEN, b: STOCKLINE, c: EXPRESS, foreign: HARBOUR,
    net: { a: ["512.00", "468.00", "540.00", "525.00"], b: ["240.00", "260.00"], c: "185.00", credit: "47.60" },
    forged: { iban: "DE54 3704 0044 0523 0130 00", bic: "COBADEFFXXX" },
  },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-05" as the invoices write it: "5 October 2026". */
export const longDate = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

const cents = (amount: string) => Math.round(Number(amount) * 100);
const money = (c: number) => `${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
/** Net, VAT and total as the invoice prints them (1,554.62). */
export function amounts(net: string, vat: number): { net: string; vat: string; total: string } {
  const n = cents(net);
  const v = Math.round((n * vat) / 100);
  return { net: money(n), vat: money(v), total: money(n + v) };
}

/** A supplier's invoice as its text layer reads (the layout of test/fakes/apInvoices.ts EN). */
export function invoiceText(company: CompanySpec, s: Supplier, o: { no: string; date: string; due: string; net: string; bank?: { iban: string; bic: string }; extra?: string[] }): string {
  const a = amounts(o.net, s.vat);
  return [
    s.name, ...(s.address ? [s.address] : []), ...(s.vatId ? [`VAT ID: ${s.vatId}`] : []), `INVOICE ${o.no}`, `Invoice date: ${longDate(o.date)}`, `Due date: ${longDate(o.due)}`,
    `Bill to: ${company.name}`, `${s.goods}`,
    `Subtotal EUR ${a.net}`, `VAT ${s.vat}% EUR ${a.vat}`, `Total due EUR ${a.total}`,
    ...(o.extra ?? []),
    `IBAN: ${(o.bank ?? s).iban}`, `BIC: ${(o.bank ?? s).bic}`, `Payment reference: ${o.no}`,
    "Test document for the Purser demo world: an invented supplier, no real money.",
  ].join("\n");
}

/** A credit note from a supplier, as its text layer reads. */
export function creditText(company: CompanySpec, s: Supplier, o: { no: string; date: string; total: string; about: string }): string {
  return [
    s.name, ...(s.address ? [s.address] : []), ...(s.vatId ? [`VAT ID: ${s.vatId}`] : []), "CREDIT NOTE", `Credit note number: ${o.no}`, `Date: ${longDate(o.date)}`,
    `Bill to: ${company.name}`, `Credit for goods returned from invoice ${o.about}`,
    `Total amount EUR ${money(cents(o.total))}`,
    `IBAN: ${s.iban}`,
    "Test document for the Purser demo world: an invented supplier, no real money.",
  ].join("\n");
}
