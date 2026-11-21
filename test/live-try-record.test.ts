// The re-check of the public /try on 19 Nov (docs/runs/2026-11-19-live-try.md): its raw records hold no secret, its
// summary is what scripts/try-live-summary.ts computes from them, and (since the owner's call of 19 Nov) it is a live run
// whose Claude request ids the /proof band counts, like every other run's.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOT_IN_BAND, scaleFigures } from "../src/redesign/scale.js";

const DIR = "docs/runs/2026-11-19-live-try";
const ROOT = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
const files = readdirSync(new URL(`${DIR}/`, ROOT)).map((f) => `${DIR}/${f}`);
const REQ = /\breq_011[A-Za-z0-9]{10,}/g;

/** Every JSON(L) file under docs, by path from the root, but the folders the band skips. */
function docsJson(dir = "docs"): string[] {
  if (NOT_IN_BAND.includes(dir)) return [];
  return readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? docsJson(`${dir}/${d.name}`) : /\.jsonl?$/.test(d.name) ? [`${dir}/${d.name}`] : []));
}

describe("the /try re-check of 19 Nov", () => {
  it("keeps no session, token, cookie, key or secret in its raw files", () => {
    for (const f of [...files, "docs/runs/2026-11-19-live-try.md"]) expect(read(f), f).not.toMatch(/bearer|secret|token|cookie/i);
  });

  it("has 8 runs, 4 at 1440 light and 4 at 390 dark, and a summary computed from them", () => {
    const runs = files.filter((f) => /\/run-\d+\.json$/.test(f)).map((f) => JSON.parse(read(f)) as { run: number; profile: string; color_scheme: string });
    expect(runs.map((r) => r.run).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(runs.filter((r) => r.profile === "desktop" && r.color_scheme === "light")).toHaveLength(4);
    expect(runs.filter((r) => r.profile === "phone" && r.color_scheme === "dark")).toHaveLength(4);
    const s = JSON.parse(read(`${DIR}/summary.json`)) as { aggregate: { runs: number }; runs: unknown[] };
    expect(s.aggregate.runs).toBe(8);
    expect(s.runs).toHaveLength(8);
  });

  it("is counted in the /proof band (19 Nov, the owner's call): its Claude request ids are among the band's", () => {
    expect(NOT_IN_BAND).not.toContain(DIR);
    const own = new Set(files.flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    expect(own.size).toBeGreaterThan(0);
    const counted = new Set(docsJson().flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    expect(scaleFigures().claudeCalls).toBe(counted.size);
    for (const id of own) expect(counted.has(id), id).toBe(true);
  });
});

// The mega run of the same day (docs/runs/2026-11-19-mega-run.md): the same walk, many times, one at a time, in Chromium
// at 1440, 768 and 390 and in Firefox; stopped by choice to leave the day's Airwallex sandbox payouts to other visitors.
const MEGA = "docs/runs/2026-11-19-mega-run";
const megaFiles = readdirSync(new URL(`${MEGA}/`, ROOT)).map((f) => `${MEGA}/${f}`);

describe("the /try mega run of 19 Nov", () => {
  it("keeps no session, token, cookie, key or secret in its raw files", () => {
    for (const f of [...megaFiles, "docs/runs/2026-11-19-mega-run.md"]) expect(read(f), f).not.toMatch(/bearer|secret|token|cookie/i);
  });

  it("has a record per walk the series ran, and a summary computed from them", () => {
    const series = JSON.parse(read(`${MEGA}/series.json`)) as { walks: { run: number; browser: string; profile: string }[] };
    const runs = megaFiles.filter((f) => /\/run-\d+\.json$/.test(f)).map((f) => JSON.parse(read(f)) as { run: number; profile: string; browser: { name: string } });
    expect(runs.map((r) => r.run).sort((a, b) => a - b)).toEqual(series.walks.map((w) => w.run));
    for (const r of runs) expect(series.walks.find((w) => w.run === r.run), String(r.run)).toMatchObject({ browser: r.browser.name, profile: r.profile });
    const s = JSON.parse(read(`${MEGA}/summary.json`)) as { aggregate: { runs: number }; runs: unknown[] };
    expect(s.aggregate.runs).toBe(runs.length);
    const both = JSON.parse(read(`${MEGA}/combined.json`)) as { aggregate: { runs: number } };
    expect(both.aggregate.runs).toBe(runs.length + 8);
  });

  // Left out of the band when recorded; counted since the owner's call the same day (it goes on the site, a row of /runs).
  it("is counted in the /proof band: its Claude request ids are among the band's", () => {
    expect(NOT_IN_BAND).not.toContain(MEGA);
    const own = new Set(megaFiles.flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    expect(own.size).toBeGreaterThan(0);
    const counted = new Set(docsJson().flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    for (const id of own) expect(counted.has(id), id).toBe(true);
  });

});

// The phone series of 21 Nov (docs/runs/2026-11-21-phone-try.md): an iPhone 15 in WebKit, in Chromium, and in Chromium
// on Slow 4G, in turn; and the capacity check of the same night (docs/runs/2026-11-21-try-capacity.md), 10 visitors at
// once, whose figures are concurrency.json (not a series of record: no summary.json).
const PHONES = "docs/runs/2026-11-21-phone-try";
const phoneFiles = readdirSync(new URL(`${PHONES}/`, ROOT)).map((f) => `${PHONES}/${f}`);
const CONC = "docs/runs/2026-11-21-try-concurrent";
const concFiles = readdirSync(new URL(`${CONC}/`, ROOT)).map((f) => `${CONC}/${f}`);

describe("the /try phone series and the capacity check of 21 Nov", () => {
  it("keep no session, token, cookie, key or secret in their raw files", () => {
    for (const f of [...phoneFiles, `${PHONES}.md`, ...concFiles]) expect(read(f), f).not.toMatch(/bearer|secret|token|cookie/i);
  });

  it("the series: a record per walk, WebKit, Chromium and Chromium on Slow 4G in turn, each an iPhone 15, and a summary computed from them", () => {
    const series = JSON.parse(read(`${PHONES}/series.json`)) as { walks: { run: number; browser: string; profile: string; network?: string }[] };
    const runs = phoneFiles.filter((f) => /\/run-\d+\.json$/.test(f)).map((f) => JSON.parse(read(f)) as { run: number; profile: string; viewport: { width: number }; browser: { name: string }; network?: { name: string } });
    expect(runs.map((r) => r.run).sort((a, b) => a - b)).toEqual(series.walks.map((w) => w.run));
    for (const r of runs) {
      expect(series.walks.find((w) => w.run === r.run), String(r.run)).toMatchObject({ browser: r.browser.name, profile: r.profile });
      expect([r.profile, r.viewport.width]).toEqual(["phone-iphone", 393]);
      expect([r.browser.name, r.network?.name ?? null]).toEqual([["webkit", null], ["chromium", null], ["chromium", "slow-4g"]][(r.run - 1) % 3]);
    }
    const s = JSON.parse(read(`${PHONES}/summary.json`)) as { aggregate: { runs: number; ok: number }; runs: unknown[] };
    expect(s.aggregate.runs).toBe(runs.length);
    expect(s.runs).toHaveLength(runs.length);
  });

  it("the series is counted in the /proof band: its Claude request ids are among the band's", () => {
    expect(NOT_IN_BAND).not.toContain(PHONES);
    const own = new Set(phoneFiles.flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    expect(own.size).toBeGreaterThan(0);
    const counted = new Set(docsJson().flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    for (const id of own) expect(counted.has(id), id).toBe(true);
  });

  it("the capacity check is its records and their figures, not a series of the band's walks", () => {
    expect(concFiles).not.toContain(`${CONC}/summary.json`);
    const c = JSON.parse(read(`${CONC}/concurrency.json`)) as { visitors: number; records_written: number };
    expect(c.records_written).toBe(c.visitors);
    expect(concFiles.filter((f) => /\/run-\d+\.json$/.test(f))).toHaveLength(c.visitors);
  });
});
