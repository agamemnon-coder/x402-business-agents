// The anomaly hold (governance, 26 Nov: "people approve what is sensitive"). A supplier payment far outside what its payee
// normally receives (more than the CFO's multiple of the median of its last paid invoices), or a first payment to a payee
// above the CFO's amount, goes to the CFO even within the limit the agent may pay alone. Thresholds are CFO policy.
// Breaks if an unusual payment is approved alone, if a usual one is held, if the thresholds stop following the policy,
// or if switching the hold off stops counting as a loosening (Face ID).
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { approveWithinLimit, createProposal, nextProposalId } from "../src/policy/approvals.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { anomalyReasons, anomalyThresholds } from "../src/policy/anomaly.js";
import { currentPolicy, loosens, validateChange } from "../src/policy/rules.js";

const NOW = new Date("2026-11-20T10:00:00Z");
const LIMIT = { currency: "EUR", amount: "5000.00" };

function db0(): DB {
  const db = openDb(":memory:");
  setSystemDefaultAloneLimit(db, LIMIT.amount, NOW);
  return db;
}
const set = (db: DB, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, NOW.toISOString());

function proposal(db: DB, amount: string, payee = "Bergtex Textil GmbH", currency = "EUR"): string {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind: "supplier_payment", proposal_id: id, expires_at: "2026-12-20T11:00:00Z", amount, currency, vendor: payee, beneficiary_name: payee, beneficiary_id: `ben_${payee.replace(/\W/g, "")}` } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return id;
}
/** A payment already paid to the payee: its history. */
function paid(db: DB, amount: string, payee = "Bergtex Textil GmbH"): void {
  db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = ?").run(proposal(db, amount, payee));
}
const alone = (db: DB, id: string) => approveWithinLimit(db, { proposalId: id, limit: LIMIT, rule: "within the limit", agent: "payer" }, NOW);
const termsOf = (db: DB, id: string) => db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; terms_json: string };

describe("the anomaly hold", () => {
  it("is CFO policy: on by default at 3 times the median of the last 5 paid invoices; first payments off", () => {
    const db = db0();
    expect(anomalyThresholds(db)).toEqual({ multiple: 3, history: 5, firstEurCents: null });
    const keys = currentPolicy(db).filter((e) => e.key.startsWith("approval.anomaly_"));
    expect(keys.map((e) => [e.key, e.value, e.agent])).toEqual([["approval.anomaly_multiple", "3", "treasury"], ["approval.anomaly_history", "5", "treasury"], ["approval.anomaly_first_eur", "", "treasury"]]);
    expect(validateChange(db, { key: "approval.anomaly_multiple", from: "3", to: "7" })).toMatch(/must be one of off, 2, 3, 4, 5, 10/);
    expect(validateChange(db, { key: "approval.anomaly_first_eur", from: "", to: "250.00" })).toBeNull();
  });

  it("switching it off or raising a threshold loosens (Face ID); switching on or lowering tightens", () => {
    expect(loosens({ key: "approval.anomaly_multiple", from: "3", to: "off" })).toBe(true);
    expect(loosens({ key: "approval.anomaly_multiple", from: "3", to: "5" })).toBe(true);
    expect(loosens({ key: "approval.anomaly_multiple", from: "3", to: "2" })).toBe(false);
    expect(loosens({ key: "approval.anomaly_multiple", from: "off", to: "3" })).toBe(false);
    expect(loosens({ key: "approval.anomaly_first_eur", from: "", to: "250.00" })).toBe(false);
    expect(loosens({ key: "approval.anomaly_first_eur", from: "250.00", to: "100.00" })).toBe(false);
    expect(loosens({ key: "approval.anomaly_first_eur", from: "250.00", to: "" })).toBe(true);
    expect(loosens({ key: "approval.anomaly_first_eur", from: "250.00", to: "900.00" })).toBe(true);
    expect(loosens({ key: "approval.anomaly_history", from: "5", to: "10" })).toBe(true);
  });

  it("more than 3 times the payee's median paid invoice goes to the CFO, within the limit; up to 3 times is paid alone", () => {
    const db = db0();
    for (const a of ["100.00", "120.00", "140.00"]) paid(db, a); // median 120.00
    expect(alone(db, proposal(db, "360.00"))).toEqual({ ok: true });
    const odd = proposal(db, "360.01");
    expect(alone(db, odd)).toMatchObject({ ok: false, code: "anomaly", reason: expect.stringMatching(/unusual amount: over 3x Bergtex Textil GmbH's median of EUR 120\.00 \(last 3 paid\)/) });
    const rec = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'payment.anomaly_held' AND subject = ?").get(odd) as { payload_json: string }).payload_json) as { reasons: string[] };
    expect(rec.reasons).toHaveLength(1);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(odd) as { status: string }).status).toBe("PENDING_APPROVAL");
    // Another payee's history is not this one's; another currency's neither.
    expect(alone(db, proposal(db, "4000.00", "Alpenwolle AG"))).toEqual({ ok: true });
    expect(anomalyReasons(db, termsOf(db, proposal(db, "4000.00", "Bergtex Textil GmbH", "USD")))).toEqual([]);
  });

  it("an even history takes the middle two; only the last N paid invoices count; the thresholds follow the policy", () => {
    const db = db0();
    for (const a of ["1000.00", "1000.00", "100.00", "100.00", "110.00", "130.00"]) paid(db, a);
    // Last 5: 1000, 100, 100, 110, 130 → median 110.00.
    expect(anomalyReasons(db, termsOf(db, proposal(db, "331.00")))).toEqual([expect.stringContaining("EUR 110.00 (last 5 paid)")]);
    set(db, "approval.anomaly_history", "3"); // 100, 110, 130 → 110.00
    expect(anomalyReasons(db, termsOf(db, proposal(db, "331.00")))).toEqual([expect.stringContaining("EUR 110.00 (last 3 paid)")]);
    set(db, "approval.anomaly_history", "20"); // all six → (100+110... sorted 100,100,110,130,1000,1000) → (110+130)/2 = 120.00
    expect(anomalyReasons(db, termsOf(db, proposal(db, "361.00")))).toEqual([expect.stringContaining("EUR 120.00 (last 6 paid)")]);
    expect(anomalyReasons(db, termsOf(db, proposal(db, "360.00")))).toEqual([]);
    set(db, "approval.anomaly_multiple", "10");
    expect(anomalyReasons(db, termsOf(db, proposal(db, "1200.00")))).toEqual([]);
    set(db, "approval.anomaly_multiple", "off");
    expect(alone(db, proposal(db, "4999.00"))).toEqual({ ok: true });
  });

  it("a first payment to a payee above the CFO's amount goes to the CFO; at or below it, or with history, it does not", () => {
    const db = db0();
    expect(alone(db, proposal(db, "900.00", "New Supplier GmbH"))).toEqual({ ok: true }); // off by default
    set(db, "approval.anomaly_first_eur", "250.00");
    expect(alone(db, proposal(db, "250.00", "Second New GmbH"))).toEqual({ ok: true });
    expect(alone(db, proposal(db, "250.01", "Third New GmbH"))).toMatchObject({ ok: false, code: "anomaly", reason: expect.stringMatching(/first payment to Third New GmbH above EUR 250\.00/) });
    // No euro value in the terms (another currency, no conversion): counts as above.
    expect(anomalyReasons(db, termsOf(db, proposal(db, "10.00", "Fourth New Ltd", "GBP")))).toEqual(["first payment to Fourth New Ltd above EUR 250.00"]);
    paid(db, "200.00", "Known GmbH");
    expect(alone(db, proposal(db, "500.00", "Known GmbH"))).toEqual({ ok: true }); // 2.5 times its one paid invoice
  });
});
