// The stored ledger's chart and what kind of account each is, for the reports (bookkeeping core, decision 4). The
// ledger accepts the cash journal's CHART, the payables accounts (AP_CHART) and its own (LEDGER_CHART); the last two
// stay out of CHART because the T:0 sink mirrors CHART account for account.

import { AP_CHART, CHART, LEDGER_CHART } from "../config/gl.js";

export const LEDGER_ACCOUNTS: Readonly<Record<string, string>> = { ...CHART, ...AP_CHART, ...LEDGER_CHART };

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

/** By the first digit: 1 assets, 2 liabilities, 3 equity, 4 revenue, 5 to 8 expenses. */
export function accountType(account: string): AccountType {
  switch (account[0]) {
    case "1": return "asset";
    case "2": return "liability";
    case "3": return "equity";
    case "4": return "revenue";
    default: return "expense";
  }
}

export const isProfitAndLoss = (account: string) => ["revenue", "expense"].includes(accountType(account));

/** The bank and money accounts (12xx), where cash per currency is read. */
export const isBank = (account: string) => account.startsWith("12");

export const RECEIVABLES = "1300";
export const INPUT_VAT = "1510";
export const STOCK = "1700";
export const PAYABLES = "2100";
export const VAT_PAYABLE = "2200";
export const OUTPUT_VAT = "2210";
export const RETAINED_EARNINGS = "3100";
export const COST_OF_GOODS_SOLD = "8000";
export const MONEY_IN_TRANSIT = "1590";
/** The financier of an invoice token: simulated on testnet, and every report says so. */
export const FINANCIER = "2150";
export const FINANCE_COST = "7100";
export const FX_DIFFERENCES = "7900";
