// /tour, "Product tour · 3 minutes" (owner, 13 Nov: it replaces /judge, which "looks amateur and has old links"; /judge
// now answers 301 to here). Four steps as cards, each with a screenshot of the page it opens and one link to it: the
// hands-on demo (/try), the proof (/proof), Purser Cloud as a guest, and connecting your AI (/docs#connect-ai). Only
// current pages; no ticks, no script: the page loads its own style and four images, nothing else.
// The screenshots (docs/assets/tour/README.md): steps 2 and 3 from the live-site recordings in docs/assets/media, steps 1
// and 4 captured from this repository's own build on 13 Nov, so they show today's copy and menu.

import { REPO_URL } from "../submission/deck.js";
import { PURSER_CLOUD_URL } from "../ui/more.js";
import { esc, icon, page, TRY_URL } from "./ui.js";

/** The link to /tour, word for word: on Home, in the README and in llms.txt. */
export const TOUR_LINK = "3-minute product tour";
export const TOUR_URL = "https://kit11.max-31b.workers.dev/tour";
export const TOUR_TITLE = "Product tour · 3 minutes";
/** The two demos' names, the same on Home and the tour (judges, 13 Nov, #7). */
export const SIGN_NAME = "Sign in 60 seconds";
export const INBOX_NAME = "Run the payables inbox";

export interface TourStep { id: string; title: string; seconds: number; text: string; link: { label: string; href: string }; image: string; alt: string }

/** The five steps, three minutes in all. Each link is a page the site serves today (test/tour.test.ts checks them). */
export const TOUR_STEPS: readonly TourStep[] = [
  // Owner, 13 Nov: each card says in one plain sentence what you will see, for a visitor who is not technical; no jargon.
  // Judges, 13 Nov (#7): one hero demo first, "Sign in 60 seconds" (/try/sign); then the hands-on demo as "Run the
  // payables inbox" (/try). The same two names on Home and here.
  {
    id: "sign", title: SIGN_NAME, seconds: 60,
    text: "You'll approve a supplier payment with your own Face ID or fingerprint, then change one cent and see Purser refuse to pay it.",
    link: { label: SIGN_NAME, href: "/try/sign" },
    image: "tour-sign.webp", alt: "The start of the 60-second demo: \"You're the CFO\", and the CFO's one policy with its three locks.",
  },
  {
    id: "try", title: INBOX_NAME, seconds: 40,
    text: "You'll run a pretend company's payables: AI agents read and check each invoice, and you approve what is above their limit.",
    link: { label: INBOX_NAME, href: TRY_URL },
    image: "tour-try.webp", alt: "The start screen of the payables inbox: a sample invoice and the button \"Start with a test company\".",
  },
  {
    id: "proof", title: "See the proof", seconds: 30,
    text: "You'll see each promise Purser makes, next to the real test run that shows it was kept.",
    link: { label: "See the proof", href: "/proof" },
    image: "tour-proof.webp", alt: "The Proof page: four results at the top, then the full list of promises and checks.",
  },
  {
    id: "cloud", title: "Look around a sample company", seconds: 25,
    text: "You'll see a sample company's money in and out, its invoices and its books, with made-up numbers and nothing to sign up for.",
    link: { label: "Open the sample company", href: PURSER_CLOUD_URL },
    image: "tour-cloud.webp", alt: "The sample company's overview in Purser Cloud: money in and out, cash over time and invoices.",
  },
  {
    id: "connect", title: "Connect your AI", seconds: 25,
    text: "You'll see how your own AI assistant, such as Claude, can read your books and suggest a payment, while only you can approve one.",
    link: { label: "Connect your AI", href: "/docs#connect-ai" },
    image: "tour-connect.webp", alt: "The \"Connect your AI\" instructions, step by step.",
  },
];

const CSS = `main { padding: 32px 0 24px; }
@media (min-width: 720px) { main { padding: 56px 0 48px; } }
.intro { max-width: 44em; display: grid; gap: 12px; }
.intro h1 { margin: 0; }
ol.tour { list-style: none; margin: 32px 0 0; padding: 0; display: grid; gap: 20px; }
@media (min-width: 880px) { ol.tour { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 44px; } }
.stop { display: flex; flex-direction: column; overflow: hidden; }
.stop .shot { display: block; aspect-ratio: 16 / 10; background: var(--sunken); border-bottom: 1px solid var(--border); overflow: hidden; }
.stop .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top center; }
/* Review, 13 Nov: at phone width a desktop screenshot is a thumbnail nobody can read; below 600 px the cards are words and a button. */
@media (max-width: 599px) { .stop .shot { display: none; } }
.stop .body { display: grid; gap: 10px; padding: 20px 20px 22px; flex: 1; align-content: start; }
@media (min-width: 720px) { .stop .body { padding: 24px 26px 26px; } }
.stop .meta { display: flex; align-items: center; gap: 10px; font: 650 14px/1 Inter, system-ui, sans-serif; color: var(--muted); font-variant-numeric: tabular-nums; }
.stop .n { width: 26px; height: 26px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 13.5px; font-weight: 750; }
.stop h2 { margin: 0; font-size: 21px; line-height: 1.3; letter-spacing: -.01em; font-weight: 720; }
.stop p { margin: 0; color: var(--muted); font-size: 16.5px; line-height: 1.5; }
.stop .go { margin-top: 6px; }
.stop .go .btn { height: 52px; padding: 0 24px; font-size: 16.5px; width: 100%; justify-content: center; }
@media (min-width: 560px) { .stop .go .btn { width: auto; min-width: 220px; } }
.after { margin: 36px 0 0; color: var(--muted); font-size: 16px; }
.after a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
.after a:hover { text-decoration: underline; }`;

const linkHtml = (l: TourStep["link"], first = false) => {
  const out = /^https:\/\//.test(l.href);
  return `<a class="btn${first ? " primary" : ""}" href="${esc(l.href)}"${out ? ' target="_blank" rel="noopener"' : ""}>${esc(l.label)}${out ? "\u00a0↗" : `\u00a0${icon("arrow-right", 16)}`}</a>`;
};

export function tourPage(steps: readonly TourStep[] = TOUR_STEPS): string {
  const minutes = Math.round(steps.reduce((t, s) => t + s.seconds, 0) / 60);
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">Product tour</p>
  <h1 class="h-hero">Product tour · ${minutes} minutes</h1>
  <p class="lead">Purser lets AI agents pay a company's bills within the limits you set; anything above them waits for your Face ID. Start at step 1: each step takes a minute or less.</p>
</section>
<ol class="tour">
${steps.map((s, i) => `<li class="stop card" id="${esc(s.id)}">
  <div class="shot"><img src="assets/${esc(s.image)}" alt="${esc(s.alt)}" width="1200" height="750" loading="${i < 2 ? "eager" : "lazy"}" decoding="async"></div>
  <div class="body">
    <div class="meta"><span class="n">${i + 1}</span><span>${s.seconds < 60 ? `${s.seconds} seconds` : `${Math.round(s.seconds / 60)} minute${s.seconds >= 120 ? "s" : ""}`}</span></div>
    <h2>${esc(s.title)}</h2>
    <p>${esc(s.text)}</p>
    <div class="go">${linkHtml(s.link, i === 0)}</div>
  </div>
</li>`).join("\n")}
</ol>
<p class="after">Prefer to read? <a href="/docs">The docs</a>&nbsp;·&nbsp;<a href="${esc(`${REPO_URL}#how-it-works-in-5-files`)}" target="_blank" rel="noopener">How it works in 5 files&nbsp;↗</a></p>
</div></main>`;
  return page({
    title: TOUR_TITLE,
    description: "Five steps, three minutes: sign in 60 seconds, run the payables inbox, see the proof, look around a sample company, connect your AI.",
    tab: "tour", css: CSS, body, stage: false,
    source: "Source: src/redesign/tour.ts.",
    real: [
      "This page only links to Purser's pages; each of them says what is real there. The demo and Purser Cloud use test companies and test money.",
      "Screenshots, 13 Nov 2026: Proof and Purser Cloud recorded from the live sites; the hands-on demo and the docs captured from this repository's build.",
    ],
  });
}
