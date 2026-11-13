// Claude in the engine under hard ceilings that fail closed. An action that may ask Claude (an upload, a payment's
// proposal) first reserves its worst case against the company's, the pool's, the address's and the all-time caps
// (cloud/src/engine/spend.ts). Within the action, each call is checked before it is sent: its worst case (all of
// max_tokens at the output price, and the prompt at the cache-write price) must fit what the action has left, or the
// call is not made and the parser reads. After the action, the reservation is settled to what the calls cost.
//
// Nothing here moves money: these are the costs of Claude calls, in micro-USD at list price (src/claude/pricing.ts).
import Anthropic from "@anthropic-ai/sdk";
import type { Asker } from "../ap/read.js";
import { PRICES } from "../claude/pricing.js";
import type { DB } from "../db/open.js";

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

/** An action's reservation: its ceiling, and how it is settled to what the action really cost. */
export interface Reservation { micros: number; settle(actualMicros: number): Promise<void> }

/**
 * Claude for one company's engine, as its host gives it (cloud/src/engine/hostWorker.ts): reserve an action's ceiling
 * against the caps, or hear why not; a reader for that action, spending from its budget; and, for the status, whether
 * Claude may read at all and the company's cap.
 */
export interface ClaudeAccess {
  /** `spare`: work no one waits on yet (the Payer, early), reserved only with room to spare under every cap (cloud/src/engine/spend.ts). */
  reserve(opts?: { spare?: boolean }): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: CappedReason }>;
  reader(db: DB, budget: Budget): Asker;
  /**
   * Task A6: the Anthropic client the payables agents (the Checker, the Coder, the Payer) use within the same action,
   * spending from the same budget (budgetedClient); null without a key. Absent: the agents are not run.
   */
  agents?(budget: Budget): Anthropic | null;
  /** spent_micros: what the company has spent or holds reserved, as the caps count it; null when no figure is kept. */
  status(): Promise<{ on: boolean; cap_micros: number | null; spent_micros: number | null }>;
}

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

/** The most an agent's answer may hold in a visitor's company (task A6). */
export const AGENT_MAX_TOKENS = 2_000;
/**
 * The agents' effort in a visitor's company (speed, 12 Nov): low. At medium, the Payer's final answer thought for 1,824
 * output tokens, 9 s on Haiku, while the visitor waited on Pay; code enforces every boundary of the answer either way.
 */
export const AGENT_EFFORT = "low" as const;

/** Why an agent's call was not sent: its worst case did not fit what the action had left. The agent loop stops, and code decides, labelled. */
export class ActionBudgetSpent extends Error {}

/**
 * An agent's client within one action's budget (task A6): every call's max_tokens is held to `maxTokens`, and before it
 * is sent its worst case (worstCaseMicros, over every model that may answer it when a server-side fallback is asked for)
 * must fit what the action has left; it is then taken from the budget, as the reader does. A call that does not fit is
 * not sent: the agent's run ends unavailable and code's fallback decides, labelled. The SDK retries nothing.
 */
export function budgetedClient(inner: Anthropic, budget: Budget, maxTokens = AGENT_MAX_TOKENS, effort: "low" | "medium" | "high" = AGENT_EFFORT): Anthropic {
  type Params = { model: string; max_tokens: number; system?: unknown; tools?: unknown; messages: unknown; fallbacks?: unknown; output_config?: Record<string, unknown> };
  const create = async (params: Params, options?: unknown): Promise<unknown> => {
    // Haiku 5.5 thinks by default; a visitor waits on every turn, so the engine's Haiku agents answer without it
    // (accepted at effort high or below). Other models keep their adaptive thinking.
    const req = { ...params, max_tokens: Math.min(params.max_tokens, maxTokens), output_config: { ...(params.output_config ?? {}), effort },
      ...(params.model.startsWith("claude-haiku") ? { thinking: { type: "disabled" } } : {}) };
    const chars = JSON.stringify([req.system ?? null, req.tools ?? null, req.messages]).length;
    const models = req.fallbacks ? [req.model, ...Object.keys(PRICES)] : [req.model];
    const worst = Math.max(...models.map((m) => worstCaseMicros(m, req.max_tokens, chars)));
    if (!(worst <= budget.left())) throw new ActionBudgetSpent(`action_budget: the next call could cost up to ${worst} micro-USD and the action has ${Math.max(0, budget.left())} left`);
    budget.spend(worst);
    const c = typeof inner.withOptions === "function" ? inner.withOptions({ maxRetries: 0 }) : inner;
    return (c.beta.messages.create as unknown as (r: Params, o?: unknown) => Promise<unknown>)(req, options);
  };
  const wrapped = { beta: { messages: { create } }, withOptions: (): Anthropic => wrapped as unknown as Anthropic };
  return wrapped as unknown as Anthropic;
}
