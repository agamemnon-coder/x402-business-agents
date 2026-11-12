// The product pages under "More" (src/ui/more.ts): /pricing and /security (12 Nov). One layout for them, in the partner
// pages' style (src/redesign/partners.ts, the same sizes): an honest label, the heading, one lead line, cards, and every
// detail folded. Only the design system's tokens and components (src/redesign/ui.ts). No script, so each page is served
// under a style-only policy; /status alone carries one small script, which reads the site's own /health.

import { existsSync, readFileSync } from "node:fs";
import type { MoreKey } from "../ui/more.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon, page } from "./ui.js";

export const PRODUCT_CSS = `.sp { padding: 26px 0 24px; }
.sp .wrap { max-width: 1040px; display: grid; gap: 18px; }
.shd { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.shd h1 { font-size: clamp(30px, 4vw, 48px); font-weight: 780; letter-spacing: -.03em; flex: 1 1 100%; }
.pill.note { white-space: normal; }
.sp .lead { max-width: 40em; }
.cols { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 800px) { .cols.c2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .cols.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .cols .wide { grid-column: 1 / -1; } }
.pc { display: flex; flex-direction: column; gap: 10px; padding: 20px; min-width: 0; }
.pc.fd { padding-bottom: 8px; }
.pc h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-size: 17px; font-weight: 700; letter-spacing: -.01em; line-height: 1.3; }
.pc h2 .ic { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--sunken); color: var(--accent); flex: none; }
.pc p { margin: 0; font-size: 16px; line-height: 1.5; overflow-wrap: anywhere; }
.pc p.sub { font-size: 15px; color: var(--muted); }
.pc code { font: 600 14.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.pc .v { font-size: clamp(32px, 3.4vw, 42px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.pc .v small { font-size: 15px; font-weight: 600; letter-spacing: 0; color: var(--muted); }
.pc .v.words { font-size: 22px; letter-spacing: -.02em; line-height: 1.2; }
ul.ticks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ul.ticks li { display: flex; align-items: flex-start; gap: 8px; font-size: 16px; line-height: 1.4; }
ul.ticks li .i { color: var(--ok); margin-top: 3px; }
.links { display: flex; flex-wrap: wrap; gap: 4px 16px; }
a.pf { display: inline-flex; align-items: center; min-height: 24px; color: var(--accent); font-weight: 600; text-decoration: none; font-size: 15px; }
a.pf:hover { text-decoration: underline; }
details.fold { margin-top: auto; border-top: 1px solid var(--border); padding-top: 4px; }
details.fold[id] { scroll-margin-top: 80px; }
details.fold > summary { cursor: pointer; font-weight: 650; font-size: 15px; color: var(--accent); list-style: none; display: flex; align-items: center; gap: 6px; min-height: 40px; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::after { content: "▾"; font-size: 14px; } details.fold[open] > summary::after { content: "▴"; }
ul.pl { list-style: none; margin: 4px 0 6px; padding: 0; display: grid; gap: 8px; }
ul.pl li { font-size: 15px; line-height: 1.45; border-left: 3px solid var(--border); padding-left: 11px; overflow-wrap: anywhere; }
ul.pl a.pf { display: inline; font-size: 15px; }
.notyet { margin: 0; font-size: 16px; line-height: 1.5; border-left: 4px solid var(--accent); padding: 4px 0 4px 12px; max-width: 52em; }`;

/** A repository file as text, read where the page is built; missing: an error, so no page is built on a guess. */
export const repoText = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
/**
 * The first of a doc's possible places that is in the repository (12 Nov: another branch moves docs/overview.md to
 * docs/archive/overview.md); none of them: an error, so the page is never built on a missing doc. `has` is for tests.
 */
export function existingDoc(paths: readonly string[], has: (path: string) => boolean = (p) => existsSync(new URL(`../../${p}`, import.meta.url))): string {
  const found = paths.find(has);
  if (!found) throw new Error(`none of ${paths.join(", ")} is in the repository`);
  return found;
}
/** A repository file's address on GitHub (the same base the other pages link to), with an optional #anchor. */
export const repoHref = (path: string, anchor = "") => `${REPO_BLOB}${path}${anchor}`;

/** A link to another site or to a file in the repository: a new tab, marked with an arrow. */
export const outLink = (href: string, label: string) => `<a class="pf" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
/** A link to a page of this site. `next`: the Try tab, which leads to /try/sign where the site serves it (src/relay/assets.ts flowLinks). */
export const siteLink = (href: string, label: string, next = false) => `<a class="pf" href="${esc(href)}"${next ? ` data-next="${esc(href)}"` : ""}>${esc(label)}</a>`;
/** A folded detail: the summary in sight, the lines behind it. */
export const foldHtml = (summary: string, lines: string[]) => `<details class="fold"><summary>${esc(summary)}</summary><ul class="pl">${lines.map((l) => `<li>${l}</li>`).join("")}</ul></details>`;

/** `css`: a page's own few rules after the shared ones. `js`: a page's one inline script (only /status has one; the rest carry none). */
export function productPage(o: { key: MoreKey; title: string; description: string; label: string; h1: string; lead: string; body: string; source: string; real: string[]; css?: string; js?: string }): string {
  const body = `<main class="sp"><div class="wrap">
  <div class="shd"><span class="pill note">${icon("info", 14)}${esc(o.label)}</span><h1>${esc(o.h1)}</h1></div>
  <p class="lead">${esc(o.lead)}</p>
  ${o.body}
</div></main>`;
  return page({ title: o.title, description: o.description, tab: o.key, css: o.css ? `${PRODUCT_CSS}\n${o.css}` : PRODUCT_CSS, body, source: o.source, real: o.real, ...(o.js === undefined ? {} : { js: o.js, stage: false }) });
}
