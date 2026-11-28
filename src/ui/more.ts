// "More", the fifth item of the main navigation (12 Nov): the product pages (pricing, security, docs, status), then the
// partner pages. One list for both navigations (src/redesign/ui.ts `header`, src/ui/nav.ts `navHtml`) and the footer,
// so the two definitions cannot drift apart. "More" is a <details> element: it opens and closes without any script, by
// mouse, touch or keyboard (Enter or Space on the summary; its links take focus only while it is open).

export type MoreKey = "cloud" | "negotiate" | "pricing" | "security" | "docs" | "books" | "privacy" | "business" | "status" | "airwallex" | "metal" | "visa" | "claude" | "t0";

export interface MoreLink {
  key: MoreKey;
  label: string;
  /** Relative, like every link on the pages; a page one level down makes its links absolute itself. */
  href: string;
  group: "product" | "partner";
  /**
   * A tab of its own (21 Nov): shown in the top row, before "More", and not repeated in the dropdown; the footer keeps it
   * with the product pages.
   */
  tab?: true;
  /** A tab's own short word in the top row (21 Nov: "Business", "Cloud"); the label otherwise. */
  tabLabel?: string;
  /**
   * false: this page is not in the site yet, so no menu and no footer links to it. A link to an address the site does
   * not serve fails test/site-v4.test.ts (every internal link answers) and, the other way round, a served page that the
   * menu leaves out fails the same test. Remove the flag in the commit that registers the page.
   */
  built?: false;
}

export const MORE_LABEL = "More";

/** Purser Cloud's test-money deployment (12 Nov), its MCP address for Claude, and the demo company's public, read-only
 * connector token (cloud/src/auth.ts DEMO_CONNECTOR_TOKEN; test/cloud-claude.test.ts keeps the two the same). */
export const PURSER_CLOUD_URL = "https://purser-try.max-31b.workers.dev/";
export const PURSER_CLOUD_MCP = `${PURSER_CLOUD_URL}mcp`;
export const DEMO_CONNECTOR_TOKEN = "purser-demo-read-only";
/** /try/negotiate (cloud/src/try/negotiatePage.ts) on purser-try, the deployment that serves it (the site's host passes it on too). */
export const NEGOTIATE_URL = `${PURSER_CLOUD_URL}try/negotiate`;

/** The whole menu, in its order: the product pages first, then the partner pages (names as text, never a logo). */
export const MORE_LINKS: readonly MoreLink[] = [
  // 12 Nov (owner): the hosted product, Purser Cloud, on its own test-money deployment.
  // 21 Nov (Max: "Should we show all these pages at all? I want it simple and tight"): the menu is Home, Try, Proof,
  // Cloud and More. Purser Cloud is the product, so it is a tab ("Cloud"); everything else stays one tap away under More.
  // 21 Nov (the owner's concept, "expose Business prominently"): the page for a business owner is a tab of its own,
  // "Business", before "Cloud"; the menu reads Home, Try, Proof, Business, Cloud, More.
  { key: "business", label: "For companies", href: "business", group: "product", tab: true, tabLabel: "Business" },
  { key: "cloud", label: "Purser Cloud", href: PURSER_CLOUD_URL, group: "product", tab: true, tabLabel: "Cloud" },
  // 15 Nov: "Agents negotiate" left the menu (Max: it read as unprofessional there); /try/negotiate has a card on Home
  // (src/redesign/home.ts negotiateCardHtml) and stays linked at the end of /try.
  // 13 Nov (Max): the product tour and Pricing are gone; /tour and /pricing answer 302 to /home (src/servers/dashboard.ts REDIRECTS).
  // 21 Nov (Max: "we are technically strong, now we must make it commercially strong"): the page for a business owner,
  // first under More: the problem, who it is for, a calculator for their own numbers, the pilot and its pilot prices,
  // the buyer's questions (src/redesign/business.ts). /one-pager, its printable sheet, is linked from it, not listed.
  { key: "security", label: "Security", href: "security", group: "product" },
  { key: "docs", label: "Docs", href: "docs", group: "product" },
  // 12 Nov (owner): the bookkeeping with AI agents, from the run records (src/redesign/booksPage.ts); with T:0 in it since 21 Nov.
  { key: "books", label: "Books", href: "books", group: "product" },
  // 20 Nov (outside audit, finding 3.4): what is kept, for how long, who processes it (src/redesign/privacy.ts).
  { key: "privacy", label: "Privacy", href: "privacy", group: "product" },
  // 12 Nov (owner): Status is out of the menu and the footer; /status itself still answers.
  { key: "airwallex", label: "Airwallex", href: "airwallex", group: "partner" },
  { key: "metal", label: "Alta", href: "alta", group: "partner" },
  { key: "visa", label: "Visa", href: "visa", group: "partner" },
  { key: "claude", label: "Claude", href: "claude", group: "partner" },
  // 21 Nov (the owner: "merge them"): T:0 lives on /books (Books above); /t0 answers 301 there.
];

/** The links under "More": every page of the list that the site serves, except the one that is a tab of its own. */
export const moreLinks = (): MoreLink[] => MORE_LINKS.filter((l) => l.built !== false && !l.tab);
/** The tabs the list adds after Home, Try and Proof (21 Nov: "Business", "Cloud"), each with its short label. */
export const CLOUD_TAB_LABEL = "Cloud";
export const tabLabel = (l: MoreLink): string => l.tabLabel ?? l.label;
export const tabLinks = (): MoreLink[] => MORE_LINKS.filter((l) => l.built !== false && l.tab);
/** The footer repeats the product pages only (Purser Cloud among them); the partner pages are reached from Proof and from "More". */
export const footerLinks = (): MoreLink[] => MORE_LINKS.filter((l) => l.built !== false && l.group === "product");
export const isMoreKey = (key: string | null): key is MoreKey => MORE_LINKS.some((l) => l.key === key);
/** A page listed under "More" (not a tab of its own). */
const underMore = (key: string | null): boolean => MORE_LINKS.some((l) => l.key === key && !l.tab);

/** A page's own key, as it tells the navigation where it is: one of the four tabs, a page under "More", or a page that sits under a tab. */
export type PageKey = "home" | "watch" | "try" | "proof" | "runs" | MoreKey;
/** The menu item a page marks (12 Nov): a tab marks itself, a page listed under "More" marks "More", /runs sits under Proof. The one mapping both navigations use. */
// Jury, 13 Nov: /runs is not Proof; it marks no tab.
const UNDER_TAB: Readonly<Record<string, "home" | "watch" | "try" | "proof" | "business" | "cloud">> = { home: "home", watch: "watch", try: "try", proof: "proof", business: "business", cloud: "cloud" };
export function menuItemOf(page: string | null): "home" | "watch" | "try" | "proof" | "business" | "cloud" | "more" | null {
  if (!page) return null;
  if (underMore(page)) return "more";
  return UNDER_TAB[page] ?? null;
}

/**
 * "More" and its dropdown, the same markup in both navigations: a <details> whose summary is the menu's fifth item, the
 * product pages, one divider, the partner pages. `current` is the page the reader is on, when it is one of these: its
 * link is marked, and so is "More".
 */
export function moreHtml(current: string | null = null, /** 12 Nov: a link's address on another origin (src/redesign/ui.ts HeaderLinks); its own href without. */ hrefOf: (l: MoreLink) => string = (l) => l.href): string {
  const links = moreLinks();
  const a = (l: MoreLink) => `<a href="${hrefOf(l)}"${l.key === current ? ' aria-current="page"' : ""}>${l.label}</a>`;
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
.pmore > summary:focus-visible, .pmenu a:focus-visible { outline: 3px solid var(--accent, #4382e8); outline-offset: 2px; }
.pmenu { position: absolute; right: 0; top: calc(100% + 10px); z-index: 60; display: grid; gap: 2px; min-width: 190px; max-width: calc(100vw - 24px); padding: 8px; border-radius: 16px; background: var(--surface, var(--panel, #fff)); border: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -12px rgba(16,24,40,.25); }
.pmenu a { display: block !important; text-decoration: none !important; white-space: nowrap; border-radius: 10px !important; padding: 9px 12px !important; background: none; color: var(--text, #0b1220) !important; font: 600 15px/1.3 Inter, system-ui, sans-serif !important; }
.pmenu a:hover, .pmenu a[aria-current="page"] { background: var(--sunken, var(--surface2, rgba(127,127,127,.12))); }
.pmenu hr { width: auto; height: 0; margin: 4px 6px; border: 0; border-top: 1px solid var(--border, var(--line, rgba(127,127,127,.25))); }
/* On a phone each link in the open menu is a 44 px target, as every other link in the header and footer is. */
@media (max-width: 430px) { .pmenu a { display: flex !important; align-items: center; min-height: 44px; } }`;
