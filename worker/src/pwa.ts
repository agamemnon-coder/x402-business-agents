// The site's installed-app files (docs/app/README.md), served by pageResponse (./core.ts) from the bundle that
// src/relay/assets.ts builds out of src/pwa/: the manifest, the service worker with its own CSP, the offline page, the
// start page /app and its script, and the Android app's Digital Asset Links once the owner has made the file.

import { COMMON_HEADERS, PAGE_HEADERS } from "./core.js";

export interface AppFiles {
  manifest: string;
  /** /sw.js, the service worker (src/pwa/sw.ts), and its CSP (it may fetch this origin and nothing else). */
  sw: string;
  swCsp: string;
  offline: string;
  offlineCsp: string;
  /** /app, the installed app's start page (src/pwa/appPage.ts), its script and its CSP. */
  start: string;
  startScript: string;
  startCsp: string;
  /** /.well-known/assetlinks.json for the Android app (docs/app/android-twa.md): only once the owner made docs/app/assetlinks.json. */
  assetLinks?: string;
}

export function appResponse(path: string, app: AppFiles): Response | null {
  if (path === "/manifest.webmanifest") return new Response(app.manifest, { headers: { ...COMMON_HEADERS, "content-type": "application/manifest+json; charset=utf-8" } });
  // no-store (COMMON_HEADERS): the browser checks for a new worker on every visit.
  if (path === "/sw.js") return new Response(app.sw, { headers: { ...COMMON_HEADERS, "content-type": "text/javascript; charset=utf-8", "content-security-policy": app.swCsp } });
  if (path === "/offline") return new Response(app.offline, { headers: { ...PAGE_HEADERS, "content-security-policy": app.offlineCsp } });
  if (path === "/app") return new Response(app.start, { headers: { ...PAGE_HEADERS, "content-security-policy": app.startCsp } });
  if (path === "/assets/app.js") return new Response(app.startScript, { headers: { ...COMMON_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
  if (path === "/.well-known/assetlinks.json" && app.assetLinks) return new Response(app.assetLinks, { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } });
  return null;
}
