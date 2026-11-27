// Red team (runner, 27 Nov, finding 2): one supplier bill paid twice, or three times, through the negotiated-payout path.
// The agreed invoice is numbered <original>-<sha8> (src/negotiate/rails.ts agreedInvoiceNo), and none of the duplicate
// guards related it to the original: invoiceAlreadyHandled, the executors' check of other payouts and the ledger's
// one_live_transfer_per_invoice index. So the bill as issued and its agreed invoice were both paid, and a second
// negotiation of the same bill (another hash) paid a third time, with a person's approval or alone within the limit.
// Now the signed terms' negotiation.original_invoice_no links the agreed invoice to its bill everywhere: at most one live
// payment per bill, original or negotiated. Test money only, no network.
import { describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { openDb } from "../src/db/open.js";
import { negotiatedInvoiceText, negotiatedPayment, negotiationScene } from "../src/e2e/moneyLoopLive.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { recordedNegotiation } from "../src/negotiate/negotiate.js";
import { agreedInvoiceNo } from "../src/negotiate/rails.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import { approveWithinLimit, decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const TODAY = NOW.toISOString().slice(0, 10);

async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  const approve = (id: string) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
  };
  const scene = negotiationScene(TODAY);
  const propose = (text: string, n?: Parameters<typeof proposeInvoicePayment>[9]) =>
    proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text, NOW, "MIN_15", undefined, undefined, undefined, n);
  const original = () => negotiatedInvoiceText(scene, scene.invoice_no, "100.00", scene.due_date);
  const negotiation = async () => {
    const n = await recordedNegotiation(TODAY, "red team", scene);
    return { text: negotiatedInvoiceText(scene, agreedInvoiceNo(scene, n.sha256), n.agreement.amount, n.agreement.pay_by), terms: negotiatedPayment(n) };
  };
  const paid = () => awx.transfers.filter((t) => t.status === "PAID");
  return { db, awx, approve, scene, propose, original, negotiation, paid };
}

describe("a negotiated bill is paid once (runner finding 2)", () => {
  it("the bill as issued paid, its agreed invoice and a second negotiation are not proposed again", async () => {
    const w = await world();
    const first = await w.propose(w.original());
    if (first.kind !== "proposed") throw new Error(first.reason);
    w.approve(first.proposal.proposal_id);
    await executeInvoicePayment(w.db, w.awx, w.awx, first.proposal.proposal_id, () => NOW);
    for (let i = 0; i < 2; i++) {
      const n = await w.negotiation();
      const out = await w.propose(n.text, n.terms);
      expect(out.kind).toBe("escalated");
      expect(out.kind === "escalated" ? out.reason : "").toMatch(/BTX-NEG-1126 is already paid/);
    }
    expect(w.paid()).toHaveLength(1);
  });

  it("the agreed invoice paid, the bill as issued and a second negotiation of it are refused", async () => {
    const w = await world();
    const n1 = await w.negotiation();
    const agreed = await w.propose(n1.text, n1.terms);
    if (agreed.kind !== "proposed") throw new Error(agreed.reason);
    w.approve(agreed.proposal.proposal_id);
    await executeInvoicePayment(w.db, w.awx, w.awx, agreed.proposal.proposal_id, () => NOW);
    expect(invoiceAlreadyHandled(w.db, w.scene.invoice_no, NOW)).toMatch(/already paid/);
    expect((await w.propose(w.original())).kind).toBe("escalated");
    const n2 = await w.negotiation();
    expect((await w.propose(n2.text, n2.terms)).kind).toBe("escalated");
    expect(w.paid()).toHaveLength(1);
  });

  it("an agreed invoice waiting for approval blocks the bill as issued, and the reverse", async () => {
    const w = await world();
    const n = await w.negotiation();
    expect((await w.propose(n.text, n.terms)).kind).toBe("proposed");
    expect(invoiceAlreadyHandled(w.db, w.scene.invoice_no, NOW)).toMatch(/waits for approval/);
    expect((await w.propose(w.original())).kind).toBe("escalated");
  });

  it("the executor refuses a second live payment for the bill, original or negotiated, approved before the guard could see it", async () => {
    const w = await world();
    // Both proposed before either is paid: the guard sees the other one waiting, so the second is filed by hand here.
    const first = await w.propose(w.original());
    if (first.kind !== "proposed") throw new Error(first.reason);
    w.approve(first.proposal.proposal_id);
    w.db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = ?").run(first.proposal.proposal_id);
    const n = await w.negotiation();
    const agreed = await w.propose(n.text, n.terms);
    if (agreed.kind !== "proposed") throw new Error(agreed.reason);
    w.db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(first.proposal.proposal_id);
    w.approve(agreed.proposal.proposal_id);
    await executeInvoicePayment(w.db, w.awx, w.awx, first.proposal.proposal_id, () => NOW);
    await expect(executeInvoicePayment(w.db, w.awx, w.awx, agreed.proposal.proposal_id, () => NOW)).rejects.toThrow(/BTX-NEG-1126.*already paid/);
    expect(w.paid()).toHaveLength(1);
  });

  it("the ledger keeps one live payout per bill: a payout row for the agreed invoice beside the original's is refused", async () => {
    const w = await world();
    const n = await w.negotiation();
    const agreed = await w.propose(n.text, n.terms);
    if (agreed.kind !== "proposed") throw new Error(agreed.reason);
    const t = agreed.terms;
    w.db.prepare("INSERT OR IGNORE INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) SELECT ?, vendor, '100.00', currency, due_date, iban_sha256, bic, doc_sha256, status FROM invoices WHERE invoice_no = ?").run(w.scene.invoice_no, t.invoice_no);
    const row = (req: string, no: string) => w.db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, '1.00', 'EUR', 'SWIFT', '0.00', 'PAID', 'x', ?)").run(req, no, NOW.toISOString());
    row("req-original", w.scene.invoice_no);
    expect(() => row(t.transfer_request_id, t.invoice_no)).toThrow(/one live payout per bill/);
  });

  it("alone within the limit: the bill as issued paid by code, its agreed invoice is not paid again by code", async () => {
    const w = await world();
    setSystemDefaultAloneLimit(w.db, "500.00", NOW);
    const LIMIT = { currency: "EUR", amount: "500.00" };
    const payAlone = async (text: string, n?: Parameters<typeof proposeInvoicePayment>[9]) => {
      const out = await w.propose(text, n);
      if (out.kind !== "proposed") return `escalated: ${out.reason}`;
      const ok = approveWithinLimit(w.db, { proposalId: out.proposal.proposal_id, limit: LIMIT, rule: "red team", agent: "payer" }, NOW);
      if (!ok.ok) return `cfo: ${ok.reason}`;
      await executeInvoicePayment(w.db, w.awx, w.awx, out.proposal.proposal_id, () => NOW);
      return "alone";
    };
    expect(await payAlone(w.original())).toBe("alone");
    const n = await w.negotiation();
    expect(await payAlone(n.text, n.terms)).toMatch(/^escalated: invoice BTX-NEG-1126 is already paid/);
    expect(w.paid()).toHaveLength(1);
  });
});
