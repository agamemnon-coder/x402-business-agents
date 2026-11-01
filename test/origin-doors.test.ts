// D24: the doors where an origin is set. A money action records who decided it when it starts: an approved proposal
// the CFO's approval (and the cosigner with four eyes); code's own automatic refunds their rule, even when an agent
// started the code around them; a card charge the purchase it answers, or the merchant charging the card by itself.
import { describe, expect, it } from "vitest";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { openDb, type DB } from "../src/db/open.js";
import { approvalOrigin } from "../src/executors/index.js";
import { ingestCardTransaction, setupCards } from "../src/policy/cards.js";
import { AUTO_REFUND, withOrigin, type Origin } from "../src/provenance/origin.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { audit } from "../src/audit/log.js";

const now = new Date("2026-11-05T10:00:00Z");
const AGENT: Origin = { actor: "agent", agent: "sourcing", model: "claude-haiku-5-5", request_id: "req_7", run_id: "run-sourcing-3-a1b2c3" };
const originOf = (db: DB, event: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { payload_json: string }[])
  .map((r) => (JSON.parse(r.payload_json) as { origin?: unknown }).origin);

describe("an approved proposal: the CFO's approval", () => {
  function proposal(db: DB, id: string) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'refund_batch', '{}', ?, 'support', 'APPROVED', 'z', 'z')").run(id, `sha-${id}`);
  }
  it("names the approval, its method and approver", () => {
    const db = openDb(":memory:");
    proposal(db, "P-1");
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-1', 'APPROVED', 'sha-P-1', 'max', 'passkey', '', 'z')").run();
    expect(approvalOrigin(db, "P-1")).toEqual({ actor: "cfo", proposal_id: "P-1", approval_id: "1", method: "passkey", approver: "max" });
  });

  it("with four eyes, also the person who signed first", () => {
    const db = openDb(":memory:");
    proposal(db, "P-2");
    db.prepare("INSERT INTO cosignatures (proposal_id, credential_id, person, approver, terms_sha256, assertion_sha256, created_at) VALUES ('P-2', 'c1', 'controller', 'dad', 'sha-P-2', 'a', 'y')").run();
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-2', 'APPROVED', 'sha-P-2', 'max', 'passkey', '', 'z')").run();
    expect(approvalOrigin(db, "P-2")).toMatchObject({ approver: "max", cosigner: "dad" });
    // The real shape after four eyes: the stored approver names both, and the first signer is the cosigner.
    db.prepare("UPDATE approvals SET approver = 'dad (controller) + max (cfo)' WHERE proposal_id = 'P-2'").run();
    db.prepare("UPDATE cosignatures SET approver = 'dad (controller)' WHERE proposal_id = 'P-2'").run();
    expect(approvalOrigin(db, "P-2")).toMatchObject({ approver: "dad (controller) + max (cfo)", cosigner: "dad (controller)" });
  });

  it("a rejected or undecided proposal has none, so nothing it could move would be credited to the CFO", () => {
    const db = openDb(":memory:");
    proposal(db, "P-3");
    expect(approvalOrigin(db, "P-3")).toBeNull();
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-3', 'REJECTED', 'sha-P-3', 'max', 'passkey', '', 'z')").run();
    expect(approvalOrigin(db, "P-3")).toBeNull();
  });
});

describe("code's own rule replaces the agent around it", () => {
  it("a refund within the automatic limits, inside an agent's run, is code's", () => {
    const db = openDb(":memory:");
    withOrigin(AGENT, () => withOrigin(AUTO_REFUND, () => audit(db, "support", "refund.paid", "7", { amount: "0.05", tx: "0xa" })));
    expect(originOf(db, "refund.paid")).toEqual([AUTO_REFUND]);
  });
});

describe("a card charge: the purchase it answers, or the merchant", () => {
  it("the agent's own purchase in its run carries the run's origin, and so does Airwallex's answer to it", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    await withOrigin(AGENT, () => buyPlan(db, awx, "packwise-starter", now));
    expect(originOf(db, "card.purchase_started")).toEqual([AGENT]);
    expect(originOf(db, "card.charge_approved")).toEqual([AGENT]);
  });

  it("the same answer arriving later by poll, outside the run, still finds the purchase it answers", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const card = db.prepare("SELECT card_id, last4 FROM cards WHERE agent = 'sourcing'").get() as { card_id: string; last4: string };
    withOrigin(AGENT, () => audit(db, "sourcing", "card.purchase_started", "plan-x", { agent: "sourcing", last4: card.last4, merchant: "Notion", amount: "12.00", currency: "EUR" }, now));
    ingestCardTransaction(db, { transactionId: "t-1", cardId: card.card_id, amountCents: 1200, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Notion", mcc: "5734", type: "AUTHORIZATION", occurredAt: now.toISOString() }, "poll", now);
    expect(originOf(db, "card.charge_approved")).toEqual([AGENT]);
  });

  it("a merchant charging the card by itself (a renewal), even while the agent is awake, is the merchant's", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const card = db.prepare("SELECT card_id FROM cards WHERE agent = 'sourcing'").get() as { card_id: string };
    withOrigin(AGENT, () => ingestCardTransaction(db, { transactionId: "t-2", cardId: card.card_id, amountCents: 4500, currency: "EUR", status: "FAILED", approved: false, failureReason: "LIMIT_EXCEEDED", merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION", occurredAt: now.toISOString() }, "webhook", now));
    expect(originOf(db, "card.charge_declined")).toEqual([{ actor: "external", party: "merchant", name: "Packwise" }]);
  });

  it("one purchase answers one charge: a second charge of the same amount is the merchant's", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    await withOrigin(AGENT, () => buyPlan(db, awx, "packwise-starter", now));
    const first = db.prepare("SELECT amount_cents, card_id FROM card_transactions").get() as { amount_cents: number; card_id: string };
    ingestCardTransaction(db, { transactionId: "t-renew", cardId: first.card_id, amountCents: first.amount_cents, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION", occurredAt: new Date(now.getTime() + 60_000).toISOString() }, "poll", now);
    expect(originOf(db, "card.charge_approved")).toEqual([AGENT, { actor: "external", party: "merchant", name: "Packwise" }]);
  });
});

describe("an action resumed or retried keeps the origin it started with; a new attempt records its own (review 2)", () => {
  const OPUS: Origin = { actor: "agent", agent: "treasury", model: "claude-opus-5-5", request_id: "req_o", run_id: "run-treasury-9-abcdef" };
  const S3: Origin = { actor: "code", rule: "the sweep of net earnings (npm run s3)", agent: "treasury" };
  it("a pending sweep finished later, under another origin, still records the one it started with", async () => {
    const db = openDb(":memory:");
    const pending = async () => ({ outcome: "PENDING" as const, tx: "0xp", reason: null, already: false });
    const paid = async () => ({ outcome: "PAID" as const, tx: "0xp", reason: null, already: false });
    const { executeSweep } = await import("../src/agents/sweep.js");
    await withOrigin(OPUS, () => executeSweep(db, "sweep-9", 30, "0x00000000000000000000000000000000000000aa", pending));
    await withOrigin(S3, () => executeSweep(db, "sweep-9", 30, "0x00000000000000000000000000000000000000aa", paid));
    expect(originOf(db, "sweep.paid")).toEqual([OPUS]);
  });

  it("a refused sweep tried again later is a new attempt: its row and its event carry the new origin", async () => {
    const db = openDb(":memory:");
    const refused = async () => ({ outcome: "REFUSED" as const, tx: null, reason: "x", already: false });
    const paid = async () => ({ outcome: "PAID" as const, tx: "0xq", reason: null, already: false });
    const { executeSweep } = await import("../src/agents/sweep.js");
    await withOrigin(OPUS, () => executeSweep(db, "sweep-8", 30, "0x00000000000000000000000000000000000000aa", refused));
    await withOrigin(S3, () => executeSweep(db, "sweep-8", 30, "0x00000000000000000000000000000000000000aa", paid));
    expect(originOf(db, "sweep.paid")).toEqual([S3]);
    expect(JSON.parse((db.prepare("SELECT origin_json FROM sweeps WHERE payment_id = 'sweep-8'").get() as { origin_json: string }).origin_json)).toEqual(S3);
  });
});

describe("a card charge matches only a purchase it can answer (review 2)", () => {
  it("a purchase that never got its charge does not claim a charge of the same amount much later", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const card = db.prepare("SELECT card_id, last4 FROM cards WHERE agent = 'sourcing'").get() as { card_id: string; last4: string };
    withOrigin(AGENT, () => audit(db, "sourcing", "card.purchase_started", "plan-y", { agent: "sourcing", last4: card.last4, merchant: "Packwise", amount: "45.00", currency: "EUR" }, now));
    const later = new Date(now.getTime() + 30 * 86_400_000);
    ingestCardTransaction(db, { transactionId: "t-late", cardId: card.card_id, amountCents: 4500, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION", occurredAt: later.toISOString() }, "poll", later);
    expect(originOf(db, "card.charge_approved")).toEqual([{ actor: "external", party: "merchant", name: "Packwise" }]);
  });

  it("a charge answering a purchase that recorded no origin records none either: the missing one is not hidden behind the merchant", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const card = db.prepare("SELECT card_id, last4 FROM cards WHERE agent = 'sourcing'").get() as { card_id: string; last4: string };
    audit(db, "sourcing", "card.purchase_started", "plan-z", { agent: "sourcing", last4: card.last4, merchant: "Notion", amount: "12.00", currency: "EUR" }, now);
    ingestCardTransaction(db, { transactionId: "t-z", cardId: card.card_id, amountCents: 1200, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Notion", mcc: "5734", type: "AUTHORIZATION", occurredAt: now.toISOString() }, "poll", now);
    expect(originOf(db, "card.charge_approved")).toEqual([null]);
  });
});

describe("review 3: a crash mid-action, and charges answering purchases in order", () => {
  const OPUS: Origin = { actor: "agent", agent: "treasury", model: "claude-opus-5-5", request_id: "req_o2", run_id: "run-treasury-11-abcdef" };
  const S3: Origin = { actor: "code", rule: "the sweep of net earnings (npm run s3)", agent: "treasury" };
  it("a sweep whose pull crashed (left PLANNED) is finished under the origin it started with", async () => {
    const db = openDb(":memory:");
    const { executeSweep } = await import("../src/agents/sweep.js");
    const crash = async (): Promise<never> => { throw new Error("killed during the pull"); };
    await expect(withOrigin(OPUS, () => executeSweep(db, "sweep-7", 30, "0x00000000000000000000000000000000000000aa", crash))).rejects.toThrow();
    await withOrigin(S3, () => executeSweep(db, "sweep-7", 30, "0x00000000000000000000000000000000000000aa", async () => ({ outcome: "PAID" as const, tx: "0xc", reason: null, already: false })));
    expect(originOf(db, "sweep.paid")).toEqual([OPUS]);
  });

  it("a refused sweep tried with a different amount is rejected and keeps its first origin", async () => {
    const db = openDb(":memory:");
    const { executeSweep } = await import("../src/agents/sweep.js");
    await withOrigin(OPUS, () => executeSweep(db, "sweep-6", 30, "0x00000000000000000000000000000000000000aa", async () => ({ outcome: "REFUSED" as const, tx: null, reason: "x", already: false })));
    await expect(withOrigin(S3, () => executeSweep(db, "sweep-6", 31, "0x00000000000000000000000000000000000000aa", async () => ({ outcome: "PAID" as const, tx: "0xd", reason: null, already: false })))).rejects.toThrow(/must not change the amount/);
    expect(JSON.parse((db.prepare("SELECT origin_json FROM sweeps WHERE payment_id = 'sweep-6'").get() as { origin_json: string }).origin_json)).toEqual(OPUS);
  });

  it("two purchases of the same amount: the first charge answers the first purchase, the second the second", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const card = db.prepare("SELECT card_id, last4 FROM cards WHERE agent = 'sourcing'").get() as { card_id: string; last4: string };
    const A: Origin = { ...AGENT, run_id: "run-sourcing-1-aaaaaa" }, B: Origin = { ...AGENT, run_id: "run-sourcing-2-bbbbbb" };
    for (const [o, id] of [[A, "pa"], [B, "pb"]] as const) withOrigin(o, () => audit(db, "sourcing", "card.purchase_started", id, { agent: "sourcing", last4: card.last4, merchant: "Notion", amount: "12.00", currency: "EUR" }, now));
    for (const [k, id] of ["t-1", "t-2"].entries()) ingestCardTransaction(db, { transactionId: id, cardId: card.card_id, amountCents: 1200, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Notion", mcc: "5734", type: "AUTHORIZATION", occurredAt: new Date(now.getTime() + k * 1000).toISOString() }, "poll", now);
    expect(originOf(db, "card.charge_approved")).toEqual([A, B]);
  });
});
