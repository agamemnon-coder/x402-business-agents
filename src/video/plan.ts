// The video (about three minutes): the voice-over script, the English subtitles and the shots, in one place, so the
// words and the pictures cannot drift apart. `npm run video` records every shot at 1920x1080, 60 fps (src/cli/video.ts); Max reads
// the script over the silent master.

import { FILM_SCENES, filmTimeline } from "../film/script.js";

export interface Action {
  /** Seconds from the start of the shot. */
  at: number;
  /** Move the cursor to the centre of the selector (highlighted), click it, zoom in on it (scrolling it into view), zoom out, or scroll to it. */
  do: "point" | "click" | "zoom" | "unzoom" | "scroll";
  target?: string;
  scale?: number;
}

export interface Shot {
  /** A path on the recording server (the same pages the relay and npm run judge serve, from the recordings). */
  path: string;
  seconds: number;
  actions?: Action[];
}

export interface Beat {
  id: string;
  title: string;
  /** What Max says. Plain, at most 150 words a minute. */
  voice: string;
  shots: Shot[];
}

/** The video is the film (src/film/), one shot per scene, each played from the second its scene starts. */
export const BEATS: Beat[] = filmTimeline().map((t, n) => {
  const scene = FILM_SCENES[n]!;
  return { id: `${String(n + 1).padStart(2, "0")}-${scene.id}`, title: scene.title, voice: scene.voice, shots: [{ path: `/film?manual&from=${t.start}`, seconds: t.seconds }] };
});

export const beatSeconds = (b: Beat) => b.shots.reduce((s, x) => s + x.seconds, 0);
export const totalSeconds = () => BEATS.reduce((s, b) => s + beatSeconds(b), 0);

const stamp = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** English subtitles: each beat's words in short lines, spread over the beat by length. */
export function subtitlesSrt(): string {
  const out: string[] = [];
  let t = 0, n = 1;
  for (const b of BEATS) {
    const len = beatSeconds(b);
    const sentences = b.voice.match(/[^.!?:]+[.!?:]+/g) ?? [b.voice];
    const chunks = sentences.flatMap((s) => {
      const words = s.trim().split(/\s+/);
      const parts: string[] = [];
      // At most 11 words a cue, split evenly: 12 words make two cues of 6, never one of 11 and one of 1.
      const size = Math.ceil(words.length / Math.ceil(words.length / 11));
      for (let i = 0; i < words.length; i += size) parts.push(words.slice(i, i + size).join(" "));
      return parts;
    });
    // A sentence of a word or two ("Watch.") joins the next line, so no cue blinks past.
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i]!.split(/\s+/).length < 3 && chunks.length > 1) {
        const j = i + 1 < chunks.length ? i + 1 : i - 1;
        chunks[j] = j > i ? `${chunks[i]} ${chunks[j]}` : `${chunks[j]} ${chunks[i]}`;
        chunks.splice(i, 1);
        i = -1;
      }
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    let at = t + 0.3;
    const usable = len - 0.6;
    for (const c of chunks) {
      const d = (c.length / total) * usable;
      out.push(`${n++}\n${stamp(at)} --> ${stamp(at + d - 0.05)}\n${c}\n`);
      at += d;
    }
    t += len;
  }
  return out.join("\n");
}

/** The script for Max to read, with the time each beat starts. */
export function scriptMarkdown(): string {
  let t = 0;
  const lines = [
    `# Purser: the video script (${Math.floor(totalSeconds() / 60)}:${String(totalSeconds() % 60).padStart(2, "0")})`, "",
    "Read it over the silent master (`master.mp4`). Each beat starts at the time shown; the subtitles (`subtitles.srt`) carry the same words.",
    `The words run at about ${Math.round(BEATS.reduce((n, b) => n + b.voice.split(/\s+/).length, 0) / (totalSeconds() / 60))} a minute: speak calmly, and take a breath at each heading. Record each beat on its own if that is easier; the clips have the same names.`, "",
  ];
  for (const b of BEATS) {
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    lines.push(`## ${m}:${String(s).padStart(2, "0")} ${b.title} (${beatSeconds(b)} s, clip \`${b.id}.mp4\`)`, "", b.voice, "");
    t += beatSeconds(b);
  }
  return lines.join("\n");
}
