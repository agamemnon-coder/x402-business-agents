// The chart of accounts and cost centres the GL export codes payments with (E4). This is an example chart for
// Northwind Outdoor: map the numbers to your own ERP's chart here, and the export follows. Code only reads it.

import type { Agent } from "./policy.js";

export const CHART: Record<string, string> = {
  "1200": "Bank: Airwallex EUR (incl. company cards)",
  "1201": "Bank: Airwallex USD",
  "1210": "Bank: Metal account (*USDZ, testnet)",
  "1220": "Bank: Metal clearing (*USDZ, testnet)",
  "1590": "Money in transit (between own accounts)",
  "3000": "Owner's equity: opening balances and owner funding",
  "4000": "Revenue: stock data sales to retailers",
  "4100": "Refunds to customers",
  "5000": "Purchased stock data (warehouse API)",
  "6100": "Software subscriptions (company cards)",
  "6150": "Advertising (company cards)",
  "6200": "Goods from the manufacturer",
  "6300": "Travel (task cards)",
  "6800": "Bank and transfer fees",
  "6900": "Other supplier invoices",
};

export const COST_CENTRES: Record<Agent, string> & Record<string, string> = {
  sourcing: "CC100",
  support: "CC200",
  treasury: "CC300",
};

export const COST_CENTRE_NAMES: Record<string, string> = {
  CC100: "Operations agent (operations)",
  CC200: "Sales agent (ads and retail accounts)",
  CC300: "Finance agent (finance)",
  CC400: "Outside agents (agent API)",
  CC500: "Task cards (Ask Purser)",
};

/** Supplier invoices by vendor; anything not listed goes to 6900. */
export const VENDOR_GL: Record<string, string> = {
  "Bergtex Textil GmbH": "6200",
};

/** Card spend by merchant category; anything not listed goes to 6100. */
export const MCC_GL: Record<string, string> = {
  "5734": "6100",
  "7311": "6150",
  "4511": "6300",
  "7011": "6300",
  "4112": "6300",
};
