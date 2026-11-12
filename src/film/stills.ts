// The stills /watch shows (made by npm run cut -- --stills from the shot clips, kept in src/film/stills/): the poster,
// a real frame of Home's hero, and one thumbnail per chapter, the last frame of the chapter's first shot. A chapter
// that opens on the owner's own footage (Max on camera, the phone walk) has no frame yet: the page draws a plain tile
// for it instead of a picture of something that was not filmed.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CUTS, ROOT } from "./cuts.js";

export const STILLS_DIR = resolve(ROOT, "src/film/stills");

/** The shots a chapter can open on, in either cut and either variant: the ones a thumbnail is made for. */
export const STILL_SHOTS: readonly string[] = [...new Set(Object.values(CUTS).flatMap((c) => c.rows.flatMap((r) => [r, ...(r.fallback ? [r.fallback] : [])])).filter((r) => r.chapter).flatMap((r) => r.segs[0]?.shot ?? []))];

/** The asset name a still is served under (/assets/film-<name>). */
export const stillAsset = (file: string) => `film-${file}`;

/** Every still in the repository, by asset name, for the site's assets (src/servers/dashboard.ts). */
export function filmStills(dir: string = STILLS_DIR): Record<string, { type: string; body: Buffer }> {
  const names = ["poster.webp", ...STILL_SHOTS.map((s) => `${s}.webp`)];
  return Object.fromEntries(names.filter((n) => existsSync(resolve(dir, n))).map((n) => [stillAsset(n), { type: "image/webp", body: readFileSync(resolve(dir, n)) }]));
}
