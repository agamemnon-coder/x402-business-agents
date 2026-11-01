// D19 block 1: per agent, how many decisions Claude made and how many fell back to code (each labelled), with the
// Claude calls, tokens, cost and the request ids behind them. The dashboard shows the fallback share; the run summary
// (npm run agent-summary) prints it. A decision is a row whose `source` says who decided.

import type { DB } from "../db/open.js";

/** The rows where an agent's decision is recorded, each with source "claude" or "fallback". */
export const DECISION_EVENTS = ["price_rise.met", "price_rise.plan", "dispute.settled_by_agent", "purchase.rails_chosen", "card.decline_met", "licence.timing_advised", "agent.decision"] as const;

export interface AgentStats {
  agent: string;
  decisions: number;
  by_claude: number;
  fallback: number;
  fallback_pct: number;
  claude_calls: number;
  calls_without_request_id: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  cost_usd_micros: number;
  models: string[];
}

export function agentStats(db: DB): AgentStats[] {
  const out = new Map<string, AgentStats>();
  const get = (agent: string) => {
    let s = out.get(agent);
    if (!s) out.set(agent, (s = { agent, decisions: 0, by_claude: 0, fallback: 0, fallback_pct: 0, claude_calls: 0, calls_without_request_id: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd_micros: 0, models: [] }));
    return s;
  };
  const marks = DECISION_EVENTS.map(() => "?").join(", ");
  for (const r of db.prepare(`SELECT actor, json_extract(payload_json, '$.source') AS source FROM audit_log WHERE event IN (${marks})`).all(...DECISION_EVENTS) as { actor: string; source: string | null }[]) {
    if (r.source !== "claude" && r.source !== "fallback") continue;
    const s = get(r.actor);
    s.decisions++;
    if (r.source === "claude") s.by_claude++; else s.fallback++;
  }
  for (const r of db.prepare("SELECT actor, payload_json FROM audit_log WHERE event = 'agent.run'").all() as { actor: string; payload_json: string }[]) {
    const p = JSON.parse(r.payload_json) as { claude_calls?: { request_id: string | null; model: string; tokens: AgentStats["tokens"]; cost_usd_micros: number }[]; cost_usd_micros?: number };
    const s = get(r.actor);
    for (const c of p.claude_calls ?? []) {
      s.claude_calls++;
      if (!c.request_id) s.calls_without_request_id++;
      s.tokens.input += c.tokens.input; s.tokens.output += c.tokens.output; s.tokens.cache_read += c.tokens.cache_read; s.tokens.cache_write += c.tokens.cache_write;
      if (!s.models.includes(c.model)) s.models.push(c.model);
    }
    s.cost_usd_micros += p.cost_usd_micros ?? 0;
  }
  for (const s of out.values()) s.fallback_pct = s.decisions ? Math.round((s.fallback / s.decisions) * 1000) / 10 : 0;
  return [...out.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}
