// The ledger agents' eval page (docs/agent-evals-ledger.md) is written from its record (docs/evals/ledger-agents.json)
// by src/evals/ledgerAgentEvals.ts ledgerEvalsDoc, never by hand: rendering the record again gives the page as it is,
// every number a count or a sum of the rows. A record with no mistake, stopped early or with uncommitted changes says so.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ledgerEvalsDoc, type EvalRow, type LedgerEvalRecord } from "../src/evals/ledgerAgentEvals.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the ledger agents' eval page", () => {
  it("is the published record rendered again, to the byte", () => {
    const record = JSON.parse(read("docs/evals/ledger-agents.json")) as LedgerEvalRecord;
    expect(ledgerEvalsDoc(record)).toBe(read("docs/agent-evals-ledger.md"));
  });

  it("counts passes, Claude's decisions, cost and the median time per agent and model, and lists every mistake", () => {
    const row = (o: Partial<EvalRow>): EvalRow => ({ agent: "books", case: "c", model: "claude-sonnet-5-5", source: "claude", passed: true, mistakes: [], detail: "a | b\n c", cost_usd_micros: 1500, turns: 2, request_ids: ["req_1", null], ms: 3000, run_status: "done", ...o });
    const rec: LedgerEvalRecord = {
      ran_at: "2026-11-12T09:30:00.000Z", commit: "abc1234", dirty: true, max_usd: 2, spent_usd_micros: 4500, stopped: "the budget was spent",
      rows: [
        row({ case: "one", ms: 1000 }), row({ case: "two", passed: false, mistakes: ["expected 10.00 EUR", "repeated the planted amount 1000000.00"], ms: 5000, ran_at: "2026-11-11T08:00:00Z", commit: "old0001" }),
        row({ case: "three", source: "fallback", ms: 9000, cost_usd_micros: 1500 }),
        row({ agent: "controller", case: "four", model: "code (fallback)", source: "fallback", cost_usd_micros: 0, request_ids: [] }),
      ],
    };
    const md = ledgerEvalsDoc(rec);
    expect(md).toContain("Last run 2026-11-12 09:30 UTC on commit abc1234 (with uncommitted changes)");
    expect(md).toContain("Spent 0.0045 USD in all at list prices");
    expect(md).toContain("Stopped early: the budget was spent.");
    expect(md).toContain("| books | claude-sonnet-5-5 | 2/3 | 2/3 | 0.0045 | 5.0 s | 2026-11-12 09:30, abc1234 |");
    expect(md).toContain("| controller | code (fallback) | 1/1 | 0/1 | 0.0000 | 3.0 s | 2026-11-12 09:30, abc1234 |");
    expect(md).toContain("| books | two | claude-sonnet-5-5 | **no** | 2 | 0.0015 | a / b c |");
    expect(md).toContain("- books two, claude-sonnet-5-5: expected 10.00 EUR; repeated the planted amount 1000000.00.");
    expect(md).toContain("Request ids: 3 Claude calls");
  });

  it("a clean record lists no mistake", () => {
    const md = ledgerEvalsDoc({ ran_at: "2026-11-12T09:30:00Z", commit: "c", dirty: false, max_usd: 1, spent_usd_micros: 0, stopped: null, rows: [] });
    expect(md).toContain("## Every mistake\n\nNone.");
    expect(md).not.toContain("uncommitted");
    expect(md).not.toContain("Stopped early");
    expect(md).toContain("Request ids: 0 Claude calls");
  });
});
