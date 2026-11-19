// Purser as an installed app (docs/app/README.md): the manifest is valid and its icons are the files it names, at their
// sizes; the pages link it under a CSP that stays strict; the service worker (the very script both Workers serve, run
// in node:vm on fake requests) never caches /api/, /v1/, the approval pages or the passkey ceremony and never serves a
// stale approval page; Web Push is real VAPID and aes128gcm, checked against a fake push service that decrypts it.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { appManifest, APP_THEME, MANIFEST_ICONS, OFFLINE_LINE, offlineCsp, offlinePage, SPLASH, type AppOrigin } from "../src/pwa/manifest.js";
import { APP_PAGES, NETWORK_ONLY, SHELL, SW_CSP, swSource } from "../src/pwa/sw.js";
import { APP_ICON_PNGS } from "../src/pwa/icons.gen.js";
import { pageResponse, pushMessage, Relay, type Sql } from "../worker/src/core.js";
import { b64u, encryptPush, fromB64u, pushEndpointOk, pushSender, readSubscription, vapidAuthorization, type VapidKeys } from "../worker/src/webPush.js";
import { headerFaults } from "./security-headers.rules.js";
import { viewKey } from "../src/relay/config.js";
import { consoleCsp } from "../cloud/src/console.js";
import { testCloud, ORIGIN as CLOUD } from "./support/cloud.js";

const SITE = "https://kit11.max-31b.workers.dev";
const pages = buildPages({} as NodeJS.ProcessEnv);
const get = (path: string) => pageResponse(new Request(`${SITE}${path}`), pages)!;
const png = (b: Buffer) => ({ png: b.subarray(1, 4).toString("latin1"), w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const appFile = (name: string) => readFileSync(new URL(`../docs/assets/brand/app/${name}`, import.meta.url));

describe("the Web App Manifest", () => {
  for (const origin of ["site", "cloud"] as AppOrigin[]) {
    it(`${origin}: has every field an install needs, inside its own scope`, () => {
      const m = appManifest(origin);
      expect({ name: m.name, short: m.short_name, display: m.display, theme: m.theme_color, bg: m.background_color }).toEqual({ name: "Purser", short: "Purser", display: "standalone", theme: "#0b1220", bg: "#0b1220" });
      expect(APP_THEME).toBe("#0b1220");
      // start_url and every shortcut inside the scope, and on this origin (a relative URL).
      const base = "https://example.test";
      const scope = new URL(m.scope, base).href;
      for (const u of [m.start_url, m.id, ...m.shortcuts.map((s) => s.url)]) {
        expect(u.startsWith("/") && !u.startsWith("//")).toBe(true);
        expect(new URL(u, base).href.startsWith(scope)).toBe(true);
      }
      expect(m.start_url).toBe(origin === "site" ? "/app" : "/#/invoices");
      expect(m.shortcuts.map((s) => s.name)).toEqual(["Waiting for my signature", "Proof"]);
      // 192 and 512 for "any", and a maskable 512.
      expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    });
  }

  it("its icons are committed PNG files at the sizes it states, the same bytes both Workers serve", () => {
    for (const i of [...MANIFEST_ICONS, { name: "app-icon-180.png", size: 180 }]) {
      const file = appFile(i.name);
      expect({ name: i.name, ...png(file) }).toEqual({ name: i.name, png: "PNG", w: i.size, h: i.size });
      expect(APP_ICON_PNGS[i.name]).toBe(file.toString("base64"));
    }
    for (const s of SPLASH) expect({ name: s.name, ...png(appFile(s.name)) }).toEqual({ name: s.name, png: "PNG", w: s.w * s.dpr, h: s.h * s.dpr });
    // The "any" icons keep the mark's round corners, transparent outside them (RGBA, PNG colour type 6); the maskable one
    // and the iOS one are full bleed, opaque navy to the edge (RGB, colour type 2).
    expect(["app-icon-192.png", "app-icon-512.png", "app-icon-maskable-512.png", "app-icon-180.png"].map((n) => appFile(n)[25])).toEqual([6, 6, 2, 2]);
  });

  it("is served at /manifest.webmanifest on both origins, with every icon it names", async () => {
    const r = get("/manifest.webmanifest");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    const m = (await r.json()) as ReturnType<typeof appManifest>;
    expect(m).toEqual(JSON.parse(JSON.stringify(appManifest("site"))));
    for (const i of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)]) {
      const a = get(i.src);
      expect({ src: i.src, status: a.status, type: a.headers.get("content-type") }).toEqual({ src: i.src, status: 200, type: "image/png" });
      expect(png(Buffer.from(await a.arrayBuffer())).w).toBe(Number(i.sizes.split("x")[0]));
    }
    for (const s of SPLASH) expect(get(`/assets/${s.name}`).status).toBe(200);
    const c = testCloud({ engine: true });
    try {
      const cm = await (await c.fetch(`${CLOUD}/manifest.webmanifest`)).json() as ReturnType<typeof appManifest>;
      expect(cm).toEqual(JSON.parse(JSON.stringify(appManifest("cloud"))));
      for (const i of cm.icons) expect((await c.fetch(`${CLOUD}${i.src}`)).status).toBe(200);
    } finally {
      c.close();
    }
  });

  it("the CFO's pages link it, with iOS's standalone and status-bar tags; the public pages do not", () => {
    for (const [name, html] of Object.entries({ dashboard: pages.dashboard, approve: pages.approve, enrol: pages.enrol, policy: pages.policy, app: pages.app!.start })) {
      const head = /<head>[\s\S]*<\/head>/.exec(html)![0];
      for (const tag of ['<link rel="manifest" href="/manifest.webmanifest">', '<meta name="apple-mobile-web-app-capable" content="yes">', '<meta name="apple-mobile-web-app-status-bar-style" content="black">', '<meta name="theme-color" content="#0b1220">', 'rel="apple-touch-startup-image"'])
        expect({ name, tag, has: head.includes(tag) }).toEqual({ name, tag, has: true });
      // One home-screen icon each, the app's.
      expect({ name, n: head.match(/rel="apple-touch-icon"/g)?.length }).toEqual({ name, n: 1 });
    }
    for (const html of [pages.home!, pages.proof!, pages.try]) expect(html).not.toContain('rel="manifest"');
  });
});

describe("CSP stays strict", () => {
  it("the installable pages allow the manifest and the worker from this origin only; nothing inline by keyword", () => {
    for (const [name, csp] of Object.entries({ dashboard: pages.csp.dashboard, approve: pages.csp.approve, enrol: pages.csp.enrol, policy: pages.csp.policy, app: pages.app!.startCsp, console: consoleCsp("n0nce") })) {
      expect({ name, manifest: csp.includes("manifest-src 'self'"), worker: csp.includes("worker-src 'self'") }).toEqual({ name, manifest: true, worker: true });
      expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
      expect(csp).toMatch(/(^|; )default-src 'none'(;|$)/);
    }
  });

  it("every new answer carries the site's security headers; the worker script its own CSP; the offline page hashes its one style", async () => {
    for (const [path, kind] of [["/manifest.webmanifest", "asset"], ["/sw.js", "asset"], ["/assets/app.js", "asset"], ["/offline", "page"], ["/app", "page"], ["/assets/app-icon-192.png", "asset"]] as const) {
      const r = get(path);
      expect({ path, status: r.status, faults: headerFaults(kind, r.headers) }).toEqual({ path, status: 200, faults: [] });
    }
    const sw = get("/sw.js");
    expect(sw.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(sw.headers.get("content-security-policy")).toBe(SW_CSP);
    expect(SW_CSP).toBe("default-src 'none'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expect(sw.headers.get("cache-control")).toBe("no-store");
    const off = await get("/offline").text();
    expect(off).toContain(OFFLINE_LINE);
    expect(off).not.toMatch(/<script|\son\w+=/i);
    const style = /<style>([\s\S]*?)<\/style>/.exec(off)![1]!;
    const { createHash } = await import("node:crypto");
    expect(offlineCsp()).toContain(`style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'`);
    const app = await get("/app").text();
    expect(app).not.toMatch(/<script>|<style>|\son\w+=|https?:\/\//i);
    expect(app).toContain('<script src="/assets/app.js"></script>');
    // The Android app's asset links: only once the owner made the file (docs/app/android-twa.md); the template is never served.
    expect(get("/.well-known/assetlinks.json")?.status ?? 404).not.toBe(200);
    const tpl = readFileSync(new URL("../docs/app/assetlinks.template.jsonc", import.meta.url), "utf8");
    const links = JSON.parse(tpl.replace(/^\s*\/\/.*$/gm, "")) as { target: { sha256_cert_fingerprints: string[] } }[];
    expect(links[0]!.target.sha256_cert_fingerprints[0]).toMatch(/^REPLACE/);
  });

  it("Purser Cloud serves the same files under the same rules", async () => {
    const c = testCloud({ engine: true });
    try {
      const sw = await c.fetch(`${CLOUD}/sw.js`);
      expect([sw.status, sw.headers.get("content-security-policy"), sw.headers.get("cache-control")]).toEqual([200, SW_CSP, "no-store"]);
      expect(await sw.text()).toContain('const SHELL = ["/offline","/assets/inter.woff2","/favicon.svg"');
      // Every file the cloud's worker stores at install answers 200 (else the install fails).
      for (const p of SHELL.cloud) expect({ p, status: (await c.fetch(`${CLOUD}${p}`)).status }).toEqual({ p, status: 200 });
      const off = await c.fetch(`${CLOUD}/offline`);
      expect(off.headers.get("content-security-policy")).toBe(offlineCsp());
      expect(await off.text()).toBe(offlinePage("cloud"));
      const con = await c.fetch(`${CLOUD}/`);
      expect(con.headers.get("content-security-policy")).toContain("manifest-src 'self'; worker-src 'self'");
      expect(await con.text()).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    } finally {
      c.close();
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The service worker, run as served, on fake requests and a fake Cache Storage.

interface FakeReq { url: string; method: string; mode: string; headers: Headers }
const req = (path: string, o: { method?: string; mode?: string; headers?: Record<string, string>; origin?: string } = {}): FakeReq =>
  ({ url: `${o.origin ?? SITE}${path}`, method: o.method ?? "GET", mode: o.mode ?? "cors", headers: new Headers(o.headers ?? {}) });
const nav = (path: string) => req(path, { mode: "navigate" });

function loadWorker(origin: AppOrigin, source = swSource(origin, "0123456789abcdef")) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const log = { put: 0, network: [] as string[], fromCache: [] as string[], shown: [] as { title: string; o: { body: string; data: { url: string } } }[], opened: [] as string[] };
  let online = true;
  const network = async (r: FakeReq | string) => {
    const url = typeof r === "string" ? `${SITE}${r}` : r.url;
    const path = new URL(url).pathname;
    log.network.push(path);
    if (!online) throw new TypeError("Failed to fetch");
    return new Response(path === "/offline" ? offlinePage(origin) : `network:${path}`, { status: 200 });
  };
  const cacheOf = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      addAll: async (paths: string[]) => { for (const p of paths) m.set(p, await network(p)); },
      put: async () => { log.put++; },
      match: async (k: string) => m.get(k)?.clone(),
    };
  };
  const caches = {
    open: async (name: string) => cacheOf(name),
    match: async (k: string, o: { cacheName: string }) => {
      const hit = store.get(o.cacheName)?.get(k);
      if (hit) log.fromCache.push(k);
      return hit?.clone();
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  const self = {
    location: new URL(origin === "site" ? SITE : CLOUD),
    addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; },
    skipWaiting: async () => undefined,
    registration: { showNotification: async (title: string, o: { body: string; data: { url: string } }) => { log.shown.push({ title, o }); } },
    clients: { matchAll: async () => [], openWindow: async (u: string) => { log.opened.push(u); } },
  };
  const ctx = createContext({ self, caches, fetch: network, URL, Response, Headers, Promise, TypeError });
  runInContext(source, ctx);
  const lifecycle = async (type: string) => { const w: Promise<unknown>[] = []; listeners[type]!({ waitUntil: (p: Promise<unknown>) => w.push(p) }); await Promise.all(w); };
  /** Dispatches a fetch event: null when the worker left it to the browser, else the text of what it answered. */
  const fetchEvent = async (r: FakeReq): Promise<string | null> => {
    let answer: Promise<Response> | null = null;
    listeners.fetch!({ request: r, respondWith: (p: Promise<Response>) => { answer = p; } });
    return answer ? (await (answer as Promise<Response>)).text() : null;
  };
  return { listeners, store, log, lifecycle, fetchEvent, offline: () => { online = false; }, onlineAgain: () => { online = true; } };
}

/** Every request the passkey ceremony, the money state and the approvals make, on either origin. */
const CEREMONY: FakeReq[] = [
  req("/api/snapshot"), req("/api/approvals"), req("/api/tickets/abcdefghijklmnopqrstuv"), req("/api/push/key"),
  req("/api/assertions", { method: "POST" }), req("/api/enrol/options", { method: "POST" }), req("/api/enrol", { method: "POST" }),
  req("/api/session/options", { method: "POST" }), req("/api/session", { method: "POST" }), req("/api/policy", { method: "POST" }),
  req("/v1/engine"), req("/v1/engine/proposals/P-0005"), req("/v1/engine/proposals/P-0005/terms"), req("/v1/engine/invoices"),
  req("/v1/engine/passkey/start", { method: "POST" }), req("/v1/engine/passkey/finish", { method: "POST" }), req("/v1/engine/proposals/P-0005/approve", { method: "POST" }),
  req("/v1/auth/passkey/options", { method: "POST" }), req("/v1/me"), req("/v1/payments"), req("/oauth/authorize"), req("/mcp", { method: "POST" }),
  req("/assets/approve.js"), req("/approve/P-0005"), req("/enrol"), req("/policy"), req("/try"), req("/api/try-sign/sign", { method: "POST" }),
  req("/sw.js"), req("/manifest.webmanifest"),
  // Credentials of their own: left alone whatever the path.
  req("/assets/inter.woff2", { headers: { authorization: "Bearer x" } }), req("/assets/approve.css", { headers: { "x-kit11-view": "a".repeat(32) } }),
];

describe("the service worker", () => {
  it("is a plain classic script with THE RULE written in it, and a version from the build", () => {
    const src = swSource("site", "0123456789abcdef");
    expect(src).not.toMatch(/^\s*(import|export)\b/m);
    expect(src).toContain("THE RULE: money state, approvals and the passkey ceremony never meet a cache.");
    expect(src).toContain('const CACHE = "purser-shell-" + VERSION;');
    expect(() => swSource("site", "not-a-hash")).toThrow();
    const served = pages.app!.sw;
    expect(/const VERSION = "([0-9a-f]{16})"/.exec(served)?.[1]).toMatch(/^[0-9a-f]{16}$/);
    // The same build gives the same worker (so a deploy with nothing changed keeps the cache).
    expect(buildPages({} as NodeJS.ProcessEnv).app!.sw).toBe(served);
  });

  it("stores the shell at install, under the build's cache, and drops older caches at activate", async () => {
    const w = loadWorker("site");
    w.store.set("purser-shell-old", new Map());
    w.store.set("someone-else", new Map());
    await w.lifecycle("install");
    expect([...w.store.get("purser-shell-0123456789abcdef")!.keys()]).toEqual([...SHELL.site]);
    await w.lifecycle("activate");
    expect([...w.store.keys()].sort()).toEqual(["purser-shell-0123456789abcdef", "someone-else"]);
    // Every file the site's worker stores is one the site serves.
    for (const p of SHELL.site) expect({ p, status: get(p).status }).toEqual({ p, status: 200 });
  });

  for (const origin of ["site", "cloud"] as AppOrigin[]) {
    it(`${origin}: never answers the money paths, the approvals or the passkey ceremony from a cache, and never stores them`, async () => {
      const w = loadWorker(origin);
      await w.lifecycle("install");
      const cacheName = "purser-shell-0123456789abcdef";
      // Even with a planted copy of each in the build's cache, the worker leaves every one to the network.
      for (const r of CEREMONY) w.store.get(cacheName)!.set(new URL(r.url).pathname, new Response("STALE COPY"));
      for (const r of CEREMONY) {
        const o = new URL(r.url).origin === SITE && origin === "cloud" ? { ...r, url: r.url.replace(SITE, CLOUD) } : r;
        expect({ path: new URL(o.url).pathname, method: o.method, answered: await w.fetchEvent(o) }).toEqual({ path: new URL(o.url).pathname, method: o.method, answered: null });
      }
      w.offline();
      for (const r of CEREMONY) expect(await w.fetchEvent(origin === "cloud" ? { ...r, url: r.url.replace(SITE, CLOUD) } : r)).toBeNull();
      expect(w.log.put).toBe(0);
      expect(w.log.fromCache).toEqual([]);
    });
  }

  it("never serves a stale approval page: online the network's, offline the offline page, never a stored copy", async () => {
    const w = loadWorker("site");
    await w.lifecycle("install");
    w.store.get("purser-shell-0123456789abcdef")!.set("/approve/P-0005", new Response("STALE APPROVAL P-0005 EUR 1,850.00"));
    expect(await w.fetchEvent(nav("/approve/P-0005"))).toBe("network:/approve/P-0005");
    expect(await w.fetchEvent(nav("/?dashboard"))).toBe("network:/");
    w.offline();
    for (const path of ["/approve/P-0005", "/enrol", "/policy", "/", "/app", "/proof"]) {
      const shown = await w.fetchEvent(nav(path));
      expect({ path, offline: shown!.includes(OFFLINE_LINE), stale: shown!.includes("STALE") }).toEqual({ path, offline: true, stale: false });
    }
    // The offline page carries no terms and no button.
    expect(offlinePage("site")).not.toMatch(/<button|<form|EUR|USD/);
    expect(w.log.put).toBe(0);
  });

  it("leaves other pages, other origins and other methods to the browser; answers the shell from its cache", async () => {
    const w = loadWorker("site");
    await w.lifecycle("install");
    for (const r of [nav("/try"), nav("/metal"), nav("/airwallex"), req("/x", { origin: "https://evil.example" }), req("/assets/inter.woff2", { method: "POST" })]) expect(await w.fetchEvent(r)).toBeNull();
    const before = w.log.network.length;
    expect(await w.fetchEvent(req("/assets/inter.woff2?v=1"))).toBe("network:/assets/inter.woff2");
    expect(w.log.network.length).toBe(before);
    expect(w.log.fromCache).toContain("/assets/inter.woff2");
    // A shell file missing from the cache comes from the network, and is not stored.
    w.store.get("purser-shell-0123456789abcdef")!.delete("/assets/approve.css");
    expect(await w.fetchEvent(req("/assets/approve.css"))).toBe("network:/assets/approve.css");
    expect(w.log.put).toBe(0);
    // The pages it opens network first are the app's own (the matcher as written).
    expect(APP_PAGES.site.some((r) => r.test("/approve/P-0005"))).toBe(true);
    expect(NETWORK_ONLY.some((r) => r.test("/v1/engine/passkey/start"))).toBe(true);
  });

  it("shows a push as a notification and opens only a path on this site", async () => {
    const w = loadWorker("site");
    const push = async (data: unknown) => {
      const p: Promise<unknown>[] = [];
      w.listeners.push!({ data: { json: () => data }, waitUntil: (x: Promise<unknown>) => p.push(x) });
      await Promise.all(p);
    };
    await push(pushMessage({ proposal_id: "P-0005", kind: "invoice_payment" }));
    await push({ title: "x", url: "//evil.example/approve" });
    await push({ url: "https://evil.example/" });
    expect(w.log.shown.map((s) => [s.title, s.o.data.url])).toEqual([["Payment needs your signature", "/approve/P-0005"], ["x", "/?dashboard"], ["Payment needs your signature", "/?dashboard"]]);
    const p: Promise<unknown>[] = [];
    w.listeners.notificationclick!({ notification: { close: () => undefined, data: { url: "/approve/P-0005" } }, waitUntil: (x: Promise<unknown>) => p.push(x) });
    await Promise.all(p);
    expect(w.log.opened).toEqual(["/approve/P-0005"]);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Web Push: VAPID and aes128gcm, against a fake push service that holds the phone's keys and decrypts.

const KEYS: VapidKeys = await (async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!, subject: "mailto:cfo@example.test" };
})();

/** A phone: its ECDH key pair and auth secret, and the subscription it gives the page. */
async function phone(endpoint = "https://fcm.googleapis.com/fcm/send/abc123") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { pair, sub: { endpoint, keys: { p256dh, auth: b64u(auth) } }, flat: { endpoint, p256dh, auth: b64u(auth) } };
}

/** A copy of the bytes as a plain ArrayBuffer (what WebCrypto's types ask for). */
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

/** RFC 8291 decryption, as the phone does it: written here on its own, not with the sender's code. */
async function decrypt(body: Uint8Array, me: CryptoKeyPair, authB64: string): Promise<string> {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20]!, asPublic = body.slice(21, 21 + idlen);
  expect([rs, idlen]).toEqual([4096, 65]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", me.publicKey));
  const as = await crypto.subtle.importKey("raw", ab(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as }, me.privateKey, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: ab(s), info: ab(info) }, await crypto.subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]), n * 8));
  const te = new TextEncoder();
  const ikm = await hk(fromB64u(authB64)!, ecdh, new Uint8Array([...te.encode("WebPush: info\0"), ...uaPublic, ...asPublic]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(nonce) }, await crypto.subtle.importKey("raw", ab(cek), "AES-GCM", false, ["decrypt"]), ab(body.slice(21 + idlen))));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  expect(plain[end]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, end));
}

/** The fake push service: checks the VAPID token's signature and claims, and keeps what it was sent. */
function pushService(status = 201) {
  const got: { endpoint: string; headers: Headers; body: Uint8Array }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    got.push({ endpoint: url, headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { got, fetchFn };
}

async function checkVapid(authorization: string, endpoint: string) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(\S+)$/.exec(authorization)!;
  expect(m[4]).toBe(KEYS.publicKey);
  const key = await crypto.subtle.importKey("raw", ab(fromB64u(KEYS.publicKey)!), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, ab(fromB64u(m[3]!)!), new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true);
  const claims = JSON.parse(new TextDecoder().decode(fromB64u(m[2]!)!)) as { aud: string; exp: number; sub: string };
  expect(claims.aud).toBe(new URL(endpoint).origin);
  expect(claims.sub).toBe(KEYS.subject);
  expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 3600);
  expect(JSON.parse(new TextDecoder().decode(fromB64u(m[1]!)!))).toEqual({ typ: "JWT", alg: "ES256" });
}

describe("Web Push", () => {
  it("encrypts for the phone alone (aes128gcm) and signs a VAPID token the push service can check", async () => {
    const p = await phone();
    const s = pushService();
    expect(await pushSender(KEYS, s.fetchFn)(p.flat, "hello, CFO")).toBe(201);
    const sent = s.got[0]!;
    expect([sent.headers.get("content-encoding"), sent.headers.get("ttl"), sent.headers.get("urgency")]).toEqual(["aes128gcm", "3600", "high"]);
    await checkVapid(sent.headers.get("authorization")!, p.flat.endpoint);
    expect(await decrypt(sent.body, p.pair, p.flat.auth)).toBe("hello, CFO");
    // Another phone's keys cannot read it.
    const other = await phone();
    await expect(decrypt(sent.body, other.pair, p.flat.auth)).rejects.toThrow();
    // Fixed key and salt give fixed bytes (the encryption is deterministic given them).
    const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const salt = new Uint8Array(16).fill(7);
    expect(b64u(await encryptPush(p.flat, "x", { local, salt }))).toBe(b64u(await encryptPush(p.flat, "x", { local, salt })));
    expect(await vapidAuthorization(p.flat.endpoint, KEYS)).toMatch(/^vapid t=/);
  });

  it("gives RFC 8291's own example, byte for byte (section 5: its keys, salt and message)", async () => {
    const asPub = fromB64u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")!;
    const jwk = { kty: "EC", crv: "P-256", x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33)), d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" };
    const local = {
      privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
      publicKey: await crypto.subtle.importKey("raw", ab(asPub), { name: "ECDH", namedCurve: "P-256" }, true, []),
    };
    const body = await encryptPush({ p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      "When I grow up, I want to be a watermelon", { local, salt: fromB64u("DGv6ra1nlYgDCS1FRnbzlw")! });
    expect(b64u(body)).toBe("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  });

  it("sends only to the push services of Apple, Google, Mozilla and Microsoft, over https", () => {
    for (const u of ["https://fcm.googleapis.com/fcm/send/x", "https://web.push.apple.com/QG", "https://api.push.apple.com/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect({ u, ok: pushEndpointOk(u) }).toEqual({ u, ok: true });
    for (const u of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://push.apple.com/x", "https://localhost/x", "https://169.254.169.254/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url"]) expect({ u, ok: pushEndpointOk(u) }).toEqual({ u, ok: false });
    expect(readSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: b64u(new Uint8Array(64)), auth: b64u(new Uint8Array(16)) } })).toBeNull();
  });

  const TOKEN = "p".repeat(64);
  const RP = "kit11.example.workers.dev";
  const BASE = `https://${RP}`;
  const VIEW = { "x-kit11-view": viewKey(TOKEN) };
  const sqlOver = (db: Database.Database): Sql => ({ exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } });
  const state = (ids: string[], expires = "2099-01-01T00:00:00Z") => ({
    generated_at: "2026-11-19T10:00:00Z", snapshot: {},
    approvals: { proposals: ids.map((id) => ({ proposal_id: id, terms_sha256: "a".repeat(64), expires_at: expires, kind: "invoice_payment", canonical: '{"amount":"1850.00","currency":"EUR","payee":"Stockline"}' })), names: {}, passkey: { rp_id: RP, credentials: [] } },
    enrolment: null,
  });
  const sync = (r: Relay, s: ReturnType<typeof state>) => r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: JSON.stringify(s.approvals.proposals.map((p) => p.proposal_id)), state: s }) }));
  const post = (r: Relay, path: string, body: unknown, headers: Record<string, string> = { origin: BASE, ...VIEW }) =>
    r.fetch(new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("the relay: a subscription behind the viewer key, then 'Payment needs your signature' once per proposal, never its terms", async () => {
    const svc = pushService();
    const r = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, push: { publicKey: KEYS.publicKey, send: pushSender(KEYS, svc.fetchFn) } });
    const p = await phone();
    expect((await r.fetch(new Request(`${BASE}/api/push/key`))).status).toBe(401);
    expect(await (await r.fetch(new Request(`${BASE}/api/push/key`, { headers: VIEW }))).json()).toEqual({ public_key: KEYS.publicKey });
    expect((await post(r, "/api/push/subscribe", p.sub, { ...VIEW })).status).toBe(403);
    expect((await post(r, "/api/push/subscribe", p.sub, { origin: BASE })).status).toBe(401);
    expect((await post(r, "/api/push/subscribe", { ...p.sub, endpoint: "https://evil.example/x" })).status).toBe(400);
    expect((await post(r, "/api/push/subscribe", p.sub)).status).toBe(201);
    expect((await sync(r, state(["P-0005"]))).status).toBe(200);
    expect(svc.got).toHaveLength(1);
    await checkVapid(svc.got[0]!.headers.get("authorization")!, p.sub.endpoint);
    const msg = JSON.parse(await decrypt(svc.got[0]!.body, p.pair, p.flat.auth)) as { title: string; body: string; url: string };
    expect(msg).toEqual({ title: "Payment needs your signature", body: "P-0005 waits above the agents' limit. Open it to check the exact terms, then sign with your passkey.", url: "/approve/P-0005" });
    expect(JSON.stringify(msg)).not.toMatch(/1850|EUR|Stockline/);
    // The same proposal again: no second notice. A new one: one more. An expired one: none.
    await sync(r, state(["P-0005", "P-0006"]));
    await sync(r, state(["P-0007"], "2020-01-01T00:00:00Z"));
    expect(svc.got.map((g) => g.endpoint)).toEqual([p.sub.endpoint, p.sub.endpoint]);
    expect((JSON.parse(await decrypt(svc.got[1]!.body, p.pair, p.flat.auth)) as { url: string }).url).toBe("/approve/P-0006");
  });

  it("the relay drops a subscription the push service says is gone, and without VAPID keys there is no push at all", async () => {
    const gone = pushService(410);
    const r = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, push: { publicKey: KEYS.publicKey, send: pushSender(KEYS, gone.fetchFn) } });
    const p = await phone("https://web.push.apple.com/QGabc");
    expect((await post(r, "/api/push/subscribe", p.sub)).status).toBe(201);
    await sync(r, state(["P-0010"]));
    await sync(r, state(["P-0011"]));
    expect(gone.got.map((g) => g.endpoint)).toEqual([p.sub.endpoint]);
    const off = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN });
    expect((await off.fetch(new Request(`${BASE}/api/push/key`, { headers: VIEW }))).status).toBe(404);
    expect((await post(off, "/api/push/subscribe", p.sub)).status).toBe(404);
    expect((await sync(off, state(["P-0012"]))).status).toBe(200);
  });

  it("names the kind in the title and only ever links the passkey page", () => {
    expect(pushMessage({ proposal_id: "P-0001", kind: "policy_change" }).title).toBe("A policy change needs your signature");
    expect(pushMessage({ proposal_id: "P-0001" })).toMatchObject({ title: "Payment needs your signature", url: "/approve/P-0001" });
  });
});
