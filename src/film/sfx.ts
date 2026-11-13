// The promo's sound effects, synthesised in code (no stock audio): whooshes on the cuts, an impact under each stamp,
// ticks for digits and flips, a card swipe, and a sub-bass boom on the mark. sfxTrack() places every SFX of the cut
// (src/film/promo.ts) on one stereo track the length of the film; wav() writes it as 16-bit PCM for the mix.

import type { SfxKind } from "./promo.js";

export const RATE = 48000;

/** A seeded noise source, so the same cut always sounds the same. */
function noise(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) * 2 - 1; };
}

/** One effect as [left, right] samples. */
export function effect(kind: SfxKind, seed = 1): [Float32Array, Float32Array] {
  const len = { whoosh: 0.55, impact: 1.6, stamp: 0.4, tick: 0.07, swipe: 0.4, boom: 2.6 }[kind];
  const n = Math.round(len * RATE), L = new Float32Array(n), R = new Float32Array(n), rnd = noise(seed * 7919 + kind.length);
  let lp = 0, lp2 = 0, ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, u = t / len;
    let l = 0, r = 0;
    if (kind === "whoosh" || kind === "swipe") {
      // Noise through a low-pass whose cutoff rises and falls; panned across.
      const env = Math.sin(Math.PI * Math.min(1, u)) ** (kind === "swipe" ? 1.2 : 2);
      const cut = kind === "swipe" ? 0.04 + 0.5 * u : 0.02 + 0.25 * Math.sin(Math.PI * u);
      lp += cut * (rnd() - lp); lp2 += cut * (lp - lp2);
      const v = (lp - 0.6 * lp2) * env * (kind === "swipe" ? 2.2 : 3.2);
      const pan = kind === "swipe" ? 0.5 : u;
      l = v * Math.cos(pan * Math.PI / 2); r = v * Math.sin(pan * Math.PI / 2);
    } else if (kind === "impact" || kind === "boom") {
      // A falling sine for the body, a noise burst for the hit.
      const f = kind === "boom" ? 48 * (1 - 0.35 * Math.min(1, t / 0.8)) : 70 * (1 - 0.45 * Math.min(1, t / 0.35));
      ph += (2 * Math.PI * f) / RATE; ph2 += (2 * Math.PI * f * 2.01) / RATE;
      const body = (Math.sin(ph) + 0.25 * Math.sin(ph2)) * Math.exp(-t / (kind === "boom" ? 0.9 : 0.42));
      lp += 0.3 * (rnd() - lp);
      const hit = lp * Math.exp(-t / 0.045) * 1.8;
      l = r = (body * 0.95 + hit) * Math.min(1, t / 0.002);
    } else if (kind === "stamp") {
      ph += (2 * Math.PI * (140 - 60 * Math.min(1, t / 0.08))) / RATE;
      const thud = Math.sin(ph) * Math.exp(-t / 0.07);
      const click = (rnd() - lp) * Math.exp(-t / 0.012); lp = rnd() * 0.5;
      l = r = (thud * 0.9 + click * 0.7) * Math.min(1, t / 0.001);
    } else if (kind === "tick") {
      ph += (2 * Math.PI * 2400) / RATE;
      const v = (Math.sin(ph) * 0.6 + rnd() * 0.25) * Math.exp(-t / 0.008);
      l = v * 0.9; r = v;
    }
    L[i] = l; R[i] = r;
  }
  return [L, R];
}

/** Every effect of the cut on one stereo track of `seconds`. */
export function sfxTrack(cues: readonly { at: number; kind: SfxKind; gain?: number }[], seconds: number): [Float32Array, Float32Array] {
  const n = Math.round(seconds * RATE), L = new Float32Array(n), R = new Float32Array(n);
  cues.forEach((c, k) => {
    const [l, r] = effect(c.kind, k + 1), at = Math.round(c.at * RATE), g = (c.gain ?? 1) * 0.5;
    for (let i = 0; i < l.length && at + i < n; i++) { L[at + i]! += l[i]! * g; R[at + i]! += r[i]! * g; }
  });
  return [L, R];
}

/** 16-bit stereo PCM WAV. */
export function wav([L, R]: [Float32Array, Float32Array]): Buffer {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  const s = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { b.writeInt16LE(s(L[i]!), 44 + i * 4); b.writeInt16LE(s(R[i]!), 46 + i * 4); }
  return b;
}
