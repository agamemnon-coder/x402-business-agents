// What becomes of the CFO's words, in one line for the phone and the log (src/policy/fromText.ts draftSummary), and the
// explanation a drafted proposal carries when every rule was accepted and no model was asked: each part is there only
// when it has something to say, a setting set to nothing reads as "none", and a reading without a model says so.
import { describe, expect, it } from "vitest";
import type { Tools } from "../src/claude/tools.js";
import { openDb } from "../src/db/open.js";
import { draftPolicyFromText, draftSummary, type PolicyDraftResult } from "../src/policy/fromText.js";

const base: PolicyDraftResult = { proposal: null, accepted: [], refused: [], not_mapped: [], questions: [], source: "claude", model: "claude-opus" };

describe("the one-line summary", () => {
  it("nothing drafted, nothing left over, a model answered: only that nothing waits", () => {
    expect(draftSummary(base)).toBe("No rule came out of this text, so nothing waits for approval.");
  });

  it("a proposal with a rule set to nothing, what was left over, the questions, and no model", () => {
    const r: PolicyDraftResult = {
      ...base,
      proposal: { proposal_id: "P-0007" } as PolicyDraftResult["proposal"],
      accepted: [{ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "", quote: "no cap", why: "w" }],
      not_mapped: [{ quote: "be careful", why: "not a setting" }],
      refused: [{ key: "eur_floor", to: "1.00", quote: "keep a euro", why: "too low" }],
      questions: ["Which card?"],
      source: "fallback",
      model: null,
    };
    expect(draftSummary(r)).toBe(
      "P-0007 waits for your Face ID: Sourcing agent: most per payment: not set → none. Not a rule: \"be careful\": not a setting; \"keep a euro\": too low. Questions: Which card? (No model was available.)",
    );
  });
});

describe("a drafted proposal's explanation", () => {
  it("every rule accepted and no model: no refusals named, and no model named", async () => {
    const db = openDb(":memory:");
    const text = "Keep at least 800.00 euros in the account.";
    const tools = { policyDraft: async () => ({ value: { changes: [{ key: "eur_floor", to: "800.00", quote: "at least 800.00 euros", why: "a floor" }], not_mapped: [], questions: [] }, source: "fallback", model: null }) } as unknown as Tools;
    const r = await draftPolicyFromText(db, tools, text, new Date("2026-11-03T10:00:00Z"));
    expect(r.refused).toEqual([]);
    expect(r.proposal!.explanation).toMatch(/^\[no model\] DRAFTED: "at least 800\.00 euros" → .*: not set → 800\.00 EUR\.$/);
    expect(r.proposal!.explanation).not.toContain("Not turned into a rule");
    expect(draftSummary(r)).toMatch(/waits for your Face ID: .*: not set → 800\.00\. \(No model was available\.\)$/);
  });
});
