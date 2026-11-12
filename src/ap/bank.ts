// The bank details an invoice gives, as the payout routes read them (src/payouts/routes.ts), and the suppliers on file
// as the payables fraud check compares an account with them.

import type { DB } from "../db/open.js";
import type { Beneficiary } from "../policy/fraudCore.js";

/** The invoice's account as the payout routes read it: pure, so it lives with the checks' core (src/ap/checkerCore.ts). */
export { bankFromReading } from "./checkerCore.js";

/**
 * The suppliers on file as the payables fraud check compares an account with them: by name and by account identity
 * (the IBAN's hash, or country, routing code and number), not by BIC: an IBAN names its account on its own, and where
 * there is no IBAN the BIC is part of the identity (src/payouts/routes.ts accountKey).
 */
export function suppliersOnFile(db: DB): Beneficiary[] {
  return (db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic FROM beneficiaries WHERE status = 'ACTIVE'").all() as Beneficiary[]).map((b) => ({ ...b, bic: "" }));
}
