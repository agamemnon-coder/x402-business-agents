// /proof's live runs (the owner, 13 Nov: "the proof is what we need"): one row per live run, grouped by partner, and the
// strip's run count is the number of rows, from the same array (the orchestrator, 13 Nov: a judge who counts the rows
// gets the strip's figure). The TAP run is told on /visa only; one link under the list says so.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proofPage, proofScaleStats } from "../src/redesign/proof.js";
import { elsewhereRuns, proofRunCount, proofRuns, TAP_LINK } from "../src/redesign/proofRuns.js";
import { isLive, liveRunCount, liveRuns, runsPage } from "../src/redesign/runs.js";
import { scaleFigures } from "../src/redesign/scale.js";

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

  // Judge panel, 13 Nov: /proof said 23 runs while /home and /runs said 24. All three read liveRunCount() now; /proof's
  // strip says that the rows below it are every one but the TAP run, which /visa tells.
  it("says the site's one live-run count in the strip, the same as /home and /runs, and says which run is told on /visa", () => {
    const stat = proofScaleStats().find((s) => s.label === "sandbox and testnet runs")!;
    expect(stat.n).toBe(liveRunCount());
    expect(stat.n).toBe(proofRunCount() + elsewhereRuns().length);
    expect(stat.href).toBe("#live-runs");
    expect(stat.title).toBe(`Every live run: ${proofRunCount()} listed below, the Visa TAP run on /visa`);
    const strip = /<ul class="scale"[\s\S]*?<\/ul>/.exec(main)![0];
    expect(strip).toContain(`<a href="#live-runs"`);
    expect(strip).toContain(`data-count="${liveRunCount()}"`);
    expect(scaleFigures().liveRuns).toBe(liveRunCount());
    expect(runsPage()).toContain(`All <b>${liveRunCount()}</b>`);
  });

  it("links the TAP run to /visa, once, under the list", () => {
    expect(runs).toContain(`<p class="pr-more"><a href="visa#visa-tap">${TAP_LINK.replaceAll(">", "&gt;")}</a></p>`);
    // Linked once; the strip's title also names it, to say why its count is one more than the rows (judge panel, 13 Nov).
    expect(main.match(/href="visa#visa-tap"/g)).toHaveLength(1);
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
