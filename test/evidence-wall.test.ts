// /proof's evidence wall (src/redesign/evidenceWall.ts, its figures in src/redesign/evidenceWallData.ts): the committed
// file is what the records give now, every tile names a record that exists and links to it, the figures are the
// records' own, a later recording of the /try walks is added up with the first, and /proof renders the file with no
// inline script or style (the page's CSP).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVIDENCE_WALL_CSS, WALL_FILE, committedWall, evidenceWallHtml, type EvidenceWall, type WallTile } from "../src/redesign/evidenceWall.js";
import { evidenceWall, evidenceWallFile } from "../src/redesign/evidenceWallData.js";
import { liveTryRecords, liveTryTotals, nearestRank, type LiveTryRecord } from "../src/redesign/liveTry.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { proofPage } from "../src/redesign/proof.js";
import { countOf } from "../src/redesign/ui.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
const exists = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));
const tiles = (w: EvidenceWall) => w.groups.flatMap((g) => g.tiles);
const tile = (w: EvidenceWall, key: string) => tiles(w).find((t) => t.key === key)!;

describe("the evidence wall's file", () => {
  it("is what the records give now (npm run evidence:wall)", () => {
    expect(read(WALL_FILE)).toBe(evidenceWallFile());
  });

  it("has five groups, each tile with a figure, a line, a tag, a record that exists and a link to it", () => {
    const w = committedWall()!;
    expect(w.groups.map((g) => g.title)).toEqual(["Live on the rails", "Cannot be forged", "AI under control", "Built to last", "The public /try, timed"]);
    const keys = tiles(w).map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of tiles(w)) {
      expect(t.fig, t.key).toMatch(/\d|^Both$/);
      expect(t.label.length, t.key).toBeGreaterThan(10);
      expect(`${t.fig} ${t.label} ${t.note}`, t.key).not.toMatch(/\b(\d[\d,]*)\/\1\b|\b(\d[\d,]*) of \2\b/);
      expect(t.rec, t.key).not.toBe("");
      for (const f of t.rec.split(" ")) expect(exists(f), `${t.key}: ${f}`).toBe(true);
      // A link into the repository names a file that is there; a site path is relative.
      if (t.href.startsWith(REPO_BLOB)) expect(exists(t.href.slice(REPO_BLOB.length).split("#")[0]!), t.key).toBe(true);
      else expect(t.href, t.key).toMatch(/^(https:\/\/|[a-z#])/);
    }
  });

  it("reads each figure from its record", () => {
    const w = committedWall()!;
    const tm = json<{ totals: { tried: number; refused: number } }>("docs/evidence/tamper-matrix.json").totals;
    expect(tile(w, "tamper-matrix").fig).toBe(tm.refused === tm.tried ? `All ${tm.tried.toLocaleString("en-GB")}` : `${tm.refused.toLocaleString("en-GB")} of ${tm.tried.toLocaleString("en-GB")}`);
    const cov = json<{ totals: { live: number; endpoints: number } }>("docs/evidence/airwallex-api-coverage.json").totals;
    expect(tile(w, "awx-endpoints").fig).toBe(String(cov.live));
    const s = json<{ aggregate: { runs: number; ok: number; refused: number; airwallex: { transfers: number; paid: number }; claude: { entries: number; fallbacks: number } } }>("docs/runs/2026-11-19-live-try/summary.json").aggregate;
    expect(tile(w, "try-journeys").fig).toBe(countOf(s.ok, s.runs));
    expect(tile(w, "try-transfers").fig).toBe(countOf(s.airwallex.paid, s.airwallex.transfers));
    expect(tile(w, "try-cent").fig).toBe(countOf(s.refused, s.runs));
    expect(tile(w, "try-claude")).toMatchObject({ fig: String(s.claude.fallbacks), label: `fallbacks in ${s.claude.entries} Claude calls on /try` });
    const rt = json<{ attempts: number; blocked: number; caught_after: number }>("docs/redteam/report.json");
    expect(tile(w, "red-team").fig).toBe(countOf(rt.blocked - rt.caught_after, rt.attempts));
    const bills = json<{ bills: { bill_id: string | null }[] }>("docs/runs/2026-11-19-airwallex-bills.json").bills.filter((b) => b.bill_id);
    expect(tile(w, "spend-bills").fig).toBe(countOf(bills.length, bills.length));
  });

  it("says what was simulated: every PAID at the sandbox is the sandbox's simulation, and a test world is labelled", () => {
    const w = committedWall()!;
    for (const t of tiles(w).filter((x) => /PAID/.test(x.label))) expect(t.note, t.key).toMatch(/simulation/);
    for (const k of ["tamper-matrix", "worst-case", "red-team", "hostile-model"]) expect(tile(w, k).tag, k).toBe("test");
    // No partner is said to endorse anything, and Visa is named in text only.
    expect(JSON.stringify(w)).not.toMatch(/endorse|partnered with|certified by/i);
  });
});

/** A synthetic series of /try walks in the recorder's shape. */
const series = (dir: string, first: string, steps: number[], o: { refused?: number } = {}): LiveTryRecord => ({
  dir, summary: `${dir}/summary.json`, log: `${dir}.md`, first, last: first,
  aggregate: { runs: steps.length, ok: steps.length, refused: o.refused ?? steps.length, held: steps.length, approvals_matching_transfer: steps.length, console_errors: 0, outside_requests: 0,
    airwallex: { transfers: 2 * steps.length, paid: 2 * steps.length }, claude: { entries: 15 * steps.length, api_requests: 23 * steps.length, cost_usd_micros: 5000 * steps.length, fallbacks: 0, models: ["claude-haiku-5-5"] } },
  runs: steps.map((ms, i) => ({
    run: i + 1, started_at: first, steps_ms: { sign_to_paid_on_screen_ms: ms, refusal_ms: 700 }, airwallex: [{ scheduled_to_paid_ms: 2000 + i }],
    claude: { request_ids: [`req_011${dir.slice(-4)}${i}aaaaaaaaaa`] },
    bundle: { downloaded: { verify_page: "VALID every check passes (11 of 11)", repo_verifier: { ok: true } }, paid: { verify_page: "VALID every check passes (10 of 10)", repo_verifier: { ok: true } } },
  })),
});

describe("the /try walks, added up over every recorded series", () => {
  it("finds the series of 19 Nov in docs/runs", () => {
    expect(liveTryRecords().map((r) => r.dir)).toContain("docs/runs/2026-11-19-live-try");
  });

  it("sums the counts and recomputes the percentiles over every run's own times", () => {
    const a = series("docs/runs/x-a", "2026-11-19T07:00:00.000Z", [6000, 6100, 6200, 6300]);
    const b = series("docs/runs/x-b", "2026-11-20T07:00:00.000Z", [5000, 5100, 9000, 9100, 9200, 9300], { refused: 5 });
    const t = liveTryTotals([a, b])!;
    expect(t).toMatchObject({ runs: 10, ok: 10, transfers: 20, paid: 20, refused: 9, proofs: 20, proofsValid: 20, days: ["2026-11-19", "2026-11-20"] });
    expect(t.claude).toMatchObject({ entries: 150, requests: 230, distinctIds: 10, costMicros: 50_000 });
    const all = [6000, 6100, 6200, 6300, 5000, 5100, 9000, 9100, 9200, 9300];
    expect(t.steps.sign_to_paid_on_screen_ms).toEqual({ n: 10, p50: nearestRank(all, 0.5), p95: nearestRank(all, 0.95) });
    expect(nearestRank(all, 0.5)).toBe(6200);
  });

  it("feeds the wall: a later series moves its figures, and its link goes to the run folder", () => {
    const a = series("docs/runs/x-a", "2026-11-19T07:00:00.000Z", [6000, 6100]);
    const b = series("docs/runs/x-b", "2026-11-19T09:00:00.000Z", [5000, 5100, 5200]);
    const one = evidenceWall([a]), two = evidenceWall([a, b]);
    expect(tile(one, "try-journeys").fig).toBe("Both");
    expect(tile(two, "try-journeys").fig).toBe("All 5");
    expect(tile(two, "try-transfers").fig).toBe("All 10");
    expect(tile(two, "try-cost").fig).toBe("USD 0.0050");
    expect(tile(one, "try-journeys").href).toBe(`${REPO_BLOB}docs/runs/x-a.md`);
    expect(tile(two, "try-journeys").href).toMatch(/\/tree\/main\/docs\/runs$/);
    expect(tile(two, "try-journeys").rec).toBe("docs/runs/x-a/summary.json docs/runs/x-b/summary.json");
  });
});

describe("/proof renders the wall", () => {
  it("as the file says, every tile a link, with no inline script, style or handler", () => {
    const w = committedWall()!;
    const html = evidenceWallHtml(w);
    expect(proofPage()).toContain(html);
    for (const t of tiles(w) as WallTile[]) expect(html).toContain(`data-wall="${t.key}"`);
    expect((html.match(/<li class="ew-t/g) ?? []).length).toBe(tiles(w).length);
    expect(html).not.toMatch(/<script|style=|\son[a-z]+=/i);
    expect(EVIDENCE_WALL_CSS).toContain("@media (max-width: 420px)");
  });
});
