// The limit to pay alone, read from the ledger (src/policy/aloneLimit.ts aloneLimitRecord), stands only on an executed
// policy change whose terms set exactly that value and that the CFO approved with the passkey: terms that cannot be
// read, that set another value, or an approval by typed prefix put no limit in force. The worst case's policy read from
// a run record (src/policy/exposureSources.ts) needs every agent with a mandate and the task card rule. No network.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { sha256Hex } from "../src/lib/terms.js";
import { ALONE_KEY, aloneLimitRecord } from "../src/policy/aloneLimit.js";
import { exposurePolicyFromRecord, type RecordForExposure } from "../src/policy/exposureSources.js";

const now = new Date("2026-11-20T10:00:00Z");

describe("the limit to pay alone from the ledger", () => {
  function changed(db: DB, terms: string, method: string) {
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0001', 'policy_change', ?, ?, 'human', 'EXECUTED', '2026-11-21', ?)").run(terms, sha256Hex(terms), now.toISOString());
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-0001', 'APPROVED', ?, 'max', ?, '', ?)").run(sha256Hex(terms), method, now.toISOString());
    audit(db, "system", "policy.changed", ALONE_KEY, { proposal_id: "P-0001", key: ALONE_KEY, from: "", to: "500.00" }, now);
  }
  const terms = (to: string) => JSON.stringify({ kind: "policy_change", changes: [{ key: ALONE_KEY, from: "", to }] });

  it("stands on the passkey-approved change that set exactly that value", () => {
    const db = openDb(":memory:");
    changed(db, terms("500.00"), "passkey");
    expect(aloneLimitRecord(db)).toMatchObject({ currency: "EUR", amount: "500.00", source: { kind: "signed", proposal_id: "P-0001" } });
  });

  it("terms that cannot be read, set another value, or an approval by typed prefix: no limit", () => {
    for (const [t, m] of [["{not json", "passkey"], [terms("400.00"), "passkey"], [terms("500.00"), "cli"]] as const) {
      const db = openDb(":memory:");
      changed(db, t, m);
      expect(aloneLimitRecord(db), `${t} ${m}`).toBeNull();
    }
  });
});

describe("the worst case's policy from a run record", () => {
  const agent = (id: string, o: Record<string, unknown> = {}) => ({ id, card: { monthly: "100.00" }, mandate: { budget: "4.00" }, ...o });
  const record = (agents: unknown[]): RecordForExposure => ({ snapshot: { agents }, ledger: { proposals: [] } } as unknown as RecordForExposure);

  it("needs every agent with a mandate, and the task card rule", () => {
    const task = { settings: [{ key: "approval.task_card_eur", value: "25.00" }] };
    expect(() => exposurePolicyFromRecord(record([agent("sourcing", { mandate: null }), agent("support"), agent("treasury", task)]))).toThrow("the record has no sourcing agent with a mandate");
    expect(() => exposurePolicyFromRecord(record([agent("sourcing"), agent("support"), agent("treasury")]))).toThrow("the record has no approval.task_card_eur");
    const p = exposurePolicyFromRecord(record([agent("sourcing"), agent("support"), agent("treasury", { settings: [{ key: "approval.task_card_eur", value: "25.00" }] })]));
    expect(p).toMatchObject({ taskCardEurCents: 2500, cardMonthlyCents: { sourcing: 10000 }, mandateBudgetCents: { treasury: 400 } });
  });
});
