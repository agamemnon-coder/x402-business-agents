// Red team (runner, 27 Nov, finding 5): the replacement of a failed payout (src/executors/replaceFailed.ts) checked only
// that the stored terms still hash to the approved hash (signedTerms). It skipped the rest of the execution guard: the
// audit chain's tamper refusal, the signed checkpoint, the stored signatures behind the approval, the hub gate, the
// paying account and the Airwallex batch. On a ledger whose audit log was rewritten (a new payment refused as tampered),
// the failed payout's replacement was sent 40 days later. Now a replacement runs the same checks as hashFirst and
// beginExecution before its row is written, and only within REPLACE_WITHIN_DAYS of the first transfer's failure.
// Test money only, no network.
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { openDb } from "../src/db/open.js";
import { negotiatedInvoiceText, negotiationScene } from "../src/e2e/moneyLoopLive.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { REPLACE_WITHIN_DAYS, replaceFailedPayout } from "../src/executors/replaceFailed.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";

async function world(now = new Date()) {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const scene = negotiationScene(now.toISOString().slice(0, 10));
  const file = async (no: string) => {
    const text = negotiatedInvoiceText({ ...scene, invoice_no: no }, no, "100.00", scene.due_date);
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text, now, "MIN_15");
    if (out.kind !== "proposed") throw new Error(out.reason);
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { terms_sha256: string };
    decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
    return out.proposal.proposal_id;
  };
  /** An approved invoice payment, executed, then failed by the supplier's bank. */
  const failed = async (no: string) => {
    const id = await file(no);
    const r = await executeInvoicePayment(db, awx, null, id, () => now);
    await awx.transitionTransfer(r.transfer.id, "FAILED", "INVALID_BENEFICIARY_ACCOUNT");
    return id;
  };
  const tamper = (id: string) => {
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare("UPDATE audit_log SET payload_json = json_set(payload_json, '$.approver', 'mallory') WHERE event = 'proposal.approved' AND subject = ?").run(id);
    db.exec("CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;");
  };
  return { db, awx, now, file, failed, tamper };
}
const days = (from: Date, n: number) => new Date(from.getTime() + n * 86_400_000);

describe("a replacement payout runs the execution guard (runner finding 5)", () => {
  it("the PoC: on a ledger the guard refuses as tampered, 40 days later, nothing is sent", async () => {
    const w = await world();
    const a = await w.failed("BTX-RPL-1");
    const b = await w.file("BTX-RPL-2");
    w.tamper(a);
    await expect(executeInvoicePayment(w.db, w.awx, null, b, () => w.now)).rejects.toThrow(/tamper|verif/i);
    const before = w.awx.transfers.length;
    const out = await replaceFailedPayout(w.db, w.awx, null, a, () => days(w.now, 40));
    expect(out.outcome).toBe("stopped");
    expect(w.awx.transfers).toHaveLength(before);
  });

  it("on a tampered ledger, the next day: stopped by the guard, nothing written or sent", async () => {
    const w = await world();
    const a = await w.failed("BTX-RPL-3");
    w.tamper(a);
    const rows = (w.db.prepare("SELECT COUNT(*) AS n FROM transfers").get() as { n: number }).n;
    const out = await replaceFailedPayout(w.db, w.awx, null, a, () => days(w.now, 1));
    expect(out).toMatchObject({ outcome: "stopped", code: "guard" });
    expect(out.outcome === "stopped" ? out.reason : "").toMatch(/audit/i);
    expect((w.db.prepare("SELECT COUNT(*) AS n FROM transfers").get() as { n: number }).n).toBe(rows);
    expect(w.awx.transfers).toHaveLength(1);
  });

  it("an approval with no signature behind it that verifies: stopped by the guard", async () => {
    const w = await world();
    const a = await w.failed("BTX-RPL-4");
    // The approval row rewritten to claim a passkey signature nobody made.
    w.db.prepare("UPDATE approvals SET method = 'passkey' WHERE proposal_id = ?").run(a);
    const out = await replaceFailedPayout(w.db, w.awx, null, a, () => days(w.now, 1));
    expect(out).toMatchObject({ outcome: "stopped", code: "guard" });
    expect(w.awx.transfers).toHaveLength(1);
  });

  it(`only within ${7} days of the failure: later, a person decides`, async () => {
    expect(REPLACE_WITHIN_DAYS).toBe(7);
    const w = await world();
    const a = await w.failed("BTX-RPL-5");
    const late = await replaceFailedPayout(w.db, w.awx, null, a, () => days(w.now, REPLACE_WITHIN_DAYS + 1));
    expect(late).toMatchObject({ outcome: "stopped", code: "too_late" });
    expect(w.awx.transfers).toHaveLength(1);
    const w2 = await world();
    const b = await w2.failed("BTX-RPL-6");
    expect(await replaceFailedPayout(w2.db, w2.awx, null, b, () => days(w2.now, 2))).toMatchObject({ outcome: "replaced" });
  });
});
