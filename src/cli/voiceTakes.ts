// npm run voice-takes -- <dir> <voice id> <model> <id>=<text>... [--seeds 1,2]: renders each line with ElevenLabs'
// text-to-speech once per seed (cached: a take on disk is never rendered again) and scores every take by measurement:
// integrated loudness, loudness range and true peak (ffmpeg ebur128), pace in words a minute, and the longest pause.
// The film picks a line's take by these numbers (no clipping, steady loudness, natural pace). Not in git (out/).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const seeds = argv.includes("--seeds") ? argv[argv.indexOf("--seeds") + 1]!.split(",").map(Number) : [1];
const [dir, voice, model, ...lines] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--seeds");
const KEY = process.env.ELEVENLABS_API_KEY ?? "injected-by-proxy";

export interface Score { dur: number; wpm: number; I: number; LRA: number; TP: number; maxGap: number }

export function render(text: string, voiceId: string, modelId: string, seed: number, file: string): void {
  if (existsSync(file)) return;
  const body: Record<string, unknown> = { text, model_id: modelId, seed };
  if (modelId === "eleven_multilingual_v2") body.voice_settings = { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 0.97 };
  const code = execFileSync("curl", ["-sS", "-o", file, "-w", "%{http_code}", "-X", "POST", `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_192`, "-H", `xi-api-key: ${KEY}`, "-H", "content-type: application/json", "--data-binary", JSON.stringify(body)], { encoding: "utf8" }).trim();
  if (code !== "200") { const why = existsSync(file) ? execFileSync("head", ["-c", "300", file], { encoding: "utf8" }) : ""; execFileSync("rm", ["-f", file]); throw new Error(`TTS ${code}: ${why}`); }
}

export function score(file: string, text: string): Score {
  const e = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const last = (re: RegExp) => Number([...e.matchAll(re)].at(-1)![1]);
  const s = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=n=-40dB:d=0.35", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
  const gaps = [...s.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  return { dur: +dur.toFixed(2), wpm: Math.round(text.split(/\s+/).length / dur * 60), I: last(/I:\s+(-?[\d.]+) LUFS/g), LRA: last(/LRA:\s+([\d.]+) LU/g), TP: last(/Peak:\s+(-?[\d.]+) dBFS/g), maxGap: Math.max(0, ...gaps) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(dir!, { recursive: true });
  const all: Record<string, Score> = {};
  for (const l of lines) {
    const [id, text] = [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)];
    for (const sd of seeds) {
      const f = resolve(dir!, `${id}.s${sd}.mp3`);
      render(text, voice!, model!, sd, f);
      const r = (all[`${id}.s${sd}`] = score(f, text));
      console.log(`${id}.s${sd}  ${r.dur} s  ${r.wpm} wpm  I ${r.I}  LRA ${r.LRA}  TP ${r.TP}  pause ${r.maxGap}`);
    }
  }
  writeFileSync(resolve(dir!, "scores.json"), JSON.stringify(all, null, 1) + "\n");
}
