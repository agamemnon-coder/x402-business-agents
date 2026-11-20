// /proof's evidence wall (src/redesign/evidenceWall.ts, its figures in src/redesign/evidenceWallData.ts): the committed
// file is what the records give now, every tile names a record that exists and links to it, the figures are the
// records' own, a later recording of the /try walks is added up with the first, and /proof renders the file with no
// inline script or style (the page's CSP).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVIDENCE_WALL_CSS, LLMS_WALL_HEADING, PARTNER_STRIPS, evidenceLeadHtml, README_WALL_KEYS, evidenceStripHtml, readmeWallLine, withReadmeWallLine, WALL_FILE, committedWall, evidenceWallHtml, evidenceWallLlms, withWallSection, type EvidenceWall, type WallTile } from "../src/redesign/evidenceWall.js";
import { evidenceWall, evidenceWallFile, wallWalks } from "../src/redesign/evidenceWallData.js";
import { liveTryRecords, liveTryTotals, nearestRank, type LiveTryRecord } from "../src/redesign/liveTry.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { proofPage } from "../src/redesign/proof.js";
import { README_MAP_FILES, evidenceMapSvgFile, readmeMapLine } from "../src/redesign/evidenceMap.js";
import { countOf } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
const exists = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));
const tiles = (w: EvidenceWall) => w.groups.flatMap((g) => g.tiles);
const tile = (w: EvidenceWall, key: string) => tiles(w).find((t) => t.key === key)!;

describe("the evidence wall's file", () => {
  it("is what the records give now (npm run evidence:wall)", () => {
    expect(read(WALL_FILE)).toBe(evidenceWallFile());
  });

  it("has seven groups, each tile with a figure, a line, a tag, a record that exists and a link to it", () => {
    const w = committedWall()!;
    expect(w.groups.map((g) => g.title)).toEqual(["Live on the rails", "Cannot be forged", "AI under control", "Attacked and broken on purpose", "Built to last", "Quality and supply chain", "The public /try, timed"]);
    const keys = tiles(w).map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of tiles(w)) {
      // A figure, or (for an outside programme's badge, tagged external) its status word.
      expect(t.fig, t.key).toMatch(t.tag === "external" ? /^[A-Z][a-z]+$/ : /\d|^Both$/);
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
    // The /try walks: every recorded series added up (src/redesign/liveTry.ts; 19 Nov: the morning's 8 and the mega run's 17),
    // but the WebKit check, out of the band (scale.ts NOT_IN_BAND), which has a tile of its own.
    expect(wallWalks().map((r) => r.dir)).not.toContain("docs/runs/2026-11-19-webkit-try");
    const t = liveTryTotals(wallWalks())!;
    expect(t.records.length).toBeGreaterThanOrEqual(2);
    expect(tile(w, "try-journeys").fig).toBe(countOf(t.siteStepsPassed, t.runs));
    expect(tile(w, "try-transfers").fig).toBe(countOf(t.paid, t.transfers));
    expect(tile(w, "try-cent").fig).toBe(countOf(t.refused, t.runs));
    expect(tile(w, "try-claude")).toMatchObject({ fig: String(t.claude.fallbacks), label: `fallbacks in ${t.claude.entries} Claude calls on /try` });
    // Honest about the walks recorded before the reader's request-id fix was deployed.
    if (t.claude.readerNoId) expect(tile(w, "try-claude").note).toContain(`${t.claude.readerNoId} reader calls were logged with no request id`);
    if (t.ok !== t.siteStepsPassed) expect(tile(w, "try-journeys").note).toContain(`marked ${countOf(t.ok, t.runs, true)} all ok`);
    // Every soak record (19 and 20 Nov so far), each figure the sum of the same field in each, read here from the files.
    type Sk = { summary: { created: number; readback_matches: number; conversions: { planned: number; readback_matches: number }; negatives: { planned: number; refused: number; posts_in_window: number; calls_in_window: number } } };
    const files = readdirSync(new URL("../docs/runs/", import.meta.url)).filter((n) => /^\d{4}-\d{2}-\d{2}-airwallex-soak\.json$/.test(n)).sort().map((n) => `docs/runs/${n}`);
    expect(files).toEqual(["docs/runs/2026-11-19-airwallex-soak.json", "docs/runs/2026-11-20-airwallex-soak.json"]);
    const all = files.map((f) => json<Sk>(f).summary), sum = (f: (s: Sk["summary"]) => number) => all.reduce((n, s) => n + f(s), 0);
    expect(tile(w, "soak-paid").fig).toBe(countOf(sum((s) => s.readback_matches), sum((s) => s.created)));
    expect(tile(w, "soak-paid").fig).toBe("All 60");
    expect(tile(w, "soak-fx").fig).toBe(countOf(sum((s) => s.conversions.readback_matches), sum((s) => s.conversions.planned)));
    expect(tile(w, "soak-negatives").fig).toBe(countOf(sum((s) => s.negatives.refused), sum((s) => s.negatives.planned)));
    expect(tile(w, "soak-negatives").note).toMatch(new RegExp(`^${sum((s) => s.negatives.posts_in_window)} money-moving calls .*; ${sum((s) => s.negatives.calls_in_window)} reads in the refusal windows`));
    for (const k of ["soak-paid", "soak-fx", "soak-negatives"]) expect(tile(w, k).rec.split(" ")).toEqual(files.flatMap((f) => [f, f.replace(/\.json$/, ".md")]));
    // 19 Nov, fourth round: the newest red-team run (the scripted attacks re-run after the fixes), labelled as a re-run,
    // with the first run of 30 Oct in its note and its records.
    const rt = json<{ attempts: number; blocked: number; caught_after: number }>("docs/redteam/report.json");
    // 19 Nov, fifth round: the newest is the re-run after agent cards were frozen by default (hidden-payment prevented);
    // the fourth round's re-run and the first run stay as recorded, named in the note and linked from the records.
    type Rr = { attempts: number; blocked: number; caught_after: number; rerun_of: string; commit: string; dirty: boolean };
    const rr = json<Rr>("docs/redteam/rerun-2026-11-19b.json");
    const r4 = json<Rr>("docs/redteam/rerun-2026-11-19.json");
    expect(rr.rerun_of).toBe("docs/redteam/report.json");
    expect(rr.dirty).toBe(false);
    expect(tile(w, "red-team").fig).toBe(countOf(rr.blocked - rr.caught_after, rr.attempts));
    expect(tile(w, "red-team").label).toMatch(/re-run, not held out$/);
    expect(tile(w, "red-team").note).toMatch(/^Newest re-run, 19 Nov, after agent cards were frozen by default/);
    expect(tile(w, "red-team").note).toContain(`Earlier re-run, 19 Nov: ${countOf(r4.blocked - r4.caught_after, r4.attempts).toLowerCase()}, ${r4.caught_after} found afterwards (hidden-payment)`);
    expect(tile(w, "red-team").note).toContain(`${countOf(rt.blocked - rt.caught_after, rt.attempts).toLowerCase()}, ${rt.caught_after} found afterwards`);
    expect(tile(w, "red-team").href).toMatch(/docs\/redteam\/rerun-2026-11-19b\.json$/);
    expect(tile(w, "red-team").rec.split(" ")).toEqual(["docs/redteam/rerun-2026-11-19b.json", "docs/redteam/rerun-2026-11-19.json", "docs/redteam/report.json"]);
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
    const shown = (tiles(w) as WallTile[]).filter((t) => !t.offProof);
    for (const t of shown) expect(html).toContain(`data-wall="${t.key}"`);
    expect((html.match(/<li class="ew-t/g) ?? []).length).toBe(shown.length);
    // A tile kept off /proof (TAP: told on /visa only) is not on the page.
    for (const t of (tiles(w) as WallTile[]).filter((x) => x.offProof)) expect(html).not.toContain(`data-wall="${t.key}"`);
    expect(html).not.toMatch(/<script|style=|\son[a-z]+=/i);
    expect(EVIDENCE_WALL_CSS).toContain("@media (max-width: 420px)");
  });
});

describe("llms.txt's evidence section", () => {
  it("is the wall's file in plain text, after the judges' path, each line with an absolute link (npm run evidence:wall)", () => {
    const t = read("llms.txt"), section = evidenceWallLlms(committedWall());
    expect(t).toContain(`${section}\n\n## `);
    expect(t.indexOf(LLMS_WALL_HEADING)).toBeGreaterThan(t.indexOf("## For judges"));
    expect(withWallSection(t, section)).toBe(t);
    for (const l of section.split("\n").filter((x) => x.startsWith("- "))) expect(l).toMatch(/\): https:\/\/\S+$/);
    expect(section.split("\n").filter((x) => x.startsWith("- "))).toHaveLength(tiles(committedWall()!).length);
  });
});

describe("the README's wall line and the partner pages' strips", () => {
  it("the README carries the wall's line under the judge path: its figures the wall's own (npm run evidence:wall)", () => {
    const readme = read("README.md"), line = readmeWallLine(committedWall());
    expect(readme).toContain(`\n\n${line}\n`);
    expect(withReadmeWallLine(readme, line, readmeMapLine(committedWall()))).toBe(readme);
    // The map's two pictures are what the wall's file draws now, with nothing external and a still frame for reduced motion.
    for (const theme of ["light", "dark"] as const) {
      const svg = read(README_MAP_FILES[theme]);
      expect(svg).toBe(evidenceMapSvgFile(theme, committedWall()));
      expect(svg).not.toMatch(/<script|href=|@import|url\(|<image/i);
      expect(svg).toContain("@media (prefers-reduced-motion: reduce)");
    }
    expect(readme).toContain(readmeMapLine(committedWall()));
    expect(readme.indexOf(line)).toBeGreaterThan(readme.indexOf("**1. [Watch the demo"));
    for (const k of README_WALL_KEYS) expect(line).toContain(tile(committedWall()!, k).fig);
  });

  it("each strip shows the wall's own tiles, links to its group on /proof, and says it is test money", () => {
    const w = committedWall()!;
    for (const p of ["airwallex", "alta", "visa", "tap"] as const) {
      const html = evidenceStripHtml(p, {}, w);
      for (const k of PARTNER_STRIPS[p].keys) expect(html, `${p} ${k}`).toContain(`data-wall="${k}"`);
      expect(html).toContain(`href="proof#${PARTNER_STRIPS[p].group}"`);
      expect(html).toMatch(/test money|no money moved/);
      expect(html).not.toMatch(/<script|style=|\son[a-z]+=|endorsed by|partnered with/i);
    }
  });

  // 19 Nov (the owner: "lead with the strongest live-proven result"): /airwallex opens with the wall's own figures as chips.
  it("/airwallex's lead shows the wall's own figures and links, says what was simulated, and sits right under the heading", () => {
    const w = committedWall()!;
    const html = evidenceLeadHtml("airwallex", w);
    const chips = [...html.matchAll(/<li data-wall="([^"]+)" data-rec="([^"]+)"><a href="([^"]+)"[^>]*><b>([^<]+)<\/b>([^<]+)<\/a><\/li>/g)].map((m) => ({ key: m[1]!, rec: m[2]!, href: m[3]!, fig: m[4]!, words: m[5]! }));
    expect(chips.map((c) => c.key)).toEqual(["soak-paid", "soak-fx", "spend-bills", "try-transfers", "awx-endpoints"]);
    for (const c of chips) expect(c).toMatchObject({ rec: tile(w, c.key).rec, href: tile(w, c.key).href.replace(/&/g, "&amp;"), fig: tile(w, c.key).fig });
    // The endpoints' total from the tile's own label ("Airwallex endpoints live, of 61"), never typed in.
    const cov = json<{ totals: { endpoints: number; live: number } }>("docs/evidence/airwallex-api-coverage.json");
    expect(chips.at(-1)).toMatchObject({ fig: String(cov.totals.live), words: `of ${cov.totals.endpoints} endpoints live` });
    expect(html).toContain("a PAID is the sandbox's simulation");
    expect(html).not.toMatch(/<script|style=|\son[a-z]+=|endorsed by|partnered with/i);
    expect(evidenceLeadHtml("airwallex", { ...w, groups: [] })).toBe("");
    const page = buildPages().airwallex!;
    const at = page.indexOf('id="lead-airwallex"');
    expect(at).toBeGreaterThan(page.indexOf("</h1></div>"));
    expect(at).toBeLessThan(page.indexOf('<ol class="awpath"'));
  });
});

describe("the OpenSSF Best Practices tile", () => {
  it("is the record's status, links to the project page, and is text: no outside image on /proof", () => {
    const os = json<{ status: string; url: string; project: number }>("docs/evidence/openssf-best-practices.json");
    const t = tile(committedWall()!, "openssf");
    expect(t).toMatchObject({ tag: "external", href: os.url, rec: "docs/evidence/openssf-best-practices.json" });
    expect(t.fig.toLowerCase()).toBe(os.status);
    expect(t.label).toContain(String(os.project));
    expect(proofPage()).not.toContain("bestpractices.dev/projects/16923/badge");
  });
});

describe("the evidence of 19 Nov: attacked and broken on purpose, quality and supply chain", () => {
  const w = () => committedWall()!;
  it("reads the red team, chaos and fuzzing figures from their records, and says the failures", () => {
    const ra = json<{ totals: { attacks: number; pass: number; fail: number }; results: { verdict: string; target: string }[] }>("docs/evidence/redteam-api.json");
    expect(tile(w(), "redteam-api")).toMatchObject({ fig: countOf(ra.totals.pass, ra.totals.attacks), tag: "test", rec: "docs/evidence/redteam-api.json" });
    if (ra.totals.fail) expect(tile(w(), "redteam-api").note).toMatch(new RegExp(`^${ra.totals.fail} fail`));
    const cm = json<{ totals: { scenarios: number; crashes: number; faults: number }; invariants: Record<string, { broken: number }> }>("docs/evidence/chaos-money.json");
    const broken = Object.values(cm.invariants).reduce((n, i) => n + i.broken, 0);
    expect(tile(w(), "chaos-money").fig).toBe(String(broken));
    expect(tile(w(), "chaos-money").label).toContain(cm.totals.scenarios.toLocaleString("en-GB"));
    expect(tile(w(), "chaos-money").note).toContain(`${cm.totals.crashes} process deaths, ${cm.totals.faults} faults`);
    const fz = json<{ totals: { properties: number; runs: number; passed: number; failed: number } }>("docs/evidence/fuzzing.json").totals;
    expect(tile(w(), "fuzzing").fig).toBe(countOf(fz.passed, fz.properties));
    if (fz.failed) expect(tile(w(), "fuzzing").label).toContain(`${fz.failed} findings open`);
    expect(tile(w(), "fuzzing").note).toContain(fz.runs.toLocaleString("en-GB"));
  });

  it("reads eval v3, eval v4 to v6 before and after, eval v7, site quality and the WebKit walks from their records", () => {
    const v3 = json<{ totals: { purser_script: { wrong_payments: number }; no_rules: { wrong_payments: number } } }>("docs/evals/adversarial-v3.json").totals;
    expect(tile(w(), "eval-v3").fig).toBe(`${v3.purser_script.wrong_payments} vs ${v3.no_rules.wrong_payments}`);
    // 19 Nov, fourth round: the held-out figure, and its re-run after the fixes in the note, as v4's.
    const v3a = json<{ held_out: boolean; totals: { purser_script: { wrong_payments: number; false_holds: number } } }>("docs/evals/adversarial-v3-rerun-2026-11-19.json");
    expect(v3a.held_out).toBe(false);
    expect(tile(w(), "eval-v3").note).toContain(`Re-run after the 19 Nov fixes written against these misses (not held out): ${v3a.totals.purser_script.wrong_payments} wrong payments, ${v3a.totals.purser_script.false_holds} false holds`);
    // Eval v4: the held-out figure, and beside it the figures after the fixes written against its misses (third round).
    const v4 = json<{ totals: { purser_script: { wrong_payments: number; false_holds: number }; no_rules: { wrong_payments: number } } }>("docs/evals/adversarial-v4.json").totals;
    const v4a = json<{ held_out: boolean; totals: { purser_script: { wrong_payments: number; false_holds: number } } }>("docs/evals/adversarial-v4-after.json");
    expect(v4a.held_out).toBe(false);
    expect(tile(w(), "eval-v4").fig).toBe(`${v4.purser_script.wrong_payments} vs ${v4.no_rules.wrong_payments}`);
    expect(tile(w(), "eval-v4").note).toContain(`After the fixes written against these misses (no longer held out): ${v4a.totals.purser_script.wrong_payments} wrong payments, ${v4a.totals.purser_script.false_holds} false holds`);
    // 19 Nov, fourth round: and the dated re-run on the code after it, not held out.
    const v4r = json<{ held_out: boolean; totals: { purser_script: { wrong_payments: number; false_holds: number } } }>("docs/evals/adversarial-v4-rerun-2026-11-19.json");
    expect(v4r.held_out).toBe(false);
    expect(tile(w(), "eval-v4").note).toContain(`Re-run after the fourth round of 19 Nov: ${v4r.totals.purser_script.wrong_payments} wrong payments, ${v4r.totals.purser_script.false_holds} false holds`);
    // Eval v5: its held-out run as recorded, and beside it the figures after the fixes written against its misses.
    type Adv = { held_out: boolean; cases_commit: string; totals: { purser_script: { wrong_payments: number; false_holds: number; clean_truths: number }; no_rules: { wrong_payments: number } } };
    const v5 = json<Adv>("docs/evals/adversarial-v5.json"), v5a = json<Adv>("docs/evals/adversarial-v5-after.json");
    expect([v5.held_out, v5a.held_out]).toEqual([true, false]);
    expect(tile(w(), "eval-v5").fig).toBe(`${v5.totals.purser_script.wrong_payments} vs ${v5.totals.no_rules.wrong_payments}`);
    expect(tile(w(), "eval-v5").note).toContain(`(commit ${v5.cases_commit})`);
    expect(tile(w(), "eval-v5").note).toContain(`${v5.totals.purser_script.false_holds} false holds of ${v5.totals.purser_script.clean_truths}`);
    expect(tile(w(), "eval-v5").note).toContain(`Fixed since, no longer held out: ${v5a.totals.purser_script.wrong_payments} wrong payments, ${v5a.totals.purser_script.false_holds} false holds`);
    expect(tile(w(), "eval-v5").note).not.toContain("still held out");
    // Eval v6: its held-out run as recorded, and beside it the figures after the fixes written against its misses.
    const v6 = json<Adv>("docs/evals/adversarial-v6.json"), v6a = json<Adv>("docs/evals/adversarial-v6-after.json");
    expect([v6.held_out, v6a.held_out]).toEqual([true, false]);
    expect(tile(w(), "eval-v6").fig).toBe(`${v6.totals.purser_script.wrong_payments} vs ${v6.totals.no_rules.wrong_payments}`);
    expect(tile(w(), "eval-v6").note).toContain(`(commit ${v6.cases_commit})`);
    expect(tile(w(), "eval-v6").note).toContain(`${v6.totals.purser_script.false_holds} false hold${v6.totals.purser_script.false_holds === 1 ? "" : "s"} of ${v6.totals.purser_script.clean_truths}`);
    expect(tile(w(), "eval-v6").note).toContain(`Fixed since, no longer held out: ${v6a.totals.purser_script.wrong_payments} wrong payments, ${v6a.totals.purser_script.false_holds} false holds`);
    expect(tile(w(), "eval-v6").note).not.toContain("still held out");
    // Eval v7: its held-out run as recorded, and beside it the figures after the fixes written against its misses.
    const v7 = json<Adv>("docs/evals/adversarial-v7.json"), v7a = json<Adv>("docs/evals/adversarial-v7-after.json");
    expect([v7.held_out, v7a.held_out]).toEqual([true, false]);
    expect(tile(w(), "eval-v7").fig).toBe(`${v7.totals.purser_script.wrong_payments} vs ${v7.totals.no_rules.wrong_payments}`);
    expect(tile(w(), "eval-v7").note).toContain(`(commit ${v7.cases_commit})`);
    expect(tile(w(), "eval-v7").note).toContain(`${v7.totals.purser_script.false_holds} false hold${v7.totals.purser_script.false_holds === 1 ? "" : "s"} of ${v7.totals.purser_script.clean_truths}`);
    expect(tile(w(), "eval-v7").note).toContain(`Fixed since, no longer held out: ${v7a.totals.purser_script.wrong_payments} wrong payments, ${v7a.totals.purser_script.false_holds} false holds`);
    expect(tile(w(), "eval-v7").note).not.toContain("Held out.");
    // Eval v8: held out, its one run as recorded.
    const v8 = json<Adv>("docs/evals/adversarial-v8.json");
    expect(v8.held_out).toBe(true);
    expect(tile(w(), "eval-v8").fig).toBe(`${v8.totals.purser_script.wrong_payments} vs ${v8.totals.no_rules.wrong_payments}`);
    expect(tile(w(), "eval-v8").note).toContain(`(commit ${v8.cases_commit})`);
    expect(tile(w(), "eval-v8").note).toContain(`${v8.totals.purser_script.false_holds} false hold${v8.totals.purser_script.false_holds === 1 ? "" : "s"} of ${v8.totals.purser_script.clean_truths}`);
    expect(tile(w(), "eval-v8").note).toContain("Held out.");
    const sq = json<{ lighthouse: { path: string; preset: string; median: { performance: number; accessibility: number } }[] }>("docs/evidence/site-quality.json").lighthouse;
    expect(tile(w(), "site-quality").fig).toBe(String(Math.min(...sq.map((x) => x.median.accessibility))));
    expect(tile(w(), "site-quality").note).toContain(`lowest performance ${Math.min(...sq.map((x) => x.median.performance))}`);
    const wk = json<{ aggregate: { runs: number; ok: number } }>("docs/runs/2026-11-19-webkit-try/summary.json").aggregate;
    expect(tile(w(), "webkit-try")).toMatchObject({ fig: countOf(wk.ok, wk.runs), tag: "sandbox" });
  });

  it("claims the release's attestations and the Scorecard score only from their committed records (19 Nov 2026)", () => {
    const t = tile(w(), "supply-chain");
    expect(t.rec).toBe("docs/evidence/release-v1.2.0.json");
    const rec = JSON.parse(readFileSync(new URL("../docs/evidence/release-v1.2.0.json", import.meta.url), "utf8")) as { attestations: { predicateType: string }[] };
    expect(rec.attestations.map((a) => a.predicateType)).toEqual(["https://slsa.dev/provenance/v1", "https://cyclonedx.org/bom"]);
    const sc = tile(w(), "scorecard");
    const score = (JSON.parse(readFileSync(new URL("../docs/evidence/scorecard.json", import.meta.url), "utf8")) as { score: number }).score;
    expect(sc.fig).toBe(`${score}/10`);
    expect(tile(w(), "openssf").tag).toBe("external");
  });
});
