// D22: Airwallex's own events in the autonomous world. A card decline Airwallex made (the merchant's charge, seen by
// the webhook or the poll) and money that came into Northwind's Global Account each become a world event for the agent
// whose job it is; the agent decides. Breaks if the agent's own purchase also wakes it, if an approval or a task card
// does, if anything happens with the autonomy off, or if one decline or one deposit wakes it twice.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { ingestCardTransaction } from "../src/policy/cards.js";
import { meetNewDeclines } from "../src/agents/declineTrigger.js";
import { matchReceipt, openReceivable } from "../src/agents/receivables.js";
import type { CardTransaction } from "../src/airwallex/issuing.js";

const NOW = new Date("2026-11-05T10:00:00Z");
function world(): DB {
  const db = openDb(":memory:");
  const ins = db.prepare("INSERT INTO cards (card_id, agent, cardholder_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at, allowed_mccs, allowed_currencies) VALUES (?, ?, 'ch', ?, ?, 'EUR', ?, ?, 'ACTIVE', ?, ?, '5734', 'EUR')");
  ins.run("c-src", "sourcing", "1111", "sourcing", 3000, 10000, NOW.toISOString(), NOW.toISOString());
  ins.run("c-task", "task:P-0009", "2222", "task", 1500, 1500, NOW.toISOString(), NOW.toISOString());
  return db;
}
const charge = (id: string, o: Partial<CardTransaction> = {}): CardTransaction => ({
  transactionId: id, legacyId: id, cardId: "c-src", merchant: "Packwise", mcc: "5734", amountCents: 4500, currency: "EUR",
  status: "DECLINED", approved: false, failureReason: "LIMIT_EXCEEDED", type: "AUTHORIZATION", occurredAt: NOW.toISOString(), ...o,
} as CardTransaction);
const events = (db: DB, kind: string) => db.prepare("SELECT for_agent, payload_json FROM world_events WHERE kind = ? ORDER BY id").all(kind).map((r) => ({ for: (r as { for_agent: string }).for_agent, ...(JSON.parse((r as { payload_json: string }).payload_json) as Record<string, unknown>) }));
const autonomy = () => { vi.stubEnv("KIT11_AGENTS", "on"); vi.stubEnv("KIT11_AUTONOMY", "on"); };
afterEach(() => vi.unstubAllEnvs());

describe("a card decline Airwallex made becomes the agent's event (D22)", () => {
  it("from the webhook or the poll, once, saying which way it came", () => {
    autonomy();
    const db = world();
    ingestCardTransaction(db, charge("t1"), "webhook", NOW);
    ingestCardTransaction(db, charge("t1"), "poll", NOW);
    ingestCardTransaction(db, charge("t2", { amountCents: 4600 }), "poll", NOW);
    expect(events(db, "card.declined")).toEqual([
      { for: "sourcing", merchant: "Packwise", amount: "45.00", currency: "EUR", reason: "LIMIT_EXCEEDED", transaction_id: "t1", last4: "1111", via: "Airwallex webhook", decided_by: "Airwallex" },
      { for: "sourcing", merchant: "Packwise", amount: "46.00", currency: "EUR", reason: "LIMIT_EXCEEDED", transaction_id: "t2", last4: "1111", via: "Airwallex poll", decided_by: "Airwallex" },
    ]);
  });

  it("not for the agent's own purchase (it already has Airwallex's answer), an approval, or a task card", () => {
    autonomy();
    const db = world();
    ingestCardTransaction(db, charge("t1"), "simulation", NOW);
    ingestCardTransaction(db, charge("t2", { status: "APPROVED", approved: true, failureReason: null }), "webhook", NOW);
    ingestCardTransaction(db, charge("t3", { cardId: "c-task" }), "webhook", NOW);
    expect(events(db, "card.declined")).toEqual([]);
  });

  it("with the autonomy off nothing is published, and the block 5.2 decline agent stays as it was", async () => {
    vi.stubEnv("KIT11_AGENTS", "on");
    const db = world();
    ingestCardTransaction(db, charge("t1"), "webhook", NOW);
    expect(events(db, "card.declined")).toEqual([]);
  });

  it("in autonomy mode the block 5.2 decline agent does not also act: the agent whose card it is decides", async () => {
    autonomy();
    const db = world();
    ingestCardTransaction(db, charge("t1"), "webhook", NOW);
    expect(await meetNewDeclines(db, { client: null, now: NOW, by: "runner" })).toEqual([]);
  });
});

describe("money into the Global Account becomes the Treasury agent's event (D22)", () => {
  const deposit = (id: string, amountCents: number, reference: string) => ({ deposit_id: id, global_account_id: "ga-eur", currency: "EUR", amount_cents: amountCents, reference, payer: "Alpenweg Sport AG", received_at: NOW.toISOString() });

  it("once per deposit, with the match result, the rail and the way it came", () => {
    autonomy();
    const db = world();
    openReceivable(db, { invoice_no: "NW-R-201", customer: "Alpenweg Sport AG", currency: "EUR", amount_cents: 124_000, due_date: "2026-12-05" }, NOW);
    matchReceipt(db, deposit("d1", 100_000, "NW-R-201"), NOW, "webhook");
    matchReceipt(db, deposit("d1", 100_000, "NW-R-201"), NOW, "poll");
    expect(events(db, "money.in")).toEqual([{
      for: "treasury", rail: "airwallex", via: "Airwallex webhook", deposit_id: "d1", amount: "1000.00", currency: "EUR", payer: "Alpenweg Sport AG",
      outcome: "SHORT", invoice_no: "NW-R-201", detail: expect.stringMatching(/short by 240.00 EUR/),
    }]);
  });

  it("an unmatched deposit is still news for the Treasury agent; with the autonomy off nothing is published", () => {
    autonomy();
    const db = world();
    matchReceipt(db, deposit("d2", 2500, "Payment"), NOW, "poll");
    expect(events(db, "money.in")[0]).toMatchObject({ outcome: "UNMATCHED", invoice_no: null, via: "Airwallex poll" });
    vi.unstubAllEnvs();
    const off = world();
    matchReceipt(off, deposit("d3", 2500, "Payment"), NOW, "poll");
    expect(events(off, "money.in")).toEqual([]);
  });
});

describe("the rail choice: Ridgeline's one-off report on x402 (Alta) or an Airwallex task card (D22)", async () => {
  const { sourcingProfile } = await import("../src/autonomy/sourcingProfile.js");
  const { publish } = await import("../src/autonomy/bus.js");
  const paid: string[] = [];
  const stand = { // a stand-in world (test only): two suppliers, the mandate, and a card charge that Airwallex approves
    suppliers: async () => [], mandate: async () => ({ capCents: 3, budgetLeftCents: 900 }), sellCents: () => 5,
    payReportOnTaskCard: async (taskId: string) => { paid.push(taskId); return { approved: true, text: "approved by Airwallex", ref: "awx-r1" }; },
  };
  const tool = (db: DB) => sourcingProfile(stand).tools(db).find((t) => t.name === "buy_report")!;
  const offered = () => { const db = world(); publish(db, "supplier.offer", { supplier: "Ridgeline Data", offer: "report" }, "sourcing"); return db; };

  it("without an offer there is nothing to buy", async () => {
    expect(await tool(world()).run({ rail: "metal_x402", reason: "x" } as never)).toMatchObject({ blocked: "no offer" });
  });

  it("x402 is refused before anything is signed: 0.20 is over the mandate's cap, which Alta enforces on chain too", async () => {
    const r = await tool(offered()).run({ rail: "metal_x402", reason: "cheapest" } as never);
    expect(r).toMatchObject({ blocked: "over the cap" });
    expect(r.text).toMatch(/0\.20 is over your mandate's cap of 0\.03/);
  });

  it("a task card is a proposal for the CFO's Face ID: single-use, 15.00 EUR, data merchants only, asked by the Sourcing agent", async () => {
    const db = offered();
    const r = await tool(db).run({ rail: "airwallex_task_card", reason: "the report shows where demand moves" } as never);
    expect(r.blocked).toBeUndefined();
    const p = db.prepare("SELECT created_by, terms_json FROM proposals WHERE kind = 'task_card'").get() as { created_by: string; terms_json: string };
    expect(p.created_by).toBe("sourcing");
    expect(JSON.parse(p.terms_json)).toMatchObject({ amount: "15.00", currency: "EUR", single_use: true, merchant_categories: ["5734"], asked_by: "agent:sourcing", task: "data" });
    expect(await tool(db).run({ rail: "airwallex_task_card", reason: "again" } as never)).toMatchObject({ blocked: "already waiting" });
  });

  it("once the CFO approved and Airwallex issued the card, the agent pays on it, once", async () => {
    const db = offered();
    await tool(db).run({ rail: "airwallex_task_card", reason: "r" } as never);
    const pid = (db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'task_card'").get() as { proposal_id: string }).proposal_id;
    db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = ?").run(pid);
    db.prepare("INSERT INTO task_cards (task_id, proposal_id, kind, purpose, mccs, amount_cents, valid_until, status, created_at) VALUES (?, ?, 'data', 'r', '5734', 1500, ?, 'ACTIVE', ?)").run(`task:${pid}`, pid, "2026-11-12T00:00:00.000Z", NOW.toISOString());
    expect((await tool(db).run({ rail: "airwallex_task_card", reason: "pay" } as never)).blocked).toBeUndefined();
    expect(paid).toEqual([`task:${pid}`]);
    expect(await tool(db).run({ rail: "airwallex_task_card", reason: "pay again" } as never)).toMatchObject({ blocked: "already bought" });
  });
});

describe("the issued card reaches the agent that asked for it (D22)", async () => {
  const { executeTaskCard, proposeTaskCard } = await import("../src/agents/askPurser.js");
  const { decide } = await import("../src/policy/approvals.js");
  const { FakeIssuing } = await import("../src/redteam/issuing.js");
  it("after the CFO approves and Airwallex issues it, the Sourcing agent hears card.issued; a CFO's own card tells no agent", async () => {
    autonomy();
    const db = openDb(":memory:");
    const task = { kind: "data" as const, label: "Data purchase", mccs: ["5734"], amountCents: 1500, validUntil: "2026-11-12T10:00:00.000Z", purpose: "Ridgeline Data, one-off regional demand report" };
    const p = proposeTaskCard(db, task, "the report shows where demand moves", NOW, "sourcing", "agent:sourcing");
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, NOW);
    const awx = new FakeIssuing();
    await executeTaskCard(db, awx, p.proposal_id, NOW);
    expect(events(db, "card.issued")).toEqual([expect.objectContaining({ for: "sourcing", task_id: `task:${p.proposal_id}`, amount: "15.00", single_use: true })]);
    const q = proposeTaskCard(db, { ...task, purpose: "x" }, "x", NOW, undefined, "cfo-at-runner");
    decide(db, { proposalId: q.proposal_id, decision: "APPROVED", typedPrefix: q.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, NOW);
    await executeTaskCard(db, awx, q.proposal_id, NOW);
    expect(events(db, "card.issued")).toHaveLength(1);
  });
});
