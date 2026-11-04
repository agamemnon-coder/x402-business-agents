// P2: the CFO writes the policy in plain words; Opus drafts rules; code checks every rule against the words and the
// policy's own limits; the result is only ever a proposal, which the CFO approves with Face ID. Nothing the model
// returns is applied directly.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb } from "../src/db/open.js";
import { amountsIn, draftPolicyFromText } from "../src/policy/fromText.js";
import { policyValue } from "../src/policy/rules.js";

const now = new Date("2026-11-03T10:00:00Z");
const fake = (parsed: unknown): Anthropic => ({
  beta: { messages: { parse: async (p: { model: string }) => ({ model: p.model, stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: parsed }) } },
}) as unknown as Anthropic;

const TEXT = "De sourcing-agent mag met zijn kaart hooguit €40 per aankoop uitgeven. Refunds boven €0,08 wil ik zien. Software max €500/maand, totaal.";

describe("policy from plain words (P2)", () => {
  it("reads amounts the way people write them", () => {
    expect(amountsIn("hooguit €40 per aankoop")).toEqual([4000]);
    expect(amountsIn("boven €0,08")).toEqual([8]);
    expect(amountsIn("1.250,50 EUR or 1,250.50 or 2.000 or 0.03")).toEqual([125050, 125050, 200000, 3]);
  });

  it("turns checked rules into one proposal and never applies them itself", async () => {
    const db = openDb(":memory:");
    const tools = new Tools(db, new ClaudeReader(db, fake({
      changes: [
        { key: "card.sourcing.per_tx", to: "40.00", quote: "hooguit €40 per aankoop", why: "per purchase on the sourcing card" },
        { key: "approval.refund_each", to: "0.08", quote: "Refunds boven €0,08 wil ik zien", why: "refunds above this need a person" },
      ],
      not_mapped: [{ quote: "Software max €500/maand, totaal.", why: "there is no rule for a total across the three cards" }],
      questions: ["Should the 500 be split across the agents' cards?"],
    })));
    const r = await draftPolicyFromText(db, tools, TEXT, now);
    expect(r.proposal).not.toBeNull();
    const terms = JSON.parse(r.proposal!.terms_json);
    expect(terms.kind).toBe("policy_change");
    expect(terms.changes.map((c: { key: string; from: string; to: string }) => [c.key, c.from, c.to])).toEqual([["card.sourcing.per_tx", "30.00", "40.00"], ["approval.refund_each", "0.10", "0.08"]]);
    expect(terms.reason).toContain(TEXT);
    expect(r.proposal!.created_by).toBe("claude");
    expect(r.proposal!.status).toBe("PENDING_APPROVAL");
    // Shown, not applied.
    expect(policyValue(db, "card.sourcing.per_tx")).toBe("30.00");
    expect(r.not_mapped.map((n) => n.quote)).toEqual(["Software max €500/maand, totaal."]);
    expect(r.questions).toHaveLength(1);
    // The phone shows how each rule follows from the words.
    expect(r.proposal!.explanation).toMatch(/hooguit €40 per aankoop/);
    expect(r.proposal!.explanation).toMatch(/Not turned into a rule: .*Software max €500/);
  });

  it("refuses a rule the words do not support: invented amounts, invented quotes, unknown settings, out-of-range values", async () => {
    const db = openDb(":memory:");
    const tools = new Tools(db, new ClaudeReader(db, fake({
      changes: [
        { key: "card.sourcing.per_tx", to: "45.00", quote: "hooguit €40 per aankoop", why: "rounded up" },
        { key: "card.support.per_tx", to: "40.00", quote: "support may spend €40", why: "not in the text" },
        { key: "transfer.anything", to: "40.00", quote: "hooguit €40 per aankoop", why: "no such rule" },
        { key: "card.treasury.monthly", to: "500.00", quote: "Software max €500/maand", why: "software per month" },
        { key: "approval.refund_each", to: "0.08", quote: "Refunds boven €0,08 wil ik zien", why: "ok" },
        { key: "approval.refund_each", to: "0.08", quote: "Refunds boven €0,08 wil ik zien", why: "twice" },
      ],
      not_mapped: [],
      questions: [],
    })));
    const r = await draftPolicyFromText(db, tools, TEXT, now);
    const keys = JSON.parse(r.proposal!.terms_json).changes.map((c: { key: string }) => c.key);
    expect(keys).toEqual(["card.treasury.monthly", "approval.refund_each"]);
    const why = r.refused.map((x) => x.why).join(" | ");
    expect(why).toMatch(/45\.00 is not an amount in/);
    expect(why).toMatch(/not in your words/);
    expect(why).toMatch(/unknown policy setting/);
    expect(why).toMatch(/changed twice/);
  });

  it("makes no proposal when nothing survives, and none without a model", async () => {
    const db = openDb(":memory:");
    const none = await draftPolicyFromText(db, new Tools(db, new ClaudeReader(db, null)), TEXT, now);
    expect(none.proposal).toBeNull();
    expect(none.source).toBe("fallback");
    expect(none.not_mapped[0]!.quote).toBe(TEXT);
    const db2 = openDb(":memory:");
    const bad = await draftPolicyFromText(db2, new Tools(db2, new ClaudeReader(db2, fake({ changes: [{ key: "freeze", to: "off", quote: "nothing like it", why: "x" }], not_mapped: [], questions: [] }))), TEXT, now);
    expect(bad.proposal).toBeNull();
    expect(bad.refused).toHaveLength(1);
  });

  it("from the phone, refuses a rule that would loosen the policy", async () => {
    const db = openDb(":memory:");
    const tools = new Tools(db, new ClaudeReader(db, fake({
      changes: [
        { key: "card.sourcing.per_tx", to: "40.00", quote: "hooguit €40 per aankoop", why: "a raise: looser" },
        { key: "approval.refund_each", to: "0.08", quote: "Refunds boven €0,08 wil ik zien", why: "lower: tighter" },
      ],
      not_mapped: [], questions: [],
    })));
    const r = await draftPolicyFromText(db, tools, TEXT, now, { tightenOnly: true });
    expect(JSON.parse(r.proposal!.terms_json).changes.map((c: { key: string }) => c.key)).toEqual(["approval.refund_each"]);
    expect(r.refused[0]!.why).toMatch(/would loosen the policy/);
  });

  it("refuses empty or overlong text before any model sees it", async () => {
    const db = openDb(":memory:");
    const tools = new Tools(db, new ClaudeReader(db, null));
    await expect(draftPolicyFromText(db, tools, "  ", now)).rejects.toThrow(/write the policy/);
    await expect(draftPolicyFromText(db, tools, "x".repeat(2001), now)).rejects.toThrow(/at most 2000/);
  });
});
