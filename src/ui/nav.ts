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

export const NAV_CSS = `.pnav { display: flex; align-items: center; gap: 2px; flex-wrap: wrap !important; min-width: 0; max-width: 100%; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important; }
.pnav > a, .pmore > summary { text-decoration: none; color: var(--muted, #667085); font: 500 14px/1.2 Inter, system-ui, sans-serif; padding: 8px 11px; border-radius: 8px; white-space: nowrap; cursor: pointer; }
.pnav > a:hover, .pmore > summary:hover { color: var(--text, #0b1220); }
.pnav a.on, .pmore > summary.on { color: var(--text, #0b1220); background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); }
.pmore { position: relative; }
.pmore > summary { list-style: none; } .pmore > summary::-webkit-details-marker { display: none; }
.pmore > summary::after { content: " ▾"; font-size: 11px; }
.pmenu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 230px; display: flex; flex-direction: column; padding: 6px; border-radius: 12px; background: var(--surface, var(--panel, #fff)); border: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); box-shadow: 0 12px 32px rgba(0,0,0,.18); }
.pmenu a { text-decoration: none; color: var(--text, #0b1220); font: 500 14px/1.3 Inter, system-ui, sans-serif; padding: 9px 12px; border-radius: 8px; }
.pmenu a:hover, .pmenu a.on { background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); }
/* On a phone the brand already links home, so "Overview" makes room for the other four and "More". */
@media (max-width: 560px) { .pnav > a, .pmore > summary { padding: 6px 7px; font-size: 13px; } .pnav > a[data-nav="overview"] { display: none; } .pmenu { right: 0; left: auto; } }`;

/** Replaces a page's own navigation with the shared one and adds its style (before the page's CSP hash is taken). */
export function withNav(page: string, current: NavKey | null): string {
  const nav = /<nav\b[^>]*>[\s\S]*?<\/nav>/;
  if (!nav.test(page)) throw new Error("the page has no navigation to replace");
  // The page's own id and class stay, so its layout rules (a row of its own on phones) still apply.
  const id = /<nav\b[^>]*\bid="([^"]+)"/.exec(page)?.[1];
  const cls = /<nav\b[^>]*\bclass="([^"]+)"/.exec(page)?.[1];
  return page.replace(nav, () => navHtml(current, id, cls)).replace("</style>", () => `${NAV_CSS}\n</style>`);
}
