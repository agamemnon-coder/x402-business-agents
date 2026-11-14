// /proof's live runs (the owner, 13 Nov: "the proof is what we need"): one row per live run, grouped by partner, and the
// strip's run count is the number of rows, from the same array (the orchestrator, 13 Nov: a judge who counts the rows
// gets the strip's figure). The TAP run is told on /visa only; one link under the list says so.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proofPage, proofScaleStats } from "../src/redesign/proof.js";
import { elsewhereRuns, groupId, partnerTiles, PROOF_RUNS_SHOWN, proofRunCount, proofRuns, shortId, TAP_LINK } from "../src/redesign/proofRuns.js";
import { partnerNamesOf } from "../src/redesign/runs.js";
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
    expect(stat.title).toBe(`Every live run: ${proofRunCount()} listed below, ${elsewhereRuns().length} more on /visa`);
    const strip = /<ul class="scale"[\s\S]*?<\/ul>/.exec(main)![0];
    expect(strip).toContain(`<a href="#live-runs"`);
    expect(strip).toContain(`data-count="${liveRunCount()}"`);
    expect(scaleFigures().liveRuns).toBe(liveRunCount());
    expect(runsPage()).toContain(`All <b>${liveRunCount()}</b>`);
  });

  // Max, 14 Nov: a tile per partner over the timeline. The review of the same day: each badge is the partner's own rail,
  // each tile opens its own group, and one line says a run with several partners counts under each.
  it("gives each partner a tile: its runs counted from the list, its latest day, its own rail, a link to its group", () => {
    const rows = proofRuns().flatMap((g) => g.runs);
    const tiles = partnerTiles();
    expect(tiles.map((t) => [t.name, t.badge])).toEqual([["Airwallex", "Live · sandbox"], ["Visa via Airi", "Live · sandbox"], ["Alta", "Live · testnet"], ["T:0", "Live · sandbox"], ["Moneybird", "Live · sandbox"]]);
    for (const [name, partner] of [["Airwallex", "Airwallex"], ["Visa via Airi", "Visa"], ["Alta", "Alta"], ["T:0", "T:0"]] as const) {
      const mine = rows.filter((r) => partnerNamesOf(r).includes(partner));
      const t = tiles.find((x) => x.name === name)!;
      expect({ name, runs: t.runs, latest: t.latest.iso }).toEqual({ name, runs: mine.length, latest: mine.map((r) => r.iso).sort().at(-1) });
    }
    for (const t of tiles) expect(runs).toContain(`<h3 id="${t.href.slice(1)}">`);
    expect(groupId("Visa via Airwallex's Airi")).toBe("pg-visa-via-airwallex-s-airi");
    expect(main).toContain(`<p class="ptnote">${liveRunCount()} live runs. A run with several partners counts under each.</p>`);
  });

  it("shows three runs of each group, the rest behind Show all; ids short in sight, whole on hover and in a copy button shown only by the script", () => {
    for (const g of proofRuns()) {
      const at = runs.indexOf(`<h3 id="${groupId(g.group)}">`), next = runs.indexOf("<h3", at + 1);
      const part = runs.slice(at, next < 0 ? undefined : next);
      const shown = part.split('<details class="prall">')[0]!;
      expect((shown.match(/<li id="run-/g) ?? []).length).toBe(Math.min(PROOF_RUNS_SHOWN, g.runs.length));
      if (g.runs.length > PROOF_RUNS_SHOWN) expect(part).toContain(`<summary>Show all ${g.runs.length}</summary>`);
    }
    expect(shortId("int_sgpvzc9hjhnxvxc26ie")).toBe("int_sgpv…xc26ie");
    expect(shortId("je_prod_z7")).toBe("je_prod_z7");
    const buttons = [...runs.matchAll(/<button type="button" class="cp" data-copy="([^"]+)" aria-label="([^"]+)" hidden>/g)];
    expect(buttons.length).toBeGreaterThan(10);
    expect(new Set(buttons.map((b) => b[2])).size).toBe(buttons.length);
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
