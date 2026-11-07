// Block 5.3: the Treasury agent (Opus) advises when to pay a planned euro invoice (the licence). Code has already
// planned the payment: the FX quote is locked for the shortfall, the floors are checked, the proposal waits for Face ID.
// The agent reads the live position and the quote and advises paying now or waiting until a date. Advisory only: the
// advice cannot change the terms; the quote's validity and the CFO's Face ID stay the rules. Code bounds the advice: a
// wait ends at least two days before the due date (SWIFT time) and not today, with a reason. The prompt, the tools and
// their bounds are src/agents/timingCore.ts, which /try/sign's Worker runs too.

import type Anthropic from "@anthropic-ai/sdk";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { runAgent, type AgentRun, type AgentTool } from "./loop.js";
import { TIMING_EFFORT, TIMING_MAX_TURNS, TIMING_SYSTEM, TIMING_UNFINISHED, licenceNumbers, timingPrompt, timingTools, type TimingAdviceValue, type TimingFacts } from "./timingCore.js";
import type { z } from "zod";

export { licenceNumbers, licenceNumbersLine, type TimingFacts } from "./timingCore.js";

export interface TimingAdvice { source: "claude" | "fallback"; timing: "pay_now" | "wait_until" | null; date: string | null; reason: string; run: AgentRun }

export async function adviseTiming(db: DB, f: TimingFacts, client: Anthropic | null = claudeClient(), model: string = MODELS.review): Promise<TimingAdvice> {
  // Code's numbers must add up before the agent quotes them: if not, no call, and the proposal stands as code planned it.
  try { licenceNumbers(f); } catch (e) {
    const note = (e as Error).message;
    return { source: "fallback", timing: null, date: null, reason: "", run: { status: "unavailable", model: null, calls: [], text: "", turns: 0, costMicros: 0, note } };
  }
  let advice: TimingAdviceValue | null = null;
  const tools = timingTools(f, (a) => { advice = a; }).map((t): AgentTool<z.ZodType> => ({ name: t.name, description: t.description, input: t.input, run: async (input) => t.run(input as never) }));
  const run = await runAgent(db, {
    agent: "treasury", task: `licence.timing.${f.proposalId}`, model, system: TIMING_SYSTEM, maxTurns: TIMING_MAX_TURNS, effort: TIMING_EFFORT,
    unfinished: () => (advice ? null : TIMING_UNFINISHED),
    prompt: timingPrompt(f),
    tools,
  }, client);
  const a = advice as TimingAdviceValue | null;
  const timing = a?.timing ?? null, date = a?.date ?? null, reason = a?.reason ?? "";
  const source = timing ? "claude" : "fallback";
  if (timing) audit(db, "treasury", "licence.timing_advised", f.proposalId, { proposal_id: f.proposalId, timing, date, reason, source, model: run.model, invoice_no: f.invoiceNo });
  return { source, timing, date, reason, run };
}
