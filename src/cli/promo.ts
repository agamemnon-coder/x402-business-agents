// The promo film (13 Nov, src/film/promo.ts): capture the live pages, draw every frame, mix, cut stills.
//
//   npm run promo -- --check              every figure against its record, the timing, the words
//   npm run promo -- capture [try phone home cloud]   the live loops (seeked frame by frame) and the Cloud guest view
//   npm run promo -- sheet [--vertical]   self-critique contact sheets: the first 10 s every 0.5 s, the film every 3 s
//   npm run promo -- vo                   the narration from ElevenLabs (skips takes already in out/promo/vo/)
//   npm run promo -- render [--vertical]  out/promo/picture-{h,v}.mp4, silent, 60 fps
//   npm run promo -- mix [--vertical]     out/promo/purser-promo-{1080p,vertical}.mp4 at -14 LUFS, and the .srt
//   npm run promo -- stills               three PNG stills from the 1080p master
//
// Read-only on the live site: GETs, and the Cloud's read-only "Try as guest" (no company is made).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { measureFilter, normaliseFilter, parseMeasured, placeFilter, type Piece } from "../film/mix.js";
import { CUTS, FPS, LABELS, LINES, MUSIC_FROM, ROOT, SCENES, SFX, TOTAL, TRY_URL, VOICE, WALKTHROUGH_URL, checkPromo, promoData, promoSrt } from "../film/promo.js";
import { sfxTrack, wav } from "../film/sfx.js";

const OUT = resolve(ROOT, "out/promo");
const LIVE = resolve(OUT, "live");
const args = process.argv.slice(2);
const vertical = args.includes("--vertical");
const draft = args.includes("--draft");
const tag = vertical ? "v" : "h";

function gate() {
  const problems = checkPromo();
  if (problems.length) { console.error(problems.map((p) => `✕ ${p}`).join("\n")); process.exit(1); }
}

/** A page whose loop is CSS animations: paused and seeked to each frame, so the capture is exact at 60 fps. */
async function seekLoop(page: import("playwright").Page, dir: string, seconds: number, clip?: { x: number; y: number; width: number; height: number }) {
  mkdirSync(dir, { recursive: true });
  const loops = await page.evaluate(() => document.getAnimations().filter((a) => (a.effect?.getTiming().duration as number) >= 10000).length);
  if (!loops) throw new Error(`promo: ${page.url()} has no loop to seek`);
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); if ((a.effect?.getTiming().duration as number) >= 10000) a.currentTime = ms; } }, (i / FPS) * 1000);
    await page.screenshot({ path: resolve(dir, `${String(i).padStart(4, "0")}.jpg`), quality: 92, clip });
  }
  return frames;
}

/**
 * The live pages, read only: the /try loop (desktop, dark, for the cold open and the cent), the same loop on a phone
 * (for the phone frame), Home's hero loop in light mode (clipped to the hero card: the "Works with" marks are never in
 * frame), and Purser Cloud's guest view (its Agents and Invoices & books pages). `capture try phone home cloud`, or all.
 */
async function capture(only: string[]) {
  const want = (k: string) => !only.length || only.includes(k);
  const browser = await chromium.launch();
  const must = async (page: import("playwright").Page, texts: string[]) => {
    const shown = (await page.innerText("body")).replace(/\s+/g, " ");
    for (const t of texts) if (!shown.includes(t)) throw new Error(`promo: ${page.url()} does not show "${t}"`);
  };
  const open = async (o: Parameters<typeof browser.newContext>[0], url: string) => {
    const page = await (await browser.newContext(o)).newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  if (want("try")) {
    const page = await open({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 3, colorScheme: "dark" }, `https://${TRY_URL}`);
    await must(page, ["EUR 1,850.00", "EUR 1,850.01", "Refused: terms changed"]);
    console.log(`/try: ${await seekLoop(page, resolve(LIVE, "try"), 11, { x: 170, y: 340, width: 660, height: 440 })} frames`);
  }
  if (want("phone")) {
    const page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", isMobile: true, hasTouch: true }, `https://${TRY_URL}`);
    await must(page, ["EUR 1,850.00", "Test money"]);
    console.log(`/try on a phone: ${await seekLoop(page, resolve(LIVE, "phone"), 11)} frames`);
  }
  if (want("home")) {
    const page = await open({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "light" }, `https://${TRY_URL.replace("/try", "/")}`);
    const box = await page.evaluate(() => {
      const hero = [...document.querySelectorAll<HTMLElement>("*")].find((e) => e.innerText?.trim().startsWith("Invoice\nRead"));
      const r = hero?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    });
    if (!box) throw new Error("promo: Home's hero card was not found");
    console.log(`Home hero: ${await seekLoop(page, resolve(LIVE, "home"), 12, { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 })} frames`);
  }
  if (want("cloud")) {
    // Read only, made-up data; the guest session ends by itself after 15 minutes.
    const page = await open({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" }, "https://purser-try.max-31b.workers.dev/");
    await page.getByRole("button", { name: "Try as guest" }).click();
    await page.getByText("Net cash").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await must(page, ["Demo: made-up data", "Test money"]);
    await page.screenshot({ path: resolve(LIVE, "cloud.png"), fullPage: true });
    for (const [tab, file, text] of [["Agents", "cloud-agents.png", "Sourcing agent"], ["Invoices & books", "cloud-books.png", "Waits for Face ID"]] as const) {
      await page.getByRole("link", { name: tab }).first().click();
      await page.getByText(text).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(LIVE, file), fullPage: true });
    }
    console.log("cloud: overview, agents, invoices & books");
  }
  await browser.close();
  writeFileSync(resolve(LIVE, "captured.json"), JSON.stringify({ at: new Date().toISOString(), try: `https://${TRY_URL}`, home: `https://${TRY_URL.replace("/try", "/")}`, cloud: "https://purser-try.max-31b.workers.dev/ (Try as guest)" }, null, 2));
}

/** The narration, one take per line (ElevenLabs; the proxy injects the key, so curl, which uses it). Checks the credits first. */
function vo() {
  mkdirSync(resolve(OUT, "vo"), { recursive: true });
  const todo = LINES.filter((l) => !existsSync(resolve(OUT, "vo", `${l.id}.mp3`)));
  const need = todo.reduce((n, l) => n + l.words.length, 0);
  const curl = (url: string, extra: string[] = []) => execFileSync("curl", ["-sS", "--fail-with-body", "-H", "xi-api-key: proxy", ...extra, url], { maxBuffer: 1 << 26 });
  const sub = JSON.parse(curl("https://api.elevenlabs.io/v1/user/subscription").toString()) as { character_count: number; character_limit: number };
  const left = sub.character_limit - sub.character_count;
  if (!Number.isFinite(left)) throw new Error("promo: could not read the ElevenLabs credits");
  console.log(`${todo.length} takes, about ${need} credits; ${left} left`);
  if (need > left - 250) throw new Error("promo: not enough credits (250 are kept for another session)");
  for (const [i, l] of LINES.entries()) {
    if (!todo.includes(l)) continue;
    const body = JSON.stringify({ text: l.words, model_id: VOICE.model, previous_text: LINES[i - 1]?.words, next_text: LINES[i + 1]?.words, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } });
    writeFileSync(resolve(OUT, "vo", `${l.id}.mp3`), curl(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=mp3_44100_128`, ["-X", "POST", "-H", "content-type: application/json", "--data-binary", body]));
    console.log(l.id);
  }
}

const count = (dir: string) => (existsSync(resolve(LIVE, dir)) ? readdirSync(resolve(LIVE, dir)).filter((f) => f.endsWith(".jpg")).length : 0);

/** The page that draws the frames, booted with every figure from its record and the captured live frames. */
async function framePage(browser: import("playwright").Browser, layout: "h" | "v") {
  const frames = { try: count("try"), phone: count("phone"), home: count("home") };
  if (!frames.try || !frames.phone || !frames.home || !["cloud.png", "cloud-agents.png", "cloud-books.png"].every((f) => existsSync(resolve(LIVE, f))))
    throw new Error("promo: run `npm run promo -- capture` first");
  const page = await (await browser.newContext({ viewport: layout === "v" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  const boot = { data: promoData(), labels: LABELS, lines: LINES, scenes: SCENES, cuts: CUTS, total: TOTAL, url: TRY_URL, walkthrough: WALKTHROUGH_URL, live: `file://${LIVE}`, frames, fps: FPS, layout };
  await page.addInitScript((b) => { (window as unknown as { __boot: unknown }).__boot = b; }, boot);
  page.on("pageerror", (e) => { throw e; });
  await page.goto(`file://${resolve(ROOT, "src/film/promo.html")}`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/**
 * The self-critique sheets: the first 10 s at 0.5 s spacing and the whole film at 3 s spacing, drawn straight from the
 * page (no encode), into out/promo/sheet-{h,v}-{open,all}.jpg.
 */
async function sheets() {
  gate();
  const browser = await chromium.launch();
  const page = await framePage(browser, tag);
  for (const [name, times] of [["open", Array.from({ length: 20 }, (_, i) => i * 0.5)], ["all", Array.from({ length: Math.ceil(TOTAL / 3) }, (_, i) => i * 3 + 1)]] as const) {
    const dir = resolve(OUT, `sheet-${tag}-${name}`);
    mkdirSync(dir, { recursive: true });
    for (const t of times) { await page.evaluate(`window.__promo(${t})`); await page.screenshot({ path: resolve(dir, `${t.toFixed(1).padStart(5, "0")}.jpg`), type: "jpeg", quality: 70 }); }
    const cols = vertical ? 8 : 5, w = vertical ? 270 : 384, h = vertical ? 480 : 216;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", `${dir}/*.jpg`, "-vf", `scale=${w}:${h},tile=${cols}x${Math.ceil(times.length / cols)}:padding=4`, "-frames:v", "1", resolve(OUT, `sheet-${tag}-${name}.jpg`)]);
  }
  await browser.close();
  console.log(`sheets: out/promo/sheet-${tag}-open.jpg, sheet-${tag}-all.jpg`);
}

/** Every frame from promo.html, piped into x264. */
async function render() {
  gate();
  const out = resolve(OUT, `picture-${tag}.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "23" : "15", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((ok, no) => ff.on("close", (c) => (c ? no(new Error(`ffmpeg ${c}`)) : ok())));
  const browser = await chromium.launch();
  const page = await framePage(browser, tag);
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

/**
 * The voice at its times (src/film/mix.ts), the music take cut in at MUSIC_FROM and ducked under the voice by a
 * sidechain, the synthesised effects on their own bus (not ducked), two-pass loudnorm to -14 LUFS.
 */
function mix() {
  const picture = resolve(OUT, `picture-${tag}.mp4`), sfxFile = resolve(OUT, "sfx.wav");
  writeFileSync(sfxFile, wav(sfxTrack(SFX, TOTAL)));
  const voice: Piece[] = LINES.map((l) => ({ file: resolve(OUT, "vo", `${l.id}.mp3`), at: l.at }));
  for (const p of [picture, ...voice.map((v) => v.file), resolve(OUT, "music.mp3")]) if (!existsSync(p)) throw new Error(`promo: ${p} is missing`);
  const inputs = [picture, ...voice.map((v) => v.file), resolve(OUT, "music.mp3"), sfxFile].flatMap((f) => ["-i", f]);
  const m = voice.length + 1;
  const graph = `${placeFilter(voice, TOTAL).replace("[mix]", "[vo]")};[vo]asplit=2[vo1][key];`
    + `[${m}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${MUSIC_FROM},asetpts=PTS-STARTPTS,volume=-6dB,afade=t=out:st=${TOTAL - 2}:d=2,apad,atrim=duration=${TOTAL}[mus];`
    + `[mus][key]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=400:makeup=1[duck];`
    + `[${m + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.9[fx];`
    + `[vo1]volume=1.6[vo2];[vo2][duck][fx]amix=inputs=3:normalize=0:duration=first[mix]`;
  // loudnorm prints its measurement on stderr; ffmpeg is run directly, no shell.
  const measure = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...inputs, "-filter_complex", `${graph};[mix]${measureFilter()}[m]`, "-map", "[m]", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const measured = parseMeasured(measure.stderr);
  const file = resolve(OUT, vertical ? "purser-promo-vertical.mp4" : "purser-promo-1080p.mp4");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", `${graph};[mix]${normaliseFilter(measured)},alimiter=limit=0.7:attack=0.5:release=60:level=false,aresample=48000[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-t", String(TOTAL), "-movflags", "+faststart", file], { stdio: "inherit" });
  writeFileSync(resolve(OUT, "purser-promo.srt"), promoSrt());
  console.log(file);
}

function stills() {
  const master = resolve(OUT, "purser-promo-1080p.mp4");
  for (const [name, at] of [["still-1-phone", 14.2], ["still-2-metal", 35.6], ["still-3-end", 65.0]] as const)
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(at), "-i", master, "-frames:v", "1", resolve(OUT, `${name}.png`)]);
  console.log("stills: out/promo/still-*.png");
}

const cmd = args.find((a) => !a.startsWith("--"));
if (args.includes("--check") && !cmd) {
  const p = checkPromo();
  console.log(p.length ? p.map((x) => `✕ ${x}`).join("\n") : `promo: ${TOTAL} s, ${LINES.length} lines, every figure found in its record`);
  process.exit(p.length ? 1 : 0);
}
if (cmd === "capture") await capture(args.filter((a) => !a.startsWith("--") && a !== "capture"));
else if (cmd === "vo") vo();
else if (cmd === "render") await render();
else if (cmd === "sheet") await sheets();
else if (cmd === "mix") mix();
else if (cmd === "stills") stills();
else { console.error("npm run promo -- --check | capture | vo | render [--vertical] [--draft] | mix [--vertical] | stills"); process.exit(1); }
