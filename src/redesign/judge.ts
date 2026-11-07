// /judge, "Judge it in 3 minutes" (Max's last round, item 5.1): five steps for a juror with little time, each with a
// checkbox and a time. Each step only links to a page that already exists and says in one line what the juror will see
// there: no new claim (test/judge-tour.test.ts checks every link against the routes the Worker serves, and each line
// against its page). The ticks live in this browser only (localStorage, every access in try/catch, so the page works
// where storage is blocked); the page has no fetch and its CSP allows no connection.

import { FILM_LINK, FILM_URL } from "../config/brand.js";
import { REPO_URL } from "../submission/deck.js";
import { metalStory } from "./metalStory.js";
import { loadRecord } from "./run.js";
import { esc, icon, page } from "./ui.js";

/** The link to /judge, word for word: at the top of Home, in the README and in the form. */
export const JUDGE_LINK = "Judge it in 3 minutes →";
export const JUDGE_URL = "https://kit11.max-31b.workers.dev/judge";
/** "Want the code?": the README's "How it works in 5 files". */
export const JUDGE_CODE_HREF = `${REPO_URL}#how-it-works-in-5-files`;

export interface JudgeLink { label: string; href: string }
export interface JudgeStep { id: string; title: string; seconds: number; see: string; links: JudgeLink[] }

/** The five steps, Max's titles and times, in his order. */
export function judgeSteps(record = loadRecord().record): JudgeStep[] {
  const refusal = metalStory(record).refusal?.proof.href;
  return [
    {
      id: "sign", title: "Sign, then try to cheat", seconds: 60,
      see: "A test world of your own: sign the agent's payment with your passkey, then “Now try to cheat: change one cent”. The server refuses the same signature.",
      links: [{ label: "Open /try/sign", href: "/try/sign" }],
    },
    {
      id: "policy", title: "Change the rule", seconds: 30,
      see: "Next on the same page: let the agent pay more alone. A looser rule needs your signature; then its next invoice pays without you, and the worst case is in sight.",
      links: [{ label: "Change the rule on /try/sign", href: "/try/sign" }],
    },
    {
      id: "trace", title: "Trace any payment from policy to bank", seconds: 30,
      see: "Pick any payment and follow it from the CFO's policy to the bank.",
      links: [{ label: "Open /trace", href: "/trace" }],
    },
    {
      id: "rails", title: "See Airwallex and Metal enforce it themselves", seconds: 30,
      see: "Airwallex's own card controls and its decline, read back from Airwallex; Metal's refusal on chain, on Metal's testnet explorer.",
      links: [{ label: "Open /airwallex", href: "/airwallex" }, { label: "Open /metal", href: "/metal" }, ...(refusal ? [{ label: "The refusal on the explorer", href: refusal }] : [])],
    },
    {
      id: "verify", title: "Check the receipt yourself, no server", seconds: 30,
      see: "Pick the receipt.json from step 1: your browser checks the signature, with no server call. Change one field and it fails.",
      links: [{ label: "Open /try/verify", href: "/try/verify" }],
    },
  ];
}
export const JUDGE_STEPS = judgeSteps();

/** The ticks' key in this browser's localStorage. */
const KEY = "purser.judge.v1";

const CSS = `main { padding: 28px 0 56px; }
@media (min-width: 720px) { main { padding: 48px 0 72px; } }
.intro { max-width: 46em; display: grid; gap: 12px; }
.prog { margin: 4px 0 0; font-weight: 650; color: var(--muted); font-size: 15.5px; font-variant-numeric: tabular-nums; }
ol.steps { list-style: none; margin: 28px 0 0; padding: 0; display: grid; gap: 14px; max-width: 860px; }
.step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; padding: 18px; align-items: start; transition: border-color .2s; }
@media (min-width: 720px) { .step { padding: 22px 24px; gap: 18px; } }
.step input { width: 26px; height: 26px; margin: 3px 0 0; accent-color: var(--ok); cursor: pointer; }
.step .t { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; cursor: pointer; font-weight: 720; font-size: 19px; line-height: 1.3; letter-spacing: -.01em; }
.step .t b { font-weight: inherit; min-width: 0; flex: 1 1 14em; }
.step .n { width: 28px; height: 28px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 14px; font-weight: 750; flex: none; }
.step .secs { display: inline-flex; align-items: center; gap: 5px; font: 650 14px/1.35 Inter, system-ui, sans-serif; padding: 3px 10px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.step .see { margin: 8px 0 0; color: var(--muted); font-size: 16.5px; line-height: 1.5; }
.step .go { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.step .go .btn { height: 42px; padding: 0 16px; font-size: 15px; white-space: normal; text-align: left; }
.step.done { border-color: var(--ok); }
.step.done .n { background: var(--ok); color: var(--surface); }
.step.done .t b { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--ok) 60%, transparent); }
section.more { margin-top: 36px; max-width: 860px; display: grid; gap: 8px; font-size: 17px; }
section.more p { margin: 0; }
section.more a { color: var(--accent); font-weight: 650; text-decoration: none; }
section.more a:hover { text-decoration: underline; }
.small { font-size: 14.5px; color: var(--muted); }`;

/** Ticks in this browser only: each localStorage access in its own try/catch, so blocked storage only means no memory. */
const JS = `(function () {
  var KEY = ${JSON.stringify(KEY)};
  var boxes = [].slice.call(document.querySelectorAll("input[data-step]"));
  var prog = document.getElementById("prog");
  var kept = [];
  try { kept = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { kept = []; }
  if (!Array.isArray(kept)) kept = [];
  function draw() {
    var n = 0;
    boxes.forEach(function (b) { if (b.checked) n++; b.closest("li").classList.toggle("done", b.checked); });
    prog.textContent = n === boxes.length ? "All " + n + " done. Thank you for judging." : n + " of " + boxes.length + " done";
  }
  function save() {
    var ids = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.getAttribute("data-step"); });
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch (e) { /* storage blocked: the ticks last as long as the page */ }
  }
  boxes.forEach(function (b) {
    if (kept.indexOf(b.getAttribute("data-step")) >= 0) b.checked = true;
    b.addEventListener("change", function () { save(); draw(); });
  });
  draw();
})();`;

const linkHtml = (l: JudgeLink) => {
  const out = /^https:\/\//.test(l.href);
  return `<a class="btn" href="${esc(l.href)}"${out ? ' target="_blank" rel="noopener"' : ""}>${esc(l.label)}${out ? "\u00a0↗" : `\u00a0${icon("arrow-right", 16)}`}</a>`;
};

export function judgePage(steps: JudgeStep[] = JUDGE_STEPS): string {
  const total = steps.reduce((t, s) => t + s.seconds, 0);
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">For the jury</p>
  <h1 class="h-hero">Judge it in ${Math.round(total / 60)} minutes</h1>
  <p class="lead">${steps.length} steps, each with its time and what you will see. Tick them off as you go: the ticks stay in this browser.</p>
  <p class="prog" id="prog" aria-live="polite">${steps.length} steps</p>
</section>
<ol class="steps">
${steps.map((s, i) => `<li class="step card" id="s-${s.id}"><input type="checkbox" id="step-${s.id}" data-step="${s.id}">
  <div><label class="t" for="step-${s.id}"><span class="n">${i + 1}</span><b>${esc(s.title)}</b><span class="secs">${s.seconds} s</span></label>
  <p class="see">${esc(s.see)}</p>
  <div class="go">${s.links.map(linkHtml).join("")}</div></div></li>`).join("\n")}
</ol>
<section class="more" aria-label="More">
  <p><b>Want the code?</b> <a href="${esc(JUDGE_CODE_HREF)}" target="_blank" rel="noopener">How it works in 5 files&nbsp;↗</a></p>
  <p><a href="${esc(FILM_URL)}" target="_blank" rel="noopener">${esc(FILM_LINK)}&nbsp;↗</a></p>
</section>
</div></main>`;
  return page({
    title: "Judge it in 3 minutes", description: "Five steps for the jury, three minutes in all: sign and tamper, set the policy, trace a payment, see the rails enforce it, check the receipt.",
    tab: null, css: CSS, body, js: JS, stage: false,
    source: "Source: src/redesign/judge.ts.",
    real: ["This page only links to Purser's pages and Metal's testnet explorer; each of those says what is real there. Your ticks stay in this browser (localStorage); nothing is sent to any server."],
  });
}
