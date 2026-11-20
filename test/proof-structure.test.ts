// /proof by the questions a judge asks (the owner, 21 Nov): every figure of the wall in exactly one section, dated from
// its records; a superseded held-out eval round only in the history, the newest in sight whatever its number; the
// charts read from their records with their numbers as a table. src/redesign/proofQuestions.ts, proofCharts.ts,
// src/proof/recordDate.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { committedWall, onProof, type EvidenceWall, type WallTile } from "../src/redesign/evidenceWall.js";
import { NEVER_ON_PROOF, QUESTIONS, newestEvalKey, placeTiles, tileHtml } from "../src/redesign/proofQuestions.js";
import { chartHtml, coverageChart, evalChart, evalRounds, redTeamChart, refusalsChart } from "../src/redesign/proofCharts.js";
import { newestDate, recordDate } from "../src/proof/recordDate.js";

const wall = committedWall()!;
const json = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8")) as Record<string, unknown>;
const tile = (key: string, extra: Partial<WallTile> = {}): WallTile => ({ key, fig: "1", label: "x", note: "n", tag: "test", tone: "", href: "https://github.com/", rec: "docs/evidence/fuzzing.json", ...extra });

describe("the question sections", () => {
  it("place every tile shown on /proof exactly once, and nothing told only on /visa", () => {
    const placed = placeTiles(wall);
    const keys = placed.flatMap((p) => p.blocks.flatMap((b) => b.tiles.map((t) => t.key)));
    const shown = onProof(wall).groups.flatMap((g) => g.tiles.map((t) => t.key));
    expect([...keys].sort()).toEqual([...shown].sort());
    expect(new Set(keys).size).toBe(keys.length);
    const folded = placed.flatMap((p) => [...p.more, ...p.superseded].map((t) => t.key));
    for (const k of NEVER_ON_PROOF) expect(folded).not.toContain(k);
    expect(placed.map((p) => p.q.id)).toEqual(QUESTIONS.map((q) => q.id));
  });

  it("put a tile no block names in its wall group's section, so a new record is never dropped", () => {
    const w: EvidenceWall = { ...wall, groups: [...wall.groups, { id: "ev-attacked", title: "x", tiles: [tile("brand-new-check")] }] };
    const p = placeTiles(w).find((x) => x.blocks.some((b) => b.tiles.some((t) => t.key === "brand-new-check")))!;
    expect(p.q.id).toBe("q-built");
  });

  it("show the newest held-out eval round, whatever its number, and the older ones as superseded", () => {
    const evals = wall.groups.flatMap((g) => g.tiles).filter((t) => /^eval-v\d+$/.test(t.key));
    const v = (k: string) => Number(k.slice(6));
    const shown = evals.filter((t) => !t.offProof).map((t) => t.key);
    expect(newestEvalKey(wall)).toBe(shown.sort((a, b) => v(b) - v(a))[0]);
    // A later round (v99 here) takes the place in sight; the round before it becomes history, labelled.
    const later: EvidenceWall = { ...wall, groups: wall.groups.map((g) => (g.id === "ev-ai" ? { ...g, tiles: [...g.tiles.map((t) => (/^eval-v\d+$/.test(t.key) ? { ...t, offProof: true } : t)), tile("eval-v99")] } : g)) };
    expect(newestEvalKey(later)).toBe("eval-v99");
    const ai = placeTiles(later).find((p) => p.q.id === "q-ai")!;
    expect(ai.blocks.flatMap((b) => b.tiles).filter((t) => /^eval-v/.test(t.key)).map((t) => t.key)).toEqual(["eval-v99"]);
    expect(ai.superseded.map((t) => t.key)).toEqual(evals.map((t) => t.key).sort((a, b) => v(b) - v(a)));
  });

  it("show each tile's day beside its tag, or \"as built\" when no record says one", () => {
    expect(tileHtml(tile("a", { asOf: "2026-11-19" }))).toContain('<time class="ew-d" datetime="2026-11-19">19 Nov</time>');
    expect(tileHtml(tile("a", { asOf: null }))).toContain('<time class="ew-d">as built</time>');
  });
});

describe("a record's day (src/proof/recordDate.ts)", () => {
  it("reads it from a run's name, a record's own field or a Markdown record's head, the newest of several", () => {
    expect(recordDate("docs/runs/2026-11-19-alta-series.json")).toBe("2026-11-19");
    expect(recordDate("docs/demo/main-run.json")).toBe(String(json("docs/demo/main-run.json").recorded_at).slice(0, 10));
    expect(recordDate("docs/evidence/site-quality.json")).toBe(String(json("docs/evidence/site-quality.json").measured_at).slice(0, 10));
    expect(recordDate("docs/evidence/formal-model.md")).toBe("2026-11-19");
    expect(recordDate("docs/runs")).toBeNull();
    expect(newestDate("docs/demo/main-run.json docs/runs/2026-11-20-long-run.md")).toBe("2026-11-20");
  });

  it("is written into the wall's file for every tile (npm run evidence:wall)", () => {
    for (const t of wall.groups.flatMap((g) => g.tiles)) expect(t.asOf === null || /^\d{4}-\d{2}-\d{2}$/.test(t.asOf ?? ""), t.key).toBe(true);
  });
});

describe("the charts", () => {
  it("read the red team's runs, the eval rounds, the newest round's refusals and the coverage from their records", () => {
    const rt = redTeamChart()!;
    const runs = ["docs/redteam/report.json", "docs/redteam/rerun-2026-11-19.json", "docs/redteam/rerun-2026-11-19b.json", "docs/redteam/rerun-2026-11-20.json"].map(json) as { attempts: number; blocked: number; caught_after: number }[];
    expect(rt.rows.map((r) => r.values.before! + r.values.after! + r.values.not!)).toEqual(runs.map((r) => r.attempts));
    expect(rt.rows.map((r) => r.values.after)).toEqual(runs.map((r) => r.caught_after));
    const rounds = evalRounds();
    expect(rounds.every((r) => r.rec.held_out)).toBe(true);
    expect(evalChart()!.rows.map((r) => r.values.purser)).toEqual(rounds.map((r) => r.rec.totals!.purser_script!.wrong_payments));
    const by = rounds.at(-1)!.rec.totals!.purser_script!.by_rule!;
    expect(refusalsChart()!.rows.reduce((n, r) => n + r.values.n!, 0)).toBe(Object.values(by).reduce((a, b) => a + b, 0));
    const cov = json("docs/evidence/coverage.json") as { scopes: { product: { after: { statements: { pct: number } } } } };
    expect(coverageChart()!.rows[0]!.values.after).toBe(cov.scopes.product.after.statements.pct);
  });

  it("each name their records, draw plain SVG with a title and a description, and carry their numbers as a table", () => {
    for (const c of [redTeamChart(), evalChart(), refusalsChart(), coverageChart()]) {
      const html = chartHtml(c);
      expect(html).toMatch(/^<figure class="pchart" id="chart-[a-z]+" data-rec="[^"]+">/);
      expect(html).toMatch(/<svg [^>]*role="img" aria-labelledby="chart-[a-z]+-t chart-[a-z]+-d"><desc>/);
      expect(html).toContain("<table>");
      expect(html).not.toMatch(/<script|style=|\son[a-z]+=/i);
    }
  });
});
