// npm run video [-- <clip id>...]: records the premiere (src/film/premiere.html, its script in
// src/film/premiereScript.ts), Purser in two and a half minutes made from the main run of 3 November, one clip per
// scene, at 1920x1080, letterboxed to 2.39:1 and exactly 60 frames a second. The browser runs on virtual time: each
// frame moves the clock by 1/60 s and is captured, so nothing loads or stutters on screen. Each frame is drawn at twice
// the size (3840x2160) and scaled down with lanczos, then encoded with x264 (preset slow, CRF 14), so small text stays
// crisp. Every figure comes from the run's record through src/film/premiere.ts, which stops the build when one is
// missing. Writes to out/video/: clips/, overlays/ (a transparent PNG per recording slot), the silent master
// (master-v5.mp4, no audio and no burned-in subtitles), scenes-v5.json (each scene's start and end, for the mix),
// subtitles-v5.srt (for YouTube), script.md (the voice-over) and premiere-script.md
// (the script table).
//   --docs     writes docs/video/premiere-script.md, subtitles-v5.srt, scenes-v5.json and script.md, and nothing else
//   --stills   a PNG of three moments of each scene in out/video/stills/, for a quick look, and nothing else
//   --check    draws every scene in a browser and fails on a page error, and nothing else
//   --film     the earlier film of the 30 October recording (src/video/plan.ts) into out/video/film/, as before
//   --slot 08-faceid=<file>[@<start>-<end>], --slot 11-turn=<file>[@<start>-<end>]: Max's own portrait phone
//              recordings, laid into a phone frame beside the scene's captions (src/film/slots.ts); without one the
//              scene keeps its rendered picture (the Face ID reconstruction, the /try/sign mock)
// VIDEO_PREVIEW=1 makes a quick preview instead: drawn at 1920x1080 (no supersampling) and encoded with x264 preset
// veryfast at CRF 18, for a first look; it is not the deliverable.
// Nothing here is live: the pages are the recordings, as npm run judge serves them.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
import { CSP, DEMO_CSP, FILM_CSP, FONT, LAB_CSP, LIVE_CSP, LOGOS, MONTH_CSP, PAGE, demoPage, filmPage, labPage, livePage, monthPage } from "../servers/dashboard.js";
import { BEATS, scriptMarkdown, subtitlesSrt, totalSeconds, type Action, type Beat } from "../video/plan.js";
import { PREMIERE_CSP, loadPremiere, premierePage } from "../film/premiere.js";
import { MASTER_CLIPS, OVERLAYS, pageScenes, scenesJson, premiereBeats, premiereReadAloud, premiereSeconds, premiereSrt, premiereTable, premiereTimeline, sceneFade } from "../film/premiereScript.js";
import { SLOT_RADIUS, maskExpr, parseSlotArgs, slotBox, slotFilter, slotSpeed, type SlotFile } from "../film/slots.js";

const FPS = 60;
/** The encoder for every clip: x264, preset slow, CRF 14 (small text stays crisp), 4:2:0, exactly 60 fps. */
const X264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS)];
/** The premiere is drawn at twice its size (3840x2160) and scaled down to 1920x1080 with lanczos. */
const PREMIERE_SCALE = 2;
/** The premiere's master (film v5): silent, no audio track; the mix adds the voice and the music to scenes-v5.json. */
const MASTER = "master-v5.mp4";
/** VIDEO_PREVIEW=1: a quick look (1x, a fast preset), not the deliverable. */
const PREVIEW = process.env.VIDEO_PREVIEW === "1";
const ENCODE = PREVIEW ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS)] : X264;
const root = resolve(import.meta.dirname, "../..");
const film = process.argv.includes("--film");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video", film ? "film" : ".");
const check = process.argv.includes("--check");
const args = parseSlotArgs(process.argv.slice(2));
const only = new Set(args.rest.filter((a) => !a.startsWith("--")));
// The premiere's figures, read from the main run's record now: a missing one stops everything before a frame is drawn.
const premiere = loadPremiere();
const timeline = premiereTimeline();

/** The recorded pages, as npm run judge serves them, and the newest Dispute desk report. */
function server(): Promise<{ url: string; close: () => void }> {
  const app = express();
  const send = (csp: string, html: string) => (_req: express.Request, res: express.Response) => { res.setHeader("Content-Security-Policy", csp); res.type("html").send(html); };
  app.get("/", send(CSP, PAGE));
  app.get("/live", send(LIVE_CSP, livePage()));
  app.get("/film", send(FILM_CSP, filmPage()));
  app.get("/premiere", send(PREMIERE_CSP, premierePage(premiere, pageScenes())));
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
  // The premiere's page lays itself out at 1920x1080 and is drawn at twice that; the earlier film's pages at 1440x810.
  const premierePage = !film;
  const view = premierePage ? { width: 1920, height: 1080, scale: PREVIEW ? 1 : PREMIERE_SCALE } : { width: VW, height: VH, scale: 1920 / VW };
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-vf", "scale=1920:1080:flags=lanczos", ...ENCODE, "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  for (const shot of beat.shots) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale, bypassCSP: true, colorScheme: "light", reducedMotion: "no-preference" });
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
    // A page that draws itself from a time it is given (the film) gets that time for every frame.
    const manual = /[?&]manual(&|$)/.test(shot.path) ? Number(/[?&]from=([\d.]+)/.exec(shot.path)?.[1] ?? 0) : null;
    for (let f = 0; f < frames; f++) {
      if (manual !== null) await within(`${beat.id} frame ${f}: the film`, page.evaluate(`window.__film(${manual + f / FPS})`));
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
      // The premiere: the whole viewport at its device scale (a clip's scale sets the output size: 3840x2160). The film:
      // the camera's crop, at 1920 wide.
      const clip = premierePage ? { x: 0, y: 0, width: view.width, height: view.height, scale: view.scale } : { x: w.sx + now.x, y: w.sy + now.y, width: now.w, height: now.h, scale: 1920 / now.w };
      const { data } = await within(`${beat.id} ${shot.path} frame ${f}: the screenshot`, cdp.send("Page.captureScreenshot", { format: "jpeg", quality: premierePage ? 95 : 93, clip }));
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

/** A recording's upright size (a phone's rotation applied) and length. */
function probe(file: string): { w: number; h: number; duration: number } {
  if (!existsSync(file)) throw new Error(`video: no recording at ${file}`);
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:format=duration", "-of", "json", file], { encoding: "utf8" })) as
    { streams?: { width: number; height: number; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } };
  const st = j.streams?.[0];
  if (!st) throw new Error(`video: ${file} has no video`);
  const turned = Math.abs(st.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) % 180 === 90;
  return { w: turned ? st.height : st.width, h: turned ? st.width : st.height, duration: Number(j.format?.duration ?? 0) };
}

/** Each recording given with --slot: its scene, the box it fills, its window and how fast it plays. */
const slots = new Map(args.slots.map((sl: SlotFile) => {
  const scene = timeline.find((x) => x.id === sl.id)!;
  const p = probe(sl.file);
  const from = sl.from ?? 0, to = sl.to ?? p.duration;
  if (to > p.duration + 0.05) throw new Error(`video: --slot ${sl.id}: the window ends at ${to} s, the recording at ${p.duration.toFixed(2)} s`);
  const box = slotBox(sl.id, p.w / p.h);
  return [sl.id, { ...sl, scene, box, from, seconds: to - from, speed: slotSpeed(to - from, scene.seconds) }] as const;
}));

/** Lays a recording into its scene's clip: cut to its window, into the frame the page drew, corners rounded, faded with the scene. */
async function laySlot(id: string): Promise<void> {
  const sl = slots.get(id as SlotFile["id"])!;
  const clip = resolve(out, "clips", `${id}.mp4`), tmp = resolve(out, "clips", `${id}.with-recording.mp4`);
  mkdirSync(resolve(out, "slots"), { recursive: true });
  const mask = resolve(out, "slots", `mask-${sl.box.w}x${sl.box.h}.png`);
  await ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=${sl.box.w}x${sl.box.h},format=gray`, "-vf", `geq=lum='${maskExpr(SLOT_RADIUS)}'`, "-frames:v", "1", mask]);
  await ffmpeg(["-i", clip, "-ss", String(sl.from), "-t", String(sl.seconds), "-i", sl.file, "-loop", "1", "-i", mask,
    "-filter_complex", slotFilter({ box: sl.box, seconds: sl.scene.seconds, speed: sl.speed, fade: sceneFade(sl.scene) }), "-map", "[v]", "-an",
    ...X264, "-t", String(sl.scene.seconds), "-movflags", "+faststart", tmp]);
  renameSync(tmp, clip);
  console.log(`slot     ${id}: ${sl.file} ${sl.from}–${sl.from + sl.seconds} s${sl.speed > 1 ? ` at ${sl.speed}× speed` : ""}, laid into its frame`);
}

/** --check for the premiere: every scene drawn at several moments, with no page error and its layer on screen. */
async function checkPremiere(browser: import("playwright").Browser, base: string): Promise<number> {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/premiere?manual`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  let problems = 0;
  for (const s of timeline) {
    for (const f of [0.1, 0.5, 0.9]) {
      const visible = await page.evaluate((t) => { (window as unknown as { __film: (t: number) => void }).__film(t); return [...document.querySelectorAll("#pic > .layer")].filter((l) => (l as HTMLElement).style.visibility === "visible").length; }, s.start + f * s.seconds);
      const bad = visible !== 1 || errors.length > 0;
      if (bad) problems++;
      console.log(`${bad ? "PROBLEM" : "ok     "} ${s.id} at ${(f * s.seconds).toFixed(1)} s${errors.length ? `: ${errors.join(" | ")}` : ""}`);
      errors.length = 0;
    }
  }
  for (const id of OVERLAYS) {
    await page.goto(`${base}/premiere?overlay=${id}`, { waitUntil: "load" });
    const labels = await page.locator(".layer .a").count();
    if (!labels || errors.length) problems++;
    console.log(`${labels && !errors.length ? "ok     " : "PROBLEM"} overlay ${id}: ${labels} label(s)`);
  }
  await ctx.close();
  return problems;
}

/** The overlays: each recording slot's letterbox bars and label, a transparent 1920x1080 PNG to lay over the footage. */
async function overlays(browser: import("playwright").Browser, base: string): Promise<void> {
  // Only the slots there are now: a slot that was cut leaves no overlay behind.
  rmSync(resolve(out, "overlays"), { recursive: true, force: true });
  mkdirSync(resolve(out, "overlays"), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  for (const id of OVERLAYS) {
    await page.goto(`${base}/premiere?overlay=${id}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, "overlays", `${id}.png`), omitBackground: true });
    console.log(`overlay  overlays/${id}.png`);
  }
  await ctx.close();
}

/** --stills: three moments of each scene, as the recording draws them (1920x1080 PNGs, for a quick look). */
async function stills(browser: import("playwright").Browser, base: string): Promise<void> {
  mkdirSync(resolve(out, "stills"), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1920 / 1440 });
  const page = await ctx.newPage();
  await page.goto(`${base}/premiere?manual`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const draw = async (t: number, file: string) => {
    await page.evaluate((x) => (window as unknown as { __film: (t: number) => void }).__film(x), t);
    await page.waitForTimeout(60);
    await page.screenshot({ path: resolve(out, "stills", file) });
  };
  // "05-price@12.5": that scene at that second (from its start); a bare id: three moments of it.
  const at = [...only].filter((a) => a.includes("@")).map((a) => a.split("@") as [string, string]);
  for (const [id, sec] of at) {
    const s = timeline.find((x) => x.id === id);
    if (!s) throw new Error(`video: no scene ${id}`);
    await draw(s.start + Number(sec), `${id}@${sec}.png`);
    console.log(`still    stills/${id}@${sec}.png`);
  }
  for (const s of timeline) {
    if (at.length || (only.size && !only.has(s.id))) continue;
    for (const [k, f] of [["a", 0.3], ["b", 0.62], ["c", 0.93]] as const) await draw(s.start + f * s.seconds, `${s.id}-${k}.png`);
    console.log(`stills   stills/${s.id}-a/b/c.png`);
  }
  await ctx.close();
}

/** The premiere's words, written next to the clips (and, with --docs, into docs/video/). */
function writeWords(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "subtitles-v5.srt"), premiereSrt(premiere));
  writeFileSync(resolve(dir, "scenes-v5.json"), `${JSON.stringify(scenesJson(), null, 2)}\n`);
  writeFileSync(resolve(dir, "script.md"), premiereReadAloud(premiere));
  writeFileSync(resolve(dir, "premiere-script.md"), premiereTable(premiere));
}

if (process.argv.includes("--docs")) {
  writeWords(resolve(root, "docs/video"));
  console.log("docs     docs/video/premiere-script.md, subtitles-v5.srt, scenes-v5.json and script.md");
  process.exit(0);
}

// A full recording starts from an empty clips/, so a scene that was cut leaves no clip behind.
if (!film && !only.size && !check && !process.argv.includes("--stills")) rmSync(resolve(out, "clips"), { recursive: true, force: true });
mkdirSync(resolve(out, "clips"), { recursive: true });
if (film) {
  writeFileSync(resolve(out, "subtitles.srt"), subtitlesSrt());
  writeFileSync(resolve(out, "script.md"), scriptMarkdown());
} else {
  writeWords(out);
  // No burned-in subtitles any more (premiere v3): the master is clean, subtitles.srt goes to YouTube.
  for (const old of ["subtitles.ass", "master-subtitled.mp4"]) rmSync(resolve(out, old), { force: true });
}
const srv = await server();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
if (check) {
  const problems = film ? await checkPlan(browser, srv.url) : await checkPremiere(browser, srv.url);
  await browser.close(); srv.close();
  process.exit(problems ? 1 : 0);
}
if (process.argv.includes("--stills")) {
  await stills(browser, srv.url);
  await browser.close(); srv.close();
  process.exit(0);
}
// A scene with a recording is drawn with an empty frame where the recording goes, then the recording is laid in.
const beats: Beat[] = (film ? BEATS : premiereBeats(premiere)).map((b) => {
  const sl = slots.get(b.id as SlotFile["id"]);
  return sl ? { ...b, shots: b.shots.map((x) => ({ ...x, path: `${x.path}&rec=${sl.box.x},${sl.box.y},${sl.box.w},${sl.box.h}&recfor=${b.id}&speed=${sl.speed}` })) } : b;
});
const t0 = Date.now();
for (const beat of beats) {
  if (only.size && !only.has(beat.id)) continue;
  const s = Date.now();
  await recordBeat(browser, srv.url, beat);
  if (slots.has(beat.id as SlotFile["id"])) await laySlot(beat.id);
  console.log(`clip     ${beat.id}.mp4 (${beat.shots.reduce((a, x) => a + x.seconds, 0)} s) in ${Math.round((Date.now() - s) / 1000)} s`);
}
if (!film) await overlays(browser, srv.url);
await browser.close();
srv.close();
// The master is rebuilt whenever every clip is there, also after recording only some beats again.
const inMaster = film ? BEATS.map((b) => b.id) : MASTER_CLIPS;
if (inMaster.every((id) => existsSync(resolve(out, "clips", `${id}.mp4`)))) {
  writeFileSync(resolve(out, "clips.txt"), inMaster.map((id) => `file 'clips/${id}.mp4'`).join("\n") + "\n");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", resolve(out, "clips.txt"), "-c", "copy", "-movflags", "+faststart", resolve(out, film ? "master.mp4" : MASTER)]);
  // The earlier film keeps its subtitled copy; the premiere's master is delivered clean.
  if (film) await ffmpeg(["-i", resolve(out, "master.mp4"), "-vf", `subtitles=${resolve(out, "subtitles.srt")}:force_style='FontName=Inter,FontSize=22,Outline=2,Shadow=0,MarginV=36'`, ...X264, "-movflags", "+faststart", resolve(out, "master-subtitled.mp4")]);
  console.log(`master   ${film ? "out/video/film/master.mp4" : `${out}/${MASTER}`}${film ? " and master-subtitled.mp4" : ""}, ${film ? totalSeconds() : premiereSeconds()} s, in ${Math.round((Date.now() - t0) / 1000)} s`);
}
