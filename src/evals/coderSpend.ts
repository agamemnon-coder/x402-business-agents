// The spend guard of the Coder's live evals (src/cli/coderEvals.ts). The CLI must stop before a call could take the run
// over --max-usd or the coder block over its cap. What a whole case will cost is not known in advance (up to
// CODER_MAX_TURNS calls, a nudge and a retry), so the guard sits on the Claude client itself and checks before every
// call the most that one call can cost against the room that is left.

import type Anthropic from "@anthropic-ai/sdk";
import { callCostMicros, PRICES } from "../claude/pricing.js";

/** The parts of a request the guard reads. */
interface Request { model: string; max_tokens: number; system?: unknown; tools?: unknown; messages: unknown; fallbacks?: unknown }

// The tokens the API adds around a request with tools (its own tool instructions), counted on top as a margin.
const OVERHEAD_TOKENS = 2000;

/**
 * The most one call can cost, in micro-dollars: every byte of the request as a token at the dearest input rate (the
 * cache write; a token is never less than one byte), and max_tokens of output. A request that may fall back to
 * another model is priced at the dearest model. A model without a known price has no bound: Infinity.
 */
export function worstCallMicros(req: Request): number {
  const bytes = Buffer.byteLength(JSON.stringify([req.system ?? null, req.tools ?? null, req.messages]), "utf8");
  const usage = { input: 0, output: req.max_tokens, cache_read: 0, cache_write: bytes + OVERHEAD_TOKENS };
  const models = req.fallbacks ? [req.model, ...Object.keys(PRICES)] : [req.model];
  return Math.max(...models.map((m) => callCostMicros(m, usage) ?? Infinity));
}

export interface SpendGuard {
  /** The client to hand to the runner: it makes a call only when the call's worst cost fits in the room left. */
  client: Anthropic;
  /** What the calls made through it cost, in micro-dollars, from the API's own token counts. */
  used(): number;
  /** Why it refused a call, or null while it has refused none. */
  refused(): string | null;
}

/**
 * Wraps a Claude client. room() is what may still be spent, in micro-dollars, not counting the calls made through
 * this guard (it subtracts those itself). A call whose worst cost does not fit is not made: the guard throws, the
 * runner ends the run as unavailable, and refused() says why, so the caller stops the evals.
 */
export function spendGuard(inner: Anthropic, room: () => number): SpendGuard {
  let used = 0;
  let refused: string | null = null;
  const create = async (req: Request, options?: unknown) => {
    const worst = worstCallMicros(req);
    const left = room() - used;
    if (worst > left) {
      refused = `the next call could cost up to ${(worst / 1e6).toFixed(4)} USD and only ${(Math.max(left, 0) / 1e6).toFixed(4)} USD is left`;
      throw new Error(`spend limit: ${refused}`);
    }
    // The runner turns the SDK's own retries off; the guard keeps that.
    const c = inner.withOptions ? inner.withOptions({ maxRetries: 0 }) : inner;
    const res = await (c.beta.messages.create as (r: Request, o?: unknown) => Promise<Anthropic.Beta.BetaMessage>)(req, options);
    const u = res.usage;
    used += callCostMicros(res.model, { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 }) ?? 0;
    return res;
  };
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { client, used: () => used, refused: () => refused };
}
