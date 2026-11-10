// Watch opens on the highlights of the main run (3 Nov): about a dozen key moments in order, the agents' routine checks
// merged into the moment that follows them ("after N routine checks"), the three refunds as one step, the FX for the
// licence's shortfall before its SWIFT payout, and the run's own card buy signed with Visa TAP at the end. The full run
// is one button away, its steps counted from the record.
import { describe, expect, it } from "vitest";
import { agentRun, highlights } from "../src/redesign/run.js";
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
      at((e) => e.k === "money" && e.refused?.by === "metal" && !!e.letThrough),
      at((e) => e.k === "world" && /asks 0\.04/.test(e.text)),
      at((e) => e.k === "say" && e.agent === "treasury" && e.tools.includes("design_rebalance")),
      at((e) => e.k === "face" && e.status === "COSIGNED"),
      at((e) => e.k === "face" && e.signers.length === 2),
      at((e) => e.k === "mandate"),
      at((e) => e.k === "world" && /disputes/.test(e.text)),
      at((e) => e.k === "say" && e.tools.includes("settle_dispute")),
      // The main run swept right after the replace (11:27:23), before the refunds were paid (11:28:32).
      at((e) => e.k === "money" && /sweep/.test(e.what)),
      at((e) => e.k === "money" && e.agent === "support" && /refund/.test(e.what)),
      at((e) => e.k === "face" && e.id === "P-0005"),
      at((e) => e.k === "money" && e.via === "FX"),
      at((e) => e.k === "money" && e.via === "SWIFT" && !e.refused),
      at((e) => e.k === "money" && e.via === "card · Visa TAP" && !e.run),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("hold no earlier licence attempt: the main run's licence was paid on its first attempt", () => {
    expect(run.events.some((e) => e.k === "money" && (e.refused?.code === "fee_unknown" || e.earlier))).toBe(false);
  });

  it("merge the routine checks (decisions that only looked) into the next moment, and lose none before the last", () => {
    const looked = (tools: string[]) => tools.every((x) => /^(market|position|read_|finish)/.test(x));
    const lastKey = run.events.findIndex((e) => e.at === h[h.length - 1]!.at && e.k === h[h.length - 1]!.k);
    const quiet = run.events.slice(0, lastKey).filter((e) => e.k === "say" && looked(e.tools)).length;
    expect(h.reduce((n, e) => n + (e.quiet ?? 0), 0)).toBe(quiet);
    expect(watchPage()).toMatch(/routine check" \+ \(e\.quiet > 1/);
  });

  it("put the run's own card buy signed with Visa TAP last (in the same world, not the separate TAP run)", () => {
    const last = h[h.length - 1]!;
    expect(last.k).toBe("money");
    expect(text(last)).toMatch(/Visa TAP/);
    expect(last.k === "money" && last.run).toBeUndefined();
    expect(last.k === "money" && last.proof.label).toMatch(/^Airwallex 01a1a12f/);
  });

  it("are the default on Watch, with a button for the full run that counts its steps from the record", () => {
    const html = watchPage();
    expect(html).toContain(`Full run (${run.events.length} steps)`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Highlights|>Highlights<\/button>/);
    // Readable pace (Max, 10 Nov: "too fast to read"): a caption per step, back / play / next, a speed switch that
    // starts at 0.5×, and the chapters drawn by the script; still no old scene chips.
    expect(html).toContain('id="cap"');
    expect(html).toMatch(/data-speed="0\.5" class="on" aria-pressed="true">0\.5×/);
    expect(html).toContain('id="back"');
    expect(html).toContain('id="fwd"');
    expect(html).toContain('id="chapters"');
    expect(html).toMatch(/speed = 0\.5/);
    expect(html).not.toContain('id="scenes"');
    expect(html.match(/<button /g)?.length).toBe(8);
  });
});
