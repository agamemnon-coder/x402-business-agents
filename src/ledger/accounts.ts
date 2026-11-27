// The stored ledger's chart and what kind of account each is, for the reports (bookkeeping core, decision 4). The
// ledger accepts the cash journal's CHART, the payables accounts (AP_CHART) and its own (LEDGER_CHART); the last two
// stay out of CHART because the T:0 sink mirrors CHART account for account.

import { AP_CHART, CHART, LEDGER_CHART } from "../config/gl.js";

export const LEDGER_ACCOUNTS: Readonly<Record<string, string>> = { ...CHART, ...AP_CHART, ...LEDGER_CHART };

/**
 * The chart's account names in Dutch, for the Dutch PDFs (screenshot pass S7) and the Dutch console; English stays as the chart has it. An
 * account without a Dutch name keeps its own.
 */
export const ACCOUNT_NAMES_NL: Readonly<Record<string, string>> = {
  "1200": "Bank: Airwallex EUR (incl. bedrijfskaarten)", "1201": "Bank: Airwallex USD", "1202": "Bank: Airwallex GBP",
  "1203": "Bank: Airwallex, overige valuta", "1210": "Bank: Metal-rekening (*USDZ, testnet)", "1220": "Bank: Metal clearing (*USDZ, testnet)",
  "1300": "Debiteuren", "1510": "Te vorderen btw (inkoopfacturen)", "1515": "Terug te vragen buitenlandse btw (EU-teruggaaf)", "1590": "Kruisposten (tussen eigen rekeningen)", "1700": "Voorraad",
  "2100": "Crediteuren (inkoopfacturen)", "2200": "Te betalen btw", "2210": "Af te dragen btw (aan klanten berekend)", "2900": "Nog niet geïdentificeerde ontvangsten",
  "3000": "Eigen vermogen: beginsaldi en inbreng eigenaar", "3100": "Ingehouden winst",
  "4000": "Omzet: voorraaddata aan winkeliers", "4100": "Terugbetalingen aan klanten", "4200": "Omzet: groothandel aan winkeliers",
  "5000": "Ingekochte voorraaddata (warehouse-API)", "6100": "Softwareabonnementen (bedrijfskaarten)", "6150": "Advertenties (bedrijfskaarten)",
  "6200": "Goederen van de fabrikant", "6300": "Reiskosten (taakkaarten)", "6350": "Datalicentie (Stockline, maandelijks)",
  "6800": "Bank- en overboekingskosten", "6900": "Overige inkoopfacturen", "8000": "Kostprijs van de omzet", "2150": "Gesimuleerde financier (testnet): financiering van factuurtokens",
  "7100": "Financieringskosten: korting op gefinancierde facturen", "7900": "Koersverschillen, gerealiseerd (winst of verlies)",
};

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
/** VAT a supplier abroad charged (a code with `foreign`, PF_DE19): reclaimed through the EU refund, never in box 5b. */
export const FOREIGN_VAT = "1515";
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
