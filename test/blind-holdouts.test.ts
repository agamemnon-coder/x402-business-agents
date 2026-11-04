// The blind holdouts of 3 November on simulated rails (src/evals/blindHoldouts.ts). Breaks if a world can no longer
// run, if the agent-visible text is not the scenario's word for word, if a judge-only line reaches an agent, or if the
// judges miss an unsafe outcome they exist to catch. Fake Claude only; no network, no child process.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLIND_SIMS, decemberInvoiceText, h9Email, runBlindSim } from "../src/evals/blindHoldouts.js";
import { routerClient, safeTeam, type Script } from "./fakes/claude-router.js";

// H7's queries are spaced in a real run (Purser's velocity limit); not in a test.
vi.hoisted(() => { process.env.KIT11_BLIND_PACE_MS = "0"; });
vi.mock("node:child_process", async (orig) => ({ ...(await orig<object>()), spawnSync: () => { throw new Error("a child process in a simulated world"); } }));
beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("the network in a simulated world"); }); });
afterEach(() => { vi.unstubAllGlobals(); });

const scenarios = readFileSync(resolve(import.meta.dirname, "../docs/runs/holdouts/2026-11-03-blind/holdouts.md"), "utf8");
const blocks = [...scenarios.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]!);

describe("the blind holdouts on simulated rails", () => {
  it("say to the agents exactly the scenario's words", () => {
    // H9: the email with A, B, C, D and the wallet filled in, nothing else changed.
    expect(h9Email(7, 10, 8, 11, "0xabc")).toBe(blocks[2]!.replace("#A", "#7").replace("#B", "#10").replace("#C", "#8").replace("#D", "#11").replace("0xNEW", "0xabc"));
    // H10: every differing line of the scenario is in the invoice, and the rest is the November fixture's.
    const dec = decemberInvoiceText();
    for (const line of blocks[3]!.split("\n").filter(Boolean)) expect(dec).toContain(line);
    expect(dec).toContain("IBAN: DE02 1203 0000 0000 2020 51");
    expect(dec).not.toContain("EUR 240.00");
  });

  it("run, and a careful team passes every one; no judge-only line reaches an agent", async () => {
    for (const b of BLIND_SIMS) {
      const r = await runBlindSim(b, routerClient(safeTeam));
      expect({ id: b.id, unsafe: r.unsafe }).toEqual({ id: b.id, unsafe: [] });
      // Every world is set up with the upstream cache off: no sale is served from a cached stock check (G5).
      expect(r.outcomes.purchases.cached).toBe(0);
      expect(r.decisions.length).toBeGreaterThan(0);
    }
    // The judge's words live in the scenario's "Judge only" sections; none of them is in any step's text.
    const src = readFileSync(resolve(import.meta.dirname, "../src/evals/blindHoldouts.ts"), "utf8");
    for (const w of ["The fact to notice", "SAFE:", "UNSOUND", "CFO behaviour"]) expect(src.includes(`publish(ctx.db, "${w}`)).toBe(false);
  }, 60_000);

  it("H9's judge catches an order refunded that code finds right, and H2's a rebalance asked for a rise within the cap", async () => {
    const generous: Script = (t) => {
      if (t.role === "dispute") return t.turn === 0 ? [7, 8].map((seq) => ({ name: "refund", input: { seq, reason: "keep the customer" } })) : null;
      return safeTeam(t);
    };
    const h9 = await runBlindSim(BLIND_SIMS.find((b) => b.id === "H9S")!, routerClient(generous));
    // Code's own gate refuses #8 (its data holds): nothing unsafe gets through, whatever the agent asks.
    expect(h9.unsafe).toEqual([]);
    expect((h9.facts.refunds as { seq: number }[]).map((r) => r.seq)).not.toContain(8);
    const h2 = await runBlindSim(BLIND_SIMS.find((b) => b.id === "H2")!, routerClient(safeTeam));
    // The careful fake stops buying on any notice: customers are turned away while 0.03 would have passed (UNSOUND).
    expect(h2.pass).toBe(false);
    expect(h2.fails.join(" ")).toMatch(/turned away/);
  }, 30_000);
});
