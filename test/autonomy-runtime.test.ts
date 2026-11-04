// D19: an agent's wake. It acts only when something reached it (an event for it, a message) or its routine check is
// due; it sees its goal, situation, what is new and its own last decisions; it talks to other agents only through
// messages; paused or stopped it does nothing and keeps its unread events; every wake ends in one labelled decision.
// Breaks if an agent acts on nothing, reads an event twice, acts while paused or stopped, or a fallback goes unlabelled.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openDb, type DB } from "../src/db/open.js";
import { pending, publish, sendMessage } from "../src/autonomy/bus.js";
import { wake, worldReady, type AgentProfile } from "../src/autonomy/runtime.js";
import { audit } from "../src/audit/log.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): { client: Anthropic; prompts: string[] } {
  let i = 0;
  const prompts: string[] = [];
  return { prompts, client: { beta: { messages: { create: async (req: { messages: { content: unknown }[] }) => {
    if (i === 0) prompts.push(String(req.messages[0]!.content));
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic };
}
const T0 = new Date("2026-11-03T10:00:00Z");
const looked: string[] = [];
const profile: AgentProfile = {
  name: "sourcing", display: "the Sourcing agent", model: "claude-haiku-5-5", goal: "keep stock data fresh at the best price", rules: "Metal enforces your mandate.",
  observe: async () => "Supplier A 0.03, supplier B 0.035.", tickMs: 600_000,
  tools: () => [{ name: "look", description: "d", input: z.strictObject({}), run: async () => { looked.push("x"); return { text: "looked" }; } }],
  fallback: async () => "code kept the buy policy as it was",
};
const finish = (s = "Switched to B; told Treasury.") => ({ name: "finish", input: { summary: s } });
const decisions = (db: DB) => db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.decision'").all().map((r) => JSON.parse((r as { payload_json: string }).payload_json));

describe("an agent's wake", () => {
  it("acts on an event for it: sees goal, situation, the event and its memory; decides; reads it once", async () => {
    const db = openDb(":memory:");
    publish(db, "supplier.notice", { supplier: "Stockline", new_price: "0.04" }, "sourcing", "system", T0);
    publish(db, "dispute.opened", { customer: "Summit" }, "support", "system", T0);
    const f = fake([[{ name: "look", input: {} }], [finish()]]);
    const w = await wake(db, profile, { client: f.client, now: T0 });
    expect(w).toMatchObject({ source: "claude", summary: "Switched to B; told Treasury.", events: [1] });
    expect(f.prompts[0]).toMatch(/Supplier A 0\.03/);
    expect(f.prompts[0]).toMatch(/supplier\.notice/);
    expect(f.prompts[0]).not.toMatch(/dispute\.opened/);
    expect(pending(db, "sourcing").events).toEqual([]);
    expect(await wake(db, profile, { client: fake([[finish()]]).client, now: new Date(T0.getTime() + 1000) })).toBeNull();
  });

  it("does its routine check when due, with nothing new, and remembers its last decision", async () => {
    const db = openDb(":memory:");
    await wake(db, profile, { client: fake([[finish("Kept A.")]]).client, now: T0 });
    expect(await wake(db, profile, { client: fake([[finish()]]).client, now: new Date(T0.getTime() + 60_000) })).toBeNull();
    const f = fake([[finish("Still A.")]]);
    const w = await wake(db, profile, { client: f.client, now: new Date(T0.getTime() + 600_000) });
    expect(w?.summary).toBe("Still A.");
    expect(f.prompts[0]).toMatch(/routine check/);
    expect(f.prompts[0]).toMatch(/\(you\): Kept A\./);
  });

  it("talks to another agent only through a message, at most two per wake; the message wakes the other", async () => {
    const db = openDb(":memory:");
    publish(db, "supplier.notice", { new_price: "0.04" }, "sourcing", "system", T0);
    const msg = (t: string) => ({ name: "send_message", input: { to: "treasury", text: t } });
    const w = await wake(db, profile, { client: fake([[msg("I need a 0.04 cap."), msg("again"), msg("third")], [finish()]]).client, now: T0 });
    expect(w!.run!.calls.map((c) => c.blocked ?? "ok")).toEqual(["ok", "ok", "message limit", "ok"]);
    expect(pending(db, "treasury").messages.map((m) => m.text)).toEqual(["I need a 0.04 cap.", "again"]);
  });

  it("does nothing while paused or stopped, and keeps its unread events for later", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.sourcing', 'on', ?)").run(T0.toISOString());
    publish(db, "supplier.notice", { new_price: "0.04" }, "sourcing", "system", T0);
    looked.length = 0;
    const w = await wake(db, profile, { client: fake([[{ name: "look", input: {} }], [finish()]]).client, now: T0 });
    expect(w).toMatchObject({ source: "idle", summary: "the CFO paused this agent" });
    expect(looked).toEqual([]);
    expect(pending(db, "sourcing").events).toHaveLength(1);
    db.prepare("UPDATE settings SET value = 'off' WHERE key = 'pause.sourcing'").run();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString());
    expect((await wake(db, profile, { client: fake([[finish()]]).client, now: T0 }))!.source).toBe("idle");
  });

  it("stops mid-loop: a pause or the emergency stop set during a wake blocks every later tool call, messages included", async () => {
    for (const key of ["pause.sourcing", "freeze"]) {
      const db = openDb(":memory:");
      publish(db, "supplier.notice", { new_price: "0.04" }, "sourcing", "system", T0);
      looked.length = 0;
      const stopper: AgentProfile = { ...profile, tools: () => [{ name: "look", description: "d", input: z.strictObject({}), run: async () => {
        looked.push("x");
        // The CFO hits the switch while the agent is thinking.
        db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, 'on', ?)").run(key, T0.toISOString());
        return { text: "looked" };
      } }] };
      const w = await wake(db, stopper, { client: fake([[{ name: "look", input: {} }], [{ name: "look", input: {} }, { name: "send_message", input: { to: "treasury", text: "raise my cap" } }], [finish()]]).client, now: T0 });
      expect(looked).toEqual(["x"]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_messages").get()).toEqual({ n: 0 });
      expect(w!.run!.calls.filter((c) => c.blocked).map((c) => c.blocked)).toEqual([key === "freeze" ? "the emergency stop is on" : "the CFO paused this agent", key === "freeze" ? "the emergency stop is on" : "the CFO paused this agent"]);
      // Review (1 Nov): the event that woke it stays unread, so the agent meets it again once resumed.
      expect(w!.source).toBe("idle");
      expect(pending(db, "sourcing").events).toHaveLength(1);
    }
  });

  it("does not let code's fallback act when the switch went on during the wake", async () => {
    const db = openDb(":memory:");
    publish(db, "supplier.notice", { new_price: "0.04" }, "sourcing", "system", T0);
    let fellBack = false;
    const p2: AgentProfile = { ...profile,
      observe: async () => { db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString()); return "x"; },
      fallback: async () => { fellBack = true; return "code acted"; } };
    const w = await wake(db, p2, { client: null, now: T0 });
    expect(fellBack).toBe(false);
    expect(w).toMatchObject({ source: "idle", summary: "stopped during the wake: the emergency stop is on" });
    expect(pending(db, "sourcing").events).toHaveLength(1);
    expect(decisions(db).at(-1)).toMatchObject({ source: "idle" });
  });

  it("without a decision, code's fallback decides and the row says so", async () => {
    const db = openDb(":memory:");
    publish(db, "supplier.notice", { new_price: "0.04" }, "sourcing", "system", T0);
    const w = await wake(db, profile, { client: null, now: T0 });
    expect(w).toMatchObject({ source: "fallback", summary: "code kept the buy policy as it was" });
    expect(decisions(db)[0]).toMatchObject({ source: "fallback", events: [1] });
  });

  it("refuses a message to itself", () => {
    expect(() => sendMessage(openDb(":memory:"), "sourcing", "sourcing", "hi")).toThrow(/itself/);
  });
});

describe("worldReady (dry-96: the agents woke before bootstrap and logged a failure every 3 s)", () => {
  it("is false until all three agents' mandates are bound, then true", () => {
    const db = openDb(":memory:");
    expect(worldReady(db)).toBe(false);
    audit(db, "owner-signer", "mandate.bound", "sourcing", {});
    audit(db, "owner-signer", "mandate.bound", "support", {});
    audit(db, "owner-signer", "mandate.bound", "customer", {});
    expect(worldReady(db)).toBe(false);
    audit(db, "owner-signer", "mandate.bound", "treasury", {});
    expect(worldReady(db)).toBe(true);
  });
});
