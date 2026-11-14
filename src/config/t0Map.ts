// Version 2 of the mapping from Purser's chart (src/config/gl.ts) to accounts that already exist in the shared T:0 demo
// entity ("T:0 Sandbox"). T:0 replaced that entity's chart on 10 Nov 2026 (261 accounts, a SaaS chart); version 1 pointed
// at the old Mercury/Ramp chart and no longer resolves. The API cannot create accounts, so with `--map sandbox` any of
// our codes that T:0 does not have under its own number goes to the account below. Used only when our code is missing.
// Several of our accounts share one T:0 account; each line's memo then names our account ("Purser 1200 Airwallex EUR").

export const T0_MAP_VERSION = 2;

export interface T0MapTarget { number: string; name: string; note: string }

export const T0_SANDBOX_MAP: Record<string, T0MapTarget> = {
  "1200": { number: "11120", name: "Operating Checking Account #2", note: "bank; the money is in Airwallex EUR" },
  "1201": { number: "11210", name: "Savings Account #1", note: "bank; the money is in Airwallex USD" },
  "1202": { number: "11310", name: "Money Market #1", note: "bank; the money is in Airwallex GBP" },
  "1210": { number: "11410", name: "Payment Processor #1", note: "bank-type; Alta testnet money (*USDZ) kept off the operating accounts" },
  "1220": { number: "11420", name: "Payment Processor #2", note: "bank-type; Alta clearing, testnet money, kept apart from 1210" },
  "1590": { number: "11999", name: "Money in Transit", note: "money in transit between own accounts" },
  "2900": { number: "24000", name: "Other Current Liabilities", note: "suspense: unidentified receipts until the CFO identifies them" },
  "3000": { number: "32000", name: "Common Stock", note: "owner's equity" },
  "4000": { number: "42000", name: "Services Revenue", note: "income; stock data sales" },
  "4100": { number: "42000", name: "Services Revenue", note: "income; refunds are debits, so they reduce it" },
  "4200": { number: "42000", name: "Services Revenue", note: "income; wholesale to retailers" },
  "5000": { number: "51200", name: "Third-Party Services & Licenses", note: "cost of goods sold; purchased stock data" },
  "6100": { number: "63410", name: "Software Subscriptions", note: "expenses" },
  "6150": { number: "61120", name: "Advertising", note: "expenses" },
  "6200": { number: "51999", name: "Other COGS", note: "cost of goods sold; goods from the manufacturer" },
  "6300": { number: "63610", name: "Business Travel", note: "expenses; travel on task cards" },
  "6350": { number: "51200", name: "Third-Party Services & Licenses", note: "cost of goods sold; the stock data licence" },
  "6800": { number: "63700", name: "Bank Charges & Fees", note: "expenses" },
  "6900": { number: "63000", name: "General & Administrative Expenses", note: "expenses; other supplier invoices (our call)" },
};
