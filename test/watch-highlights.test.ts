// Watch opens on the highlights of agent run 1: only the key moments, with the agents' routine checks merged into one
// line each ("N routine checks: nothing to do"), and the TAP run's card purchase at the end under its own label. The
// full run stays one button away, with its number of steps counted from the record.
import { describe, expect, it } from "vitest";
import { agentRun, highlights, tapRun } from "../src/redesign/run.js";
import { watchPage } from "../src/redesign/watch.js";

const run = agentRun();
const h = highlights(run);
const text = (e: (typeof h)[number]) => ("text" in e ? e.text : "label" in e ? e.label : "");

describe("Watch highlights", () => {
  it("are shorter than the full run and keep every key moment, in order", () => {
    expect(h.length).toBeLessThan(run.events.length);
    const kinds = h.map((e) => (e.k === "money" && e.refused?.by === "recorded" ? "refused-recorded" : e.k === "face" ? `face:${e.status}:${e.signers.length}` : e.k));
    for (const want of ["refused-recorded", "face:COSIGNED:1", "face:APPROVED:2", "mandate", "shield"]) expect(kinds).toContain(want);
    const at = (f: (e: (typeof h)[number]) => boolean) => h.findIndex(f);
    const order = [
      at((e) => e.k === "world" && /asks 0\.04/.test(e.text)),
      at((e) => e.k === "say" && e.agent === "treasury" && e.tools.includes("design_rebalance")),
      at((e) => e.k === "face" && e.status === "COSIGNED"),
      at((e) => e.k === "face" && e.signers.length === 2),
      at((e) => e.k === "mandate"),
      at((e) => e.k === "world" && /disputes/.test(e.text)),
      at((e) => e.k === "money" && e.agent === "support" && /refund/.test(e.what)),
      at((e) => e.k === "money" && /sweep/.test(e.what)),
      at((e) => e.k === "money" && e.refused?.code === "fee_unknown"),
      at((e) => e.k === "money" && e.run === tapRun()!.label),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("merge the routine checks into lines that count them, and lose none", () => {
    const routine = h.filter((e): e is Extract<typeof e, { k: "routine" }> => e.k === "routine");
    expect(routine.length).toBeGreaterThan(0);
    for (const r of routine) expect(r.text).toBe(`${r.count} routine check${r.count > 1 ? "s" : ""}: nothing to do`);
    const quiet = run.events.filter((e) => e.k === "say" && !h.includes(e)).length;
    expect(routine.reduce((n, r) => n + r.count, 0)).toBe(quiet);
  });

  it("put the TAP run's purchase last, labelled as that run", () => {
    const last = h[h.length - 1]!;
    expect(last.k).toBe("money");
    expect(text(last)).toMatch(/Visa TAP/);
    expect(last.k === "money" && last.run).toBe(tapRun()!.label);
  });

  it("are the default on Watch, with a button for the full run that counts its steps", () => {
    const html = watchPage();
    expect(html).toContain(`Full run (${run.events.length} steps)`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Highlights|>Highlights<\/button>/);
  });
});
