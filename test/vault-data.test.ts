// What the vault's documents are made from: every figure read from the payables tables, the payment ledger and the
// stored ledger, never computed from thin air.
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoiceDocs, monthData, receiptData, receipts, suppliersData, yearData } from "../src/vault/data.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

let w: VaultWorld;
beforeEach(async () => { w = await vaultWorld({ close: true }); });
afterEach(() => rmSync(w.dir, { recursive: true, force: true }));

describe("the vault's data", () => {
  it("lists every received invoice with its original document, blocked ones marked", () => {
    const docs = invoiceDocs(w.db);
    expect(docs.map((d) => [d.id, d.invoice_no, d.blocked])).toEqual([[w.paidId, "BTX-2026-21", false], [w.blockedId, "BTX-2026-22", true]]);
    const paid = docs[0]!;
    expect(paid).toMatchObject({ vendor: "Bergtex Textil GmbH", currency: "EUR", total: "1850.00", date: "2026-11-02" });
    expect(paid.doc_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("makes a payment receipt from the proposal, the approval and the transfer", () => {
    expect(receipts(w.db).map((r) => r.id)).toEqual([w.paidId]);
    const r = receiptData(w.db, w.paidId)!;
    const terms = JSON.parse((w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(w.proposalId) as { terms_json: string }).terms_json) as { amount: string; conversion: { client_rate: string; buy_amount: string; sell_amount: string } | null };
    const t = w.db.prepare("SELECT transfer_id, fee_actual FROM transfers WHERE status = 'PAID'").get() as { transfer_id: string; fee_actual: string | null };
    const a = w.db.prepare("SELECT approver, method, created_at, approved_sha256 FROM approvals WHERE proposal_id = ?").get(w.proposalId) as { approver: string; method: string; created_at: string; approved_sha256: string };
    expect(r).toMatchObject({
      key: `receipt:${w.paidId}`, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", currency: "EUR", amount: terms.amount,
      proposal_id: w.proposalId, transfer_id: t.transfer_id, fee: t.fee_actual,
      approval: { approver: a.approver, method: a.method, at: a.created_at, signed_sha256: a.approved_sha256 },
    });
    expect(r.fx).toEqual(terms.conversion ? { rate: terms.conversion.client_rate, bought: `EUR ${terms.conversion.buy_amount}`, sold: `USD ${terms.conversion.sell_amount}` } : null);
    expect(receiptData(w.db, w.blockedId)).toBeNull();
  });

  it("sums a month from the invoices received and paid in it, and the ledger's profit and loss", () => {
    const m = monthData(w.db, w.month);
    expect(m.received).toEqual([{ currency: "EUR", total: "3700.00", count: 2 }]);
    expect(m.paid.map((p) => [p.vendor, p.invoice_no, p.amount])).toEqual([["Bergtex Textil GmbH", "BTX-2026-21", "EUR 1850.00"]]);
    expect(m.blocked.map((b) => b.invoice_no)).toEqual(["BTX-2026-22"]);
    expect(m.blocked[0]!.reasons.join(" ")).toMatch(/subtotal/);
    expect(m.spend).toEqual([{ vendor: "Bergtex Textil GmbH", currency: "EUR", total: "1850.00", count: 1 }]);
    expect(m.pnl.length).toBeGreaterThan(0);
  });

  it("lists the suppliers on file with only the last four IBAN digits", () => {
    const s = suppliersData(w.db);
    expect(s.rows.find((r) => r.name === "Bergtex Textil GmbH")).toMatchObject({ iban_last4: "3000", invoices: 2 });
    expect(JSON.stringify(s)).not.toMatch(/DE89370400440532013000/);
  });

  it("reads a year from the ledger: profit and loss before the closing entry, a balance sheet that balances", () => {
    const y = yearData(w.db, Number(w.month.slice(0, 4)));
    expect(y.balance.every((b) => b.balanced)).toBe(true);
    expect(y.trial.length).toBeGreaterThan(0);
  });
});
