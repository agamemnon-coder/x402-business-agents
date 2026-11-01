// The one navigation every guest page carries: five main links and the rest under "More", so a juror sees one short
// path (Overview, Try it, Metal, the CFO dashboard, Watch). Put into each page by src/servers/dashboard.ts before the
// page's CSP hash is taken; "More" is a <details> element, so it needs no script. Colours come from the page's own
// tokens, with fallbacks for pages that name them differently.

export type NavKey = "overview" | "try" | "metal" | "dashboard" | "watch" | "live" | "demo" | "month" | "lab" | "visa";

export const NAV_MAIN: [NavKey, string, string][] = [
  ["overview", "Overview", "./"],
  ["try", "Try it", "try"],
  ["metal", "Metal", "metal"],
  ["dashboard", "CFO dashboard", "./?recorded"],
  ["watch", "Watch", "film"],
];

export const NAV_MORE: [NavKey, string, string][] = [
  ["live", "Live", "live"],
  ["demo", "Recorded run", "demo"],
  ["month", "A month", "month"],
  ["lab", "Scenario Lab", "lab"],
  ["visa", "Agent recognition (dev test)", "visa"],
];

const link = ([key, label, href]: [NavKey, string, string], current: NavKey | null) =>
  `<a href="${href}" data-nav="${key}"${key === current ? ' class="on" aria-current="page"' : ""}>${label}</a>`;

/** The navigation, with `current` marked; a page under "More" opens nothing but marks "More" as where you are. */
export function navHtml(current: NavKey | null, id?: string, cls?: string): string {
  const inMore = NAV_MORE.some(([k]) => k === current);
  return `<nav class="${cls ? `${cls} ` : ""}pnav"${id ? ` id="${id}"` : ""} aria-label="Main">${NAV_MAIN.map((l) => link(l, current)).join("")}<details class="pmore"><summary${inMore ? ' class="on"' : ""}>More</summary><div class="pmenu">${NAV_MORE.map((l) => link(l, current)).join("")}</div></details></nav>`;
}

export const NAV_CSS = `.pnav { display: flex; align-items: center; gap: 2px !important; flex-wrap: wrap !important; min-width: 0; max-width: 100%; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important; }
.pnav > a, .pmore > summary { text-decoration: none; color: var(--muted, #667085); font: 500 14px/1.2 Inter, system-ui, sans-serif; padding: 8px 11px; border-radius: 8px; white-space: nowrap; cursor: pointer; }
.pnav > a:hover, .pmore > summary:hover { color: var(--text, #0b1220); }
.pnav a.on, .pmore > summary.on { color: var(--text, #0b1220); background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); }
.pmore { position: relative; }
.pmore > summary { list-style: none; } .pmore > summary::-webkit-details-marker { display: none; }
.pmore > summary::after { content: " ▾"; font-size: 11px; }
.pmenu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 230px; display: flex; flex-direction: column; padding: 6px; border-radius: 12px; background: var(--surface, var(--panel, #fff)); border: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); box-shadow: 0 12px 32px rgba(0,0,0,.18); }
.pmenu a { text-decoration: none; color: var(--text, #0b1220); font: 500 14px/1.3 Inter, system-ui, sans-serif; padding: 9px 12px; border-radius: 8px; }
.pmenu a:hover, .pmenu a.on { background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); }
/* On a phone the brand already links home, so "Overview" makes room for the other four and "More". The gap is the
   nav's own on every page (a page's ".top nav { gap: 14px }" pushed "More" onto a line of its own at 390 px),
   and so are its sizes on a phone (".pnav.pnav" outweighs a page's own ".top .nav a"). */
@media (max-width: 560px) { .pnav.pnav > a, .pnav .pmore > summary { padding: 6px 7px; font-size: 13px; } .pnav > a[data-nav="overview"] { display: none; } }
@media (max-width: 380px) { .pnav.pnav > a, .pnav .pmore > summary { padding: 6px 5px; font-size: 12.5px; } }
@media (max-width: 340px) { .pnav.pnav > a, .pnav .pmore > summary { padding: 6px 3px; font-size: 12px; } }
/* Below laptop width "More" can wrap anywhere in the row, so its menu hangs from the whole nav, not from "More":
   it then always opens on the screen (the site check found it off the left edge at 390 px). */
@media (max-width: 900px) { .pnav { position: relative; } .pmore { position: static; } .pmenu { right: 0; left: auto; max-width: calc(100vw - 24px); } }`;

/** Purser's mark (a feather), the same on every page's brand. */
const MARK = '<span class="mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg></span>';

/** One header for every page (design review, 1 Nov): the same height, gutter, brand and order, whatever each page's own
 *  stylesheet said; it wins by selector weight (header.top), so each page keeps its own extra chips and buttons. */
export const TOP_CSS = `header.top { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-height: 64px; height: auto; padding: 10px max(24px, calc((100% - 1200px) / 2)); background: var(--surface, var(--panel, #fff)); border-bottom: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); }
header.top .brand { display: inline-flex; align-items: center; gap: 10px; font: 700 16px/1 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text, #0b1220); text-decoration: none; white-space: nowrap; }
header.top .brand .mark { width: 28px; height: 28px; border-radius: 8px; background: var(--accent, #4f46e5); color: #fff; display: inline-grid; place-items: center; flex: none; }
header.top .brand .mark svg { width: 16px; height: 16px; }
header.top nav.pnav { margin-left: 0; width: auto; }
@media (max-width: 900px) { header.top { padding: 10px 16px; gap: 6px 10px; } header.top nav.pnav { width: 100%; order: 10; } }`;

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
