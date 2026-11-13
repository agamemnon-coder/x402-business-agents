// npm run cut -- <submission-3 | walkthrough-5> [--draft] [--demo-day] [--vo <dir>] [--own <shot>=<file>[@<a>-<b>]]...
// npm run cut -- --check
// Assembles a film from its cut list (src/film/cuts.ts): each shot's clip from npm run capture (out/video/v9/shots/),
// the stills shown whole, the owner's footage where it is given and a placeholder card where it is not ("Max on
// camera", "phone recording"; portrait footage sits in the phone frame), the captions and badges burned in (ASS,
// src/film/captions.ts), the voice-over lines and Max's camera sound mixed and loudness-normalised (src/film/mix.ts).
// Writes to out/video/v9/: <file>.mp4 (1920x1080, 60 fps, H.264 + AAC), <file>.srt, cut-<n>.json, script-<n>.md and
// missing-<n>.txt (what is still a placeholder or not captured). Not in git.
//   --stills    the stills /watch shows, from the shot clips: src/film/stills/poster.webp (a frame of D1a, Home's
//               hero) and one thumbnail per chapter (its first shot's last frame), and nothing else
//   --docs <cut> the script table, the shot list and the .srt of a cut into docs/video/ (words only)
//   --check     the honesty and timing check of both cuts (and the Demo Day close), nothing rendered; exit 1 on a problem
//   --draft     x264 veryfast (a first look); the narration runs as a line at the bottom while there is no voice
//   --demo-day  the 3:00 with the Demo Day close (M2-DD) and the QR end card
//   --vo <dir>  <dir>/<row id>.wav for each voice-over row (s03.wav, w07.wav, ...)
//   --own M1=<file>@<a>-<b>   the owner's footage for M1, M2 (landscape) or P1a–P1d (portrait, in the phone frame)
// Stops before the first frame when less than 3 GB is free.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BAR, PHONE_BOX, PHONE_BOX_LB, assFile } from "../film/captions.js";
import { BG, FPS, guardDisk } from "../film/capture.js";
import { CUTS, checkCut, chapters, clock, resolveCut, scriptMarkdown, shotListMarkdown, srt, total, type Cut, type Placed } from "../film/cuts.js";
import { LIMITER, measureFilter, normaliseFilter, parseMeasured, placeFilter, type Piece } from "../film/mix.js";
import { OWN_FOOTAGE, shot as shotOf } from "../film/shots.js";
import { STILL_SHOTS } from "../film/stills.js";
import { maskExpr } from "../film/slots.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/v9");
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const draft = flag("--draft");

/** --own M1=<file>@<a>-<b>, any number of times. */
function ownArgs(): Map<string, { file: string; from: number; to?: number }> {
  const m = new Map<string, { file: string; from: number; to?: number }>();
  argv.forEach((a, i) => {
    if (a !== "--own") return;
    const x = /^(M1|M2|P1[a-d])=(.+?)(?:@(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?))?$/.exec(argv[i + 1] ?? "");
    if (!x) throw new Error(`cut: --own ${argv[i + 1]}: expected <M1|M2|P1a..P1d>=<file>[@<a>-<b>]`);
    m.set(x[1]!, { file: resolve(x[2]!), from: Number(x[3] ?? 0), to: x[4] ? Number(x[4]) : undefined });
  });
  return m;
}

const ff = (args: string[], cwd?: string) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"], cwd });
const ENC = draft ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "12"];
const SEG = [...ENC, "-pix_fmt", "yuv420p", "-r", String(FPS), "-an"];
const clipOf = (id: string) => resolve(out, "shots", `${id}.mp4`);

/** Film v10: the picture's dark navy (as film v8's) between black bars. */
const NAVY = "0x0a1020";
/**
 * Film v10's segment, letterboxed: black bars of 138 px, the picture between them. A page shot (captured at 1920x804)
 * fills the picture; a title card is the dark navy alone (its words are burned in with the captions); a recording sits
 * in the phone frame, its corners rounded, on the navy.
 */
function letterboxSegment(file: string, g: Placed["segs"][number]): string | null {
  const d = g.seconds.toFixed(3);
  const bars = `drawbox=x=0:y=0:w=1920:h=${BAR}:color=black:t=fill,drawbox=x=0:y=${1080 - BAR}:w=1920:h=${BAR}:color=black:t=fill`;
  const navy = ["-f", "lavfi", "-i", `color=c=${NAVY}:s=1920x1080:r=${FPS}:d=${d}`];
  if (g.title || g.card) { ff([...navy, "-vf", `${bars},format=yuv420p`, ...SEG, file]); return null; }
  if (g.rec) {
    const src = resolve(out, "recordings", `${g.rec}.mp4`);
    if (!existsSync(src)) { ff([...navy, "-vf", `${bars},format=yuv420p`, ...SEG, file]); return `recording ${g.rec} not made yet`; }
    const b = PHONE_BOX_LB;
    // The rounded masks are drawn once (geq per frame is slow) and looped.
    const mask = (w: number, h: number, r: number, f: string) => { if (!existsSync(f)) ff(["-f", "lavfi", "-i", `color=c=white:s=${w}x${h}:d=1`, "-frames:v", "1", "-vf", `format=gray,geq=lum='${maskExpr(r)}'`, f]); return f; };
    const m1 = mask(b.w, b.h, b.r, resolve(out, "mask-phone.png")), m2 = mask(b.w + 16, b.h + 16, b.r + 8, resolve(out, "mask-bezel.png"));
    ff([...navy, "-i", src, "-loop", "1", "-t", d, "-i", m1, "-f", "lavfi", "-i", `color=c=0x2a3346:s=${b.w + 16}x${b.h + 16}:d=${d}`, "-loop", "1", "-t", d, "-i", m2, "-filter_complex",
      `[1:v]fps=${FPS},scale=${b.w}:${b.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${b.w}:${b.h}:0:0,setsar=1,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,format=yuva420p[r];[2:v]fps=${FPS},format=gray[m];[r][m]alphamerge[rm];` +
      `[3:v]format=yuva420p[bz0];[4:v]fps=${FPS},format=gray[bm];[bz0][bm]alphamerge[bz];` +
      `[0:v][bz]overlay=${b.x - 8}:${b.y - 8}:shortest=1[v0];[v0][rm]overlay=${b.x}:${b.y}:eof_action=pass:shortest=1,${bars},format=yuv420p[v]`,
      "-map", "[v]", ...SEG, file]);
    return null;
  }
  const id = g.shot!.find((x) => existsSync(clipOf(x)));
  if (!id) { ff([...navy, "-vf", `${bars},format=yuv420p`, ...SEG, file]); return `${g.shot!.join(" / ")}: ${shotOf(g.shot![0]!).what}`; }
  ff(["-i", clipOf(id), "-vf", `fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,scale=1920:${1080 - 2 * BAR}:flags=lanczos,pad=1920:1080:0:${BAR}:color=black,setsar=1,fade=t=in:st=0:d=0.25,fade=t=out:st=${(g.seconds - 0.25).toFixed(3)}:d=0.25,format=yuv420p`, ...SEG, file]);
  return null;
}

/** One segment's picture, exactly `seconds` long, at 1920x1080 and 60 fps. Returns a note when it is a stand-in. */
function segment(file: string, g: Placed["segs"][number], own: ReturnType<typeof ownArgs>, letterbox = false): string | null {
  if (letterbox) return letterboxSegment(file, g);
  const d = g.seconds.toFixed(3);
  const blank = ["-f", "lavfi", "-i", `color=c=${BG}:s=1920x1080:r=${FPS}:d=${d}`];
  if (g.card) { ff([...blank, ...SEG, file]); return null; }
  if (g.own) {
    const f = own.get(g.own);
    if (!f) { ff([...blank, ...SEG, file]); return null; }
    const win = ["-ss", String(f.from), ...(f.to ? ["-to", String(f.to)] : []), "-i", f.file];
    if (g.own.startsWith("M")) ff([...win, "-vf", `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,setsar=1,format=yuv420p`, ...SEG, file]);
    else {
      const b = PHONE_BOX;
      ff([...blank, ...win, "-f", "lavfi", "-i", `color=c=white:s=${b.w}x${b.h}:d=${d}`, "-filter_complex",
        `[1:v]fps=${FPS},scale=${b.w}:${b.h}:force_original_aspect_ratio=increase,crop=${b.w}:${b.h},setsar=1,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,format=yuva420p[r];[2:v]format=gray,geq=lum='${maskExpr(b.r)}'[m];[r][m]alphamerge[rm];[0:v][rm]overlay=${b.x}:${b.y}:eof_action=pass,format=yuv420p[v]`,
        "-map", "[v]", ...SEG, file]);
    }
    return null;
  }
  const s = shotOf(g.shot![0]!);
  const still = g.shot!.map(shotOf).find((x) => x.still);
  if (still?.still) {
    // A still is shown whole, under the badge and above the caption, on the dark background: no pan (a pan crops a
    // screenshot's edges, and its words with them).
    ff(["-loop", "1", "-framerate", String(FPS), "-t", d, "-i", resolve(root, still.still), "-vf", `scale=1600:880:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2-20:color=${BG},setsar=1,format=yuv420p`, ...SEG, file]);
    return null;
  }
  const id = g.shot!.find((x) => existsSync(clipOf(x)));
  if (!id) { ff([...blank, ...SEG, file]); return `${g.shot!.join(" / ")}: ${s.what}`; }
  ff(["-i", clipOf(id), "-vf", `fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,setsar=1,format=yuv420p`, ...SEG, file]);
  return null;
}

function render(cut: Cut, demoDay: boolean): void {
  const placed = resolveCut(cut, { demoDay });
  const own = ownArgs();
  const voDir = opt("--vo");
  const name = `${cut.file}${demoDay ? "-demoday" : ""}`;
  const n = cut.id === "submission-3" ? "3" : cut.id === "handin-5" ? "handin" : cut.id === "handin-10" ? "v10" : "5";
  const build = resolve(out, "build", name);
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  guardDisk(out);
  const notes: { at: number; to: number; text: string }[] = [];
  const missing: string[] = [];
  const list: string[] = [];
  let k = 0;
  for (const p of placed) for (const g of p.segs) {
    const file = resolve(build, `${String(k++).padStart(3, "0")}.mp4`);
    const note = segment(file, g, own, cut.letterbox);
    if (note) { notes.push({ at: g.start, to: g.start + g.seconds, text: note }); missing.push(`${clock(g.start)} ${p.row.id} not captured: ${note}`); }
    if (g.own && !own.has(g.own)) missing.push(`${clock(g.start)} ${p.row.id} placeholder: ${g.own}, ${OWN_FOOTAGE[g.own]}`);
    list.push(`file '${file}'`);
    process.stdout.write(".");
  }
  const len = total(placed);
  writeFileSync(resolve(build, "list.txt"), list.join("\n") + "\n");
  const picture = resolve(build, "picture.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", resolve(build, "list.txt"), "-c", "copy", picture]);
  // Sound: the VO lines and Max's camera sound, placed.
  const pieces: Piece[] = [];
  for (const p of placed) {
    const at = p.start + (p.row.kind === "vo" ? 0.4 : 0);
    if (p.row.kind === "vo" && voDir && existsSync(resolve(voDir, `${p.row.id}.wav`))) pieces.push({ file: resolve(voDir, `${p.row.id}.wav`), at, seconds: p.seconds - 0.4 });
    for (const g of p.segs) { const f = g.own ? own.get(g.own) : undefined; if (f && g.own!.startsWith("M")) pieces.push({ file: f.file, at: g.start, seconds: g.seconds }); }
  }
  // --music <file>: one bed under the whole film, about 20 dB under the voice, faded in and out (film v10).
  const musicFile = opt("--music");
  if (musicFile && existsSync(resolve(musicFile))) pieces.push({ file: resolve(musicFile), at: 0, seconds: len, gain: -21, fade: 2.5 });
  const ass = resolve(build, "captions.ass");
  writeFileSync(ass, assFile(placed, { filled: new Set(own.keys()), draft: pieces.length === 0, notes, letterbox: cut.letterbox }));
  // An own camera file is trimmed to its window by its start (-ss) before it is placed.
  const inputsTrimmed = pieces.flatMap((p) => { const o = [...own.values()].find((x) => x.file === p.file); return o ? ["-ss", String(o.from), "-i", p.file] : ["-i", p.file]; });
  let audio = placeFilter(pieces, len);
  if (pieces.length) {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-i", picture, ...inputsTrimmed, "-filter_complex", `${audio};[mix]${measureFilter()}[o]`, "-map", "[o]", "-f", "null", "-"], { encoding: "utf8" });
    // A limiter after the loudness pass keeps the true peak under -1 dB after the AAC encode.
    audio = `${audio};[mix]${normaliseFilter(parseMeasured(r.stderr))},${LIMITER}[aout]`;
  } else audio = audio.replace("[mix]", "[aout]");
  const master = resolve(out, `${name}.mp4`);
  // The captions file is named relative to the build folder (ffmpeg runs there), so no path is quoted into the filter.
  ff(["-i", picture, ...inputsTrimmed, "-filter_complex", `[0:v]ass=captions.ass[v];${audio}`, "-map", "[v]", "-map", "[aout]",
    ...(draft ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"] : ["-c:v", "libx264", "-preset", "slow", "-crf", "16"]), "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-t", String(len), "-movflags", "+faststart", master], build);
  writeFileSync(resolve(out, `${name}.srt`), srt(placed));
  writeFileSync(resolve(out, `cut-${n}${demoDay ? "-demoday" : ""}.json`), JSON.stringify({ cut: cut.id, demoDay, seconds: len, chapters: chapters(placed), rows: placed.map((p) => ({ id: p.row.id, start: p.start, seconds: p.seconds, kind: p.row.kind, words: p.row.words, claims: p.row.claims, segs: p.segs.map((g) => ({ start: g.start, seconds: g.seconds, shot: g.shot ?? g.own ?? "card", caption: g.caption ?? null, badge: g.badge ?? null })) })) }, null, 2) + "\n");
  writeFileSync(resolve(out, `script-${n}${demoDay ? "-demoday" : ""}.md`), scriptMarkdown(cut, placed));
  writeFileSync(resolve(out, `missing-${n}${demoDay ? "-demoday" : ""}.txt`), missing.join("\n") + "\n");
  rmSync(build, { recursive: true, force: true });
  console.log(`\n${master} (${clock(len)})${missing.length ? `\n${missing.length} placeholders or missing shots: ${out}/missing-${n}${demoDay ? "-demoday" : ""}.txt` : ""}`);
}

/** /watch's stills: real frames of the shot clips (a still image as it is), small WebP files kept in the repository. */
function stills(): void {
  const dir = resolve(root, "src/film/stills");
  mkdirSync(dir, { recursive: true });
  const webp = (input: string[], vf: string, file: string) => ff([...input, "-frames:v", "1", "-vf", vf, "-c:v", "libwebp", "-quality", "72", "-compression_level", "6", resolve(dir, file)]);
  webp(["-ss", "7", "-i", clipOf("D1a")], "scale=1600:900:flags=lanczos", "poster.webp");
  const done: string[] = ["poster.webp"];
  for (const shot of STILL_SHOTS) {
    const s = shotOf(shot);
    const vf = "scale=480:270:force_original_aspect_ratio=decrease:flags=lanczos,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x0a0c11";
    if (s.still) webp(["-i", resolve(root, s.still)], vf, `${shot}.webp`);
    // A page frame is cropped to its middle (the content column, under the header) so its words read at card size.
    else if (existsSync(clipOf(shot))) webp(["-sseof", "-0.2", "-i", clipOf(shot)], `crop=iw*0.74:ih*0.74:iw*0.11:ih*0.07,${vf}`, `${shot}.webp`);
    else continue;
    done.push(`${shot}.webp`);
  }
  console.log(`${done.length} stills in src/film/stills/: ${done.join(", ")}`);
}

/** --docs <cut>: the script table, the shot list and the .srt into docs/video/ (words only; nothing is rendered). */
function docs(id: Cut["id"]): void {
  const cut = CUTS[id];
  const problems = checkCut(cut);
  if (problems.length) throw new Error(`cut: ${id} does not pass its check:\n${problems.join("\n")}`);
  const placed = resolveCut(cut);
  const dir = resolve(root, "docs/video");
  const base = id === "handin-10" ? "film-v10" : id.replace(/-\d+$/, "");
  writeFileSync(resolve(dir, `${base}-script.md`), scriptMarkdown(cut, placed));
  writeFileSync(resolve(dir, `${base}-shots.md`), shotListMarkdown(cut, placed));
  writeFileSync(resolve(dir, `${base}.srt`), srt(placed));
  console.log(`docs/video/${base}-script.md, ${base}-shots.md, ${base}.srt (${clock(total(placed))})`);
}

function main(): void {
  if (flag("--stills")) return stills();
  if (flag("--docs")) { const id = argv.find((a) => a in CUTS) as Cut["id"] | undefined; if (!id) throw new Error("cut: --docs needs a cut id"); return docs(id); }
  if (flag("--check")) {
    const problems = [...checkCut(CUTS["submission-3"]), ...checkCut(CUTS["submission-3"], { demoDay: true }).map((p) => `demo day: ${p}`), ...checkCut(CUTS["walkthrough-5"]), ...checkCut(CUTS["handin-5"]), ...checkCut(CUTS["handin-10"])];
    for (const c of Object.values(CUTS)) console.log(`${c.id}: ${clock(total(resolveCut(c)))}`);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log("Every row fits, every caption is short, every number is in its record.");
    return;
  }
  const id = argv.find((a) => a in CUTS) as Cut["id"] | undefined;
  if (!id) throw new Error(`cut: name a cut (${Object.keys(CUTS).join(", ")}) or --check`);
  const problems = checkCut(CUTS[id], { demoDay: flag("--demo-day") });
  if (problems.length) throw new Error(`cut: ${id} does not pass its check:\n${problems.join("\n")}`);
  render(CUTS[id], flag("--demo-day"));
}

main();
