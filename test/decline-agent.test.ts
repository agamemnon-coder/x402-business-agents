// Block 5.2: Airwallex declines a card purchase and the agent whose card it is reads why and acts: over the limit, it
// proposes a raise the CFO approves with Face ID; for any other reason (wrong merchant kind, frozen card) a raise would
// not help, so it proposes none. Code bounds the raise: it must cover the purchase and stay within 1.25× of it (no
// headroom "to be safe"), one proposal per decline. Breaks if a raise outside those bounds becomes a proposal, if a
// raise is proposed for a decline a limit did not cause, or if an unfinished run counts as the agent's. Fake client.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { maxRaiseCents, meetDecline, type DeclineFacts } from "../src/agents/declineAgent.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 500, output_tokens: 80 };
    if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}

const PRO: DeclineFacts = { agent: "sourcing", transactionId: "awx-9", merchant: "Packwise", item: "Pro plan, monthly", amountCents: 4500, reason: "LIMIT_EXCEEDED", perTxCents: 3000, monthlyCents: 10000, spentMonthCents: 1999 };
function deps() {
  const proposed: { perTx: string; monthly?: string; reason: string }[] = [];
  return { proposed, d: { propose: (r: { perTx: string; monthly?: string; reason: string }) => { proposed.push(r); return { proposal_id: `P-00${proposed.length}` }; } } };
}
const raise = (per_purchase: string, reason = "Pro gives live sync our customers pay for") => ({ name: "propose_raise", input: { per_purchase, per_month: null, reason } });

describe("the agent meets a card decline", () => {
  it("over the limit: proposes a raise that covers the purchase, in its own words", async () => {
    const { proposed, d } = deps();
    const r = await meetDecline(openDb(":memory:"), PRO, d, fake([[{ name: "read_decline", input: {} }], [raise("50.00")]]));
    expect(r).toMatchObject({ source: "claude", proposal_id: "P-001" });
    expect(proposed).toEqual([{ perTx: "50.00", reason: "Pro gives live sync our customers pay for" }]);
  });

  it("refuses a raise above 1.25× the purchase, or below it; the agent corrects it", async () => {
    expect(maxRaiseCents(4500)).toBe(5700);
    const { proposed, d } = deps();
    const r = await meetDecline(openDb(":memory:"), PRO, d, fake([[raise("200.00")], [raise("40.00")], [raise("50.00")]]));
    expect(r.run.calls.map((c) => c.blocked ?? "ok")).toEqual(["raise bounds", "raise bounds", "ok"]);
    expect(r.run.calls[0]!.text).toMatch(/at most 57\.00/);
    expect(proposed).toHaveLength(1);
  });

  it("a decline a limit did not cause: refuses any raise; the agent proposes none", async () => {
    const { proposed, d } = deps();
    const r = await meetDecline(openDb(":memory:"), { ...PRO, reason: "MERCHANT_CATEGORY_NOT_ALLOWED", amountCents: 1999 }, d,
      fake([[raise("25.00")], [{ name: "no_raise", input: { reason: "This card may only pay helpdesk software." } }]]));
    expect(r.run.calls[0]).toMatchObject({ blocked: "not a limit decline" });
    expect(r).toMatchObject({ source: "claude", proposal_id: null });
    expect(proposed).toEqual([]);
  });

  it("proposes once per decline", async () => {
    const { proposed, d } = deps();
    await meetDecline(openDb(":memory:"), PRO, d, fake([[raise("50.00"), raise("55.00")]]));
    expect(proposed).toHaveLength(1);
  });

  it("asks for the monthly limit too when the month would still decline it, within the same bound", async () => {
    const { proposed, d } = deps();
    const tight = { ...PRO, spentMonthCents: 7000 }; // 70 + 45 = 115 over 100
    const r = await meetDecline(openDb(":memory:"), tight, d, fake([[raise("50.00")], [{ name: "propose_raise", input: { per_purchase: "50.00", per_month: "120.00", reason: "month" } }]]));
    expect(r.run.calls[0]).toMatchObject({ blocked: "raise bounds" });
    expect(r.run.calls[0]!.text).toMatch(/monthly limit/);
    expect(proposed).toEqual([{ perTx: "50.00", monthly: "120.00", reason: "month" }]);
  });

  it("unfinished after one send-back: code proposes its fixed rule (the purchase rounded up to 10.00), as a fallback", async () => {
    const { proposed, d } = deps();
    const r = await meetDecline(openDb(":memory:"), PRO, d, fake([[{ name: "read_decline", input: {} }]]));
    expect(r.source).toBe("fallback");
    expect(proposed).toEqual([expect.objectContaining({ perTx: "50.00" })]);
  });

  it("without Claude: a limit decline gets code's raise; any other decline gets none", async () => {
    const a = deps();
    expect(await meetDecline(openDb(":memory:"), PRO, a.d, null)).toMatchObject({ source: "fallback", proposal_id: "P-001" });
    const b = deps();
    expect(await meetDecline(openDb(":memory:"), { ...PRO, reason: "CARD_INACTIVE" }, b.d, null)).toMatchObject({ source: "fallback", proposal_id: null });
    expect(b.proposed).toEqual([]);
  });
});
