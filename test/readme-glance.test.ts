// 15 Nov (Max): the README's "At a glance", six lines under the badges, each with a link to its record. Every figure in
// it is read here from that record, so the README cannot drift from what ran.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latestVerificationReport, partnerTiles } from "../src/redesign/proofRuns.js";
import { agentRun, longRun, split } from "../src/redesign/run.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md");
// 21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture animation can go; far fewer headings": the six lines head "The proof", under the proof strip, the wall's line and the judges' table; "At a glance"
// and "Kit 11, step by step" lost their headings (the Kit 11 line is a bold lead after the six lines).
const GLANCE = README.slice(README.indexOf("\n## The proof\n"), README.indexOf("\n**Kit 11, step by step.** "));
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

  // 21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture animation can go; far fewer headings"; checking every figure against its record: the third line was the worst-case AI test of 15 Nov (50 cases,
  // 0 vs 35), older than the held-out evals since; it says the newest held-out eval now, as /proof's one eval tile does.
  it("says the newest held-out eval's figures as its record has them", () => {
    const n = Math.max(...readdirSync(new URL("../docs/evals/", import.meta.url)).map((f) => /^adversarial-v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number));
    const file = `docs/evals/adversarial-v${n}.json`;
    const v = JSON.parse(read(file)) as { held_out: boolean; cases_commit: string; totals: Record<"purser_script" | "no_rules", { cases: number; wrong_payments: number; false_holds: number; clean_truths: number }> };
    expect(v.held_out).toBe(true);
    const p = v.totals.purser_script, none = v.totals.no_rules;
    expect(lines[2]).toContain(`**The newest held-out eval (v${n}, offline, test data):** ${p.cases} invoice cases committed before they were first run (commit \`${v.cases_commit}\`); with a script that always says pay in the model's place, ${p.wrong_payments} wrong payments with Purser's rules, ${none.wrong_payments} with no rules; ${p.false_holds} false holds of ${p.clean_truths} clean invoices`);
    expect(lines[2]).toContain(`(${file})`);
    expect(README).not.toMatch(/worst-case AI[^\n]*0 wrong payments/);
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
  // Jury pass, 20 Nov: the newest report, dated, as the proof strip and the evidence map show it (it said 15 Nov's 189
  // checks under a strip that says 262).
  it("names no Airwallex call count, links every call, and quotes the newest verification report's summary, dated", () => {
    expect(lines[4]).toContain("**The Airwallex sandbox calls in the run records**, listed with what came back and its record: [/airwallex/calls]");
    expect(GLANCE).not.toMatch(/\b(?:150|154)\b/);
    const file = latestVerificationReport()!;
    const v = JSON.parse(read(file)) as { summary: string; started_at: string };
    const day = new Date(v.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    expect(lines[5]).toContain(`the newest live report, ${day}: ${v.summary} ([report](${file.replace(/\.json$/, ".md")}))`);
  });

  // 17 Nov (owner): the partners' status badges became cells of the proof strip (scripts/readme-proof-strip.ts); its alt
  // text says what the picture shows.
  it("backs each status cell of the proof strip with its record", () => {
    const row = README.split("\n").find((l) => l.includes("docs/assets/readme/proof-strip-light.svg")) ?? "";
    const live = Object.fromEntries(partnerTiles().map((t) => [t.name, t.runs]));
    // Sandbox or Testnet for a partner (LIVE until 17 Nov): at least one live run of that partner in the run records (the tiles on /proof count them).
    for (const n of ["Airwallex", "Alta", "Visa via Airi", "T:0"]) expect({ n, runs: (live[n] ?? 0) > 0 }).toEqual({ n, runs: true });
    for (const s of ["Airwallex sandbox", "Alta (formerly Metal) testnet", "Visa via Airi sandbox", "T:0 sandbox ledger"]) expect(row).toContain(s);
    // 20 Nov: the long run's count (as /proof's Claude tile), the main run's while the long run's record is missing.
    expect(row).toContain(`Claude ${longRun()?.byClaude ?? split(agentRun().record).byClaude} decisions, live`);
  });
});
