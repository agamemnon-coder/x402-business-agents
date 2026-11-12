// The bank details an invoice gives, as the payout routes read them (src/payouts/routes.ts), and the suppliers on file
// as the payables fraud check compares an account with them.

import type { DB } from "../db/open.js";
import type { Beneficiary } from "../policy/fraudCore.js";
import type { BankDetails } from "../payouts/routes.js";
import type { ApReading } from "./reading.js";

/** The invoice's account: its IBAN, or account number and routing code; the bank's country; the invoice's currency. */
export function bankFromReading(r: ApReading): BankDetails {
  const routing = r.routing_type === "aba" || r.routing_type === "sort_code" || r.routing_type === "cnaps" ? r.routing_type : "";
  return {
    country: r.bank_country || (r.iban ? r.iban.slice(0, 2) : r.bic.length >= 6 ? r.bic.slice(4, 6) : ""),
    currency: r.currency, accountName: r.vendor, iban: r.iban, accountNumber: r.account_number,
    routingType: routing, routingValue: r.routing_value, swiftCode: r.bic,
  };
}

/**
 * The suppliers on file as the payables fraud check compares an account with them: by name and by account identity
 * (the IBAN's hash, or country, routing code and number), not by BIC: an IBAN names its account on its own, and where
 * there is no IBAN the BIC is part of the identity (src/payouts/routes.ts accountKey).
 */
export function suppliersOnFile(db: DB): Beneficiary[] {
  return (db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic FROM beneficiaries WHERE status = 'ACTIVE'").all() as Beneficiary[]).map((b) => ({ ...b, bic: "" }));
}
