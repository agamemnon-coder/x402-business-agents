// The money-flow view (src/dashboard/flows.ts flowEvents): each movement from the ledger's rows with who decided it. A
// ledger from before origins were recorded says only what an explicit record says (the CFO's executed batch, code's
// automatic limits) and marks it derived; a refusal shows who refused and moves nothing; rows without an amount are
// left out rather than shown as zero; runs of sales fold into one movement.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { flowEvents } from "../src/dashboard/flows.js";
import { moneyWorld } from "./fakes/moneyWorld.js";

const at = (n: number) => new Date(Date.parse("2026-11-19T10:00:00Z") + n * 1000);
let db: DB;
let n = 0;
/** A row as a ledger from before origins holds it: no origin field (audit() would add one). */
const row = (actor: string, event: string, subject: string | null, payload: Record<string, unknown>) => {
  const seq = 1000 + n;
  db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, 'x', ?)").run(seq, at(n++).toISOString(), actor, event, subject, JSON.stringify(payload), `h${seq}`);
};

beforeEach(() => {
  db = openDb(":memory:");
  moneyWorld(db);
  n = 0;
});

describe("a ledger recorded before origins existed", () => {
  it("names who decided from the explicit records only, each marked derived", () => {
    row("support", "refund.auto_approved", null, { sales: ["1"] });
    row("support", "refund.paid", "1", { amount: "0.05", payment_id: "refund-1", tx: `0x${"a".repeat(64)}` });
    row("support", "refund.paid", "2", { amount: "0.05", payment_id: "pay-unknown" });
    row("support", "refund.paid", "3", { payment_id: "no-amount" });
    row("treasury", "sweep.paid", "sw-1", { amount: "0.02" });
    const f = flowEvents(db);
    const refunds = f.filter((e) => e.kind === "refund");
    expect(refunds.map((e) => [e.what, e.decided, e.derived])).toEqual([
      ["refund for order #1", "code refunded it, within the CFO's automatic limits", true],
      ["refund for order #2", expect.stringMatching(/not recorded/i), true],
    ]);
    expect(refunds[0]!.proof.full).toBe(`0x${"a".repeat(64)}`);
    expect(refunds[1]!.proof).toEqual({ label: "no tx recorded", href: null, full: null });
    expect(f.find((e) => e.kind === "sweep")).toMatchObject({ decided: "code swept the net earnings", derived: true });
  });

  it("with agents in the ledger, a sweep's decider is not recorded; a refund the CFO's executed batch paid says so", () => {
    row("treasury", "agent.run", null, {});
    row("treasury", "sweep.paid", "sw-1", { amount: "0.02" });
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-9', 'refund_batch', '{}', ?, 'support', 'EXECUTED', '2026-11-20', '2026-11-19')").run("c".repeat(64));
    db.prepare("UPDATE refunds SET proposal_id = 'P-9' WHERE payment_id = 'pay-r1'").run();
    row("support", "refund.paid", "1", { amount: "0.05", payment_id: "pay-r1" });
    const f = flowEvents(db);
    expect(f.find((e) => e.kind === "sweep")!.decided).toMatch(/not recorded/i);
    expect(f.find((e) => e.kind === "refund")!.decided).toBe("refunded after the CFO's Face ID");
  });
});

describe("refusals and rows that say too little", () => {
  it("a mandate refusal by Alta or by Purser, never a supplier's absence; the same on chain; a refused refund or sweep", () => {
    row("sourcing", "upstream.refused", "4", { reason: "supplier_unavailable: 503" });
    row("sourcing", "upstream.refused", "5", { reason: "mandate_cap_exceeded" });
    row("sourcing", "upstream.refused", "6", { reason: "mandate_cap_exceeded: 0.04 is over the 0.03 cap", supplier: "ridgeline" });
    row("sourcing", "upstream.refused_on_chain", "6", { amount: "0.04", tx: `0x${"b".repeat(64)}` });
    row("support", "refund.refused", "7", { amount: "0.05", reason: "velocity" });
    row("treasury", "sweep.refused", "sw-2", { amount: "0.10" });
    row("support", "refund.refused", "8", {});
    const f = flowEvents(db);
    const up = f.filter((e) => e.kind === "upstream");
    expect(up.map((e) => [e.rail, e.refused?.by, e.amount, e.what])).toEqual([
      ["metal", "metal", "", "Stockline"],
      ["purser", "purser", "0.04", "Ridgeline Data"],
      ["metal", "metal", "0.04", "Stockline"],
    ]);
    expect(up[0]!.proof.label).toMatch(/a 402: nothing moves/);
    expect(up[2]!.refused!.reason).toBe("refused against the mandate");
    expect(f.find((e) => e.kind === "refund")).toMatchObject({ rail: "purser", what: "refund of sale 7", refused: { by: "purser", reason: "velocity" } });
    expect(f.find((e) => e.kind === "sweep")).toMatchObject({ to: "airwallex", what: "net earnings to the sweep wallet", refused: { reason: "refused" } });
    expect(f.filter((e) => e.kind === "refund")).toHaveLength(1);
  });

  it("a sale, purchase, credit, card charge or deposit without its amount is left out", () => {
    row("system", "sale.delivered", "999", {});
    row("sourcing", "upstream.paid", "1", {});
    row("treasury", "credit.deposited", null, { amount: "1.00" });
    row("support", "card.charge_approved", "ctx_9", { amount: "5.00" });
    row("system", "receivable.matched", "dep_1", { currency: "EUR" });
    row("treasury", "transfer.status", "tr_unknown", { status: "PAID" });
    row("treasury", "transfer.status", "tr_1", { status: "PROCESSING" });
    expect(flowEvents(db)).toEqual([]);
  });
});

describe("movements in", () => {
  it("sales in a row fold into one movement with the latest proof; a clearing sale settles later", () => {
    row("system", "sale.delivered", "1", { tx: `0x${"1".repeat(64)}` });
    row("system", "sale.delivered", "1", { tx: `0x${"2".repeat(64)}` });
    row("system", "sale.delivered", "2", { scheme: "bajillion" });
    const f = flowEvents(db);
    expect(f[0]).toMatchObject({ kind: "sale", count: 2, amount: "0.10", proof: { full: `0x${"2".repeat(64)}` } });
    expect(f[1]).toMatchObject({ what: "stock checks sold, settled later by clearing", proof: { label: "settled later in a clearing batch on Alta" } });
  });

  it("a retailer's payment matched to its invoice, or held for the CFO without one", () => {
    row("system", "receivable.matched", "dep_1", { amount: "500.00", currency: "EUR", invoice_no: "NW-1" });
    row("system", "receivable.escalated", "dep_2", { amount: "9.00", currency: "GBP" });
    const f = flowEvents(db);
    expect(f.map((e) => [e.what, e.decided])).toEqual([
      ["invoice NW-1", "a retailer paid; code matched it to its invoice"],
      ["a payment with no invoice", "a retailer paid; code held it for the CFO"],
    ]);
  });
});

describe("card charges", () => {
  it("a single-use task card names the agent that asked; a sandbox simulation and a decline say so", () => {
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-7', 'task_card', ?, ?, 'treasury', 'EXECUTED', '2026-11-20', '2026-11-19')").run(JSON.stringify({ asked_by: "agent:sourcing" }), "d".repeat(64));
    row("system", "card.charge_approved", "ctx_a", { agent: "task:P-7", amount: "120.00", currency: "EUR", merchant: "NS", last4: "1111" });
    row("support", "card.charge_approved", "ctx_b", { amount: "9.00", currency: "EUR", source: "simulation" });
    row("support", "card.charge_declined", "ctx_c", { amount: "99.00", currency: "EUR", merchant: "Casino", last4: "4242", reason: "MCC" });
    const f = flowEvents(db);
    expect(f[0]).toMatchObject({ from: "sourcing", decided: "a single-use card the CFO approved, asked for by the Sourcing agent", what: "NS on card ····1111" });
    expect(f[1]).toMatchObject({ from: "support", decided: "a test charge the Airwallex sandbox simulated", what: "a merchant on card ····?" });
    expect(f[2]).toMatchObject({ refused: { by: "airwallex", reason: "MCC" }, proof: { full: "ctx_c" } });
  });
});

describe("the euro invoice by SWIFT", () => {
  it("planned by the Treasury agent's advice before origins; by code's rule, an agent or the CFO's command when the proposal recorded it", () => {
    const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-1'").get() as { terms_sha256: string }).terms_sha256;
    row("treasury", "licence.timing_advised", "P-1", { proposal_id: "P-1", source: "claude", model: "claude-opus-5-5" });
    row("treasury", "transfer.created", "tr_1", { amount: "EUR 100.00", approval_sha256: sha });
    row("awx-executor", "transfer.status", "tr_1", { status: "PAID" });
    const first = flowEvents(db).find((e) => e.kind === "licence")!;
    expect(first).toMatchObject({ amount: "100.00", unit: "EUR", model: "claude-opus-5-5", what: "the euro invoice, by SWIFT" });
    expect(first.decided).toMatch(/^planned by the Treasury agent \(Claude Opus\), /);

    for (const [origin, words] of [
      [{ actor: "code", rule: "pay the licence on its due day" }, /^planned by code \(pay the licence on its due day\), .*; the Treasury agent \(Claude Opus\) advised on its timing$/],
      [{ actor: "cfo-command", command: "npm run licence", moves_money: false }, /^payment started by the CFO \(npm run licence\), /],
      [{ actor: "agent", agent: "treasury", model: "claude-sonnet-5-5", request_id: null, run_id: "r1" }, /^planned by the Treasury agent \(Claude Sonnet\), /],
      [{ actor: "nobody knows" }, /^who planned it is not recorded, /],
    ] as const) {
      db = openDb(":memory:");
      moneyWorld(db);
      n = 0;
      row("treasury", "proposal.created", "P-1", { kind: "invoice_payment", origin });
      row("treasury", "licence.timing_advised", "P-1", { proposal_id: "P-1", source: "claude", model: "claude-opus-5-5" });
      row("treasury", "transfer.created", "tr_1", { amount: "EUR 100.00", approval_sha256: sha });
      row("awx-executor", "transfer.status", "tr_1", { status: "PAID" });
      expect(flowEvents(db).find((e) => e.kind === "licence")!.decided).toMatch(words);
    }
  });
});
