// Tier 3 item 9: the audit log is checked offline, also against an anchor a report printed earlier, and every
// decision is exported with its agent, models, reason, policy rule, approver and hash.
import { describe, expect, it } from "vitest";
import { audit, checkAnchor, verifyAuditRows, type AuditRowStored } from "../src/audit/log.js";
import { buildAuditReport, renderAuditPdf, reportLines, winAnsi } from "../src/audit/report.js";
import { openDb, type DB } from "../src/db/open.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";

const t0 = new Date("2026-10-30T14:00:00Z");
const rows = (db: DB) => db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[];

function world(): DB {
  const db = openDb(":memory:");
  const doc = "INVOICE LIC-1 …";
  audit(db, "treasury", "claude.read", "extract_invoice", { model: "claude-sonnet-5-5", input_sha256: sha256Hex(doc), output: {} }, t0);
  const inv = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0001", expires_at: "2026-10-30T15:00:00Z", invoice_no: "LIC-1", vendor: "Lizenzhaus Beispiel GmbH",
    amount: "1850.00", currency: "EUR", fee_max: "20.00", iban_last4: "3000", evidence: [{ type: "invoice", ref: "LIC-1", sha256: sha256Hex(doc) }] } as unknown as Terms;
  const p1 = createProposal(db, { terms: inv, createdBy: "treasury", evidence: (inv as unknown as { evidence: never }).evidence }, t0);
  db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = 'P-0001'").run("[claude-opus-5-5] APPROVE: Pays the licence invoice. ok");
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-0001', 'APPROVED', ?, 'max (passkey k_EWzUuv)', 'passkey', ?, ?)")
    .run(p1.terms_sha256, p1.terms_sha256.slice(0, 8), t0.toISOString());
  db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = 'P-0001'").run();
  audit(db, "awx-executor", "transfer.status", "tr-1", { status: "PAID" }, t0);
  audit(db, "system", "proposal.executed", "P-0001", { transfer_id: "tr-1", status: "PAID" }, t0);
  const refund = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0002", expires_at: "2026-10-30T15:00:00Z", total: "0.45", refunds: [] } as unknown as Terms;
  const p2 = createProposal(db, { terms: refund, createdBy: "support" }, t0);
  decide(db, { proposalId: "P-0002", decision: "REJECTED", typedPrefix: p2.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, t0);
  audit(db, "sourcing", "upstream.refused", "52", { seq: 51, reason: "policy_cap_exceeded: 0.04 is over the sourcing limit of 0.03" }, t0);
  audit(db, "system", "sale.delivered", "1", {}, t0);
  audit(db, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7" }, t0);
  return db;
}

describe("verify-log", () => {
  it("checks exported rows offline and finds an edited row", () => {
    const db = world();
    const r = rows(db);
    expect(verifyAuditRows(r)).toMatchObject({ ok: true, rows: r.length });
    const edited = r.map((x) => (x.seq === 2 ? { ...x, subject: "P-0009" } : x));
    expect(verifyAuditRows(edited)).toMatchObject({ ok: false, seq: 2 });
  });

  it("finds a cut-off tail or a rewritten chain only against an anchor printed earlier", () => {
    const db = world();
    const r = rows(db);
    const head = r.at(-1)!;
    const anchor = { seq: head.seq, hash: head.row_hash };
    expect(checkAnchor(r, anchor)).toEqual({ ok: true });
    // Dropping the last rows leaves a chain that verifies on its own...
    const cut = r.slice(0, -2);
    expect(verifyAuditRows(cut).ok).toBe(true);
    expect(checkAnchor(cut, anchor)).toEqual({ ok: false, reason: `the log has ${cut.length} rows; the anchor is row ${anchor.seq}` });
    // ...and so does a chain an attacker rehashed after an edit, but its row no longer has the anchored hash.
    const fresh = openDb(":memory:");
    for (const x of r) audit(fresh, x.actor as never, x.event, x.seq === 2 ? "P-0009" : x.subject, JSON.parse(x.payload_json), new Date(x.ts));
    expect(verifyAuditRows(rows(fresh)).ok).toBe(true);
    expect(checkAnchor(rows(fresh), anchor)).toMatchObject({ ok: false, reason: expect.stringMatching(/^row \d+ has hash/) });
  });
});

describe("audit report", () => {
  it("lists every decision with agent, models, reason, policy rule, approver and hash", () => {
    const db = world();
    const rep = buildAuditReport(db, t0);
    expect(rep.chain).toMatchObject({ ok: true, rows: rows(db).length });
    const [d1, d2] = rep.decisions;
    expect(d1).toMatchObject({
      proposal_id: "P-0001", proposed_by: "treasury", status: "EXECUTED",
      what: expect.stringContaining("1850.00"), rule: expect.stringMatching(/payout needs a person/),
      models: ["Sonnet (extract invoice)", "Opus (review: approve)"], decided_by: "Max · Face ID", decision: "APPROVED",
      terms_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), outcome: "executed: transfer tr-1 PAID",
    });
    expect(d2).toMatchObject({ proposal_id: "P-0002", proposed_by: "support", decision: "REJECTED", decided_by: "max", outcome: "rejected: nothing ran" });
    expect(rep.refusals.map((x) => [x.what, x.agent])).toEqual([["Proposal rejected", "human"], ["Supplier purchase refused", "sourcing"]]);
    expect(rep.alone).toMatchObject({ sales: 1, refunds_paid: 1, purchases_refused: 1 });
  });

  it("prints each decision's lines, and a PDF that carries the anchor in its metadata", async () => {
    const rep = buildAuditReport(world(), t0);
    const text = reportLines(rep).map((l) => l.text).join("\n");
    for (const s of ["P-0001", "Max · Face ID", "Sonnet (extract invoice)", rep.decisions[0]!.terms_sha256, "Supplier purchase refused", `npm run verify-log -- --anchor ${rep.anchor}`]) {
      expect(text).toContain(s);
    }
    const pdf = (await renderAuditPdf(rep, { compress: false })).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain(`anchor ${rep.anchor}`);
  });

  it("keeps text inside the PDF font's character set", () => {
    expect(winAnsi("no extra limit → 0.03 ≤ 0.04 · Müller € — “ok”")).toBe("no extra limit -> 0.03 <= 0.04 · Müller € — “ok”");
    expect(winAnsi("Bеispiеl")).toBe("B?ispi?l");
  });
});
