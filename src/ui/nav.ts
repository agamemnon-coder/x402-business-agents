// The one navigation every guest page carries: five main links and the rest under "More", so a juror sees one short
// path (Overview, Try it, Metal, the CFO dashboard, Watch). Put into each page by src/servers/dashboard.ts before the
// page's CSP hash is taken; "More" is a <details> element, so it needs no script. Colours come from the page's own
// tokens, with fallbacks for pages that name them differently.

export type NavKey = "home" | "watch" | "try" | "proof" | "overview" | "metal" | "dashboard" | "live" | "demo" | "month" | "lab" | "visa" | "airwallex" | "claude";

/** Four tabs, nothing else (redesign, Max 2 Nov): every other page is reached from Proof. */
export const NAV_MAIN: [NavKey, string, string][] = [
  ["home", "Home", "home"],
  ["watch", "Watch", "watch"],
  ["try", "Try", "try"],
  ["proof", "Proof", "proof"],
];

/** Which tab a page belongs to: the detail pages and the dashboard sit under Proof. */
const TAB_OF: Partial<Record<NavKey, NavKey>> = { overview: "home", live: "watch", demo: "watch", metal: "proof", dashboard: "proof", month: "proof", lab: "proof", visa: "proof", airwallex: "proof", claude: "proof" };

/** The navigation, with the current tab marked. */
export function navHtml(current: NavKey | null, id?: string, cls?: string): string {
  const on = current ? TAB_OF[current] ?? current : null;
  return `<nav class="${cls ? `${cls} ` : ""}pnav"${id ? ` id="${id}"` : ""} aria-label="Main">${NAV_MAIN.map(([key, label, href]) => `<a href="${href}" data-nav="${key}"${key === on ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

/** The redesign's tabs (src/redesign/ui.ts), the same on every page; colours from the page's own tokens. */
export const NAV_CSS = `.pnav { display: flex !important; align-items: center; gap: 2px !important; flex-wrap: nowrap !important; margin-left: auto !important; background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); border-radius: 999px; padding: 4px; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important; width: auto !important; }
.pnav > a { text-decoration: none; color: var(--muted, #667085) !important; font: 600 15px/1.2 Inter, system-ui, sans-serif !important; padding: 8px 14px !important; border-radius: 999px; white-space: nowrap; }
.pnav > a:hover { color: var(--text, #0b1220) !important; }
.pnav > a.on { color: var(--text, #0b1220) !important; background: var(--surface, var(--panel, #fff)); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
@media (max-width: 420px) { .pnav > a { padding: 8px 11px !important; } }`;

/** Purser's mark (a feather), the same on every page's brand. */
const MARK = '<span class="mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg></span>';

/** One header for every page (design review, 1 Nov): the same height, gutter, brand and order, whatever each page's own
 *  stylesheet said; it wins by selector weight (header.top), so each page keeps its own extra chips and buttons. */
export const TOP_CSS = `header.top { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; min-height: 64px; height: auto; padding: 10px max(24px, calc((100% - 1200px) / 2)); background: var(--surface, var(--panel, #fff)); border-bottom: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); }
header.top .brand { display: inline-flex; align-items: center; gap: 10px; font: 700 16px/1 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text, #0b1220); text-decoration: none; white-space: nowrap; }
header.top .brand .mark { width: 28px; height: 28px; border-radius: 8px; background: var(--accent, #4f46e5); color: #fff; display: inline-grid; place-items: center; flex: none; }
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
