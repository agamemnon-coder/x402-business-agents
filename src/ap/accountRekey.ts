// A ledger's stored account identities, brought up to src/payouts/routes.ts accountKey when it is opened. Until 19
// November an account with an ABA routing number was keyed by its country and number alone (US:50001121), so the same
// number at another bank was the same "account" and an invoice asking to be paid there raised no bank_details_changed
// (held-out adversarial eval v3, v3-bec-pinecrest-new-routing). It now carries its routing number
// (US:021000021:50001121). The ledger keeps only the hash of a supplier's key, in beneficiaries.iban_sha256 and in the
// payment ledger's invoices.iban_sha256; the clear details are in the payee_adds request that added the supplier. So
// each supplier added that way is rekeyed from its own request: its hash under the old key becomes its hash under the
// new one, and the payments filed under it follow. Suppliers keyed by IBAN or sort code are unchanged. Idempotent: once
// rekeyed, no row carries an old hash, and opening again changes nothing.
//
// Not rekeyed: the bank's payee-name checks (payee_name_checks), keyed by name and account. They are a cache, fresh for
// a day (src/airwallex/payeeName.ts freshCheck): a request whose check was filed under the old key asks the bank again.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { accountKey, numberKey, type BankDetails } from "../payouts/routes.js";

/** The hash the ledger keeps of an account key (the form of src/agents/invoice.ts ibanSha, without its imports). */
const keySha = (key: string) => sha256Hex(key.replace(/\s+/g, "").toUpperCase());

/** Rekeys the ABA suppliers a ledger stored under their country and number alone; returns how many it rekeyed. */
export function rekeyAbaAccounts(db: DB, now = new Date()): number {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  if (!["payee_adds", "beneficiaries", "invoices"].every((t) => tables.has(t))) return 0;
  const adds = (db.prepare("SELECT add_id, vendor, details_json FROM payee_adds WHERE status = 'APPLIED' AND details_json IS NOT NULL").all() as { add_id: string; vendor: string; details_json: string }[])
    .map((a) => ({ ...a, bank: JSON.parse(a.details_json) as BankDetails }))
    .filter((a) => !a.bank.iban && a.bank.routingType === "aba" && !!a.bank.routingValue)
    .map((a) => ({ ...a, before: keySha(numberKey(a.bank)), after: keySha(accountKey(a.bank)) }));
  const stale = db.prepare("SELECT beneficiary_id FROM beneficiaries WHERE name = ? AND iban_sha256 = ?");
  // Nothing to rekey (every ledger once done): no write transaction is opened.
  if (!adds.some((a) => stale.get(a.vendor, a.before))) return 0;
  let n = 0;
  db.transaction(() => {
    for (const { add_id, vendor, before, after } of adds) {
      const a = { add_id, vendor };
      // Read again inside the lock: another opener may have rekeyed it meanwhile.
      const bens = stale.all(vendor, before) as { beneficiary_id: string }[];
      for (const b of bens) {
        db.prepare("UPDATE beneficiaries SET iban_sha256 = ?, details_json = CASE WHEN details_json IS NULL THEN NULL ELSE json_set(details_json, '$.account_key_sha256', ?) END WHERE beneficiary_id = ?")
          .run(after, after, b.beneficiary_id);
        const payments = db.prepare("UPDATE invoices SET iban_sha256 = ? WHERE beneficiary_id = ? AND iban_sha256 = ?").run(after, b.beneficiary_id, before).changes;
        audit(db, "system", "payee.rekeyed", a.add_id, { vendor: a.vendor, beneficiary_id: b.beneficiary_id, why: "an ABA account's identity now carries its routing number", payments }, now);
        n++;
      }
    }
  }).immediate();
  return n;
}
