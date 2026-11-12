// Home's hero walkthrough (the owner, 12 Nov: "less text, more demo"): the hands-on demo's own screens (/try on Purser
// Cloud), playing by themselves in a phone frame, a caption of a few words each. The screens are real: captured from
// /try by test/browser/try.check.ts, on this repository's own engine (cloud/src), at 390 px. No API key was set for that
// capture, so the screens say what ran: "Purser's code reads today", test money, a simulated bank. The captions say
// nothing the screens do not show. CSS only (no script): each frame shows for 3 s of a 15 s loop; with reduced motion
// the frames stand side by side in a row that scrolls, nothing moves.

import { esc } from "./ui.js";

/** One frame: the screen (docs/assets/try-walk/walk-<n>.webp, served as /assets/try-walk-<n>.webp) and its caption. */
export const WALK = [
  { caption: "An invoice comes in", alt: "The demo's first screen: an invoice comes in, a sample from a supplier on file." },
  { caption: "Read and checked", alt: "Purser reads and checks it: Bergtex Textil GmbH, EUR 1,850.00, ready to pay." },
  { caption: "You sign the exact terms", alt: "Approve the payment: your passkey signs exactly these terms. Approved, nothing paid yet." },
  { caption: "One cent off: refused", alt: "The amount changed to 1850,01: refused by Purser, the signature is over other terms." },
  { caption: "Paid and booked", alt: "Paid on the simulated bank, test money, EUR 1,850.00, and booked in Purser's ledger." },
] as const;
const N = WALK.length, STEP_S = 3;

/** Where the screens come from, on the page under the frame. */
export const WALK_NOTE = "The hands-on demo's own screens. Test money, simulated bank.";

export const WALK_ASSETS = WALK.map((_, i) => `try-walk-${i + 1}.webp`);

export function walkHtml(): string {
  return `<figure class="walk" aria-label="The hands-on demo in ${N} screens: ${esc(WALK.map((w) => w.caption).join(", "))}.">
  <ol class="walk-caps">${WALK.map((w, i) => `<li class="w${i}"><span>${i + 1}</span>${esc(w.caption)}</li>`).join("")}</ol>
  <div class="walk-phone"><div class="walk-screen">${WALK.map((w, i) => `<img class="w${i}" src="assets/${WALK_ASSETS[i]}" alt="${esc(w.alt)}" width="480" height="880"${i ? ' loading="lazy"' : ""}>`).join("")}</div></div>
</figure>`;
}

// Each frame (and its caption) is on for its own fifth of the loop, fading in and out at the edges.
const on = (i: number) => {
  const a = (i / N) * 100, b = ((i + 1) / N) * 100, f = 1.5;
  const k = (x: number) => `${Math.max(0, Math.min(100, x)).toFixed(2)}%`;
  return i === 0
    ? `@keyframes walk${i} { 0%, ${k(b - f)} { opacity: 1; } ${k(b)}, ${k(100 - f)} { opacity: 0; } 100% { opacity: 1; } }`
    : `@keyframes walk${i} { 0%, ${k(a - f)} { opacity: 0; } ${k(a)}, ${k(b - f)} { opacity: 1; } ${k(b)}, 100% { opacity: 0; } }`;
};

export const WALK_CSS = `
.walk { margin: 0; display: grid; justify-items: center; gap: 14px; }
.walk-caps { list-style: none; margin: 0; padding: 0; display: grid; place-items: center; min-height: 34px; }
.walk-caps li { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 700; color: var(--text); opacity: 0; }
.walk-caps li span { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; font-size: 13px; }
.walk-phone { width: min(300px, 62vw); padding: 10px; border-radius: 38px; background: #0b0d12; box-shadow: 0 24px 60px rgba(15, 23, 42, .22), inset 0 0 0 1px rgba(255, 255, 255, .08); }
.walk-screen { position: relative; border-radius: 29px; overflow: hidden; aspect-ratio: 480 / 880; background: var(--surface); }
.walk-screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; opacity: 0; }
.walk .w0 { opacity: 1; }
@media (prefers-reduced-motion: no-preference) {
${WALK.map((_, i) => `  .walk .w${i} { animation: walk${i} ${N * STEP_S}s linear infinite; }`).join("\n")}
  .walk-screen img { transform-origin: 50% 0; }
}
${WALK.map((_, i) => on(i)).join("\n")}
@media (prefers-reduced-motion: reduce) {
  .walk-caps { display: none; }
  .walk-phone { width: 100%; padding: 0; border-radius: 0; background: none; box-shadow: none; }
  .walk-screen { aspect-ratio: auto; display: grid; grid-auto-flow: column; grid-auto-columns: 220px; gap: 12px; overflow-x: auto; border-radius: 0; background: none; scroll-snap-type: x mandatory; }
  .walk-screen img { position: static; opacity: 1; height: auto; border-radius: 18px; border: 1px solid var(--border); scroll-snap-align: start; }
}
p.walk-note { margin: 10px 0 0; font-size: 14px; color: var(--muted); text-align: center; }
`;
