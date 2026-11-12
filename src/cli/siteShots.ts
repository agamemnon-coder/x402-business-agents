// npm run site-shots: screenshots and short loops of the public sites, dark, at 390 and 1440 px, with Playwright
// (GET requests to the public pages only; nothing is signed, approved or sent). Stills are WebP, loops MP4 (H.264),
// each kept small; docs/assets/screens/README.md lists every file with its URL, viewport and capture time, written
// here from what was captured. ffmpeg does the encoding. Scratch frames go to a temp folder and are deleted.
//
//   npm run site-shots            all of them
//   npm run site-shots -- home    only the shots whose name starts with "home"

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

export const LIVE = "https://kit11.max-31b.workers.dev";
export const PREVIEW = "https://kit11-next.max-31b.workers.dev";
export const CLOUD = "https://purser-try.max-31b.workers.dev";
const OUT = "docs/assets/screens";
/** Loops longer than this are cut; files over this size fail the run. */
const LOOP_S = 9, MAX_LOOP_BYTES = 2_000_000;

interface Shot { name: string; site: string; url: string; width: 390 | 1440; loop?: boolean; note: string }
const sites = { [LIVE]: "the live site", [PREVIEW]: "the preview", [CLOUD]: "Purser Cloud's engine" } as const;
const shot = (name: string, base: keyof typeof sites, path: string, width: 390 | 1440, note: string, loop = false): Shot =>
  ({ name: `${name}-${width}`, site: sites[base], url: `${base}${path}`, width, loop, note });

export const SHOTS: Shot[] = [
  shot("live-home", LIVE, "/", 1440, "Home, first screen"),
  shot("live-home", LIVE, "/", 390, "Home, first screen"),
  shot("live-proof", LIVE, "/proof", 1440, "Proof, first screen"),
  shot("live-airwallex", LIVE, "/airwallex", 1440, "Airwallex page, first screen"),
  shot("live-metal", LIVE, "/metal", 1440, "Metal page, first screen"),
  shot("live-metal", LIVE, "/metal", 390, "Metal page, first screen"),
  shot("live-visa", LIVE, "/visa", 1440, "Visa page, first screen"),
  shot("live-runs", LIVE, "/runs", 1440, "Every live run, newest first"),
  shot("preview-home", PREVIEW, "/", 1440, "Preview: Home, first screen"),
  shot("preview-home", PREVIEW, "/", 390, "Preview: Home, first screen"),
  shot("preview-security", PREVIEW, "/security", 1440, "Preview: Security, first screen"),
  shot("cloud-home", CLOUD, "/", 1440, "Purser Cloud's engine: sign-in, in Dutch"),
  shot("cloud-home", CLOUD, "/", 390, "Purser Cloud's engine: sign-in, in Dutch"),
  shot("loop-live-home", LIVE, "/", 1440, "Home's demo playing, first screen", true),
  shot("loop-live-home", LIVE, "/", 390, "Home's demo playing, first screen", true),
  shot("loop-preview-home", PREVIEW, "/", 1440, "Preview: Home playing, first screen", true),
];

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const viewport = (w: number) => ({ width: w, height: w === 390 ? 844 : 900 });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const todo = SHOTS.filter((s) => !only.length || only.some((o) => s.name.startsWith(o)));
mkdirSync(OUT, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "site-shots-"));
const done: (Shot & { file: string; bytes: number; at: string })[] = [];
const browser = await chromium.launch();
try {
  for (const s of todo) {
    const at = new Date().toISOString();
    if (!s.loop) {
      const ctx = await browser.newContext({ viewport: viewport(s.width), deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(s.url, { waitUntil: "load" });
      await settle(page);
      const png = join(scratch, `${s.name}.png`), file = `${OUT}/${s.name}.webp`;
      await page.screenshot({ path: png });
      await ctx.close();
      ffmpeg(["-i", png, "-c:v", "libwebp", "-quality", "82", file]);
      done.push({ ...s, file, bytes: statSync(file).size, at });
    } else {
      const size = viewport(s.width);
      const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: "dark", recordVideo: { dir: scratch, size } });
      const page = await ctx.newPage();
      await page.goto(s.url, { waitUntil: "load" });
      await settle(page);
      await page.waitForTimeout(LOOP_S * 1000);
      await ctx.close();
      const webm = join(scratch, readdirSync(scratch).find((f) => f.endsWith(".webm"))!), file = `${OUT}/${s.name}.mp4`;
      // Skip the load (the first 2.5 s), keep LOOP_S seconds, 24 fps, H.264 for every browser and GitHub.
      ffmpeg(["-ss", "2.5", "-t", String(LOOP_S), "-i", webm, "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-movflags", "+faststart", "-an", file]);
      rmSync(webm);
      const bytes = statSync(file).size;
      if (bytes > MAX_LOOP_BYTES) throw new Error(`${file}: ${bytes} bytes, over ${MAX_LOOP_BYTES}`);
      done.push({ ...s, file, bytes, at });
    }
    console.log(`${done.at(-1)!.file} (${Math.round(done.at(-1)!.bytes / 1024)} KB)`);
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (!only.length) {
  const rows = done.map((d) => `| [\`${d.file.slice(OUT.length + 1)}\`](${d.file.slice(OUT.length + 1)}) | ${d.note} | ${d.site}: ${d.url} | ${d.width} px, dark | ${Math.round(d.bytes / 1024)} KB | ${d.at.slice(0, 16).replace("T", " ")} UTC |`);
  writeFileSync(`${OUT}/README.md`, `# Screenshots and loops of the public sites

Written by \`npm run site-shots\` (src/cli/siteShots.ts): Playwright opened each public page (GET only; nothing was
signed, approved or sent), dark, at 390 or 1440 px. Stills are WebP; loops are MP4 (H.264), ${LOOP_S} s, without sound.
What a page shows is what it showed at capture time; the site is the source, these are pictures of it.

| File | What | Page | Viewport | Size | Captured |
|---|---|---|---|---|---|
${rows.join("\n")}
`);
}
