// The new film on /watch (the walkthrough, src/film/cuts.ts WALKTHROUGH). One constant decides both states of the
// page and whether "Watch" is a tab: while FILM_YOUTUBE_ID is empty, /watch shows the poster and "Film coming", its
// chapters as a list, and Watch stays out of the menu (the home-story stream keeps it out until the new film exists).
// Once the owner has uploaded the film, its YouTube id goes here (11 characters, e.g. from youtu.be/<id>): /watch
// then embeds it (youtube-nocookie.com, allowed by that page's CSP only), each chapter jumps in the film, and Watch
// may return as a tab (WATCH_IN_MENU). test/watch-film.test.ts holds both states.

export const FILM_YOUTUBE_ID: string = "";

/** A YouTube id is 11 characters of A–Z, a–z, 0–9, _ and -; anything else is treated as no film. */
export const filmId = (id: string = FILM_YOUTUBE_ID): string | null => (/^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);

/** Watch is a tab in the menu only once the film is there. */
export const WATCH_IN_MENU = filmId() !== null;
