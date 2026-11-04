// What one Claude call costs, from its token usage. Prices are Anthropic's published list prices in USD
// (https://platform.claude.com/docs/en/about-claude/pricing, read 30 October 2026), standard global routing, no
// batch. Kept as nano-dollars per token (USD per million tokens × 1000) so every sum is an integer.

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  /** Tokens written to the 5-minute prompt cache. */
  cache_write: number;
}

interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }

const usd = (input: number, cacheWrite: number, cacheRead: number, output: number): Price =>
  ({ input: input * 1000, cacheWrite: cacheWrite * 1000, cacheRead: cacheRead * 1000, output: output * 1000 });

export const PRICES: Record<string, { standard: Price; longPrompt?: { over: number; price: Price } }> = {
  "claude-opus-5-5": { standard: usd(4, 5, 0.2, 20) },
  "claude-sonnet-5-5": { standard: usd(2, 2.5, 0.1, 10) },
  // Haiku 5.5 is priced by prompt length: input, cache reads and cache writes together.
  "claude-haiku-5-5": { standard: usd(0.1, 0.125, 0.01, 0.5), longPrompt: { over: 100_000, price: usd(0.5, 0.625, 0.05, 2.5) } },
};

/** The call's cost in micro-dollars, rounded up; null for a model without a known price. */
export function callCostMicros(model: string, u: Usage): number | null {
  const entry = PRICES[model];
  if (!entry) return null;
  const prompt = u.input + u.cache_read + u.cache_write;
  const p = entry.longPrompt && prompt > entry.longPrompt.over ? entry.longPrompt.price : entry.standard;
  const nano = Math.round(u.input * p.input + u.cache_write * p.cacheWrite + u.cache_read * p.cacheRead + u.output * p.output);
  return Math.ceil(nano / 1000);
}
