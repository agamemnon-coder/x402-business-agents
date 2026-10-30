// npm run video [-- <beat id>...]: records the video's shots (src/video/plan.ts) from the recorded pages, at
// 1920x1080 and exactly 60 frames a second. The browser runs on virtual time: each frame moves the clock by 1/60 s and
// is captured, so nothing loads or stutters on screen. A cursor highlight, clicks and zooms are drawn by a small
// overlay. Writes to out/video/: one clip per beat, the silent master, a master with burned-in English subtitles,
// subtitles.srt and script.md. Nothing here is live: the pages are the recordings, as npm run judge serves them.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
import { CSP, DEMO_CSP, FILM_CSP, FONT, LAB_CSP, LIVE_CSP, LOGOS, MONTH_CSP, PAGE, demoPage, filmPage, labPage, livePage, monthPage } from "../servers/dashboard.js";
import { BEATS, scriptMarkdown, subtitlesSrt, totalSeconds, type Action, type Beat } from "../video/plan.js";

const FPS = 60;
const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video");
const check = process.argv.includes("--check");
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));

/** The recorded pages, as npm run judge serves them, and the newest Dispute desk report. */
function server(): Promise<{ url: string; close: () => void }> {
  const app = express();
  const send = (csp: string, html: string) => (_req: express.Request, res: express.Response) => { res.setHeader("Content-Security-Policy", csp); res.type("html").send(html); };
  app.get("/", send(CSP, PAGE));
  app.get("/live", send(LIVE_CSP, livePage()));
  app.get("/film", send(FILM_CSP, filmPage()));
  app.get("/demo", send(DEMO_CSP, demoPage()));
  app.get("/month", send(MONTH_CSP, monthPage()));
  app.get("/lab", send(LAB_CSP, labPage()));
  const reports = readdirSync(resolve(root, "docs/disputes")).filter((f) => f.endsWith(".html")).sort();
  app.get("/dispute-report", (_req, res) => { res.type("html").send(readFileSync(resolve(root, "docs/disputes", reports.at(-1)!), "utf8")); });
  app.get("/assets/inter.woff2", (_req, res) => { res.type("font/woff2").send(FONT); });
  for (const [name, logo] of Object.entries(LOGOS)) app.get(`/assets/${name}`, (_req, res) => { res.type(logo.type).send(logo.body); });
  return new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() })); });
}

/** The overlay: a highlighted cursor that glides and a click ripple. Scrolls and zooms are driven frame by frame (below). */
const OVERLAY = `(() => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;left:-60px;top:-60px;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(91,76,240,.28);border:3px solid #5b4cf0;box-shadow:0 0 0 6px rgba(91,76,240,.12);z-index:2147483647;pointer-events:none;transition:left .7s cubic-bezier(.3,.7,.3,1),top .7s cubic-bezier(.3,.7,.3,1),transform .2s";
  document.documentElement.appendChild(c);
  // A screenshot waits for the next drawn frame, and an unchanged page draws none: an invisible pixel that changes on
  // every frame keeps the frames coming.
  const tick = document.createElement("div");
  tick.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:2147483647;pointer-events:none;background:rgba(0,0,0,.004)";
  document.documentElement.appendChild(tick);
  let n = 0;
  const beat = () => { tick.style.opacity = n++ % 2 ? "1" : ".5"; requestAnimationFrame(beat); };
  requestAnimationFrame(beat);
  const centre = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, e }; };
  window.__v = {
    point(sel) { const p = centre(sel); if (p) { c.style.left = p.x + "px"; c.style.top = p.y + "px"; } },
    click(sel) { this.point(sel); c.style.transform = "scale(.7)"; setTimeout(() => { c.style.transform = ""; }, 220); },
    // An eased scroll that centres the selector. It moves only when where() asks, once per frame, so the scroll the
    // camera reads is the scroll the screenshot shows (a scroll run by the page's own frames would move during it).
    scroll(sel, scale) { this.anim = { from: scrollY, to: this.aim(sel, scale || 1), t0: performance.now() }; },
    // The scroll that shows the selector: centred if it fits the zoom's crop, else its top just under the page's header.
    aim(sel, scale) {
      const e = document.querySelector(sel); if (!e) return scrollY;
      const r = e.getBoundingClientRect(), m = 24 * scale;
      const fits = r.width * scale + 2 * m <= innerWidth && r.height * scale + 2 * m <= innerHeight;
      const y = fits ? scrollY + r.top + r.height / 2 - innerHeight / 2 : scrollY + r.top - 100;
      return Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, y));
    },
    // Where the camera is: the scroll, and the zoom target's box in the viewport.
    where(sel) {
      const a = this.anim;
      if (a) { const t = Math.min(1, (performance.now() - a.t0) / 800); const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; scrollTo(0, a.from + (a.to - a.from) * k); if (t >= 1) this.anim = null; }
      const e = sel ? document.querySelector(sel) : null; const r = e ? e.getBoundingClientRect() : null; return { sx: scrollX, sy: scrollY, r: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null }; },
  };
})();`;

interface Box { x: number; y: number; w: number; h: number }
// The pages are laid out at 1440x810 (the desktop size they are designed for). Each frame is the camera's crop drawn by
// the browser at 1920 pixels wide, so text stays sharp at any zoom.
const VW = 1440, VH = 810;
const FULL: Box = { x: 0, y: 0, w: VW, h: VH };
const ZOOM_SECONDS = 0.9;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: Box, b: Box, t: number): Box => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t });
/**
 * The crop for a zoom at the asked scale: centred on the target when it fits, else from the target's top-left corner
 * (a wide table reads from its first column), and never past the viewport.
 */
function fit(r: Box, scale: number): Box {
  const w = VW / scale, h = VH / scale, m = 24;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const x = r.w + 2 * m <= w ? r.x + r.w / 2 - w / 2 : r.x - m;
  const y = r.h + 2 * m <= h ? r.y + r.h / 2 - h / 2 : r.y - m;
  return { x: clamp(x, VW - w), y: clamp(y, VH - h), w, h };
}

/** A frame that does not come within 20 s is a bug, not a slow machine: stop and say where. */
function within<T>(what: string, p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_ok, fail) => { timer = setTimeout(() => fail(new Error(`video: stuck at ${what}`)), 20_000); })]).finally(() => clearTimeout(timer));
}

async function recordBeat(browser: import("playwright").Browser, base: string, beat: Beat): Promise<string> {
  const file = resolve(out, "clips", `${beat.id}.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-vf", "scale=1920:1080", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  for (const shot of beat.shots) {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1920 / VW, bypassCSP: true, colorScheme: "light", reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    page.on("crash", () => console.error(`video: the page crashed (${beat.id} ${shot.path})`));
    await page.goto(base + shot.path, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.evaluate(OVERLAY);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
    const actions = [...(shot.actions ?? [])].sort((a, b) => a.at - b.at);
    const frames = Math.round(shot.seconds * FPS);
    // The camera: each frame is a crop of the viewport, scaled to the full frame. A zoom eases from the current crop to one
    // that holds the target (following it as the page scrolls); an unzoom eases back to the whole viewport.
    let cam = { from: FULL, sel: null as string | null, scale: 1, start: 0 };
    let now = FULL;
    for (let f = 0; f < frames; f++) {
      while (actions.length && actions[0]!.at * FPS <= f) {
        const a = actions.shift() as Action;
        if (a.do === "zoom" || a.do === "scroll") await within(`${beat.id} frame ${f}: scroll`, page.evaluate(`window.__v.scroll(${JSON.stringify(a.target)}, ${a.do === "zoom" ? a.scale ?? 1.3 : 1})`));
        if (a.do === "zoom") cam = { from: now, sel: a.target ?? null, scale: a.scale ?? 1.3, start: f };
        else if (a.do === "unzoom") cam = { from: now, sel: null, scale: 1, start: f };
        else if (a.do !== "scroll") await within(`${beat.id} frame ${f}: ${a.do}`, page.evaluate(`window.__v.${a.do}(${JSON.stringify(a.target)})`));
      }
      await within(`${beat.id} ${shot.path} frame ${f}: the clock`, new Promise<void>((ok) => { cdp.once("Emulation.virtualTimeBudgetExpired", () => ok()); void cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: 1000 / FPS }); }));
      const w = (await within(`${beat.id} frame ${f}: where`, page.evaluate(`window.__v.where(${JSON.stringify(cam.sel)})`))) as { sx: number; sy: number; r: Box | null };
      const goal = cam.sel && w.r ? fit(w.r, cam.scale) : FULL;
      now = mix(cam.from, goal, ease(Math.min(1, (f - cam.start) / (ZOOM_SECONDS * FPS))));
      const clip = { x: w.sx + now.x, y: w.sy + now.y, width: now.w, height: now.h, scale: 1920 / now.w };
      const { data } = await within(`${beat.id} ${shot.path} frame ${f}: the screenshot`, cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, clip }));
      if (process.env.VIDEO_TRACE && f % 60 === 0) console.log(`  ${beat.id} ${shot.path} ${f / FPS} s`);
      if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => ff.stdin.once("drain", ok));
    }
    await ctx.close();
  }
  ff.stdin.end();
  await new Promise((ok) => ff.on("close", ok));
  return file;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((ok, fail) => { const p = spawn("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" }); p.on("close", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))); });
}

/** --check: every selector the plan points at is on its page and has a size. Quick, no video. */
async function checkPlan(browser: import("playwright").Browser, base: string): Promise<number> {
  let problems = 0;
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, bypassCSP: true });
  for (const beat of BEATS) for (const shot of beat.shots) {
    const page = await ctx.newPage();
    await page.goto(base + shot.path, { waitUntil: "load" });
    await page.waitForTimeout(400);
    for (const a of shot.actions ?? []) {
      if (!a.target) continue;
      const r = await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, text: (e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40) }; }, a.target);
      const zoom = a.do === "zoom" && r ? `, ${r.w * (a.scale ?? 1.3) <= VW ? "whole" : "from its left edge"}` : "";
      const bad = !r || !r.w || !r.h;
      if (bad) problems++;
      console.log(`${bad ? "PROBLEM" : "ok     "} ${beat.id} ${shot.path} ${a.at}s ${a.do} ${a.target}${r ? ` "${r.text}"` : " (not on the page)"}${zoom}`);
    }
    await page.close();
  }
  await ctx.close();
  return problems;
}

mkdirSync(resolve(out, "clips"), { recursive: true });
writeFileSync(resolve(out, "subtitles.srt"), subtitlesSrt());
writeFileSync(resolve(out, "script.md"), scriptMarkdown());
const srv = await server();
const browser = await chromium.launch();
if (check) {
  const problems = await checkPlan(browser, srv.url);
  await browser.close(); srv.close();
  process.exit(problems ? 1 : 0);
}
const t0 = Date.now();
for (const beat of BEATS) {
  if (only.size && !only.has(beat.id)) continue;
  const s = Date.now();
  await recordBeat(browser, srv.url, beat);
  console.log(`clip     ${beat.id}.mp4 (${beat.shots.reduce((a, x) => a + x.seconds, 0)} s) in ${Math.round((Date.now() - s) / 1000)} s`);
}
await browser.close();
srv.close();
// The master is rebuilt whenever every clip is there, also after recording only some beats again.
if (BEATS.every((b) => existsSync(resolve(out, "clips", `${b.id}.mp4`)))) {
  writeFileSync(resolve(out, "clips.txt"), BEATS.map((b) => `file 'clips/${b.id}.mp4'`).join("\n") + "\n");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", resolve(out, "clips.txt"), "-c", "copy", "-movflags", "+faststart", resolve(out, "master.mp4")]);
  await ffmpeg(["-i", resolve(out, "master.mp4"), "-vf", `subtitles=${resolve(out, "subtitles.srt")}:force_style='FontName=Inter,FontSize=22,Outline=2,Shadow=0,MarginV=36'`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", resolve(out, "master-subtitled.mp4")]);
  console.log(`master   out/video/master.mp4 and master-subtitled.mp4, ${totalSeconds()} s, in ${Math.round((Date.now() - t0) / 1000)} s`);
}
