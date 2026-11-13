// The sound of a cut (the plan's F.2 and V5): each voice-over line as its own WAV, placed at its row's start plus the
// lead, Max's own camera sound under his rows, then a two-pass loudnorm to -14 LUFS with a true peak of -1 dB, AAC
// 320 kb/s. Without any sound file the master gets a silent track (a draft whose narration runs as a line on screen).

export interface Piece { file: string; at: number; /** Trim the file to this long (seconds), from its start. */ seconds?: number; /** A level change in dB (film v10's music bed). */ gain?: number; /** Fade in and out over this many seconds. */ fade?: number }

export const LOUDNESS = { I: -14, TP: -1, LRA: 11 } as const;

/** The filter that places every piece (inputs 1..n; input 0 is the picture) and joins them into [mix]. */
export function placeFilter(pieces: Piece[], total: number): string {
  if (!pieces.length) return `anullsrc=r=48000:cl=stereo,atrim=duration=${total}[mix]`;
  const parts = pieces.map((p, i) => {
    const ms = Math.round(p.at * 1000);
    const fade = p.fade && p.seconds ? `afade=t=in:d=${p.fade},afade=t=out:st=${Math.max(0, p.seconds - p.fade)}:d=${p.fade},` : "";
    return `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,${p.seconds ? `atrim=duration=${p.seconds},` : ""}${fade}${p.gain ? `volume=${p.gain}dB,` : ""}adelay=${ms}|${ms}[a${i}]`;
  });
  return `${parts.join(";")};${pieces.map((_, i) => `[a${i}]`).join("")}amix=inputs=${pieces.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${total}[mix]`;
}

/** The first loudnorm pass: measure only (its JSON is read from ffmpeg's log). */
export const measureFilter = () => `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`;

export interface Measured { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }
/** The JSON block loudnorm prints at the end of its log. */
export function parseMeasured(log: string): Measured {
  const m = /\{\s*"input_i"[\s\S]*?\}/.exec(log);
  if (!m) throw new Error("film: loudnorm printed no measurement");
  return JSON.parse(m[0]) as Measured;
}
/** The second pass: normalise with the measured values, linear when possible. */
export const normaliseFilter = (m: Measured) => `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;

/** After the loudness pass: a limiter at -3 dBFS sample peak (AAC adds overshoot), then +0.6 dB: about -14.3 LUFS with the true peak near -1.2 dB, so the true peak stays under -1 dB once encoded (film v10). */
export const LIMITER = "alimiter=limit=0.7:attack=1:release=50:level=disabled,volume=0.6dB";
