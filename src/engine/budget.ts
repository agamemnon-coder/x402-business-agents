// Claude in the engine under hard ceilings that fail closed. An action that may ask Claude (an upload, a payment's
// proposal) first reserves its worst case against the company's, the pool's, the address's and the all-time caps
// (cloud/src/engine/spend.ts). Within the action, each call is checked before it is sent: its worst case (all of
// max_tokens at the output price, and the prompt at the cache-write price) must fit what the action has left, or the
// call is not made and the parser reads. After the action, the reservation is settled to what the calls cost.
//
// Nothing here moves money: these are the costs of Claude calls, in micro-USD at list price (src/claude/pricing.ts).
import Anthropic from "@anthropic-ai/sdk";
import { PRICES } from "../claude/pricing.js";

/** What an action may still spend on Claude, in micro-USD. */
export interface Budget {
  left(): number;
  spend(micros: number): void;
}

/** A budget of `micros` for one action. */
export function actionBudget(micros: number): Budget {
  let left = micros;
  return { left: () => left, spend: (m) => { left -= m; } };
}

/** Why Claude was not asked: the words claude.capped carries (src/engine/events.ts holds the same list). */
export type CappedReason = "switch_off" | "no_key" | "action_budget" | "company_cap" | "pool_day_cap" | "address_cap" | "all_time_cap" | "busy";

/**
 * The most one call can cost, in micro-USD, rounded up: every token of max_tokens at the output price, and the prompt
 * (estimated as one token per 3 characters, more than real text takes) at the dearest input price the model has (the
 * cache-write price, on the long-prompt tier where there is one). A model without a known price cannot be bounded:
 * Infinity, so the call is never made under a budget.
 */
export function worstCaseMicros(model: string, maxTokens: number, promptChars: number): number {
  const entry = PRICES[model];
  if (!entry) return Infinity;
  const tiers = [entry.standard, ...(entry.longPrompt ? [entry.longPrompt.price] : [])];
  const input = Math.max(...tiers.map((p) => Math.max(p.input, p.cacheWrite)));
  const output = Math.max(...tiers.map((p) => p.output));
  return Math.ceil((Math.ceil(promptChars / 3) * input + maxTokens * output) / 1000);
}

/**
 * The Anthropic client of a visitor's company (the engine in the cloud): a call that takes more than 30 seconds is a
 * labelled fallback, and the SDK retries nothing (a retry would be a second call outside the action's budget).
 */
export function tryClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });
}
