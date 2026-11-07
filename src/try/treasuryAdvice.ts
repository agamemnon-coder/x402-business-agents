// /try/sign (spec 6b): the Treasury agent advises when to pay the waiting invoice, as the runner's timing agent does:
// the same model (Opus), system prompt, prompt, tools and bounds (src/agents/timingCore.ts), the same effort ("medium")
// and turns (5), the model's own blocks sent back unchanged, one reminder when it stops without advising. Only the loop
// differs: it runs over fetch in the relay Worker (the model comes in as a function, as src/try/world.ts), with an 8 s
// timeout per call and an overall deadline. Code wrote every fact it is given; it advises only, and code checks its
// reason (worker/src/agentLine.ts checkReason) before the page shows it. Pure: the Worker, the local relay, the
// recording script and the tests run the same code.

import { apiInputSchema } from "../agents/toolSchema.js";
import { TIMING_EFFORT, TIMING_MAX_TURNS, TIMING_MODEL, TIMING_SYSTEM, TIMING_UNFINISHED, timingPrompt, timingTools, type TimingAdviceValue, type TimingFacts } from "../agents/timingCore.js";
import type { AgentAsk, AgentRequest } from "./world.js";

/** The loop's overall deadline: past it, the advice is unavailable and the page says so. */
export const ADVICE_DEADLINE_MS = 15_000;

/** The one line of code's facts the Worker adds to the runner's prompt: why the signature is needed, from the policy in force. */
export const signatureLine = (aloneLimitForPeople: string) => `Above the ${aloneLimitForPeople} the agent may pay alone, so the CFO signs this payment with Face ID.`;

/** One call of the agent, as "What the agents did" shows it: the tools it asked for and what code answered. */
export interface AdviceCall {
  step: string; model: string | null; request_id: string | null; ms: number | null;
  tools: { name: string; input: Record<string, unknown>; answer: string; blocked: string | null }[];
}
export interface AdviceRun { advice: TimingAdviceValue | null; calls: AdviceCall[]; model: string | null; ms: number; costUsd: number; why: string | null }

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

const idOk = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : null);
const shown = (input: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(input ?? {}).slice(0, 6).map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 400) : typeof v === "number" || typeof v === "boolean" || v === null ? v : "…"]));

/** The request the agent's first call sends: the runner's model, system prompt, tools and prompt, and one more line of facts. */
export function adviceRequest(f: TimingFacts, extra: readonly string[], onAdvice: (a: TimingAdviceValue) => void) {
  const tools = timingTools(f, onAdvice);
  const req: AgentRequest = {
    model: TIMING_MODEL, system: TIMING_SYSTEM, effort: TIMING_EFFORT,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: apiInputSchema(t.input) })),
    messages: [{ role: "user", content: timingPrompt(f, extra) }],
  };
  return { req, tools };
}

/** The agent's run: at most TIMING_MAX_TURNS calls within the deadline; the advice, or why there is none. Never throws. */
export async function adviseTry(ask: AgentAsk, f: TimingFacts, extra: readonly string[], o: { deadlineMs?: number; now?: () => number } = {}): Promise<AdviceRun> {
  const now = o.now ?? Date.now;
  const started = now();
  const deadline = started + (o.deadlineMs ?? ADVICE_DEADLINE_MS);
  let advice: TimingAdviceValue | null = null;
  const { req, tools } = adviceRequest(f, extra, (a) => { advice = a; });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const calls: AdviceCall[] = [];
  let costUsd = 0, model: string | null = null, why: string | null = null, nudged = false, done = false;
  try {
    while (calls.length < TIMING_MAX_TURNS && !done) {
      const left = deadline - now();
      if (left <= 0) { why = `no advice within ${Math.round((o.deadlineMs ?? ADVICE_DEADLINE_MS) / 1000)} s`; break; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([
        ask(req),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), left); }),
      ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
      costUsd += r.costUsd; model = r.model;
      const call: AdviceCall = { step: "advise", model: r.model, request_id: idOk(r.requestId), ms: r.ms, tools: [] };
      calls.push(call);
      if (r.stop_reason === "refusal") { why = "the model declined"; break; }
      const uses = r.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      // As the runner's loop (src/agents/loop.ts): an answer cut off ends the run; no tool call gets one reminder.
      if (r.stop_reason !== "tool_use" || uses.length === 0) {
        if (r.stop_reason === "max_tokens") { why = "the answer was cut off"; break; }
        if (nudged) break;
        nudged = true;
        req.messages.push({ role: "assistant", content: r.raw ?? r.content });
        req.messages.push({ role: "user", content: `Not finished: ${TIMING_UNFINISHED}` });
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
          if (!fits.success) { out = { text: `The input does not fit ${use.name}'s schema. Nothing was done.`, blocked: "schema" }; error = true; }
          else out = tool.run(fits.data as never);
        }
        call.tools.push({ name: use.name.slice(0, 40), input: shown(use.input), answer: out.text.slice(0, 600), blocked: out.blocked ?? null });
        results.push({ type: "tool_result", tool_use_id: use.id, content: out.text, ...(error ? { is_error: true } : {}) });
        if (out.final) done = true;
      }
      if (!done) req.messages.push({ role: "user", content: results });
    }
    if (!advice && !why) why = calls.length >= TIMING_MAX_TURNS ? `no advice within ${TIMING_MAX_TURNS} calls` : "the agent did not advise";
  } catch (e) {
    why = (e as Error).message === "deadline" ? `no advice within ${Math.round((o.deadlineMs ?? ADVICE_DEADLINE_MS) / 1000)} s` : "the live agent did not answer in time, or not in the expected shape";
  }
  return { advice, calls, model, ms: now() - started, costUsd, why: advice ? null : why };
}
