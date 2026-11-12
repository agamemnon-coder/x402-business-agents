// Frame-by-frame capture of a page shot (src/film/shots.ts), piped into ffmpeg: no frame file is ever written. The
// browser is Playwright's Chromium, dark, at the shot's viewport and pixel ratio. Before the first frame the page's
// text is read and the shot is refused when a `must` line is missing or its gate fails (the next address is tried
// first). Each frame of a scroll is its own screenshot (the scroll moved, eased, one frame at a time, so the scroll
// the camera reads is the one the frame shows); a hold sends the same frame again, so a 10 s hold costs one
// screenshot. A click or a file pick happens between two frames. Encoded with x264 (CRF 16, preset slow; a draft:
// veryfast) at exactly 60 fps, fitted into 1920x1080 (phone shots 1080x1920) on the site's dark background.

import { spawn } from "node:child_process";
import { rmSync, statfsSync } from "node:fs";
import type { Browser, Page } from "playwright";
import { VIEWPORTS, seconds, type Action, type Shot } from "./shots.js";

export const FPS = 60;
/** The site's dark background, behind a fitted frame. */
export const BG = "0x0a0c11";
/** Renders stop below this much free disk (the plan's V8). */
export const MIN_FREE_BYTES = 3 * 1024 ** 3;

/** Free bytes on the disk that holds `dir`. */
export const freeBytes = (dir: string) => { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); };
/** Stops a render when the disk is nearly full, before a frame is drawn. */
export function guardDisk(dir: string, min = MIN_FREE_BYTES, free = freeBytes(dir)): void {
  if (free < min) throw new Error(`film: only ${(free / 1024 ** 3).toFixed(1)} GB free under ${dir}; a render needs ${(min / 1024 ** 3).toFixed(0)} GB. Delete old clips in out/video first.`);
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** The scroll positions of an eased scroll, one per frame (the last frame lands on `to`). */
export function scrollFrames(from: number, to: number, s: number, fps = FPS): number[] {
  const n = Math.max(1, Math.round(s * fps));
  return Array.from({ length: n }, (_, i) => from + (to - from) * ease((i + 1) / n));
}
/** The ffmpeg arguments that read JPEG frames from stdin and write the shot. */
export function encoderArgs(out: string, size: [number, number], o: { draft?: boolean; margin?: number } = {}): string[] {
  const [w, h] = size, m = o.margin ?? 2;
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-vf", `scale=${w - 2 * m}:${h - 2 * m}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1,format=yuv420p`,
    "-c:v", "libx264", "-preset", o.draft ? "veryfast" : "slow", "-crf", o.draft ? "20" : "16", "-r", String(FPS), "-movflags", "+faststart", out,
  ];
}

/** A page's checks before the first frame: the missing `must` lines and the gate's verdict. */
export async function pageChecks(page: Page, shot: Shot): Promise<string[]> {
  const { body, menu } = await page.evaluate(() => ({ body: document.body.innerText, menu: (document.querySelector('nav[aria-label="Main"]') as HTMLElement | null)?.innerText ?? "" }));
  const flat = body.replace(/\s+/g, " ");
  const out = shot.must.filter((m) => !flat.includes(m)).map((m) => `missing "${m}"`);
  if (shot.gate?.menuWithout && menu.split(/\s+/).includes(shot.gate.menuWithout)) out.push(`gate ${shot.gate.stream}: the menu still has "${shot.gate.menuWithout}"`);
  if (shot.gate?.pageWith && !flat.includes(shot.gate.pageWith)) out.push(`gate ${shot.gate.stream}: no "${shot.gate.pageWith}" on the page`);
  return out;
}

const PREP_CSS = "html{scroll-behavior:auto!important;scrollbar-width:none}::-webkit-scrollbar{display:none}*{caret-color:transparent!important}";

/** The page scroll that puts the first element containing `text` at `at` of the viewport. */
async function aim(page: Page, text: string, at: number): Promise<number> {
  return page.evaluate(({ text, at }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let el: Element | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (p && (n.textContent ?? "").includes(text) && p.getClientRects().length) { el = p; break; }
    }
    if (!el) { const all = [...document.querySelectorAll("body *")].filter((e) => (e as HTMLElement).innerText?.replace(/\s+/g, " ").includes(text)); el = all.at(-1) ?? null; }
    if (!el) throw new Error(`no "${text}" on the page`);
    const r = el.getBoundingClientRect();
    const max = document.documentElement.scrollHeight - innerHeight;
    return Math.max(0, Math.min(max, scrollY + r.top - at * innerHeight));
  }, { text, at });
}

/** Outline the smallest elements holding these strings (a table cell's whole row). The page's words stay as they are. */
async function highlight(page: Page, texts: string[]): Promise<void> {
  await page.evaluate((texts) => {
    for (const text of texts) {
      const hits = [...document.querySelectorAll("body *")].filter((e) => (e as HTMLElement).innerText?.includes(text) && (e as HTMLElement).getClientRects().length);
      let el = hits.find((e) => ![...e.children].some((c) => (c as HTMLElement).innerText?.includes(text))) as HTMLElement | undefined;
      if (!el) continue;
      if (/^T[DH]$/.test(el.tagName)) el = el.parentElement as HTMLElement;
      if (/^(SPAN|CODE|STRONG|B|EM|A)$/.test(el.tagName) && el.parentElement) el = el.parentElement;
      el.style.outline = "3px solid #8b85ff"; el.style.outlineOffset = "4px"; el.style.borderRadius = "6px";
    }
  }, texts);
}

/** Open the folds (<details>) that hold a line the shot must show, scrolls to or highlights: a visitor opens them too. */
async function unfold(page: Page, shot: Shot): Promise<void> {
  const texts = [...shot.must, ...shot.actions.flatMap((a) => ("scroll" in a ? [a.scroll] : "highlight" in a ? a.highlight : []))];
  await page.evaluate((texts) => {
    for (const d of [...document.querySelectorAll("details")]) if (texts.some((t) => (d.textContent ?? "").includes(t))) d.open = true;
  }, texts);
  await page.waitForTimeout(200);
}

const frame = (page: Page) => page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));

export interface Captured { id: string; url: string; seconds: number; frames: number; screenshots: number; refused?: undefined }
export interface Refused { id: string; refused: string[] }

/**
 * Capture one page shot into `out` (an .mp4). `root` resolves a file pick; `urls` overrides the shot's addresses (the
 * test's local page). Returns what was filmed, or why it was refused (nothing is written then).
 */
export async function captureShot(browser: Browser, shot: Shot, out: string, o: { root: string; urls?: string[]; local?: string; draft?: boolean; log?: (s: string) => void }): Promise<Captured | Refused> {
  const vp = VIEWPORTS[shot.viewport];
  const urls = (o.urls ?? shot.urls ?? []).flatMap((u) => (!u.startsWith("local:") ? [u] : o.local ? [o.local + u.slice("local:".length)] : []));
  if (!urls.length) return { id: shot.id, refused: [`no address yet (${shot.gate?.stream ?? "no stream"}): ${shot.what}`] };
  const reasons: string[] = [];
  for (const url of urls) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, colorScheme: "dark", reducedMotion: "no-preference", isMobile: shot.viewport === "phone", hasTouch: shot.viewport === "phone", locale: "en-GB", timezoneId: "UTC", bypassCSP: true });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
      await page.addStyleTag({ content: PREP_CSS });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      await unfold(page, shot);
      const bad = await pageChecks(page, shot);
      if (bad.length) { reasons.push(`${url}: ${bad.join("; ")}`); continue; }
      return await film(page, shot, out, url, vp.out, o);
    } catch (e) {
      reasons.push(`${url}: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      await ctx.close();
    }
  }
  return { id: shot.id, refused: reasons };
}

async function film(page: Page, shot: Shot, out: string, url: string, size: [number, number], o: { root: string; draft?: boolean; log?: (s: string) => void }): Promise<Captured> {
  const ff = spawn("ffmpeg", encoderArgs(out, size, { draft: o.draft }), { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => { err += String(d); });
  const done = new Promise<void>((ok, no) => ff.on("close", (code) => (code === 0 ? ok() : no(new Error(`ffmpeg ${code}: ${err.trim()}`)))));
  const cdp = await page.context().newCDPSession(page);
  let last: Buffer | null = null, frames = 0, shots = 0;
  const write = (b: Buffer) => new Promise<void>((ok) => { frames++; if (ff.stdin.write(b)) ok(); else ff.stdin.once("drain", () => ok()); });
  const snap = async () => { await frame(page); const r = (await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 94 })) as { data: string }; shots++; last = Buffer.from(r.data, "base64"); return last; };
  try {
    await page.evaluate(() => scrollTo(0, 0));
    await snap();
    for (const a of shot.actions as Action[]) {
      if ("hold" in a) { const n = Math.round(a.hold * FPS); for (let i = 0; i < n; i++) await write(last!); }
      else if ("scroll" in a) {
        const from = await page.evaluate(() => scrollY), to = await aim(page, a.scroll, a.at ?? 0.3);
        for (const y of scrollFrames(from, to, a.s)) { await page.evaluate((y) => scrollTo(0, y), y); await write(await snap()); }
      } else if ("click" in a) {
        // By role and accessible name: no selector is built from the text.
        await page.getByRole("button", { name: a.click }).or(page.getByRole("link", { name: a.click })).first().click({ timeout: 10_000 });
        await page.waitForTimeout(700); await snap();
      } else if ("pick" in a) {
        await page.locator('input[type="file"]').first().setInputFiles(`${o.root}/${a.pick}`);
        await page.waitForTimeout(1200); await snap();
      } else if ("highlight" in a) { await highlight(page, a.highlight); await snap(); }
    }
    const shown = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const wrong = (shot.mustNot ?? []).filter((m) => shown.includes(m));
    if (wrong.length) throw new Error(`the page shows ${wrong.map((w) => `"${w}"`).join(", ")} after its actions`);
  } catch (e) {
    // A shot that fails half-way leaves no partial clip behind.
    ff.kill("SIGKILL");
    await done.catch(() => undefined);
    rmSync(out, { force: true });
    throw e;
  }
  ff.stdin.end();
  await done;
  o.log?.(`${shot.id}: ${frames} frames from ${shots} screenshots, ${url}`);
  return { id: shot.id, url, seconds: seconds(shot), frames, screenshots: shots };
}
