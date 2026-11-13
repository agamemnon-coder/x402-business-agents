// /proof's live runs (the owner, 13 Nov: "the proof is what we need"): one row per live run, grouped by partner, and the
// strip's run count is the number of rows, from the same array (the orchestrator, 13 Nov: a judge who counts the rows
// gets the strip's figure). The TAP run is told on /visa only; one link under the list says so.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proofPage, proofScaleStats } from "../src/redesign/proof.js";
import { elsewhereRuns, proofRunCount, proofRuns, TAP_LINK } from "../src/redesign/proofRuns.js";
import { isLive, liveRuns } from "../src/redesign/runs.js";

const main = /<main[\s\S]*<\/main>/.exec(proofPage())![0];
const runs = /<section class="pruns"[\s\S]*?<\/section>/.exec(main)![0];

describe("/proof: the live runs and the strip's count", () => {
  it("lists every live run but the ones told elsewhere, one row each", () => {
    const rows = [...runs.matchAll(/<li id="run-([\w-]+)"/g)].map((m) => m[1]);
    const live = liveRuns().filter(isLive).map((r) => r.key);
    const elsewhere = elsewhereRuns().map((r) => r.key);
    expect(elsewhere).toEqual(["tap-1"]);
    expect([...rows].sort()).toEqual(live.filter((k) => !elsewhere.includes(k)).sort());
    expect(rows).toHaveLength(proofRunCount());
    expect(proofRuns().flatMap((g) => g.runs.map((r) => r.key))).toEqual(rows);
  });

  it("says the same count in the strip as the rows below it, and links the strip's figure to them", () => {
    const stat = proofScaleStats().find((s) => s.label === "sandbox and testnet runs")!;
    expect(stat.n).toBe(proofRunCount());
    expect(stat.href).toBe("#live-runs");
    const strip = /<ul class="scale"[\s\S]*?<\/ul>/.exec(main)![0];
    expect(strip).toContain(`<a href="#live-runs"`);
    expect(strip).toContain(`data-count="${proofRunCount()}"`);
  });

  it("links the TAP run to /visa, once, under the list", () => {
    expect(runs).toContain(`<p class="pr-more"><a href="visa#visa-tap">${TAP_LINK.replaceAll(">", "&gt;")}</a></p>`);
    expect(main.match(/\bTAP\b/g)).toHaveLength(1);
  });

  it("lists the anchor run of 13 Nov as Live · testnet, linking its transaction on the explorer and its record", () => {
    const rec = JSON.parse(readFileSync("docs/runs/2026-11-13-anchor.json", "utf8")) as { tx: string; block: number; explorer: string };
    const row = /<li id="run-anchor-1"[\s\S]*?<\/li>/.exec(runs)![0];
    expect(row).toContain('<span class="chip live">Live · testnet</span>');
    expect(rec.explorer).toBe(`https://testnet.metalntwx.com/tx/${rec.tx}`);
    expect(row).toContain(`href="${rec.explorer}"`);
    expect(row).toMatch(/href="[^"]*docs\/runs\/2026-11-13-anchor\.md"[^>]*>Record/);
    expect(row).toContain('data-rec="docs/runs/2026-11-13-anchor.json docs/runs/2026-11-13-anchor.md"');
  });
});
