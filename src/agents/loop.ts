// An agent's own Claude loop: Claude decides which tool to call and with what, inside the agent's mandate; code runs
// each tool through the same checks as before. A tool only runs on input that fits its schema exactly, a check that
// blocks a call is logged by name, and every call and every run lands in the audit chain (redacted, with what it
// cost). When the API is missing, fails or refuses, the run says so and the caller's deterministic fallback decides,
// as before. No tool takes a key, a URL or a payee chosen by the model: the rails (Metal, Airwallex) and the CFO's
// Face ID stay the limit.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit, type Actor } from "../audit/log.js";
import { claudeClient } from "../claude/reader.js";
import { callCostMicros, type Usage } from "../claude/pricing.js";
import type { DB } from "../db/open.js";
import { redactJson, redactSecrets } from "../lib/redact.js";
import { randomBytes } from "node:crypto";
import { withOrigin } from "../provenance/origin.js";
import { apiInputSchema } from "./toolSchema.js";

export interface ToolResult {
  /** What Claude reads back. */
  text: string;
  /** The check that stopped this call (a mandate cap, a policy limit, missing evidence…); absent when it went through. */
  blocked?: string;
  /** The run ends here, without asking Claude again (a plan was accepted, an escalation was filed). */
  final?: boolean;
}

export { apiInputSchema } from "./toolSchema.js";

export interface AgentTool<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>): Promise<ToolResult>;
}

export interface AgentCall {
  tool: string;
  input: unknown;
  text: string;
  blocked?: string;
}

export interface AgentRun {
  /** done: Claude finished or a final tool ended it; unavailable: no client, an API failure or a refusal; incomplete: out of turns. */
  status: "done" | "unavailable" | "incomplete";
  model: string | null;
  calls: AgentCall[];
  /** Claude's last words: its reasoning as it told it, shown as the agent's "thinking" line. */
  text: string;
  turns: number;
  costMicros: number;
  note?: string;
}

export interface AgentSpec {
  agent: Actor;
  task: string;
  model: string;
  system: string;
  prompt: string;
  tools: AgentTool<z.ZodType>[];
  maxTurns?: number;
  effort?: "low" | "medium" | "high";
  /**
   * Why the job is not done yet, or null when it is. If Claude stops while this returns a reason, it is sent back once
   * with that reason (dry-26: Haiku stopped after code refused its message, without trying the purchase). A second stop
   * ends the run as it is; the caller decides whether the run counts.
   */
  unfinished?: () => string | null;
  /** Tests set 0; the one retry after a transient API failure waits this long (default 2 s). */
  retryDelayMs?: number;
}

/** A failure worth one retry: rate limit, server error, timeout or a dropped connection. */
function transient(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) return err.status === undefined || err.status === 429 || err.status >= 500;
  return /timeout|timed out|ECONNRESET|ENOTFOUND|socket|network/i.test((err as Error)?.message ?? "");
}

/** Cost caps per agent per hour and per run (the ledger), in micro-USD; an alert row at 80 %. */
export const AGENT_HOURLY_CAP_MICROS: Record<string, number> = { sourcing: 300_000, support: 600_000, treasury: 1_500_000 };
export const RUN_CAP_MICROS = 8_000_000;
function overCap(db: DB, agent: string, nowMs: number): string | null {
  const since = new Date(nowMs - 3_600_000).toISOString();
  const sum = (where: string, ...args: string[]) => (db.prepare(`SELECT COALESCE(SUM(json_extract(payload_json, '$.cost_usd_micros')), 0) AS s FROM audit_log WHERE event = 'agent.run' ${where}`).get(...args) as { s: number }).s;
  const hour = sum("AND actor = ? AND ts > ?", agent, since), run = sum("");
  const hourCap = AGENT_HOURLY_CAP_MICROS[agent] ?? 500_000;
  if (hour >= hourCap) return `cost cap: the ${agent} agent spent ${(hour / 1e6).toFixed(4)} USD on Claude in the last hour (cap ${(hourCap / 1e6).toFixed(2)})`;
  if (run >= RUN_CAP_MICROS) return `cost cap: the agents spent ${(run / 1e6).toFixed(4)} USD on Claude in this world (cap ${(RUN_CAP_MICROS / 1e6).toFixed(2)})`;
  if (hour >= hourCap * 0.8 && !db.prepare("SELECT 1 FROM audit_log WHERE event = 'agent.cost_warning' AND actor = ? AND ts > ?").get(agent, since)) {
    audit(db, agent as Actor, "agent.cost_warning", agent, { agent, spent_usd_micros: hour, cap_usd_micros: hourCap, note: "80 % of the hourly Claude budget" });
  }
  return null;
}

const short = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function runAgent(db: DB, spec: AgentSpec, client: Anthropic | null = claudeClient(), clock: () => number = Date.now): Promise<AgentRun> {
  const started = clock();
  // The trace (src/dashboard/trace.ts) shows every audit row after this one that the agent's run caused.
  const fromSeq = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
  // D24: every money movement a tool call starts records this run, the model and the request that asked for the tool.
  const runId = `run-${spec.agent}-${fromSeq}-${randomBytes(3).toString("hex")}`;
  const calls: AgentCall[] = [];
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const claudeMs: number[] = [];
  const claudeCalls: { request_id: string | null; model: string; tokens: Usage; ms: number; cost_usd_micros: number; retried?: boolean }[] = [];
  let turns = 0, costMicros = 0, model: string | null = null, text = "";
  const finish = (status: AgentRun["status"], note?: string): AgentRun => {
    const run: AgentRun = { status, model, calls, text: redactSecrets(text), turns, costMicros, ...(note ? { note: redactSecrets(note) } : {}) };
    audit(db, spec.agent, "agent.run", spec.task, {
      agent: spec.agent, model: model ?? spec.model, status, turns, tools: calls.map((c) => c.tool),
      blocked: calls.filter((c) => c.blocked).map((c) => `${c.tool}: ${c.blocked}`),
      said: short(run.text, 1200), cost_usd_micros: costMicros, latency_ms: clock() - started, ...(note ? { note: run.note! } : {}),
      from_seq: fromSeq, run_id: runId, tokens, claude_ms: claudeMs, claude_calls: claudeCalls as never, request_ids: claudeCalls.map((c) => c.request_id),
    });
    return run;
  };
  if (!client) return finish("unavailable", "no KIT11_ANTHROPIC_API_KEY");

  const byName = new Map(spec.tools.map((t) => [t.name, t]));
  const tools = spec.tools.map((t) => ({
    name: t.name, description: t.description, strict: true,
    input_schema: apiInputSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
  }));
  // The prompt carries ledger text (a refusal reason, another agent's message): redacted like everything else.
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: redactSecrets(spec.prompt) }];
  const maxTurns = spec.maxTurns ?? 8;
  let nudged = false;

  while (turns < maxTurns) {
    turns++;
    // Cost cap (D19): an agent over its hourly or the run's budget makes no call; the caller's fallback decides, labelled.
    const cap = overCap(db, String(spec.agent), clock());
    if (cap) return finish("unavailable", cap);
    let res!: Anthropic.Beta.BetaMessage;
    const asked = clock();
    let retried = false;
    // One retry with backoff on a transient failure (429, 5xx, timeout, connection); then the labelled fallback.
    for (let attempt = 0; ; attempt++) {
      try {
        res = await (client.withOptions ? client.withOptions({ maxRetries: 0 }) : client).beta.messages.create({
        model: spec.model,
        max_tokens: 16000,
        system: [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        output_config: { effort: spec.effort ?? "medium" },
        // Haiku has no server-side fallback; Sonnet 5.5 and Opus 5.5 take the "default" routing.
        ...(spec.model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        } as Anthropic.Beta.MessageCreateParamsNonStreaming);
        break;
      } catch (err) {
        if (attempt === 0 && transient(err)) {
          retried = true;
          await new Promise((r) => setTimeout(r, spec.retryDelayMs ?? 2000));
          continue;
        }
        const message = err instanceof Anthropic.APIError ? `API ${err.status ?? ""} ${err.name}` : (err as Error).message;
        return finish("unavailable", `call failed${retried ? " after one retry" : ""}: ${short(message, 200)}`);
      }
    }
    claudeMs.push(clock() - asked);
    model = res.model;
    const u = res.usage;
    const usage: Usage = { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 };
    tokens.input += usage.input; tokens.output += usage.output; tokens.cache_read += usage.cache_read; tokens.cache_write += usage.cache_write;
    const callCost = callCostMicros(res.model, usage) ?? 0;
    costMicros += callCost;
    // Proof per call (D19): the API's request id, tokens, cache hits, latency and cost, in the run's audit row.
    const requestId = (res as { _request_id?: string | null })._request_id ?? null;
    claudeCalls.push({ request_id: requestId, model: res.model, tokens: usage, ms: clock() - asked, cost_usd_micros: callCost, ...(retried ? { retried: true } : {}) });
    if (res.stop_reason === "refusal") {
      const cat = (res.stop_details as { category?: string } | null | undefined)?.category ?? "no category";
      return finish("unavailable", `refused (${cat})`);
    }
    const said = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (said) text = said;
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      if (res.stop_reason === "max_tokens") return finish("incomplete", "the answer was cut off");
      const reason = spec.unfinished?.() ?? null;
      if (reason && !nudged) {
        nudged = true;
        audit(db, spec.agent, "agent.nudged", spec.task, { agent: spec.agent, model: res.model, reason });
        messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
        messages.push({ role: "user", content: `Not finished: ${reason}` });
        continue;
      }
      return finish("done");
    }
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let final = false;
    for (const use of uses) {
      const tool = byName.get(use.name);
      let out: ToolResult;
      let error = false;
      const toolStarted = clock();
      if (!tool) {
        out = { text: `There is no tool called ${use.name}.`, blocked: "unknown tool" };
        error = true;
      } else {
        const fits = tool.input.safeParse(use.input);
        if (!fits.success) {
          out = { text: `The input does not fit ${use.name}'s schema (${fits.error.issues[0]?.path.join(".") || "root"}: ${fits.error.issues[0]?.message ?? "invalid"}). Nothing was done.`, blocked: "schema" };
          error = true;
        } else {
          try {
            out = await withOrigin({ actor: "agent", agent: spec.agent, model: res.model, request_id: requestId, run_id: runId }, () => tool.run(fits.data));
          } catch (e) {
            out = { text: `The tool stopped: ${(e as Error).message}. Nothing more was done.`, blocked: "error" };
            error = true;
          }
        }
      }
      const call: AgentCall = { tool: use.name, input: redactJson(use.input as never), text: redactSecrets(out.text), ...(out.blocked ? { blocked: out.blocked } : {}) };
      calls.push(call);
      audit(db, spec.agent, "agent.tool", spec.task, {
        agent: spec.agent, model: res.model, request_id: requestId, tool: use.name, input: call.input as never, result: short(call.text), ...(out.blocked ? { blocked_by: out.blocked } : {}),
        ms: clock() - toolStarted, turn: turns,
      });
      // What goes back to Claude is redacted too: no tool result may carry a credential to the model.
      results.push({ type: "tool_result", tool_use_id: use.id, content: call.text, ...(error ? { is_error: true } : {}) });
      if (out.final) final = true;
    }
    if (final) return finish("done");
    messages.push({ role: "user", content: results });
  }
  return finish("incomplete", `no answer within ${maxTurns} turns`);
}

export { agentsOn } from "../config/agents.js";
