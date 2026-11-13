// The promo film (13 Nov, src/film/promo.ts): capture the live pages, draw every frame, mix, cut stills.
//
//   npm run promo -- --check              every figure against its record, the timing, the words
//   npm run promo -- capture              the live /try loop (seeked frame by frame) and the Cloud guest view
//   npm run promo -- vo                   the narration from ElevenLabs (skips takes already in out/promo/vo/)
//   npm run promo -- render [--vertical]  out/promo/picture-{h,v}.mp4, silent, 60 fps
//   npm run promo -- mix [--vertical]     out/promo/purser-promo-{1080p,vertical}.mp4 at -14 LUFS, and the .srt
//   npm run promo -- stills               three PNG stills from the 1080p master
//
// Read-only on the live site: GETs, and the Cloud's read-only "Try as guest" (no company is made).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { measureFilter, normaliseFilter, parseMeasured, placeFilter, type Piece } from "../film/mix.js";
import { FPS, LABELS, LINES, MUSIC_AT, ROOT, SCENES, TOTAL, TRY_URL, VOICE, checkPromo, promoData, promoSrt } from "../film/promo.js";

const OUT = resolve(ROOT, "out/promo");
const LIVE = resolve(OUT, "live");
const args = process.argv.slice(2);
const vertical = args.includes("--vertical");
const draft = args.includes("--draft");
const size = vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const tag = vertical ? "v" : "h";

function gate() {
  const problems = checkPromo();
  if (problems.length) { console.error(problems.map((p) => `✕ ${p}`).join("\n")); process.exit(1); }
}

/** The live /try loop (16 s of CSS animations), paused and seeked to each frame, so the capture is exact at 60 fps. */
async function capture() {
  mkdirSync(resolve(LIVE, "try"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 3, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`https://${TRY_URL}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const shown = (await page.innerText("body")).replace(/\s+/g, " ");
  for (const must of ["EUR 1,850.00", "EUR 1,850.01", "Refused: terms changed"]) if (!shown.includes(must)) throw new Error(`promo: /try does not show "${must}"`);
  const loops = await page.evaluate(() => document.getAnimations().filter((a) => (a.effect?.getTiming().duration as number) >= 10000).length);
  if (!loops) throw new Error("promo: /try has no loop to seek");
  const seconds = 11, frames = seconds * FPS;
  for (let i = 0; i < frames; i++) {
    await page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); if ((a.effect?.getTiming().duration as number) >= 10000) a.currentTime = ms; } }, (i / FPS) * 1000);
    await page.screenshot({ path: resolve(LIVE, "try", `${String(i).padStart(4, "0")}.jpg`), quality: 92, clip: { x: 170, y: 340, width: 660, height: 440 } });
  }
  console.log(`/try: ${frames} frames (loop 0–${seconds} s)`);
  // The Cloud guest view: read only, made-up data, ends by itself after 15 minutes.
  const cloud = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const cp = await cloud.newPage();
  await cp.goto("https://purser-try.max-31b.workers.dev/", { waitUntil: "networkidle" });
  await cp.getByRole("button", { name: "Try as guest" }).click();
  await cp.getByText("Net cash").first().waitFor({ timeout: 30000 });
  await cp.waitForTimeout(2000);
  const ctext = (await cp.innerText("body")).replace(/\s+/g, " ");
  if (!/Demo: made-up data/.test(ctext) || !/Test money/.test(ctext)) throw new Error("promo: the Cloud guest view lacks its demo and test-money labels");
  await cp.screenshot({ path: resolve(LIVE, "cloud.png"), fullPage: true });
  console.log("cloud: guest overview");
  await browser.close();
  writeFileSync(resolve(LIVE, "captured.json"), JSON.stringify({ at: new Date().toISOString(), try: `https://${TRY_URL}`, cloud: "https://purser-try.max-31b.workers.dev/ (Try as guest)" }, null, 2));
}

/** The narration, one take per line (ElevenLabs; the proxy injects the key). Checks the credits first. */
async function vo() {
  mkdirSync(resolve(OUT, "vo"), { recursive: true });
  const todo = LINES.filter((l) => !existsSync(resolve(OUT, "vo", `${l.id}.mp3`)));
  const need = todo.reduce((n, l) => n + l.words.length, 0);
  const sub = await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": "proxy" } })).json() as { character_count: number; character_limit: number };
  const left = sub.character_limit - sub.character_count;
  console.log(`${todo.length} takes, about ${need} credits; ${left} left`);
  if (need > left - 250) throw new Error("promo: not enough credits (250 are kept for another session)");
  for (const [i, l] of LINES.entries()) {
    if (!todo.includes(l)) continue;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": "proxy", "content-type": "application/json" },
      body: JSON.stringify({ text: l.words, model_id: VOICE.model, previous_text: LINES[i - 1]?.words, next_text: LINES[i + 1]?.words, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
    });
    if (!r.ok) throw new Error(`promo: ElevenLabs ${r.status} for ${l.id}`);
    writeFileSync(resolve(OUT, "vo", `${l.id}.mp3`), Buffer.from(await r.arrayBuffer()));
    console.log(l.id);
  }
}

/** Every frame from promo.html, piped into x264. */
async function render() {
  gate();
  const frames = readdirSync(resolve(LIVE, "try")).filter((f) => f.endsWith(".jpg")).length;
  if (!frames || !existsSync(resolve(LIVE, "cloud.png"))) throw new Error("promo: run `npm run promo -- capture` first");
  const out = resolve(OUT, `picture-${tag}.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "23" : "15", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((ok, no) => ff.on("close", (c) => (c ? no(new Error(`ffmpeg ${c}`)) : ok())));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: size, deviceScaleFactor: 1 })).newPage();
  const boot = { data: promoData(), labels: LABELS, lines: LINES, scenes: SCENES, total: TOTAL, url: TRY_URL, live: `file://${LIVE}`, tryFrames: frames, fps: FPS, layout: tag };
  await page.addInitScript((b) => { (window as unknown as { __boot: unknown }).__boot = b; }, boot);
  await page.goto(`file://${resolve(ROOT, "src/film/promo.html")}`);
  await page.evaluate(() => document.fonts.ready);
  const n = Math.round(TOTAL * FPS), step = draft ? 2 : 1;
  for (let f = 0; f < n; f += step) {
    await page.evaluate(`window.__promo(${f / FPS})`);
    const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
    for (let k = 0; k < step; k++) if (!ff.stdin.write(jpg)) await new Promise((ok) => ff.stdin.once("drain", ok));
    if (f % (FPS * 5) === 0) console.log(`${(f / FPS).toFixed(0)} s`);
  }
  ff.stdin.end();
  await browser.close();
  await done;
  console.log(out);
}

/** The voice at its times, the music ducked under it, two-pass loudnorm to -14 LUFS (src/film/mix.ts). */
function mix() {
  const picture = resolve(OUT, `picture-${tag}.mp4`);
  const voice: Piece[] = LINES.map((l) => ({ file: resolve(OUT, "vo", `${l.id}.mp3`), at: l.at }));
  for (const p of [picture, ...voice.map((v) => v.file), resolve(OUT, "music.mp3")]) if (!existsSync(p)) throw new Error(`promo: ${p} is missing`);
  const inputs = [picture, ...voice.map((v) => v.file), resolve(OUT, "music.mp3")].flatMap((f) => ["-i", f]);
  const m = voice.length + 1, ms = Math.round(MUSIC_AT * 1000);
  // The voice bus from mix.ts, then the music: a slow fade out, ducked about 9 dB under the voice by a sidechain.
  const graph = `${placeFilter(voice, TOTAL).replace("[mix]", "[vo]")};[vo]asplit=2[vo1][key];`
    + `[${m}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-3dB,adelay=${ms}|${ms},afade=t=out:st=${TOTAL - 2.5}:d=2.5,apad,atrim=duration=${TOTAL}[mus];`
    + `[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[duck];`
    + `[vo1]volume=1.6[vo2];[vo2][duck]amix=inputs=2:normalize=0:duration=first[mix]`;
  const measured = parseMeasured(execFileSync("bash", ["-c", `ffmpeg -hide_banner -nostats ${inputs.map((x) => JSON.stringify(x)).join(" ")} -filter_complex ${JSON.stringify(`${graph};[mix]${measureFilter()}[m]`)} -map "[m]" -f null - 2>&1`], { encoding: "utf8", maxBuffer: 1 << 26 }));
  const file = resolve(OUT, vertical ? "purser-promo-vertical.mp4" : "purser-promo-1080p.mp4");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", `${graph};[mix]${normaliseFilter(measured)}[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-t", String(TOTAL), "-movflags", "+faststart", file], { stdio: "inherit" });
  writeFileSync(resolve(OUT, "purser-promo.srt"), promoSrt());
  console.log(file);
}

function stills() {
  const master = resolve(OUT, "purser-promo-1080p.mp4");
  for (const [name, at] of [["still-1-sign", 18.6], ["still-2-metal", 44.8], ["still-3-end", 70.0]] as const)
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(at), "-i", master, "-frames:v", "1", resolve(OUT, `${name}.png`)]);
  console.log("stills: out/promo/still-*.png");
}

const cmd = args.find((a) => !a.startsWith("--"));
if (args.includes("--check") && !cmd) {
  const p = checkPromo();
  console.log(p.length ? p.map((x) => `✕ ${x}`).join("\n") : `promo: ${TOTAL} s, ${LINES.length} lines, every figure found in its record`);
  process.exit(p.length ? 1 : 0);
}
if (cmd === "capture") await capture();
else if (cmd === "vo") await vo();
else if (cmd === "render") await render();
else if (cmd === "mix") mix();
else if (cmd === "stills") stills();
else { console.error("npm run promo -- --check | capture | vo | render [--vertical] [--draft] | mix [--vertical] | stills"); process.exit(1); }
