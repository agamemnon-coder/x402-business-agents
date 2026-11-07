// Home: one screen, picture first (Max, 7 Nov: "a picture says more than a thousand words"). The heading, what Purser
// is in one sentence, the stage playing the run's Metal moment (the price rise refused on chain, Treasury replans, two
// signatures, the mandate replaced), and the way through the site in three steps: watch the agents, try it yourself,
// see the proof. One button. The numbers, the partners' proof and the business live on /proof. Everything from the
// recorded run (src/redesign/run.ts).

import { BUSINESS_DOCS, CAVEAT_LINE, CAVEAT_LINK, CORE_SENTENCE, HERO, JUDGE_LINE, KIT_LINE, VISA_AWARD_ON, VISA_EXTRA_LINK, WHAT_IT_IS, WHY_COMPANY, WHY_COMPANY_NOTE } from "../config/brand.js";
import { agentRun, type AgentRun } from "./run.js";
import { esc, icon, page, stageHtml } from "./ui.js";

const CSS = `.hero { padding: 24px 0 44px; }
.hero .wrap { display: grid; gap: 22px; grid-template-areas: "copy" "stage"; }
.hero .copy { grid-area: copy; } .hero .show { grid-area: stage; min-width: 0; } .hero .act { grid-area: act; }
.hero .h-hero { text-wrap: balance; }
@media (min-width: 980px) { .hero { padding: 56px 0 72px; } .hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 600px); grid-template-areas: "copy stage"; gap: 0 52px; align-items: center; } }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; }
/* The three steps (Max, 7 Nov): one way through the site. */
ol.flow { list-style: none; margin: 22px 0 0; padding: 0; display: grid; gap: 10px; max-width: 30em; }
ol.flow a { display: grid; grid-template-columns: 30px 22px minmax(0, 1fr); align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: var(--text); text-decoration: none; }
ol.flow a:hover { border-color: var(--accent); }
ol.flow .fn { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; font-weight: 750; font-size: 15px; }
ol.flow .i { color: var(--accent); }
ol.flow b { display: block; font-size: 17px; } ol.flow small { display: block; color: var(--muted); font-size: 14.5px; }
.btn.big.start { margin-top: 18px; height: 56px; font-size: 17px; padding: 0 26px; }
@media (max-width: 979px) { .btn.big.start { width: 100%; justify-content: center; } }
.hero .what { margin: 14px 0 0; font-size: 19px; line-height: 1.45; font-weight: 600; max-width: 34em; }
.badges .pill.kit { background: var(--text); color: var(--bg); white-space: nowrap; }
.badges .pill.kit.award { background: var(--accent-soft); color: var(--accent); }
.caveat a { color: var(--accent); font-weight: 650; }
.judgeline { margin: 10px 0 0; font-size: 15px; } .judgeline a { color: var(--accent); font-weight: 650; text-decoration: none; }
.caveat { margin: 6px 0 0; font-size: 14.5px; color: var(--muted); }
.built { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 22px; color: var(--faint); font-size: 14px; font-weight: 600; }
.logo { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); }
.logo.dark { background: #191919; border-color: #191919; }
.logo img { display: block; height: 15px; width: auto; }
.logo.txt { background: var(--surface); color: var(--text); font-weight: 750; font-size: 14px; white-space: nowrap; flex: none; }
.runlabel { margin-top: 10px; font-size: 14px; color: var(--faint); display: flex; align-items: center; gap: 6px; }
section.band { padding: 60px 0; border-top: 1px solid var(--border); }
.sechead { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.sechead .pill { white-space: normal; }
@media (max-width: 899px) {
  section.band { padding: 44px 0; }
}`;

/**
 * What the hero plays: the Metal moment first (from the first refusal on chain to the first purchase under the replaced
 * mandate), then the other two moments' key steps. Purchases refused by Purser before signing are left to Watch.
 */
export function heroMoments(run: AgentRun): number[] {
  const ev = run.events;
  const s1 = run.scenes.find((s) => s.n === 1);
  const out: number[] = [];
  const add = (i: number) => { if (i >= 0 && !out.includes(i)) out.push(i); };
  if (s1) {
    const chain = ev.findIndex((e, i) => i >= s1.start && e.k === "money" && (e.refused?.by === "recorded" || e.refused?.by === "metal") && !!e.proof.href);
    add(chain);
    add(ev.findIndex((e, i) => i > chain && e.k === "world" && /asks \d/.test(e.text)));
    add(ev.findIndex((e, i) => i > chain && e.k === "msg" && e.agent === "sourcing"));
    add(ev.findIndex((e, i) => i > chain && e.k === "say" && e.agent === "treasury" && e.tools.some((t) => /rebalance/.test(t))));
    // Four eyes as it happened: the first signature (1 of 2), the second (2 of 2), then the mandates replaced on chain.
    add(ev.findIndex((e, i) => i > chain && e.k === "face" && e.status === "COSIGNED"));
    const sig = ev.findIndex((e, i) => i > chain && e.k === "face" && e.signers.length > 1);
    add(sig);
    const rep = ev.findIndex((e, i) => i > sig && e.k === "mandate" && e.agent === "sourcing");
    add(rep >= 0 ? rep : ev.findIndex((e, i) => i > sig && e.k === "world" && /replaced/.test(e.text)));
    add(ev.findIndex((e, i) => i > sig && e.k === "money" && e.agent === "sourcing" && !e.refused));
  }
  for (const s of run.scenes.filter((x) => x.n !== 1)) {
    const end = run.scenes.find((x) => x.n === s.n + 1)?.start ?? ev.length;
    ev.forEach((e, i) => {
      if (i < s.start || i >= end) return;
      const key = e.k === "world" || e.k === "face" || e.k === "shield" || e.k === "mandate" || (e.k === "say" && e.tools.some((t) => /settle|sweep|plan_invoice/.test(t))) || (e.k === "money" && e.agent !== null);
      if (key && !(e.k === "money" && e.agent === "support" && out.some((j) => { const p = ev[j]!; return p.k === "money" && p.agent === "support"; }))) add(i);
    });
  }
  return out.filter((i) => i >= 0);
}

/** The partners' logos, as Home has always shown them. */
const LOGOS: Record<"Airwallex" | "Metal" | "Claude", string> = {
  Airwallex: '<span class="logo"><img src="assets/logo-airwallex.png" alt="Airwallex" width="109" height="15"></span>',
  Metal: '<span class="logo"><img src="assets/logo-metal.svg" alt="Metal" width="48" height="15"></span>',
  Claude: '<span class="logo dark"><img src="assets/logo-claude.png" alt="Claude" width="69" height="15"></span>',
};

/**
 * Home is served at "/" too (worker/src/core.ts). The CFO's viewer link opens "/" with its key after the "#" (never sent
 * to a server), and a device that opened it keeps the key (kit11.view, as src/dashboard/page.html stores it): either
 * goes on to the dashboard, "#" and all, by the same patterns the dashboard reads. The key leaves this page's address at
 * once, as it does on the dashboard. A guest stays on Home, and the Home tab (/home) is always Home.
 */
export const CFO_FORWARD_JS = `
(function () {
  try {
    if (location.pathname.slice(-1) !== "/") return;
    var h = location.hash, kept = "";
    try { kept = localStorage.getItem("kit11.view") || ""; } catch (e) {}
    if (!kept && !/(?:^#|&)(?:view=[0-9a-f]{32}|runner=[A-Za-z0-9_-]{80,200})(?:&|$)/.test(h)) return;
    if (h) try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    location.replace("./?dashboard" + h);
  } catch (e) {}
})();`;

const JS = `${CFO_FORWARD_JS}
(function () {
  // "Details →" (the caveat line) opens the footer's "What's real?" (jury review, 6 Nov, #7).
  var real = document.getElementById("real");
  var open = function () { if (real) real.open = true; };
  if (location.hash === "#real") open();
  document.querySelectorAll("[data-real]").forEach(function (a) { a.addEventListener("click", open); });
})();
(function () {
  var run = JSON.parse(document.getElementById("run-data").textContent);
  document.querySelectorAll("[data-vars]").forEach(function (el) { el.getAttribute("data-vars").split(";").forEach(function (p) { var kv = p.split(":"); if (kv[1] !== undefined) el.style.setProperty(kv[0], kv[1]); }); });
  var st = Stage(document.querySelector("[data-stage]"), run);
  var list = run.moments.map(function (i) { return run.events[i]; });
  var frame = /[?&]frame=(\\d+)/.exec(location.search);
  // The first frame already shows the run: the rails primed, the refusal on chain at the wall.
  st.prime(run.events, run.moments[0] || 0);
  if (frame || st.reduce) {
    var upto = frame ? Math.min(list.length - 1, +frame[1]) : 0;
    st.prime(run.events, run.moments[upto] || 0);
    for (var k = 0; k <= upto; k++) st.show(list[k], { instant: true });
    return;
  }
  // The first frame: the refusal on chain, the notice and the Sourcing agent's own words, at once; then it plays on.
  var i = 0;
  while (i < Math.min(3, list.length)) st.show(list[i++], { instant: true });
  function next() {
    if (i >= list.length) { i = 0; st.reset(); st.prime(run.events, run.moments[0] || 0); }
    var ms = st.show(list[i++]);
    setTimeout(next, ms);
  }
  setTimeout(next, 2600);
})();`;

/**
 * "Why this is a company" (section D, 6 Nov): five lines from docs/business/, each linked to its page, under one note
 * that says it is not validated (WHY_COMPANY, WHY_COMPANY_NOTE).
 */
export function whyCompanyHtml(): string {
  return `<section class="band" aria-labelledby="h-company"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-company">Why this is a company</h2></div>
  <p class="cnote">${esc(WHY_COMPANY_NOTE)}</p>
  <ul class="company">${WHY_COMPANY.map((l) => `<li><b>${esc(l.label)}:</b> ${esc(l.text)} <a href="${esc(BUSINESS_DOCS + l.page)}" target="_blank" rel="noopener">Read it ↗</a></li>`).join("")}</ul>
</div></section>`;
}

/** The way through the site, Max's three steps (7 Nov): watch the agents, try it yourself, see the proof. */
export const FLOW = [
  { n: 1, icon: "play", title: "Watch the agents", sub: "A real run, replayed · 1 min", href: "watch" },
  { n: 2, icon: "scan-face", title: "Try it yourself", sub: "Sign with your Face ID · 1 min", href: "try/sign" },
  { n: 3, icon: "shield-check", title: "See the proof", sub: "Every id, checkable", href: "proof" },
] as const;
/** Home's one button, word for word. */
export const START = "Start: watch the agents";

/** opts.trySign: the bundle also carries /try/sign (TRY_SIGN_ENABLED), so step 2 leads there; otherwise to /try. */
export function homePage(run: AgentRun = agentRun(), opts: { trySign?: boolean } = {}): string {
  const moments = heroMoments(run);
  const s1 = run.scenes.find((s) => s.n === 1);
  const flow = FLOW.map((f) => ({ ...f, href: f.href === "try/sign" && !opts.trySign ? "try" : f.href }));
  // Picture first, few words (Max, 7 Nov): the heading, one sentence, the agents at work, the three steps, one button.
  const body = `<main>
<section class="hero"><div class="wrap">
  <div class="copy">
    <h1 class="h-hero">${esc(HERO)}</h1>
    <p class="what">${esc(WHAT_IT_IS)}</p>
    <ol class="flow" aria-label="Three steps">${flow.map((f) => `<li><a href="${esc(f.href)}"><span class="fn">${f.n}</span>${icon(f.icon, 20)}<span class="ft"><b>${esc(f.title)}</b><small>${esc(f.sub)}</small></span></a></li>`).join("")}</ol>
    <a class="btn primary big start" href="watch">${icon("play", 18)}${esc(START)}</a>
    ${opts.trySign ? `<p class="judgeline"><a href="judge">${esc(JUDGE_LINE)} →</a></p>` : ""}
    <p class="caveat">${esc(CAVEAT_LINE)} <a href="#real" data-real>${esc(CAVEAT_LINK)}</a></p>
  </div>
  <div class="show">${stageHtml(run.agents, s1?.steps[0]?.text ?? "Northwind Outdoor sells live stock data per query")}<div class="runlabel">${icon("database", 14)}<span>${esc(run.label)}</span></div>
    <div class="built">Built on ${LOGOS.Airwallex}${LOGOS.Metal}${LOGOS.Claude}${VISA_AWARD_ON ? '<span class="logo txt">Visa TAP</span>' : ""}</div>
    <div class="badges">${KIT_LINE.split(/ · (?=entered for)/).map((x, i) => `<span class="pill kit${i ? " award" : ""}">${esc(x)}</span>`).join("")}</div>
  </div>
</div></section>
</main>`;
  return page({
    title: "Purser", description: `${HERO} ${CORE_SENTENCE}`, tab: "home", css: CSS, body, js: JS,
    // Visa TAP as a footer link (jury review, 6 Nov, #7): an extra, not an award entry.
    links: [["visa", VISA_EXTRA_LINK]],
    data: { agents: run.agents, events: run.events, moments },
    source: `Source: ${run.file} (${run.name}).`,
  });
}
