// D23: the money flow, from the ledger only. Each movement is a recorded event with its own proof (a Metal tx or an
// Airwallex id), who moved it, who decided (the agent's own Claude run, the CFO's Face ID, or code following a policy),
// the amount and its rail. A refusal hits its rail with the reason. Breaks if anything is invented, if a stablecoin
// payment is not marked as *USDZ on Metal, or if a decision is credited to Claude that Claude did not make.
//
// How a Claude decision is found: an agent's run (`agent.run`, written when it ends) records `from_seq`, the last log
// row before it started; a movement whose row falls between the two happened during that run. It is Claude's only if
// the run finished ("done", with a model), used the tool behind the movement without every call of it being blocked,
// and the agent's decision recorded after the run says Claude made it (not a fallback by code).
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { audit, type Actor } from "../src/audit/log.js";
import { flowEvents } from "../src/dashboard/flows.js";

const T = (m: number) => new Date(Date.UTC(2026, 10, 5, 10, m, 0));
const TX = (n: number) => `0x${String(n).padStart(64, "a")}`;
const seqNow = (db: DB) => (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
/** An agent's run around `inside`, as runAgent records it: from_seq before, the agent.run row after. */
function run(db: DB, agent: Actor, model: string | null, tools: string[], inside: () => void, opts: { status?: string; blocked?: string[]; at?: number } = {}) {
  const from = seqNow(db);
  inside();
  audit(db, agent, "agent.run", `wake.${agent}`, { agent, model, status: opts.status ?? "done", tools, blocked: opts.blocked ?? [], from_seq: from }, T(opts.at ?? 30));
}
const decision = (db: DB, agent: Actor, source: "claude" | "fallback", model: string | null, tools: string[], m = 30) =>
  audit(db, agent, "agent.decision", `wake.${agent}`, { agent, source, model, summary: "", tools }, T(m));
function sale(db: DB, id: number, m: number, seq = id) {
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, tx_hash) VALUES (?, '/v1/stock', 5, '0xc', 'u', ?, 'DELIVERED', ?, ?)").run(id, JSON.stringify({ seq }), T(m).toISOString(), TX(id));
}
function refundRow(db: DB, saleId: number, proposal: string | null) {
  db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, proposal_id) VALUES (?, ?, 5, '0xA5A1', 'PAID', ?)").run(saleId, `refund-${saleId}`, proposal);
}
const paidRefund = (db: DB, saleId: number, m: number) => audit(db, "support", "refund.paid", String(saleId), { amount: "0.05", payment_id: `refund-${saleId}`, to: "0xA5A1", tx: TX(100 + saleId) }, T(m));
const fresh = () => { const db = openDb(":memory:"); db.exec("PRAGMA foreign_keys = OFF"); return db; };

function world(): DB {
  const db = fresh();
  for (const [id, m] of [[1, 1], [2, 2], [3, 3]] as const) {
    sale(db, id, m);
    audit(db, "system", "sale.delivered", String(id), { tx: TX(id) }, T(m));
  }
  audit(db, "sourcing", "upstream.paid", "1", { amount_units: "20000000000000000", seq: 1, supplier: "stockline", tx: TX(10) }, T(4));
  audit(db, "sourcing", "upstream.refused", "4", { reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", refused_by: "purser", seq: 4, supplier: "stockline" }, T(5));
  audit(db, "sourcing", "upstream.refused_on_chain", "4", { amount: "0.04", metal_reason: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)", seq: 4, tx: TX(11) }, T(6));
  // The Support agent's own Claude run refunds #7 (sale 7), and its settlement says Claude settled it.
  sale(db, 7, 0);
  run(db, "support", "claude-sonnet-5-5", ["verify_order", "check_data", "refund"], () => { refundRow(db, 7, null); paidRefund(db, 7, 8); });
  audit(db, "support", "dispute.settled_by_agent", "DD-1", { source: "claude", model: "claude-sonnet-5-5", refunded: ["#7"], refunded_now: ["#7"] }, T(9));
  // The Treasury agent's Claude wake sweeps; the Airwallex deposit follows.
  run(db, "treasury", "claude-opus-5-5", ["sweep_earnings", "finish"], () => audit(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", to: "0xb4b0", tx: TX(13) }, T(10)));
  decision(db, "treasury", "claude", "claude-opus-5-5", ["sweep_earnings", "finish"], 9);
  audit(db, "awx-executor", "credit.deposited", "63825:x:1", { amount: "0.09", currency: "USD", deposit_id: "05090865-c8c8-47aa-9097-599cce294d6f" }, T(11));
  audit(db, "awx-executor", "transfer.created", "6b7ebec3-e3c7-4281-aa5b-cde80916c91e", { amount: "EUR 240.00", approval_sha256: "b".repeat(64), status: "SCHEDULED" }, T(12));
  audit(db, "awx-executor", "transfer.status", "6b7ebec3-e3c7-4281-aa5b-cde80916c91e", { status: "PAID" }, T(13));
  audit(db, "sourcing", "card.charge_declined", "awx-tx-9", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", reason: "LIMIT_EXCEEDED", source: "poll" }, T(14));
  audit(db, "sourcing", "card.charge_approved", "awx-tx-10", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", source: "simulation" }, T(16));
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

  it("credits Claude only where the agent's own Claude run made the move, naming the model", () => {
    const f = flowEvents(world());
    expect(f.find((e) => e.kind === "refund")).toMatchObject({ agent: "support", model: "claude-sonnet-5-5", decided: "the Support agent (Claude Sonnet) decided" });
    expect(f.find((e) => e.kind === "sweep")).toMatchObject({ model: "claude-opus-5-5" });
    expect(f.find((e) => e.kind === "sale")).toMatchObject({ model: null, decided: "Summit's agent paid (the simulated customer)" });
    expect(f.filter((e) => e.kind === "card").every((e) => e.model === null)).toBe(true);
    expect(f.find((e) => e.kind === "card" && !e.refused)!.decided).toBe("a test charge the Airwallex sandbox simulated");
  });

  it("a refusal hits its rail with the reason: Purser before signing, Metal on chain (its tx), Airwallex at the card (its id)", () => {
    const f = flowEvents(world());
    const r = f.filter((e) => e.refused);
    expect(r.map((e) => [e.refused!.by, e.proof.label.split(" ")[0]])).toEqual([["purser", "Purser"], ["metal", "tx"], ["airwallex", "Airwallex"]]);
    expect(r[1]!.refused!.reason).toMatch(/^mandate_cap_exceeded/);
    expect(r[2]).toMatchObject({ refused: { by: "airwallex", reason: "LIMIT_EXCEEDED" }, proof: { label: "Airwallex awx-tx-9", href: null, full: "awx-tx-9" } });
  });

  it("an older refusal row with a bare code was Metal's facilitator (no tx); its amount, not recorded, is not made up", () => {
    const db = openDb(":memory:");
    audit(db, "sourcing", "upstream.refused", "41", { reason: "mandate_cap_exceeded", seq: 41 }, T(1));
    expect(flowEvents(db)).toEqual([expect.objectContaining({ rail: "metal", amount: "", refused: { by: "metal", reason: "mandate_cap_exceeded" }, proof: expect.objectContaining({ href: null, label: expect.stringMatching(/^Metal's facilitator refused it/) }) })]);
  });

  it("the euro licence is shown once it is PAID at Airwallex, with the transfer id; nothing is shown that the ledger does not hold", () => {
    const f = flowEvents(world());
    expect(f.find((e) => e.kind === "licence")).toMatchObject({ model: null, decided: "paid after the CFO's Face ID", proof: { full: "6b7ebec3-e3c7-4281-aa5b-cde80916c91e" } });
    expect(flowEvents(openDb(":memory:"))).toEqual([]);
  });
});

describe("who decided a refund, from the evidence in the ledger", () => {
  it("code within the automatic limits (the Dispute desk's own record), not the CFO", () => {
    const db = fresh();
    sale(db, 7, 0);
    audit(db, "support", "refund.auto_approved", "DD-1", { sales: ["7"], rule: "each <= limit and batch <= limit" }, T(1));
    refundRow(db, 7, null); paidRefund(db, 7, 2);
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "code refunded it, within the CFO's automatic limits" });
  });

  it("the CFO's Face ID when the refund ran from an executed refund batch", () => {
    const db = fresh();
    sale(db, 7, 0);
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-9', 'refund_batch', '{}', 'x', 'support', 'EXECUTED', 'z', 'z')").run();
    refundRow(db, 7, "P-9"); paidRefund(db, 7, 2);
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "refunded after the CFO's Face ID" });
  });

  it("says so when the ledger records no decision, instead of naming one", () => {
    const db = fresh();
    sale(db, 7, 0); refundRow(db, 7, null); paidRefund(db, 7, 2);
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "who decided is not recorded" });
  });

  it("an earlier refund a later settlement carries over is not the agent's: only the refunds of its own run count", () => {
    const db = fresh();
    sale(db, 7, 0);
    audit(db, "support", "refund.auto_approved", "DD-1", { sales: ["7"] }, T(1));
    refundRow(db, 7, null); paidRefund(db, 7, 2);
    run(db, "support", "claude-sonnet-5-5", ["verify_order", "refund"], () => undefined, { blocked: ["refund: already refunded"] });
    audit(db, "support", "dispute.settled_by_agent", "DD-1", { source: "claude", model: "claude-sonnet-5-5", refunded: ["#7"], refunded_now: [] }, T(5));
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "code refunded it, within the CFO's automatic limits" });
  });

  it("a refund made during the agent's run that ended in a fallback by code is not credited to Claude", () => {
    const db = fresh();
    sale(db, 7, 0);
    run(db, "support", "claude-sonnet-5-5", ["refund"], () => { refundRow(db, 7, null); paidRefund(db, 7, 2); });
    audit(db, "support", "dispute.settled_by_agent", "DD-1", { source: "fallback", model: "claude-sonnet-5-5", refunded: ["#7"], refunded_now: ["#7"] }, T(5));
    expect(flowEvents(db)[0]!.model).toBeNull();
  });
});

describe("a decision that came after the move did not make it", () => {
  it("code swept, then a Claude wake tried to sweep and was blocked: code swept it", () => {
    const db = fresh();
    audit(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", to: "0xb4b0", tx: TX(13) }, T(0));
    run(db, "treasury", "claude-opus-5-5", ["sweep_earnings"], () => undefined, { blocked: ["sweep_earnings: Not again"] });
    decision(db, "treasury", "claude", "claude-opus-5-5", ["sweep_earnings"], 2);
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "code swept the net earnings" });
  });

  it("a sweep inside a wake that fell back to code is not credited to the next Claude wake", () => {
    const db = fresh();
    run(db, "treasury", null, [], () => audit(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", to: "0xb4b0", tx: TX(13) }, T(0)), { status: "unavailable" });
    decision(db, "treasury", "fallback", null, [], 0);
    run(db, "treasury", "claude-opus-5-5", ["sweep_earnings"], () => undefined);
    decision(db, "treasury", "claude", "claude-opus-5-5", ["sweep_earnings"], 3);
    expect(flowEvents(db)[0]!.model).toBeNull();
  });

  it("a merchant's own charge, declined, before the agent woke on the news, is not the agent's decision", () => {
    const db = fresh();
    audit(db, "sourcing", "card.charge_declined", "awx-tx-9", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", reason: "LIMIT_EXCEEDED", source: "poll" }, T(0));
    run(db, "sourcing", "claude-haiku-5-5", ["buy_software"], () => undefined);
    decision(db, "sourcing", "claude", "claude-haiku-5-5", ["buy_software"], 1);
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "a charge on the agent's card" });
  });

  it("the agent's own card purchase inside its Claude wake is the agent's", () => {
    const db = fresh();
    run(db, "sourcing", "claude-haiku-5-5", ["buy_software"], () => audit(db, "sourcing", "card.charge_approved", "awx-tx-10", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", source: "webhook" }, T(1)));
    decision(db, "sourcing", "claude", "claude-haiku-5-5", ["buy_software"], 0);
    expect(flowEvents(db)[0]).toMatchObject({ model: "claude-haiku-5-5", decided: "the Sourcing agent (Claude Haiku) decided" });
  });

  it("the euro licence names the Treasury agent's plan only for the same proposal, by Claude", () => {
    const db = fresh();
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-2', 'invoice_payment', '{}', ?, 'treasury', 'EXECUTED', 'z', 'z')").run("c".repeat(64));
    audit(db, "treasury", "licence.timing_advised", "OLD-1", { proposal_id: "P-1", source: "claude", model: "claude-opus-5-5" }, T(0));
    audit(db, "awx-executor", "transfer.created", "tr-1", { amount: "EUR 99.00", approval_sha256: "c".repeat(64) }, T(1));
    audit(db, "awx-executor", "transfer.status", "tr-1", { status: "PAID" }, T(2));
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "paid after the CFO's Face ID" });
    audit(db, "treasury", "licence.timing_advised", "P-2", { proposal_id: "P-2", source: "claude", model: "claude-opus-5-5" }, T(3));
    audit(db, "awx-executor", "transfer.status", "tr-1", { status: "PAID" }, T(4));
    expect(flowEvents(db).at(-1)).toMatchObject({ model: "claude-opus-5-5", decided: "planned by the Treasury agent (Claude Opus), paid after the CFO's Face ID" });
  });
});

describe("movements the first version left out", () => {
  it("a refund or a sweep Purser refused before signing hits Purser, with its reason and no transaction", () => {
    const db = fresh();
    sale(db, 7, 0);
    audit(db, "support", "refund.refused", "7", { payment_id: "refund-7", amount: "0.05", to: "0xA5A1", tx: null, reason: "budget: the support mandate has 0.00 left" }, T(1));
    audit(db, "treasury", "sweep.refused", "sweep-2", { amount: "0.40", to: "0xb4b0", tx: null, reason: "velocity: 3 sweeps in an hour" }, T(2));
    expect(flowEvents(db)).toEqual([
      expect.objectContaining({ kind: "refund", agent: "support", amount: "0.05", rail: "purser", refused: { by: "purser", reason: "budget: the support mandate has 0.00 left" }, proof: expect.objectContaining({ href: null, label: "Purser refused it before signing" }) }),
      expect.objectContaining({ kind: "sweep", agent: "treasury", amount: "0.40", rail: "purser", refused: { by: "purser", reason: "velocity: 3 sweeps in an hour" } }),
    ]);
  });

  it("a sale settled through clearing is told apart from a per-request Metal payment, without a tx it does not have", () => {
    const db = fresh();
    sale(db, 1, 0);
    audit(db, "system", "sale.delivered", "1", { settlement_id: "s-1", scheme: "bajillion", body_sha256: "x" }, T(0));
    expect(flowEvents(db)[0]).toMatchObject({ kind: "sale", what: "stock checks sold, settled later by clearing", proof: { label: "settled later in a clearing batch on Metal", href: null } });
  });
});

describe("nothing made up", () => {
  it("a retailer's bank payment comes from the retailer, not from Summit's agent", () => {
    const db = fresh();
    audit(db, "awx-executor", "receivable.matched", "dep-1", { amount: "1000.00", currency: "EUR", invoice_no: "NW-R-201" }, T(0));
    expect(flowEvents(db)[0]).toMatchObject({ kind: "deposit", from: "retailer", to: "airwallex", agent: null });
  });

  it("a row without its amount or currency is left out, not shown as 0.00 or as euros", () => {
    const db = fresh();
    audit(db, "treasury", "sweep.paid", "sweep-1", { to: "0xb4b0", tx: TX(13) }, T(0));
    audit(db, "awx-executor", "credit.deposited", "d-1", { amount: "0.09", deposit_id: "x" }, T(1));
    audit(db, "sourcing", "card.charge_approved", "awx-tx-10", { agent: "sourcing", currency: "EUR", last4: "6423" }, T(2));
    expect(flowEvents(db)).toEqual([]);
  });
});
