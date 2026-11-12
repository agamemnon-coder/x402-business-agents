// /watch: the film, as a product page (the owner, 12 Nov: "the watch page needs an upgrade, heavily"). A dark,
// cinematic hero with the poster (a real frame of the film: Home's hero, src/film/stills/) and its play button; a rail
// of chapters, each with a thumbnail of its first shot (a plain tile where the chapter opens on footage the owner has
// not recorded yet), that jump in the film once it is there; a strip of the runs the film shows, each linking its own
// record; the honest labels; the transcript folded; and the next step, try it yourself. Calm and short.
// Two states, one constant (src/config/film.ts): no YouTube id, the poster says "Film coming" and the page has no
// script; with one, the player from youtube-nocookie.com takes the poster's place on click. The site cannot serve the
// film itself (a Worker answers with at most a few MB; the film is about 30 MB), so there is no hosted-file state.
// Motion (the poster's slow drift, the play button's pulse, the rail rising in) stops under prefers-reduced-motion
// (src/redesign/ui.ts). Everything comes from the walkthrough's cut list, so the times and words are the film's own.

import { FILM_YOUTUBE_ID, filmId } from "../config/film.js";
import { WALKTHROUGH, chapters, clock, narration, resolveCut, total, type Placed } from "../film/cuts.js";
import { LABELS, runsSeen, type RunShown } from "../film/key.js";
import { filmStills, stillAsset } from "../film/stills.js";
import { esc, icon, page, TRY_URL } from "./ui.js";

const EMBED = "https://www.youtube-nocookie.com";

const CSS = `.film { padding: 0 0 48px; }
.film .wrap { max-width: 1160px; }
/* The hero is dark in both themes: a cinema, not a card. */
.hero { background: radial-gradient(90% 70% at 70% 0%, #1b1a3a 0%, #0a0c11 60%); color: #eef1f6; padding: 34px 0 30px; border-bottom: 1px solid #1d2230; }
.hero .eyebrow { color: #a5a0ff; margin: 0 0 8px; }
.hero h1 { font-size: clamp(30px, 4vw, 52px); font-weight: 780; letter-spacing: -.035em; margin: 0 0 20px; max-width: 18em; }
.player { position: relative; aspect-ratio: 16 / 9; border-radius: 22px; overflow: hidden; background: #0a0c11; box-shadow: 0 30px 80px -30px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.07); isolation: isolate; }
.player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.poster { position: absolute; inset: 0; display: block; padding: 0; border: 0; margin: 0; width: 100%; color: #eef1f6; text-decoration: none; background: #0a0c11; cursor: default; text-align: left; font: inherit; }
button.poster, a.poster { cursor: pointer; }
.poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .55; transform-origin: 60% 40%; animation: drift 26s ease-in-out infinite alternate; }
.poster::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,12,17,.15) 0%, rgba(10,12,17,.35) 45%, rgba(10,12,17,.92) 100%); }
@keyframes drift { from { transform: scale(1.02); } to { transform: scale(1.09) translate(-1.5%, -1%); } }
.poster .over { position: absolute; z-index: 1; right: clamp(12px, 3vw, 36px); bottom: clamp(12px, 3vw, 32px); }
.pb { position: absolute; z-index: 1; left: 50%; top: 50%; width: clamp(64px, 9vw, 104px); height: clamp(64px, 9vw, 104px); transform: translate(-50%, -50%); border-radius: 50%; background: #eef1f6; color: #0a0c11; display: grid; place-items: center; box-shadow: 0 10px 40px rgba(0,0,0,.5); transition: transform .25s ease; }
.pb .i { width: 40%; height: 40%; margin-left: 6%; }
.pb::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(238,241,246,.6); animation: ping 2.4s cubic-bezier(.2,.6,.3,1) infinite; }
@keyframes ping { from { transform: scale(1); opacity: .9; } to { transform: scale(1.65); opacity: 0; } }
button.poster:hover .pb, button.poster:focus-visible .pb { transform: translate(-50%, -50%) scale(1.06); }
.soon { display: inline-flex; align-items: center; gap: 8px; padding: 10px 15px; border-radius: 999px; background: rgba(238,241,246,.1); border: 1px solid rgba(238,241,246,.24); font: 650 15px/1 Inter, system-ui, sans-serif; white-space: nowrap; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.len { font: 650 15px/1 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; padding: 8px 12px; border-radius: 999px; background: rgba(10,12,17,.6); white-space: nowrap; }
ul.labels { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; padding: 0; }
ul.labels li { font: 600 13.5px/1 Inter, system-ui, sans-serif; color: #c3c9d6; padding: 8px 12px; border-radius: 999px; border: 1px solid #2c3242; background: rgba(18,21,29,.7); }
/* Chapters: a rail of thumbnails, each its first shot. */
.sec { margin-top: 30px; }
.sec h2 { font-size: 15px; font-weight: 750; letter-spacing: .04em; color: var(--faint); text-transform: uppercase; margin: 0 0 12px; }
ol.rail { list-style: none; margin: 0 calc(-1 * var(--gut)); padding: 4px var(--gut) 14px; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 248px); gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 var(--gut); scrollbar-width: thin; }
ol.rail li { scroll-snap-align: start; animation: rise .6s cubic-bezier(.2,.7,.2,1) both; }
${Array.from({ length: 16 }, (_, i) => `ol.rail li:nth-child(${i + 1}) { animation-delay: ${80 + i * 50}ms; }`).join(" ")}
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
.ch { display: block; text-decoration: none; color: var(--text); border-radius: 16px; }
.ch .th { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: #12151d; border: 1px solid var(--border); }
.ch .th img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .35s ease; }
a.ch:hover .th img, a.ch:focus-visible .th img { transform: scale(1.05); }
.ch .th time { position: absolute; left: 8px; bottom: 8px; font: 650 13px/1 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #eef1f6; background: rgba(10,12,17,.78); padding: 5px 8px; border-radius: 8px; }
.ch .tile { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 8px; background: radial-gradient(80% 80% at 70% 20%, #23224a, #12151d 70%); color: #c3c9d6; font: 600 13px/1.2 Inter, system-ui, sans-serif; }
.ch .tile .i { width: 26px; height: 26px; color: #a5a0ff; }
.ch b { display: block; margin-top: 9px; font-size: 15.5px; font-weight: 650; line-height: 1.3; }
/* The runs the film shows, each with its record. */
ul.runs { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); }
ul.runs a { display: grid; gap: 6px; height: 100%; padding: 16px 16px 14px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); text-decoration: none; color: var(--text); transition: border-color .2s ease, transform .2s ease; }
ul.runs a:hover, ul.runs a:focus-visible { border-color: var(--accent); transform: translateY(-2px); }
ul.runs .rl { display: flex; align-items: center; gap: 8px; font: 700 14px/1 Inter, system-ui, sans-serif; }
ul.runs .rl .i { color: var(--ok); }
ul.runs .rl time { margin-left: auto; font-weight: 600; color: var(--faint); font-size: 13.5px; }
ul.runs span.tx { font-size: 15px; color: var(--muted); line-height: 1.45; }
ul.runs span.go { font: 650 13.5px/1 Inter, system-ui, sans-serif; color: var(--accent); margin-top: auto; padding-top: 4px; }
details.tr { margin-top: 28px; padding: 4px 20px; }
details.tr > summary { cursor: pointer; font-weight: 700; font-size: 16.5px; padding: 12px 0; min-height: 44px; display: flex; align-items: center; gap: 8px; }
ol.lines { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 10px; }
ol.lines li { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; font-size: 15.5px; line-height: 1.5; }
ol.lines time { font-variant-numeric: tabular-nums; color: var(--faint); font-size: 14.5px; padding-top: 1px; }
ol.lines small { display: block; font-size: 13.5px; font-weight: 650; color: var(--faint); letter-spacing: .02em; }
.fnext { margin: 26px 0 0; }
@media (max-width: 640px) {
  .hero { padding: 24px 0 22px; } .soon, .len { font-size: 13.5px; padding: 8px 11px; }
  /* On a phone the labels and the runs are rails too: one row each, swiped, so the page stays short. */
  ul.labels, ul.runs { margin-left: calc(-1 * var(--gut)); margin-right: calc(-1 * var(--gut)); padding: 0 var(--gut) 8px; display: grid; grid-auto-flow: column; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 var(--gut); scrollbar-width: none; }
  ul.labels { grid-auto-columns: max-content; } ul.runs { grid-template-columns: none; grid-auto-columns: 82%; }
  ul.labels li, ul.runs li { scroll-snap-align: start; }
}`;

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
    a.addEventListener("click", function (e) { e.preventDefault(); play(+a.getAttribute("data-t")); box.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); });
  });
})();`;

/** A chapter's thumbnail: its first shot's still (the first of its shots that has one), or a tile for the owner's footage. */
export interface ChapterCard { at: number; title: string; still: string | null; tile: { icon: string; label: string } | null }

/** The film's facts for the page: its length, chapters with their thumbnails, and transcript, as it is cut today. */
export function filmFacts(placed: Placed[] = resolveCut(WALKTHROUGH), stills: Record<string, unknown> = filmStills()) {
  const lines = narration(placed);
  const rows = placed.filter((p) => p.row.words).map((p) => ({ at: Math.round(lines.find((l) => l.row === p.row.id)!.at), who: p.row.kind === "cam" ? "Max" : "Voice-over", text: p.row.words }));
  const cards: ChapterCard[] = chapters(placed).map((c) => {
    const first = placed.find((p) => Math.round(p.start) === c.at && p.row.chapter === c.title)!.segs[0]!;
    const still = (first.shot ?? []).map((s) => stillAsset(`${s}.webp`)).find((a) => a in stills) ?? null;
    const tile = still ? null : first.own?.startsWith("P") ? { icon: "scan-face", label: "On the phone" } : first.own ? { icon: "play", label: "Max on camera" } : { icon: "sparkles", label: "Coming" };
    return { ...c, still, tile };
  });
  return { seconds: total(placed), chapters: cards, rows, poster: stillAsset("poster.webp") in stills ? stillAsset("poster.webp") : null };
}

/** /watch. `id`: the film's YouTube id (default: the configured one); null or invalid: the page without a film. */
export function filmWatchPage(o: { id?: string | null; runs?: RunShown[] } = {}): string {
  const id = o.id === undefined ? filmId(FILM_YOUTUBE_ID) : o.id === null ? null : filmId(o.id);
  const f = filmFacts();
  const runs = o.runs ?? runsSeen();
  const len = clock(f.seconds);
  const img = f.poster ? `<img src="assets/${f.poster}" alt="" width="1600" height="900" fetchpriority="high">` : "";
  // The frame carries its own title (Home's hero); the poster adds only the length, or that the film is coming.
  const over = (right: string) => `<span class="over">${right}</span>`;
  const poster = id
    ? `<button class="poster" id="play" type="button" aria-label="Play the film (${len})">${img}<span class="pb">${icon("play", 40)}</span>${over(`<span class="len">${len}</span>`)}</button><noscript><a class="poster" href="https://youtu.be/${id}">${img}${over(`<span class="len">Watch on YouTube ↗</span>`)}</a></noscript>`
    : `<div class="poster" role="img" aria-label="A frame of the film; the film is coming">${img}${over(`<span class="soon">${icon("clock", 16)}Film coming · ${len}</span>`)}</div>`;
  const thumb = (c: ChapterCard) => `<span class="th">${c.still ? `<img src="assets/${c.still}" alt="" width="480" height="270" loading="lazy">` : `<span class="tile">${icon(c.tile!.icon, 26)}${esc(c.tile!.label)}</span>`}<time>${clock(c.at)}</time></span><b>${esc(c.title)}</b>`;
  const rail = f.chapters.map((c) => id
    ? `<li><a class="ch" href="https://youtu.be/${id}?t=${c.at}" data-t="${c.at}">${thumb(c)}</a></li>`
    : `<li><span class="ch">${thumb(c)}</span></li>`).join("");
  const body = `<main class="film">
<section class="hero"><div class="wrap">
  <p class="eyebrow">The film · ${len}</p>
  <h1>Purser, in under five minutes</h1>
  <div class="player" id="player"${id ? ` data-id="${id}"` : ""}>${poster}</div>
  <ul class="labels" aria-label="What is real and what is simulated">${LABELS.map((l) => `<li>${esc(l.text)}</li>`).join("")}</ul>
</div></section>
<div class="wrap">
  <section class="sec" aria-labelledby="h-ch"><h2 id="h-ch">Chapters</h2><ol class="rail">${rail}</ol></section>
  <section class="sec" aria-labelledby="h-runs"><h2 id="h-runs">What you just saw ran for real</h2><ul class="runs">${runs.map((r) => `<li><a href="${esc(r.href)}" target="_blank" rel="noopener"><span class="rl">${icon("circle-check", 16)}${esc(r.rail)}<time>${esc(r.day)}</time></span><span class="tx">${esc(r.text)}</span><span class="go">The record ↗</span></a></li>`).join("")}</ul></section>
  <details class="card tr"><summary>${icon("receipt", 18)}The full transcript</summary><ol class="lines">${f.rows.map((r) => `<li><time>${clock(r.at)}</time><span><small>${esc(r.who)}</small>${esc(r.text)}</span></li>`).join("")}</ol></details>
  <p class="fnext"><a class="btn primary nextstep" href="${TRY_URL}" data-next="try">${icon("scan-face", 18)}Now try it yourself</a></p>
</div>
</main>`;
  return page({
    title: "The film", description: `Purser in ${len}: AI agents pay company bills only within limits the CFO signs with Face ID. Chapters, the runs it shows with their records, and the transcript.`,
    tab: "watch", css: CSS, body, ...(id ? { js: JS, stage: false } : {}),
    source: "Source: src/film/cuts.ts (the walkthrough's cut list), the run records each line names (src/film/claims.ts), and the film's own frames (src/film/stills/).",
  });
}

/** The page's CSP: no script and no frame without a film; with one, its script and youtube-nocookie.com's player only. */
export function filmWatchCsp(html: string, hasFilm: boolean, cspFor: (p: string) => string, styleOnly: (p: string) => string): string {
  return hasFilm ? `${cspFor(html)}; frame-src ${EMBED}` : styleOnly(html);
}
