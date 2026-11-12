// The hands-on demo's clean sample invoice and the suppliers on file, as data only (no import of the engine), so the
// cloud Worker's illustration (cloud/src/scene.ts) shows this invoice without loading the engine. src/engine/tryWorld.ts
// uses and re-exports them. Test data only: the payees' IBANs are published test IBANs.

import { ALLOWLISTED_PAYEES } from "./payees.js";

/** The key a supplier on file is offered under: the first word of its name. */
export const supplierKey = (name: string): string => name.split(/\s+/)[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The seeded payees, with the street and city the composed invoice's letterhead shows. */
export const SEEDED_SUPPLIERS = ALLOWLISTED_PAYEES.map((p) => ({ key: supplierKey(p.name), name: p.name, iban: p.iban, bic: p.bic, street: p.address.street, city: `${p.address.postcode} ${p.address.city}` }));

export interface InvoiceFields { supplier: { name: string; street: string; city: string; bic: string }; invoiceNo: string; amountCents: number; issueDate: string; dueDate: string; iban: string }

const BERGTEX = SEEDED_SUPPLIERS.find((s) => s.key === "bergtex")!;
/** The clean sample, on file and payable; the others are variations of it, so each tells one thing. The pages'
 * illustration shows this invoice (cloud/src/scene.ts). */
export const CLEAN: InvoiceFields = { supplier: BERGTEX, invoiceNo: "BTX-2026-21", amountCents: 185_000, issueDate: "2026-11-09", dueDate: "2026-11-30", iban: BERGTEX.iban };
