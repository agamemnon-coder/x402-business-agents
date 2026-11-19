// Purser Cloud as an installed app (docs/app/README.md): the console's manifest, its service worker, the offline page
// and the app's icons, from src/pwa/ (the same files the site serves, for this origin). The worker never touches /v1/:
// the engine's answers, sign-in and the passkey ceremony always come from the network (src/pwa/sw.ts).

import { createHash } from "node:crypto";
import { appHeadTags, appManifestText, offlineCsp, offlinePage } from "../../src/pwa/manifest.js";
import { SW_CSP, swSource } from "../../src/pwa/sw.js";
import { APP_ICON_PNGS } from "../../src/pwa/icons.gen.js";
import { INTER_WOFF2_B64 } from "./font.gen.js";
import { ICON_LINKS } from "./brand.js";
import { fromB64 } from "./crypto.js";

/** The console's icon links with the app's tags: its apple-touch-icon is the app's (full bleed, 180 px). */
export const APP_ICON_LINKS = ICON_LINKS.replace(/<link rel="apple-touch-icon"[^>]*>/, "") + appHeadTags("cloud");

const OFFLINE = offlinePage("cloud");
/** The worker's version: the hash of what it stores (the offline page, the font, the icons) and of its own code. */
const VERSION = createHash("sha256").update(swSource("cloud", "00000000")).update(OFFLINE).update(INTER_WOFF2_B64)
  .update(APP_ICON_PNGS["app-icon-192.png"] ?? "").update(APP_ICON_PNGS["app-icon-512.png"] ?? "").digest("hex").slice(0, 16);
const SW = swSource("cloud", VERSION);
const MANIFEST = appManifestText("cloud");

const BASE = { "x-content-type-options": "nosniff", "strict-transport-security": "max-age=31536000; includeSubDomains", "referrer-policy": "no-referrer" };

/** The app's answer for this path, or null when the path is not one of its files. GET and HEAD only (the caller checks). */
export function cloudAppResponse(path: string, pageHeaders: Record<string, string>): Response | null {
  if (path === "/manifest.webmanifest") return new Response(MANIFEST, { status: 200, headers: { ...BASE, "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" } });
  // no-store: the browser checks for a new worker on every visit. Its own CSP: it may fetch this origin only.
  if (path === "/sw.js") return new Response(SW, { status: 200, headers: { ...BASE, "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "content-security-policy": SW_CSP } });
  if (path === "/offline") return new Response(OFFLINE, { status: 200, headers: { ...pageHeaders, "content-security-policy": offlineCsp() } });
  const icon = path.startsWith("/assets/app-icon-") ? APP_ICON_PNGS[path.slice("/assets/".length)] : undefined;
  if (icon) return new Response(new Uint8Array(fromB64(icon)), { status: 200, headers: { ...BASE, "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  return null;
}
