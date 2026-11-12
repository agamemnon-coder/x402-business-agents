// What the payables agents (src/ap/checkerAgent.ts, src/ap/payerAgent.ts) share on the runner: who decided, as the
// audit chain records it. A decision row says whether Claude or code's fallback decided, and carries an origin like
// every other agent's work (src/provenance/origin.ts): the agent, the model, the API request that gave the final
// answer and the run, or code's own rule when Claude was unavailable.

import type { Actor } from "../audit/log.js";
import type { AgentRun } from "../agents/loop.js";
import type { DB } from "../db/open.js";
import { parseOrigin, type Origin } from "../provenance/origin.js";

export interface RunProvenance {
  /** The run's id in its agent.run row (src/agents/loop.ts); null when no row is found. */
  run_id: string | null;
  /** The Anthropic request ids of the run's Claude calls, in order (public ids, not secrets). */
  request_ids: string[];
  /** Who decided, for the decision row and for a proposal filed after it; null only when no run was recorded. */
  origin: Origin | null;
}

/**
 * The provenance of the run just finished for this task: read from its agent.run row, the one place the loop records
 * the run id and the request ids. `byClaude` says whether the agent's own answer was recorded; when it was not, the
 * origin is code's, under `fallbackRule`.
 */
export function runProvenance(db: DB, agent: Actor, task: string, run: AgentRun, byClaude: boolean, fallbackRule: string): RunProvenance {
  const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' AND actor = ? AND subject = ? ORDER BY seq DESC LIMIT 1").get(agent, task) as { payload_json: string } | undefined;
  const p = row ? JSON.parse(row.payload_json) as { run_id?: string; request_ids?: (string | null)[] } : {};
  const runId = typeof p.run_id === "string" ? p.run_id : null;
  const requestIds = (p.request_ids ?? []).filter((x): x is string => typeof x === "string");
  const origin = byClaude && runId && run.model
    ? parseOrigin(JSON.stringify({ actor: "agent", agent, model: run.model, request_id: requestIds.at(-1) ?? null, run_id: runId }))
    : parseOrigin(JSON.stringify({ actor: "code", rule: fallbackRule, agent }));
  return { run_id: runId, request_ids: requestIds, origin };
}
