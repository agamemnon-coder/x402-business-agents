import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { openDb } from "../src/db/open.js";
import { spendLimits } from "../src/policy/holds.js";

const PROCS = 8, PER_PROC = 16; // 128 reservations at once, from 8 processes
const AGENTS = ["sourcing", "support", "treasury"] as const;
const MANDATES = { sourcing: { cap: "0.40", budget: "8.00" }, support: { cap: "0.40", budget: "4.00" }, treasury: { cap: "4.00", budget: "12.00" } };

describe("spend holds under load", () => {
  it(`${PROCS * PER_PROC} simultaneous payments from three agents never pass a mandate's budget, cap or the shared total`, async () => {
    const file = join(mkdtempSync(join(tmpdir(), "holds-load-")), "w.sqlite");
    const db = openDb(file);
    const t0 = Date.parse("2026-10-30T12:00:00Z");
    for (const [agent, m] of Object.entries(MANDATES)) audit(db, "treasury", "mandate.bound", agent, { cap: m.cap, budget: m.budget }, new Date(t0));
    // Each payment at its own hour, so the velocity limits stay out of it: the budgets and the total must hold alone.
    let n = 0;
    const kids = Array.from({ length: PROCS }, () => fork(join(import.meta.dirname, "support/holds-worker.ts"), [], { execArgv: ["--import", "tsx"] }));
    const ready = kids.map((k) => new Promise<void>((ok, fail) => { k.once("message", () => ok()); k.once("error", fail); }));
    kids.forEach((k, id) => k.send({ file, id, jobs: Array.from({ length: PER_PROC }, () => { const agent = AGENTS[n % 3]!; const cents = agent === "treasury" ? 100 + (n % 4) * 100 : 10 + (n % 4) * 10; return { agent, cents, at: t0 + (n++) * 3_600_000 }; }) }));
    await Promise.all(ready);
    const done = kids.map((k) => new Promise<{ agent: string; cents: number; refused: string | null }[]>((ok, fail) => { k.once("message", (m) => ok(m as never)); k.once("exit", (c) => c && fail(new Error(`worker exited ${c}`))); }));
    for (const k of kids) k.send("go");
    const results = (await Promise.all(done)).flat();

    expect(results).toHaveLength(PROCS * PER_PROC);
    const held = (agent: string) => (db.prepare("SELECT SUM(cents) AS n FROM holds WHERE status = 'HELD' AND agent = ?").get(agent) as { n: number | null }).n ?? 0;
    for (const agent of AGENTS) {
      const l = spendLimits(db, agent);
      expect(held(agent), agent).toBeLessThanOrEqual(l.budgetCents!);
      const accepted = results.filter((r) => r.agent === agent && r.refused === null);
      expect(accepted.reduce((s, r) => s + r.cents, 0)).toBe(held(agent));
      for (const r of accepted) expect(r.cents).toBeLessThanOrEqual(l.capCents!);
    }
    const total = AGENTS.reduce((s, a) => s + held(a), 0);
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET_CENTS);
    // The limits were really reached: some payments were refused for each reason, so the test proves the guard works.
    const reasons = new Set(results.filter((r) => r.refused).map((r) => r.refused!.split(":")[0]));
    expect([...reasons].some((x) => x === "budget_exceeded" || x === "total_budget_exceeded")).toBe(true);
    expect(results.filter((r) => r.refused === null).length).toBeGreaterThan(20);
  }, 60_000);
});
