// The Claude decision count (master-list line 79): read from the committed records only, per agent and in all, with the
// 95% target next to it, and "below" said plainly.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collect, decisionCount, fromAgentEvals, fromAwx1, fromChainSoak, fromCoder, fromSoakTable, fromSourceList } from "../src/evals/decisionCount.js";
import { fallbackPct } from "../src/dashboard/agentStats.js";

describe("the decision count", () => {
  it("reads each kind of record", () => {
    expect(fromSoakTable("| Agent | Model | Decisions | Fallbacks |\n|---|---|---|---|\n| Sourcing | Haiku | 202 | 0 (0%) | 417 |\n| Support | Sonnet | 64 | 2 (3%) | 139 |", "s"))
      .toEqual([{ source: "s", kind: "run", agent: "sourcing", by_claude: 202, fallback: 0 }, { source: "s", kind: "run", agent: "support", by_claude: 62, fallback: 2 }]);
    const awx = "0 fallbacks: each run ended done\n| `run-sourcing-18-418b69` (x) | h |\n| `run-treasury-49-8ea614` | o |\n| `run-treasury-68-cb4c97` | o |";
    expect(fromAwx1(awx, "a")).toEqual([{ source: "a", kind: "run", agent: "sourcing", by_claude: 1, fallback: 0 }, { source: "a", kind: "run", agent: "treasury", by_claude: 2, fallback: 0 }]);
    expect(fromAwx1(awx.replace("0 fallbacks", "1 fallback"), "a")).toEqual([]);
    expect(fromAgentEvals({ rows: [{ agent: "support", details: ["pass: claude: told", "FAIL: fallback: no key", "odd line"] }] }, "e")).toEqual([{ source: "e", kind: "eval", agent: "support", by_claude: 1, fallback: 1 }]);
    expect(fromSourceList([{ source: "claude" }, { source: "fallback" }, { source: "claude" }], "v", "sourcing")).toEqual([{ source: "v", kind: "eval", agent: "sourcing", by_claude: 2, fallback: 1 }]);
    expect(fromCoder({ rows: [{ no_answer: false }, { no_answer: true }] }, "c")).toEqual([{ source: "c", kind: "eval", agent: "coder", by_claude: 1, fallback: 1 }]);
    expect(fromChainSoak({ runs: [{ record: { decisions: [{ agent: "reader", by_claude: 3, fallback: 1 }] } }, { record: { decisions: [{ agent: "reader", by_claude: 2, fallback: 0 }] } }] }, "k"))
      .toEqual([{ source: "k", kind: "run", agent: "payables reader", by_claude: 5, fallback: 1 }]);
  });

  it("says when a share is below the 95% target, with the dashboard's fallback share", () => {
    const c = decisionCount([{ source: "x", kind: "run", agent: "support", by_claude: 90, fallback: 10 }, { source: "y", kind: "eval", agent: "sourcing", by_claude: 50, fallback: 0 }]);
    expect(c.per_agent.find((a) => a.agent === "support")).toMatchObject({ decisions: 100, fallback_pct: 10, claude_pct: 90, meets_target: false });
    expect(c.per_agent.find((a) => a.agent === "sourcing")).toMatchObject({ claude_pct: 100, meets_target: true });
    expect(c.total).toMatchObject({ decisions: 150, by_claude: 140, fallback: 10, fallback_pct: fallbackPct(10, 150), meets_target: false });
    expect(c.runs.decisions).toBe(100);
    expect(c.evals.decisions).toBe(50);
  });

  it("counts the committed records: every number comes from a file on main", () => {
    const sources = collect(resolve(import.meta.dirname, ".."));
    expect(new Set(sources.map((s) => s.source))).toContain("docs/runs/2026-11-01-soak.md");
    expect(new Set(sources.map((s) => s.source))).toContain("docs/evals/agents.json");
    const c = decisionCount(sources);
    expect(c.total.decisions).toBe(c.total.by_claude + c.total.fallback);
    expect(c.total.decisions).toBeGreaterThan(1000);
  });
});
