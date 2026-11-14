// The promo film v1.1 (14 Nov): v1's cut (1:12, #293 at 64339d3) with v1's look, pacing and audio (the narration and
// the music, no sound effects), which Max preferred to v2. Its only changes: the hostile-model split in the site's
// words, the walkthrough link on the end card, two transitions tightened (the dip before the mark, the Metal bars), and
// captions burned in on the vertical cut. The figures are v2's (promoData in promo.ts), checked the same way. Drawn by
// src/film/promo-v1.html: npm run promo -- render --version v1.

import type { Cut } from "./promo.js";

export const V1: Cut = {
  name: "v1.1",
  total: 72,
  music: { at: 1.0, from: 0 },
  html: "src/film/promo-v1.html",
  lines: [
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
  ],
  scenes: [
    { id: "problem", from: 0, to: 4.0 }, { id: "prompt", from: 4.0, to: 8.3 }, { id: "pen", from: 8.3, to: 10.9 },
    { id: "logo", from: 10.9, to: 12.9 }, { id: "sign", from: 12.9, to: 20.2 }, { id: "rails", from: 20.2, to: 23.1 },
    { id: "locks", from: 23.1, to: 26.1 }, { id: "word", from: 26.1, to: 28.4 }, { id: "cent", from: 28.4, to: 32.3 },
    { id: "card", from: 32.3, to: 36.4 }, { id: "payout", from: 36.4, to: 40.9 }, { id: "metal", from: 40.9, to: 46.5 },
    { id: "anchor", from: 46.5, to: 49.6 }, { id: "attacks", from: 49.6, to: 53.4 }, { id: "hostile", from: 53.4, to: 60.4 },
    { id: "cloud", from: 60.4, to: 66.5 }, { id: "end", from: 66.5, to: 72 },
  ],
  sfx: [],
  cuts: [],
};
