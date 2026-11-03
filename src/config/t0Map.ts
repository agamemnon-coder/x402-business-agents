// Version 1 of the mapping from Purser's chart (src/config/gl.ts) to accounts that already exist in a shared T:0 demo
// entity ("T:0 Sandbox", a Mercury/Ramp startup chart). The API cannot create accounts, so with `--map sandbox` any of
// our codes that T:0 does not have under its own number goes to the account below. Used only when our code is missing.
// Several of our accounts share one T:0 account; each line's memo then names our account ("Purser 1200 Airwallex EUR").

export const T0_MAP_VERSION = 1;

export interface T0MapTarget { number: string; name: string; note: string }

export const T0_SANDBOX_MAP: Record<string, T0MapTarget> = {
  "1200": { number: "11110", name: "Mercury Checking", note: "bank; the money is in Airwallex EUR, not Mercury" },
  "1201": { number: "11120", name: "Mercury Savings", note: "bank; the money is in Airwallex USD, not Mercury" },
  "1202": { number: "11130", name: "Mercury Treasury", note: "bank; the money is in Airwallex GBP, not Mercury" },
  "1210": { number: "11900", name: "Transfer Clearing", note: "bank-type; Metal testnet money (*USDZ) kept off the real-looking accounts" },
  "1220": { number: "11900", name: "Transfer Clearing", note: "bank-type; Metal clearing, testnet money" },
  "1590": { number: "15100", name: "Other Current Assets", note: "money in transit between own accounts" },
  "2900": { number: "90000", name: "Uncategorized", note: "suspense; the sandbox has no suitable liability, so this is an asset-type account with a credit balance" },
  "3000": { number: "31000", name: "Common Stock", note: "owner's equity" },
  "4000": { number: "41010", name: "Subscription Revenue", note: "income" },
  "4100": { number: "41010", name: "Subscription Revenue", note: "income; refunds are debits, so they reduce it" },
  "4200": { number: "41010", name: "Subscription Revenue", note: "income" },
  "5000": { number: "51020", name: "Third-Party APIs & Services", note: "cost of goods sold; purchased stock data" },
  "6100": { number: "64300", name: "Software & Web Services", note: "expenses" },
  "6150": { number: "62100", name: "Advertising", note: "expenses" },
  "6200": { number: "51020", name: "Third-Party APIs & Services", note: "cost of goods sold; goods from a supplier, the nearest COGS account (our call)" },
  "6300": { number: "66100", name: "Air Travel", note: "expenses; travel on task cards, the sandbox's postable travel accounts are air, ground, lodging" },
  "6350": { number: "51020", name: "Third-Party APIs & Services", note: "cost of goods sold; the stock data licence" },
  "6800": { number: "68100", name: "Bank Charges & Fees", note: "expenses" },
  "6900": { number: "68400", name: "Dues & Subscriptions", note: "expenses; other supplier invoices (our call)" },
};
