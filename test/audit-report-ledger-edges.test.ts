// The audit report built from a ledger (src/audit/report.ts), the paths the other files leave: an empty ledger's anchor
// is "0:"; a proposal that needs a new approval with no error recorded points to the ledger; an approved proposal
// refused at execution shows as blocked with its reason and nothing paid; a refusal in the log comes with its rule; a
// stored finality certificate is listed with its signers; and the printed lines cut long advice with no sentence end
// where it fits, leave a missing decision time empty, and name only the finality counts that are not zero. The PDF is
// compressed unless asked otherwise.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { buildAuditReport, renderAuditPdf, reportLines, type AuditReport } from "../src/audit/report.js";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { BLOCKED_EVENT, BLOCKED_STATUS } from "../src/policy/blocked.js";

const now = new Date("2026-11-19T10:00:00Z");
const file = (db: ReturnType<typeof openDb>, id: string) => createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: "2026-11-19T11:00:00Z", total: "0.10" } as Terms, createdBy: "support" }, now);

describe("the report from a ledger", () => {
  it("an empty ledger's anchor is 0:", () => {
    const r = buildAuditReport(openDb(":memory:"), now);
    expect(r).toMatchObject({ anchor: "0:", decisions: [], refusals: [], label: "ledger" });
  });

  it("needs a new approval with no error recorded; approved and blocked at execution; a refusal with its rule; a stored certificate", () => {
    const db = openDb(":memory:");
    file(db, "P-0001");
    db.prepare("UPDATE proposals SET status = 'NEEDS_REAPPROVAL' WHERE proposal_id = 'P-0001'").run();
    audit(db, "system", "proposal.needs_reapproval", "P-0001", {}, now);
    const p2 = file(db, "P-0002");
    decide(db, { proposalId: "P-0002", decision: "APPROVED", typedPrefix: p2.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
    audit(db, "system", BLOCKED_EVENT, "P-0002", { reason: "the EUR floor would be crossed", check: "precondition" }, now);
    audit(db, "support", "refund.refused", "R-1", { reason: "frozen_by_cfo: stop", amount: "0.05" }, now);
    db.prepare("INSERT INTO finality_certificates (block_hash, block_number, certificate_json, ok, check_json, fetched_at) VALUES (?, 42, '{}', 1, ?, ?)").run(`0x${"4".repeat(64)}`, JSON.stringify({ quorum: { signers: 3, participants: 4 } }), now.toISOString());
    const r = buildAuditReport(db, now, "test ledger");
    const by = (id: string) => r.decisions.find((d) => d.proposal_id === id)!;
    expect(by("P-0001").outcome).toBe("needs a new approval: see the ledger");
    expect(by("P-0002")).toMatchObject({ status: BLOCKED_STATUS, outcome: expect.stringMatching(/^approved, blocked at execution since .*: the EUR floor would be crossed; nothing was paid$/) });
    expect(r.refusals).toContainEqual(expect.objectContaining({ agent: "support", rule: "Emergency stop: every agent payment refused before signing" }));
    expect(r.finality.blocks).toEqual([{ block_number: 42, block_hash: `0x${"4".repeat(64)}`, signers: 3, participants: 4, ok: true }]);
  });
});

describe("the printed lines", () => {
  const base = (): AuditReport => ({
    generated_at: "2026-11-19T10:00:00.000Z", label: "test", chain: { ok: true, rows: 1, head: "h" } as AuditReport["chain"], anchor: "1:h",
    alone: { sales: 0, purchases_paid: 0, purchases_refused: 0, refunds_paid: 0, sweeps_paid: 0, injections_flagged: 0, invoices_blocked: 0, card_charges: 0, card_declines: 0, clearing_sales: 0 },
    decisions: [{ proposal_id: "P-0001", kind: "dev_test", title: "Dev test", proposed_by: "support", proposed_at: "2026-11-19T09:00:00Z", what: "x", rule: "r", models: [], advice: { model: null, recommendation: "approve", text: "x".repeat(2000) },
      status: "APPROVED", decision: "APPROVED", decided_by: "Max", method: "cli", decided_at: null, terms_sha256: "a".repeat(64), outcome: "approved, not yet run" }],
    refusals: [],
    finality: { reported: 1, not_kept: 0, failed: 0, not_found: 0, blocks: [] },
  });

  it("long advice with no sentence end is cut where it fits; a missing decision time is left empty; only finality counts above zero are named", () => {
    const lines = reportLines(base()).map((l) => l.text);
    const advice = lines.find((l) => l.startsWith("Advice (no model, approve):"))!;
    expect(advice.endsWith(`${"x".repeat(1500)} …`)).toBe(true);
    expect(lines).toContain("Decision: approved by Max (cli, typed hash prefix) at ");
    expect(lines).toContain("Proposed by the support agent at 2026-11-19 09:00:00 UTC: x");
    const fin = lines.find((l) => l.startsWith("1 chain transaction(s)"))!;
    expect(fin).not.toMatch(/were looked up after|FAILED a check|never showed as final/);
  });

  it("the PDF is compressed unless asked otherwise", async () => {
    const pdf = await renderAuditPdf(base());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("/FlateDecode");
  });
});
