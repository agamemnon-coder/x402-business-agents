// /watch is the film (the owner, 12 Nov: "the Watch can really be much better"): the poster first, the chapters with
// their times, a short key of what is real and what is simulated, the transcript folded. Two states, one constant
// (src/config/film.ts): without the film's YouTube id, the poster says "Film coming", no script, no frame, and Watch
// is not a tab; with an id, the player from youtube-nocookie.com only, each chapter jumps there, and Watch may be a tab.
// The replay of the main run that was at /watch answers at /replay.
import { describe, expect, it } from "vitest";
import { FILM_YOUTUBE_ID, WATCH_IN_MENU, filmId } from "../src/config/film.js";
import { WALKTHROUGH, chapters, claimHolds, clock, resolveCut, total } from "../src/film/cuts.js";
import { CLAIMS } from "../src/film/claims.js";
import { LABELS, REPO_BLOB, RUNS_SEEN, runsSeen } from "../src/film/key.js";
import { STILL_SHOTS, filmStills, stillAsset } from "../src/film/stills.js";
import { filmFacts, filmWatchCsp, filmWatchPage } from "../src/redesign/filmWatch.js";
import { buildPages } from "../src/relay/assets.js";
import { FILM_WATCH_CSP, FILM_WATCH_PAGE, WATCH_PAGE } from "../src/servers/dashboard.js";
import { header } from "../src/redesign/ui.js";
import { NAV_MAIN, navHtml } from "../src/ui/nav.js";
import { pageResponse } from "../worker/src/core.js";

const SITE = "https://x.test";
const ID = "AbCdEfGhIj_";
const none = filmWatchPage({ id: null });
const withFilm = filmWatchPage({ id: ID });
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const placed = resolveCut(WALKTHROUGH);

describe("/watch without the film (as today)", () => {
  it("is the film page with its poster and \"Film coming\", and no script, frame or link to YouTube", () => {
    expect(FILM_YOUTUBE_ID).toBe("");
    expect(filmId()).toBeNull();
    expect(FILM_WATCH_PAGE).toBe(none);
    expect(none).toContain("<h1>Purser, in under five minutes</h1>");
    expect(none).toContain(`Film coming · ${clock(total(placed))}`);
    // The poster is a real frame of the film (Home's hero), served from the site's own assets.
    expect(none).toContain('<img src="assets/film-poster.webp" alt="" width="1600" height="900" fetchpriority="high">');
    expect(none).not.toMatch(/<script|<iframe|youtube|youtu\.be/);
    expect(FILM_WATCH_CSP).not.toMatch(/script-src|frame-src/);
    expect(FILM_WATCH_CSP).toMatch(/^default-src 'none'; style-src 'sha256-/);
  });

  it("shows the chapters as a rail of thumbnails with the film's times, nothing to jump to yet", () => {
    const ch = chapters(placed);
    expect(ch.length).toBeGreaterThanOrEqual(10);
    for (const c of ch) expect(none).toMatch(new RegExp(`<li><span class="ch"><span class="th">[\\s\\S]*?<time>${clock(c.at)}</time></span><b>${c.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</b></span></li>`));
    expect(none).not.toContain("data-t=");
  });

  it("each thumbnail is a real frame of the chapter's first shot; a chapter on footage not yet recorded is a plain tile", () => {
    const facts = filmFacts();
    const stills = filmStills();
    for (const c of facts.chapters) {
      if (c.still) { expect(stills[c.still]?.type).toBe("image/webp"); expect(none).toContain(`<img src="assets/${c.still}"`); }
      else expect(["Max on camera", "On the phone"]).toContain(c.tile!.label);
    }
    expect(facts.chapters.filter((c) => c.still).length).toBeGreaterThanOrEqual(9);
    expect(facts.chapters[0]!.tile?.label).toBe("Max on camera");
    // Each still is small, and the Worker serves it at /assets/film-<name> with its type.
    const pages = buildPages({} as NodeJS.ProcessEnv);
    for (const [name, s] of Object.entries(stills)) {
      expect(s.body.length).toBeLessThan(name === "film-poster.webp" ? 120_000 : 40_000);
      const r = pageResponse(new Request(`${SITE}/assets/${name}`), pages)!;
      expect({ name, status: r.status, type: r.headers.get("content-type") }).toEqual({ name, status: 200, type: "image/webp" });
    }
    expect(stillAsset("poster.webp") in stills).toBe(true);
    expect(STILL_SHOTS).toContain("T3");
  });

  it("is served at /watch in both builds; the replay answers at /replay, and its old addresses lead there", () => {
    for (const pages of [buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv), buildPages({} as NodeJS.ProcessEnv)]) {
      const r = pageResponse(new Request(`${SITE}/watch`), pages)!;
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toBe(pages.csp.watch);
      expect(pages.watch).toContain("<h1>Purser, in under five minutes</h1>");
      const replay = pageResponse(new Request(`${SITE}/replay`), pages)!;
      expect(replay.status).toBe(200);
      // The replay's heading since 12 Nov (home-story): what it is and its day, read from the record.
      expect(pages.replay).toContain("<h1>Replay of the main run, 3 November</h1>");
      expect(replay.headers.get("content-security-policy")).toBe(pages.csp.replay);
      for (const old of ["/live", "/demo"]) expect(pageResponse(new Request(`${SITE}${old}`), pages)?.headers.get("location")).toBe("/replay");
    }
    expect(WATCH_PAGE).toContain("Replay of the main run, 3 November");
  });

  it("keeps Watch out of every menu until the film is there (one constant)", () => {
    expect(WATCH_IN_MENU).toBe(false);
    expect(NAV_MAIN.map(([k]) => k)).not.toContain("watch");
    expect(navHtml(null)).not.toMatch(/Watch/);
    expect(header(null)).not.toMatch(/>Watch</);
    const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
    for (const name of ["home", "watch", "replay", "proof", "metal", "airwallex", "visa", "claude"] as const) {
      const nav = /<nav[^>]*aria-label="Main"[^>]*>[\s\S]*?<\/nav>/.exec((pages as unknown as Record<string, string>)[name]!)?.[0] ?? "";
      expect({ name, watch: /Watch/.test(nav) }).toEqual({ name, watch: false });
    }
  });
});

describe("/watch with the film's id set", () => {
  it("shows the poster with its play button; the player loads from youtube-nocookie.com only when asked", () => {
    expect(withFilm).toContain(`<div class="player" id="player" data-id="${ID}">`);
    expect(withFilm).toContain(`<button class="poster" id="play" type="button" aria-label="Play the film (${clock(total(placed))})">`);
    expect(withFilm).not.toContain("<iframe");
    expect(withFilm).toContain('"https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0&start="');
    // Without script, the poster is a link to the film.
    expect(withFilm).toContain(`<noscript><a class="poster" href="https://youtu.be/${ID}">`);
    expect(withFilm).not.toContain("Film coming");
  });

  it("makes each chapter a link that jumps to its time (the script plays it in place)", () => {
    for (const c of chapters(placed)) expect(withFilm).toContain(`<li><a class="ch" href="https://youtu.be/${ID}?t=${c.at}" data-t="${c.at}"><span class="th">`);
  });

  it("allows its one script and youtube-nocookie.com's frame, nothing more", () => {
    const csp = filmWatchCsp(withFilm, true, () => "default-src 'none'; script-src 'sha256-x'; style-src 'sha256-y'", () => "style-only");
    expect(csp).toBe("default-src 'none'; script-src 'sha256-x'; style-src 'sha256-y'; frame-src https://www.youtube-nocookie.com");
    expect(filmWatchCsp(none, false, () => "x", () => "style-only")).toBe("style-only");
  });

  it("refuses an id that is not a YouTube id (no film then)", () => {
    for (const bad of ["", "short", "has spaces!", 'x"><script>', "kCUsFHrxE-o-too-long"]) expect(filmId(bad)).toBeNull();
    expect(filmId("kCUsFHrxE-o")).toBe("kCUsFHrxE-o");
    expect(filmWatchPage({ id: 'x"><script>' })).toBe(none);
  });
});

describe("the page says what the film says", () => {
  it("\"What you just saw ran for real\": each run links its own record, and rests on claims that hold", () => {
    const shown = runsSeen();
    // The five written entries are always there; a later run's entry only when its record is (Face ID on chain is, 12 Nov).
    expect(shown.map((r) => r.rail).filter((_, i) => !/faceid|tokeni/.test(shown[i]!.file))).toEqual(["Airwallex", "Metal", "Visa via Airi", "Claude", "Moneybird"]);
    for (const r of shown) {
      expect(none).toContain(`<a href="${r.href}" target="_blank" rel="noopener">`);
      expect(r.href).toBe(REPO_BLOB + r.file);
      expect(text(none)).toContain(r.text);
    }
    for (const r of RUNS_SEEN) for (const c of r.claims) {
      expect(CLAIMS.some((x) => x.id === c)).toBe(true);
      expect({ run: r.rail, c, holds: claimHolds(c) }).toEqual({ run: r.rail, c, holds: true });
    }
    for (const l of LABELS) { expect(text(none)).toContain(l.text); for (const c of l.claims) expect(claimHolds(c)).toBe(true); }
    expect(text(none)).toMatch(/paid by SWIFT \(settlement simulated\)/);
  });

  it("a run recorded later (Face ID on chain, the invoice token) appears once its record is here, in its record's own words", () => {
    const files = ["2026-11-07-awx-1.md", "2026-11-03-main-run.md", "2026-11-12-faceid-onchain.md", "2026-11-12-tokenize.md", "2026-11-12-tokenize.json"];
    const heads: Record<string, string> = { "docs/runs/2026-11-12-faceid-onchain.md": "# The owners' Face ID on chain, 12 November\n", "docs/runs/2026-11-12-tokenize.md": "# An invoice token on Metal, 12 November\n" };
    const shown = runsSeen(files, (p) => heads[p] ?? "# x\n");
    expect(shown.map((r) => [r.rail, r.day, r.text])).toEqual([
      ["Airwallex", "7 Nov", RUNS_SEEN[0]!.text], ["Metal", "3 Nov", RUNS_SEEN[1]!.text],
      ["Metal", "12 Nov", "The owners' Face ID on chain, 12 November"], ["Metal", "12 Nov", "An invoice token on Metal, 12 November"],
      ["Claude", "3 Nov", RUNS_SEEN[5]!.text],
    ]);
    // Not here: not shown.
    expect(runsSeen(["2026-11-07-awx-1.md"], () => "# x\n").map((r) => r.rail)).toEqual(["Airwallex"]);
  });

  it("the transcript, folded, is the film's narration row by row, with its times", () => {
    const fold = /<details class="card tr">[\s\S]*?<\/details>/.exec(none)![0];
    expect(fold).toContain("<summary>");
    const facts = filmFacts();
    expect(facts.rows.length).toBe(placed.filter((p) => p.row.words).length);
    for (const r of facts.rows) expect(text(fold)).toContain(`${clock(r.at)} ${r.who} ${r.text}`);
    expect(text(fold)).toContain("Hi, I'm Max.");
  });

  it("names no anonymous person by a gendered pronoun and quotes no one", () => {
    expect(text(none)).not.toMatch(/\b(he|she|his|her|him)\b/i);
    expect(none).not.toMatch(/<blockquote|<q>/);
  });
});

describe("the next step", () => {
  it("ends in \"Now try it yourself\": /try/sign when the bundle has it, else /try", () => {
    expect(buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).watch).toContain('<a class="btn primary nextstep" href="try/sign" data-next="try">');
    expect(buildPages({} as NodeJS.ProcessEnv).watch).toContain('<a class="btn primary nextstep" href="try" data-next="try">');
  });
});

describe("motion", () => {
  it("the poster drifts, the play button pulses and the rail rises in, and all of it stops under prefers-reduced-motion", () => {
    for (const k of ["@keyframes drift", "@keyframes ping", "@keyframes rise"]) expect(none).toContain(k);
    expect(none).toContain("@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }");
    expect(withFilm).toContain('matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"');
  });
});
