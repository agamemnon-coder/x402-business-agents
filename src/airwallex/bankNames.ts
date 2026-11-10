// A bank's registered name from its BIC's bank code (the first four letters), for the banks Purser's suppliers are
// most likely to use. Airwallex's beneficiary schema asks for bank_details.bank_name on the routes seen so far (DE EUR
// SWIFT, NL EUR LOCAL); an invoice names the BIC, not the bank. A BIC not listed here gives no name, and the schema
// check then says the name is missing instead of anything being guessed. Names as the banks register them (SWIFT's
// BIC directory and the banks' own sites).
const BY_BANK_CODE: Record<string, Record<string, string>> = {
  NL: {
    ABNA: "ABN AMRO Bank N.V.",
    INGB: "ING Bank N.V.",
    RABO: "Coöperatieve Rabobank U.A.",
    TRIO: "Triodos Bank N.V.",
    BUNQ: "bunq B.V.",
    SNSB: "de Volksbank N.V.",
    ASNB: "de Volksbank N.V.",
    RBRB: "de Volksbank N.V.",
    KNAB: "Knab N.V.",
  },
};

/** The bank's name for a BIC (8 or 11 characters), or undefined when the bank is not listed. */
export function bankNameFromBic(bic: string | undefined): string | undefined {
  const m = /^([A-Z]{4})([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.exec((bic ?? "").replace(/\s+/g, "").toUpperCase());
  return m ? BY_BANK_CODE[m[2]!]?.[m[1]!] : undefined;
}
