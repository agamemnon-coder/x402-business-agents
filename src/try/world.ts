// D21: "change the world" on the public /try page. The visitor picks one of five world changes (the variation eval's
// worlds); the Sourcing agent wakes once and decides with its real model, in the autonomy runtime's own words: the same
// system prompt, brief, rules, tool schema and code check (src/autonomy/sourcingCore.ts). Only the storage differs: no
// ledger, no rail, nothing is paid; a message to the Treasury agent is shown, not delivered. Pure (the model comes in as
// a function), so the relay Worker, the local server and the tests run the same code.

import { z } from "zod";
import type { BuyPolicy } from "../agents/buyPolicy.js";
import { apiInputSchema } from "../agents/toolSchema.js";
import {
  BUY_POLICY_DESCRIPTION, BUY_POLICY_INPUT, checkBuyPolicy, FINISH_DESCRIPTION, MARKET_DESCRIPTION, policyFrom, policyWords, SEND_MESSAGE_DESCRIPTION,
  sourcingBrief, sourcingFallback, SOURCING_DISPLAY, SOURCING_GOAL, SOURCING_MODEL, SOURCING_RULES, systemFor, wakePrompt, type SourcingView,
} from "../autonomy/sourcingCore.js";
import { OTHERS, SAME, suppliersOf, wakeEventOf, WORLD_BUDGET_LEFT_CENTS, type WorldSpec } from "../autonomy/worldSpecs.js";

export interface WorldChange { id: string; label: string; detail: string; spec: WorldSpec }
const spec = (id: string) => [SAME, ...OTHERS].find((w) => w.id === id)!;
export const WORLD_CHANGES: WorldChange[] = [
  { id: "price-rise", label: "Stockline raises its price", detail: "Stockline goes from 0.03 to 0.04 a stock check, over the agent's 0.03 cap; Ridgeline Data sells at 0.03, with 15-minute-old data.", spec: spec("price-rise") },
  { id: "ridgeline-flaky", label: "Ridgeline Data starts failing", detail: "Stockline is at 0.04, over the cap; Ridgeline Data failed 10 of its last 20 tries.", spec: spec("ridgeline-flaky") },
  { id: "cap-raised", label: "The CFO raises the cap", detail: "The cap goes to 0.04 and the query price to 0.07; Stockline sells at 0.04.", spec: spec("cap-raised") },
  { id: "stockline-back", label: "Stockline drops its price", detail: "Stockline is back at 0.02 a stock check, under the cap.", spec: spec("stockline-back") },
  { id: "ridgeline-cheap-fresh", label: "Ridgeline Data: cheap and fresh", detail: "Ridgeline Data sells at 0.02 with one-minute-old data; Stockline is at 0.04.", spec: spec("ridgeline-cheap-fresh") },
];
export const worldChange = (id: string): WorldChange | undefined => WORLD_CHANGES.find((w) => w.id === id);

/** The buy policy before the agent wakes (the runtime's default: Stockline, up to the cap, no cache). */
export const START_POLICY: BuyPolicy = { supplier: "stockline", max_price: null, cache_seconds: 0 };
export const WORLD_DEMO_LABEL = "Demo world · stand-in suppliers · no money moves · a message to the Treasury agent is shown, not sent";
const MAX_CALLS = 5;
const MAX_MESSAGES = 2;
/** The runtime's reminder (src/autonomy/runtime.ts, `unfinished`). */
const UNFINISHED = "call finish with what you decided (or that you decided to do nothing) and why.";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type Content = string | unknown[];
export interface AgentRequest {
  model: string; system: string;
  /** The effort the runtime sends for this agent (src/agents/loop.ts: "medium" unless the agent says otherwise). */
  effort?: "low" | "medium" | "high";
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  messages: { role: "user" | "assistant"; content: Content }[];
}
export interface AgentReply {
  content: Block[]; stop_reason: string; model: string; ms: number; costUsd: number;
  /** The model's own blocks (thinking included), sent back unchanged as the runtime does. */
  raw?: unknown[];
  /** The API's request id: proof per call, as the runtime records it. */
  requestId?: string | null;
}
/** One Messages API call with tools (the real one in src/try/claude.ts; a stand-in in tests). */
export type AgentAsk = (req: AgentRequest) => Promise<AgentReply>;

export interface WorldStep { tool: string; input: Record<string, unknown>; answer: string; blocked: string | null }
export interface WorldResult {
  world: { id: string; label: string; detail: string };
  demo: string;
  source: "claude" | "code";
  /** Why code decided (no model, a failure, or no decision); null when Claude decided. */
  why: string | null;
  model: string | null;
  saw: string;
  steps: WorldStep[];
  policy_before: string;
  policy_after: string;
  messages: { to: string; text: string }[];
  summary: string;
  calls: number;
  /** The API's request id of each call. */
  request_ids: string[];
  ms: number;
  costUsd: number;
}

interface Tool { name: string; description: string; input: z.ZodType; run(input: never): { text: string; blocked?: string; final?: boolean } }

export async function tryWorld(id: string, ask: AgentAsk | null, now: Date, whyNoModel: string): Promise<WorldResult> {
  const change = worldChange(id);
  if (!change) throw new Error(`no world change called ${id}`);
  const w = change.spec;
  const suppliers = suppliersOf(w);
  let policy = START_POLICY;
  const view = (): SourcingView => ({ suppliers, capCents: w.cap, budgetLeftCents: WORLD_BUDGET_LEFT_CENTS, sellCents: w.sell, policy, card: null });
  const event = wakeEventOf(w);
  const situation = sourcingBrief(view());
  const prompt = wakePrompt({ now, situation, news: [`- event #1 ${event.kind}: ${JSON.stringify(event.payload).slice(0, 900)}`], memory: "none yet" });
  const steps: WorldStep[] = [];
  const messages: { to: string; text: string }[] = [];
  let summary = "";

  const tools: Tool[] = [
    { name: "market", description: MARKET_DESCRIPTION, input: z.strictObject({}), run: () => ({ text: sourcingBrief(view()) }) },
    {
      name: "set_buy_policy", description: BUY_POLICY_DESCRIPTION, input: BUY_POLICY_INPUT,
      run: (p: z.infer<typeof BUY_POLICY_INPUT>) => {
        const no = checkBuyPolicy(p, suppliers, w.cap, w.sell);
        if (no) return no;
        policy = policyFrom(p);
        return { text: `Buy policy set: ${policyWords(policy)}.` };
      },
    },
    {
      name: "send_message", description: SEND_MESSAGE_DESCRIPTION, input: z.strictObject({ to: z.enum(["support", "treasury"]), text: z.string().describe("Plain words, with the numbers") }),
      run: (m: { to: string; text: string }) => {
        if (messages.length >= MAX_MESSAGES) return { text: "Not sent: two messages per wake is the limit.", blocked: "message limit" };
        messages.push({ to: m.to, text: m.text.trim().slice(0, 500) });
        return { text: `Sent to the ${m.to === "treasury" ? "Treasury" : "Support"} agent.` };
      },
    },
    { name: "finish", description: FINISH_DESCRIPTION, input: z.strictObject({ summary: z.string() }), run: (f: { summary: string }) => { summary = f.summary.trim().slice(0, 600); return { text: "Noted.", final: true }; } },
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const req: AgentRequest = {
    model: SOURCING_MODEL, system: systemFor(SOURCING_DISPLAY, SOURCING_GOAL, SOURCING_RULES),
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: apiInputSchema(t.input) })),
    messages: [{ role: "user", content: prompt }],
  };

  const requestIds: string[] = [];
  let calls = 0, ms = 0, costUsd = 0, model: string | null = null, why: string | null = ask ? null : whyNoModel, done = false, nudged = false;
  if (ask) {
    try {
      while (calls < MAX_CALLS && !done) {
        const r = await ask(req);
        calls++;
        ms += r.ms; costUsd += r.costUsd; model = r.model;
        if (r.requestId) requestIds.push(r.requestId.slice(0, 80));
        if (r.stop_reason === "refusal") { why = "the model declined"; break; }
        const uses = r.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
        // As the runtime (src/agents/loop.ts): an answer cut off ends the wake, tool calls in it unrun; no tool call
        // gets one reminder in the runtime's words, then code's fallback decides.
        if (r.stop_reason !== "tool_use" || uses.length === 0) {
          if (r.stop_reason === "max_tokens") { why = "the answer was cut off"; break; }
          if (nudged) break;
          nudged = true;
          req.messages.push({ role: "assistant", content: r.raw ?? r.content });
          req.messages.push({ role: "user", content: `Not finished: ${UNFINISHED}` });
          continue;
        }
        req.messages.push({ role: "assistant", content: r.raw ?? r.content });
        const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
        for (const use of uses) {
          const tool = byName.get(use.name);
          let out: { text: string; blocked?: string; final?: boolean };
          let error = false;
          if (!tool) { out = { text: `There is no tool called ${use.name}.`, blocked: "unknown tool" }; error = true; }
          else {
            const fits = tool.input.safeParse(use.input);
            if (!fits.success) {
              out = { text: `The input does not fit ${use.name}'s schema (${fits.error.issues[0]?.path.join(".") || "root"}: ${fits.error.issues[0]?.message ?? "invalid"}). Nothing was done.`, blocked: "schema" };
              error = true;
            } else out = tool.run(fits.data as never);
          }
          steps.push({ tool: use.name.slice(0, 40), input: shown(use.input), answer: out.text, blocked: out.blocked ?? null });
          results.push({ type: "tool_result", tool_use_id: use.id, content: out.text, ...(error ? { is_error: true } : {}) });
          if (out.final) done = true;
        }
        if (!done) req.messages.push({ role: "user", content: results });
      }
      if (!done && !why) why = calls >= MAX_CALLS ? `no decision within ${MAX_CALLS} calls` : "the agent did not decide";
    } catch (e) {
      why = (e as Error).message.slice(0, 200);
    }
  }
  const claude = done && summary !== "";
  if (!claude) {
    // As in the runtime: what the agent already set stays; code's fallback adds its message.
    const f = sourcingFallback([event]);
    summary = f.summary;
    if (f.message) messages.push({ to: "treasury", text: f.message }); // the runtime's fallback sends it whatever Claude sent
  }
  return {
    world: { id: change.id, label: change.label, detail: change.detail }, demo: WORLD_DEMO_LABEL,
    source: claude ? "claude" : "code", why: claude ? null : why, model,
    saw: prompt, steps, policy_before: policyWords(START_POLICY), policy_after: policyWords(policy), messages, summary, calls, request_ids: requestIds, ms, costUsd,
  };
}

/** A tool input as the page shows it: short strings, nothing nested deep. */
function shown(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {}).slice(0, 8)) out[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 300) : typeof v === "number" || typeof v === "boolean" || v === null ? v : "…";
  return out;
}
