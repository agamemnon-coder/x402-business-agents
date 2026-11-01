// D23: the money flow, from the ledger only. Each movement is a recorded event with its own proof (a Metal tx or an
// Airwallex id), who moved it, who decided (the agent's Claude model, the CFO's Face ID, or code following a policy),
// the amount and its rail. A refusal hits its rail with the reason. Breaks if anything is invented, if a stablecoin
// payment is not marked as *USDZ on Metal, or if a decision is credited to Claude that Claude did not make.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { audit } from "../src/audit/log.js";
import { flowEvents } from "../src/dashboard/flows.js";

const T = (m: number) => new Date(Date.UTC(2026, 10, 5, 10, m, 0));
const TX = (n: number) => `0x${String(n).padStart(64, "a")}`;
function world(): DB {
  const db = openDb(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  const sale = db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, tx_hash) VALUES (?, '/v1/stock', 5, '0xc', 'u', '{}', 'DELIVERED', ?, ?)");
  for (const [id, m] of [[1, 1], [2, 2], [3, 3]] as const) {
    sale.run(id, T(m).toISOString(), TX(id));
    audit(db, "system", "sale.delivered", String(id), { tx: TX(id) }, T(m));
  }
  audit(db, "sourcing", "upstream.paid", "1", { amount_units: "20000000000000000", seq: 1, supplier: "stockline", tx: TX(10) }, T(4));
  audit(db, "sourcing", "upstream.refused", "4", { reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", refused_by: "purser", seq: 4, supplier: "stockline" }, T(5));
  audit(db, "sourcing", "upstream.refused_on_chain", "4", { amount: "0.04", metal_reason: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)", seq: 4, tx: TX(11) }, T(6));
  audit(db, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7", to: "0xA5A1", tx: TX(12) }, T(8));
  audit(db, "support", "agent.decision", "wake.support", { agent: "support", source: "claude", model: "claude-sonnet-5-5", summary: "Refunded #7.", tools: ["settle_dispute", "finish"] }, T(9));
  audit(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", to: "0xb4b0", tx: TX(13) }, T(10));
  audit(db, "awx-executor", "credit.deposited", "63825:x:1", { amount: "0.09", currency: "USD", deposit_id: "05090865-c8c8-47aa-9097-599cce294d6f" }, T(11));
  audit(db, "treasury", "agent.decision", "wake.treasury", { agent: "treasury", source: "claude", model: "claude-opus-5-5", summary: "Swept 0.09.", tools: ["sweep_earnings", "finish"] }, T(11));
  audit(db, "awx-executor", "transfer.created", "6b7ebec3-e3c7-4281-aa5b-cde80916c91e", { amount: "EUR 240.00", approval_sha256: "b".repeat(64), status: "SCHEDULED" }, T(12));
  audit(db, "awx-executor", "transfer.status", "6b7ebec3-e3c7-4281-aa5b-cde80916c91e", { status: "PAID" }, T(13));
  audit(db, "sourcing", "card.charge_declined", "awx-tx-9", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", reason: "LIMIT_EXCEEDED", source: "poll" }, T(14));
  audit(db, "sourcing", "card.charge_approved", "awx-tx-10", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", source: "simulation" }, T(16));
  audit(db, "sourcing", "agent.decision", "wake.sourcing", { agent: "sourcing", source: "fallback", model: null, summary: "kept the buy policy", tools: [] }, T(17));
  return db;
}

describe("the money flow, from the ledger (D23)", () => {
  it("folds a run of sales into one movement, customer agents to Northwind, in *USDZ on Metal, with the latest tx", () => {
    const f = flowEvents(world());
    expect(f[0]).toMatchObject({ kind: "sale", from: "customer", to: "northwind", amount: "0.15", unit: "*USDZ", rail: "metal", count: 3, proof: { label: expect.stringMatching(/^tx 0xaaaa/), href: `https://testnet.metalntwx.com/tx/${TX(3)}` } });
  });

  it("each later movement in order, with its agent, who decided, its rail and its proof", () => {
    const f = flowEvents(world());
    expect(f.map((e) => [e.kind, e.from, e.to, e.amount, e.unit, e.rail])).toEqual([
      ["sale", "customer", "northwind", "0.15", "*USDZ", "metal"],
      ["upstream", "sourcing", "suppliers", "0.02", "*USDZ", "metal"],
      ["upstream", "sourcing", "suppliers", "0.04", "*USDZ", "purser"],
      ["upstream", "sourcing", "suppliers", "0.04", "*USDZ", "metal"],
      ["refund", "support", "customer", "0.05", "*USDZ", "metal"],
      ["sweep", "treasury", "airwallex", "0.09", "*USDZ", "metal"],
      ["booked", "treasury", "airwallex", "0.09", "USD", "airwallex_deposit"],
      ["licence", "treasury", "payee", "240.00", "EUR", "airwallex_swift"],
      ["card", "sourcing", "merchant", "45.00", "EUR", "airwallex_card"],
      ["card", "sourcing", "merchant", "45.00", "EUR", "airwallex_card"],
    ]);
  });

  it("credits Claude only where the agent's own Claude decision made the move, naming the model", () => {
    const f = flowEvents(world());
    expect(f.find((e) => e.kind === "refund")).toMatchObject({ agent: "support", model: "claude-sonnet-5-5", decided: "the Support agent (Claude Sonnet) decided" });
    expect(f.find((e) => e.kind === "sweep")).toMatchObject({ model: "claude-opus-5-5" });
    expect(f.find((e) => e.kind === "sale")).toMatchObject({ model: null, decided: "Summit's agent paid (the simulated customer)" });
    // The Sourcing agent's later decision was a fallback by code: no Claude credit for its card charge.
    expect(f.filter((e) => e.kind === "card").every((e) => e.model === null)).toBe(true);
  });

  it("a refusal hits its rail with the reason: Purser before signing, Metal on chain (its tx), Airwallex at the card (its id)", () => {
    const f = flowEvents(world());
    const r = f.filter((e) => e.refused);
    expect(r.map((e) => [e.refused!.by, e.proof.label.split(" ")[0]])).toEqual([["purser", "Purser"], ["metal", "tx"], ["airwallex", "Airwallex"]]);
    expect(r[1]!.refused!.reason).toMatch(/^mandate_cap_exceeded/);
    expect(r[2]).toMatchObject({ refused: { by: "airwallex", reason: "LIMIT_EXCEEDED" }, proof: { label: "Airwallex awx-tx-9", href: null, full: "awx-tx-9" } });
  });

  it("the euro licence is shown once it is PAID at Airwallex, with the transfer id; nothing is shown that the ledger does not hold", () => {
    const f = flowEvents(world());
    expect(f.find((e) => e.kind === "licence")).toMatchObject({ proof: { full: "6b7ebec3-e3c7-4281-aa5b-cde80916c91e" } });
    expect(flowEvents(openDb(":memory:"))).toEqual([]);
  });
});
