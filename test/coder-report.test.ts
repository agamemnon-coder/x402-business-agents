// The Coder evals' section of docs/agent-evals.md is written by code from docs/evals/coder.json alone
// (src/evals/coderReport.ts): no number in it is typed by hand, and the default model is the one the run chose.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CODER_MODEL } from "../src/ap/coderCore.js";
import { CODER_SECTION_MARK, coderEvalSection, coderSummary, withCoderSection, type CoderEvalRecord, type CoderEvalRow } from "../src/evals/coderReport.js";

const row = (over: Partial<CoderEvalRow> & Pick<CoderEvalRow, "case" | "model">): CoderEvalRow => ({
  run: 1, expected: [{ accounts: ["6200"], vat_code: "P21", cost_centres: ["CC300"] }], raw: { lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: null }], reason: "Goods." },
  enforced: { status: "coded", source: "claude", overridden_by: null, refused_because: null, lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC300" }] },
  no_answer: false, run_status: "done", run_note: null, turns: 2, cost_usd_micros: 1000, latency_ms: 1000, correct: { account: true, vat_code: true, cost_centre: true },
  ...over,
});

const record = (rows: CoderEvalRow[]): CoderEvalRecord => ({
  ran_at: "2026-11-12T13:00:00.000Z", commit: "abc123def456", dirty: false, runs: 1, max_usd: 3, models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  cases: ["a", "b"], all_cases: 2, coder_model: "claude-haiku-5-5", stopped: null, rows,
});

describe("the summary per model", () => {
  it("counts accuracy of the enforced coding, refusals by rule, answers missing, cost and time", () => {
    const r = record([
      row({ case: "a", model: "claude-haiku-5-5", latency_ms: 1000, cost_usd_micros: 1000 }),
      row({
        case: "b", model: "claude-haiku-5-5", latency_ms: 3000, cost_usd_micros: 3000,
        enforced: { status: "needs_review", source: "fallback", overridden_by: "foreign_vat", refused_because: "x", lines: [{ line_no: 1, account: "6900", vat_code: null, cost_centre: "CC300" }] },
        correct: { account: false, vat_code: false, cost_centre: true },
      }),
      row({ case: "a", model: "claude-sonnet-5-5", cost_usd_micros: 20000 }),
      row({ case: "b", model: "claude-sonnet-5-5", cost_usd_micros: 20000, raw: null, no_answer: true, run_status: "unavailable", enforced: { status: "coded", source: "fallback", overridden_by: null, refused_because: null, lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC300" }] } }),
    ]);
    const s = coderSummary(r);
    expect(s.models.map((m) => [m.model, m.invoices, m.complete, m.account, m.vat_code, m.cost_centre, m.refused, m.no_answer, m.cost_per_invoice_micros, m.p50_ms, m.p95_ms])).toEqual([
      ["claude-haiku-5-5", 2, true, 0.5, 0.5, 1, { foreign_vat: 1 }, 0, 2000, 1000, 3000],
      ["claude-sonnet-5-5", 2, true, 1, 1, 1, {}, 1, 20000, 1000, 1000],
    ]);
    // The cheapest model at 95% or more on account class and VAT code: Haiku is not, Sonnet is.
    expect(s.chosen).toBe("claude-sonnet-5-5");
  });

  it("chooses the cheapest model that reached 95% on both, among those that ran every case; none when none did", () => {
    const both = record([row({ case: "a", model: "claude-haiku-5-5" }), row({ case: "b", model: "claude-haiku-5-5" }), row({ case: "a", model: "claude-sonnet-5-5", cost_usd_micros: 9000 }), row({ case: "b", model: "claude-sonnet-5-5", cost_usd_micros: 9000 })]);
    expect(coderSummary(both).chosen).toBe("claude-haiku-5-5");
    // A model that did not run every case is not chosen.
    expect(coderSummary(record([row({ case: "a", model: "claude-haiku-5-5" })])).chosen).toBeNull();
    const wrong = { correct: { account: true, vat_code: false, cost_centre: true } };
    expect(coderSummary(record([row({ case: "a", model: "claude-haiku-5-5", ...wrong }), row({ case: "b", model: "claude-haiku-5-5" })])).chosen).toBeNull();
    // A run of some of the cases chooses nothing, and says so.
    const some = { ...record([row({ case: "a", model: "claude-haiku-5-5" })]), cases: ["a"] };
    expect(coderSummary(some).chosen).toBeNull();
    expect(coderEvalSection(some)).toContain("This run did 1 of the 2 cases, so it chooses no default model: CODER_MODEL stays claude-haiku-5-5.");
  });
});

describe("the section", () => {
  it("is rendered from the record alone, says which model is the default and why, and names each mistake", () => {
    const r = record([
      row({ case: "a", model: "claude-haiku-5-5" }),
      row({
        case: "b", model: "claude-haiku-5-5", raw: { lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: null }], reason: "Goods." },
        enforced: { status: "needs_review", source: "fallback", overridden_by: "foreign_vat", refused_because: "VAT code P21 is Dutch input VAT, and the supplier is in DE", lines: [{ line_no: 1, account: "6900", vat_code: null, cost_centre: "CC300" }] },
        correct: { account: false, vat_code: false, cost_centre: true },
      }),
    ]);
    const md = coderEvalSection(r);
    expect(md.startsWith(`${CODER_SECTION_MARK}\n## The Coder agent`)).toBe(true);
    expect(md).toContain("| claude-haiku-5-5 | 2 | 50.0% | 50.0% | 100.0% (2 of 2 chosen by code) | 1 (foreign_vat 1) | 0 | 0.0010 | 1.0 s / 1.0 s |");
    expect(md).toContain("No model reached 95%");
    expect(md).toContain("CODER_MODEL stays claude-haiku-5-5");
    expect(md).toContain("- b, claude-haiku-5-5: account 6900, expected 6200; VAT code none, expected P21. The agent answered 6200 / P21; code refused it (foreign_vat: VAT code P21 is Dutch input VAT, and the supplier is in DE).");
    expect(coderEvalSection(r)).toBe(md);
  });

  it("shows no accuracy for a model that gave no answer on any case, and says so: the numbers would be code's fallback's", () => {
    const failed = { raw: null, no_answer: true, run_status: "unavailable", run_note: "call failed: API 404 NotFoundError", cost_usd_micros: 0, turns: 1,
      enforced: { status: "needs_review" as const, source: "fallback" as const, overridden_by: null, refused_because: null, lines: [{ line_no: 1, account: "6900", vat_code: null, cost_centre: "CC300" }] },
      correct: { account: false, vat_code: false, cost_centre: true } };
    const r = record([
      row({ case: "a", model: "claude-haiku-5-5" }), row({ case: "b", model: "claude-haiku-5-5" }),
      row({ case: "a", model: "claude-sonnet-5-5", ...failed }), row({ case: "b", model: "claude-sonnet-5-5", ...failed }),
    ]);
    const md = coderEvalSection(r);
    expect(md).toContain("| claude-sonnet-5-5 | 2 | no answer | no answer | no answer | 0 | 2 | 0.0000 |");
    expect(md).not.toMatch(/\| claude-sonnet-5-5 \| 2 \| \d/);
    expect(md).toContain("claude-sonnet-5-5 gave no answer on any of its 2 invoices (unavailable: call failed: API 404 NotFoundError): code's fallback coded every one, so this run measures nothing about that model.");
    expect(md).not.toContain("- a, claude-sonnet-5-5:");
    expect(coderSummary(r).chosen).toBe("claude-haiku-5-5");
    // Code's fallback alone never makes a model the default, whatever its score.
    const lucky = { ...failed, enforced: { ...failed.enforced, status: "coded" as const, lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC300" }] }, correct: { account: true, vat_code: true, cost_centre: true } };
    expect(coderSummary(record([row({ case: "a", model: "claude-haiku-5-5", ...lucky }), row({ case: "b", model: "claude-haiku-5-5", ...lucky })])).chosen).toBeNull();
  });

  it("says on how many invoices code chose the cost centre, because the model named none or code decided the coding", () => {
    const r = record([
      row({ case: "a", model: "claude-haiku-5-5" }),
      row({ case: "b", model: "claude-haiku-5-5", raw: { lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC100" }], reason: "Goods." } }),
      row({ case: "a", model: "claude-sonnet-5-5", raw: { lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC300" }], reason: "Goods." } }),
      row({ case: "b", model: "claude-sonnet-5-5", raw: null, no_answer: true, enforced: { status: "coded", source: "fallback", overridden_by: null, refused_because: null, lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC300" }] } }),
    ]);
    expect(coderSummary(r).models.map((m) => m.cost_centre_by_code)).toEqual([1, 1]);
    const md = coderEvalSection(r);
    expect(md).toContain("| claude-haiku-5-5 | 2 | 100.0% | 100.0% | 100.0% (1 of 2 chosen by code) |");
    expect(md).toContain("The brackets say on how many invoices code chose it: on those, the share measures the default, not the model.");
  });

  it("replaces an earlier section at the end of the file and keeps what comes before it", () => {
    const r = record([row({ case: "a", model: "claude-haiku-5-5" }), row({ case: "b", model: "claude-haiku-5-5" })]);
    const top = "# Agent evals\n\nSome table.\n";
    const once = withCoderSection(top, r);
    expect(once).toBe(`${top}\n${coderEvalSection(r)}`);
    expect(withCoderSection(once, r)).toBe(once);
    expect(withCoderSection(top, null)).toBe(top);
    expect(withCoderSection(once, null)).toBe(top);
  });
});

describe("docs/agent-evals.md", () => {
  const json = resolve(import.meta.dirname, "../docs/evals/coder.json");
  const md = readFileSync(resolve(import.meta.dirname, "../docs/agent-evals.md"), "utf8");
  it("holds exactly the section the committed coder.json renders, and CODER_MODEL is the model it chose", () => {
    if (!existsSync(json)) {
      expect(md.includes(CODER_SECTION_MARK)).toBe(false);
      return;
    }
    const r = JSON.parse(readFileSync(json, "utf8")) as CoderEvalRecord;
    expect(md.slice(md.indexOf(CODER_SECTION_MARK))).toBe(coderEvalSection(r));
    const chosen = coderSummary(r).chosen;
    if (chosen) expect(CODER_MODEL).toBe(chosen);
  });
});

describe("npm run coder-evals", () => {
  it("without a key says so, makes no call and writes nothing", () => {
    const root = resolve(import.meta.dirname, "..");
    const files = ["docs/agent-evals.md", "docs/runs/api-budget.jsonl", "docs/evals/coder.json"].map((f) => resolve(root, f));
    const before = files.map((f) => (existsSync(f) ? statSync(f).mtimeMs : null));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/ANTHROPIC/.test(k)));
    let out = "";
    let code = 0;
    try {
      execFileSync(resolve(root, "node_modules/.bin/tsx"), ["src/cli/coderEvals.ts", "--models", "haiku", "--cases", "nl-books-9"], { cwd: root, env, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const x = e as { status: number; stderr: string };
      code = x.status;
      out = x.stderr;
    }
    expect(code).toBe(2);
    expect(out).toContain("KIT11_ANTHROPIC_API_KEY is not set: no live run, and nothing written");
    expect(files.map((f) => (existsSync(f) ? statSync(f).mtimeMs : null))).toEqual(before);
  }, 30_000);
});
