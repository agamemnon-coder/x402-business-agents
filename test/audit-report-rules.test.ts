// The audit report's words (src/audit/report.ts): the rule behind every automatic refusal, the rule that sent each
// kind of proposal to a person (the emergency stop and a card limit have their own), the outcome of a proposal in each
// state, and what the report prints for a broken chain, Metal finality certificates and the agents' own work.
import type { Json } from "@metalntwx/metal-pay/mandates";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { buildAuditReport, refusalRule, reportLines, type AuditReport } from "../src/audit/report.js";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal } from "../src/policy/approvals.js";

const t0 = new Date("2026-11-19T10:00:00Z");

describe("the rule behind an automatic refusal", () => {
  it("names the check that refused a payment, a card decline, and each other refusal; nothing for an event with no rule", () => {
    for (const event of ["upstream.refused", "refund.refused", "sweep.refused"]) {
      expect(refusalRule(event, { reason: "frozen_by_cfo: stop" })).toBe("Emergency stop: every agent payment refused before signing");
      expect(refusalRule(event, { reason: "policy_cap_exceeded: 0.04" })).toBe("CFO policy limit, checked before anything is signed");
      expect(refusalRule(event, { reason: "replace_pending: P-1" })).toMatch(/^A mandate replace is open/);
      expect(refusalRule(event, { reason: "buy_policy: thin" })).toBe("The Sourcing agent's own buy policy, checked before anything is signed");
      expect(refusalRule(event, { reason: "mandate_cap_exceeded" })).toBe("The agent's mandate, enforced by the account on chain");
      expect(refusalRule(event, {})).toBe("Payment refused before or on chain");
    }
    expect(refusalRule("card.charge_declined", { reason: "CARD_INACTIVE" })).toBe("Emergency stop: the card is frozen at Airwallex");
    expect(refusalRule("card.charge_declined", { reason: "LIMIT_EXCEEDED" })).toBe("The card's limit at Airwallex, synced from the CFO policy");
    expect(refusalRule("card.charge_declined", { reason: "MCC_BLOCKED" })).toBe("Declined by Airwallex");
    expect(refusalRule("invoice.fraud_suspected", {})).toMatch(/^Invoice fraud check/);
    expect(refusalRule("document.injection_flagged", {})).toBe("Documents are data: an instruction inside one changes nothing");
    expect(refusalRule("proposal.expired", {})).toBe("A proposal not approved in time can never run");
    expect(refusalRule("sale.prepaid_undelivered", {})).toMatch(/owed and refunded$/);
    expect(refusalRule("something.else", {})).toBe("");
  });
});

describe("each decision's rule and outcome", () => {
  const terms = (kind: string, id: string, extra: Record<string, unknown> = {}) => ({ schema: TERMS_SCHEMA, kind, proposal_id: id, expires_at: "2026-11-19T11:00:00Z", ...extra }) as unknown as Terms;

  it("the emergency stop and a card limit have their own rule; a kind with no rule needs a person", () => {
    const db = openDb(":memory:");
    createProposal(db, { terms: terms("policy_change", "P-0001", { changes: [{ key: "freeze", label: "Stop", from: "on", to: "off" }], reason: "r" }), createdBy: "human" }, t0);
    createProposal(db, { terms: terms("policy_change", "P-0002", { changes: [{ key: "card.sourcing.per_tx", label: "Card", from: "30.00", to: "20.00" }], reason: "r" }), createdBy: "human" }, t0);
    createProposal(db, { terms: terms("policy_change", "P-0003", { changes: [{ key: "cap.sourcing", label: "Cap", from: "0.03", to: "0.02" }], reason: "r" }), createdBy: "human" }, t0);
    createProposal(db, { terms: terms("quarantine_release", "P-0004", { action: "return" }), createdBy: "system" }, t0);
    const r = buildAuditReport(db, t0);
    const rule = (id: string) => r.decisions.find((d) => d.proposal_id === id)!.rule;
    expect(rule("P-0001")).toMatch(/^The emergency stop: the CFO may pull it from the phone/);
    expect(rule("P-0002")).toMatch(/^A company card's limit is part of the CFO policy/);
    expect(rule("P-0003")).toBe("A change to the CFO policy needs the CFO's own approval.");
    expect(rule("P-0004")).toBe("Needs a person.");
    expect(r.decisions.every((d) => d.decision === null && d.outcome === "waiting for a decision")).toBe(true);
  });

  it("the outcome of a proposal in every state, from its executed row, its failure or its status", () => {
    const db = openDb(":memory:");
    const cases: [string, string, Record<string, unknown> | null, string][] = [
      ["P-0001", "EXECUTED", { steps: 2, query_price: "0.05" }, "executed: 2 mandate steps, query price 0.05"],
      ["P-0002", "EXECUTED", { steps: 1 }, "executed: 1 mandate steps"],
      ["P-0003", "EXECUTED", { dev_test: true }, "executed: moved nothing"],
      ["P-0004", "EXECUTED", { changes: 1 }, "executed: 1 policy change applied"],
      ["P-0005", "EXECUTED", { changes: 3 }, "executed: 3 policy changes applied"],
      ["P-0006", "EXECUTED", { card: "issued", last4: "4242" }, "executed: card issued, last4 4242"],
      ["P-0007", "EXECUTED", null, "executed"],
      ["P-0008", "REJECTED", null, "rejected: nothing ran"],
      ["P-0009", "EXPIRED", null, "expired: nothing ran"],
      ["P-0010", "SUPERSEDED", null, "superseded: another option was approved"],
      ["P-0011", "APPROVED", null, "approved, not yet run"],
      ["P-0012", "FAILED", null, "failed: see the ledger"],
      ["P-0013", "NEEDS_REAPPROVAL", null, "needs a new approval: the quote expired"],
      ["P-0014", "EXECUTING", null, "executing"],
    ];
    for (const [id, status, executed] of cases) {
      createProposal(db, { terms: terms("dev_test", id, { label: "t", purpose: "p" }), createdBy: "system" }, t0);
      db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(status, id);
      if (executed) audit(db, "system", "proposal.executed", id, executed as Json, t0);
    }
    audit(db, "system", "proposal.needs_reapproval", "P-0013", { error: "the quote expired" }, t0);
    const r = buildAuditReport(db, t0);
    for (const [id, , , outcome] of cases) expect([id, r.decisions.find((d) => d.proposal_id === id)!.outcome]).toEqual([id, outcome]);
  });
});

describe("what the report prints", () => {
  const base = (): AuditReport => ({
    generated_at: "2026-11-19T10:00:00.000Z", label: "test", chain: { ok: true, rows: 3, head: "h" } as AuditReport["chain"], anchor: "3:h",
    alone: { sales: 2, purchases_paid: 1, purchases_refused: 0, refunds_paid: 0, sweeps_paid: 0, injections_flagged: 0, invoices_blocked: 0, card_charges: 0, card_declines: 0, clearing_sales: 1 },
    decisions: [{ proposal_id: "P-0001", kind: "dev_test", title: "Dev test", proposed_by: "system", proposed_at: "2026-11-19T09:00:00Z", what: "x", rule: "r", models: [], advice: { model: null, recommendation: "approve", text: `${"A sentence. ".repeat(200)}` },
      status: "APPROVED", decision: "APPROVED", decided_by: "Max", method: "cli", decided_at: "2026-11-19T09:05:00Z", terms_sha256: "a".repeat(64), outcome: "approved, not yet run" }],
    refusals: [{ at: "2026-11-19T09:10:00Z", agent: "sourcing", what: "purchase refused", reason: "over the cap", rule: "" }],
    finality: { reported: 2, not_kept: 1, failed: 1, not_found: 1, blocks: [{ block_number: 10, block_hash: `0x${"1".repeat(64)}`, signers: 3, participants: 4, ok: true }, { block_number: 11, block_hash: `0x${"2".repeat(64)}`, signers: 1, participants: 4, ok: false }] },
  });

  it("a broken chain says where; the clearing sales, a typed-hash decision, short advice, finality and a refusal without a rule", () => {
    const r = base();
    r.chain = { ok: false, seq: 2, reason: "row hash mismatch" } as AuditReport["chain"];
    const lines = reportLines(r).map((l) => l.text);
    expect(lines).toContain("BROKEN at row 2: row hash mismatch.");
    expect(lines.find((l) => l.startsWith("2 sales"))).toMatch(/^2 sales \(1 paid by Metal clearing\);/);
    expect(lines).toContain("Proposed by the system at 2026-11-19 09:00:00 UTC: x");
    expect(lines).toContain("Models: none (code only)");
    expect(lines).toContain("Decision: approved by Max (cli, typed hash prefix) at 2026-11-19 09:05:00 UTC");
    const advice = lines.find((l) => l.startsWith("Advice (no model, approve):"))!;
    expect(advice.length).toBeLessThan(1600);
    expect(advice.endsWith(". …")).toBe(true);
    expect(lines).toContain("Finality on Metal");
    const fin = lines.find((l) => l.startsWith("2 chain transaction(s)"))!;
    expect(fin).toContain("1 were looked up after the node stopped keeping the certificate");
    expect(fin).toContain("1 have a certificate that FAILED a check.");
    expect(fin).toContain("1 never showed as final.");
    expect(lines.some((l) => /^block 11 0x2{16}\.\.\. reported 1 of 4 validators FAILED$/.test(l))).toBe(true);
    expect(lines).toContain("2026-11-19 09:10:00 UTC · sourcing · purchase refused: over the cap");
    expect(lines.some((l) => l.startsWith("Rule:"))).toBe(false);
  });

  it("no finality section when no certificate was looked up; a pending decision says so, and a person's proposal is a person's", () => {
    const r = base();
    r.finality = { reported: 0, not_kept: 0, failed: 0, not_found: 0, blocks: [] };
    r.decisions[0] = { ...r.decisions[0]!, proposed_by: "human", decision: null, status: "PENDING_APPROVAL", advice: null };
    const lines = reportLines(r).map((l) => l.text);
    expect(lines).not.toContain("Finality on Metal");
    expect(lines).toContain("Decision: none (pending approval)");
    expect(lines.some((l) => l.startsWith("Proposed by a person"))).toBe(true);
  });
});
