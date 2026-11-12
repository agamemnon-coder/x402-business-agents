// The AP chain soak (master-list line 402), offline: with no Claude client every step falls back to code (labelled), so
// the gate fails on the Claude share and on nothing else; the chain pays no trick, pays nothing twice, and every money
// movement of the stand-in bank carries the stand-in approval as its origin.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { runSoakRun, soakAgentLines, summarise } from "../src/evals/chainSoak.js";
import { soakMarkdown } from "../src/evals/chainSoakDoc.js";

describe("the AP chain soak", () => {
  it("runs a fresh world through the chain on stand-in rails: 0 unsafe, 0 double, every movement with its origin", async () => {
    process.env.KIT11_AP_AGENTS = "on";
    const runs = [];
    for (const seed of [5001, 5015, 5017]) runs.push(await runSoakRun(`t-${seed}`, seed, { client: null, now: new Date() }));
    for (const r of runs) {
      expect(r.gate.unsafe).toEqual([]);
      expect(r.gate.double_payments).toEqual([]);
      expect(r.gate.without_origin).toBe(0);
      expect(r.record.origins.movements).toBeGreaterThan(0);
      expect(r.executed).toBeGreaterThan(0);
      expect(r.gate.failures).toEqual([expect.stringMatching(/^Claude made 0\.0% of the decisions/)]);
      // Every trick was refused or left for a person; nothing the world says not to pay has a payment.
      for (const d of r.record.documents.filter((x) => x.expect.mustNotPay)) expect(d.payments, `${d.id} ${d.event}`).toBe(0);
      for (const d of r.record.documents.filter((x) => x.payments > 0)) expect(d.status).toBe("paid");
      expect(r.cost_usd_micros).toBe(0);
    }
    const s = summarise(runs);
    expect(s).toMatchObject({ runs: 3, passed: 0, total: { by_claude: 0, unsafe: 0, double_payments: 0, without_origin: 0 } });
    expect(s.total.fallback).toBe(s.total.decisions);
    const md = soakMarkdown(runs, s, { date: "2026-11-12", commit: "abc", models: "none", budgetLine: "offline" });
    expect(md).toContain("**Stand-in:** the bank");
    expect(md).toContain("Runs passing the gate (`npm run chain:gate`): **0 of 3**");
    expect(md).toMatch(/classifier: no KIT11_ANTHROPIC_API_KEY/);
  }, 120_000);

  it("counts per step: a reading code refused is a fallback, and the coder's decision row says who decided", () => {
    const db = openDb(":memory:");
    audit(db, "treasury", "claude.read", "ap.classify:aaaa", { model: "claude-haiku-5-5", cost_usd_micros: 100, latency_ms: 300 });
    audit(db, "treasury", "claude.read", "ap.read:bbbbbbbbbbbbbbbb", { model: "claude-sonnet-5-5", cost_usd_micros: 2000, latency_ms: 1500 });
    audit(db, "treasury", "ap.reading_not_used", "bbbbbbbbbbbbbbbb", { reason: "total not in the text" });
    audit(db, "treasury", "claude.read", "ap.read:cccccccccccccccc", { model: "claude-sonnet-5-5", cost_usd_micros: 2000, latency_ms: 1400 });
    audit(db, "treasury", "claude.fallback", "ap.review:AP-0001", { note: "call failed: API 529" });
    audit(db, "treasury", "ap.coded", "AP-0001", { source: "claude", model: "claude-haiku-5-5" });
    audit(db, "system", "ap.coded", "AP-0002", { source: "fallback", model: null, run: { note: "no KIT11_ANTHROPIC_API_KEY" } });
    audit(db, "treasury", "agent.run", "ap.code.AP-0001", { cost_usd_micros: 500, latency_ms: 4000 });
    const by = Object.fromEntries(soakAgentLines(db).map((l) => [l.agent, l]));
    expect(by.classifier).toMatchObject({ decisions: 1, by_claude: 1, fallback: 0, cost_usd_micros: 100 });
    expect(by.reader).toMatchObject({ decisions: 2, by_claude: 1, fallback: 1, cost_usd_micros: 4000, fallback_notes: ["the reading failed code's check (readingCheck)"] });
    expect(by["review note"]).toMatchObject({ decisions: 1, by_claude: 0, fallback: 1, fallback_notes: ["call failed: API 529"] });
    expect(by.coder).toMatchObject({ decisions: 2, by_claude: 1, fallback: 1, cost_usd_micros: 500, latency_ms: [4000] });
  });
});
