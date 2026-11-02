// Watch opens on the highlights of agent run 1: about a dozen key moments in order, the agents' routine checks merged
// into the moment that follows them ("after N routine checks"), the three refunds as one step, and the TAP run's card
// purchase at the end under its own label. The failed licence attempt (fee_unknown) is not a highlight (Max, v4 B1);
// the full run keeps it, labelled an earlier attempt. The full run is one button away, its steps counted from the record.
import { describe, expect, it } from "vitest";
import { agentRun, highlights, tapRun } from "../src/redesign/run.js";
import { watchPage } from "../src/redesign/watch.js";

const run = agentRun();
const h = highlights(run);
const text = (e: (typeof h)[number]) => ("text" in e ? e.text : "label" in e ? e.label : "");

describe("Watch highlights", () => {
  it("are about a dozen key moments, in order", () => {
    expect(h.length).toBeGreaterThanOrEqual(10);
    expect(h.length).toBeLessThanOrEqual(15);
    // The three refunds are one step: "refund 0.05 ×3", for orders #7, #10, #13.
    const refunds = h.filter((e) => e.k === "money" && e.agent === "support");
    expect(refunds.map((e) => e.k === "money" && [e.label, e.what])).toEqual([["refund 0.05 ×3", "refunds for orders #7, #10, #13"]]);
    const at = (f: (e: (typeof h)[number]) => boolean) => h.findIndex(f);
    const order = [
      at((e) => e.k === "money" && e.refused?.by === "recorded"),
      at((e) => e.k === "world" && /asks 0\.04/.test(e.text)),
      at((e) => e.k === "say" && e.agent === "treasury" && e.tools.includes("design_rebalance")),
      at((e) => e.k === "face" && e.status === "COSIGNED"),
      at((e) => e.k === "face" && e.signers.length === 2),
      at((e) => e.k === "mandate"),
      at((e) => e.k === "world" && /disputes/.test(e.text)),
      at((e) => e.k === "say" && e.tools.includes("settle_dispute")),
      at((e) => e.k === "money" && e.agent === "support" && /refund/.test(e.what)),
      at((e) => e.k === "money" && /sweep/.test(e.what)),
      at((e) => e.k === "face" && e.id === "P-0007"),
      at((e) => e.k === "money" && e.via === "SWIFT" && !e.refused),
      at((e) => e.k === "money" && e.run === tapRun()!.label),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leave out the fee_unknown attempt and its approval; the full run labels it an earlier attempt, nothing paid", () => {
    expect(h.some((e) => e.k === "money" && e.refused?.code === "fee_unknown")).toBe(false);
    expect(h.some((e) => e.k === "face" && e.id === "P-0005")).toBe(false);
    const fee = run.events.find((e) => e.k === "money" && e.refused?.code === "fee_unknown");
    expect(fee?.k === "money" && fee.earlier).toBe(true);
    expect(watchPage()).toContain("Earlier attempt · nothing paid");
  });

  it("merge the routine checks (decisions that only looked) into the next moment, and lose none before the last", () => {
    const looked = (tools: string[]) => tools.every((x) => /^(market|position|read_|finish)/.test(x));
    const lastKey = run.events.findIndex((e) => e.at === h[h.length - 2]!.at && e.k === h[h.length - 2]!.k);
    const quiet = run.events.slice(0, lastKey).filter((e) => e.k === "say" && looked(e.tools)).length;
    expect(h.reduce((n, e) => n + (e.quiet ?? 0), 0)).toBe(quiet);
    expect(watchPage()).toMatch(/routine check" \+ \(e\.quiet > 1/);
  });

  it("put the TAP run's purchase last, labelled as that run", () => {
    const last = h[h.length - 1]!;
    expect(last.k).toBe("money");
    expect(text(last)).toMatch(/Visa TAP/);
    expect(last.k === "money" && last.run).toBe(tapRun()!.label);
  });

  it("are the default on Watch, with a button for the full run that counts its steps from the record", () => {
    const html = watchPage();
    expect(html).toContain(`Full run (${run.events.length} steps)`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Highlights|>Highlights<\/button>/);
    // The same four jumps as Home's animation.
    expect([...html.matchAll(/data-scene="(\d)"><b>\d<\/b>([^<]+)</g)].map((m) => m[2])).toEqual(["Price rise", "Replan", "Dispute", "Euros"]);
  });
});
