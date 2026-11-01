// Design 4.1: the control tower, from the ledger. Money in, the agents' live limits, money out, the P&L in each rail's
// own unit (never converted), and who enforced each refusal, each with the proof of its newest entry.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { audit } from "../src/audit/log.js";
import { towerView } from "../src/dashboard/tower.js";

const T = "2026-11-05T10:00:00.000Z";
function world() {
  const db = openDb(":memory:");
  // Card rows need their card; the tower reads only the transactions.
  db.exec("PRAGMA foreign_keys = OFF");
  const sale = db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at, tx_hash) VALUES ('/v1/stock', ?, '0xc', 'u', '{}', ?, ?, ?)");
  sale.run(5, "DELIVERED", T, "0xs1"); sale.run(5, "DELIVERED", T, "0xs2"); sale.run(5, "ABORTED_NO_CHARGE", T, null);
  db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, tx_hash, created_at, supplier) VALUES (3, 'PAID', '0xu1', ?, 'ridgeline'), (4, 'REFUSED', NULL, ?, 'stockline')").run(T, T);
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, source, occurred_at, recorded_at) VALUES ('awx-ok', 'c1', 'sourcing', 'Packwise', '5734', 1999, 'EUR', 'APPROVED', 1, NULL, 'simulation', ?, ?), ('awx-no', 'c1', 'sourcing', 'Packwise', '5734', 4500, 'EUR', 'FAILED', 0, 'LIMIT_EXCEEDED', 'simulation', ?, ?)").run(T, T, T, T);
  audit(db, "sourcing", "upstream.refused", "2", { reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", refused_by: "purser" });
  audit(db, "sourcing", "upstream.refused", "3", { reason: "supplier_unavailable: Ridgeline Data made no offer for stock check #24", refused_by: "purser" });
  audit(db, "sourcing", "upstream.refused_on_chain", "41", { metal_reason: "mandate_cap_exceeded", tx: "0xrefused" });
  audit(db, "sourcing", "agent.decision", "wake.sourcing", { source: "claude", summary: "Switched to Ridgeline." });
  return db;
}
const inputs = {
  budgets: [{ agent: "sourcing", cap: "0.03", budget: "10.00", spent: "2.40", pending: "0.10", remaining: "7.50" }],
  cards: [{ agent: "sourcing", spent_month: "19.99", monthly: "100.00", frozen: false, single_use: false }, { agent: "support", spent_month: "5.00", monthly: "10.00", frozen: false, single_use: true }],
};

describe("the control tower", () => {
  it("counts money in and out per rail from the ledger, with the newest proof", () => {
    const t = towerView(world(), inputs);
    expect(t.money_in[0]).toMatchObject({ label: "Stock checks sold", amount: "0.10", count: 2, unit: "USDZ", proof: { kind: "tx", ref: "0xs2" } });
    expect(t.money_out.find((f) => f.label === "Stock data bought")).toMatchObject({ amount: "0.03", count: 1, proof: { kind: "tx", ref: "0xu1" } });
    expect(t.money_out.find((f) => f.label === "Card spend")).toMatchObject({ amount: "19.99", unit: "EUR", proof: { kind: "awx", ref: "awx-ok" } });
  });

  it("keeps each rail's P&L in its own unit", () => {
    const t = towerView(world(), inputs);
    expect(t.pnl.usdz).toEqual({ sales: "0.10", upstream: "0.03", refunds: "0.00", net: "0.07" });
    expect(t.pnl.eur).toMatchObject({ card_spend: "19.99", payouts: "0.00", out: "19.99" });
  });

  it("shows each agent's live limits, its last decision and who decided; a task card is not its company card", () => {
    const db = world();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.support', 'on', ?)").run(T);
    const t = towerView(db, inputs);
    expect(t.agents.find((a) => a.agent === "sourcing")).toMatchObject({ status: "active", mandate: { used_pct: 25 }, card: { used_pct: 20 }, last: { by: "claude", text: "Switched to Ridgeline." } });
    expect(t.agents.find((a) => a.agent === "support")).toMatchObject({ status: "paused", mandate: null, card: null, last: null });
  });

  it("says who enforced each refusal: Purser before signing, Metal on chain (its tx), Airwallex at the card (its id)", () => {
    const t = towerView(world(), inputs);
    // An unavailable supplier is not a limit: only refusals against the mandate count.
    expect(t.enforced.map((e) => [e.who, e.count])).toEqual([["purser", 1], ["metal", 1], ["airwallex", 1]]);
    expect(t.enforced[0]!.last!.reason).toMatch(/^mandate_cap_exceeded/);
    expect(t.enforced[1]!.last!.proof).toEqual({ kind: "tx", ref: "0xrefused" });
    expect(t.enforced[2]!.last).toMatchObject({ reason: "LIMIT_EXCEEDED", proof: { kind: "awx", ref: "awx-no" } });
  });

  it("counts a refusal Metal's facilitator gave (refused_by metal) as Metal's", () => {
    const db = world();
    audit(db, "sourcing", "upstream.refused", "9", { reason: "mandate_cap_exceeded", refused_by: "metal" });
    expect(towerView(db, inputs).enforced[1]!.count).toBe(2);
  });

  it("reads an older row without refused_by: a bare code is Metal's facilitator, Purser's own always has its detail (Metal QA)", () => {
    const db = world();
    audit(db, "sourcing", "upstream.refused", "41", { reason: "mandate_cap_exceeded", seq: 41 });
    audit(db, "sourcing", "upstream.refused", "42", { reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", seq: 42 });
    const e = towerView(db, inputs).enforced;
    expect(e[1]!.count).toBe(2);
    expect(e[0]!.count).toBe(2);
  });
});
