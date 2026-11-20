// The static files the public pages link with a content version in their address (site audit, 19 Nov,
// docs/evidence/site-quality.md finding 6: "Use efficient cache lifetimes"). Each version is the first 12 hex digits of
// the SHA-256 of the bytes served at /assets/<name>; test/site-audit-fixes.test.ts holds each to its file, so a new
// file without a new version fails there. The Worker sends a year's immutable cache only when the address's ?v= is the
// version of the bytes it serves (worker/src/core.ts, Pages.versions, computed from the bytes at build): a stale or
// missing ?v= gets the usual day. No file system here: Purser Cloud's pages import it too.

export const ASSET_VERSIONS = {
  "inter.woff2": "3100e775e861",
  "logo-airwallex.png": "8ff76b83dde9",
  "logo-claude-slate.svg": "02737f748297",
} as const;

export type VersionedAsset = keyof typeof ASSET_VERSIONS;

/** The file's name with its version: "<name>?v=<version>", relative like every link on the pages (prefix "/" or "assets/" as needed). */
export const versioned = (name: VersionedAsset): string => `${name}?v=${ASSET_VERSIONS[name]}`;

/** The Cache-Control of a static file whose address carries its content version: a year, never revalidated. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/** The Cache-Control of a static file asked for without its version (or with an old one): a day, as before. */
export const DAY_CACHE = "public, max-age=86400";
