// Why a payment needs a second key (src/policy/secondKey.ts secondKeyReasons), for the shapes the first tests did not
// cover: a supplier payment whose account or clearing changed since its last payment, a payee whose country the payment does
// not name, a batch with any high-risk line (each reason once), and kinds that are
// never high-risk. With every trigger off, nothing is high-risk.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { secondKeyMessage, secondKeyReasons } from "../src/policy/secondKey.js";

const now = new Date("2026-11-19T10:00:00Z");
let db: DB;
const set = (key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
let n = 0;
const paid = (terms: Record<string, unknown>, approvedAt: string) => {
  const id = `P-${String(++n).padStart(4, "0")}`;
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'treasury', 'EXECUTED', 'x', ?)").run(id, terms.kind, JSON.stringify(terms), id.padEnd(64, "0"), approvedAt);
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'cfo', 'passkey', '', ?)").run(id, id.padEnd(64, "0"), approvedAt);
};
const reasons = (kind: string, terms: Record<string, unknown>) => secondKeyReasons(db, { kind, terms_json: JSON.stringify({ kind, ...terms }) }, now);

beforeEach(() => {
  db = openDb(":memory:");
  n = 0;
});

describe("the second key's reasons", () => {
  it("none while every trigger is off", () => {
    expect(reasons("supplier_payment", { vendor: "Acme", amount: "99999.00", currency: "EUR" })).toEqual([]);
  });

  it("a supplier payment: the account or clearing changed since the payee's last payment", () => {
    set("approval.second_key_bank_changed", "on");
    paid({ kind: "supplier_payment", vendor: "Acme", beneficiary_id: "ben_1", account: "acct …1121", clearing: "ACH", amount: "10.00", currency: "USD" }, "2026-10-01T10:00:00Z");
    expect(reasons("supplier_payment", { vendor: "Acme", beneficiary_id: "ben_1", account: "acct …1121", clearing: "ACH" })).toEqual([]);
    expect(reasons("supplier_payment", { vendor: "Acme", beneficiary_id: "ben_1", account: "acct …9999", clearing: "ACH" })).toEqual(["bank details changed"]);
    expect(reasons("supplier_payment", { vendor: "Acme", beneficiary_id: "ben_1", account: "acct …1121", clearing: "FEDWIRE" })).toEqual(["bank details changed"]);
    // Another beneficiary of the same name is another payee: nothing to compare with, so nothing changed.
    expect(reasons("supplier_payment", { vendor: "Acme", beneficiary_id: "ben_2", account: "x" })).toEqual([]);
  });

  it("a new country, from the BIC; a country the payment does not name counts as new", () => {
    set("approval.second_key_new_country", "on");
    // The runner's beneficiaries keep no country of their own: without a BIC the country is unknown, so new.
    expect(reasons("invoice_payment", { vendor: "Bergtex", bic: "COBADEFFXXX", iban_last4: "3000" })).toEqual(["new country (DE)"]);
    expect(reasons("supplier_payment", { vendor: "Nobody", beneficiary_id: "ben_missing" })).toEqual(["new country (unknown)"]);
    expect(reasons("supplier_payment", { vendor: "Nobody" })).toEqual(["new country (unknown)"]);
  });

  it("a batch is high-risk when any line is, each reason once; other lines and other kinds are not", () => {
    set("approval.second_key_new_payee", "on");
    paid({ kind: "invoice_payment", vendor: "Old Supplier", iban_last4: "1", bic: "COBADEFFXXX", amount: "1.00", currency: "EUR" }, "2026-01-01T10:00:00Z");
    const lines = [
      { kind: "supplier_payment", terms: { vendor: "New A", account: "a" } },
      { kind: "supplier_payment", terms: { vendor: "New B", account: "b" } },
      { kind: "invoice_payment", terms: { vendor: "Old Supplier", iban_last4: "1", bic: "COBADEFFXXX" } },
      { kind: "refund_batch", terms: {} },
    ];
    expect(reasons("payment_batch", { lines })).toEqual(["new payee (never paid before)"]);
    expect(reasons("payment_batch", {})).toEqual([]);
    expect(reasons("policy_change", { changes: [] })).toEqual([]);
  });

  it("the approval page says what to touch next", () => {
    expect(secondKeyMessage(["new payee (never paid before)"], { passkey: true, securityKey: false })).toBe("High-risk: new payee (never paid before). Touch your security key.");
    expect(secondKeyMessage(["a", "b"], { passkey: false, securityKey: true })).toBe("High-risk: a; b. Approve with Face ID too.");
    expect(secondKeyMessage(["a"], { passkey: false, securityKey: false })).toBe("High-risk: a. It needs your Face ID and your security key.");
  });
});
