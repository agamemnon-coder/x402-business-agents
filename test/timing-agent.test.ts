// Block 5.3: after code plans the licence payment (the FX quote locked, the floors checked), the Treasury agent reads
// the live position and the quote and advises when to pay: now, or wait until a date. Advisory only: the CFO decides
// with Face ID and the quote's validity stays code's rule. Code bounds the advice: a wait must end at least two days
// before the due date (SWIFT time) and not today; a reason is required. Breaks if an out-of-bounds wait is recorded as
// the agent's advice, if the advice could change the terms, or if an unfinished run counts. Fake client.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { adviseTiming, type TimingFacts } from "../src/agents/timingAgent.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 500, output_tokens: 80 };
    if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-opus-5-5", usage };
  } } } } as unknown as Anthropic;
}
const F: TimingFacts = {
  proposalId: "P-0009", invoiceNo: "SLL-2026-11", vendor: "Stockline Data GmbH", amount: "1200.00", dueDate: "2026-11-15", today: "2026-11-05",
  eurAvailable: "800.00", eurFloor: "500.00", eurObligations: "0.00", usdAvailable: "40000.00", usdFloor: "10000.00",
  quote: { sell: "USD 1006.21", buy: "EUR 920.00", rate: "0.9143", validTo: "2026-11-05T10:20:00Z" }, after: { eurFree: "0.00", usdAvailable: "38993.79" }, feeMax: "20.00",
};
const advise = (timing: string, date: string | null, reason = "The quote is fresh and the floors hold; paying now removes the FX risk before the due date.") => ({ name: "submit_advice", input: { timing, date, reason } });

describe("the Treasury agent advises when to pay the licence", () => {
  it("advises paying now, in its own words; the advice is recorded beside the proposal", async () => {
    const db = openDb(":memory:");
    const r = await adviseTiming(db, F, fake([[{ name: "read_position", input: {} }, { name: "read_quote", input: {} }], [advise("pay_now", null)]]));
    expect(r).toMatchObject({ source: "claude", timing: "pay_now", date: null });
    const row = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'licence.timing_advised'").get() as { subject: string; payload_json: string };
    expect(row.subject).toBe("P-0009");
    expect(JSON.parse(row.payload_json)).toMatchObject({ timing: "pay_now", source: "claude", proposal_id: "P-0009" });
  });

  it("may advise waiting until a date at least two days before the due date, not today", async () => {
    const db = openDb(":memory:");
    const r = await adviseTiming(db, F, fake([[advise("wait_until", "2026-11-14")], [advise("wait_until", "2026-11-05")], [advise("wait_until", "2026-11-12", "EUR is expected in on the 10th from a customer; waiting avoids converting USD at all.")]]));
    expect(r.run.calls.map((c) => c.blocked ?? "ok")).toEqual(["advice bounds", "advice bounds", "ok"]);
    expect(r.run.calls[0]!.text).toMatch(/2026-11-13/);
    expect(r).toMatchObject({ timing: "wait_until", date: "2026-11-12" });
  });

  it("refuses a wait when the due date is too close for one", async () => {
    const db = openDb(":memory:");
    const r = await adviseTiming(db, { ...F, today: "2026-11-13" }, fake([[advise("wait_until", "2026-11-14")], [advise("pay_now", null)]]));
    expect(r.run.calls[0]).toMatchObject({ blocked: "advice bounds" });
    expect(r.timing).toBe("pay_now");
  });

  it("without a decision there is no advice: the proposal stands as code planned it", async () => {
    const db = openDb(":memory:");
    const r = await adviseTiming(db, F, fake([[{ name: "read_position", input: {} }]]));
    expect(r).toMatchObject({ source: "fallback", timing: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'licence.timing_advised'").get()).toEqual({ n: 0 });
  });

  it("the quote text tells the agent that waiting means a new quote and a new Face ID", async () => {
    const r = await adviseTiming(openDb(":memory:"), F, fake([[{ name: "read_quote", input: {} }], [advise("pay_now", null)]]));
    expect(r.run.calls[0]!.text).toMatch(/valid until 2026-11-05T10:20:00Z.*new quote.*Face ID/s);
  });
});
