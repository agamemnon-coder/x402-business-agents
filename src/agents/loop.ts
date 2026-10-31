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

export interface ToolResult {
  /** What Claude reads back. */
  text: string;
  /** The check that stopped this call (a mandate cap, a policy limit, missing evidence…); absent when it went through. */
  blocked?: string;
  /** The run ends here, without asking Claude again (a plan was accepted, an escalation was filed). */
  final?: boolean;
}

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
}

const short = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function runAgent(db: DB, spec: AgentSpec, client: Anthropic | null = claudeClient(), clock: () => number = Date.now): Promise<AgentRun> {
  const started = clock();
  const calls: AgentCall[] = [];
  let turns = 0, costMicros = 0, model: string | null = null, text = "";
  const finish = (status: AgentRun["status"], note?: string): AgentRun => {
    const run: AgentRun = { status, model, calls, text: redactSecrets(text), turns, costMicros, ...(note ? { note: redactSecrets(note) } : {}) };
    audit(db, spec.agent, "agent.run", spec.task, {
      agent: spec.agent, model: model ?? spec.model, status, turns, tools: calls.map((c) => c.tool),
      blocked: calls.filter((c) => c.blocked).map((c) => `${c.tool}: ${c.blocked}`),
      said: short(run.text, 1200), cost_usd_micros: costMicros, latency_ms: clock() - started, ...(note ? { note: run.note! } : {}),
    });
    return run;
  };
  if (!client) return finish("unavailable", "no KIT11_ANTHROPIC_API_KEY");

  const byName = new Map(spec.tools.map((t) => [t.name, t]));
  const tools = spec.tools.map((t) => ({
    name: t.name, description: t.description, strict: true,
    input_schema: z.toJSONSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: spec.prompt }];
  const maxTurns = spec.maxTurns ?? 8;

  while (turns < maxTurns) {
    turns++;
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model: spec.model,
        max_tokens: 16000,
        system: [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        output_config: { effort: spec.effort ?? "medium" },
        // Haiku has no server-side fallback; Sonnet 5.5 and Opus 5.5 take the "default" routing.
        ...(spec.model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    } catch (err) {
      const message = err instanceof Anthropic.APIError ? `API ${err.status ?? ""} ${err.name}` : (err as Error).message;
      return finish("unavailable", `call failed: ${short(message, 200)}`);
    }
    model = res.model;
    const u = res.usage;
    const usage: Usage = { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 };
    costMicros += callCostMicros(res.model, usage) ?? 0;
    if (res.stop_reason === "refusal") {
      const cat = (res.stop_details as { category?: string } | null | undefined)?.category ?? "no category";
      return finish("unavailable", `refused (${cat})`);
    }
    const said = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (said) text = said;
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      if (res.stop_reason === "max_tokens") return finish("incomplete", "the answer was cut off");
      return finish("done");
    }
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let final = false;
    for (const use of uses) {
      const tool = byName.get(use.name);
      let out: ToolResult;
      let error = false;
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
            out = await tool.run(fits.data);
          } catch (e) {
            out = { text: `The tool stopped: ${(e as Error).message}. Nothing more was done.`, blocked: "error" };
            error = true;
          }
        }
      }
      const call: AgentCall = { tool: use.name, input: redactJson(use.input as never), text: redactSecrets(out.text), ...(out.blocked ? { blocked: out.blocked } : {}) };
      calls.push(call);
      audit(db, spec.agent, "agent.tool", spec.task, {
        agent: spec.agent, model: res.model, tool: use.name, input: call.input as never, result: short(call.text), ...(out.blocked ? { blocked_by: out.blocked } : {}),
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
