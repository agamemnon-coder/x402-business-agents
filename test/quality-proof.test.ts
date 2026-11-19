// The quality evidence of 19 Nov: the /try walk in WebKit (docs/runs/2026-11-19-webkit-try.md), the README's refusal
// animation (scripts/readme-refusal-webp.ts) and Lighthouse and axe on the public pages (scripts/site-quality.ts,
// docs/evidence/site-quality.md). All offline: the files as committed, and the scripts' pure parts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOT_IN_BAND, scaleFigures } from "../src/redesign/scale.js";
import { FPS, framePlan, MAX_BYTES, SEGMENTS, type Marks } from "../scripts/readme-refusal-webp.js";
import { axeCount, lhFindings, lhSummary, medianRun, PAGES } from "../scripts/site-quality.js";

const ROOT = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
const DIR = "docs/runs/2026-11-19-webkit-try";
const files = readdirSync(new URL(`${DIR}/`, ROOT)).map((f) => `${DIR}/${f}`);
const REQ = /\breq_011[A-Za-z0-9]{10,}/g;

/** Every JSON(L) file under docs, by path from the root, but the folders the band skips. */
function docsJson(dir = "docs"): string[] {
  if (NOT_IN_BAND.includes(dir)) return [];
  return readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? docsJson(`${dir}/${d.name}`) : /\.jsonl?$/.test(d.name) ? [`${dir}/${d.name}`] : []));
}

describe("the /try walk in WebKit of 19 Nov", () => {
  const runs = files.filter((f) => /\/run-\d+\.json$/.test(f)).map((f) => JSON.parse(read(f)) as { run: number; ok: boolean; profile: string; browser: { name: string }; passkey: string; failures: string[] });

  it("keeps no session, token, cookie, key or secret in its raw files", () => {
    for (const f of [...files, `${DIR}.md`]) expect(read(f), f).not.toMatch(/bearer|secret|token|cookie/i);
  });

  it("walked in WebKit with the software passkey, every step passed, and its summary is computed from the runs", () => {
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(3);
    for (const r of runs) expect(r, String(r.run)).toMatchObject({ ok: true, failures: [], passkey: "software-passkey", browser: { name: "webkit" } });
    const s = JSON.parse(read(`${DIR}/summary.json`)) as { aggregate: { runs: number; ok: number; airwallex: { paid: number }; refused: number; held: number } };
    expect(s.aggregate).toMatchObject({ runs: runs.length, ok: runs.length, refused: runs.length, held: runs.length, airwallex: { paid: 2 * runs.length } });
  });

  it("is left out of the /proof band: its Claude request ids are not counted", () => {
    expect(NOT_IN_BAND).toContain(DIR);
    const own = new Set(files.flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    expect(own.size).toBeGreaterThan(0);
    const counted = new Set(docsJson().flatMap((f) => [...read(f).matchAll(REQ)].map((m) => m[0])));
    expect(scaleFigures().claudeCalls).toBe(counted.size);
    for (const id of own) expect(counted.has(id), id).toBe(false);
  });
});

describe("the README's refusal animation", () => {
  const marks: Marks = { cfo_click: 400, approved: 10_000, paid_on_screen: 18_000, change_click: 20_000, changed: 21_000, pay_click: 22_000, refused: 24_000, end: 27_000 };
  const shots = Array.from({ length: 280 }, (_, i) => ({ file: `s${i}`, t: i * 100 }));

  it("plays about 13 s at FPS, every frame a screenshot taken at or before its moment", () => {
    const frames = framePlan(marks, shots);
    const total = SEGMENTS.reduce((s, x) => s + Math.round(x.out_s * FPS), 0);
    expect(frames).toHaveLength(total);
    expect(total / FPS).toBeGreaterThanOrEqual(12);
    expect(total / FPS).toBeLessThanOrEqual(15);
    const idx = frames.map((f) => Number(f.slice(1)));
    for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThanOrEqual(idx[i - 1]!);
    // The refusal's segment shows the frames from the refusal on.
    expect(idx.at(-1)).toBeLessThanOrEqual(270);
    expect(idx.slice(-Math.round(SEGMENTS.at(-1)!.out_s * FPS)).every((i) => i * 100 >= marks.refused)).toBe(true);
  });

  it("refuses marks out of order", () => {
    expect(() => framePlan({ ...marks, approved: 100 }, shots)).toThrow(/out of order/);
  });

  it("is committed within 2 MB, as an animated WebP", () => {
    const f = "docs/assets/readme/refusal.webp";
    expect(statSync(new URL(f, ROOT)).size).toBeLessThanOrEqual(MAX_BYTES);
    const b = readFileSync(new URL(f, ROOT));
    expect(b.subarray(0, 4).toString()).toBe("RIFF");
    expect(b.subarray(8, 12).toString()).toBe("WEBP");
    expect(b.includes(Buffer.from("ANIM"))).toBe(true);
  });
});

describe("site quality: Lighthouse and axe", () => {
  const lhr = {
    lighthouseVersion: "13.6.0", fetchTime: "2026-11-19T10:00:00.000Z",
    categories: { performance: { score: 0.99, auditRefs: [{ id: "largest-contentful-paint", weight: 25 }, { id: "uses-long-cache-ttl", weight: 0 }] }, accessibility: { score: 0.9, auditRefs: [{ id: "color-contrast", weight: 7 }] }, "best-practices": { score: 1, auditRefs: [] }, seo: { score: 0.61, auditRefs: [{ id: "is-crawlable", weight: 4.6 }] } },
    audits: {
      "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", score: 0.8, scoreDisplayMode: "numeric", numericValue: 2512.4 },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", title: "CLS", score: 1, scoreDisplayMode: "numeric", numericValue: 0.01234 },
      "total-blocking-time": { id: "total-blocking-time", title: "TBT", score: 1, scoreDisplayMode: "numeric", numericValue: 49.6 },
      "uses-long-cache-ttl": { id: "uses-long-cache-ttl", title: "Cache", score: 0.5, scoreDisplayMode: "metricSavings", details: { items: [{ url: "https://x/font.woff2" }] } },
      "color-contrast": { id: "color-contrast", title: "Contrast", score: 0, scoreDisplayMode: "binary", details: { items: [{ node: { selector: "p.muted" } }] } },
      "is-crawlable": { id: "is-crawlable", title: "Blocked from indexing", score: 0, scoreDisplayMode: "binary", details: { items: [{ source: "x-robots-tag: noindex, nofollow" }] } },
    },
  };

  it("reports scores as Lighthouse shows them (x 100, nearest) and the metrics in whole ms", () => {
    expect(lhSummary(lhr)).toMatchObject({ performance: 99, accessibility: 90, best_practices: 100, seo: 61, lcp_ms: 2512, cls: 0.012, tbt_ms: 50, fcp_ms: null });
  });

  it("lists what did not pass, with where, but not the weighted metrics themselves", () => {
    const f = lhFindings(lhr);
    expect(f.map((x) => x.id)).toEqual(["uses-long-cache-ttl", "color-contrast", "is-crawlable"]);
    expect(f.find((x) => x.id === "color-contrast")!.items).toEqual(["p.muted"]);
  });

  it("takes the run with the median performance score", () => {
    expect(medianRun([{ performance: 90, n: 1 }, { performance: 70, n: 2 }, { performance: 80, n: 3 }]).n).toBe(3);
    expect(medianRun([{ performance: 90, n: 1 }, { performance: 70, n: 2 }]).n).toBe(2);
  });

  it("counts axe's violations by impact, per element", () => {
    expect(axeCount([{ id: "a", impact: "serious", help: "", helpUrl: "", nodes: 3, targets: [] }, { id: "b", impact: "moderate", help: "", helpUrl: "", nodes: 1, targets: [] }])).toEqual({ critical: 0, serious: 3, moderate: 1, minor: 0, rules: 2, nodes: 4 });
  });

  it("has a committed record for every page, both presets and both widths", () => {
    const rec = JSON.parse(read("docs/evidence/site-quality.json")) as { tools: Record<string, string>; lighthouse: { path: string; preset: string; runs: unknown[] }[]; axe: { path: string; viewport: string }[] };
    expect(rec.tools).toMatchObject({ lighthouse: "13.6.0", "@axe-core/playwright": "4.14.0" });
    for (const p of PAGES) {
      for (const preset of ["mobile", "desktop"]) expect(rec.lighthouse.find((l) => l.path === p && l.preset === preset)?.runs.length, `${p} ${preset}`).toBe(3);
      for (const vp of ["390x844", "1440x900"]) expect(rec.axe.some((a) => a.path === p && a.viewport === vp), `${p} ${vp}`).toBe(true);
    }
  });
});
