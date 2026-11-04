// npm run agent-summary: per agent in this world, Claude's decisions and code's fallbacks, the Claude calls (each with
// its API request id), tokens, cache hits and cost (D19, 3b.4). Read-only.
import { openDb } from "../db/open.js";
import { agentStats } from "../dashboard/agentStats.js";

const rows = agentStats(openDb());
if (rows.length === 0) console.log("no agent decisions in this world");
for (const s of rows) {
  console.log(`${s.agent.padEnd(9)} decisions ${s.decisions} (Claude ${s.by_claude}, fallback ${s.fallback} = ${s.fallback_pct}%); ${s.claude_calls} Claude calls${s.calls_without_request_id ? `, ${s.calls_without_request_id} WITHOUT a request id` : ", each with a request id"}; tokens in ${s.tokens.input} out ${s.tokens.output} cache read ${s.tokens.cache_read}; ${(s.cost_usd_micros / 1e6).toFixed(4)} USD; ${s.models.join(", ")}`);
}
const all = rows.reduce((a, s) => ({ d: a.d + s.decisions, f: a.f + s.fallback, c: a.c + s.cost_usd_micros }), { d: 0, f: 0, c: 0 });
console.log(`all agents: ${all.d} decisions, fallback ${all.d ? ((all.f / all.d) * 100).toFixed(1) : "0.0"}%, ${(all.c / 1e6).toFixed(4)} USD on Claude`);
