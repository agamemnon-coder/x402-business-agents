// The payees code allowlists, as data only (no import of the engine): src/agents/euroBill.ts uses and re-exports them,
// and the try sample's clean invoice (src/config/trySample.ts) is drawn from them. Test data: published test IBANs.

import { LICENSOR_NAME } from "./policy.js";

export const MANUFACTURER = {
  name: "Bergtex Textil GmbH",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  currency: "EUR" as const,
  countryCode: "DE" as const,
  bankName: "Commerzbank",
  address: { street: "Textilweg 4", city: "Reutlingen", postcode: "72760", countryCode: "DE" as const },
};

/** Kit 11's licensor: Stockline's monthly data licence, invoiced in euros (LICENCE_FEE_EUR_CENTS in code). */
export const LICENSOR = {
  name: LICENSOR_NAME,
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  currency: "EUR" as const,
  countryCode: "DE" as const,
  bankName: "Deutsche Kreditbank",
  address: { street: "Datenallee 12", city: "Berlin", postcode: "10115", countryCode: "DE" as const },
};

/**
 * The payees code allowlists, and the only ones: seedTreasury creates each once at Airwallex and records it in the
 * ledger's beneficiaries. Neither an agent nor an invoice adds to it; a supplier's new account replaces its entry only
 * through a person's verified payee change (src/policy/payeeChange.ts).
 */
export const ALLOWLISTED_PAYEES = [MANUFACTURER, LICENSOR] as const;
