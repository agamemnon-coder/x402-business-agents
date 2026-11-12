// /judge, "Judge it in 3 minutes" (Max's last round, item 5.1; in the menu's order: Home, Try, Proof; the replay at
// /watch left the tour on 12 Nov): five steps for a juror with little time, each with a checkbox and a time. On a phone
// every box, title, button and link is a 44 px target. Each step only links to a page that already
// exists and says in one line what the juror will see there: no new claim (test/judge-tour.test.ts checks every link
// against the routes the Worker serves, and each line against its page). The ticks live in this browser only
// (localStorage, every access in try/catch, so the page works where storage is blocked); the page has no fetch and its
// CSP allows no connection.

import { FILM_LINK, FILM_URL } from "../config/brand.js";
import { REPO_URL } from "../submission/deck.js";
import { DEMO_STEPS, HERO_VERDICT } from "./heroDemo.js";
import { metalStory, refusalNote } from "./metalStory.js";
import { loadRecord } from "./run.js";
import { esc, icon, page } from "./ui.js";

/** The link to /judge, word for word: at the top of Home, in the README and in the form. */
export const JUDGE_LINK = "Judge it in 3 minutes →";
export const JUDGE_URL = "https://kit11.max-31b.workers.dev/judge";
/** "Want the code?": the README's "How it works in 5 files". */
export const JUDGE_CODE_HREF = `${REPO_URL}#how-it-works-in-5-files`;

export interface JudgeLink { label: string; href: string }
export interface JudgeStep { id: string; title: string; seconds: number; see: string; links: JudgeLink[]; note?: string }

/**
 * The five steps, in the menu's order: Home's own moment (one tap on the hero's last step, in the hero's own words),
 * then /try/sign as its story goes (the agent asks, signed with Face ID, try to cheat, try to trick the agent, change
 * the rule and see the worst case, the agent pays alone, the closing card), then the proof. The tour no longer starts
 * with the replay (12 Nov): /watch is reached from Proof.
 */
export function judgeSteps(record = loadRecord().record): JudgeStep[] {
  const st = metalStory(record), refusal = st.refusal?.proof.href, note = refusalNote(st.refusal);
  return [
    {
      id: "home", title: `Tap “${DEMO_STEPS[3]}” on Home`, seconds: 40,
      see: `Home's four steps: ${DEMO_STEPS.join(", ")}. Tap “${DEMO_STEPS[3]}”: the amount changes by one cent, and the check in your browser says Refused, “${HERO_VERDICT.refused}”.`,
      links: [{ label: "Open /home", href: "/home" }],
    },
    {
      id: "sign", title: "Sign, then try to cheat", seconds: 40,
      see: "Your own test world: the agent asks, you sign with your passkey, then “Now try to cheat: change one cent”. The server refuses the same signature.",
      links: [{ label: "Open /try/sign", href: "/try/sign" }],
    },
    {
      id: "trick", title: "Try to trick the agent", seconds: 30,
      see: "Next: send your agent a fake invoice. Claude Sonnet reads it live; Purser's code checks it and stops the payment.",
      links: [{ label: "Trick the agent on /try/sign", href: "/try/sign" }],
    },
    {
      id: "policy", title: "Change the rule, see the worst case", seconds: 30,
      see: "A looser rule needs your signature, and the worst case is in sight. Then the agent pays its next invoice alone, and a closing card sums it up.",
      links: [{ label: "Change the rule on /try/sign", href: "/try/sign" }],
    },
    {
      id: "proof", title: "See the proof", seconds: 40,
      see: "What Purser guarantees, with the code and the test for each; every id of the main run; the Airwallex-only run of 7 November, every check passed, and Airwallex's own decline; Metal's refusal on chain.",
      links: [
        { label: "Open /proof", href: "/proof" }, { label: "The Airwallex-only run", href: "/airwallex#awx-1" }, { label: "Open /metal", href: "/metal" },
        // The Visa entry (12 Nov, jury panel): the Airi run, Visa Intelligent Commerce via Airwallex's Airi.
        { label: "The Visa run (VIC via Airi)", href: "/visa" },
        ...(refusal ? [{ label: "The refusal on the explorer", href: refusal }] : []),
      ],
      // What the explorer shows for the refusal (jury review, 7 Nov, #3): its log is not decoded there.
      ...(refusal && note ? { note } : {}),
    },
  ];
}
export const JUDGE_STEPS = judgeSteps();

/** The ticks' key in this browser's localStorage. */
const KEY = "purser.judge.v1";

const CSS = `main { padding: 28px 0 24px; }
@media (min-width: 720px) { main { padding: 48px 0 40px; } }
.intro { max-width: 46em; display: grid; gap: 12px; }
.prog { margin: 4px 0 0; font-weight: 650; color: var(--muted); font-size: 15.5px; font-variant-numeric: tabular-nums; }
ol.steps { list-style: none; margin: 28px 0 0; padding: 0; display: grid; gap: 14px; max-width: 860px; }
.step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; padding: 18px; align-items: start; transition: border-color .2s; }
@media (min-width: 720px) { .step { padding: 22px 24px; gap: 18px; } }
/* The box looks 26 px, as before, and is a 44 px target: its padding box is the square, inside a clear 9 px border. */
.step input { -webkit-appearance: none; appearance: none; box-sizing: border-box; width: 44px; height: 44px; margin: -8px -9px -9px; border: 9px solid transparent; border-radius: 16px; background: var(--surface) padding-box; box-shadow: inset 0 0 0 2px var(--faint); display: grid; place-content: center; cursor: pointer; }
.step input:checked { background-color: var(--ok); box-shadow: inset 0 0 0 2px var(--ok); }
.step input:checked::before { content: ""; width: 7px; height: 13px; margin-top: -3px; border: solid var(--surface); border-width: 0 3px 3px 0; transform: rotate(45deg); }
.step input:focus-visible { outline: 3px solid var(--accent); outline-offset: -7px; }
.step .t { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0; margin-top: -8px; cursor: pointer; font-weight: 720; font-size: 19px; line-height: 1.3; letter-spacing: -.01em; }
.step .t b { font-weight: inherit; min-width: 0; flex: 1 1 14em; }
.step .n { width: 28px; height: 28px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 14px; font-weight: 750; flex: none; }
.step .secs { display: inline-flex; align-items: center; gap: 5px; font: 650 14px/1.35 Inter, system-ui, sans-serif; padding: 3px 10px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.step .see { margin: 0; color: var(--muted); font-size: 16.5px; line-height: 1.5; }
.step .go { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.step .xn { margin: 10px 0 0; font-size: 14.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.step .go .btn { height: 44px; padding: 0 16px; font-size: 15px; white-space: normal; text-align: left; }
.step.done { border-color: var(--ok); }
.step.done .n { background: var(--ok); color: var(--surface); }
.step.done .t b { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--ok) 60%, transparent); }
section.more { margin-top: 36px; max-width: 860px; display: grid; gap: 8px; font-size: 17px; }
section.more p { margin: 0; }
section.more a { color: var(--accent); font-weight: 650; text-decoration: none; }
section.more a:hover { text-decoration: underline; }
@media (max-width: 430px) { section.more { gap: 0; } section.more a { display: flex; align-items: center; min-height: 44px; } section.more .sep { display: none; } }
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
  <p class="lead">${steps.length} steps: start on Home, try it yourself, see the proof. Tick them off as you go.</p>
  <p class="prog" id="prog" aria-live="polite">${steps.length} steps</p>
</section>
<ol class="steps">
${steps.map((s, i) => `<li class="step card" id="s-${s.id}"><input type="checkbox" id="step-${s.id}" data-step="${s.id}">
  <div><label class="t" for="step-${s.id}"><span class="n">${i + 1}</span><b>${esc(s.title)}</b><span class="secs">${s.seconds} s</span></label>
  <p class="see">${esc(s.see)}</p>
  <div class="go">${s.links.map(linkHtml).join("")}</div>${s.note ? `<p class="xn">${esc(s.note)}</p>` : ""}</div></li>`).join("\n")}
</ol>
<section class="more" aria-label="More">
  <p><b>More time?</b> <a href="/trace">Trace any payment from policy to bank</a><span class="sep"> · </span><a href="/try/verify">Check your receipt yourself, no server</a></p>
  <p><b>Want the code?</b> <a href="${esc(JUDGE_CODE_HREF)}" target="_blank" rel="noopener">How it works in 5 files&nbsp;↗</a></p>
  <p><a href="${esc(FILM_URL)}" target="_blank" rel="noopener">${esc(FILM_LINK)}&nbsp;↗</a></p>
</section>
</div></main>`;
  return page({
    title: "Judge it in 3 minutes", description: "Five steps for the jury, three minutes in all, in the menu's order: change one cent on Home, sign and try to cheat, try to trick the agent, change the rule, see the proof.",
    tab: null, css: CSS, body, js: JS, stage: false,
    source: "Source: src/redesign/judge.ts.",
    real: ["This page only links to Purser's pages and Metal's testnet explorer; each of those says what is real there. Your ticks stay in this browser (localStorage); nothing is sent to any server."],
  });
}
