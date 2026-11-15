// 15 Nov (Max): the README's "At a glance", six lines under the badges, each with a link to its record. Every figure in
// it is read here from that record, so the README cannot drift from what ran.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partnerTiles } from "../src/redesign/proofRuns.js";
import { agentRun, split } from "../src/redesign/run.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md");
const GLANCE = README.slice(README.indexOf("## At a glance"), README.indexOf("## Kit 11, step by step"));
const lines = GLANCE.split("\n").filter((l) => l.startsWith("- **"));
const eur = (cents: number) => `EUR ${(cents / 100).toFixed(2)}`;

describe("the README's At a glance", () => {
  it("has six lines, each with a link that exists", () => {
    expect(lines).toHaveLength(6);
    for (const l of lines) {
      const links = [...l.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);
      expect(links.length).toBeGreaterThan(0);
      for (const h of links.filter((x) => !/^https?:/.test(x))) expect({ h, there: existsSync(new URL(`../${h}`, import.meta.url)) }).toEqual({ h, there: true });
    }
  });

  it("says the worst-case AI test's figures as its record has them, in every run", () => {
    const w = JSON.parse(read("docs/evals/worst-case-summary.json")) as { purser_script: Record<string, { wrong_payments: number }>; no_rules: Record<string, { wrong_payments: number }> };
    const script = new Set(Object.values(w.purser_script).map((r) => r.wrong_payments)), none = new Set(Object.values(w.no_rules).map((r) => r.wrong_payments));
    expect(script.size).toBe(1);
    expect(none.size).toBe(1);
    expect(lines[2]).toContain(`always says pay made ${[...script][0]} wrong payments; a payer with no rules made ${[...none][0]} `);
  });

  it("says the one-cent-over run as its record has it", () => {
    const c = JSON.parse(read("docs/runs/airwallex-card-cent-2026-11-15.json")) as { ran_at: string; attempts: { amount_cents: number; currency: string; status: string; failure_reason: string | null }[] };
    const [ok, no] = c.attempts;
    expect(ok!.status).toBe("APPROVED");
    expect(no!.status).toBe("DECLINED");
    expect(no!.amount_cents - ok!.amount_cents).toBe(1);
    expect(c.ran_at.slice(0, 10)).toBe("2026-11-15");
    expect(lines[3]).toContain(`${eur(ok!.amount_cents)} approved, ${eur(no!.amount_cents)} declined, \`${no!.failure_reason}\``);
  });

  // The final audit (15 Nov): /proof's band and /airwallex/calls count the calls differently, so the README names no count.
  it("names no Airwallex call count, links every call, and quotes the verification report's summary", () => {
    expect(lines[4]).toContain("**Every Airwallex sandbox call**, listed with what came back and its record: [/airwallex/calls]");
    expect(GLANCE).not.toMatch(/\b(?:150|154)\b/);
    const v = JSON.parse(read("docs/evidence/verification-2026-11-15.json")) as { summary: string };
    expect(lines[5]).toContain(`the live report: ${v.summary} (`);
  });

  it("backs each status badge in the second row with its record", () => {
    const row = README.split("\n").find((l) => l.startsWith("[![Airwallex: LIVE")) ?? "";
    const live = Object.fromEntries(partnerTiles().map((t) => [t.name, t.runs]));
    // LIVE for a partner: at least one live run of that partner in the run records (the tiles on /proof count them).
    for (const n of ["Airwallex", "Alta", "Visa via Airi", "T:0"]) expect({ n, runs: (live[n] ?? 0) > 0 }).toEqual({ n, runs: true });
    expect(row).toContain(`Claude-LIVE_%C2%B7_${split(agentRun().record).byClaude}_decisions`);
    const w = JSON.parse(read("docs/evals/worst-case-summary.json")) as { purser_script: Record<string, { wrong_payments: number }> };
    expect(row).toContain(`worst--case_AI-${Math.max(...Object.values(w.purser_script).map((r) => r.wrong_payments))}_wrong_payments`);
  });
});
