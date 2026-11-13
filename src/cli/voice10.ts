// npm run voice10 [-- <row id>...] [--music]: film v10's narration, one WAV per voice-over row of the cut handin-10
// (src/film/cuts.ts), from ElevenLabs' text-to-speech, into out/video/v10/vo/<row id>.wav (48 kHz stereo), and with
// --music one soft instrumental bed for the whole film (ElevenLabs music) into out/video/v10/music.mp3. Not in git.
// The key is never in this repository: ELEVENLABS_API_KEY from the environment, or, in a session whose proxy injects
// the key for api.elevenlabs.io, a placeholder the proxy replaces. Prints each line's length against its row's seconds;
// a line longer than its row minus the lead stops the run (shorten the words, or give the row more seconds).
// The words spoken are the row's words, with only the spellings below changed so the voice says them as written.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HANDIN10, VO_LEAD, resolveCut, total } from "../film/cuts.js";
import { VOICE_10, spoken } from "../film/narrator10.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, process.env.VIDEO_OUT ?? "out/video/v10");
const argv = process.argv.slice(2);
const KEY = process.env.ELEVENLABS_API_KEY ?? "injected-by-proxy";
const seconds = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

/** A POST to ElevenLabs through curl (curl honours the session's HTTPS proxy, which holds the key), the body to `file`. */
function post(path: string, body: unknown, file: string): void {
  const code = execFileSync("curl", ["-sS", "-o", file, "-w", "%{http_code}", "-X", "POST", `https://api.elevenlabs.io${path}`, "-H", `xi-api-key: ${KEY}`, "-H", "content-type: application/json", "--data-binary", JSON.stringify(body)], { encoding: "utf8", maxBuffer: 1 << 20 }).trim();
  if (code !== "200") throw new Error(`voice10: ElevenLabs ${code} on ${path}`);
}

async function tts(text: string, file: string): Promise<void> {
  const mp3 = file.replace(/\.wav$/, ".mp3");
  post(`/v1/text-to-speech/${VOICE_10.id}?output_format=mp3_44100_128`, { text, model_id: VOICE_10.model, voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 0.97 } }, mp3);
  // A short silence trimmed from the start, 48 kHz stereo for the mix.
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,aformat=sample_rates=48000:channel_layouts=stereo", file]);
}

async function music(len: number): Promise<void> {
  const prompt = "Soft, calm, minimal ambient instrumental for a fintech product film: warm sustained pads, a slow gentle piano motif, light pulse, no drums in the first half, a subtle lift in the middle, resolving calmly at the end. No vocals. Understated, trustworthy, spacious, never busy; it sits under a narrator.";
  post("/v1/music?output_format=mp3_44100_128", { prompt, music_length_ms: Math.min(300_000, Math.ceil(len + 6) * 1000), model_id: "music_v1", force_instrumental: true }, resolve(out, "music.mp3"));
  console.log(`music.mp3: ${seconds(resolve(out, "music.mp3")).toFixed(1)} s`);
}

async function main(): Promise<void> {
  const placed = resolveCut(HANDIN10);
  const dir = resolve(out, "vo");
  mkdirSync(dir, { recursive: true });
  if (argv.includes("--music")) return music(total(placed));
  const only = argv.filter((a) => !a.startsWith("--"));
  const report: string[] = [];
  let bad = 0;
  for (const p of placed) {
    if (p.row.kind !== "vo" || (only.length && !only.includes(p.row.id))) continue;
    const file = resolve(dir, `${p.row.id}.wav`);
    // A line is voiced again when its words change (its spoken text is kept beside it), or when it is named.
    const said = resolve(dir, `${p.row.id}.txt`), text = spoken(p.row.words);
    if (!existsSync(file) || only.includes(p.row.id) || !existsSync(said) || readFileSync(said, "utf8") !== text) { await tts(text, file); writeFileSync(said, text); }
    const d = seconds(file), room = p.seconds - VO_LEAD - 0.3;
    if (d > room) bad++;
    report.push(`${p.row.id}  ${d.toFixed(2)} s of ${room.toFixed(1)} s${d > room ? "  TOO LONG" : ""}`);
  }
  console.log(report.join("\n"));
  writeFileSync(resolve(dir, "voice.json"), JSON.stringify({ voice: VOICE_10, at: new Date().toISOString(), lines: report }, null, 2) + "\n");
  if (bad) process.exit(1);
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });
