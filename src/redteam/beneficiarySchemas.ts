// What Airwallex's beneficiary schema (POST /beneficiaries/schema) answered in the sandbox, as far as it was seen, so the
// stand-in refuses a body the sandbox would refuse. Only fields observed as required are listed; the sandbox may need
// more. Seen: DE, EUR, SWIFT on 29 October (Kit 11's payees); NL, EUR, LOCAL on 10 November (the platform
// end-to-end's live run, refused before the create: docs/runs/2026-11-10-platform-e2e.md).
import type { BeneficiarySchema } from "../airwallex/adapter.js";

const req = (...paths: string[]): BeneficiarySchema =>
  Object.fromEntries(paths.map((p) => [`create_beneficiary_request.${p}`, { required: true, relevant: true, type: p.endsWith("methods") ? "array" : "string" }]));

/** By `${country} ${currency} ${method}`. */
export const RECORDED_BENEFICIARY_SCHEMAS: Record<string, BeneficiarySchema> = {
  "DE EUR SWIFT": req("beneficiary.bank_details.bank_name", "payment_methods"),
  "NL EUR LOCAL": req("beneficiary.bank_details.bank_name", "payment_methods"),
};
