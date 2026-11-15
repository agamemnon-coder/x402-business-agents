// npm run film-uth [-- --no-voice] [--music [--bed <file>]] [--still]: builds "Purser, under the hood" from src/film/uth.ts.
//   1. each card rendered at 1920x1080 (Playwright) from its HTML, every figure read from its record;
//   2. the narration, one line per scene, from ElevenLabs (the v10 narrator, src/film/narrator10.ts; the key comes from
//      the session's proxy or ELEVENLABS_API_KEY, never this repository); --no-voice: a silent draft;
//   3. each scene timed to its line (at least its minimum), its recording windows cut from out/video/uth (npm run
//      record-uth) and its cards shown for the time left, with short fades;
//   4. the captions: the narration's words as subtitles, burned in and written as docs/film/under-the-hood/captions.srt;
//   5. the mix: the voice, and with --music a quiet instrumental bed (ElevenLabs music), loudness-normalised.
// The short cut (3:29, ORDER in src/film/uth.ts; the 4:38 voiced film is kept as committed in 9dcba896). Writes out/video/uth/under-the-hood-short.mp4 (1920x1080, 30 fps, H.264 + AAC), docs/film/under-the-hood/script.md and the
// .srt. Test money only; the film says so on screen.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { VOICE_10, spoken } from "../film/narrator10.js";
import { cardPage, facts, scenes, type Scene } from "../film/uth.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/uth");
const docs = resolve(root, "docs/film/under-the-hood");
const argv = process.argv.slice(2);
const KEY = process.env.ELEVENLABS_API_KEY ?? "injected-by-proxy";
const FPS = 30;
const LEAD = 0.6;
/** The live pages are laid out for 1920 px with their content in the middle: the film shows that middle, larger. */
const ZOOM = "crop=1360:765:280:20";
const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 });
const dur = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

function post(path: string, body: unknown, file: string): void {
  const code = execFileSync("curl", ["-sS", "-o", file, "-w", "%{http_code}", "-X", "POST", `https://api.elevenlabs.io${path}`, "-H", `xi-api-key: ${KEY}`, "-H", "content-type: application/json", "--data-binary", JSON.stringify(body)], { encoding: "utf8" }).trim();
  if (code !== "200") throw new Error(`film-uth: ElevenLabs ${code} on ${path}`);
}

function voice(s: Scene): string {
  const wav = resolve(out, "vo", `${s.id}.wav`);
  if (existsSync(wav) && !argv.includes("--revoice")) return wav;
  const mp3 = wav.replace(/\.wav$/, ".mp3");
  post(`/v1/text-to-speech/${VOICE_10.id}?output_format=mp3_44100_128`, { text: spoken(s.vo), model_id: VOICE_10.model, voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 0.97 } }, mp3);
  ff(["-i", mp3, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,aformat=sample_rates=48000:channel_layouts=stereo", wav]);
  return wav;
}

const ts = (t: number) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** A line's subtitles: its sentences (long ones split at a comma), timed by their length across the voice. */
function cues(text: string, start: number, length: number, voFile?: string): { from: number; to: number; text: string }[] {
  const parts = text.match(/[^.!?]+[.!?]+/g)?.map((x) => x.trim()) ?? [text];
  const pieces = parts.flatMap((p) => (p.length > 90 ? p.split(/(?<=,) /).reduce<string[]>((acc, w) => { const last = acc.at(-1); if (last && (last + " " + w).length < 90) acc[acc.length - 1] = `${last} ${w}`; else acc.push(w); return acc; }, []) : [p]));
  const total = pieces.reduce((n, p) => n + p.length, 0);
  // Each boundary between two cues moves to the nearest pause the voice really makes (within 1.2 s), so a caption changes
  // when the narrator does; the pauses are read from the voice file itself.
  const pauses = voFile ? [...spawnSync("ffmpeg", ["-hide_banner", "-i", voFile, "-af", "silencedetect=n=-38dB:d=0.16", "-f", "null", "-"], { encoding: "utf8" }).stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => (Number(m[1]) + Number(m[2])) / 2) : [];
  const bounds: number[] = [];
  let acc = 0;
  for (const p of pieces.slice(0, -1)) {
    acc += (p.length / total) * length;
    const near = pauses.filter((x) => Math.abs(x - acc) <= 1.2 && x > (bounds.at(-1) ?? 0) + 0.8).sort((a, b) => Math.abs(a - acc) - Math.abs(b - acc))[0];
    bounds.push(near ?? acc);
  }
  snapped.push(...bounds.map((b, i) => ({ snapped: pauses.includes(b), moved: +(b - pieces.slice(0, i + 1).reduce((n, p) => n + (p.length / total) * length, 0)).toFixed(2) })));
  const edges = [0, ...bounds, length];
  return pieces.map((p, i) => ({ from: start + edges[i]!, to: start + edges[i + 1]!, text: p }));
}
const snapped: { snapped: boolean; moved: number }[] = [];

async function main(): Promise<void> {
  // --still: the film's strongest frame (the passkey's assertion, scene u03) at 2560x1440, for the hand-in.
  if (argv.includes("--still")) {
    const s = scenes().find((x) => x.id === "u03")!;
    const g = s.segments.find((x) => "card" in x) as { card: string };
    const b = await chromium.launch();
    const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 4 / 3 })).newPage();
    await p.setContent(cardPage(g.card, `file://${resolve(root, "src/ui/inter.woff2")}`), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    mkdirSync(docs, { recursive: true });
    await p.screenshot({ path: resolve(docs, "still-1440p.png") });
    await b.close();
    return;
  }
  mkdirSync(resolve(out, "cards"), { recursive: true });
  mkdirSync(resolve(out, "vo"), { recursive: true });
  mkdirSync(resolve(out, "scenes"), { recursive: true });
  mkdirSync(docs, { recursive: true });
  const all = scenes();
  const f = facts();
  // 1. Cards.
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  const font = `file://${resolve(root, "src/ui/inter.woff2")}`;
  for (const s of all) for (const [i, g] of s.segments.entries()) if ("card" in g) {
    await page.setContent(cardPage(g.card, font), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, "cards", `${s.id}-${i}.png`) });
  }
  await browser.close();
  // 2. Voice.
  const silent = argv.includes("--no-voice");
  const vo = Object.fromEntries(all.map((s) => [s.id, silent ? null : voice(s)]));
  // 3. Scenes.
  const srt: string[] = [];
  const rows: string[] = [];
  let at = 0;
  const parts: string[] = [];
  for (const s of all) {
    const voLen = vo[s.id] ? dur(vo[s.id]!) : s.vo.split(/\s+/).length / 2.6;
    const clips = s.segments.filter((g) => !("card" in g)) as { clip: string; from: number; to: number; hold?: number }[];
    const clipLen = clips.reduce((n, c) => n + Math.max(0.5, Math.min(c.to, dur(resolve(out, `${c.clip}.mp4`))) - c.from) + (c.hold ?? 0), 0);
    const cards = s.segments.filter((g) => "card" in g).length;
    const length = Math.max(s.min, voLen + LEAD + 1.0, clipLen + cards * 4);
    const perCard = cards ? (length - clipLen) / cards : 0;
    const segs: string[] = [];
    for (const [i, g] of s.segments.entries()) {
      const file = resolve(out, "scenes", `${s.id}-${i}.mp4`);
      if ("card" in g) {
        ff(["-loop", "1", "-framerate", String(FPS), "-t", perCard.toFixed(3), "-i", resolve(out, "cards", `${s.id}-${i}.png`), "-vf", `format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=${(perCard - 0.35).toFixed(3)}:d=0.35`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS), file]);
      } else {
        const src = resolve(out, `${g.clip}.mp4`);
        const to = Math.min(g.to, dur(src));
        // A scene of clips only is held on its last clip's last frame until the voice is done.
        const pad = !cards && i === s.segments.length - 1 ? Math.max(0, length - clipLen) : 0;
        const hold = (g.hold ?? 0) + pad;
        const len = Math.max(0.5, to - g.from) + hold;
        ff(["-ss", g.from.toFixed(3), "-t", Math.max(0.5, to - g.from).toFixed(3), "-i", src, "-vf", `${ZOOM},scale=1920:1080:flags=lanczos,fps=${FPS}${hold ? `,tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}` : ""},format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st=${(len - 0.3).toFixed(3)}:d=0.3`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", file]);
      }
      segs.push(file);
    }
    const sceneFile = resolve(out, "scenes", `${s.id}.mp4`);
    writeFileSync(resolve(out, "scenes", `${s.id}.txt`), segs.map((x) => `file '${x}'`).join("\n") + "\n");
    ff(["-f", "concat", "-safe", "0", "-i", resolve(out, "scenes", `${s.id}.txt`), "-c", "copy", sceneFile]);
    const real = dur(sceneFile);
    for (const c of cues(s.vo, at + LEAD, voLen, vo[s.id] ?? undefined)) srt.push(`${srt.length + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`);
    rows.push(`| ${clock(at)} | ${s.id} · ${s.title} | ${s.vo.replace(/\|/g, "/")} | ${s.segments.map((g) => ("card" in g ? "card" : `${g.clip} ${g.from.toFixed(1)}–${g.to.toFixed(1)} s`)).join(" + ")}${s.note ? ` · ${s.note}` : ""} |`);
    parts.push(JSON.stringify({ id: s.id, at, length: real, vo: vo[s.id] }));
    at += real;
  }
  writeFileSync(resolve(out, "film.txt"), all.map((s) => `file '${resolve(out, "scenes", `${s.id}.mp4`)}'`).join("\n") + "\n");
  const picture = resolve(out, "picture.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", resolve(out, "film.txt"), "-c", "copy", picture]);
  writeFileSync(resolve(docs, "captions-short.srt"), srt.join("\n"));
  // 4 and 5. Subtitles burned in; the voice placed at each scene's start, a bed under it with --music.
  const placed = parts.map((p) => JSON.parse(p) as { id: string; at: number; vo: string | null });
  const inputs: string[] = ["-i", picture];
  const filters: string[] = [];
  const mixes: string[] = [];
  for (const p of placed) if (p.vo) { inputs.push("-i", p.vo); const k = inputs.filter((x) => x === "-i").length - 1; filters.push(`[${k}:a]adelay=${Math.round((p.at + LEAD) * 1000)}|${Math.round((p.at + LEAD) * 1000)}[v${k}]`); mixes.push(`[v${k}]`); }
  const total = at;
  if (argv.includes("--music")) {
    // The bed: --bed <file> (an instrumental already made, e.g. the v10 film's ElevenLabs music), else out/video/uth/music.mp3,
    // made by ElevenLabs music when it is not there yet.
    const bed = argv.includes("--bed") ? resolve(root, argv[argv.indexOf("--bed") + 1]!) : resolve(out, "music.mp3");
    if (!existsSync(bed)) post("/v1/music?output_format=mp3_44100_128", { prompt: "Calm, minimal, precise ambient instrumental for a technical fintech explainer: soft sustained synth pads, a slow clean pulse, subtle glassy textures, no drums, no vocals, steady and trustworthy; it sits quietly under a narrator.", music_length_ms: Math.min(300_000, Math.ceil(total + 4) * 1000), model_id: "music_v1", force_instrumental: true }, bed);
    inputs.push("-i", bed); const k = inputs.filter((x) => x === "-i").length - 1;
    filters.push(`[${k}:a]volume=0.10,afade=t=in:st=0:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3,atrim=0:${total.toFixed(2)}[bed]`); mixes.push("[bed]");
  }
  const style = "FontName=Inter,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H22000000,BackColour=&H22000000,BorderStyle=3,Outline=6,Shadow=0,MarginV=36,Alignment=2";
  const subs = `subtitles=${resolve(docs, "captions-short.srt")}:fontsdir=${resolve(root, "src/ui")}:force_style='${style}'`;
  const film = resolve(out, "under-the-hood-short.mp4");
  if (mixes.length) {
    filters.push(`${mixes.join("")}amix=inputs=${mixes.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(2)},loudnorm=I=${silent ? -26 : -16}:TP=-1.5:LRA=11[a]`); // without a voice the bed alone stays quiet
    ff([...inputs, "-filter_complex", `[0:v]${subs}[v];${filters.join(";")}`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", film]);
  } else {
    ff(["-i", picture, "-vf", subs, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", film]);
  }
  // The script, with its sources.
  const md = [`# Purser, under the hood, short cut (${clock(total)})`, "", `Built by \`npm run film-uth\` from \`src/film/uth.ts\`; every figure on screen is read from its record at build time. Test money only. ${silent ? `This build has no voice (captions only); the narrator for the voiced build: ${VOICE_10.name} (an AI voice).` : `Narrator: ${VOICE_10.name} (an AI voice).`}${argv.includes("--music") ? ` Music: an AI-generated instrumental (ElevenLabs)${argv.includes("--bed") ? `, ${argv[argv.indexOf("--bed") + 1]}` : ""}.` : ""}`, "", "| At | Scene | Narration (and the captions) | On screen |", "|---|---|---|---|", ...rows, "", "## Sources", "",
    `- The live /try walk, ${f.rec.recorded_at}: \`docs/film/under-the-hood/record.json\` (npm run record-uth): the terms' SHA-256 \`${f.rec.terms.terms_sha256}\`, the passkey's assertion (challenge = that hash, flags ${f.rec.assertion.authenticator_data.flags_byte}), the one-cent refusal (\`${f.refused.sent_sha256}\`), the replay (paid once). Recorded with a virtual test passkey, not a person's Face ID.`,
    `- The Airwallex transfer of the main run (3 Nov), read back with GET only on ${f.xferReadAt.slice(0, 10)}: \`docs/runs/airwallex-transfer-approval-2026-11-06.json\`; P-0005's passkey approval with the same hash: \`docs/demo/main-run.json\`.`,
    `- The reconciliation (${f.reconFlows} money flows, no differences) and the main-run figures (${f.decisions} decisions by Claude, ${f.alta} Alta payments within the limits, ${f.faceId} Face ID signatures, ${f.stops} stops and nothing paid over a limit): \`docs/demo/main-run.json\`, \`docs/claims.md\`.`,
    "- The card decline (recorded, awx-1, 7 Nov): `docs/demo/airwallex-run.json`, card transaction `01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38`.",
    `- The anchor: \`${f.anchorFile}\`, checked live by \`npm run verify-anchor\` (output in \`docs/film/under-the-hood/verify-anchor.txt\`).`,
    `- The test count (${f.tests}): README.md.`, "- The Purser Cloud clip: the demo company's Agents tab as a guest (made-up data, read only).", ""].join("\n");
  writeFileSync(resolve(docs, "script-short.md"), md);
  if (snapped.length) console.log(`captions: ${snapped.filter((x) => x.snapped).length} of ${snapped.length} cue changes on a pause in the voice; largest move ${Math.max(...snapped.map((x) => Math.abs(x.moved))).toFixed(2)} s`);
  console.log(`under-the-hood-short.mp4: ${clock(total)} (${total.toFixed(1)} s), ${(Number(execFileSync("stat", ["-c%s", film], { encoding: "utf8" })) / 1e6).toFixed(1)} MB`);
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });
