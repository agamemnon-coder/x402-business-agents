// D23 + D24: the money flow, from the ledger only. Each movement is a recorded event with its own proof (a Alta tx or
// an Airwallex id), its amount and rail; a refusal hits its rail with the reason. Who decided it is read from the
// origin recorded with the movement when it started (D24), and from nothing else: never from timing, never from a
// decision written nearby. A ledger recorded before origins existed shows only what an explicit record says, marked
// derived. Breaks if anything is invented, or if Claude is credited with a move its own run did not start.
import { describe, expect, it } from "vitest";
import { audit, type Actor } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { flowEvents } from "../src/dashboard/flows.js";
import { AUTO_REFUND, withOrigin, type Origin } from "../src/provenance/origin.js";

const T = (m: number) => new Date(Date.UTC(2026, 10, 5, 10, m, 0));
const TX = (n: number) => `0x${String(n).padStart(64, "a")}`;
const HAIKU: Origin = { actor: "agent", agent: "sourcing", model: "claude-haiku-5-5", request_id: "req_h1", run_id: "run-sourcing-1-aaaaaa" };
const SONNET: Origin = { actor: "agent", agent: "support", model: "claude-sonnet-5-5", request_id: "req_s1", run_id: "run-support-2-bbbbbb" };
const OPUS: Origin = { actor: "agent", agent: "treasury", model: "claude-opus-5-5", request_id: "req_o1", run_id: "run-treasury-3-cccccc" };
const CFO: Origin = { actor: "cfo", proposal_id: "P-7", approval_id: "4", method: "passkey", approver: "max" };
const CUSTOMER: Origin = { actor: "external", party: "customer" };
const BUY_POLICY: Origin = { actor: "code", rule: "the Sourcing agent's buy policy", agent: "sourcing", set_by: HAIKU };

const fresh = () => { const db = openDb(":memory:"); db.exec("PRAGMA foreign_keys = OFF"); return db; };
function sale(db: DB, id: number, m: number, seq = id) {
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, tx_hash) VALUES (?, '/v1/stock', 5, '0xc', 'u', ?, 'DELIVERED', ?, ?)").run(id, JSON.stringify({ seq }), T(m).toISOString(), TX(id));
}
const at = (o: Origin | null, f: () => void) => (o ? withOrigin(o, f) : f());
const log = (db: DB, o: Origin | null, actor: Actor, event: string, subject: string, payload: Record<string, unknown>, m: number) => at(o, () => audit(db, actor, event, subject, payload as never, T(m)));
/** A row as a ledger from before D24 holds it: no origin field at all. */
function legacyRow(db: DB, actor: string, event: string, subject: string, payload: Record<string, unknown>, m: number) {
  const seq = ((db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n) + 1;
  db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, 'x', ?)").run(seq, T(m).toISOString(), actor, event, subject, JSON.stringify(payload), `h${seq}`);
}

/** A run with origins recorded: what Thursday's ledger looks like. */
function world(): DB {
  const db = fresh();
  for (const [id, m] of [[1, 1], [2, 2], [3, 3]] as const) {
    sale(db, id, m);
    log(db, null, "system", "sale.delivered", String(id), { tx: TX(id), origin: CUSTOMER }, m);
  }
  log(db, BUY_POLICY, "sourcing", "upstream.paid", "1", { amount_units: "20000000000000000", seq: 1, supplier: "stockline", tx: TX(10) }, 4);
  log(db, BUY_POLICY, "sourcing", "upstream.refused", "4", { reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", refused_by: "purser", seq: 4, supplier: "stockline" }, 5);
  log(db, BUY_POLICY, "sourcing", "upstream.refused_on_chain", "4", { amount: "0.04", metal_reason: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)", seq: 4, tx: TX(11) }, 6);
  sale(db, 7, 0);
  log(db, SONNET, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7", to: "0xA5A1", tx: TX(12) }, 8);
  log(db, OPUS, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", to: "0xb4b0", tx: TX(13) }, 10);
  log(db, { actor: "code", rule: "book the sweep at Airwallex after Alta's finality", agent: "treasury", set_by: OPUS }, "awx-executor", "credit.deposited", "63825:x:1", { amount: "0.09", currency: "USD", deposit_id: "05090865-c8c8-47aa-9097-599cce294d6f" }, 11);
  log(db, CFO, "awx-executor", "transfer.created", "6b7ebec3-e3c7-4281-aa5b-cde80916c91e", { amount: "EUR 240.00", approval_sha256: "b".repeat(64), status: "SCHEDULED" }, 12);
  audit(db, "awx-executor", "transfer.status", "6b7ebec3-e3c7-4281-aa5b-cde80916c91e", { status: "PAID" }, T(13));
  log(db, null, "sourcing", "card.charge_declined", "awx-tx-9", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", reason: "LIMIT_EXCEEDED", source: "poll", origin: { actor: "external", party: "merchant", name: "Packwise" } }, 14);
  log(db, HAIKU, "sourcing", "card.charge_approved", "awx-tx-10", { agent: "sourcing", amount: "45.00", currency: "EUR", last4: "6423", merchant: "Packwise", source: "simulation" }, 16);
  return db;
}

describe("the money flow, from the ledger", () => {
  it("folds a run of sales into one movement, customer agents to Northwind, in *USDZ on Alta, with the latest tx", () => {
    const f = flowEvents(world());
    expect(f[0]).toMatchObject({ kind: "sale", from: "customer", to: "northwind", amount: "0.15", unit: "*USDZ", rail: "metal", count: 3, proof: { label: expect.stringMatching(/^tx 0xaaaa/), href: `https://testnet.metalntwx.com/tx/${TX(3)}` } });
  });

  it("each later movement in order, with its agent, its rail and its proof", () => {
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

  it("a refusal hits its rail with the reason: Purser before signing, Alta on chain (its tx), Airwallex at the card (its id)", () => {
    const r = flowEvents(world()).filter((e) => e.refused);
    expect(r.map((e) => [e.refused!.by, e.proof.label.split(" ")[0]])).toEqual([["purser", "Purser"], ["metal", "tx"], ["airwallex", "Airwallex"]]);
    expect(r[1]!.refused!.reason).toMatch(/^mandate_cap_exceeded/);
    expect(r[2]).toMatchObject({ refused: { by: "airwallex", reason: "LIMIT_EXCEEDED" }, proof: { label: "Airwallex awx-tx-9", href: null, full: "awx-tx-9" } });
  });

  it("nothing is shown that the ledger does not hold", () => {
    expect(flowEvents(openDb(":memory:"))).toEqual([]);
  });
});

describe("who decided: the origin recorded with the movement (D24)", () => {
  it("an agent's own Claude run: the agent and its model", () => {
    const f = flowEvents(world());
    expect(f.find((e) => e.kind === "refund")).toMatchObject({ model: "claude-sonnet-5-5", decided: "the Support agent (Claude Sonnet) decided" });
    expect(f.find((e) => e.kind === "sweep")).toMatchObject({ model: "claude-opus-5-5", decided: "the Treasury agent (Claude Opus) decided" });
    expect(f.find((e) => e.kind === "card" && !e.refused)).toMatchObject({ model: "claude-haiku-5-5" });
    expect(f.every((e) => !e.derived)).toBe(true);
  });

  it("code following a rule, and the decision it follows; the customer, the merchant and the CFO by name", () => {
    const f = flowEvents(world());
    expect(f[1]).toMatchObject({ model: null, decided: "code: the Sourcing agent's buy policy, as the Sourcing agent (Claude Haiku) set it" });
    expect(f[0]).toMatchObject({ model: null, decided: "Summit's agent paid (the simulated customer)" });
    expect(f.find((e) => e.kind === "booked")).toMatchObject({ model: null, decided: "code: book the sweep at Airwallex after Alta's finality, as the Treasury agent (Claude Opus) set it" });
    expect(f.find((e) => e.kind === "card" && e.refused)).toMatchObject({ model: null, decided: "Packwise charged the card" });
    expect(f.find((e) => e.kind === "licence")).toMatchObject({ model: null, decided: "the CFO approved it with Face ID", proof: { full: "6b7ebec3-e3c7-4281-aa5b-cde80916c91e" } });
  });

  it("code's automatic refund is code's, whatever ran around it", () => {
    const db = fresh();
    sale(db, 7, 0);
    log(db, SONNET, "support", "noop", "x", {}, 1);
    withOrigin(SONNET, () => log(db, AUTO_REFUND, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7", tx: TX(1) }, 2));
    expect(flowEvents(db)[0]).toMatchObject({ model: null, decided: "code: refund within the CFO's automatic limits" });
  });

  it("four eyes names the controller too", () => {
    const db = fresh();
    log(db, { ...CFO, cosigner: "test-controller" } as Origin, "awx-executor", "transfer.created", "tr-1", { amount: "EUR 99.00" }, 1);
    audit(db, "awx-executor", "transfer.status", "tr-1", { status: "PAID" }, T(2));
    expect(flowEvents(db)[0]!.decided).toBe("two people approved it, each with their own Face ID (four eyes)");
  });

  it("the euro invoice names the Treasury agent's plan when its advice on the same proposal is linked", () => {
    const db = fresh();
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-7', 'invoice_payment', '{}', ?, 'treasury', 'EXECUTED', 'z', 'z')").run("c".repeat(64));
    audit(db, "treasury", "licence.timing_advised", "P-7", { proposal_id: "P-7", source: "claude", model: "claude-opus-5-5" }, T(0));
    log(db, CFO, "awx-executor", "transfer.created", "tr-1", { amount: "EUR 240.00", approval_sha256: "c".repeat(64) }, 1);
    audit(db, "awx-executor", "transfer.status", "tr-1", { status: "PAID" }, T(2));
    expect(flowEvents(db)[0]).toMatchObject({ model: "claude-opus-5-5", decided: "planned by the Treasury agent (Claude Opus), the CFO approved it with Face ID" });
  });

  it("a movement whose origin is missing says so: it is an error, never filled in from timing or a decision nearby", () => {
    const db = world();
    // A Claude decision recorded right after, using the very tool: it changes nothing.
    audit(db, "treasury", "agent.decision", "wake.treasury", { source: "claude", model: "claude-opus-5-5", tools: ["sweep_earnings"] }, T(20));
    log(db, null, "treasury", "sweep.paid", "sweep-2", { amount: "0.30", tx: TX(30) }, 19);
    expect(flowEvents(db).at(-1)).toMatchObject({ kind: "sweep", model: null, decided: "who decided is not recorded" });
  });

  it("a single-use card the CFO approved for an agent says who asked", () => {
    const db = fresh();
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-5', 'task_card', ?, 'y', 'treasury', 'EXECUTED', 'z', 'z')").run(JSON.stringify({ asked_by: "agent:sourcing" }));
    log(db, { ...CFO, proposal_id: "P-5" }, "treasury", "card.charge_approved", "awx-3", { agent: "task:P-5", amount: "9.00", currency: "EUR", last4: "1111", merchant: "Datalake", source: "webhook" }, 1);
    expect(flowEvents(db)[0]!.decided).toBe("the CFO approved it with Face ID, asked for by the Sourcing agent");
  });

  it("a retailer's bank payment comes from the retailer, by name, and says what code did with it", () => {
    const db = fresh();
    log(db, null, "treasury", "receivable.escalated", "dep-1", { amount: "1000.00", currency: "EUR", invoice_no: "NW-R-201", origin: { actor: "external", party: "retailer", name: "Alpenweg Sport AG" } }, 0);
    expect(flowEvents(db)[0]).toMatchObject({ kind: "deposit", from: "retailer", agent: null, decided: "Alpenweg Sport AG paid (a retailer); code held it for the CFO" });
  });
});

describe("a ledger recorded before origins existed (the 30 October run, dry-105)", () => {
  function old(): DB {
    const db = fresh();
    sale(db, 7, 0);
    legacyRow(db, "support", "agent.run", "wake.support", { status: "done", model: "claude-sonnet-5-5", tools: ["refund"], from_seq: 0 }, 1);
    legacyRow(db, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7", tx: TX(1) }, 2);
    legacyRow(db, "support", "agent.decision", "wake.support", { source: "claude", model: "claude-sonnet-5-5", tools: ["refund"] }, 3);
    legacyRow(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", tx: TX(2) }, 4);
    return db;
  }

  it("credits no Claude model at all: the runs and decisions nearby are not evidence, and each movement is marked derived", () => {
    const f = flowEvents(old());
    expect(f.map((e) => [e.kind, e.model, e.decided, e.derived])).toEqual([
      ["refund", null, "who decided is not recorded", true],
      ["sweep", null, "who decided is not recorded", true],
    ]);
  });

  it("an explicit record still says who: the automatic-limit row (code), an executed batch (the CFO)", () => {
    const db = fresh();
    sale(db, 7, 0); sale(db, 8, 0);
    legacyRow(db, "support", "refund.auto_approved", "DD-1", { sales: ["7"] }, 1);
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-9', 'refund_batch', '{}', 'x', 'support', 'EXECUTED', 'z', 'z')").run();
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, proposal_id) VALUES (8, 'refund-8', 5, '0xA5A1', 'PAID', 'P-9')").run();
    legacyRow(db, "support", "refund.paid", "7", { amount: "0.05", payment_id: "refund-7", tx: TX(1) }, 2);
    legacyRow(db, "support", "refund.paid", "8", { amount: "0.05", payment_id: "refund-8", tx: TX(2) }, 3);
    expect(flowEvents(db).map((e) => e.decided)).toEqual(["code refunded it, within the CFO's automatic limits", "refunded after the CFO's Face ID"]);
  });

  it("a ledger with no agents at all swept by code", () => {
    const db = fresh();
    legacyRow(db, "treasury", "sweep.paid", "sweep-1", { amount: "0.09", tx: TX(2) }, 1);
    expect(flowEvents(db)[0]).toMatchObject({ decided: "code swept the net earnings", derived: true });
  });

  it("an older refusal row with a bare code was Alta's facilitator (no tx); its amount, not recorded, is not made up", () => {
    const db = fresh();
    legacyRow(db, "sourcing", "upstream.refused", "41", { reason: "mandate_cap_exceeded", seq: 41 }, 1);
    expect(flowEvents(db)).toEqual([expect.objectContaining({ rail: "metal", amount: "", refused: { by: "metal", reason: "mandate_cap_exceeded" }, proof: expect.objectContaining({ href: null, label: expect.stringMatching(/^Alta's facilitator refused it/) }) })]);
  });
});

describe("movements shown for what they are", () => {
  it("a refund or a sweep Purser refused before signing hits Purser, with its reason and no transaction", () => {
    const db = fresh();
    log(db, AUTO_REFUND, "support", "refund.refused", "7", { payment_id: "refund-7", amount: "0.05", to: "0xA5A1", tx: null, reason: "budget: the support mandate has 0.00 left" }, 1);
    log(db, OPUS, "treasury", "sweep.refused", "sweep-2", { amount: "0.40", to: "0xb4b0", tx: null, reason: "velocity: 3 sweeps in an hour" }, 2);
    expect(flowEvents(db)).toEqual([
      expect.objectContaining({ kind: "refund", agent: "support", amount: "0.05", rail: "purser", refused: { by: "purser", reason: "budget: the support mandate has 0.00 left" }, proof: expect.objectContaining({ href: null, label: "Purser refused it before signing" }) }),
      expect.objectContaining({ kind: "sweep", agent: "treasury", amount: "0.40", rail: "purser", model: "claude-opus-5-5", refused: { by: "purser", reason: "velocity: 3 sweeps in an hour" } }),
    ]);
  });

  it("a sale settled through clearing is told apart from a per-request Alta payment, without a tx it does not have", () => {
    const db = fresh();
    sale(db, 1, 0);
    log(db, null, "system", "sale.delivered", "1", { settlement_id: "s-1", scheme: "bajillion", body_sha256: "x", origin: CUSTOMER }, 0);
    expect(flowEvents(db)[0]).toMatchObject({ kind: "sale", what: "stock checks sold, settled later by clearing", proof: { label: "settled later in a clearing batch on Alta", href: null } });
  });

  it("a row without its amount or currency is left out, not shown as 0.00 or as euros", () => {
    const db = fresh();
    log(db, OPUS, "treasury", "sweep.paid", "sweep-1", { to: "0xb4b0", tx: TX(13) }, 0);
    log(db, OPUS, "awx-executor", "credit.deposited", "d-1", { amount: "0.09", deposit_id: "x" }, 1);
    log(db, HAIKU, "sourcing", "card.charge_approved", "awx-tx-10", { agent: "sourcing", currency: "EUR", last4: "6423" }, 2);
    expect(flowEvents(db)).toEqual([]);
  });
});
