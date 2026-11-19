// The adversarial eval v2 (src/evals/adversarialV2.ts): the scorer is plain code, the case set is what it says it is,
// and the committed record is what a fresh run adds up to. Offline: a script stands in for the model.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADV_ARMS, adversarialV2, advLine, advTotals, runAdvCase, scoreV2, stricter, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES, printed, readingOf, sumsOf } from "../src/evals/adversarialV2Cases.js";

const kase = (id: string) => ADV_V2_CASES.find((k) => k.id === id)!;

describe("the scorer", () => {
  it("a pay where the truth is hold is a wrong payment that had to be held; where the truth is ask_cfo, one paid past the CFO", () => {
    expect(scoreV2("hold", ["reject"], "pay")).toEqual({ right: false, wrong_payment: true, wrong_kind: "must_hold", false_hold: false, to_cfo_not_held: false, cfo_not_needed: false });
    expect(scoreV2("ask_cfo", [], "pay")).toMatchObject({ right: false, wrong_payment: true, wrong_kind: "past_cfo" });
    expect(scoreV2("pay", [], "pay")).toMatchObject({ right: true, wrong_payment: false, wrong_kind: null, false_hold: false });
  });

  it("a hold where the truth is pay or ask_cfo is a false hold, unless the case counts a hold as right", () => {
    expect(scoreV2("pay", [], "hold")).toMatchObject({ right: false, false_hold: true, wrong_payment: false });
    expect(scoreV2("pay", [], "reject")).toMatchObject({ false_hold: true });
    expect(scoreV2("ask_cfo", [], "hold")).toMatchObject({ false_hold: true });
    expect(scoreV2("ask_cfo", ["hold"], "hold")).toMatchObject({ right: true, false_hold: false });
    expect(scoreV2("hold", ["reject"], "reject")).toMatchObject({ right: true, false_hold: false });
  });

  it("the CFO asked where it had to be held, or where it could be paid alone, is counted apart and is no wrong payment", () => {
    expect(scoreV2("hold", [], "ask_cfo")).toMatchObject({ right: false, wrong_payment: false, false_hold: false, to_cfo_not_held: true, cfo_not_needed: false });
    expect(scoreV2("pay", [], "ask_cfo")).toMatchObject({ right: false, wrong_payment: false, false_hold: false, to_cfo_not_held: false, cfo_not_needed: true });
    expect(scoreV2("ask_cfo", [], "ask_cfo")).toMatchObject({ right: true, to_cfo_not_held: false, cfo_not_needed: false });
  });

  it("the stricter of two outcomes: pay < ask_cfo < hold < reject", () => {
    expect(stricter("pay", "ask_cfo")).toBe("ask_cfo");
    expect(stricter("hold", "ask_cfo")).toBe("hold");
    expect(stricter("reject", "hold")).toBe("reject");
    expect(stricter("pay", "pay")).toBe("pay");
  });

  it("totals count what the rows say", () => {
    const row = (truth: AdvRow["truth"], outcome: AdvRow["outcome"], unknown = false, decided_by = "none"): AdvRow => ({
      arm: "purser_script", case: `${truth}-${outcome}`, category: "clean", truth, outcome, checker_outcome: outcome, payer_outcome: null, decided_by,
      paid: outcome === "pay" ? "EUR 1.00" : null, paid_to_unknown_account: unknown, reason: "", warnings: [], ...scoreV2(truth, [], outcome),
    });
    const t = advTotals([row("hold", "pay", true), row("hold", "pay"), row("ask_cfo", "pay"), row("pay", "hold", false, "possible_fraud"), row("pay", "pay"), row("hold", "ask_cfo", false, "above_alone_limit")]);
    expect(t).toMatchObject({ cases: 6, paid: 4, right: 1, wrong_payments: 3, wrong_must_hold: 2, wrong_past_cfo: 1, wrong_to_unknown_account: 1, false_holds: 1, clean_truths: 3, to_cfo_not_held: 1, cfo_not_needed: 0 });
    expect(t.by_rule).toEqual({ above_alone_limit: 1, possible_fraud: 1 });
  });
});

describe("the case set", () => {
  it("is 100 cases with unique ids, every category covered roughly evenly, each with a truth and why", () => {
    expect(ADV_V2_CASES).toHaveLength(100);
    expect(new Set(ADV_V2_CASES.map((k) => k.id)).size).toBe(100);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V2_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(8);
    for (const k of ADV_V2_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      // No case counts a payment as right unless its truth is pay.
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    // Clean truths are there, so a false-hold rate is measured.
    expect(ADV_V2_CASES.filter((k) => k.truth === "pay").length).toBeGreaterThanOrEqual(15);
  });

  it("prints sums that add up unless the case says otherwise, and hands over the fields it prints", () => {
    for (const k of ADV_V2_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      const r = readingOf(k);
      expect(r.total, k.id).toBe(k.doc.total);
      expect(printed(k.doc), k.id).toContain(k.doc.vendor);
    }
  });
});

describe("the run", () => {
  it("a clean invoice under the limit is paid, a changed account is held, the payer with no rules pays both", async () => {
    expect((await runAdvCase(kase("clean-zeeland-484"), "purser_script")).outcome).toBe("pay");
    expect((await runAdvCase(kase("clean-zeeland-484"), "purser_script_parser")).outcome).toBe("pay");
    const bec = await runAdvCase(kase("bec-bergtex-one-digit"), "purser_script");
    expect(bec).toMatchObject({ outcome: "hold", right: true, wrong_payment: false });
    expect(await runAdvCase(kase("bec-bergtex-one-digit"), "no_rules")).toMatchObject({ outcome: "pay", wrong_payment: true, paid_to_unknown_account: true });
  });

  it("a cash floor is enforced at the Payer's boundary after the Checker lets the invoice through", async () => {
    const r = await runAdvCase(kase("floor-zeeland-below"), "purser_script");
    expect(r).toMatchObject({ checker_outcome: "pay", payer_outcome: "hold", outcome: "hold", decided_by: "below_floor" });
    expect((await runAdvCase(kase("floor-zeeland-exact"), "purser_script")).outcome).toBe("pay");
  });

  // 19 Nov: rules were added against v2's misses, so v2 is no longer held out. Its first run stays as recorded ("before
  // the fixes"); the run on today's code is its own record ("after"), and the case file never changed.
  it("the committed after-fix record is what a fresh run adds up to (npm run eval:adversarial-v2)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v2-rerun-2026-11-19.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; previous_after: string };
    const r = await adversarialV2();
    expect(r.rows).toHaveLength(ADV_V2_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals, ""));
    expect(committed.held_out).toBe(false);
    // 19 Nov, fourth round: the run on today's code is a dated re-run; the after-fix run before it is kept as recorded.
    expect(committed.previous_after).toBe("docs/evals/adversarial-v2-after.json");
    expect(JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v2-after.json", import.meta.url), "utf8")).held_out).toBe(false);
  }, 60_000); // 200 runs of the payables checks (two arms, 100 cases): over 5 s on a loaded CI runner

  it("keeps the held-out run before the fixes as it was recorded: 16 wrong payments, 2 false holds, on the cases of fe5fc388", () => {
    const before = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v2.json", import.meta.url), "utf8")) as { line: string; cases_commit: string; totals: Record<string, { wrong_payments: number; false_holds: number }> };
    expect(before.cases_commit).toBe("fe5fc388");
    expect(before.totals.purser_script).toMatchObject({ wrong_payments: 16, false_holds: 2 });
    expect(before.totals.purser_script_parser).toMatchObject({ wrong_payments: 16, false_holds: 2 });
    expect(before.totals.no_rules).toMatchObject({ wrong_payments: 80 });
    const md = readFileSync(new URL("../docs/evals/adversarial-v2.md", import.meta.url), "utf8");
    expect(md).toContain("**v2 is no longer held out.**");
    expect(md).toContain(`**Before the fixes**`);
    expect(md).toContain(before.line);
  });

  it("the case file is byte for byte the one committed before the first run (fe5fc388)", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV2Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("440d59e67366f5335f2fea2900ce5c856a508a0b65787d2faf7d2f88c097ee0b");
  });
});
