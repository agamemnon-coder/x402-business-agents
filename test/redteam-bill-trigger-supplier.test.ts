// Red team, round 2 on v1.5.3 (finding E): the ledger's trigger one_live_transfer_per_bill compared a negotiated payout's
// original number with another payout's number as bare strings, with no supplier. Bergtex's bill X paid as negotiated,
// the licensor's own, different bill that happens to carry the number X was refused at the executor's insert, though the
// JS guards (supplier-aware) had let it through. The trigger now asks for the same supplier too: the same name, or the
// same account. A ledger made with the old trigger gets the new one when it is opened. Test money only, no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LICENSOR, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { openDb } from "../src/db/open.js";
import { negotiatedInvoiceText, negotiatedPayment, negotiationScene } from "../src/e2e/moneyLoopLive.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { recordedNegotiation } from "../src/negotiate/negotiate.js";
import { agreedInvoiceNo } from "../src/negotiate/rails.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const TODAY = NOW.toISOString().slice(0, 10);

describe("one live payout per bill, per supplier (red team round 2, finding E)", () => {
  it("another supplier's bill with the number of a negotiated bill's original is paid", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    setSetting(db, "human", "eur_obligations", "0.00");
    const approve = (id: string) => {
      const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
      decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
    };
    const scene = negotiationScene(TODAY);
    const n = await recordedNegotiation(TODAY, "red team", scene);
    const t1 = negotiatedInvoiceText(scene, agreedInvoiceNo(scene, n.sha256), n.agreement.amount, n.agreement.pay_by);
    const a = await proposeInvoicePayment(db, awx, parseInvoiceFallback(t1), t1, NOW, "MIN_15", undefined, undefined, undefined, negotiatedPayment(n));
    if (a.kind !== "proposed") throw new Error(a.reason);
    approve(a.proposal.proposal_id);
    await executeInvoicePayment(db, awx, awx, a.proposal.proposal_id, () => NOW);

    // The licensor's own bill, numbered as Bergtex's bill as issued: another supplier, another account.
    const lic = { ...scene, supplier: { name: LICENSOR.name, iban: LICENSOR.iban, bic: LICENSOR.bic } };
    const t2 = negotiatedInvoiceText(lic, scene.invoice_no, "240.00", scene.due_date).replace(/Textilweg 4, 72760 Reutlingen, Germany/, "Datenallee 12, 10115 Berlin, Germany").replace(/Production lot.*?\(.*?\)/, "Data licence, November           ");
    const b = await proposeInvoicePayment(db, awx, parseInvoiceFallback(t2), t2, NOW, "MIN_15");
    if (b.kind !== "proposed") throw new Error(b.reason);
    approve(b.proposal.proposal_id);
    const paid = await executeInvoicePayment(db, awx, awx, b.proposal.proposal_id, () => NOW);
    expect(paid.transfer.status).toBe("PAID");
    expect(awx.transfers.filter((t) => t.status === "PAID")).toHaveLength(2);
  });

  it("the same supplier's bill is still refused by the trigger, by name or by account", () => {
    const db = openDb(":memory:");
    const inv = db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES (?, ?, '1.00', 'EUR', '2026-12-01', ?, 'BIC', 'd', 'X')");
    const terms = (no: string, original: string) => JSON.stringify({ kind: "invoice_payment", invoice_no: no, negotiation: { original_invoice_no: original } });
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-1', 'invoice_payment', ?, 'h', 'treasury', 'EXECUTED', '2099-01-01', '2026-11-27')").run(terms("X-aaaaaaaa", "X"));
    const row = (req: string, no: string) => db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, '1.00', 'EUR', 'SWIFT', '0.00', 'PAID', 'x', ?)").run(req, no, NOW.toISOString());
    inv.run("X-aaaaaaaa", "Bergtex Textil GmbH", "acct-bergtex");
    row("r1", "X-aaaaaaaa");
    // The same supplier by name (written differently in case and spaces), another account: refused.
    inv.run("X", " bergtex textil gmbh", "acct-other");
    expect(() => row("r2", "X")).toThrow(/one live payout per bill/);
    // Another name, the same account: refused.
    db.prepare("UPDATE invoices SET vendor = 'Bergtex GmbH', iban_sha256 = 'acct-bergtex' WHERE invoice_no = 'X'").run();
    expect(() => row("r3", "X")).toThrow(/one live payout per bill/);
    // Another supplier and another account: allowed.
    db.prepare("UPDATE invoices SET vendor = 'Datenhaus GmbH', iban_sha256 = 'acct-licensor' WHERE invoice_no = 'X'").run();
    expect(() => row("r4", "X")).not.toThrow();
  });

  it("a ledger made with the old trigger gets the supplier-scoped one when it is opened", () => {
    const dir = mkdtempSync(join(tmpdir(), "purser-trigger-"));
    try {
      const file = join(dir, "ledger.sqlite");
      const db = openDb(file);
      const sqlOf = (d: typeof db) => (d.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'one_live_transfer_per_bill'").get() as { sql: string }).sql;
      const now = sqlOf(db);
      expect(now).toMatch(/iban_sha256/);
      // The trigger as v1.5.3 shipped it: bare numbers.
      db.exec(`DROP TRIGGER one_live_transfer_per_bill; CREATE TRIGGER one_live_transfer_per_bill BEFORE INSERT ON transfers
WHEN NEW.status <> 'CANCELLED' AND EXISTS (SELECT 1 FROM transfers t WHERE t.status <> 'CANCELLED' AND t.request_id <> NEW.request_id AND t.invoice_no = NEW.invoice_no)
BEGIN SELECT RAISE(ABORT, 'one live payout per bill: this bill already has a payout, as issued or as negotiated'); END;`);
      expect(sqlOf(db)).not.toMatch(/iban_sha256/);
      db.close();
      const again = openDb(file);
      expect(sqlOf(again)).toBe(now);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
