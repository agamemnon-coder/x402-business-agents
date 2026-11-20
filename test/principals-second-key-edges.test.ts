// Two policy rules on the paths the other files leave. An agent's identity (src/policy/principals.ts): a revocation
// says why only when a reason was given; a tool outside its capabilities is denied; no one but a governed agent can be
// revoked, expired or given a key, and a revoked one gets no key; an agent given a key must present it. The second key
// for a high-risk payment (src/policy/secondKey.ts): bank details read for an invoice or a supplier payment with parts
// missing, and a payee's country from the beneficiary's recorded details, where it is there and readable.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { sha256Hex } from "../src/lib/terms.js";
import { authorize, expirePrincipal, keyMatches, principal, revokePrincipal, rotatePrincipalKey } from "../src/policy/principals.js";
import { SECOND_KEY_BANK_CHANGED, SECOND_KEY_NEW_COUNTRY, secondKeyReasons } from "../src/policy/secondKey.js";

const now = new Date("2026-11-20T10:00:00Z");

describe("an agent's identity", () => {
  it("a revocation without a reason says only that; a tool outside its capabilities is denied", () => {
    const db = openDb(":memory:");
    expect(authorize(db, "sourcing", { tool: "sweep" }, now)).toBe("capability_denied: the sourcing agent may not use sweep");
    expect(authorize(db, "sourcing", { tool: "card_purchase" }, now)).toBeNull();
    revokePrincipal(db, "sourcing", "", "cfo", now);
    expect(authorize(db, "sourcing", {}, now)).toBe("principal_revoked: the Sourcing agent's identity was revoked; it can do nothing");
  });

  it("no one but a governed agent can be revoked, expired or given a key; a revoked agent gets no key", () => {
    const db = openDb(":memory:");
    expect(() => revokePrincipal(db, "task:T-1", "x", "cfo", now)).toThrow("task:T-1 is not an agent with an identity");
    expect(() => expirePrincipal(db, "task:T-1", now, "cfo", now)).toThrow("task:T-1 is not an agent with an identity");
    expect(() => rotatePrincipalKey(db, "task:T-1", "cfo", now)).toThrow("task:T-1 is not an agent with an identity");
    revokePrincipal(db, "support", "left the company", "cfo", now);
    expect(() => rotatePrincipalKey(db, "support", "cfo", now)).toThrow("support is revoked; a revoked identity gets no new key");
  });

  it("an agent given a key must present it", () => {
    const db = openDb(":memory:");
    expect(keyMatches(db, "treasury", undefined, now)).toBe(true); // never given one: needs none
    const { key } = rotatePrincipalKey(db, "treasury", "cfo", now);
    expect(keyMatches(db, "treasury", undefined, now)).toBe(false);
    expect(keyMatches(db, "treasury", "pk_wrong", now)).toBe(false);
    expect(keyMatches(db, "treasury", key, now)).toBe(true);
    expect(principal(db, "treasury", now)!.key_version).toBe(1);
  });
});

describe("the second key's reasons", () => {
  const setting = (db: DB, key: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, 'on', ?)").run(key, now.toISOString());
  const executed = (db: DB, id: string, terms: Record<string, unknown>) =>
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'treasury', 'EXECUTED', '2026-11-30', '2026-11-01T00:00:00Z')")
      .run(id, terms.kind, JSON.stringify(terms), sha256Hex(id));
  const reasons = (db: DB, terms: Record<string, unknown>) => secondKeyReasons(db, { kind: String(terms.kind), terms_json: JSON.stringify(terms) }, now);

  it("bank details with parts missing, for an invoice and for a supplier payment, compared as they are", () => {
    const db = openDb(":memory:");
    setting(db, SECOND_KEY_BANK_CHANGED);
    executed(db, "P-0001", { kind: "invoice_payment", vendor: "Bergtex" });
    expect(reasons(db, { kind: "invoice_payment", vendor: "Bergtex" })).toEqual([]);
    expect(reasons(db, { kind: "invoice_payment", vendor: "Bergtex", iban_last4: "3000" })).toEqual(["bank details changed"]);
    executed(db, "P-0002", { kind: "supplier_payment", vendor: "Ridgeline", account: "000123" });
    expect(reasons(db, { kind: "supplier_payment", vendor: "Ridgeline", account: "000123" })).toEqual([]);
    expect(reasons(db, { kind: "supplier_payment", vendor: "Ridgeline", account: "000123", clearing: "ACH" })).toEqual(["bank details changed"]);
  });

  it("a payee's country from its beneficiary's recorded details, when there and readable", () => {
    const db = openDb(":memory:");
    setting(db, SECOND_KEY_NEW_COUNTRY);
    const ben = (id: string, details: string | null) => db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status, details_json) VALUES (?, 'x', '0000', ?, '', 'USD', 'LOCAL', 'ACTIVE', ?)").run(id, "d".repeat(64), details);
    ben("ben_us", JSON.stringify({ country: "US" }));
    ben("ben_none", null);
    ben("ben_bad", "{not json");
    ben("ben_lower", JSON.stringify({ country: "us" }));
    executed(db, "P-0001", { kind: "supplier_payment", vendor: "Ridgeline", beneficiary_id: "ben_us" });
    expect(reasons(db, { kind: "supplier_payment", vendor: "Ridgeline", beneficiary_id: "ben_us" })).toEqual([]);
    for (const id of ["ben_none", "ben_bad", "ben_lower", "ben_missing"]) expect(reasons(db, { kind: "supplier_payment", vendor: "Other", beneficiary_id: id }), id).toEqual(["new country (unknown)"]);
  });
});
