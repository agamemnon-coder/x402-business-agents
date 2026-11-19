// The ledger agents' eval rows (src/evals/ledgerAgentEvals.ts) with a scripted model: a review that finds nothing passes
// a clean month and fails a month with a duplicate (named as missed); a model that never finishes is no checked answer;
// a books answer of the ledger's own figure passes, a planted amount fails; a schedule code refuses is no schedule.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { BOOKS_CASES, CONTROLLER_CASES, SCHEDULE_CASES } from "../src/evals/ledgerAgentCases.js";
import { runBooksCase, runControllerCase, runScheduleCase } from "../src/evals/ledgerAgentEvals.js";

type Call = { name: string; input: unknown };
function scripted(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-sonnet-5-5", usage };
  } } } } as unknown as Anthropic;
}
const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)!;

describe("the Controller's eval rows", () => {
  const review = [[{ name: "list_invoices", input: {} }], [{ name: "finish", input: { summary: "Nothing to correct this month." } }]];
  it("a review that proposes nothing passes a clean month and misses the duplicate in another", async () => {
    const clean = await runControllerCase(byId(CONTROLLER_CASES, "clean-month"), scripted(review), "claude-sonnet-5-5", 0);
    expect(clean).toMatchObject({ agent: "controller", case: "clean-month", source: "claude", passed: true, mistakes: [] });
    expect(clean.detail).toMatch(/^nothing proposed; summary: "Nothing to correct this month\."$/);
    const dup = await runControllerCase(byId(CONTROLLER_CASES, "dup-same-number"), scripted(review), "claude-sonnet-5-5", 0);
    expect(dup.passed).toBe(false);
    expect(dup.mistakes).toEqual(["missed bt-oct-again as duplicate"]);
  });

  it("a model that never finishes is reported as not finished", async () => {
    const r = await runControllerCase(byId(CONTROLLER_CASES, "clean-month"), scripted([]), "claude-sonnet-5-5", 0);
    expect(r.passed).toBe(false);
    expect(r.mistakes[0]).toMatch(/^the agent did not finish: /);
  });
});

describe("the books agent's eval rows", () => {
  it("an answer it cannot check is no checked answer; without a model, code's fallback is labelled", async () => {
    const c = byId(BOOKS_CASES, "eur-bank-balance");
    const r = await runBooksCase(c, scripted([[{ name: "answer", input: { text: "It is 99.99.", figures: [], cannot_answer: false } }]]), "claude-sonnet-5-5", 0);
    expect(r.passed).toBe(false);
    expect(r.mistakes[0]).toMatch(/^no checked answer from the agent: /);
    const code = await runBooksCase(c, null, "claude-sonnet-5-5", 0);
    expect(code.model).toBe("code (fallback)");
  });
});

describe("the schedule's eval rows", () => {
  it("a schedule code refuses on every try leaves no schedule from the agent", async () => {
    const c = SCHEDULE_CASES[0]!;
    const bad = { name: "propose_schedule", input: { payments: [{ doc_ref: "NOT-AN-INVOICE", pay_on: "2026-11-03" }], deferred: [], summary: "pay it" } };
    const r = await runScheduleCase(c, scripted([[bad], [bad], [bad], [bad]]), "claude-sonnet-5-5", 0);
    expect(r.source).toBe("fallback");
    expect(r.mistakes[0]).toMatch(/^no schedule from the agent: /);
  });
});
