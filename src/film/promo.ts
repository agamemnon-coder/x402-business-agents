// The promo film (13 Nov), v2: 66.5 seconds, separate from the walkthrough, cut to the beat. A cold open on a live
// refusal, the mark drawn on the music's drop, the product recorded from the live pages, a proof montage where every
// partner moment is an event, a split-screen payoff, and the end card. Read by an AI-generated female narrator
// (ElevenLabs, a premade library voice) over AI-generated music (ElevenLabs, one take, re-cut here), with sound
// effects synthesised in code (src/film/sfx.ts). Every figure on screen is read from its record here, before a frame
// is drawn: a string that is not found in its record stops the render (checkPromo). The zero-trust and hostile-model
// counts are read from their JSON reports, never typed. The scenes are drawn by src/film/promo.html.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FILM_URL } from "../config/brand.js";

export const ROOT = resolve(import.meta.dirname, "../..");
export const TRY_URL = "kit11.max-31b.workers.dev/try";
/** The walkthrough on YouTube, as the site links it (src/config/brand.ts FILM_URL), without its scheme. */
export const WALKTHROUGH_URL = FILM_URL.replace(/^https:\/\//, "");
export const TOTAL = 66.5;
export const FPS = 60;
/**
 * The music take (72 s) is cut in at this point: the film starts 4.6 s into it, so its drop (10.0 s in the take) lands
 * on the mark at 5.4 s, its quiet bars (60–65 s) under the payoff, and its last hit (65.7 s) on the end card at 61.1 s.
 */
export const MUSIC_FROM = 4.6;
/** The narrator: ElevenLabs premade library voice "Lily" (no clone, no imitation of anyone). */
export const VOICE = { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (ElevenLabs premade voice)", model: "eleven_multilingual_v2" } as const;

/**
 * One line of narration: its id (the MP3's name), its words, where it starts, and how long its speech runs (measured;
 * r6's take ends in 0.6 s of silence, not counted).
 */
export interface Line { id: string; words: string; at: number; dur: number }

export const LINES: readonly Line[] = [
  { id: "n1", at: 2.6, dur: 2.05, words: "A limit in a prompt is only a request." },
  { id: "a1", at: 5.6, dur: 1.02, words: "Purser." },
  { id: "a2", at: 8.4, dur: 6.92, words: "Agents propose. The CFO signs the exact terms, with Face ID or a passkey." },
  { id: "a3", at: 15.8, dur: 2.4, words: "Then the payment rails enforce the limit, again." },
  { id: "a4", at: 18.6, dur: 2.27, words: "Two locks. One signature." },
  { id: "r0", at: 21.4, dur: 1.67, words: "Don't take our word for it." },
  { id: "r2", at: 23.6, dur: 3.47, words: "A charge over the card limit? Airwallex declined it." },
  { id: "r3", at: 27.5, dur: 3.94, words: "A payout, held in approval, until the owner said yes." },
  { id: "r4", at: 31.9, dur: 5.02, words: "Over the agent's cap? Metal refused it. On chain." },
  { id: "r5", at: 37.3, dur: 2.53, words: "The audit chain, anchored on chain." },
  { id: "r6", at: 40.2, dur: 3.68, words: "Fifty-three attacks. Money moved: zero." },
  { id: "r7", at: 44.3, dur: 5.69, words: "A hostile model. Three hundred and eighty tool calls. Zero unsafe." },
  { id: "c1", at: 55.6, dur: 3.66, words: "Your agents do the work. Your CFO signs the exceptions." },
  { id: "c2", at: 61.1, dur: 1.91, words: "Purser. Try it yourself." },
];

export interface Scene { id: string; from: number; to: number }
export const SCENES: readonly Scene[] = [
  { id: "cold", from: 0, to: 5.2 },
  { id: "logo", from: 5.2, to: 8.2 },
  { id: "propose", from: 8.2, to: 11.6 },
  { id: "phone", from: 11.6, to: 15.4 },
  { id: "agents", from: 15.4, to: 18.4 },
  { id: "locks", from: 18.4, to: 21.3 },
  { id: "word", from: 21.3, to: 23.4 },
  { id: "card", from: 23.4, to: 27.3 },
  { id: "payout", from: 27.3, to: 31.7 },
  { id: "metal", from: 31.7, to: 37.1 },
  { id: "anchor", from: 37.1, to: 40.1 },
  { id: "attacks", from: 40.1, to: 44.2 },
  { id: "hostile", from: 44.2, to: 50.4 },
  { id: "recap", from: 50.4, to: 55.4 },
  { id: "payoff", from: 55.4, to: 61.0 },
  { id: "end", from: 61.0, to: TOTAL },
];

/**
 * The cuts inside a scene: at each, the camera jumps to a new framing (a hard cut with a whoosh), so no shot after the
 * opening runs longer than 3 s, apart from the one calm beat on "Your CFO signs the exceptions".
 */
export const CUTS: readonly number[] = [10.0, 13.5, 25.4, 29.5, 33.3, 35.3, 42.3, 46.3, 48.3];

/** The sound effects, synthesised by src/film/sfx.ts: every hit on screen has one. */
export type SfxKind = "whoosh" | "impact" | "stamp" | "tick" | "swipe" | "boom" | "riser" | "subdrop";
export const SFX: readonly { at: number; kind: SfxKind; gain?: number }[] = [
  { at: 0.15, kind: "whoosh" }, { at: 1.05, kind: "tick" }, { at: 1.25, kind: "tick" }, { at: 1.45, kind: "tick" }, { at: 2.0, kind: "impact" },
  { at: 5.2, kind: "whoosh", gain: 0.6 }, { at: 5.4, kind: "boom" },
  { at: 8.2, kind: "whoosh" }, { at: 11.6, kind: "whoosh" }, { at: 13.9, kind: "tick" }, { at: 14.5, kind: "stamp", gain: 0.6 },
  { at: 15.4, kind: "whoosh" }, { at: 18.4, kind: "whoosh" }, { at: 19.4, kind: "stamp", gain: 0.7 }, { at: 20.0, kind: "stamp", gain: 0.7 },
  { at: 21.3, kind: "whoosh" }, { at: 23.4, kind: "whoosh" }, { at: 24.0, kind: "swipe" }, { at: 26.1, kind: "impact" },
  { at: 27.3, kind: "whoosh" }, { at: 27.6, kind: "tick" }, { at: 30.3, kind: "tick" }, { at: 30.9, kind: "stamp" },
  { at: 31.7, kind: "whoosh" }, { at: 33.4, kind: "tick" }, { at: 33.7, kind: "tick" }, { at: 34.0, kind: "tick" }, { at: 34.6, kind: "impact" },
  { at: 37.1, kind: "whoosh" }, { at: 37.5, kind: "tick" }, { at: 37.8, kind: "tick" }, { at: 38.1, kind: "tick" }, { at: 38.4, kind: "tick" }, { at: 39.0, kind: "boom", gain: 0.7 },
  { at: 40.1, kind: "whoosh" }, { at: 42.5, kind: "stamp" }, { at: 44.2, kind: "whoosh" }, { at: 48.6, kind: "stamp" },
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ at: 50.4 + i * 0.6, kind: "stamp" as const, gain: 0.55 })), { at: 54.6, kind: "impact" },
  { at: 55.4, kind: "whoosh", gain: 0.7 }, { at: 61.0, kind: "subdrop" },
  { at: 3.9, kind: "riser", gain: 0.8 },
  ...CUTS.map((at) => ({ at: at - 0.05, kind: "whoosh" as const, gain: 0.55 })),
];

/** A figure on screen: the text shown, the record it comes from, and the string that must be found there. */
export interface Figure { text: string; source: string; find: string }

const AWX1 = "docs/runs/2026-11-07-awx-1.md";
const LOCKS10 = "docs/runs/2026-11-10-airwallex-two-locks.md";
const LOCKS12 = "docs/runs/2026-11-12-airwallex-two-locks-paid.md";
const METAL = "docs/runs/2026-11-12-faceid-onchain.md";
const ANCHOR = "docs/runs/2026-11-13-anchor.md";
const ZT = "docs/zero-trust/report.json";
const HOSTILE = "docs/evals/ap-hostile.json";

const read = (p: string): string => {
  const f = resolve(ROOT, p);
  if (!existsSync(f)) throw new Error(`promo: record ${p} is missing`);
  return readFileSync(f, "utf8");
};
const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>;
const num = (p: string, k: string): number => {
  const v = json(p)[k];
  if (typeof v !== "number") throw new Error(`promo: ${p} has no number ${k}`);
  return v;
};

/** Everything the scenes show, each value from its record. */
export function promoData() {
  const f = (text: string, source: string, find = text): Figure => ({ text, source, find });
  const attacks = num(ZT, "attacks_run"), stopped = num(ZT, "attacks_stopped"), moved = num(ZT, "attacks_where_money_moved");
  const calls = num(HOSTILE, "calls"), refused = num(HOSTILE, "refused"), unsafe = num(HOSTILE, "unsafe");
  if (stopped !== attacks) throw new Error(`promo: ${ZT} says ${stopped} of the attacks stopped, not all; the line "all stopped" cannot be said`);
  const d = {
    cent: { from: f("EUR 1,850.00", "src/try/sign.ts", "1,850"), to: f("EUR 1,850.01", "src/redesign/walk.ts", "One cent off: refused"), refused: f("Refused", "src/try/sign.ts", "Refused by Purser") },
    card: {
      amount: f("45.00", AWX1), limit: f("30.00", AWX1), code: f("LIMIT_EXCEEDED", AWX1), card: f("····2441", AWX1, "2441"),
      date: f("7 Nov 2026", AWX1, "2026-11-07"), currency: f("EUR", AWX1, "45.00 EUR"),
    },
    payout: {
      amount: f("EUR 240.00", LOCKS12, "EUR 240.00"), transfer: f("4074d684", LOCKS12), held: f("IN_APPROVAL", LOCKS10), heldOn: f("10 Nov", LOCKS10, "2026-11-10"),
      approved: f("approved at Airwallex", LOCKS12, "approved the transfer in the Airwallex sandbox web app"), approvedOn: f("12 Nov", LOCKS12, "12 November"),
      paid: f("PAID", LOCKS12), simulated: f("settlement simulated", LOCKS12, "simulated settlement"),
    },
    metal: {
      amount: f("0.06", METAL), cap: f("0.05", METAL, "0.05 cap"), reason: f("mandate_cap_exceeded", METAL, "mandate\\_cap\\_exceeded"),
      verdict: f("refused on chain", METAL), tx: f("0xe6d9c7ea…585df4", METAL), date: f("12 Nov 2026", METAL, "2026-11-12"), unit: f("test USD", METAL),
    },
    anchor: {
      head: f("aaaf56a1616d6e1210bfbe27d23c9aa58d40930675148b6f6870aaba28fd816f", ANCHOR), height: f("701", ANCHOR, "Height: 701"),
      block: f("27469355", ANCHOR, "block 27469355"), tx: f("0xaa93f270…", ANCHOR, "0xaa93f270"), date: f("13 Nov 2026", ANCHOR, "2026-11-13"),
    },
    attacks: { run: f(String(attacks), ZT, `"attacks_run": ${attacks}`), moved: f(String(moved), ZT, `"attacks_where_money_moved": ${moved}`) },
    hostile: { calls: f(String(calls), HOSTILE, `"calls": ${calls}`), refused: f(String(refused), HOSTILE, `"refused": ${refused}`), unsafe: f(String(unsafe), HOSTILE, `"unsafe": ${unsafe}`) },
  };
  return d;
}
export type PromoData = ReturnType<typeof promoData>;

/** The small type: what is simulated, and that partners are named in text only. */
export const LABELS = {
  money: "Test money · sandbox/testnet",
  live: "Live page · kit11.max-31b.workers.dev/try · test world, no money moves",
  cloud: "Purser Cloud · guest view · demo company, made-up data, test money",
  awx: "Airwallex sandbox · simulated charge · test money",
  awxPayout: "Airwallex sandbox · test money · settlement simulated",
  metal: "Metal testnet · test USD",
  harness: "Test harness · stand-in rails · test data",
  hostile: "A script in the model's place makes the worst call it can · test data",
  endorse: "Airwallex, Metal and Claude named in text only · No endorsement implied",
  credits: "Voice and music: AI-generated (ElevenLabs) · sound effects made in code",
} as const;

/** Names the film must never show or say (it names partners in text only, and no one else's product). */
const NOT_SAID = /\b(stripe|ramp|brex|paypal|mastercard|revolut|wise|coinbase|openai|gpt|gemini)\b/i;
/** "N of N" or "N/N" fractions are not used anywhere in the film. */
const FRACTION = /\b\d+\s*(?:\/|of)\s*\d+\b/;

/** Problems with the cut: empty when it may be rendered. */
export function checkPromo(): string[] {
  const out: string[] = [];
  let data: PromoData;
  try { data = promoData(); } catch (e) { return [(e as Error).message]; }
  const figures: Figure[] = Object.values(data).flatMap((g) => Object.values(g as Record<string, Figure>));
  for (const fig of figures) if (!read(fig.source).includes(fig.find)) out.push(`"${fig.text}": "${fig.find}" is not in ${fig.source}`);
  const words = LINES.map((l) => l.words).join(" ");
  const n = words.split(/\s+/).length;
  if (n < 90 || n > 150) out.push(`narration is ${n} words, not 90–150`);
  for (const x of SFX) if (x.at < 0 || x.at >= TOTAL) out.push(`a sound effect at ${x.at} s is outside the film`);
  if (TOTAL < 60 || TOTAL > 75) out.push(`film is ${TOTAL} s, not 60–75`);
  for (const [i, l] of LINES.entries()) {
    const next = LINES[i + 1];
    if (l.at + l.dur > (next?.at ?? TOTAL) - 0.2) out.push(`${l.id} runs into ${next?.id ?? "the end"}`);
  }
  for (const [i, s] of SCENES.entries()) if (i && SCENES[i - 1]!.to !== s.from) out.push(`scene ${s.id} does not start where ${SCENES[i - 1]!.id} ends`);
  if (SCENES.at(-1)!.to !== TOTAL) out.push("the scenes do not fill the film");
  const shown = [words, ...Object.values(LABELS), ...figures.map((f) => f.text)].join(" ");
  if (NOT_SAID.test(shown)) out.push(`names someone it must not: ${NOT_SAID.exec(shown)![0]}`);
  if (FRACTION.test(shown)) out.push(`a fraction: ${FRACTION.exec(shown)![0]}`);
  // The narration's spoken counts are the records' counts.
  const spoken: [phrase: string, said: string, record: string][] = [
    ["Fifty-three attacks", "53", data.attacks.run.text], ["Money moved: zero", "0", data.attacks.moved.text],
    ["Three hundred and eighty tool calls", "380", data.hostile.calls.text], ["Zero unsafe", "0", data.hostile.unsafe.text],
  ];
  for (const [phrase, said, rec] of spoken) if (!words.includes(phrase) || said !== rec) out.push(`the narration says "${phrase}" but the record says ${rec}`);
  return out;
}

const stamp = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
/** The narration as English subtitles, one cue per line, on the take's own length. */
export function promoSrt(): string {
  return LINES.map((l, i) => `${i + 1}\n${stamp(l.at)} --> ${stamp(l.at + l.dur + 0.15)}\n${l.words.replace("... ", " … ")}\n`).join("\n");
}
