// Block 5.2, event-driven: a new card decline (from the purchase itself, a webhook or the poll) starts the agent whose
// card it is, once. Breaks if two processes both start it for the same decline, if an approved charge or a task card
// starts it, if it runs with the agents switched off, or if it stacks a raise on one already waiting. Fake client.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { meetNewDeclines } from "../src/agents/declineTrigger.js";

const NOW = new Date("2026-11-01T10:00:00Z");
function world(): DB {
  const db = openDb(":memory:");
  const ins = db.prepare("INSERT INTO cards (card_id, agent, cardholder_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at, allowed_mccs, allowed_currencies) VALUES (?, ?, 'ch', ?, ?, 'EUR', ?, ?, 'ACTIVE', ?, ?, '5734', 'EUR')");
  ins.run("c-src", "sourcing", "1111", "sourcing", 3000, 10000, NOW.toISOString(), NOW.toISOString());
  ins.run("c-task", "task:T-0001", "2222", "task", 15000, 15000, NOW.toISOString(), NOW.toISOString());
  return db;
}
function tx(db: DB, id: string, card: string, agent: string, approved: boolean, reason: string | null, cents = 4500) {
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, purpose, source, occurred_at, recorded_at) VALUES (?, ?, ?, 'Packwise', '5734', ?, 'EUR', ?, ?, ?, 'Packwise, Pro plan, monthly', 'simulation', ?, ?)")
    .run(id, card, agent, cents, approved ? "APPROVED" : "DECLINED", approved ? 1 : 0, reason, NOW.toISOString(), NOW.toISOString());
}
const raiseClient = (): Anthropic => ({ beta: { messages: { create: async () => ({
  content: [{ type: "tool_use", id: "x", name: "propose_raise", input: { per_purchase: "50.00", per_month: null, reason: "Pro gives live sync" } }], stop_reason: "tool_use", model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 },
}) } } }) as unknown as Anthropic;
const proposals = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'policy_change'").get() as { n: number }).n;
const on = { KIT11_AGENTS: "on" } as NodeJS.ProcessEnv;

describe("a new card decline starts the agent, once", () => {
  it("runs the agent for a fresh limit decline and files its raise", async () => {
    const db = world();
    tx(db, "t1", "c-src", "sourcing", false, "LIMIT_EXCEEDED");
    const r = await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: on, by: "cli" });
    expect(r.map((m) => m.source)).toEqual(["claude"]);
    expect(proposals(db)).toBe(1);
  });

  it("a second process (the runner's webhook) skips a decline already claimed", async () => {
    const db = world();
    tx(db, "t1", "c-src", "sourcing", false, "LIMIT_EXCEEDED");
    await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: on, by: "cli" });
    expect(await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: on, by: "runner" })).toEqual([]);
    expect(proposals(db)).toBe(1);
  });

  it("ignores approved charges, task cards, old declines, and does nothing with the agents off", async () => {
    const db = world();
    tx(db, "ok", "c-src", "sourcing", true, null);
    tx(db, "task", "c-task", "task:T-0001", false, "LIMIT_EXCEEDED");
    db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, purpose, source, occurred_at, recorded_at) VALUES ('old', 'c-src', 'sourcing', 'Packwise', '5734', 4500, 'EUR', 'DECLINED', 0, 'LIMIT_EXCEEDED', NULL, 'poll', '2026-10-31T10:00:00Z', '2026-10-31T10:00:00Z')").run();
    expect(await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: on, by: "cli" })).toEqual([]);
    tx(db, "t2", "c-src", "sourcing", false, "LIMIT_EXCEEDED");
    expect(await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: {} as NodeJS.ProcessEnv, by: "cli" })).toEqual([]);
  });

  it("does not stack a raise on one already waiting for the CFO", async () => {
    const db = world();
    tx(db, "t1", "c-src", "sourcing", false, "LIMIT_EXCEEDED");
    await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: on, by: "cli" });
    tx(db, "t2", "c-src", "sourcing", false, "LIMIT_EXCEEDED", 4600);
    expect(await meetNewDeclines(db, { client: raiseClient(), now: NOW, env: on, by: "cli" })).toEqual([]);
    expect(proposals(db)).toBe(1);
  });
});
