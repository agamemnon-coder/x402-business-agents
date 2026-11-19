// npm run site:quality: Lighthouse and axe-core on the public site's main pages (19 Nov), read-only (GET only: nothing
// is launched, filed, signed or paid). docs/evidence/site-quality.md says what came out; this writes its figures to
// docs/evidence/site-quality.json.
//   1. Lighthouse 13.6.0, each page with the mobile preset (Lighthouse's default: a Moto G Power class phone, 4x CPU
//      slowdown, slow 4G, simulated) and the desktop preset (--preset=desktop), RUNS times each, one at a time; the
//      run with the median performance score is the one reported, with every run's scores kept beside it.
//   2. axe-core 4.14 through @axe-core/playwright 4.14.0, each page at 390 x 844 and 1440 x 900 (light), WCAG 2.0, 2.1
//      and 2.2 A and AA plus axe's best-practice rules, after the page's load event and 1.5 s.
// Neither tool is a dependency of this repository. Install both into a separate prefix, with the versions pinned:
//   npm i --prefix /dev/shm/qtools lighthouse@13.6.0 @axe-core/playwright@4.14.0
//   QTOOLS=/dev/shm/qtools CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run site:quality
// Chromium: Playwright's (CHROME_PATH, or Playwright's own when unset), started by Lighthouse with
// --headless --no-sandbox. Full Lighthouse reports go to SITE_QUALITY_OUT (default a temporary folder), not the repo.
// Options: --pages /,/try  only these; --runs 1  Lighthouse runs per page and preset (default 3); --no-lighthouse;
// --no-axe; --reuse (a report already in SITE_QUALITY_OUT is read, not measured again); --origin <url> (default the
// public site).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ORIGIN = "https://kit11.max-31b.workers.dev";
export const PAGES = ["/", "/try", "/proof", "/verify", "/airwallex"] as const;
export const VERSIONS = { lighthouse: "13.6.0", "@axe-core/playwright": "4.14.0" } as const;
export const PRESETS = ["mobile", "desktop"] as const;
export const AXE_WIDTHS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }] as const;
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
type Impact = (typeof IMPACTS)[number];

/** What one Lighthouse run gives: the four category scores (0 to 100) and the key metrics, as Lighthouse measured them. */
export interface LhRun { performance: number | null; accessibility: number | null; best_practices: number | null; seo: number | null; lcp_ms: number | null; cls: number | null; tbt_ms: number | null; fcp_ms: number | null; si_ms: number | null; ttfb_ms: number | null }
interface Lhr {
  lighthouseVersion: string; finalDisplayedUrl?: string; fetchTime: string; runWarnings?: string[];
  categories: Record<string, { score: number | null; auditRefs: { id: string; weight: number }[] }>;
  audits: Record<string, { id: string; title: string; score: number | null; scoreDisplayMode: string; numericValue?: number; displayValue?: string; details?: { items?: Record<string, unknown>[] } }>;
}

const pct = (s: number | null | undefined) => (typeof s === "number" ? Math.round(s * 100) : null);
const num = (a: Lhr["audits"][string] | undefined) => (a && typeof a.numericValue === "number" ? a.numericValue : null);

/** The scores and metrics of one Lighthouse report. Scores as Lighthouse rounds them for its own report (x 100, nearest). */
export function lhSummary(lhr: Lhr): LhRun {
  const ms = (id: string) => { const v = num(lhr.audits[id]); return v === null ? null : Math.round(v); };
  const cls = num(lhr.audits["cumulative-layout-shift"]);
  return {
    performance: pct(lhr.categories.performance?.score), accessibility: pct(lhr.categories.accessibility?.score),
    best_practices: pct(lhr.categories["best-practices"]?.score), seo: pct(lhr.categories.seo?.score),
    lcp_ms: ms("largest-contentful-paint"), cls: cls === null ? null : Math.round(cls * 1000) / 1000, tbt_ms: ms("total-blocking-time"),
    fcp_ms: ms("first-contentful-paint"), si_ms: ms("speed-index"), ttfb_ms: ms("server-response-time"),
  };
}

/** The audits a report did not pass in the accessibility, best-practices and SEO categories, and the performance opportunities. */
export function lhFindings(lhr: Lhr): { category: string; id: string; title: string; score: number | null; display: string | null; items: string[] }[] {
  const out: { category: string; id: string; title: string; score: number | null; display: string | null; items: string[] }[] = [];
  for (const [cat, c] of Object.entries(lhr.categories)) {
    for (const ref of c.auditRefs) {
      const a = lhr.audits[ref.id];
      if (!a || a.scoreDisplayMode === "notApplicable" || a.scoreDisplayMode === "manual" || a.scoreDisplayMode === "informative") continue;
      if (a.score === null || a.score >= 0.9) continue;
      if (cat === "performance" && ref.weight > 0) continue; // the metrics themselves, reported as numbers
      const items = (a.details?.items ?? []).slice(0, 6).map((it) => {
        const node = it.node as { snippet?: string; selector?: string } | undefined;
        return String(node?.selector ?? node?.snippet ?? it.url ?? it.source ?? JSON.stringify(it)).slice(0, 200);
      }).filter((x) => !x.startsWith("{")); // a nested table (the network tree's): in the full report
      out.push({ category: cat, id: a.id, title: a.title, score: a.score, display: a.displayValue ?? null, items });
    }
  }
  return out;
}

/** The run with the median performance score (the lower middle for an even count), as Lighthouse's docs advise. */
export function medianRun<T extends { performance: number | null }>(runs: T[]): T {
  const s = [...runs].sort((a, b) => (a.performance ?? -1) - (b.performance ?? -1));
  return s[Math.floor((s.length - 1) / 2)]!;
}

export interface AxeViolation { id: string; impact: Impact | null; help: string; helpUrl: string; nodes: number; targets: string[] }
/** Violations counted by impact, and by rule. */
export function axeCount(v: AxeViolation[]): Record<Impact, number> & { rules: number; nodes: number } {
  const by = Object.fromEntries(IMPACTS.map((i) => [i, 0])) as Record<Impact, number>;
  for (const x of v) if (x.impact) by[x.impact] += x.nodes;
  return { ...by, rules: v.length, nodes: v.reduce((s, x) => s + x.nodes, 0) };
}

function arg(name: string): string | null { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? null : null; }

async function main(): Promise<void> {
  const QTOOLS = process.env.QTOOLS;
  if (!QTOOLS) throw new Error(`QTOOLS is not set. Install the tools into a prefix first:\n  npm i --prefix /dev/shm/qtools lighthouse@${VERSIONS.lighthouse} @axe-core/playwright@${VERSIONS["@axe-core/playwright"]}\n  QTOOLS=/dev/shm/qtools npm run site:quality`);
  const req = createRequire(join(resolve(QTOOLS), "node_modules", "_"));
  const version = (pkg: string) => (JSON.parse(readFileSync(join(resolve(QTOOLS), "node_modules", pkg, "package.json"), "utf8")) as { version: string }).version;
  const have = { lighthouse: version("lighthouse"), "@axe-core/playwright": version("@axe-core/playwright"), "axe-core": version("axe-core") };
  for (const [k, v] of Object.entries(VERSIONS)) if (have[k as keyof typeof VERSIONS] !== v) throw new Error(`${k} in ${QTOOLS} is ${have[k as keyof typeof VERSIONS]}, not the pinned ${v}`);
  const origin = arg("--origin") ?? ORIGIN;
  const pages = (arg("--pages")?.split(",") ?? [...PAGES]) as string[];
  const runs = Number(arg("--runs") ?? 3);
  const { chromium } = await import("playwright");
  const chrome = process.env.CHROME_PATH ?? chromium.executablePath();
  const out = process.env.SITE_QUALITY_OUT ?? mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "site-quality-"));
  mkdirSync(out, { recursive: true });
  const ROOT = resolve(import.meta.dirname, "..");
  const jsonPath = join(ROOT, "docs/evidence/site-quality.json");
  let prev: Record<string, unknown> = {};
  try { prev = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>; } catch { /* first run */ }

  const lighthouse: Record<string, unknown>[] = [];
  const errors: { path: string; preset: string; run: number; attempt: number; error: string }[] = [];
  if (!process.argv.includes("--no-lighthouse")) {
    const bin = join(resolve(QTOOLS), "node_modules", ".bin", "lighthouse");
    for (const path of pages) for (const preset of PRESETS) {
      const all: (LhRun & { fetch_time: string; file: string; warnings: string[] })[] = [];
      const reports: Lhr[] = [];
      for (let r = 1; r <= runs; r++) {
        const file = join(out, `lh-${preset}-${path === "/" ? "home" : path.slice(1).replace(/\W+/g, "-")}-${r}.json`);
        const a = [`${origin}${path}`, "--output=json", `--output-path=${file}`, `--chrome-path=${chrome}`, "--chrome-flags=--headless --no-sandbox", "--only-categories=performance,accessibility,best-practices,seo", "--quiet", "--max-wait-for-load=60000"];
        if (preset === "desktop") a.push("--preset=desktop");
        // A report already in SITE_QUALITY_OUT is used again with --reuse (a series stopped part way, resumed).
        if (!(process.argv.includes("--reuse") && existsSync(file))) {
          // Lighthouse now and then cannot record its trace (19 Nov: NO_NAVSTART on one load of /try): tried again, at
          // most twice, 5 s later; every such error is kept in the record.
          for (let attempt = 1; ; attempt++) {
            try { execFileSync(bin, a, { stdio: "inherit", timeout: 240_000 }); break; } catch (e) {
              errors.push({ path, preset, run: r, attempt, error: String((e as Error).message).split("\n")[0]!.slice(0, 300) });
              if (attempt >= 3) throw e;
              await new Promise((ok) => setTimeout(ok, 5_000));
            }
          }
        }
        const lhr = JSON.parse(readFileSync(file, "utf8")) as Lhr;
        reports.push(lhr);
        all.push({ ...lhSummary(lhr), fetch_time: lhr.fetchTime, file, warnings: lhr.runWarnings ?? [] });
        console.log(`lighthouse ${preset} ${path} run ${r}: ${JSON.stringify(lhSummary(lhr))}`);
      }
      const med = medianRun(all);
      const findings = lhFindings(reports[all.indexOf(med)]!);
      lighthouse.push({ path, preset, median: med, runs: all.map((x) => ({ ...x, file: undefined })), findings });
    }
  }

  const axe: Record<string, unknown>[] = [];
  if (!process.argv.includes("--no-axe")) {
    const { AxeBuilder } = req("@axe-core/playwright") as { AxeBuilder: new (o: { page: unknown }) => { withTags(t: string[]): { analyze(): Promise<{ violations: { id: string; impact: Impact | null; help: string; helpUrl: string; nodes: { target: unknown[] }[] }[]; passes: unknown[]; incomplete: { id: string }[] }> } } };
    const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    for (const path of pages) for (const vp of AXE_WIDTHS) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: "light", ...(vp.width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
      const page = await ctx.newPage();
      await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(1_500);
      const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const violations: AxeViolation[] = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length, targets: v.nodes.slice(0, 8).map((n) => n.target.map(String).join(" ")) }));
      axe.push({ path, viewport: `${vp.width}x${vp.height}`, counts: axeCount(violations), violations, passes: r.passes.length, incomplete: r.incomplete.map((i) => i.id) });
      console.log(`axe ${vp.width} ${path}: ${JSON.stringify(axeCount(violations))}`);
      await ctx.close();
    }
    await browser.close();
  }

  const record = {
    what: "Lighthouse and axe-core on the public site's main pages, read-only (scripts/site-quality.ts; docs/evidence/site-quality.md).",
    origin, measured_at: new Date().toISOString(), tools: have, chromium: chrome, lighthouse_runs_per_page: runs, lighthouse_errors: errors,
    lighthouse: lighthouse.length ? lighthouse : prev.lighthouse ?? [], axe: axe.length ? axe : prev.axe ?? [],
  };
  writeFileSync(jsonPath, JSON.stringify(record, null, 1) + "\n");
  console.log(`wrote ${jsonPath}; full Lighthouse reports in ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
