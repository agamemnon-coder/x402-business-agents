// The CFO policy: limits in code inside the on-chain mandates, changed only by an approved policy_change proposal.
import { describe, expect, it } from "vitest";
import { checkInvoice, ibanSha } from "../src/agents/invoice.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { routeRefundBatch } from "../src/policy/refunds.js";
import { capRefusal, counterpartyAllowed, currentPolicy, refundThresholds, validateChange } from "../src/policy/rules.js";
import { setSetting } from "../src/world/settings.js";

const t0 = new Date("2026-10-30T14:00:00Z");
const LIZ = "Lizenzhaus Beispiel GmbH";

function ledger(): DB {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('b-1', ?, '3000', 'h', 'COBADEFFXXX', 'EUR', 'SWIFT')").run(LIZ);
  return db;
}

function approveAndRun(db: DB, id: string, now = t0) {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
  executePolicyChange(db, id, now);
}

describe("policy rules", () => {
  it("starts with no extra agent limits, today's refund thresholds and every payee allowed", () => {
    const p = Object.fromEntries(currentPolicy(ledger()).map((e) => [e.key, e.value]));
    expect(p).toMatchObject({
      "cap.sourcing": "", "cap.support": "", "cap.treasury": "", "approval.refund_each": "0.10", "approval.refund_per_dispute": "0.20",
      [`counterparty:${LIZ}`]: "allowed",
    });
    expect(currentPolicy(ledger()).find((e) => e.key === "cap.sourcing")).toMatchObject({ label: "Sourcing agent: most per payment", display: "no extra limit (the mandate's cap applies)" });
  });

  it("validates a change: known key, the value it replaces, format and bounds", () => {
    const db = ledger();
    expect(validateChange(db, { key: "cap.sourcing", from: "", to: "0.03" })).toBeNull();
    expect(validateChange(db, { key: "cap.sourcing", from: "", to: "" })).toMatch(/no change/);
    expect(validateChange(db, { key: "cap.nobody", from: "", to: "0.03" })).toMatch(/unknown/);
    expect(validateChange(db, { key: "cap.sourcing", from: "0.05", to: "0.03" })).toMatch(/is now/);
    expect(validateChange(db, { key: "cap.sourcing", from: "", to: "0.030" })).toMatch(/format/);
    expect(validateChange(db, { key: "cap.sourcing", from: "", to: "0.00" })).toMatch(/at least 0.01/);
    expect(validateChange(db, { key: "cap.treasury", from: "", to: "20.01" })).toMatch(/at most 20.00/);
    expect(validateChange(db, { key: "approval.refund_each", from: "0.10", to: "0.00" })).toBeNull();
    expect(validateChange(db, { key: `counterparty:${LIZ}`, from: "allowed", to: "maybe" })).toMatch(/allowed or blocked/);
    expect(validateChange(db, { key: "counterparty:Nobody GmbH", from: "allowed", to: "blocked" })).toMatch(/unknown/);
  });

  it("applies an approved change at once, audits it, and refuses an agent payment over the new limit", () => {
    const db = ledger();
    const p = proposePolicyChange(db, { changes: [{ key: "cap.sourcing", to: "0.03" }], reason: "supplier prices are rising" }, "human", t0);
    expect(JSON.parse(p.terms_json)).toMatchObject({ kind: "policy_change", changes: [{ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" }], reason: "supplier prices are rising" });
    expect(capRefusal(db, "sourcing", 4)).toBeNull();
    approveAndRun(db, p.proposal_id);
    expect(capRefusal(db, "sourcing", 3)).toBeNull();
    expect(capRefusal(db, "sourcing", 4)).toBe("policy_cap_exceeded: 0.04 is over the sourcing limit of 0.03");
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'policy.changed'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toEqual({ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03", proposal_id: p.proposal_id });
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("refuses to run a change whose starting value moved after it was proposed", () => {
    const db = ledger();
    const p = proposePolicyChange(db, { changes: [{ key: "approval.refund_each", to: "0.05" }], reason: "tighter" }, "human", t0);
    setSetting(db, "human", "approval.refund_each", "0.07", t0);
    expect(() => approveAndRun(db, p.proposal_id)).toThrow(/is now 0.07/);
    expect(db.prepare("SELECT status FROM proposals").get()).toEqual({ status: "APPROVED" });
    expect(refundThresholds(db)).toEqual({ eachCents: 7, perDisputeCents: 20 });
  });

  it("routes refunds by the policy's thresholds", () => {
    const db = ledger();
    expect(routeRefundBatch([5, 5, 5], refundThresholds(db))).toEqual({ route: "auto" });
    approveAndRun(db, proposePolicyChange(db, { changes: [{ key: "approval.refund_each", to: "0.00" }], reason: "every refund to a person" }, "human", t0).proposal_id);
    expect(routeRefundBatch([5], refundThresholds(db))).toMatchObject({ route: "approval" });
  });

  it("blocks an invoice to a payee the policy blocked", () => {
    const db = ledger();
    approveAndRun(db, proposePolicyChange(db, { changes: [{ key: `counterparty:${LIZ}`, to: "blocked" }], reason: "contract ended" }, "human", t0).proposal_id);
    expect(counterpartyAllowed(db, LIZ)).toBe(false);
    const inv = { invoice_no: "X-1", vendor: LIZ, amount: "10.00", currency: "EUR", due_date: "2026-11-30", iban: "DE89370400440532013000", bic: "COBADEFFXXX", reference: "X-1" };
    db.prepare("UPDATE beneficiaries SET iban_sha256 = ?").run(ibanSha(inv.iban));
    expect(checkInvoice(db, inv)).toEqual({ ok: false, reason: `${LIZ} is blocked by the CFO policy` });
  });

  it("refuses a proposal that changes nothing or the same key twice", () => {
    const db = ledger();
    expect(() => proposePolicyChange(db, { changes: [], reason: "x" }, "human", t0)).toThrow(/no change/);
    expect(() => proposePolicyChange(db, { changes: [{ key: "cap.support", to: "0.05" }, { key: "cap.support", to: "0.06" }], reason: "x" }, "human", t0)).toThrow(/twice/);
  });
});
