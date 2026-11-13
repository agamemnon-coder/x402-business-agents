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

export interface TourStep { id: string; title: string; seconds: number; text: string; link: { label: string; href: string }; image: string; alt: string }

/** The four steps, three minutes in all. Each link is a page the site serves today (test/tour.test.ts checks them). */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "try", title: "Try it", seconds: 60,
    text: "Start a test company and file an invoice. AI agents read and check it; you approve the exact terms with your passkey. Change one term and Purser refuses to pay.",
    link: { label: "Open the hands-on demo", href: TRY_URL },
    image: "tour-try.webp", alt: "The hands-on demo's start screen: an invoice card and \"Start with a test company\".",
  },
  {
    id: "proof", title: "See the proof", seconds: 40,
    text: "What Purser guarantees, each with the dated run that shows it: on Airwallex's sandbox, Metal's testnet, Visa via Airwallex Airi (sandbox) and Claude's decisions.",
    link: { label: "Open Proof", href: "/proof" },
    image: "tour-proof.webp", alt: "The Proof page: four result cards above the full list of guarantees and checks.",
  },
  {
    id: "cloud", title: "Open Purser Cloud as a guest", seconds: 40,
    text: "Try as guest opens a demo company, read only: its dashboard, invoices, transactions and books. Made-up data, test money.",
    link: { label: "Open Purser Cloud", href: PURSER_CLOUD_URL },
    image: "tour-cloud.webp", alt: "Purser Cloud's overview for the demo company: money in and out, net cash and invoices.",
  },
  {
    id: "connect", title: "Connect your AI", seconds: 40,
    text: "Add Purser to Claude, Cursor, VS Code or Gemini CLI over MCP. Your AI reads the books and can propose a payment; only the CFO's Face ID approves one.",
    link: { label: "Read the setup", href: "/docs#connect-ai" },
    image: "tour-connect.webp", alt: "The docs' \"Connect your AI\" card, with the demo token and the setup links.",
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
.stop .body { display: grid; gap: 10px; padding: 20px 20px 22px; flex: 1; align-content: start; }
@media (min-width: 720px) { .stop .body { padding: 24px 26px 26px; } }
.stop .meta { display: flex; align-items: center; gap: 10px; font: 650 14px/1 Inter, system-ui, sans-serif; color: var(--muted); font-variant-numeric: tabular-nums; }
.stop .n { width: 26px; height: 26px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 13.5px; font-weight: 750; }
.stop h2 { margin: 0; font-size: 21px; line-height: 1.3; letter-spacing: -.01em; font-weight: 720; }
.stop p { margin: 0; color: var(--muted); font-size: 16.5px; line-height: 1.5; }
.stop .go { margin-top: 6px; }
.stop .go .btn { height: 44px; padding: 0 18px; font-size: 15px; }
.after { margin: 36px 0 0; color: var(--muted); font-size: 16px; }
.after a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
.after a:hover { text-decoration: underline; }`;

const linkHtml = (l: TourStep["link"]) => {
  const out = /^https:\/\//.test(l.href);
  return `<a class="btn" href="${esc(l.href)}"${out ? ' target="_blank" rel="noopener"' : ""}>${esc(l.label)}${out ? "\u00a0↗" : `\u00a0${icon("arrow-right", 16)}`}</a>`;
};

export function tourPage(steps: readonly TourStep[] = TOUR_STEPS): string {
  const minutes = Math.round(steps.reduce((t, s) => t + s.seconds, 0) / 60);
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">Product tour</p>
  <h1 class="h-hero">Product tour · ${minutes} minutes</h1>
  <p class="lead">Purser runs a company's payables with AI agents, and only the CFO's Face ID moves money. ${["No", "One", "Two", "Three", "Four", "Five", "Six"][steps.length] ?? steps.length} steps show it end to end.</p>
</section>
<ol class="tour">
${steps.map((s, i) => `<li class="stop card" id="${esc(s.id)}">
  <div class="shot"><img src="assets/${esc(s.image)}" alt="${esc(s.alt)}" width="1200" height="750" loading="${i < 2 ? "eager" : "lazy"}" decoding="async"></div>
  <div class="body">
    <div class="meta"><span class="n">${i + 1}</span><span>${s.seconds < 60 ? `${s.seconds} seconds` : `${Math.round(s.seconds / 60)} minute${s.seconds >= 120 ? "s" : ""}`}</span></div>
    <h2>${esc(s.title)}</h2>
    <p>${esc(s.text)}</p>
    <div class="go">${linkHtml(s.link)}</div>
  </div>
</li>`).join("\n")}
</ol>
<p class="after">Prefer to read? <a href="/docs">The docs</a>&nbsp;·&nbsp;<a href="${esc(`${REPO_URL}#how-it-works-in-5-files`)}" target="_blank" rel="noopener">How it works in 5 files&nbsp;↗</a></p>
</div></main>`;
  return page({
    title: TOUR_TITLE,
    description: "Four steps, three minutes: try the hands-on demo, see the proof, open Purser Cloud as a guest, connect your AI.",
    tab: "tour", css: CSS, body, stage: false,
    source: "Source: src/redesign/tour.ts.",
    real: [
      "This page only links to Purser's pages; each of them says what is real there. The demo and Purser Cloud use test companies and test money.",
      "Screenshots, 13 Nov 2026: Proof and Purser Cloud recorded from the live sites; the hands-on demo and the docs captured from this repository's build.",
    ],
  });
}
