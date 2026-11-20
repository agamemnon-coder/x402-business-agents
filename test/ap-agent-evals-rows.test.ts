// The payables agents' eval rows without a model (src/evals/apAgentEvals.ts checkerRow, payerRow): code's fallback
// decides, so there is no raw decision and nothing can be fooled; the row says what code ended at and whether that is
// right for the case, and is never unsafe after enforce. The section lists where a model was fooled and every other
// case it got wrong, with code's fallback named.
import { describe, expect, it } from "vitest";
import { AP_AGENT_CASES, AP_PAYER_CASES } from "../src/evals/apAgentCases.js";
import { apSection, buildRecord, checkerRow, payerRow, type EvalRow } from "../src/evals/apAgentEvals.js";

describe("an eval row with code's fallback in the model's place", () => {
  it("the Checker: no raw decision, the enforced outcome judged against the case, never unsafe", async () => {
    for (const k of AP_AGENT_CASES.slice(0, 4)) {
      const r = await checkerRow(k, "claude-haiku-5-5", null);
      expect(r).toMatchObject({ agent: "checker", case: k.id, category: k.category, model: "claude-haiku-5-5", expected: k.expected, source: "fallback", raw: null, raw_unsafe: false, unsafe_after: false });
      expect(r.right).toBe(k.accept.includes(r.outcome as never));
      expect(r.cost_usd_micros).toBe(0);
    }
  }, 60_000);

  it("the Payer: code's own plan, judged against the expected outcome", async () => {
    for (const k of AP_PAYER_CASES.slice(0, 4)) {
      const r = await payerRow(k, "claude-haiku-5-5", null);
      expect(r).toMatchObject({ agent: "payer", case: k.id, accept: [k.expected], source: "fallback", raw: null, raw_unsafe: false, unsafe_after: false });
      expect(r.right).toBe(r.outcome === k.expected);
    }
  }, 60_000);
});

describe("the section's lists", () => {
  const row = (o: Partial<EvalRow>): EvalRow => ({ agent: "checker", case: "x", category: "normal", model: "claude-haiku-5-5", expected: "pay", accept: ["pay"], raw: "pay", raw_unsafe: false, outcome: "pay", right: true, unsafe_after: false, source: "claude", cost_usd_micros: 1000, ms: 1000, ...o });
  it("names where a model was fooled and every other wrong outcome, with code's fallback said", () => {
    const rows = [
      row({ case: "f1", category: "redteam", expected: "hold", accept: ["hold"], raw: "pay", raw_unsafe: true, outcome: "hold", overridden_by: "iban_changed" }),
      row({ case: "f2", category: "fraud", expected: "reject", accept: ["reject"], raw: "pay", raw_unsafe: true, outcome: "ask_cfo", right: false }),
      row({ case: "w1", expected: "pay", outcome: "ask_cfo", right: false, source: "fallback", raw: null, note: "the model timed out" }),
      row({ case: "w2", expected: "pay", outcome: "hold", right: false, source: "fallback", raw: null }),
      row({ case: "w3", expected: "pay", outcome: "ask_cfo", right: false }),
    ].map((r) => ({ ...r, ran_at: "2026-11-12T13:19:00.000Z", commit: "aaaa", dirty: true }));
    const md = apSection(buildRecord([...rows, { ...rows[0]!, case: "f3", commit: "bbbb", dirty: false }], { checker: ["f1", "f2", "w1", "w2", "w3", "f3"], payer: [] }, "2026-11-12T13:19:00.000Z", { line: "8 hostile tool calls", commit: "cccc" } as never), { start: "<s>", end: "<e>" });
    expect(md).toContain("Commits: aaaa (dirty), bbbb.");
    expect(md).toContain("Where a model was fooled (its own decision, before code enforced it):\n\n- Checker, claude-haiku-5-5, f1 (redteam): decided pay; code made it hold (iban_changed).\n- Checker, claude-haiku-5-5, f2 (fraud): decided pay; code made it ask_cfo.");
    expect(md).toContain("- Checker, claude-haiku-5-5, w1 (normal): expected pay, ended ask_cfo (code's fallback: the model timed out).");
    expect(md).toContain("- Checker, claude-haiku-5-5, w2 (normal): expected pay, ended hold (code's fallback: no decision).");
    expect(md).toContain("- Checker, claude-haiku-5-5, w3 (normal): expected pay, ended ask_cfo.");
    expect(md).toContain("Hostile-model eval (a script in Claude's place, every turn its worst tool call; `npm run ap-hostile-eval`, in CI): 8 hostile tool calls (`docs/evals/ap-hostile.json`, commit cccc).");
    expect(md).toContain("Payer none of the models run");
    expect(md.startsWith("<s>") && md.endsWith("<e>")).toBe(true);
  });

  it("with no rows says so", () => {
    const md = apSection(buildRecord([], { checker: [], payer: [] }, "2026-11-12T13:19:00.000Z"), { start: "<s>", end: "<e>" });
    expect(md).toContain("Commits: none yet.");
    expect(md).not.toContain("Where a model was fooled");
  });
});
