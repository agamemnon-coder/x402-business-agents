// The service worker both origins serve at /sw.js (docs/app/README.md), hand-written, no library. Built here as the
// script's text, so the Worker serves exactly what test/pwa.test.ts runs (in node:vm, with fake requests and caches).
//
// What it does, and only that:
//   - at install, it stores the app shell in a cache named after the build (purser-shell-<version>): the offline page,
//     the stylesheet, the font and the icons; at activate, it deletes every older purser-* cache;
//   - a shell file is answered from that cache first (the network when it is missing; nothing is added later);
//   - opening one of the app's pages goes to the network first, always; only when the network fails does it show the
//     offline page, which says that nothing can be approved without a connection. A page is never stored, so no stale
//     approval page, dashboard or console can ever be shown;
//   - everything else is not touched at all: the browser fetches it as if there were no service worker.
//
// THE RULE (security): money state, approvals and the passkey ceremony never meet a cache. /api/* (the relay: the
// dashboard's data, the terms waiting, the assertions, enrolment and the passkey sign-in), /v1/* (Purser Cloud: the
// engine, its passkey start and finish, sign-in), /approve/*, /enrol, /policy, /try*, /oauth/*, /mcp, and the approval
// page's script are network only: the worker never stores their answer and never answers them with a stored copy. When
// the network fails, opening one of those pages shows the offline page, which carries no terms and no button. A
// challenge or a set of terms from a cache could be old or replayed; the ceremony must always ask the server, every time.
// Requests that carry credentials of their own (an Authorization or x-kit11-view header) are left alone the same way.

import type { AppOrigin } from "./manifest.js";

/** Paths the worker never answers from a cache and never stores (THE RULE above), as regular expressions. */
export const NETWORK_ONLY: readonly RegExp[] = [
  /^\/api\//, /^\/v1\//, /^\/approve\//, /^\/enrol$/, /^\/policy$/, /^\/try/, /^\/oauth\//, /^\/mcp$/, /^\/hooks\//,
  /^\/health/, /^\/internal\//, /^\/assets\/approve\.js$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/,
];

/** The pages the worker opens network first, with the offline page when the network fails: the app's own pages only. */
export const APP_PAGES: Record<AppOrigin, readonly RegExp[]> = {
  site: [/^\/$/, /^\/app$/, /^\/home$/, /^\/proof$/, /^\/approve\/P-\d{4,}$/, /^\/enrol$/, /^\/policy$/, /^\/offline$/],
  cloud: [/^\/$/, /^\/offline$/],
};

/** The shell each origin stores at install: the offline page first. Every path is one the origin serves (test/pwa.test.ts). */
export const SHELL: Record<AppOrigin, readonly string[]> = {
  site: ["/offline", "/assets/approve.css", "/assets/inter.woff2", "/assets/favicon.svg", "/assets/app-icon-192.png", "/assets/app-icon-512.png"],
  cloud: ["/offline", "/assets/inter.woff2", "/favicon.svg", "/assets/app-icon-192.png", "/assets/app-icon-512.png"],
};

const re = (list: readonly RegExp[]) => `[${list.map((r) => r.toString()).join(", ")}]`;

/** The worker's script for an origin and a build (`version`: the build hash of what it stores). */
export function swSource(origin: AppOrigin, version: string): string {
  if (!/^[0-9a-f]{8,64}$/.test(version)) throw new Error("the service worker's version must be a hex build hash");
  return `// Purser's service worker (src/pwa/sw.ts), build ${version}. Hand-written; no library.
// THE RULE: money state, approvals and the passkey ceremony never meet a cache. /api/*, /v1/*, /approve/*, /enrol,
// /policy, /try*, /oauth/*, /mcp and the approval page's script are network only: never stored, never answered with a
// stored copy (offline, a page shows the offline page: no terms, no button). The passkey ceremony (challenge, assertion,
// enrolment, sign-in) always goes to the server, every time.
"use strict";
const VERSION = ${JSON.stringify(version)};
const CACHE = "purser-shell-" + VERSION;
const OFFLINE = "/offline";
const SHELL = ${JSON.stringify(SHELL[origin])};
const NETWORK_ONLY = ${re(NETWORK_ONLY)};
const APP_PAGES = ${re(APP_PAGES[origin])};

// What the worker does with a request: "pass" (not touched: the browser fetches it itself), "page" (network first,
// the offline page when the network fails, never stored) or "shell" (the build's cache first).
function decide(request) {
  if (request.method !== "GET") return "pass";
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return "pass";
  if (request.headers.has("authorization") || request.headers.has("x-kit11-view")) return "pass";
  const path = url.pathname;
  if (request.mode === "navigate") return APP_PAGES.some((r) => r.test(path)) ? "page" : "pass";
  if (NETWORK_ONLY.some((r) => r.test(path))) return "pass";
  return SHELL.includes(path) ? "shell" : "pass";
}

async function page(request) {
  try {
    // Straight to the network; the answer goes to the page and nowhere else.
    return await fetch(request);
  } catch (e) {
    const offline = await caches.match(OFFLINE, { cacheName: CACHE });
    return offline || new Response("Offline: nothing can be approved without a connection.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

async function shell(request) {
  const hit = await caches.match(new URL(request.url).pathname, { cacheName: CACHE });
  return hit || fetch(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("purser-") && k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const how = decide(event.request);
  if (how === "page") event.respondWith(page(event.request));
  else if (how === "shell") event.respondWith(shell(event.request));
});

// Web Push (the site's relay, worker/src/webPush.ts): what waits for the CFO's signature, and the page to sign it on.
// Only a path on this site is opened; anything else opens the dashboard.
const here = (u) => (typeof u === "string" && /^\\/(?!\\/)[\\x21-\\x7e]*$/.test(u) ? u : "/?dashboard");
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = typeof d.title === "string" && d.title ? d.title.slice(0, 80) : "Payment needs your signature";
  const body = typeof d.body === "string" ? d.body.slice(0, 200) : "Open Purser to review the exact terms.";
  const url = here(d.url);
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/assets/app-icon-192.png", badge: "/assets/app-icon-192.png", tag: url, data: { url } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = here(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname + new URL(c.url).search === url && "focus" in c);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
`;
}

/** The worker script's own CSP: it may fetch this origin only and run nothing else (importScripts, eval). */
export const SW_CSP = "default-src 'none'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
