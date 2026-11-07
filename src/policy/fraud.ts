// Invoice fraud (business email compromise), tier 3 item 7. Code decides, from the ledger: an invoice whose bank
// details differ from the allowlisted ones, whose vendor only looks like an allowlisted name, or whose account
// holder is someone else is blocked before Airwallex is called. Opus may explain the finding; it cannot clear it.
// Nothing in the agents can change an allowlisted beneficiary: a person verifies with the supplier, out of band.

import type { DB } from "../db/open.js";
import { ibanSha, type Invoice } from "../agents/invoice.js";

export { assessAgainst, editDistance, skeleton, type Beneficiary, type FraudCode, type FraudFinding, type FraudSignal } from "./fraudCore.js";
import { assessAgainst, type Beneficiary, type FraudFinding } from "./fraudCore.js";

/** Everything the code can tell about an invoice's payee, from the ledger's allowlist and the document itself. */
export function assessInvoice(db: DB, inv: Invoice, text: string): FraudFinding {
  const all = db.prepare("SELECT beneficiary_id, name, iban_last4, iban_sha256, bic FROM beneficiaries WHERE currency = 'EUR' AND status = 'ACTIVE' ORDER BY name").all() as Beneficiary[];
  return assessAgainst(all, inv, text, ibanSha(inv.iban));
}
