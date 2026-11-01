// D19: the fallback share and the Claude calls per agent, from the ledger; a call without a request id is counted.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { agentStats } from "../src/dashboard/agentStats.js";

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
