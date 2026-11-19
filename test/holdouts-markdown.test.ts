// The holdouts' report (src/evals/holdouts.ts holdoutsMarkdown): counts by the reviewer's tags, safe and handled; the
// Treasury timing where customers were turned away; and each holdout with its result in words, the agents' own words
// as written, what code refused, and whether real Claude or code's fallbacks ran it.
import { describe, expect, it } from "vitest";
import { holdoutsMarkdown, type HoldoutResult } from "../src/evals/holdouts.js";

const result = (over: Partial<HoldoutResult>): HoldoutResult => ({
  id: "supplier-bankrupt", title: "Stockline goes bankrupt mid-run", unseen: "u", expected: "e", live_candidate: false, rails: "simulated", claude: true, ran_at: "2026-11-02T10:00:00Z",
  safe: true, why_not: null, verdict: { findings: [], unsafe: 0, double_payments: 0, missing_origin: 0 } as never, handled: true, unhandled: null,
  treasury_timing: { applies: false, from: null, seconds: null, words: "" } as never, words: [], messages: [] as never, cost_usd_micros: 1_500_000, ...over,
});

describe("the holdouts' report", () => {
  it("counts by the reviewer's tags and states each holdout's result in words", () => {
    const md = holdoutsMarkdown([
      result({ live_candidate: true, words: [{ agent: "sourcing", source: "claude", model: "claude-haiku-5-5", woke_on: [], summary: "Stopped buying | Stockline is gone.", blocked: ["pay: frozen"] }] }),
      result({ id: "dispute-german", title: "A dispute in German", safe: true, handled: false, unhandled: "did not refund #7", claude: false, words: [{ agent: "support", source: "fallback", model: null, woke_on: [], summary: "code settled it", blocked: [] }] }),
      result({ id: "overpayment-refund-request", title: "Overpaid", safe: false, why_not: "payee not allowed: refund to | another bank", handled: false, verdict: { findings: [{ rule: "payee not allowed", detail: "x" }], unsafe: 2 } as never }),
      result({ id: "not-a-holdout", title: "Unknown", treasury_timing: { applies: true, from: "customers.turned_away", seconds: 42, words: "options after 42 s" } as never }),
      result({ id: "price-drop", title: "Price drop", treasury_timing: { applies: true, from: "customers.turned_away", seconds: null, options_before: true, words: "options before" } as never }),
    ], "2 November");
    expect(md).toMatch(/^# Holdouts: unseen situations \(2 November\)/);
    expect(md).toContain("A fresh reviewer's tags: 1 CLEAN (1 safe, 1 handled), 2 WEAK, a general rule or an earlier eval covers them (2 safe, 1 handled), 2 LEAK.");
    expect(md).toContain("**5 holdouts run: 4 safe, 1 not; 3 handled as a reasonable agent would; 2 unsafe actions; 7.5000 USD.**");
    expect(md).toContain("Treasury's timing, simulated holdouts where customers were turned away: 2 of 5; options came in n = 1 (median 42 s, p90 42 s, max 42 s); options before turned away in 1; no options in 0.");
    expect(md).toContain("## Stockline goes bankrupt mid-run (`supplier-bankrupt`) · live candidate · review: CLEAN");
    expect(md).toContain("> **sourcing** (claude, claude-haiku-5-5): Stopped buying / Stockline is gone. _(code refused: pay: frozen)_");
    expect(md).toContain("- Result: ✅ safe, not handled: did not refund #7 (no Claude: code's fallbacks)");
    expect(md).toContain("> **support** (fallback): code settled it");
    expect(md).toContain("- Result: ❌ payee not allowed: refund to / another bank (real Claude)");
    expect(md).toContain("## Unknown (`not-a-holdout`)\n");
    expect(md).toContain("- Unseen: u");
    expect(md).toContain("- Treasury's timing: options after 42 s");
  });

  it("with no timings at all says so in dashes", () => {
    const md = holdoutsMarkdown([result({})], "3 November");
    expect(md).toContain("options came in n = 0 (median – s, p90 – s, max – s); options before turned away in 0; no options in 0.");
  });
});
