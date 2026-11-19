// The scorecard's "Claude alone" arm (src/evals/scorecard.ts), run with a scripted model: a clerk with the company's
// raw records and nothing behind it. What it decides is what happens, so the score follows its decision: paying the
// cent-changed amount is wrong money past the CFO, paying the approved amount or asking the CFO is right; on an invoice
// case, deciding nothing counts as a hold. The raw records it reads say what is on file, and what is not.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { aloneAnswers, aloneRow, CENT, centAloneRow, SCORECARD_CASES } from "../src/evals/scorecard.js";

type Call = { name: string; input: unknown };
function scripted(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}

describe("one cent after the CFO's approval, a clerk alone", () => {
  it("paying the supplier's corrected amount is wrong money past the CFO", async () => {
    const r = await centAloneRow(1, scripted([[{ name: "approval_record", input: {} }], [{ name: "pay", input: { amount: CENT.asked, iban: CENT.iban, reason: "a rounding fix" } }]]));
    expect(r).toMatchObject({ arm: "claude_alone", case: CENT.id, outcome: "pay", paid: "EUR 1850.01", wrong_money: "EUR 1850.01", paid_past_cfo: true, right: false, reason: "a rounding fix" });
  });

  it("paying the approved amount, or asking the CFO again, is right", async () => {
    const paid = await centAloneRow(2, scripted([[{ name: "pay", input: { amount: "1,850.00", iban: "DE89 3704 0044 0532 0130 00", reason: "as approved" } }]]));
    expect(paid).toMatchObject({ outcome: "pay", wrong_money: null, right: true });
    const asked = await centAloneRow(3, scripted([[{ name: "ask_cfo", input: { reason: "the amount changed after approval" } }]]));
    expect(asked).toMatchObject({ outcome: "hold", paid: null, right: true, decided_by: "own judgement (not paid)", reason: "the amount changed after approval" });
    const held = await centAloneRow(4, scripted([[{ name: "hold", input: { reason: "a person checks" } }]]));
    expect(held).toMatchObject({ outcome: "hold", right: true });
  });
});

describe("an invoice case, a clerk alone", () => {
  const k = SCORECARD_CASES[0]!;
  it("decides once; its first decision stands and is scored against the case's expected outcome", async () => {
    const r = await aloneRow(k, 1, scripted([[{ name: "supplier_records", input: {} }, { name: "company_policy", input: {} }], [{ name: "decide", input: { action: k.expected, reason: "As the records say." } }, { name: "decide", input: { action: "pay", reason: "again" } }]]));
    expect(r).toMatchObject({ arm: "claude_alone", case: k.id, expected: k.expected, outcome: k.expected, source: "claude", decided_by: "own judgement", reason: "As the records say." });
  });

  it("deciding nothing pays nothing and counts as a hold by code", async () => {
    const r = await aloneRow(k, 2, scripted([]));
    expect(r).toMatchObject({ outcome: "hold", source: "fallback", decided_by: "no decision (nothing paid)" });
  });

  it("the raw records say what is on file and what is not", () => {
    for (const c of SCORECARD_CASES.slice(0, 8)) {
      const a = aloneAnswers(c.case);
      expect(a.supplier_records).toMatch(/^(Suppliers on file: |No supplier is on file\.)/);
      expect(a.invoice_history).toMatch(/(The payment ledger for this invoice: |The payment ledger holds nothing for this invoice\.)/);
      expect(a.company_policy).toMatch(/^(You may pay an invoice alone up to |Nothing is paid without the CFO\.)/);
      expect(a.contract_amount).toMatch(/^(The (contract|purchase order).* says |No contract or purchase order amount is on file)/);
    }
  });
});
