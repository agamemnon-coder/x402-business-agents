// D26: the variation batch. Breaks if a resumed batch runs a seed it already has (double work, double spend), if it
// spends past the evals block's cap, if a world's cost is not recorded in the evals block, or if the summary loses
// the unsafe count, the fallback share or the spread of choices in a repeated world.
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordSpend } from "../src/claude/budget.js";
import { doneRuns, runBatch, summaryMarkdown, worldSha } from "../src/evals/variationRunner.js";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import type { SimResult } from "../src/evals/simWorld.js";
import { generateWorld, type SimWorldSpec } from "../src/evals/worlds.js";

const fakeResult = (spec: SimWorldSpec, policy: string, cost: number, source: "claude" | "fallback" = "claude"): SimResult => ({
  seed: spec.seed, label: `sim-${spec.seed}`, rails: "simulated", claude: true, ran_at: "2026-11-02T00:00:00Z", world: spec,
  decisions: [{ step: "query 3", agent: "sourcing", woke_on: ["supplier.notice"], source, model: "claude-haiku-5-5", tools: ["set_buy_policy", "finish"], blocked: [], summary: `set ${policy}`, cost_usd_micros: cost }],
  outcomes: { purchases: { paid: 1, refused: 0, cached: 0, turned_away: 0 }, policies: [policy], refunded: [], proposals: [], messages: [], receipt: null, card: null },
  safety: { findings: [], unsafe: 0, double_payments: 0, missing_origin: 0 }, treasury_timing: { applies: false, from: null, seconds: null, words: "no customer turned away" }, stopped_early: null, cost_usd_micros: cost, fallback_share: source === "fallback" ? 1 : 0, rail_sources: [],
});

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "variation-"));
  return { root, out: join(root, "2026-11-02"), spend: join(root, "api-budget.jsonl") };
}

describe("the variation batch", () => {
  it("writes one result per seed, records each world's cost in the evals block, and skips seeds already done", async () => {
    const d = dirs();
    const ran: number[] = [];
    const run = async (spec: SimWorldSpec) => { ran.push(spec.seed); return fakeResult(spec, "ridgeline ≤0.03", 2500); };
    const first = await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1, 2], repeat: 1, run });
    expect(first.ran.map((r) => r.seed)).toEqual([1, 2]);
    expect(existsSync(join(d.out, "sim-1.json")) && existsSync(join(d.out, "sim-2.json"))).toBe(true);
    const spends = readFileSync(d.spend, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { block: string; usd_micros: number; what: string });
    expect(spends).toMatchObject([{ block: "evals", usd_micros: 2500, what: "variation sim-1" }, { block: "evals", usd_micros: 2500, what: "variation sim-2" }]);

    // Resumed, also on another day: seeds 1 and 2 are on file under the variation root, so only 3 runs.
    const next = await runBatch({ root: d.root, outDir: join(d.root, "2026-11-03"), spendFile: d.spend, seeds: [1, 2, 3], repeat: 1, run });
    expect(next.skipped).toEqual(["sim-1", "sim-2"]);
    expect(ran).toEqual([1, 2, 3]);
    expect([...doneRuns(d.root)].map((k) => k.split("@")[0]).sort()).toEqual(["sim-1", "sim-2", "sim-3"]);
  });

  it("a re-run (--rerun) runs every seed again into its own directory, and resumes from that directory alone", async () => {
    const d = dirs();
    const ran: number[] = [];
    const run = async (spec: SimWorldSpec) => { ran.push(spec.seed); return fakeResult(spec, "x", 100); };
    await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1, 2], repeat: 1, run });
    const after = join(d.root, "2026-11-02-after-fix");
    const first = await runBatch({ root: d.root, outDir: after, spendFile: d.spend, seeds: [1, 2], repeat: 1, rerun: true, run: async (spec) => { if (spec.seed === 2) throw new Error("stopped"); return run(spec); } }).catch(() => null);
    expect(first).toBeNull();
    expect(existsSync(join(after, "sim-1.json"))).toBe(true);
    const again = await runBatch({ root: d.root, outDir: after, spendFile: d.spend, seeds: [1, 2], repeat: 1, rerun: true, run });
    expect(again.skipped).toEqual(["sim-1"]);
    expect(ran).toEqual([1, 2, 1, 2]);
    expect(existsSync(join(d.out, "sim-1.json")) && existsSync(join(after, "sim-2.json"))).toBe(true);
  });

  it("matches a run on its world's hash, not its label: a seed whose world changed runs again", async () => {
    const d = dirs();
    const run = async (spec: SimWorldSpec) => fakeResult(spec, "x", 0);
    await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1], repeat: 1, run });
    const f = join(d.out, "sim-1.json");
    const r = JSON.parse(readFileSync(f, "utf8")) as SimResult;
    expect(r.world_sha256).toBe(worldSha(1));
    writeFileSync(f, JSON.stringify({ ...r, world_sha256: "0".repeat(64) }));
    const again = await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1], repeat: 1, run });
    expect(again.ran.map((x) => x.label)).toEqual(["sim-1"]);
  });

  it("records a world's spend from its own ledger even when the world throws half-way, before any result is written", async () => {
    const d = dirs();
    const run = async (_spec: SimWorldSpec, w: { ledger(db: DB): void }) => {
      const db = openDb(":memory:");
      w.ledger(db);
      audit(db, "treasury", "agent.run", "wake.treasury", { agent: "treasury", cost_usd_micros: 41_000 });
      throw new Error("the API went away");
    };
    await expect(runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [7], repeat: 1, run })).rejects.toThrow("the API went away");
    expect(readFileSync(d.spend, "utf8")).toContain('"usd_micros":41000,"what":"variation sim-7 (stopped before its end)"');
    expect(existsSync(join(d.out, "sim-7.json"))).toBe(false);
  });

  it("hands each world the budget left, and stops the batch when a world stopped early at the cap", async () => {
    const d = dirs();
    recordSpend(d.spend, { block: "evals", usd_micros: 79_900_000, what: "earlier evals" });
    const seen: number[] = [];
    const run = async (spec: SimWorldSpec, w: { budgetLeftMicros: number }) => { seen.push(w.budgetLeftMicros); return { ...fakeResult(spec, "x", 100_000), stopped_early: "the evals block reached its cap during the world" }; };
    const r = await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1, 2], repeat: 1, run });
    expect(seen).toEqual([100_000]);
    expect(r.stopped).toMatch(/sim-1: the evals block reached its cap during the world/);
  });

  it("runs a repeated world as separate runs, each resumable", async () => {
    const d = dirs();
    const run = async (spec: SimWorldSpec) => fakeResult(spec, "none cache 300s", 0);
    const r = await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [5], repeat: 3, run });
    expect(r.ran.map((x) => x.label)).toEqual(["sim-5", "sim-5-r2", "sim-5-r3"]);
    expect(existsSync(join(d.out, "sim-5-r3.json"))).toBe(true);
  });

  it("stops before a world when the evals block has reached its cap, and spends nothing more", async () => {
    const d = dirs();
    recordSpend(d.spend, { block: "evals", usd_micros: 80_000_000, what: "earlier evals" });
    let calls = 0;
    const r = await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1, 2], repeat: 1, run: async (spec) => { calls++; return fakeResult(spec, "x", 1); } });
    expect(calls).toBe(0);
    expect(r.stopped).toMatch(/evals block .*80\.00 of 80/);
  });

  it("stops mid-batch once a world takes the block to its cap", async () => {
    const d = dirs();
    recordSpend(d.spend, { block: "evals", usd_micros: 79_990_000, what: "earlier evals" });
    const r = await runBatch({ root: d.root, outDir: d.out, spendFile: d.spend, seeds: [1, 2, 3], repeat: 1, run: async (spec) => fakeResult(spec, "x", 20_000) });
    expect(r.ran.map((x) => x.seed)).toEqual([1]);
    expect(r.stopped).toMatch(/evals block/);
  });

  it("summarises: worlds, unsafe count, fallback share, cost, and the spread of choices per agent in a repeated world", () => {
    const w = generateWorld(9);
    const rs = [fakeResult(w, "ridgeline ≤0.03", 1000), { ...fakeResult(w, "none cache 300s", 1000), label: "sim-9-r2" }, { ...fakeResult(generateWorld(10), "unchanged", 0, "fallback") }];
    const md = summaryMarkdown(rs, { date: "2026-11-02" });
    expect(md).toContain("3 simulated-rail runs (2 worlds), 0 unsafe actions, 0 double payments, 0 payments without origin");
    expect(md).toContain("fallback 33%");
    expect(md).toMatch(/seed 9 \(2 runs\).*sourcing: 2 different choices/s);
    expect(md).toContain("0.0020 USD");
  });

  it("reports Treasury's timing as n, median, p90 and max, simulated and live worlds apart", () => {
    const w = generateWorld(11);
    const timed = (label: string, seconds: number | null, rails: "simulated" | "live" = "simulated"): SimResult => ({
      ...fakeResult(w, "none", 0), label, rails,
      treasury_timing: { applies: true, from: "customers.turned_away", seconds, words: seconds === null ? "none within 600 s" : `options ${seconds} s after the third customer was turned away` },
    });
    const early: SimResult = { ...timed("sim-15", null), treasury_timing: { applies: true, from: "customers.turned_away", seconds: null, options_before: true, words: "options before turned away: filed 40 s before" } };
    const md = summaryMarkdown([timed("sim-11", 12), timed("sim-12", 30), timed("sim-13", 18), timed("sim-14", null), early, fakeResult(w, "x", 0), timed("live-1", 95, "live")], { date: "2026-11-02" });
    expect(md).toContain("| simulated | 6 | 5 | 3 | 18 | 30 | 30 | 1 | none within 600 s |");
    expect(md).toContain("| live | 1 | 1 | 1 | 95 | 95 | 95 | 0 | 0 |");
    expect(md).toContain("| options 12 s after the third customer was turned away |");
  });

  it("ignores result files it cannot read rather than counting them as done", () => {
    const d = dirs();
    mkdirSync(d.out, { recursive: true });
    writeFileSync(join(d.out, "sim-4.json"), "{ broken");
    writeFileSync(join(d.out, "notes.json"), "{}");
    expect([...doneRuns(d.root)]).toEqual([]);
  });
});
