// /watch is the film (the owner, 12 Nov: "the Watch can really be much better"): the poster first, the chapters with
// their times, a short key of what is real and what is simulated, the transcript folded. Two states, one constant
// (src/config/film.ts): without the film's YouTube id, the poster says "Film coming", no script, no frame, and Watch
// is not a tab; with an id, the player from youtube-nocookie.com only, each chapter jumps there, and Watch may be a tab.
// The replay of the main run that was at /watch answers at /replay.
import { describe, expect, it } from "vitest";
import { FILM_YOUTUBE_ID, WATCH_IN_MENU, filmId } from "../src/config/film.js";
import { WALKTHROUGH, chapters, claimHolds, clock, resolveCut, total } from "../src/film/cuts.js";
import { CLAIMS } from "../src/film/claims.js";
import { REAL, SIMULATED } from "../src/film/key.js";
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
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");
const placed = resolveCut(WALKTHROUGH);

describe("/watch without the film (as today)", () => {
  it("is the film page with its poster and \"Film coming\", and no script, frame or link to YouTube", () => {
    expect(FILM_YOUTUBE_ID).toBe("");
    expect(filmId()).toBeNull();
    expect(FILM_WATCH_PAGE).toBe(none);
    expect(none).toContain("<h1>The film</h1>");
    expect(none).toContain(`Film coming · about ${clock(total(placed))}`);
    expect(none).not.toMatch(/<script|<iframe|youtube|youtu\.be/);
    expect(FILM_WATCH_CSP).not.toMatch(/script-src|frame-src/);
    expect(FILM_WATCH_CSP).toMatch(/^default-src 'none'; style-src 'sha256-/);
  });

  it("lists the chapters with the film's times, as plain lines (nothing to jump to yet)", () => {
    const ch = chapters(placed);
    expect(ch.length).toBeGreaterThanOrEqual(10);
    for (const c of ch) expect(none).toContain(`<span class="it"><time>${clock(c.at)}</time><span>${c.title.replace(/&/g, "&amp;")}</span></span>`);
    expect(none).not.toContain("data-t=");
  });

  it("is served at /watch in both builds; the replay answers at /replay, and its old addresses lead there", () => {
    for (const pages of [buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv), buildPages({} as NodeJS.ProcessEnv)]) {
      const r = pageResponse(new Request(`${SITE}/watch`), pages)!;
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toBe(pages.csp.watch);
      expect(pages.watch).toContain("<h1>The film</h1>");
      const replay = pageResponse(new Request(`${SITE}/replay`), pages)!;
      expect(replay.status).toBe(200);
      expect(pages.replay).toContain("Watch the agents work");
      expect(replay.headers.get("content-security-policy")).toBe(pages.csp.replay);
      for (const old of ["/live", "/demo"]) expect(pageResponse(new Request(`${SITE}${old}`), pages)?.headers.get("location")).toBe("/replay");
    }
    expect(WATCH_PAGE).toContain("Watch the agents work");
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
    for (const c of chapters(placed)) expect(withFilm).toContain(`<a href="https://youtu.be/${ID}?t=${c.at}" data-t="${c.at}"><time>${clock(c.at)}</time>`);
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
  it("the key of what is real and what is simulated rests on claims that hold in their records", () => {
    for (const l of [...REAL, ...SIMULATED]) {
      expect(text(none)).toContain(l.text.replace(/&/g, "&"));
      for (const c of l.claims) {
        expect(CLAIMS.some((x) => x.id === c)).toBe(true);
        expect({ line: l.text, c, holds: claimHolds(c) }).toEqual({ line: l.text, c, holds: true });
      }
    }
    expect(text(none)).toContain("Ran for real, with test money");
    expect(text(none)).toContain("Simulated, and said so");
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
