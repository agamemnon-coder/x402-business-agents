// The promo film (13 Nov): 72 seconds, separate from the walkthrough. A premium-launch style cut: the problem, the
// answer, the proof, the call to action, read by an AI-generated female narrator (ElevenLabs, a premade library voice),
// over AI-generated music (ElevenLabs). Every figure on screen is read from its record here, before a frame is drawn:
// a string that is not found in its record stops the render (checkPromo). The zero-trust and hostile-model counts are
// read from their JSON reports, never typed. The scenes are drawn by src/film/promo.html; npm run promo renders them.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const TRY_URL = "kit11.max-31b.workers.dev/try";
export const TOTAL = 72;
export const FPS = 60;
/** The music take starts this late on the film's clock, so its two hits land on "money" and on "Purser." */
export const MUSIC_AT = 1.0;
/** The narrator: ElevenLabs premade library voice "Lily" (no clone, no imitation of anyone). */
export const VOICE = { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (ElevenLabs premade voice)", model: "eleven_multilingual_v2" } as const;

/** One line of narration: its id (the WAV/MP3 name), its words, where it starts, and the take's length (measured). */
export interface Line { id: string; words: string; at: number; dur: number }

export const LINES: readonly Line[] = [
  { id: "p1", at: 0.5, dur: 2.93, words: "AI agents are starting to spend company money." },
  { id: "p2", at: 4.0, dur: 3.47, words: "And a limit written in a prompt... is only a request." },
  { id: "p3", at: 8.4, dur: 1.52, words: "So who holds the pen?" },
  { id: "a1", at: 11.0, dur: 1.02, words: "Purser." },
  { id: "a2", at: 13.0, dur: 6.92, words: "Agents propose. The CFO signs the exact terms, with Face ID or a passkey." },
  { id: "a3", at: 20.3, dur: 2.4, words: "Then the payment rails enforce the limit, again." },
  { id: "a4", at: 23.2, dur: 2.27, words: "Two locks. One signature." },
  { id: "r0", at: 26.2, dur: 1.67, words: "Don't take our word for it." },
  { id: "r1", at: 28.5, dur: 3.42, words: "Change one cent after signing. Refused." },
  { id: "r2", at: 32.4, dur: 3.47, words: "A charge over the card limit? Airwallex declined it." },
  { id: "r3", at: 36.5, dur: 3.94, words: "A payout, held in approval, until the owner said yes." },
  { id: "r4", at: 41.0, dur: 5.02, words: "Over the agent's cap? Metal refused it. On chain." },
  { id: "r5", at: 46.6, dur: 2.53, words: "The audit chain, anchored on chain." },
  { id: "r6", at: 49.6, dur: 3.68, words: "Fifty-three attacks. Money moved: zero." },
  { id: "r7", at: 53.5, dur: 5.69, words: "A hostile model. Three hundred and eighty tool calls. Zero unsafe." },
  { id: "c1", at: 61.2, dur: 3.66, words: "Your agents do the work. Your CFO signs the exceptions." },
  { id: "c2", at: 66.8, dur: 1.91, words: "Purser. Try it yourself." },
];

export interface Scene { id: string; from: number; to: number }
export const SCENES: readonly Scene[] = [
  { id: "problem", from: 0, to: 4.0 },
  { id: "prompt", from: 4.0, to: 8.3 },
  { id: "pen", from: 8.3, to: 10.9 },
  { id: "logo", from: 10.9, to: 12.9 },
  { id: "sign", from: 12.9, to: 20.2 },
  { id: "rails", from: 20.2, to: 23.1 },
  { id: "locks", from: 23.1, to: 26.1 },
  { id: "word", from: 26.1, to: 28.4 },
  { id: "cent", from: 28.4, to: 32.3 },
  { id: "card", from: 32.3, to: 36.4 },
  { id: "payout", from: 36.4, to: 40.9 },
  { id: "metal", from: 40.9, to: 46.5 },
  { id: "anchor", from: 46.5, to: 49.6 },
  { id: "attacks", from: 49.6, to: 53.4 },
  { id: "hostile", from: 53.4, to: 60.4 },
  { id: "cloud", from: 60.4, to: 66.5 },
  { id: "end", from: 66.5, to: TOTAL },
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
  credits: "Voice and music: AI-generated (ElevenLabs)",
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
  if (n < 120 || n > 150) out.push(`narration is ${n} words, not 120–150`);
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
