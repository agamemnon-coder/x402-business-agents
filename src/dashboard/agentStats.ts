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
  /** Claude's cost for this agent in the hour before `now` (the dashboard's cost per hour). */
  cost_last_hour_usd_micros: number;
  models: string[];
}

export function agentStats(db: DB, now = new Date()): AgentStats[] {
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const out = new Map<string, AgentStats>();
  const get = (agent: string) => {
    let s = out.get(agent);
    if (!s) out.set(agent, (s = { agent, decisions: 0, by_claude: 0, fallback: 0, fallback_pct: 0, claude_calls: 0, calls_without_request_id: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd_micros: 0, cost_last_hour_usd_micros: 0, models: [] }));
    return s;
  };
  const marks = DECISION_EVENTS.map(() => "?").join(", ");
  for (const r of db.prepare(`SELECT actor, json_extract(payload_json, '$.source') AS source FROM audit_log WHERE event IN (${marks})`).all(...DECISION_EVENTS) as { actor: string; source: string | null }[]) {
    if (r.source !== "claude" && r.source !== "fallback") continue;
    const s = get(r.actor);
    s.decisions++;
    if (r.source === "claude") s.by_claude++; else s.fallback++;
  }
  for (const r of db.prepare("SELECT actor, ts, payload_json FROM audit_log WHERE event = 'agent.run'").all() as { actor: string; ts: string; payload_json: string }[]) {
    const p = JSON.parse(r.payload_json) as { claude_calls?: { request_id: string | null; model: string; tokens: AgentStats["tokens"]; cost_usd_micros: number }[]; cost_usd_micros?: number };
    const s = get(r.actor);
    for (const c of p.claude_calls ?? []) {
      s.claude_calls++;
      if (!c.request_id) s.calls_without_request_id++;
      s.tokens.input += c.tokens.input; s.tokens.output += c.tokens.output; s.tokens.cache_read += c.tokens.cache_read; s.tokens.cache_write += c.tokens.cache_write;
      if (!s.models.includes(c.model)) s.models.push(c.model);
    }
    s.cost_usd_micros += p.cost_usd_micros ?? 0;
    if (r.ts > hourAgo && r.ts <= now.toISOString()) s.cost_last_hour_usd_micros += p.cost_usd_micros ?? 0;
  }
  for (const s of out.values()) s.fallback_pct = s.decisions ? Math.round((s.fallback / s.decisions) * 1000) / 10 : 0;
  return [...out.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

export interface ChatLine {
  ts: string;
  kind: "world" | "decision" | "message" | "idle" | "cost";
  /** "world" for what we changed, else the agent. */
  who: string;
  to?: string;
  /** Who decided: Claude, or code's fallback (labelled as such on the page). */
  by?: "claude" | "fallback" | "idle";
  model?: string | null;
  text: string;
}

/** The agents' conversation, oldest first: what changed in the world, what each decided and who decided, what they told
 *  each other, when they stood idle (the CFO's switch) or neared their Claude budget. */
export function agentChat(db: DB, limit = 40): ChatLine[] {
  const rows = db.prepare("SELECT ts, actor, event, payload_json FROM audit_log WHERE event IN ('world.event', 'agent.decision', 'agent.message', 'agent.idle', 'agent.cost_warning') ORDER BY seq DESC LIMIT ?").all(limit) as { ts: string; actor: string; event: string; payload_json: string }[];
  return rows.reverse().map((r) => {
    const p = JSON.parse(r.payload_json) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
    if (r.event === "world.event") {
      const pl = (p.payload ?? {}) as Record<string, unknown>;
      return { ts: r.ts, kind: "world" as const, who: "world", ...(p.for_agent ? { to: str(p.for_agent) } : {}), text: worldWords(str(p.kind), pl, str).slice(0, 300) };
    }
    // A message from before authors were recorded carries no `by`: the page then claims neither.
    if (r.event === "agent.message") return { ts: r.ts, kind: "message" as const, who: str(p.from), to: str(p.to), ...(p.by === "claude" ? { by: "claude" as const } : p.by === "code" ? { by: "fallback" as const } : {}), text: str(p.text) };
    if (r.event === "agent.idle") return { ts: r.ts, kind: "idle" as const, who: r.actor, by: "idle" as const, text: str(p.why) };
    if (r.event === "agent.cost_warning") return { ts: r.ts, kind: "cost" as const, who: r.actor, text: "80 % of its hourly Claude budget used" };
    const by = p.source === "claude" ? "claude" as const : p.source === "idle" ? "idle" as const : "fallback" as const;
    return { ts: r.ts, kind: "decision" as const, who: r.actor, by, model: (p.model as string | null | undefined) ?? null, text: str(p.summary) };
  });
}

/** What changed in the world, in plain words (the full email or notice stays in the agent's own input, not on the page). */
function worldWords(kind: string, pl: Record<string, unknown>, str: (v: unknown) => string): string {
  if (kind === "supplier.notice") return pl.new_price ? `${str(pl.supplier)} now asks ${str(pl.new_price)} a stock check (its notice)` : `${str(pl.supplier)}: ${str(pl.text)}`;
  if (kind === "dispute.opened") return `${str(pl.customer)} disputes a batch of orders (its email)`;
  if (kind === "invoice.received") return `${str(pl.vendor)}'s invoice arrived${pl.file ? ` (${str(pl.file)})` : ""}`;
  if (kind === "upstream.refused") return `A purchase from ${str(pl.supplier)} was refused before signing: ${str(pl.reason)}`;
  if (kind === "mandate.replaced") return "A mandate was replaced on chain (the CFO approved it)";
  return kind;
}
