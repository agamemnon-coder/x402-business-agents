// D19: the fallback share and the Claude calls per agent, from the ledger; a call without a request id is counted.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { agentChat, agentStats } from "../src/dashboard/agentStats.js";
import { publish, sendMessage } from "../src/autonomy/bus.js";

describe("agent stats", () => {
  it("counts Claude's decisions and code's fallbacks per agent, and every call's request id", () => {
    const db = openDb(":memory:");
    audit(db, "sourcing", "price_rise.met", "41", { source: "claude" });
    audit(db, "sourcing", "purchase.rails_chosen", "rails", { source: "fallback" });
    audit(db, "treasury", "price_rise.plan", null, { source: "claude" });
    audit(db, "sourcing", "agent.run", "t", { cost_usd_micros: 1500, claude_calls: [
      { request_id: "req_1", model: "claude-haiku-5-5", tokens: { input: 10, output: 2, cache_read: 5, cache_write: 0 }, cost_usd_micros: 700 },
      { request_id: null, model: "claude-haiku-5-5", tokens: { input: 10, output: 2, cache_read: 5, cache_write: 0 }, cost_usd_micros: 800 },
    ] });
    const [src, tre] = agentStats(db);
    expect(src).toMatchObject({ agent: "sourcing", decisions: 2, by_claude: 1, fallback: 1, fallback_pct: 50, claude_calls: 2, calls_without_request_id: 1, cost_usd_micros: 1500, tokens: { input: 20, cache_read: 10 } });
    expect(tre).toMatchObject({ agent: "treasury", decisions: 1, fallback_pct: 0 });
  });
});

describe("the agents as the dashboard shows them (D19 block 4)", () => {
  it("adds each agent's Claude cost in the last hour", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-11-05T12:00:00Z");
    audit(db, "sourcing", "agent.run", "wake.sourcing", { cost_usd_micros: 1000 }, new Date("2026-11-05T10:30:00Z"));
    audit(db, "sourcing", "agent.run", "wake.sourcing", { cost_usd_micros: 250 }, new Date("2026-11-05T11:30:00Z"));
    const s = agentStats(db, now).find((x) => x.agent === "sourcing")!;
    expect(s.cost_usd_micros).toBe(1250);
    expect(s.cost_last_hour_usd_micros).toBe(250);
  });

  it("tells the agents' conversation in order: what changed in the world, what each decided (and who decided), what they said", () => {
    const db = openDb(":memory:");
    const t = (m: number) => new Date(Date.UTC(2026, 10, 5, 12, m));
    publish(db, "supplier.notice", { supplier: "stockline", text: "Stockline's price is now 0.04." }, "sourcing", "system", t(0));
    audit(db, "sourcing", "agent.decision", "wake.sourcing", { agent: "sourcing", source: "claude", model: "claude-haiku-5-5", summary: "Switched to Ridgeline." }, t(1));
    sendMessage(db, "sourcing", "treasury", "Can my cap go to 0.04?", t(1), "claude");
    audit(db, "treasury", "agent.decision", "wake.treasury", { agent: "treasury", source: "fallback", model: null, summary: "kept things as they were" }, t(2));
    const chat = agentChat(db);
    expect(chat.map((c) => c.kind)).toEqual(["world", "decision", "message", "decision"]);
    expect(chat[0]).toMatchObject({ who: "world", text: expect.stringContaining("0.04") });
    expect(chat[1]).toMatchObject({ who: "sourcing", by: "claude", model: "claude-haiku-5-5", text: "Switched to Ridgeline." });
    expect(chat[2]).toMatchObject({ who: "sourcing", to: "treasury", by: "claude", text: "Can my cap go to 0.04?" });
    expect(chat[3]).toMatchObject({ who: "treasury", by: "fallback" });
  });

  it("labels a message code's fallback wrote as code, not Claude", () => {
    const db = openDb(":memory:");
    sendMessage(db, "sourcing", "treasury", "A purchase was refused over my cap.");
    expect(agentChat(db)[0]).toMatchObject({ kind: "message", by: "fallback" });
    // An older row with no author claims neither.
    audit(db, "sourcing", "agent.message", "9", { from: "sourcing", to: "treasury", text: "old" });
    expect(agentChat(db)[1]!.by).toBeUndefined();
  });
});
