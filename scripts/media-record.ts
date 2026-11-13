// npm run media:record [-- try cloud books proof shots | --readme]: the product media in docs/assets/media/, recorded with Playwright from the LIVE sites (the owner,
// 13 Nov: "visuals, animations, videos" for the README and the docs). Nothing is staged or mocked: each clip is the
// deployed page doing what a visitor sees. No secret is ever on screen or in a URL: the hands-on demo and Purser Cloud's
// guest keep their session in browser storage, and no viewer key, token or jury link is used.
//
//   1. Clips (WebM, MP4 and GIF, each at most 15 s; the GIF at most 5 MB):
//      try    kit11 /try, the whole flow: a test company, a sample invoice filed, Claude reads it, Pay, the approval
//             passkey made and used by Chromium's VIRTUAL authenticator (a test passkey, no person, no phone), paid on
//             the simulated bank, booked and filed. Sped up to fit 15 s; the README says by how much.
//      cloud  Purser Cloud, "Try as guest": the demo company's dashboard (count-ups, charts), then its books.
//      books  kit11 /books, scrolled: balance sheet, charts, the invoices sorted by Claude.
//      proof  kit11 /proof, scrolled.
//   2. Screenshots at 1440 and 390 px (device scale 2): Home, Try, Proof, Books, the Cloud dashboard, Visa, Metal.
//   3. docs/assets/media/media.json: every file with its source URL, when it was recorded, its size and duration, and
//      each clip's speed-up (docs/assets/media/README.md is written from it).
//
// It starts one test company on the live demo (the /try clip), whose Claude reads count against the demo's own caps.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { APPROVE, BOOKS, INVOICE, START, WORK } from "../cloud/src/tryCopy.js";

export const KIT = "https://kit11.max-31b.workers.dev";
export const CLOUD = "https://purser-try.max-31b.workers.dev";
const OUT = "docs/assets/media";
const MAX_SECONDS = 15;
const GIF_MAX_BYTES = 5_000_000;
const VIDEO = { width: 1280, height: 800 };

interface Entry { file: string; kind: "gif" | "mp4" | "webm" | "png"; source: string; recorded_at: string; bytes: number; seconds?: number; speed?: number; width?: number; caption: string }
const entries: Entry[] = [];
const log = (...a: unknown[]) => console.log(...a);
const pause = (p: Page, ms: number) => p.waitForTimeout(ms);
const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const duration = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

/** Scrolls the page down in small steps, as a person reading would, for about `ms`. */
async function readDown(p: Page, ms: number, stop = Infinity) {
  const steps = Math.max(1, Math.round(ms / 120));
  const total = Math.min(stop, await p.evaluate(() => document.documentElement.scrollHeight - innerHeight));
  for (let i = 1; i <= steps; i++) {
    await p.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }), Math.round((total * i) / steps));
    await pause(p, 120);
  }
}

/** Scrolls a screen at a time and holds each one, as a person reading would: `holds` stops, each `holdMs` long. */
async function readScreens(p: Page, holds: number, holdMs: number) {
  const total = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let i = 1; i <= holds; i++) {
    await p.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), Math.round((total * i) / holds));
    await pause(p, holdMs);
  }
}

/** A recorded clip, cut to [from, to] seconds of the recording and sped up to fit MAX_SECONDS: WebM, MP4 and GIF. */
function clip(name: string, raw: string, o: { from: number; to: number; source: string; caption: string }) {
  const span = o.to - o.from;
  const speed = span > MAX_SECONDS ? Math.ceil((span / MAX_SECONDS) * 10) / 10 : 1;
  const vf = `trim=start=${o.from}:end=${o.to},setpts=(PTS-STARTPTS)/${speed}`;
  const at = new Date().toISOString();
  const webm = join(OUT, `${name}.webm`), mp4 = join(OUT, `${name}.mp4`), gif = join(OUT, `${name}.gif`);
  ff(["-i", raw, "-vf", vf, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", webm]);
  ff(["-i", raw, "-vf", `${vf},scale=trunc(iw/2)*2:trunc(ih/2)*2`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", mp4]);
  // The GIF: a palette of its own, smaller until it fits.
  for (const [w, fps] of [[880, 12], [800, 10], [720, 10], [640, 8], [560, 8], [480, 6]] as const) {
    const pal = join(tmpdir(), `${name}-pal.png`);
    ff(["-i", raw, "-vf", `${vf},fps=${fps},scale=${w}:-1:flags=lanczos,palettegen=stats_mode=diff`, pal]);
    ff(["-i", raw, "-i", pal, "-lavfi", `${vf},fps=${fps},scale=${w}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif]);
    if (statSync(gif).size <= GIF_MAX_BYTES) { entries.push({ file: `${name}.gif`, kind: "gif", source: o.source, recorded_at: at, bytes: statSync(gif).size, seconds: +duration(webm).toFixed(1), speed, width: w, caption: o.caption }); break; }
  }
  if (statSync(gif).size > GIF_MAX_BYTES) throw new Error(`${gif} is over 5 MB at every size tried`);
  for (const [f, kind] of [[webm, "webm"], [mp4, "mp4"]] as const) {
    const s = duration(f);
    if (s > MAX_SECONDS + 0.2) throw new Error(`${f} is ${s} s, over ${MAX_SECONDS}`);
    entries.push({ file: f.slice(OUT.length + 1), kind, source: o.source, recorded_at: at, bytes: statSync(f).size, seconds: +s.toFixed(1), speed, width: VIDEO.width, caption: o.caption });
  }
  log(`${name}: ${span.toFixed(1)} s recorded, ${speed}x, gif ${(statSync(gif).size / 1e6).toFixed(2)} MB`);
}

/** A context that records its pages; the clip starts at the first frame the page shows. */
async function recording(b: Browser, dir: string): Promise<{ ctx: BrowserContext; page: Page; t0: number }> {
  const ctx = await b.newContext({ viewport: VIDEO, recordVideo: { dir, size: VIDEO }, colorScheme: "light", reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  return { ctx, page, t0: Date.now() };
}
async function finish(ctx: BrowserContext, page: Page): Promise<string> {
  const v = page.video();
  await ctx.close();
  return v!.path();
}
const since = (t0: number) => (Date.now() - t0) / 1000;

async function tryClip(b: Browser, dir: string) {
  const { ctx, page, t0 } = await recording(b, dir);
  // The approval passkey: Chromium's virtual authenticator (a test passkey; the user's presence is simulated).
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(`${KIT}/try`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  const from = since(t0);
  await pause(page, 1800);
  await page.click(`text=${START.button}`);
  await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`, { timeout: 30_000 });
  await page.waitForSelector(".samples .btn:not(.skel)", { timeout: 30_000 });
  await pause(page, 1200);
  await page.click(`.btn.primary:has-text("${INVOICE.send}")`);
  await page.waitForSelector(`h1:text-is("${WORK.heading}")`, { timeout: 30_000 });
  await page.waitForSelector(".result .btn.primary", { timeout: 45_000 });
  await pause(page, 1800);
  await page.click(".result .btn.primary");
  await page.waitForSelector(`h1:text-is("${APPROVE.heading}")`, { timeout: 30_000 });
  await page.waitForSelector(`.btn.primary:has-text("${APPROVE.create}")`, { timeout: 30_000 });
  await pause(page, 1000);
  await page.click(`.btn.primary:has-text("${APPROVE.create}")`);
  await page.waitForSelector(`.btn.primary:has-text("Approve EUR")`, { timeout: 30_000 });
  await pause(page, 1000);
  await page.click(`.btn.primary:has-text("Approve EUR")`);
  await page.waitForSelector(".paidstamp .ring", { timeout: 45_000 });
  await pause(page, 1500);
  await page.waitForSelector(`h1:text-is("${BOOKS.heading}")`, { timeout: 45_000 });
  await page.waitForSelector(".blk.filed", { timeout: 45_000 }).catch(() => undefined);
  await pause(page, 2500);
  await readDown(page, 1800, 500);
  await pause(page, 800);
  const to = since(t0);
  const raw = await finish(ctx, page);
  clip("try-flow", raw, { from, to, source: `${KIT}/try`, caption: "The hands-on demo, end to end: a test company files a sample invoice, Claude reads it, Pay, the approval passkey (Chromium's virtual authenticator: a test passkey, no person or phone), paid on the simulated bank, booked and filed. Test money." });
}

async function cloudClip(b: Browser, dir: string) {
  const { ctx, page, t0 } = await recording(b, dir);
  await page.goto(`${CLOUD}/`);
  await page.waitForSelector('button:has-text("Try as guest")');
  await page.click('button:has-text("Try as guest")');
  // The clip starts as the dashboard draws, so its count-ups and charts are the first thing seen (not the sign-in's loading).
  await page.waitForSelector("h1:text-is(\"Overview\")", { timeout: 30_000 });
  const from = Math.max(0, since(t0) - 0.2);
  await pause(page, 3000);
  await readScreens(page, 3, 1400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
  await page.click('a[href="#/books"]');
  await pause(page, 2500);
  await readScreens(page, 2, 1400);
  const to = since(t0);
  clip("cloud-dashboard", await finish(ctx, page), { from, to, source: `${CLOUD}/ (Try as guest)`, caption: "Purser Cloud as a guest: the demo company's dashboard (made-up data from a simulated month, test money), then its books." });
}

async function scrollClip(b: Browser, dir: string, name: string, url: string, caption: string, holds: number) {
  const { ctx, page, t0 } = await recording(b, dir);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  const from = since(t0);
  await pause(page, 2200);
  await readScreens(page, holds, 1500);
  await pause(page, 600);
  const to = since(t0);
  clip(name, await finish(ctx, page), { from, to, source: url, caption });
}

async function screenshots(b: Browser) {
  const pages: [string, string, ((p: Page) => Promise<void>) | null][] = [
    ["home", `${KIT}/home`, null], ["try", `${KIT}/try`, null], ["proof", `${KIT}/proof`, null], ["books", `${KIT}/books`, null],
    ["cloud-dashboard", `${CLOUD}/`, async (p) => { await p.click('button:has-text("Try as guest")'); await p.waitForSelector("h1:text-is(\"Overview\")", { timeout: 30_000 }); }],
    ["visa", `${KIT}/visa`, null], ["metal", `${KIT}/metal`, null],
  ];
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
    for (const [name, url, then] of pages) {
      const p = await ctx.newPage();
      await p.goto(url);
      await p.waitForLoadState("networkidle");
      if (then) await then(p);
      await pause(p, 2500);
      const file = `${name}-${w}.png`;
      await p.screenshot({ path: join(OUT, file) });
      entries.push({ file, kind: "png", source: url + (then ? " (Try as guest)" : ""), recorded_at: new Date().toISOString(), bytes: statSync(join(OUT, file)).size, width: w, caption: `${name} at ${w} px (first screen)` });
      await p.close();
    }
    await ctx.close();
  }
  log("screenshots done");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const want = (k: string) => only.length === 0 || only.includes(k);
  const dir = mkdtempSync(join(tmpdir(), "media-"));
  const b = await chromium.launch();
  try {
    if (want("try")) await tryClip(b, dir);
    if (want("cloud")) await cloudClip(b, dir);
    if (want("books")) await scrollClip(b, dir, "books", `${KIT}/books`, "kit11 /books: a test company's month, read and booked by Claude live; balance sheet, charts and the invoices sorted by Claude. Test money.", 7);
    if (want("proof")) await scrollClip(b, dir, "proof", `${KIT}/proof`, "kit11 /proof: every claim with its run record.", 7);
    if (want("shots")) await screenshots(b);
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
  // Keep what an earlier partial run recorded for the parts not run now.
  const path = join(OUT, "media.json");
  let old: Entry[];
  try { old = (JSON.parse((await import("node:fs")).readFileSync(path, "utf8")) as { files: Entry[] }).files; } catch { old = []; }
  const files = [...old.filter((e) => !entries.some((n) => n.file === e.file)), ...entries].filter((e) => readdirSync(OUT).includes(e.file)).sort((a, z) => a.file.localeCompare(z.file));
  writeFileSync(path, `${JSON.stringify({ note: "Written by npm run media:record (scripts/media-record.ts). Recorded from the live sites; nothing staged.", files }, null, 2)}\n`);
  writeFileSync(join(OUT, "README.md"), readme(files));
  log(`wrote ${path} and README.md: ${files.length} files`);
}

const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
/** The folder's README, from media.json: each clip with its three files, each screenshot pair, every source and date. */
export function readme(files: Entry[]): string {
  const day = (e: Entry) => e.recorded_at.slice(0, 10);
  const clips = [...new Set(files.filter((f) => f.kind !== "png").map((f) => f.file.replace(/\.(gif|mp4|webm)$/, "")))];
  const shots = [...new Set(files.filter((f) => f.kind === "png").map((f) => f.file.replace(/-(1440|390)\.png$/, "")))];
  const row = (e: Entry) => `[${e.file}](${e.file}) | ${e.kind.toUpperCase()} | ${mb(e.bytes)} | ${e.seconds !== undefined ? `${e.seconds} s` : `${e.width} px wide`} | ${day(e)}`;
  return [
    "# Product media",
    "",
    "Recorded with Playwright from the **live** sites by `npm run media:record` (scripts/media-record.ts). Nothing is staged or mocked. Every company in them is a test company, and all money is test money.",
    "No secret, viewer key, token or jury link is visible in any frame or URL: the hands-on demo and Purser Cloud's guest keep their sessions in browser storage.",
    "",
    "**The passkey in the /try clip is not a person's.** It is Chromium's virtual WebAuthn authenticator, a test passkey whose user presence is simulated. No phone and no Face ID are involved. In the product, the CFO's own passkey signs.",
    "",
    "## Clips (each at most 15 s; GIFs at most 5 MB)",
    "",
    ...clips.flatMap((c) => {
      const fs = files.filter((f) => f.file.startsWith(`${c}.`));
      const e = fs[0]!;
      return [`### ${c}`, "", e.caption, "", `Source: ${e.source} · recorded ${day(e)} · ${e.speed && e.speed > 1 ? `sped up ${e.speed}x to fit 15 s` : "real time"}`, "", "File | Type | Size | Length | Recorded", "--- | --- | --- | --- | ---", ...fs.map(row), ""];
    }),
    "## Screenshots (first screen, device scale 2)",
    "",
    "Page | 1440 px | 390 px | Source | Recorded",
    "--- | --- | --- | --- | ---",
    ...shots.map((n) => {
      const w = files.find((f) => f.file === `${n}-1440.png`), m = files.find((f) => f.file === `${n}-390.png`);
      const e = (w ?? m)!;
      return `${n} | ${w ? `[${w.file}](${w.file})` : ""} | ${m ? `[${m.file}](${m.file})` : ""} | ${e.source} | ${day(e)}`;
    }),
    "",
    "Every file, with its exact recording time and size: [media.json](media.json).",
    "",
  ].join("\n");
}

if (process.argv.includes("--readme")) {
  const { readFileSync } = await import("node:fs");
  writeFileSync(join(OUT, "README.md"), readme((JSON.parse(readFileSync(join(OUT, "media.json"), "utf8")) as { files: Entry[] }).files));
  log(`wrote ${OUT}/README.md from media.json`);
} else await main();
