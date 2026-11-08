// The chart of accounts and cost centres the GL export codes payments with (E4). This is an example chart for
// Northwind Outdoor: map the numbers to your own ERP's chart here, and the export follows. Code only reads it.

import type { Agent } from "./policy.js";

export const CHART: Record<string, string> = {
  "1200": "Bank: Airwallex EUR (incl. company cards)",
  "1201": "Bank: Airwallex USD",
  "1202": "Bank: Airwallex GBP",
  "1210": "Bank: Metal account (*USDZ, testnet)",
  "1220": "Bank: Metal clearing (*USDZ, testnet)",
  "1590": "Money in transit (between own accounts)",
  "2900": "Unidentified receipts (suspense, until the CFO identifies them)",
  "3000": "Owner's equity: opening balances and owner funding",
  "4000": "Revenue: stock data sales to retailers",
  "4100": "Refunds to customers",
  "4200": "Revenue: wholesale to retailers (paid into Airwallex Global Accounts)",
  "5000": "Purchased stock data (warehouse API)",
  "6100": "Software subscriptions (company cards)",
  "6150": "Advertising (company cards)",
  "6200": "Goods from the manufacturer",
  "6300": "Travel (task cards)",
  "6350": "Data licence (Stockline, monthly)",
  "6800": "Bank and transfer fees",
  "6900": "Other supplier invoices",
};

/**
 * The payables accounts (src/ap/books.ts): input VAT and what we owe suppliers, for the accrual entries. Kept out of
 * CHART on purpose: CHART is the chart the cash journal and the T:0 sink mirror, and T:0 has no such accounts yet.
 */
/** The Airwallex bank account a currency's balance is booked on: EUR 1200, USD 1201, GBP 1202, any other 1203. */
export function bankAccountFor(currency: string): string {
  return currency === "EUR" ? "1200" : currency === "USD" ? "1201" : currency === "GBP" ? "1202" : "1203";
}

export const AP_CHART: Record<string, string> = {
  "1510": "Input VAT receivable (supplier invoices)",
  "2100": "Accounts payable (supplier invoices)",
  "1203": "Bank: Airwallex, other currencies (one balance per currency)",
};

/**
 * The rest of the stored ledger's accounts (src/ledger/): receivables, stock, VAT owed, retained earnings and cost of
 * goods sold. Kept out of CHART for the same reason as AP_CHART; the ledger accepts CHART, AP_CHART and these.
 */
export const LEDGER_CHART: Record<string, string> = {
  "1300": "Accounts receivable (customer invoices)",
  "1700": "Stock (goods, at average cost)",
  "2200": "VAT payable (to the tax authority)",
  "2210": "Output VAT (charged to customers)",
  "3100": "Retained earnings (closed years)",
  "8000": "Cost of goods sold (stock at average cost)",
};

export const COST_CENTRES: Record<Agent, string> & Record<string, string> = {
  sourcing: "CC100",
  support: "CC200",
  treasury: "CC300",
};

export const COST_CENTRE_NAMES: Record<string, string> = {
  CC100: "Sourcing agent (operations)",
  CC200: "Support agent (refunds and helpdesk software)",
  CC300: "Treasury agent (finance)",
  CC400: "Outside agents (agent API)",
  CC500: "Task cards (Ask Purser)",
};

/** Supplier invoices by vendor; anything not listed goes to 6900. */
export const VENDOR_GL: Record<string, string> = {
  "Bergtex Textil GmbH": "6200",
  "Stockline Data GmbH": "6350",
};

/** Card spend by merchant category; anything not listed goes to 6100. */
export const MCC_GL: Record<string, string> = {
  "5734": "6100",
  "7372": "6100",
  "7311": "6150",
  "4511": "6300",
  "7011": "6300",
  "4112": "6300",
};
