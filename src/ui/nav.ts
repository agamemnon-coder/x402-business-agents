// The one navigation every older (template) page carries, the same five items as the redesign's header
// (src/redesign/ui.ts): the four tabs, then "More" with the pages under it (src/ui/more.ts, one list for both). Put into
// each page by src/servers/dashboard.ts before the page's CSP hash is taken; "More" is a <details> element, so it needs
// no script. Colours come from the page's own tokens, with fallbacks for pages that name them differently.

import { MORE_CSS, moreHtml } from "./more.js";

import { WATCH_IN_MENU } from "../config/film.js";

export type NavKey = "home" | "watch" | "try" | "proof" | "overview" | "metal" | "dashboard" | "live" | "demo" | "month" | "lab" | "visa" | "airwallex" | "claude";

/** The four tabs (redesign, Max 2 Nov); the fifth item, "More", follows them in navHtml (12 Nov). */
export const NAV_MAIN: [NavKey, string, string][] = ([
  ["home", "Home", "home"],
  ["watch", "Watch", "watch"],
  ["try", "Try", "try"],
  ["proof", "Proof", "proof"],
] as [NavKey, string, string][]).filter(([k]) => k !== "watch" || WATCH_IN_MENU);

/** Which tab a page belongs to: the detail pages and the dashboard sit under Proof. */
// The partner pages (metal, visa, airwallex, claude) are listed under "More" (12 Nov): they mark it themselves (moreHtml), not Proof.
const TAB_OF: Partial<Record<NavKey, NavKey>> = { overview: "home", live: "watch", demo: "watch", dashboard: "proof", month: "proof", lab: "proof" };

/** The navigation, with the current tab marked: the four tabs, then "More". */
export function navHtml(current: NavKey | null, id?: string, cls?: string): string {
  const on = current ? TAB_OF[current] ?? current : null;
  return `<nav class="${cls ? `${cls} ` : ""}pnav"${id ? ` id="${id}"` : ""} aria-label="Main">${NAV_MAIN.map(([key, label, href]) => `<a href="${href}" data-nav="${key}"${key === on ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}${moreHtml(on)}</nav>`;
}

/** The redesign's tabs (src/redesign/ui.ts), the same on every page; colours from the page's own tokens. */
export const NAV_CSS = `.pnav { display: flex !important; align-items: center; gap: 2px !important; flex-wrap: nowrap !important; margin-left: auto !important; background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); border-radius: 999px; padding: 4px; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important; width: auto !important; }
.pnav > a { text-decoration: none; color: var(--muted, #667085) !important; font: 600 15px/1.2 Inter, system-ui, sans-serif !important; padding: 8px 14px !important; border-radius: 999px; white-space: nowrap; }
.pnav > a:hover { color: var(--text, #0b1220) !important; }
.pnav > a.on { color: var(--text, #0b1220) !important; background: var(--surface, var(--panel, #fff)); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
${MORE_CSS}
.pnav .pmore > summary { padding: 8px 12px 8px 14px; }
/* On a phone the five items stay on one line (checked at 360 px), in the same steps as the redesign's header; a page's
   own phone sizes for its tabs are outweighed. Where the items do not fit beside a brand and a page's own button (Try,
   under about 450 px), the header wraps and the tabs take a line of their own, as Try's did under 400 px. */
@media (max-width: 520px) { header.top { flex-wrap: wrap !important; } header.top nav.pnav.pnav > a { padding: 8px 10px !important; font-size: 15px !important; } .pnav .pmore > summary { padding: 8px 8px 8px 10px; } }
@media (max-width: 460px) { .pnav { gap: 0 !important; } header.top nav.pnav.pnav > a { padding: 8px 8px !important; font-size: 14.5px !important; } .pnav .pmore > summary { padding: 8px 6px 8px 8px; font-size: 14.5px; } }
@media (max-width: 380px) { header.top nav.pnav.pnav > a { padding: 8px 7px !important; } .pnav .pmore > summary { padding: 8px 5px 8px 7px; } }
@media (max-width: 340px) { header.top nav.pnav.pnav > a { padding: 8px 5px !important; font-size: 14px !important; } .pnav .pmore > summary { padding: 8px 4px 8px 5px; font-size: 14px; gap: 2px; } }`;

/** Purser's mark (a feather), the same on every page's brand. */
const MARK = '<span class="mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg></span>';

/** One header for every page (design review, 1 Nov): the same height, gutter, brand and order, whatever each page's own
 *  stylesheet said; it wins by selector weight (header.top), so each page keeps its own extra chips and buttons. */
export const TOP_CSS = `header.top { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-height: 64px; height: auto; padding: 10px max(32px, calc((100% - 1200px) / 2 + 32px)); background: var(--bg, var(--surface, #fff)); border-bottom: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); }
header.top .brand { display: inline-flex; align-items: center; gap: 9px; font: 750 18px/1 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text, #0b1220); text-decoration: none; white-space: nowrap; }
header.top .brand .mark { width: 30px; height: 30px; border-radius: 9px; background: var(--text, #0b1220); color: var(--bg, #fff); display: inline-grid; place-items: center; flex: none; }
header.top .brand .mark svg { width: 16px; height: 16px; }
header.top nav.pnav { margin-left: auto; width: auto; }
@media (max-width: 900px) { header.top { padding: 10px 16px; gap: 6px 10px; } }`;

/** Replaces a page's own navigation with the shared one and adds its style (before the page's CSP hash is taken). */
export function withNav(page: string, current: NavKey | null): string {
  const nav = /<nav\b[^>]*>[\s\S]*?<\/nav>/;
  if (!nav.test(page)) throw new Error("the page has no navigation to replace");
  // The page's own id and class stay, so its layout rules (a row of its own on phones) still apply.
  const id = /<nav\b[^>]*\bid="([^"]+)"/.exec(page)?.[1];
  const cls = /<nav\b[^>]*\bclass="([^"]+)"/.exec(page)?.[1];
  return page.replace(nav, () => navHtml(current, id, cls))
    // The same mark in every brand: pages that drew a plain square get the feather.
    .replace(/(<a class="brand"[^>]*>)<i><\/i>/, (_m, a: string) => `${a}${MARK}`)
    .replace("</style>", () => `${NAV_CSS}\n${TOP_CSS}\n</style>`);
}
