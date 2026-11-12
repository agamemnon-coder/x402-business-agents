// "More", the fifth item of the main navigation (12 Nov): the product pages (pricing, security, docs, status), then the
// partner pages. One list for both navigations (src/redesign/ui.ts `header`, src/ui/nav.ts `navHtml`) and the footer,
// so the two definitions cannot drift apart. "More" is a <details> element: it opens and closes without any script, by
// mouse, touch or keyboard (Enter or Space on the summary; its links take focus only while it is open).

export type MoreKey = "pricing" | "security" | "docs" | "status" | "airwallex" | "metal" | "visa" | "claude";

export interface MoreLink {
  key: MoreKey;
  label: string;
  /** Relative, like every link on the pages; a page one level down makes its links absolute itself. */
  href: string;
  group: "product" | "partner";
  /**
   * false: this page is not in the site yet, so no menu and no footer links to it. A link to an address the site does
   * not serve fails test/site-v4.test.ts (every internal link answers) and, the other way round, a served page that the
   * menu leaves out fails the same test. Remove the flag in the commit that registers the page.
   */
  built?: false;
}

export const MORE_LABEL = "More";

/** The whole menu, in its order: the product pages first, then the partner pages (names as text, never a logo). */
export const MORE_LINKS: readonly MoreLink[] = [
  { key: "pricing", label: "Pricing", href: "pricing", group: "product" },
  { key: "security", label: "Security", href: "security", group: "product" },
  { key: "docs", label: "Docs", href: "docs", group: "product", built: false },
  { key: "status", label: "Status", href: "status", group: "product", built: false },
  { key: "airwallex", label: "Airwallex", href: "airwallex", group: "partner" },
  { key: "metal", label: "Metal", href: "metal", group: "partner" },
  { key: "visa", label: "Visa", href: "visa", group: "partner" },
  { key: "claude", label: "Claude", href: "claude", group: "partner" },
];

/** The links the pages show: every page of the list that the site serves. */
export const moreLinks = (): MoreLink[] => MORE_LINKS.filter((l) => l.built !== false);
/** The footer repeats the product pages only; the partner pages are reached from Proof and from "More". */
export const footerLinks = (): MoreLink[] => moreLinks().filter((l) => l.group === "product");
export const isMoreKey = (key: string | null): key is MoreKey => MORE_LINKS.some((l) => l.key === key);

/**
 * "More" and its dropdown, the same markup in both navigations: a <details> whose summary is the menu's fifth item, the
 * product pages, one divider, the partner pages. `current` is the page the reader is on, when it is one of these: its
 * link is marked, and so is "More".
 */
export function moreHtml(current: string | null = null): string {
  const links = moreLinks();
  const a = (l: MoreLink) => `<a href="${l.href}"${l.key === current ? ' aria-current="page"' : ""}>${l.label}</a>`;
  const product = links.filter((l) => l.group === "product"), partner = links.filter((l) => l.group === "partner");
  const on = links.some((l) => l.key === current);
  return `<details class="pmore"><summary${on ? ' class="on"' : ""}>${MORE_LABEL}</summary><div class="pmenu">${product.map(a).join("")}${product.length && partner.length ? "<hr>" : ""}${partner.map(a).join("")}</div></details>`;
}

/**
 * The dropdown's style, shared by both navigations (the tabs' own style is each navigation's): the summary looks like a
 * tab; the menu is a card that hangs from "More", the last item, so its right edge is the navigation's and it opens on
 * the screen at every width. Colours are the page's tokens, with fallbacks for the older pages that name theirs
 * differently; `!important` where those pages style every link inside their own navigation.
 */
export const MORE_CSS = `.pmore { position: relative; flex: none; margin: 0; }
.pmore > summary { list-style: none; display: flex; align-items: center; gap: 4px; cursor: pointer; -webkit-user-select: none; user-select: none; text-decoration: none; white-space: nowrap; border-radius: 999px; color: var(--muted, #667085); font: 600 15px/1.2 Inter, system-ui, sans-serif; }
.pmore > summary::-webkit-details-marker { display: none; }
.pmore > summary::after { content: "▾"; font-size: 12px; line-height: 1; }
.pmore[open] > summary::after { content: "▴"; }
.pmore > summary:hover, .pmore[open] > summary { color: var(--text, #0b1220); }
.pmore > summary.on { color: var(--text, #0b1220); background: var(--surface, var(--panel, #fff)); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.pmore > summary:focus-visible, .pmenu a:focus-visible { outline: 3px solid var(--accent, #4f46e5); outline-offset: 2px; }
.pmenu { position: absolute; right: 0; top: calc(100% + 10px); z-index: 60; display: grid; gap: 2px; min-width: 190px; max-width: calc(100vw - 24px); padding: 8px; border-radius: 16px; background: var(--surface, var(--panel, #fff)); border: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -12px rgba(16,24,40,.25); }
.pmenu a { display: block !important; text-decoration: none !important; white-space: nowrap; border-radius: 10px !important; padding: 9px 12px !important; background: none; color: var(--text, #0b1220) !important; font: 600 15px/1.3 Inter, system-ui, sans-serif !important; }
.pmenu a:hover, .pmenu a[aria-current="page"] { background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); }
.pmenu hr { width: auto; height: 0; margin: 4px 6px; border: 0; border-top: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); }`;
