// The live turns of /try/negotiate: one Messages API call per turn (Claude Haiku, low effort, no extended thinking,
// structured output), fetch only, a timeout per turn, no retries. Every call is bounded first: its worst case must fit
// what the negotiation's reservation has left (as src/engine/budget.ts worstCaseMicros bounds the engine's), or it is
// not sent.
// This file runs in the cloud Worker itself, which must not load the engine's modules (src/engine, src/claude: held by
// test/cloud-engine-bundle.test.ts), so Haiku's list prices are stated here; test/negotiate-rails.test.ts holds them
// equal to src/claude/pricing.ts and the bound equal to worstCaseMicros.
import { ANSWER_SCHEMA, TURN_MAX_TOKENS, TURN_TIMEOUT_MS, type AgentAnswer, type Speak } from "./negotiate.js";

/** Claude Haiku 5.5 (src/try/claude.ts HAIKU). */
export const NEGOTIATE_MODEL = "claude-haiku-5-5";
/** Its list prices in nano-USD a token (src/claude/pricing.ts): the standard tier, and the dearest of its tiers. */
export const HAIKU_NANO = { input: 100, output: 500, dearestInput: 625, dearestOutput: 2_500 } as const;

/** What a negotiation may still spend on Claude, in micro-USD (the shape of src/engine/budget.ts Budget). */
export interface Budget { left(): number; spend(micros: number): void }
export function actionBudget(micros: number): Budget {
  let left = micros;
  return { left: () => left, spend: (m) => { left -= m; } };
}
/** The worst case of a call: the prompt (one token per 3 characters) at the dearest input price, every answer token at the dearest output price. */
export const worstMicros = (maxTokens: number, promptChars: number): number => Math.ceil((Math.ceil(promptChars / 3) * HAIKU_NANO.dearestInput + maxTokens * HAIKU_NANO.dearestOutput) / 1000);
/** What a call cost, from its usage, at the standard tier (a turn's prompt is far below the long-prompt tier). */
export const costMicros = (input: number, output: number): number => Math.ceil(Math.round(input * HAIKU_NANO.input + output * HAIKU_NANO.output) / 1000);

/** Why a turn was not sent or did not answer; the route then shows the recorded negotiation, labelled. */
export class TurnFailed extends Error {}

/** The worst case of one turn, in micro-USD: every token of the answer at the output price, the prompt at the dearest input price. */
export const turnWorstMicros = (system: string, prompt: string): number => worstMicros(TURN_MAX_TOKENS, system.length + prompt.length + 600);

export function claudeSpeak(key: string, budget: Budget, fetcher: typeof fetch = fetch, timeoutMs = TURN_TIMEOUT_MS): Speak {
  return async (_who, system, prompt) => {
    const worst = turnWorstMicros(system, prompt);
    if (!(worst <= budget.left())) throw new TurnFailed("the negotiation's Claude budget is spent");
    budget.spend(worst);
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetcher("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctl.signal,
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: NEGOTIATE_MODEL, max_tokens: TURN_MAX_TOKENS, system, thinking: { type: "disabled" },
          output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_SCHEMA } },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new TurnFailed(`Claude answered HTTP ${res.status}`);
      const j = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      if (j.stop_reason === "refusal") throw new TurnFailed("Claude declined the turn");
      let a: Partial<AgentAnswer>;
      try { a = JSON.parse(j.content?.find((b) => b.type === "text")?.text ?? "") as Partial<AgentAnswer>; } catch { throw new TurnFailed("Claude's answer was not the expected shape"); }
      if (typeof a.message !== "string" || typeof a.amount !== "string" || typeof a.pay_by !== "string" || typeof a.accept !== "boolean") throw new TurnFailed("Claude's answer was not the expected shape");
      const micros = j.usage ? costMicros(j.usage.input_tokens ?? 0, j.usage.output_tokens ?? 0) : worst;
      // The budget keeps the worst case until the route settles the reservation with what the turns really cost.
      return { answer: { message: a.message, amount: a.amount, pay_by: a.pay_by, iban: typeof a.iban === "string" ? a.iban : "", accept: a.accept }, model: NEGOTIATE_MODEL, ms: Date.now() - started, micros };
    } catch (x) {
      if (x instanceof TurnFailed) throw x;
      throw new TurnFailed(ctl.signal.aborted ? "Claude did not answer in time" : "Claude could not be reached");
    } finally {
      clearTimeout(timer);
    }
  };
}
