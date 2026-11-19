// Purser as an installed app (docs/app/README.md): the Web App Manifest, the tags a page's <head> carries for it, and
// the offline page, for both origins that serve the CFO's pages:
//   "site"   kit11 (worker/src/core.ts): the CFO's dashboard (/?dashboard), the passkey pages (/approve/P-…, /enrol,
//            /policy) and /proof. The app starts at /app (./appPage.ts), which hands a phone its private link once.
//   "cloud"  Purser Cloud (cloud/src/console.ts): the console at /, where the CFO approves with Face ID.
// The scope is "/" on both: the dashboard is the site's root with a query and the console is the cloud's root, so no
// narrower path holds them. The service worker (./sw.ts) is what keeps the money paths off any cache.

import { createHash } from "node:crypto";
import { ICON_VERSION } from "../ui/brand/mark.js";

/** The mark's navy (docs/assets/brand/purser-mark.svg, the site's --text in light mode): the app's bar and launch screen. */
export const APP_THEME = "#0b1220";
export const MANIFEST_PATH = "/manifest.webmanifest";
export const SW_PATH = "/sw.js";
export const OFFLINE_PATH = "/offline";
/** The site's start page (./appPage.ts). */
export const APP_PATH = "/app";

export type AppOrigin = "site" | "cloud";

/** The icons the manifest names, served at /assets/<name> by both Workers (src/pwa/icons.gen.ts). */
export const MANIFEST_ICONS = [
  { name: "app-icon-192.png", size: 192, purpose: "any" },
  { name: "app-icon-512.png", size: 512, purpose: "any" },
  { name: "app-icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const;
export const APPLE_TOUCH_ICON = "app-icon-180.png";

/** iPhone launch screens (scripts/app-icons.ts SPLASH_SCREENS): the site only; CSS size, pixel ratio, file. */
export const SPLASH = [
  { w: 440, h: 956, dpr: 3 }, { w: 430, h: 932, dpr: 3 }, { w: 428, h: 926, dpr: 3 }, { w: 402, h: 874, dpr: 3 },
  { w: 393, h: 852, dpr: 3 }, { w: 390, h: 844, dpr: 3 }, { w: 375, h: 667, dpr: 2 },
].map((s) => ({ ...s, name: `app-splash-${s.w * s.dpr}x${s.h * s.dpr}.png` }));

/** The two shortcuts (a long press on the icon), each inside the origin's own scope. */
function shortcuts(origin: AppOrigin) {
  const icon = [{ src: "/assets/app-icon-192.png", sizes: "192x192", type: "image/png" }];
  return origin === "site"
    ? [
      { name: "Waiting for my signature", short_name: "To sign", url: "/?dashboard#h-pending", icons: icon },
      { name: "Proof", short_name: "Proof", url: "/proof", icons: icon },
    ]
    // Purser Cloud's proof is its archive (every file the engine filed: invoices, signed terms, receipts); the public
    // proof pages are the site's, on another origin, which a shortcut cannot open.
    : [
      { name: "Waiting for my signature", short_name: "To sign", url: "/#/invoices", icons: icon },
      { name: "Proof", short_name: "Proof", url: "/#/archive", icons: icon },
    ];
}

/** The manifest, as an object (the tests read it) and as served (appManifestText). */
export function appManifest(origin: AppOrigin) {
  const start = origin === "site" ? APP_PATH : "/#/invoices";
  return {
    id: start,
    name: "Purser",
    short_name: "Purser",
    description: origin === "site"
      ? "Purser for the CFO: what waits for your signature, and your passkey (Face ID) on the exact terms. Test money only."
      : "Purser Cloud: invoices waiting for your signature, approved with your passkey (Face ID) on the exact terms. Test money only.",
    lang: "en",
    dir: "ltr",
    start_url: start,
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait",
    theme_color: APP_THEME,
    background_color: APP_THEME,
    categories: ["finance", "business"],
    icons: MANIFEST_ICONS.map((i) => ({ src: `/assets/${i.name}`, sizes: `${i.size}x${i.size}`, type: "image/png", purpose: i.purpose })),
    shortcuts: shortcuts(origin),
  };
}

export const appManifestText = (origin: AppOrigin) => `${JSON.stringify(appManifest(origin), null, 2)}\n`;

/**
 * The tags that make a page installable, put into its <head> (appHead): the manifest, the bar's colour, iOS's own tags
 * (standalone, a dark status bar, the title under the icon, the home-screen icon) and, on the site, the launch screens.
 * Tags only, no script or style: no page's CSP hash changes (each page's CSP adds manifest-src and worker-src 'self').
 */
export function appHeadTags(origin: AppOrigin): string {
  return [
    `<link rel="manifest" href="${MANIFEST_PATH}">`,
    `<meta name="theme-color" content="${APP_THEME}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
    '<meta name="apple-mobile-web-app-title" content="Purser">',
    // Versioned like every icon link (src/ui/brand/mark.ts ICON_VERSION), so a phone that kept an older icon fetches this one.
    `<link rel="apple-touch-icon" href="/assets/${APPLE_TOUCH_ICON}?v=${ICON_VERSION}" sizes="180x180">`,
    ...(origin === "site" ? SPLASH.map((s) => `<link rel="apple-touch-startup-image" media="(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)" href="/assets/${s.name}">`) : []),
  ].join("");
}

/** A page with the app's tags before its </head>; an apple-touch-icon link it had already makes way for the app's own. */
export function withAppHead(html: string, origin: AppOrigin): string {
  if (html.includes(`<link rel="manifest"`)) return html;
  const head = html.replace(/<link rel="apple-touch-icon" href="[^"]*">\n?/, "");
  if (!head.includes("</head>")) throw new Error("the page has no </head> for the app's tags");
  return head.replace("</head>", () => `${appHeadTags(origin)}\n</head>`);
}

/** The offline page's one style: no script, no image file (the mark is inline), so it needs nothing the network gives. */
const OFFLINE_STYLE = `:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{min-height:100vh;display:grid;place-items:center;padding:24px;padding-top:calc(24px + env(safe-area-inset-top));background:${APP_THEME};color:#eef1f6;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:26rem;text-align:center}svg{width:56px;height:56px}h1{font-size:1.4rem;line-height:1.3;margin:20px 0 8px}p{margin:0 0 12px;color:#c4cad6}a{color:#fff;font-weight:600}`;
const FEATHER = '<svg viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="9" fill="#1a2336"/><g transform="translate(7 7) scale(0.6666667)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></g></svg>';

/** What the offline page says, word for word (test/pwa.test.ts). */
export const OFFLINE_LINE = "Offline: nothing can be approved without a connection.";

/** The page the service worker shows for any page it cannot fetch. Never a copy of an approval: it shows no terms at all. */
export function offlinePage(origin: AppOrigin): string {
  const start = origin === "site" ? APP_PATH : "/";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer"><meta name="theme-color" content="${APP_THEME}"><title>Offline · Purser</title>
<style>${OFFLINE_STYLE}</style></head>
<body><main>${FEATHER}
<h1>${OFFLINE_LINE}</h1>
<p>Purser shows what waits for your signature, and checks your passkey, over the network only. Nothing here is a saved copy.</p>
<p>Connect, then <a href="${start}">open Purser again</a>.</p>
</main></body></html>`;
}

/** The offline page's CSP: its one style by hash, nothing else at all. */
export function offlineCsp(): string {
  const hash = createHash("sha256").update(OFFLINE_STYLE, "utf8").digest("base64");
  return `default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}
