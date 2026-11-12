// /watch: the film, first and calm (the owner, 12 Nov: "the Watch can really be much better"). One page: the poster
// and its play button (the film is embedded from youtube-nocookie.com only once its id is set in src/config/film.ts;
// until then the poster says "Film coming"), the chapters with their times (each jumps in the film once it is there),
// a short key of what is real and what is simulated (src/film/key.ts), and the full transcript in a fold. Everything
// comes from the walkthrough's cut list (src/film/cuts.ts), so the chapters and the words are the film's own. No
// script while there is no film; with one, a few lines that put the player in place of the poster.

import { FILM_YOUTUBE_ID, filmId } from "../config/film.js";
import { WALKTHROUGH, chapters, clock, narration, resolveCut, total } from "../film/cuts.js";
import { REAL, SIMULATED } from "../film/key.js";
import { esc, icon, page } from "./ui.js";

const EMBED = "https://www.youtube-nocookie.com";

const CSS = `.film { padding: 28px 0 40px; }
.film .wrap { max-width: 980px; }
.fhead h1 { font-size: clamp(30px, 3.4vw, 42px); font-weight: 760; }
.fhead p { margin: 8px 0 18px; color: var(--muted); font-size: 16.5px; max-width: 44em; }
.player { position: relative; aspect-ratio: 16 / 9; border-radius: var(--r); overflow: hidden; background: #0a0c11; border: 1px solid var(--border); box-shadow: var(--shadow); }
.player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.poster { position: absolute; inset: 0; display: grid; align-content: center; justify-items: start; gap: 10px; padding: clamp(18px, 5vw, 56px); color: #eef1f6; text-decoration: none; background: radial-gradient(120% 90% at 85% 10%, #23224a 0%, #12151d 55%, #0a0c11 100%); }
.poster .mk { width: 40px; height: 40px; border-radius: 12px; background: #eef1f6; color: #0a0c11; display: grid; place-items: center; }
.poster b { font-size: clamp(26px, 4.4vw, 52px); font-weight: 780; letter-spacing: -.03em; line-height: 1.05; }
.poster span.l { font-size: clamp(14px, 1.7vw, 19px); color: #a4adbd; max-width: 34em; line-height: 1.45; }
.poster .go { position: absolute; right: clamp(16px, 4vw, 44px); bottom: clamp(16px, 4vw, 40px); display: inline-flex; align-items: center; gap: 10px; font: 650 16px/1 Inter, system-ui, sans-serif; color: #eef1f6; }
.poster .pb { width: clamp(52px, 7vw, 76px); height: clamp(52px, 7vw, 76px); border-radius: 50%; background: #eef1f6; color: #0a0c11; display: grid; place-items: center; }
.poster .soon { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px; background: rgba(238,241,246,.1); border: 1px solid rgba(238,241,246,.22); font: 650 15px/1 Inter, system-ui, sans-serif; }
@media (max-width: 640px) { .poster { gap: 8px; } .poster .l { font-size: 13.5px; } .poster .go { position: static; margin-top: 4px; } }
button.poster { border: 0; width: 100%; cursor: pointer; font: inherit; text-align: left; }
.fgrid { display: grid; gap: 16px; margin-top: 22px; }
@media (min-width: 900px) { .fgrid { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); align-items: start; } }
.fgrid h2 { font-size: 15px; font-weight: 750; letter-spacing: .04em; color: var(--faint); text-transform: uppercase; margin: 0 0 10px; }
.chap, .key { padding: 18px 20px; }
ol.ch { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
ol.ch a, ol.ch span.it { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 9px 10px; border-radius: 12px; text-decoration: none; color: var(--text); font-size: 16px; min-height: 44px; }
ol.ch a:hover { background: var(--sunken); }
ol.ch time { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 650; font-size: 15px; }
ol.ch span.it time { color: var(--faint); }
.key h3 { font-size: 16px; font-weight: 700; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; letter-spacing: -.01em; }
.key h3 .i { color: var(--ok); } .key h3.sim .i { color: var(--awx); }
.key ul { margin: 0 0 16px; padding-left: 18px; display: grid; gap: 6px; font-size: 15.5px; color: var(--muted); }
.key ul:last-child { margin-bottom: 0; }
details.tr { margin-top: 16px; padding: 4px 20px; }
details.tr > summary { cursor: pointer; font-weight: 700; font-size: 16.5px; padding: 12px 0; min-height: 44px; display: flex; align-items: center; gap: 8px; }
ol.lines { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 10px; }
ol.lines li { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; font-size: 15.5px; line-height: 1.5; }
ol.lines time { font-variant-numeric: tabular-nums; color: var(--faint); font-size: 14.5px; padding-top: 1px; }
ol.lines small { display: block; font-size: 13.5px; font-weight: 650; color: var(--faint); letter-spacing: .02em; }
.fnote { font-size: 14.5px; color: var(--faint); margin: 12px 0 0; }`;

const JS = `(function () {
  var box = document.getElementById("player"), id = box.getAttribute("data-id");
  function play(t) {
    var f = document.createElement("iframe");
    f.src = "${EMBED}/embed/" + id + "?autoplay=1&rel=0&start=" + Math.max(0, t | 0);
    f.title = "Purser: the film"; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.setAttribute("allowfullscreen", "");
    box.textContent = ""; box.appendChild(f);
  }
  document.getElementById("play").addEventListener("click", function () { play(0); });
  document.querySelectorAll("a[data-t]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); play(+a.getAttribute("data-t")); box.scrollIntoView({ block: "center" }); });
  });
})();`;

/** The film's facts for the page: its length, chapters and transcript, as the walkthrough is cut today. */
export function filmFacts() {
  const placed = resolveCut(WALKTHROUGH);
  const lines = narration(placed);
  const rows = placed.filter((p) => p.row.words).map((p) => ({ at: Math.round(lines.find((l) => l.row === p.row.id)!.at), who: p.row.kind === "cam" ? "Max" : "Voice-over", text: p.row.words }));
  return { seconds: total(placed), chapters: chapters(placed), rows };
}

const MARK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg>';

/** /watch. `id`: the film's YouTube id (default: the configured one); null or invalid: the page without a film. */
export function filmWatchPage(o: { id?: string | null } = {}): string {
  const id = o.id === undefined ? filmId(FILM_YOUTUBE_ID) : o.id === null ? null : filmId(o.id);
  const f = filmFacts();
  const len = clock(f.seconds);
  const face = `<span class="mk">${MARK}</span><b>Purser</b><span class="l">AI agents pay company bills, but only within limits the CFO signs with Face ID.</span>`;
  const poster = id
    ? `<button class="poster" id="play" type="button" aria-label="Play the film (${len})">${face}<span class="go"><span class="pb">${icon("play", 30)}</span>${len}</span></button><noscript><a class="poster" href="https://youtu.be/${id}">${face}<span class="go">Watch on YouTube ↗</span></a></noscript>`
    : `<div class="poster" role="img" aria-label="The film's poster: film coming">${face}<span class="go"><span class="soon">${icon("clock", 16)}Film coming · about ${len}</span></span></div>`;
  const chapterItems = f.chapters.map((c) => id
    ? `<li><a href="https://youtu.be/${id}?t=${c.at}" data-t="${c.at}"><time>${clock(c.at)}</time><span>${esc(c.title)}</span></a></li>`
    : `<li><span class="it"><time>${clock(c.at)}</time><span>${esc(c.title)}</span></span></li>`).join("");
  const keyList = (lines: readonly { text: string }[]) => `<ul>${lines.map((l) => `<li>${esc(l.text)}</li>`).join("")}</ul>`;
  const body = `<main class="film"><div class="wrap">
  <div class="fhead"><h1>The film</h1><p>Purser in ${len}: the CFO signs the exact terms, then the rails check the limit again. Every number is read from a run's record.</p></div>
  <div class="player" id="player"${id ? ` data-id="${id}"` : ""}>${poster}</div>
  <div class="fgrid">
    <section class="card chap" aria-labelledby="h-ch"><h2 id="h-ch">Chapters</h2><ol class="ch">${chapterItems}</ol>${id ? "" : `<p class="fnote">The times are the film's as it is cut; each one jumps there once the film is up.</p>`}</section>
    <section class="card key" aria-labelledby="h-key"><h2 id="h-key">What you are seeing</h2>
      <h3>${icon("circle-check", 18)}Ran for real, with test money</h3>${keyList(REAL)}
      <h3 class="sim">${icon("info", 18)}Simulated, and said so</h3>${keyList(SIMULATED)}
    </section>
  </div>
  <details class="card tr"><summary>${icon("receipt", 18)}The full transcript</summary><ol class="lines">${f.rows.map((r) => `<li><time>${clock(r.at)}</time><span><small>${esc(r.who)}</small>${esc(r.text)}</span></li>`).join("")}</ol></details>
</div></main>`;
  return page({
    title: "The film", description: `Purser in ${len}: AI agents pay company bills only within limits the CFO signs with Face ID. Chapters, what is real and what is simulated, and the transcript.`,
    tab: "watch", css: CSS, body, ...(id ? { js: JS, stage: false } : {}),
    source: "Source: src/film/cuts.ts (the walkthrough's cut list) and the run records each line names (src/film/claims.ts).",
  });
}

/** The page's CSP: no script and no frame without a film; with one, its script and youtube-nocookie.com's player only. */
export function filmWatchCsp(html: string, hasFilm: boolean, cspFor: (p: string) => string, styleOnly: (p: string) => string): string {
  return hasFilm ? `${cspFor(html)}; frame-src ${EMBED}` : styleOnly(html);
}
