import { describe, expect, it } from "vitest";
import { simulateMonth } from "../src/sim/month.js";
import { toCents } from "../src/lib/money.js";

describe("a month in 90 seconds (simulated)", () => {
  const m = simulateMonth({ seed: 11, month: "2026-11" });

  it("is the same month for the same seed, and says it is simulated", () => {
    expect(simulateMonth({ seed: 11 })).toEqual(m);
    expect(m.simulated).toBe(true);
    expect(m.assumptions[0]).toMatch(/^Simulated month/);
    expect(m.days).toHaveLength(30);
  });

  it("adds up: the P&L lines and the bills give the company's net", () => {
    const c = (s: string) => (s.startsWith("-") ? -toCents(s.slice(1)) : toCents(s));
    const agentsNet = m.pnl.reduce((s, l) => s + c(l.net), 0);
    expect(agentsNet - c(m.company.bills)).toBe(c(m.company.net));
    const revenue = m.days.reduce((s, d) => s + d.revenue_cents, 0);
    expect(c(m.company.revenue)).toBe(revenue);
    expect(m.pnl.map((l) => l.agent)).toEqual(["sourcing", "support", "treasury"]);
  });

  it("puts the card spend in each agent's P&L, with the declines Airwallex would make", () => {
    // Starter 19.99 + Pro 45.00 (after the raise), 2 helpdesk seats 38.00, bookkeeping 15.00, at 1.085 USD per EUR, each charge rounded to the cent.
    expect(m.pnl.map((l) => l.card)).toEqual(["70.52", "41.23", "16.28"]);
    const declines = m.events.filter((e) => /Airwallex declined/.test(e.text)).map((e) => [e.day, e.agent]);
    expect(declines).toEqual([[12, "sourcing"], [20, "support"]]);
    expect(m.events.find((e) => e.day === 20 && e.agent === "cfo")?.outcome).toBe("rejected");
  });

  it("uses the live build's checks: the price rise is refused, the fake invoice blocked, refund-all escalated", () => {
    const day = (d: number) => m.events.filter((e) => e.day === d).map((e) => e.outcome);
    expect(day(9)).toEqual(["blocked", "waiting"]);
    expect(m.events.find((e) => e.day === 22)?.text).toMatch(/blocked before Airwallex: bank details changed/);
    expect(m.events.filter((e) => e.day === 14).map((e) => e.outcome)).toContain("rejected");
    // Sell price follows the CFO's choice: 0.05 before day 10, 0.07 after.
    const d8 = m.days[7]!, d11 = m.days[10]!;
    expect([d8.revenue_cents / d8.sales, d11.revenue_cents / d11.sales]).toEqual([5, 7]);
  });

  it("counts what the agents did alone, what waits for the CFO and what was blocked", () => {
    expect(m.counts.waiting).toBe(1);
    expect(m.counts.alone).toBeGreaterThan(50_000);
    expect(m.counts.blocked).toBeGreaterThan(5);
    expect(m.events.at(-1)?.outcome).toBe("waiting");
    // The days add up to the month, so the replay's counters end where the totals are.
    expect([m.days.reduce((s, d) => s + d.alone, 0), m.days.reduce((s, d) => s + d.blocked, 0)]).toEqual([m.counts.alone, m.counts.blocked]);
    const aiDays = m.days.reduce((s, d) => s + d.ai_cents.support, 0);
    expect(aiDays).toBe(toCents(m.pnl[1]!.ai));
  });

  it("compares Summit's payments by clearing with a transaction per query", () => {
    expect(m.clearing.payments).toBe(m.days.reduce((s, d) => s + d.sales, 0));
    expect(m.clearing).toMatchObject({ exact_tx: m.clearing.payments, clearing_tx: 10 });
  });

  it("prices the AI from measured tokens: cents, not dollars, for a month of documents", () => {
    const ai = m.pnl.reduce((s, l) => s + toCents(l.ai), 0);
    expect(ai).toBeGreaterThan(0);
    expect(ai).toBeLessThan(500);
  });
});
