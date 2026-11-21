// The relay between Max's phone and the runner (tier 2 item 5), as plain logic over a SQL handle so it runs in a
// Cloudflare Durable Object and in Node tests alike. It stores the last state the runner pushed, queues what the
// phone submits, and shows the runner's verdict. It holds no key and approves nothing: the runner verifies every
// signature itself. Its own checks (origin, hash, queue and rate limits, the enrolment code) only refuse early.

import { SECURITY_TXT } from "../../src/lib/securityTxt.js";
import { ROBOTS_TXT, SITEMAP_XML, canonicalUrl, isIndexable } from "../../src/lib/siteIndex.js";
import { DAY_CACHE, IMMUTABLE_CACHE } from "../../src/ui/assetVersions.js";
import { verifyAssertion, type PublicKeyXY } from "./webauthn.js";
import { normalizeCode } from "../../src/passkey/code.js";
import { publicHealth, publicStatus, type Health } from "../../src/ops/publicHealth.js";
import type { RecordedAgents } from "../../src/try/recorded.js";
import type { MetalRecorded } from "./metalInspector.js";
import { AWX_EVENTS_PATH, AwxEventFeed } from "./awxEvents.js";
import { appResponse, type AppFiles } from "./pwa.js";
import { readSubscription, type PushSend } from "./webPush.js";
import { alarmRules, cleanDetail, truncatedIp, windowStart, type AlarmRule, type SecurityKind } from "../../src/lib/securityEvents.js";

export type SqlValue = string | number | null;
export interface Sql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[] };
}

export interface Pages {
  dashboard: string;
  /** 1.1: the one EUR/USD rate the main run recorded (src/policy/exposureSources.ts), for /try/sign's worst case; null: none. */
  exposureRate?: { usdPerEur: string; date: string; source: string } | null;
  /** Spec 6b: /try/sign's recorded agents (docs/demo/try-agents-recorded.json, read by src/try/recorded.ts); null: none. */
  tryAgentsRecorded?: RecordedAgents | null;
  /** The month replay (simulated, its data inside the page). */
  month: string;
  /** The public demo: a recorded live run played back (K5), its data inside the page. */
  demo: string;
  /** "Purser live": the animated day, its timeline inside the page. */
  live: string;
  /** The film (about three minutes), its facts inside the page. */
  film: string;
  /** Try Purser: anyone types a task; its requests go to POST /api/try. */
  try: string;
  /** The Scenario Lab's recorded results (docs/lab/results.json), its data inside the page. */
  lab: string;
  /** How Purser uses Alta: features, mandates and the Dispute desk case, its data inside the page. */
  metal: string;
  /** The recorded case's evidence report (no script); empty when no case was recorded. */
  metalReport: string;
  visa: string;
  /** /llms.txt: the submission in plain text for tools that read it (the repository's llms.txt); absent in older bundles. */
  llms?: string;
  /** /metal's mandate inspector: the record's read of 12 November, its answer without a chain call; absent: the inspector answers 503. */
  metalRecorded?: MetalRecorded | null;
  /**
   * The content version of each static file, by its path (/assets/<name>): the first 12 hex digits of its bytes' SHA-256,
   * computed at build (src/relay/assets.ts). An answer to "<path>?v=<that version>" is cached for a year; absent in older bundles.
   */
  versions?: Record<string, string>;
  /** /proof.json: the runs, guarantees and agents' limits as data (src/redesign/agentData.ts); absent in older bundles. */
  proofJson?: string;
  /** /receipt-sample.json: one signed receipt, byte for byte, to verify offline; absent in older bundles. */
  receiptSample?: string;
  /** /t0-readback.json: T:0's read-back of Purser's journal entries, byte for byte (docs/runs/2026-11-14-t0-readback.json); absent in older bundles. */
  t0Readback?: string;
  /** The partner pages (src/partners/), no script; absent in a bundle built before them. */
  airwallex?: string;
  claude?: string;
  /** /security, the product page under "More" (src/redesign/security.ts), no script; absent in a bundle built before it. */
  security?: string;
  /** /docs, "Docs and API", under "More" too (src/redesign/docs.ts), no script; absent in a bundle built before it. */
  docs?: string;
  /** /privacy, under "More" too (src/redesign/privacy.ts), no script; absent in a bundle built before it. */
  privacy?: string;
  /** /business, "For companies", under "More" (src/redesign/business.ts): its one script is the calculator; absent in a bundle built before it. */
  business?: string;
  /** /one-pager, the printable sales sheet linked from /business (src/redesign/business.ts): its one script is the print button. */
  onePager?: string;
  /** /status, under "More" too (src/redesign/status.ts): its one script reads this Worker's own /health; absent in a bundle built before it. */
  status?: string;
  /** /t0 (owner, 12 Nov): Purser's books in T:0's ledger. */
  t0?: string;
  /** /airwallex/calls (15 Nov): every Airwallex sandbox API call in the run records; absent in a bundle built before it. */
  awxCalls?: string;
  /** /books (owner, 12 Nov): the bookkeeping with AI agents, from the run records. */
  books?: string;
  /** The redesign's public pages (Home, Watch, Proof), no key needed; absent in a bundle built before them. */
  home?: string;
  watch?: string;
  /** /replay: the main run of 3 November replayed step by step (it was /watch until the film came). */
  replay?: string;
  proof?: string;
  /** /verify: a /try proof bundle checked in the browser (src/proof/verifyPage.ts). */
  verify?: string;
  /** /verify/samples/<file>: the committed sample proof bundles, byte for byte (docs/proof/), as downloads. */
  proofSamples?: Record<string, string>;
  /** /trace: any payment of the main run, step by step (no script); absent in a bundle built before it. */
  trace?: string;
  /** /runs: every live run, newest first (no script); absent in a bundle built before it. */
  runs?: string;
  /** /agents/<id>: one page per Kit 11 agent, each with its own CSP (no script); absent in a bundle built before them. */
  agents?: Record<string, { page: string; csp: string }>;
  /** The clean 404 page (no script); absent in a bundle built before it. */
  notFound?: string;
  /** Purser as an installed app (src/pwa/, ./pwa.ts): the manifest, the service worker, the offline page and /app; absent in a bundle built before them. */
  app?: AppFiles;
  /** /try/sign: a visitor signs with their own passkey in a test world (worker/src/trySign.ts). Present only in a bundle
   * built with TRY_SIGN_ENABLED on; without it the page and its API answer 404. */
  trySign?: string;
  /** /try/verify: a receipt.json checked in the browser (src/try/verify.ts); with /try/sign only. */
  tryVerify?: string;
  /** Old public addresses folded into the four tabs, and where they now go (302). */
  redirects?: Record<string, string>;
  /** Addresses retired for good (301, query kept): /judge → /home. */
  moved?: Record<string, string>;
  approve: string;
  enrol: string;
  /** The CFO policy editor. */
  policy: string;
  /** The approval and enrolment pages' script and stylesheet, served as /assets/approve.js and .css. */
  client: string;
  css: string;
  /** Inter (woff2, base64), served as /assets/inter.woff2. */
  font: string;
  /** The sponsors' logos (base64), served as /assets/<name>. */
  images: Record<string, { type: string; data: string }>;
  csp: { dashboard: string; month: string; demo: string; live: string; film: string; try: string; lab: string; metal: string; metalReport: string; visa: string; airwallex?: string; awxCalls?: string; claude?: string; security?: string; docs?: string; privacy?: string; business?: string; onePager?: string; status?: string; t0?: string; books?: string; home?: string; watch?: string; replay?: string; proof?: string; verify?: string; trace?: string; runs?: string; notFound?: string; trySign?: string; tryVerify?: string; approve: string; enrol: string; policy: string };
}

const MAX_STATE_BYTES = 1_500_000;
const MAX_SUBMISSION_BYTES = 16_384;
const MAX_QUEUED_PER_PROPOSAL = 3;
const MAX_QUEUED = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
/** Failed viewer-key and webhook-signature attempts per address in the same window, before it is refused (HF1). */
const FAILS_MAX = 20;
const ENROL_ATTEMPTS = 5;
const ANSWERED_KEEP_MS = 60 * 60 * 1000;
const QUEUED_KEEP_MS = 30 * 60 * 1000;
const PROPOSAL_ID = /^P-\d{4,}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TICKET = /^[A-Za-z0-9_-]{22}$/;
const MAX_HOOK_BYTES = 65_536;
const MAX_HOOKS = 500;
const HOOKS_PER_SYNC = 50;
const HOOK_KEEP_MS = 24 * 60 * 60 * 1000;
/** The security log keeps a row 90 days at least (a trigger refuses to delete a younger one), and writes at most 30 rows a minute per kind and network. */
const SEC_LOG_KEEP_DAYS = 90;
const SEC_LOG_ROWS_PER_MINUTE = 30;
/** The runner's alarm codes that are tamper alarms (src/passkey/failures.ts passkey_terms_tampered, a broken chain). */
const TAMPER_CODE = /tamper|chain_broken|chain_invalid/;
/** How far Airwallex's x-timestamp may be from our clock (a replay of an old event is refused). */
const HOOK_TOLERANCE_MS = 5 * 60 * 1000;
const ACK_STATUSES = new Set(["approved", "rejected", "pending", "executed", "failed", "refused", "too_late", "already", "enrolled", "drafted", "cosigned", "second_key", "answered", "removed"]);
/** The CFO's policy in plain words (P2): Opus drafts rules from it on the runner. */
const MAX_POLICY_TEXT = 2000;
/** A chat message to Purser (Ask Purser): the runner reads it and proposes a task card for Face ID. */
const MAX_ASK_TEXT = 500;
/** Web Push: the phones the relay tells (the newest ones). */
const MAX_PUSH_SUBS = 5;

/** The push message for a proposal waiting for the CFO: its kind in words, its id, and the passkey page; never its terms. */
export function pushMessage(p: { proposal_id: string; kind?: string }): { title: string; body: string; url: string } {
  const title = p.kind === "policy_change" ? "A policy change needs your signature" : p.kind === "mandate_replace" ? "A mandate change needs your signature" : "Payment needs your signature";
  return { title, body: `${p.proposal_id} waits above the agents' limit. Open it to check the exact terms, then sign with your passkey.`, url: `/approve/${p.proposal_id}` };
}

/**
 * The CSP of every answer that is not a page (JSON, a redirect, the script, the stylesheet, the font, the logos): it
 * may load nothing, run nothing and be framed by nothing. A page replaces it with its own (src/relay/assets.ts).
 */
export const NON_PAGE_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const COMMON_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  // On every answer, JSON included (HF2). The whole .dev zone is on the browsers' HSTS preload list, so on workers.dev
  // this is defence in depth. includeSubDomains covers only names under this Worker's own host (on workers.dev there
  // are none); behind a custom domain it would also bind that domain's subdomains to HTTPS, so serve the Worker on a
  // name of its own, never on an apex with plain-HTTP subdomains. No "preload": that is for a registrable domain.
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  // frame-ancestors 'none' is in every CSP; X-Frame-Options says the same to browsers that predate it.
  "x-frame-options": "DENY",
  "content-security-policy": NON_PAGE_CSP,
};

/** What a browser may do on our pages: passkeys for this site only; no camera, microphone, location, payment sheet or USB. */
export const PERMISSIONS_POLICY = "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/** Every HTML document (each page and the 404): the common headers, the permissions policy and its own window. Its CSP is the page's own. */
export const PAGE_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS, "content-type": "text/html; charset=utf-8", "permissions-policy": PERMISSIONS_POLICY, "cross-origin-opener-policy": "same-origin",
};

/** Every JSON answer is data, never a page (ASVS V14.4.2): a browser that opens one saves it. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="api.json"' } });
}
const error = (status: number, message: string, extra: Record<string, unknown> = {}) => json(status, { error: message, ...extra });

/** The icons a browser or a home screen asks for at the root (src/ui/brand/mark.ts). */
const ROOT_ICONS = ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/icon.png"];

/**
 * The pages; anything else is not ours. Ids in paths are checked, so nothing odd reaches the page script. A public page
 * (src/lib/siteIndex.ts, the owner's choice of 20 Nov) is answered without the common noindex and names its canonical
 * address in a Link header; every other answer keeps `x-robots-tag: noindex, nofollow`.
 */
export function pageResponse(req: Request, pages: Pages): Response | null {
  const res = routePage(req, pages);
  const url = new URL(req.url);
  if (!res || res.status !== 200 || !isIndexable(url.pathname, url.search) || !(res.headers.get("content-type") ?? "").startsWith("text/html")) return res;
  res.headers.delete("x-robots-tag");
  res.headers.set("link", `<${canonicalUrl(url.pathname)}>; rel="canonical"`);
  return res;
}

function routePage(req: Request, pages: Pages): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const url = new URL(req.url);
  const path = url.pathname;
  const page = (body: string, csp: string) => new Response(body, { headers: { ...PAGE_HEADERS, "content-security-policy": csp } });
  // A static file asked for with its content version (?v=, src/ui/assetVersions.ts; Pages.versions, from the bytes at
  // build) is cached for a year, immutable (site audit, 19 Nov, finding 6); without it, or with an old one, for a day.
  const cacheFor = (assetPath: string) => {
    const v = url.searchParams.get("v");
    return v && pages.versions && Object.hasOwn(pages.versions, assetPath) && pages.versions[assetPath] === v ? IMMUTABLE_CACHE : DAY_CACHE;
  };
  // How to report a vulnerability (RFC 9116; src/lib/securityTxt.ts).
  if (path === "/.well-known/security.txt") return new Response(SECURITY_TXT, { headers: { ...COMMON_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  // What crawlers may read, and the public pages' canonical addresses (src/lib/siteIndex.ts; the owner, 20 Nov).
  if (path === "/robots.txt") return new Response(ROBOTS_TXT, { headers: { ...COMMON_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  if (path === "/sitemap.xml") return new Response(SITEMAP_XML, { headers: { ...COMMON_HEADERS, "content-type": "application/xml; charset=utf-8" } });
  // "/" is Home itself, so a reader without script (a link preview, a fetch) sees it too. With a query (?recorded,
  // ?autonomy, ?signin, ?dashboard…) it is the CFO dashboard's page. The CFO's viewer link keeps its key after the "#",
  // which never reaches a server: Home's script hands a device with a key to ?dashboard (src/redesign/home.ts).
  if (path === "/") return !new URL(req.url).search && pages.home && pages.csp.home ? page(pages.home, pages.csp.home) : page(pages.dashboard, pages.csp.dashboard);
  if (path === "/home" && pages.home && pages.csp.home) return page(pages.home, pages.csp.home);
  if (path === "/watch" && pages.watch && pages.csp.watch) return page(pages.watch, pages.csp.watch);
  if (path === "/replay" && pages.replay && pages.csp.replay) return page(pages.replay, pages.csp.replay);
  if (path === "/proof" && pages.proof && pages.csp.proof) return page(pages.proof, pages.csp.proof);
  if (path === "/verify" && pages.verify && pages.csp.verify) return page(pages.verify, pages.csp.verify);
  if (path === "/trace" && pages.trace && pages.csp.trace) return page(pages.trace, pages.csp.trace);
  if (path === "/runs" && pages.runs && pages.csp.runs) return page(pages.runs, pages.csp.runs);
  // The installed app's files: /manifest.webmanifest, /sw.js, /offline, /app and its script (./pwa.ts).
  const app = pages.app ? appResponse(path, pages.app) : null;
  if (app) return app;
  const agent = /^\/agents\/([a-z]{1,20})$/.exec(path)?.[1];
  if (agent && pages.agents && Object.hasOwn(pages.agents, agent)) return page(pages.agents[agent]!.page, pages.agents[agent]!.csp);
  const moved = pages.redirects && Object.hasOwn(pages.redirects, path) ? pages.redirects[path] : undefined;
  if (moved) return new Response(null, { status: 302, headers: { ...COMMON_HEADERS, location: moved } });
  const gone = pages.moved && Object.hasOwn(pages.moved, path) ? pages.moved[path] : undefined;
  if (gone) return new Response(null, { status: 301, headers: { ...COMMON_HEADERS, location: gone + new URL(req.url).search } });
  if (path === "/month") return page(pages.month, pages.csp.month);
  if (path === "/demo") return page(pages.demo, pages.csp.demo);
  if (path === "/live") return page(pages.live, pages.csp.live);
  if (path === "/film") return page(pages.film, pages.csp.film);
  if (path === "/try") return page(pages.try, pages.csp.try);
  if (path === "/try/sign" && pages.trySign && pages.csp.trySign) return page(pages.trySign, pages.csp.trySign);
  if (path === "/try/verify" && pages.tryVerify && pages.csp.tryVerify) return page(pages.tryVerify, pages.csp.tryVerify);
  if (path === "/lab") return page(pages.lab, pages.csp.lab);
  // Metal is now Alta (14 Nov): the page is at /alta; /metal answers 301 to it (pages.moved, above).
  if (path === "/alta") return page(pages.metal, pages.csp.metal);
  if (path === "/visa" && pages.visa) return page(pages.visa, pages.csp.visa);
  if (path === "/airwallex" && pages.airwallex && pages.csp.airwallex) return page(pages.airwallex, pages.csp.airwallex);
  if (path === "/airwallex/calls" && pages.awxCalls && pages.csp.awxCalls) return page(pages.awxCalls, pages.csp.awxCalls);
  if (path === "/claude" && pages.claude && pages.csp.claude) return page(pages.claude, pages.csp.claude);
  if (path === "/security" && pages.security && pages.csp.security) return page(pages.security, pages.csp.security);
  if (path === "/docs" && pages.docs && pages.csp.docs) return page(pages.docs, pages.csp.docs);
  if (path === "/privacy" && pages.privacy && pages.csp.privacy) return page(pages.privacy, pages.csp.privacy);
  if (path === "/business" && pages.business && pages.csp.business) return page(pages.business, pages.csp.business);
  if (path === "/one-pager" && pages.onePager && pages.csp.onePager) return page(pages.onePager, pages.csp.onePager);
  if (path === "/status" && pages.status && pages.csp.status) return page(pages.status, pages.csp.status);
  if (path === "/t0" && pages.t0 && pages.csp.t0) return page(pages.t0, pages.csp.t0);
  if (path === "/books" && pages.books && pages.csp.books) return page(pages.books, pages.csp.books);
  if (path === "/metal/report" && pages.metalReport) return page(pages.metalReport, pages.csp.metalReport);
  if (path.startsWith("/approve/") && PROPOSAL_ID.test(path.slice("/approve/".length))) return page(pages.approve, pages.csp.approve);
  if (path === "/enrol") return page(pages.enrol, pages.csp.enrol);
  if (path === "/policy") return page(pages.policy, pages.csp.policy);
  if (path === "/llms.txt" && pages.llms) return new Response(pages.llms, { headers: { ...COMMON_HEADERS, "content-type": "text/plain; charset=utf-8" } });
  if (path === "/proof.json" && pages.proofJson) return new Response(pages.proofJson, { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } });
  if (path === "/receipt-sample.json" && pages.receiptSample) return new Response(pages.receiptSample, { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } });
  // The sample proof bundles, for a visitor with no file of their own to drop on /verify. Only the names the build carries.
  const sample = path.startsWith("/verify/samples/") ? path.slice("/verify/samples/".length) : "";
  if (sample && pages.proofSamples && Object.hasOwn(pages.proofSamples, sample)) return new Response(pages.proofSamples[sample]!, { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${sample}"` } });
  if (path === "/t0-readback.json" && pages.t0Readback) return new Response(pages.t0Readback, { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="t0-readback.json"' } });
  if (path === "/assets/approve.js") return new Response(pages.client, { headers: { ...COMMON_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
  if (path === "/assets/inter.woff2") {
    return new Response(Uint8Array.from(atob(pages.font), (c) => c.charCodeAt(0)), {
      headers: { ...COMMON_HEADERS, "content-type": "font/woff2", "cache-control": cacheFor(path) },
    });
  }
  // Purser's icons at the root too (/favicon.ico, /favicon.svg, /apple-touch-icon.png, /icon.png): a page with no icon
  // link, a home-screen shortcut, and /try (Purser Cloud's page, served here through the binding, which links them at the
  // root) all get the header's mark.
  const imageName = ROOT_ICONS.includes(path) ? path.slice(1) : path.startsWith("/assets/") ? path.slice("/assets/".length) : "";
  if (imageName && Object.hasOwn(pages.images, imageName)) {
    const img = pages.images[imageName]!;
    return new Response(Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0)), {
      headers: { ...COMMON_HEADERS, "content-type": img.type, "cache-control": cacheFor(path) },
    });
  }
  if (path === "/assets/approve.css") return new Response(pages.css, { headers: { ...COMMON_HEADERS, "content-type": "text/css; charset=utf-8" } });
  // /mcp and /connect are Purser Cloud's (the MCP server and the connect settings), not this site's: someone who tries
  // them here is sent to the docs' "Connect your AI" card, which names the server's address (review, 13 Nov).
  if (CONNECT_PATHS.has(path)) return new Response(null, { status: 302, headers: { ...COMMON_HEADERS, location: CONNECT_DOCS } });
  // A link pasted with the sentence's full stop or comma on it ("…/judge." in a form, jury review, 7 Nov, #18) goes to
  // the same path without it, its query kept. Only a trailing "." or ","; the page itself is then answered as usual.
  // Never off the site (code review, 13 Nov): "//evil.com." trimmed is "//evil.com", which a browser reads as another
  // host; the new address must be this site's own path.
  const trimmed = path.replace(/[.,]+$/, "");
  if (trimmed !== path && trimmed.startsWith("/") && !/^[/\\]{2}/.test(trimmed)) {
    const here = new URL(req.url), to = new URL(trimmed + here.search, here);
    if (to.origin === here.origin && to.pathname === trimmed) return new Response(null, { status: 302, headers: { ...COMMON_HEADERS, location: trimmed + here.search } });
  }
  return null;
}

/** Paths someone may try on this site for Purser Cloud's MCP server or its connect page, and where they go. */
export const CONNECT_PATHS: ReadonlySet<string> = new Set(["/mcp", "/connect"]);
export const CONNECT_DOCS = "/docs#connect-ai";

/** Any other address: the clean 404 page when the bundle has one, else plain text. */
export function notFoundResponse(pages: Pages): Response {
  if (pages.notFound && pages.csp.notFound) return new Response(pages.notFound, { status: 404, headers: { ...PAGE_HEADERS, "content-security-policy": pages.csp.notFound } });
  return new Response("not found", { status: 404, headers: { ...COMMON_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The viewer key the runner derives in src/relay/config.ts viewKey(): HMAC-SHA256(relay token, "kit11 view v1"), 32 hex. */
async function viewKeyOf(token: string): Promise<string> {
  return (await hmacHex(token, "kit11 view v1")).slice(0, 32);
}

/** D20: the Monday (UTC) that starts d's ISO week, as YYYY-MM-DD. */
export function isoWeekStart(d: Date): string {
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

/** D20: with MFA on, the viewer key expires: HMAC-SHA256(relay token, "kit11 view v2 <week>"), 32 hex; the runner prints this week's. */
export async function viewKeyForWeek(token: string, d: Date): Promise<string> {
  return (await hmacHex(token, `kit11 view v2 ${isoWeekStart(d)}`)).slice(0, 32);
}

const SESSION_MS = 12 * 3600 * 1000;
/**
 * The passkey session's cookie (ASVS V3.4.4): the __Host- prefix makes a browser take it only when it is Secure, has
 * Path=/ and no Domain, so no other host (a sibling under workers.dev included) can set or shadow it. Until 19 Nov it was
 * kit11_session with Path=/api; a browser still holding that one is simply asked to sign in again.
 */
export const SESSION_COOKIE = "__Host-kit11_session";
const SESSION_CHALLENGE_MS = 2 * 60 * 1000;
const randomB64u = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Compares secrets through their digests, in constant time. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function ticketId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reads a body up to a limit. Null means too large; undefined means not JSON. */
/** The body as text, or null when it is over the limit (a declared size over it is refused before a byte is read). */
async function readText(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > limit) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).length > limit ? null : text;
}

/** application/json, with any parameters (a charset), in any case: the only type a JSON body is taken with (ASVS V13.1.5). */
export const isJsonType = (v: string | null): boolean => /^application\/json\s*(?:;|$)/i.test((v ?? "").trim());
/** Every JSON post (the runner's sync and the phone's posts) without that type: 415, after the token or origin check and before a byte is read. The webhook is Airwallex's own, checked by its signature. */
const UNSUPPORTED = "send the body as JSON with Content-Type: application/json";

async function readJson(req: Request, limit: number): Promise<{ text: string; value: unknown } | null | undefined> {
  const text = await readText(req, limit);
  if (text === null) return null;
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function b64urlToText(s: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function hexToB64url(hex: string): string {
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Whether the browser said it signed exactly this hash on this site (WebAuthn clientDataJSON). Not a signature
 * check (the runner does that); it keeps junk made from public data out of the queue.
 */
function signedFor(clientDataJSON: unknown, termsSha256: string, origin: string): boolean {
  if (typeof clientDataJSON !== "string") return false;
  const text = b64urlToText(clientDataJSON);
  if (text === null) return false;
  try {
    const c = JSON.parse(text) as Record<string, unknown>;
    return c.type === "webauthn.get" && c.challenge === hexToB64url(termsSha256) && c.origin === origin && c.crossOrigin !== true;
  } catch {
    return false;
  }
}

/** What an approval signs: the terms hash, or for an owners_execute the on-chain digest in its terms (null if none). */
function approvalChallenge(p: { kind?: string; canonical?: string; terms_sha256: string }): string | null {
  if (p.kind !== "owners_execute") return p.terms_sha256;
  try {
    const d = (JSON.parse(p.canonical ?? "") as Record<string, unknown>).onchain_digest;
    return typeof d === "string" && /^0x[0-9a-f]{64}$/.test(d) ? d.slice(2) : null;
  } catch {
    return null;
  }
}

/** The rate-limit key: an IPv4 address as is, an IPv6 address by its /64 (one subscriber gets a whole /64). */
export function rateKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

interface StoredState {
  generated_at: string;
  snapshot: Record<string, unknown>;
  approvals: {
    proposals: { proposal_id: string; terms_sha256: string; expires_at: string; kind?: string; canonical?: string }[];
    names: Record<string, string>;
    passkey: { rp_id: string; credentials: { id: string; label: string; enrolled_at: string; public_key?: PublicKeyXY }[] };
  };
  enrolment: null | { window_id: string; challenge: string; user_id: string; user_name: string; code_mac: string; rp_id: string; expires_at: string };
}

interface TicketRow {
  ticket: string;
  kind: string;
  proposal_id: string | null;
  body: string;
  received_at: string;
  status: string;
  message: string | null;
  updated_at: string;
}

export class Relay {
  private readonly now: () => Date;
  /** The live Airwallex events feed (./awxEvents.ts): four fields of each verified webhook, the last 50. */
  private readonly events: AwxEventFeed;

  /** liveRun: a live run is declared (the Worker's LIVE_RUN variable), so /health keeps the alarm however long the runner is silent. */
  /**
   * liveAgents: /try/sign's spend on live agents today, read from its own instance ("try-sign", worker/src/index.ts),
   * where its table is; absent, /health says nothing about it.
   */
  /** The security log's alarm rules (src/lib/securityEvents.ts), from the Worker's SECURITY_ALARMS var or the defaults. */
  private readonly alarmRules: AlarmRule[];
  /** Requests whose sync carried a newly reported tamper alarm (their security event is tamper.alarm). */
  private readonly tampered = new WeakSet<Request>();

  /**
   * push: Web Push to the CFO's phone (./webPush.ts), when the Worker has its VAPID secrets: the public key, and a sender
   * that holds the private key (the relay never does). Absent, the push routes answer 404 and nothing is sent.
   */
  constructor(private readonly sql: Sql, private readonly opts: { relayToken: string; webhookSecret?: string; now?: () => Date; mfa?: boolean; liveRun?: boolean; liveAgents?: () => Promise<{ usd: number; budget_usd: number } | null>; securityAlarms?: string; push?: { publicKey: string; send: PushSend }; build?: { sha: string | null; built_at: string | null } }) {
    this.now = opts.now ?? (() => new Date());
    this.alarmRules = alarmRules(opts.securityAlarms);
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      ticket TEXT PRIMARY KEY, kind TEXT NOT NULL, proposal_id TEXT, window_id TEXT, body TEXT NOT NULL,
      received_at TEXT NOT NULL, status TEXT NOT NULL, message TEXT, updated_at TEXT NOT NULL)`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS hooks (id TEXT PRIMARY KEY, ts TEXT NOT NULL, signature TEXT NOT NULL, body TEXT NOT NULL, received_at TEXT NOT NULL)");
    // D20: passkey sessions (stored hashed), their one-time challenges, and each credential's last signature counter.
    this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, credential TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS session_challenges (challenge TEXT PRIMARY KEY, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS cred_counters (credential TEXT PRIMARY KEY, counter INTEGER NOT NULL)");
    // Web Push: the phones that asked to be told (at most MAX_PUSH_SUBS), and the proposals they were already told about.
    this.sql.exec("CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS push_told (proposal_id TEXT PRIMARY KEY, at TEXT NOT NULL)");
    this.events = new AwxEventFeed(this.sql);
    // The security event log (ASVS V7.1.3, V7.2.1, V7.2.2): append-only in the database itself, kept 90 days at least.
    this.sql.exec("CREATE TABLE IF NOT EXISTS sec_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, ip TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL, detail_json TEXT NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sec_log_by_kind ON sec_log (kind, at)");
    this.sql.exec("CREATE TRIGGER IF NOT EXISTS sec_log_no_update BEFORE UPDATE ON sec_log BEGIN SELECT RAISE(ABORT, 'sec_log is append-only'); END");
    this.sql.exec(`CREATE TRIGGER IF NOT EXISTS sec_log_keep BEFORE DELETE ON sec_log WHEN OLD.at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${SEC_LOG_KEEP_DAYS} days') BEGIN SELECT RAISE(ABORT, 'sec_log rows are kept 90 days'); END`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS sec_counts (rule TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (rule, win))");
  }

  /**
   * One security event: a row in sec_log (at most SEC_LOG_ROWS_PER_MINUTE per kind and network a minute; past it only
   * counted) and a JSON log line; an alarm when it brings a rule to its threshold in the rule's window. The address is
   * cut to its network; the detail keeps short plain values and never a secret (src/lib/securityEvents.ts).
   */
  private securityEvent(kind: SecurityKind, req: Request, route: string, status: number, detail: Record<string, unknown> = {}): void {
    const now = this.now();
    const iso = now.toISOString();
    const ip = truncatedIp(req.headers.get("cf-connecting-ip"));
    const d = cleanDetail(detail);
    const warn = kind.endsWith("failure") || kind === "access.denied" || kind === "rate.limited";
    (kind === "tamper.alarm" ? console.error : warn ? console.warn : console.log)(JSON.stringify({ ts: iso, level: kind === "tamper.alarm" ? "error" : warn ? "warn" : "info", event: `security.${kind}`, ip, route, status, ...d }));
    try {
      const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
      const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM sec_log WHERE kind = ? AND at >= ? AND ip = ?", kind, minute, ip).toArray() as [{ n: number }];
      if (n < SEC_LOG_ROWS_PER_MINUTE) this.sql.exec("INSERT INTO sec_log (at, kind, ip, route, status, detail_json) VALUES (?, ?, ?, ?, ?, ?)", iso, kind, ip, route, status, JSON.stringify(d));
      for (const rule of this.alarmRules.filter((r) => r.kinds.includes(kind))) {
        const win = windowStart(now, rule.windowSec);
        const [{ n: count }] = this.sql.exec("INSERT INTO sec_counts (rule, win, n) VALUES (?, ?, 1) ON CONFLICT(rule, win) DO UPDATE SET n = n + 1 RETURNING n", rule.name, win).toArray() as [{ n: number }];
        if (count !== rule.threshold) continue;
        const alarm = { rule: rule.name, threshold: rule.threshold, window_sec: rule.windowSec, window_start: new Date(win * 1000).toISOString() };
        console.error(JSON.stringify({ ts: iso, level: "error", event: "security.alarm", ...alarm }));
        this.sql.exec("INSERT INTO sec_log (at, kind, ip, route, status, detail_json) VALUES (?, 'alarm.raised', 'unknown', ?, 0, ?)", iso, route, JSON.stringify(alarm));
      }
    } catch (e) {
      console.error(JSON.stringify({ ts: iso, level: "error", event: "security_log_failed", kind, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    }
  }

  /** Alarms raised in the last 24 hours, in all and per rule: on /health (counts only). */
  private securityAlarms(): { alarms_24h: number; rules: Record<string, number> } {
    const since = new Date(this.now().getTime() - 86_400_000).toISOString();
    const rows = this.sql.exec("SELECT detail_json FROM sec_log WHERE kind = 'alarm.raised' AND at > ? ORDER BY seq", since).toArray() as { detail_json: string }[];
    const rules: Record<string, number> = {};
    for (const r of rows) { const name = String((JSON.parse(r.detail_json) as { rule?: string }).rule ?? "unknown"); rules[name] = (rules[name] ?? 0) + 1; }
    return { alarms_24h: rows.length, rules };
  }

  /** Rows past their 90 days go, and the counters of old windows (on each sync; the trigger refuses younger rows). */
  private pruneSecurityLog(): void {
    const now = this.now().getTime();
    this.sql.exec("DELETE FROM sec_log WHERE at < ?", new Date(now - (SEC_LOG_KEEP_DAYS + 1) * 86_400_000).toISOString());
    this.sql.exec("DELETE FROM sec_counts WHERE win < ?", Math.floor(now / 1000) - 2 * 86_400);
  }

  /** The viewer key: the fixed one, or with MFA on this week's or last week's (it expires). */
  private async viewerOk(given: string): Promise<boolean> {
    if (!this.opts.mfa) return sameSecret(given, await viewKeyOf(this.opts.relayToken));
    const now = this.now();
    return (await sameSecret(given, await viewKeyForWeek(this.opts.relayToken, now)))
      || sameSecret(given, await viewKeyForWeek(this.opts.relayToken, new Date(now.getTime() - 7 * 864e5)));
  }

  /** A live passkey session: the cookie's hash is stored, unexpired, and its passkey is still enrolled. */
  private async sessionOk(req: Request): Promise<boolean> {
    const m = /(?:^|;\s*)__Host-kit11_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.get("cookie") ?? "");
    if (!m) return false;
    const rows = this.sql.exec("SELECT credential, expires FROM sessions WHERE id_hash = ?", await sha256Hex(m[1]!)).toArray() as { credential: string; expires: number }[];
    const row = rows[0];
    if (!row || row.expires <= this.now().getTime()) return false;
    return (this.state()?.approvals.passkey.credentials ?? []).some((c) => c.id === row.credential);
  }

  private sessionOptions(): Response {
    const now = this.now().getTime();
    this.sql.exec("DELETE FROM session_challenges WHERE expires <= ?", now);
    const challenge = randomB64u(32);
    this.sql.exec("INSERT INTO session_challenges (challenge, expires) VALUES (?, ?)", challenge, now + SESSION_CHALLENGE_MS);
    const s = this.state();
    return json(200, { challenge, rp_id: s?.approvals.passkey.rp_id ?? null, allow: (s?.approvals.passkey.credentials ?? []).map((c) => c.id), timeout_ms: SESSION_CHALLENGE_MS });
  }

  private async openSession(req: Request, origin: string): Promise<Response> {
    const body = await readJson(req, 16_384);
    if (!body || !isObject(body.value)) return error(400, "malformed sign-in");
    const { challenge, credential } = body.value as { challenge?: unknown; credential?: unknown };
    if (typeof challenge !== "string" || !isObject(credential) || typeof credential.id !== "string" || !isObject(credential.response)) return error(400, "malformed sign-in");
    const now = this.now().getTime();
    // One use only, whatever happens next: a replayed sign-in finds no challenge.
    const known = this.sql.exec("SELECT expires FROM session_challenges WHERE challenge = ?", challenge).toArray() as { expires: number }[];
    this.sql.exec("DELETE FROM session_challenges WHERE challenge = ?", challenge);
    if (!known[0] || known[0].expires <= now) { this.countFailure(req); return error(401, "this sign-in has expired or was used; start again"); }
    const s = this.state();
    const cred = s?.approvals.passkey.credentials.find((c) => c.id === credential.id);
    if (!s || !cred) return error(403, "this passkey is not enrolled");
    if (!cred.public_key) return error(403, "this relay has no public key for that passkey: the runner needs KIT11_MFA=on, and sign-in takes an ES256 passkey (phones and most security keys; enrol one if this is an RSA key)");
    const r = credential.response as Record<string, unknown>;
    const last = (this.sql.exec("SELECT counter FROM cred_counters WHERE credential = ?", cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    const v = await verifyAssertion({ authenticatorData: String(r.authenticatorData ?? ""), clientDataJSON: String(r.clientDataJSON ?? ""), signature: String(r.signature ?? "") }, cred.public_key, { challenge, origin, rpId: s.approvals.passkey.rp_id, lastCounter: last });
    if (!v.ok) { this.countFailure(req); return error(401, `the passkey sign-in did not verify (${v.why})`); }
    // Read the counter again after the awaits above: another sign-in may have stored a higher one meanwhile. The read
    // and the write below run with no await between them, so nothing interleaves (security review, 1 Nov).
    const latest = (this.sql.exec("SELECT counter FROM cred_counters WHERE credential = ?", cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    if ((v.counter !== 0 || latest !== 0) && v.counter <= latest) { this.countFailure(req); return error(401, "the passkey sign-in did not verify (counter)"); }
    this.sql.exec("INSERT INTO cred_counters (credential, counter) VALUES (?, ?) ON CONFLICT(credential) DO UPDATE SET counter = excluded.counter", cred.id, v.counter);
    this.sql.exec("DELETE FROM sessions WHERE expires <= ?", now);
    const id = randomB64u(32);
    this.sql.exec("INSERT INTO sessions (id_hash, credential, expires) VALUES (?, ?, ?)", await sha256Hex(id), cred.id, now + SESSION_MS);
    return new Response(JSON.stringify({ signed_in: true, label: cred.label, expires_at: new Date(now + SESSION_MS).toISOString() }), {
      status: 200,
      headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="api.json"', "set-cookie": `${SESSION_COOKIE}=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` },
    });
  }

  private get(k: string): string | null {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray() as { v: string }[];
    return rows[0]?.v ?? null;
  }

  private put(k: string, v: string): void {
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }

  private state(): StoredState | null {
    const s = this.get("state");
    return s ? (JSON.parse(s) as StoredState) : null;
  }

  /**
   * /try/sign's live agents today: USD spent of the daily budget, from its own instance (code review, 13 Nov: its table
   * is in the "try-sign" instance, never in the relay's), or null when it cannot say.
   */
  private async liveAgentsToday(): Promise<{ usd: number; budget_usd: number } | null> {
    try {
      return (await this.opts.liveAgents?.()) ?? null;
    } catch {
      return null;
    }
  }

  private relayInfo(state: StoredState) {
    const synced = this.get("synced_at") ?? state.generated_at;
    return { synced_at: synced, generated_at: state.generated_at, age_ms: Math.max(0, this.now().getTime() - Date.parse(synced)) };
  }

  /** Counts this request against its address (in its own bucket: D20 sign-ins have theirs); true while under the limit. */
  private underRateLimit(req: Request, bucket = ""): boolean {
    const ip = bucket + rateKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    const now = this.now().getTime();
    this.sql.exec("DELETE FROM hits WHERE at <= ?", now - RATE_WINDOW_MS);
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM hits WHERE ip = ?", ip).toArray() as [{ n: number }];
    if (n >= RATE_MAX) return false;
    this.sql.exec("INSERT INTO hits (ip, at) VALUES (?, ?)", ip, now);
    return true;
  }

  private failKey(req: Request): string {
    return `fail:${rateKey(req.headers.get("cf-connecting-ip") ?? "unknown")}`;
  }

  /** True once this address has failed the viewer key or a webhook signature FAILS_MAX times in the window (HF1). */
  private failedTooOften(req: Request): boolean {
    this.sql.exec("DELETE FROM hits WHERE at <= ?", this.now().getTime() - RATE_WINDOW_MS);
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM hits WHERE ip = ?", this.failKey(req)).toArray() as [{ n: number }];
    return n >= FAILS_MAX;
  }

  private countFailure(req: Request): void {
    this.sql.exec("INSERT INTO hits (ip, at) VALUES (?, ?)", this.failKey(req), this.now().getTime());
  }

  /**
   * Every request, then its security event when it is one (ASVS V7.2.1, V7.2.2): decided here from the path and the
   * status, so no refusal deep in a handler goes unlogged. 401: auth.failure (a passkey route: passkey.failure; the
   * webhook: webhook.signature_failure). 403: access.denied (a passkey route: passkey.failure). 429: rate.limited. A
   * signature refused as not for these terms (400 on a passkey route): passkey.failure. Successes: a passkey sign-in
   * (passkey.success), a policy change or policy text queued (policy.change), an enrolment queued (access.change), a
   * sync that newly reports tampered terms (tamper.alarm).
   */
  async fetch(req: Request): Promise<Response> {
    const res = await this.route(req);
    const path = new URL(req.url).pathname;
    if (!path.startsWith("/api/") && path !== "/hooks/airwallex") return res;
    const kind = this.securityKindOf(req, path, res);
    if (!kind) return res;
    const detail: Record<string, unknown> = { method: req.method };
    if (res.status >= 400) { try { const b = await res.clone().json() as { error?: unknown }; if (typeof b.error === "string") detail.reason = b.error; } catch { /* not JSON */ } }
    if (kind === "passkey.failure" && res.status === 400 && !/signature|passkey/.test(String(detail.reason ?? ""))) return res;
    this.securityEvent(kind, req, `${req.method} ${/^\/api\/tickets\//.test(path) ? "/api/tickets/{id}" : path}`, res.status, detail);
    return res;
  }

  private securityKindOf(req: Request, path: string, res: Response): SecurityKind | null {
    const passkeyRoute = path === "/api/session" || path === "/api/assertions" || path === "/api/policy" || path === "/api/enrol";
    if (this.tampered.has(req)) return "tamper.alarm";
    if (res.status === 401) return path === "/hooks/airwallex" ? "webhook.signature_failure" : path === "/api/session" ? "passkey.failure" : "auth.failure";
    if (res.status === 403) return passkeyRoute && path !== "/api/enrol" ? "passkey.failure" : "access.denied";
    if (res.status === 429) return "rate.limited";
    if (res.status === 400 && passkeyRoute) return "passkey.failure";
    if (res.status >= 200 && res.status < 300 && req.method === "POST") {
      if (path === "/api/session") return "passkey.success";
      if (path === "/api/policy" || path === "/api/policy-text") return "policy.change";
      if (path === "/api/enrol") return "access.change";
    }
    return null;
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const route = (method: string, p: string | RegExp) => (typeof p === "string" ? path === p : p.test(path)) && (req.method === method || (method === "GET" && req.method === "HEAD"));
    const known = ["/api/runner/sync", "/api/snapshot", "/api/approvals", "/api/assertions", "/api/policy", "/api/policy-text", "/api/ask", "/api/enrol/options", "/api/enrol", "/api/push/key", "/api/push/subscribe", "/api/push/unsubscribe", ...(this.opts.mfa ? ["/api/session/options", "/api/session"] : [])];

    if (route("POST", "/api/runner/sync")) return this.sync(req);
    // Monitoring (B7), alarm codes only; no amounts, names or ids (the details stay behind the viewer key).
    // /health/live is the alarm, for an uptime monitor and the CFO: 503 while anything is wrong or the runner has stopped
    // syncing. /health is what anyone sees: the same while a live run is expected (the runner synced in the last 30
    // minutes, or LIVE_RUN declares one); between live runs, 200 and "Recorded demo · the live runner runs during live runs".
    if (route("GET", "/health") || route("GET", "/health/live")) {
      const state = this.state();
      const raw = state?.snapshot.health as Health | undefined;
      // A runner too old to send health is "unknown", never "ok".
      const ok = raw && typeof raw.at === "string" && Array.isArray(raw.alerts) ? raw : null;
      const info = state ? this.relayInfo(state) : null;
      const h = path === "/health/live" ? publicHealth(ok, info?.age_ms ?? null) : publicStatus(ok, info?.age_ms ?? null, { liveRun: this.opts.liveRun, lastSync: info?.synced_at ?? null });
      // Section 6 (Max, 7 Nov): today's spend on /try/sign's live agents, against its daily budget, on /health.
      const live = path === "/health" ? await this.liveAgentsToday() : null;
      // The security log's alarms of the last 24 hours (counts per rule, no address): an uptime monitor can watch it.
      // Which commit runs here and when it was built (scripts/deploy.ts stamps them; ASVS V1.14.4).
      const build = { sha: this.opts.build?.sha ?? null, built_at: this.opts.build?.built_at ?? null };
      return json(h.status, { ...h.body, ...(live ? { live_agents_today: live } : {}), build, security: this.securityAlarms() });
    }
    // The live Airwallex events feed: public, read-only, four fields of each verified webhook (./awxEvents.ts).
    if (path === AWX_EVENTS_PATH) {
      if (req.method !== "GET" && req.method !== "HEAD") return error(405, "method not allowed");
      const r = json(200, this.events.list(this.now(), !!this.opts.webhookSecret));
      r.headers.set("cache-control", "public, max-age=10");
      return r;
    }
    // An address that keeps failing the viewer key or the webhook signature is refused before either is checked,
    // so guessing is slowed and shows up (HF1). The runner's route has its own token and is not counted.
    if ((path === "/hooks/airwallex" || path.startsWith("/api/")) && this.failedTooOften(req)) {
      return error(429, "too many failed attempts from this address; wait ten minutes");
    }
    // Airwallex's webhooks: no viewer key (Airwallex has none), its own signature instead.
    if (path === "/hooks/airwallex") return req.method === "POST" ? this.hook(req) : error(405, "method not allowed");
    // Everything else under /api/ is the CFO's: the dashboard data, the pending terms, the phone's submissions.
    // Without the viewer key (from the link the runner prints) it answers nothing (security review M2).
    if (path.startsWith("/api/") && !(await this.viewerOk(req.headers.get("x-kit11-view") ?? ""))) {
      this.countFailure(req);
      return error(401, "this relay needs its viewer link: open the link from the runner once on this device");
    }
    if (route("GET", "/api/snapshot")) return this.snapshot();
    if (route("GET", "/api/approvals")) return this.approvals(req);
    if (route("GET", /^\/api\/tickets\/[^/]+$/)) return this.ticket(path.slice("/api/tickets/".length));
    // Web Push: the public key the phone subscribes with; 404 when this relay has none (no VAPID secrets).
    if (route("GET", "/api/push/key")) return this.opts.push ? json(200, { public_key: this.opts.push.publicKey }) : error(404, "push is not set up on this relay");
    // Everything the phone posts must come from the relay's own pages.
    const sessionPath = this.opts.mfa && (path === "/api/session/options" || path === "/api/session");
    if (req.method === "POST" && (path === "/api/assertions" || path === "/api/policy" || path === "/api/policy-text" || path === "/api/ask" || path.startsWith("/api/enrol") || path.startsWith("/api/push/") || sessionPath)) {
      if (req.headers.get("origin") !== url.origin) return error(403, "requests must come from this site's own pages");
      // A JSON post that does not say it is JSON is refused before it is read (ASVS V13.1.5, V13.2.5).
      if (!isJsonType(req.headers.get("content-type"))) return error(415, UNSUPPORTED);
      // D20: signing in (two posts) counts in its own bucket of the same size, so it never uses up the approvals'.
      // Push subscriptions count in a bucket of their own too.
      if (!this.underRateLimit(req, sessionPath ? "session:" : path.startsWith("/api/push/") ? "push:" : "")) return error(429, "too many requests from this address; wait ten minutes");
      if (path === "/api/session/options") return this.sessionOptions();
      if (path === "/api/session") return this.openSession(req, url.origin);
      // D20: the CFO's endpoints need a passkey session; the viewer link alone only reads. Approvals keep their own
      // per-terms passkey signature (step-up), enrolment its code and the runner's confirmation.
      if (this.opts.mfa && (path === "/api/policy" || path === "/api/policy-text" || path === "/api/ask") && !(await this.sessionOk(req))) {
        return error(401, "sign in with your passkey first (a session for the CFO's actions)");
      }
      if (path === "/api/assertions") return this.assertion(req);
      if (path === "/api/policy") return this.policyChange(req);
      if (path === "/api/policy-text") return this.policyText(req);
      if (path === "/api/ask") return this.ask(req);
      if (path === "/api/enrol/options") return this.enrolOptions(req);
      if (path === "/api/enrol") return this.enrol(req);
      if (path === "/api/push/subscribe") return this.pushSubscribe(req);
      if (path === "/api/push/unsubscribe") return this.pushUnsubscribe(req);
    }
    if (known.includes(path) || path.startsWith("/api/tickets/")) return error(405, "method not allowed");
    return error(404, "not found");
  }

  private async sync(req: Request): Promise<Response> {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ") || !(await sameSecret(auth.slice(7), this.opts.relayToken))) return error(401, "the relay token is missing or wrong");
    if (!isJsonType(req.headers.get("content-type"))) return error(415, UNSUPPORTED);
    const body = await readJson(req, MAX_STATE_BYTES);
    if (body === null) return error(413, "state too large");
    if (body === undefined || !isObject(body.value) || typeof body.value.state_hash !== "string") return error(400, "malformed sync");
    const { state_hash, state, acks, hook_acks } = body.value;
    const now = this.now();
    if (state !== undefined) {
      if (!isObject(state) || !isObject(state.snapshot) || !isObject(state.approvals)) return error(400, "malformed state");
      // A tamper alarm the runner reports for the first time is a security event (once, not on every sync).
      const codes = (h: unknown): string[] => (isObject(h) && Array.isArray(h.alerts) ? h.alerts.map((a) => (isObject(a) && typeof a.code === "string" ? a.code : "")).filter((c) => TAMPER_CODE.test(c)) : []);
      const before = codes(this.state()?.snapshot.health);
      if (codes(state.snapshot.health).some((c) => !before.includes(c))) this.tampered.add(req);
      this.put("state", JSON.stringify(state));
      this.put("state_hash", state_hash);
      // A proposal newly waiting for the CFO (above an agent's limit): tell the phones that asked. Never the terms.
      try { await this.pushNew(state as unknown as StoredState); } catch { /* a failed notice never fails the sync */ }
    }
    this.put("synced_at", now.toISOString());
    this.pruneSecurityLog();
    if (Array.isArray(acks)) {
      for (const a of acks) {
        if (!isObject(a) || typeof a.ticket !== "string" || typeof a.status !== "string" || !ACK_STATUSES.has(a.status)) continue;
        const message = typeof a.message === "string" ? a.message.slice(0, 500) : null;
        this.sql.exec("UPDATE inbox SET status = ?, message = ?, updated_at = ? WHERE ticket = ?", a.status, message, now.toISOString(), a.ticket);
      }
    }
    // Answered tickets are kept an hour for the phone to read; unanswered ones are dropped after thirty minutes.
    this.sql.exec("DELETE FROM inbox WHERE status != 'queued' AND updated_at <= ?", new Date(now.getTime() - ANSWERED_KEEP_MS).toISOString());
    this.sql.exec("DELETE FROM inbox WHERE status = 'queued' AND received_at <= ?", new Date(now.getTime() - QUEUED_KEEP_MS).toISOString());
    const inbox = (this.sql.exec("SELECT ticket, kind, proposal_id, body, received_at FROM inbox WHERE status = 'queued' ORDER BY received_at, ticket LIMIT ?", MAX_QUEUED).toArray());
    // Webhook events the runner has recorded are dropped; the rest go out again (at most a day).
    if (Array.isArray(hook_acks)) for (const id of hook_acks.slice(0, 200)) if (typeof id === "string") this.sql.exec("DELETE FROM hooks WHERE id = ?", id);
    this.sql.exec("DELETE FROM hooks WHERE received_at <= ?", new Date(now.getTime() - HOOK_KEEP_MS).toISOString());
    const hooks = this.sql.exec("SELECT id, ts, signature, body FROM hooks ORDER BY received_at, id LIMIT ?", HOOKS_PER_SYNC).toArray();
    return json(200, { need_state: this.get("state_hash") !== state_hash, inbox, hooks });
  }

  /**
   * An Airwallex webhook: x-signature must be HMAC-SHA256(secret, x-timestamp + raw body) and the timestamp recent.
   * The event is kept for the runner, which checks the signature again; the answer to Airwallex does not wait for it.
   */
  private async hook(req: Request): Promise<Response> {
    const secret = this.opts.webhookSecret;
    if (!secret) return error(503, "webhooks are not set up on this relay");
    const text = await readText(req, MAX_HOOK_BYTES);
    if (text === null) return error(413, "event too large");
    const ts = req.headers.get("x-timestamp") ?? "";
    const signature = (req.headers.get("x-signature") ?? "").toLowerCase();
    const age = Math.abs(this.now().getTime() - Number(ts));
    // The body is checked exactly as received, before anything parses it (HF10: also when it is not JSON).
    if (!/^\d{10,16}$/.test(ts) || !(age <= HOOK_TOLERANCE_MS) || !/^[0-9a-f]{64}$/.test(signature) || !(await sameSecret(signature, await hmacHex(secret, ts + text)))) {
      this.countFailure(req);
      return error(401, "bad or missing webhook signature");
    }
    let v: unknown;
    try { v = JSON.parse(text); } catch { return error(400, "malformed event"); }
    if (!isObject(v) || typeof v.id !== "string" || v.id.length > 128) return error(400, "malformed event");
    this.sql.exec("INSERT INTO hooks (id, ts, signature, body, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", v.id, ts, signature, text, this.now().toISOString());
    // The public feed keeps four fields of it (type, object id, times), never the body (./awxEvents.ts).
    this.events.record(v, this.now());
    // A flood cannot grow the store: the oldest events go first (the runner's poll still finds their transactions).
    this.sql.exec("DELETE FROM hooks WHERE id IN (SELECT id FROM hooks ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?)", MAX_HOOKS);
    return json(200, { received: true });
  }

  /** A phone's push subscription ({endpoint, keys}), from the dashboard's "Notify me"; only a known push service's address. */
  private async pushSubscribe(req: Request): Promise<Response> {
    if (!this.opts.push) return error(404, "push is not set up on this relay");
    const body = await readJson(req, 4096);
    const sub = body ? readSubscription(body.value) : null;
    if (!sub) return error(400, "malformed subscription (a browser push subscription from a known push service)");
    this.sql.exec("INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
      sub.endpoint, sub.p256dh, sub.auth, this.now().toISOString());
    // The newest few only: an old phone's subscription goes first.
    this.sql.exec("DELETE FROM push_subs WHERE endpoint IN (SELECT endpoint FROM push_subs ORDER BY created_at DESC, endpoint DESC LIMIT -1 OFFSET ?)", MAX_PUSH_SUBS);
    return json(201, { subscribed: true });
  }

  private async pushUnsubscribe(req: Request): Promise<Response> {
    const body = await readJson(req, 4096);
    const endpoint = body && isObject(body.value) && typeof body.value.endpoint === "string" ? body.value.endpoint : null;
    if (!endpoint) return error(400, "malformed request");
    this.sql.exec("DELETE FROM push_subs WHERE endpoint = ?", endpoint);
    return json(200, { subscribed: false });
  }

  /**
   * "Payment needs your signature", once per proposal, to every subscribed phone: the proposal's id and the passkey page
   * to open, nothing of its terms (a lock screen shows it). A push service that says the subscription is gone (404, 410)
   * loses it. Sending never holds up or fails the runner's sync.
   */
  private async pushNew(state: StoredState): Promise<void> {
    const push = this.opts.push;
    const proposals = Array.isArray(state.approvals?.proposals) ? state.approvals.proposals : [];
    if (!push) return;
    const now = this.now();
    const fresh = proposals.filter((p) => typeof p.proposal_id === "string" && PROPOSAL_ID.test(p.proposal_id) && !(Date.parse(p.expires_at) <= now.getTime())
      && !(this.sql.exec("SELECT 1 FROM push_told WHERE proposal_id = ?", p.proposal_id).toArray().length));
    if (!fresh.length) return;
    for (const p of fresh) this.sql.exec("INSERT INTO push_told (proposal_id, at) VALUES (?, ?) ON CONFLICT(proposal_id) DO NOTHING", p.proposal_id, now.toISOString());
    this.sql.exec("DELETE FROM push_told WHERE at <= ?", new Date(now.getTime() - 30 * 864e5).toISOString());
    const subs = this.sql.exec("SELECT endpoint, p256dh, auth FROM push_subs").toArray() as { endpoint: string; p256dh: string; auth: string }[];
    const sends: Promise<void>[] = [];
    for (const p of fresh.slice(0, 5)) {
      const payload = JSON.stringify(pushMessage(p));
      for (const sub of subs) {
        sends.push(push.send(sub, payload).then((status) => {
          if (status === 404 || status === 410) this.sql.exec("DELETE FROM push_subs WHERE endpoint = ?", sub.endpoint);
        }, () => undefined));
      }
    }
    await Promise.all(sends);
  }

  private snapshot(): Response {
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    return json(200, { ...s.snapshot, relay: this.relayInfo(s) });
  }

  private async approvals(req: Request): Promise<Response> {
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    const open = s.enrolment !== null && Date.parse(s.enrolment.expires_at) > this.now().getTime();
    // D20: whether this device has a live passkey session, so the page signs in before the CFO's actions.
    const session = this.opts.mfa ? { session_active: await this.sessionOk(req) } : {};
    return json(200, { ...s.approvals, generated_at: s.generated_at, relay: this.relayInfo(s), enrolment_open: open, ...session });
  }

  private ticket(id: string): Response {
    if (!TICKET.test(id)) return error(404, "no such ticket");
    const rows = this.sql.exec("SELECT ticket, kind, proposal_id, status, message, received_at, updated_at FROM inbox WHERE ticket = ?", id).toArray();
    return rows[0] ? json(200, rows[0]) : error(404, "no such ticket");
  }

  private queue(kind: "assertion" | "registration" | "policy" | "policy_text" | "ask", proposalId: string | null, windowId: string | null, text: string): string {
    const ticket = ticketId();
    const at = this.now().toISOString();
    this.sql.exec("INSERT INTO inbox (ticket, kind, proposal_id, window_id, body, received_at, status, message, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?)",
      ticket, kind, proposalId, windowId, text, at, at);
    return ticket;
  }

  private queued(where: string, ...bindings: SqlValue[]): number {
    const [{ n }] = this.sql.exec(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'queued' AND ${where}`, ...bindings).toArray() as [{ n: number }];
    return n;
  }

  private async assertion(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.proposal_id !== "string" || !PROPOSAL_ID.test(v.proposal_id) || typeof v.terms_sha256 !== "string" || !HEX64.test(v.terms_sha256)
      || !isObject(v.credential) || typeof v.credential.id !== "string" || !isObject(v.credential.response)
      || (v.decision !== undefined && v.decision !== "APPROVED" && v.decision !== "REJECTED" && v.decision !== "REMOVE_LINE")
      || (v.decision === "REMOVE_LINE" && (typeof v.line !== "string" || !/^P-\d{4,}$/.test(v.line)))) return error(400, "malformed submission");
    const rejecting = v.decision === "REJECTED";
    // Taking one line out of a waiting batch (src/policy/batch.ts batchRemovalSha256): its own signed hash.
    const removing = v.decision === "REMOVE_LINE" ? (v.line as string) : null;
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    const p = s.approvals.proposals.find((x) => x.proposal_id === v.proposal_id);
    if (!p || p.terms_sha256 !== v.terms_sha256 || Date.parse(p.expires_at) <= this.now().getTime()) {
      return error(409, `${v.proposal_id} with these terms is not waiting for approval (expired, decided or changed)`);
    }
    const credentialId = v.credential.id;
    if (!s.approvals.passkey.credentials.some((c) => c.id === credentialId)) return error(403, "this passkey is not the enrolled one");
    // To reject, the passkey signs the hash derived from the terms hash (src/lib/terms.ts rejectionSha256).
    // Block 1: an owners_execute approval signs the account's Execute digest carried in the hashed terms.
    const challenge = removing ? await sha256Hex(`kit11 batch-remove v1 ${p.terms_sha256} ${removing}`)
      : rejecting ? await sha256Hex(`kit11 reject v1 ${p.terms_sha256}`) : approvalChallenge(p);
    if (challenge === null) return error(400, "these terms carry no valid on-chain digest");
    if (!signedFor((v.credential.response as Record<string, unknown>).clientDataJSON, challenge, new URL(req.url).origin)) {
      return error(400, `this signature is not ${removing ? "a removal from" : rejecting ? "a rejection of" : "for"} these terms on this site`);
    }
    if (this.queued("proposal_id = ?", p.proposal_id) >= MAX_QUEUED_PER_PROPOSAL || this.queued("1 = 1") >= MAX_QUEUED) {
      return error(429, "too many approvals are waiting for the runner; wait a moment");
    }
    return json(202, { ticket: this.queue("assertion", p.proposal_id, null, body!.text) });
  }

  /**
   * A policy change the phone wrote and signed itself. The relay checks that the canonical terms hash to the signed
   * hash, that they are a policy change with a phone id, the enrolled passkey and the browser's own statement; the
   * runner checks the change and the signature again before it becomes a proposal.
   */
  private async policyChange(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.canonical !== "string" || v.canonical.length > 8192 || typeof v.terms_sha256 !== "string" || !HEX64.test(v.terms_sha256)
      || !isObject(v.credential) || typeof v.credential.id !== "string" || !isObject(v.credential.response)) return error(400, "malformed submission");
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    const credentialId = v.credential.id;
    if (!s.approvals.passkey.credentials.some((c) => c.id === credentialId)) return error(403, "this passkey is not the enrolled one");
    if ((await sha256Hex(v.canonical)) !== v.terms_sha256) return error(400, "the terms do not hash to the signed hash");
    let terms: unknown;
    try {
      terms = JSON.parse(v.canonical);
    } catch {
      return error(400, "malformed terms");
    }
    if (!isObject(terms) || terms.kind !== "policy_change" || typeof terms.proposal_id !== "string" || !/^C-[0-9a-f]{8}$/.test(terms.proposal_id)) {
      return error(400, "not a policy change made on the phone");
    }
    if (!signedFor((v.credential.response as Record<string, unknown>).clientDataJSON, v.terms_sha256, new URL(req.url).origin)) {
      return error(400, "this signature is not for these terms on this site");
    }
    if (this.queued("kind = 'policy'") >= MAX_QUEUED_PER_PROPOSAL) return error(429, "too many policy changes are waiting for the runner");
    return json(202, { ticket: this.queue("policy", terms.proposal_id, null, body!.text) });
  }

  /**
   * The CFO's policy in their own words, for Opus to draft rules from on the runner (P2). It signs nothing and changes
   * nothing: the runner checks every drafted rule, refuses any that would loosen the policy (it came from the phone),
   * and the rest becomes a proposal that still needs Face ID. One at a time.
   */
  private async policyText(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.text !== "string" || v.text.trim() === "" || v.text.length > MAX_POLICY_TEXT) {
      return error(400, `write the policy in at most ${MAX_POLICY_TEXT} characters`);
    }
    if (!this.state()) return error(503, "the runner has not connected yet");
    if (this.queued("kind = 'policy_text'") >= 1) return error(429, "the runner is still reading your last text; wait for it");
    return json(202, { ticket: this.queue("policy_text", null, null, JSON.stringify({ text: v.text })) });
  }

  private async ask(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.text !== "string" || v.text.trim() === "" || v.text.length > MAX_ASK_TEXT) {
      return error(400, `write your request in at most ${MAX_ASK_TEXT} characters`);
    }
    if (!this.state()) return error(503, "the runner has not connected yet");
    if (this.queued("kind = 'ask'") >= 1) return error(429, "Purser is still answering your last message; wait for it");
    return json(202, { ticket: this.queue("ask", null, null, JSON.stringify({ text: v.text })) });
  }

  /** The open enrolment, after checking the code; counts wrong codes and closes the window after five. */
  private async checkCode(code: unknown): Promise<{ ok: true; e: NonNullable<StoredState["enrolment"]>; s: StoredState } | { ok: false; res: Response }> {
    const s = this.state();
    const e = s?.enrolment;
    if (!s || !e || Date.parse(e.expires_at) <= this.now().getTime()) return { ok: false, res: error(409, "no enrolment is open; ask for a new code") };
    // Every try is counted before the first await, so tries that arrive together cannot share one count.
    const tries = `enrol_tries:${e.window_id}`;
    const rights = `enrol_rights:${e.window_id}`;
    const tried = Number(this.get(tries) ?? "0");
    const wrongSoFar = tried - Number(this.get(rights) ?? "0");
    if (wrongSoFar >= ENROL_ATTEMPTS) return { ok: false, res: error(403, "too many wrong codes; ask for a new code") };
    this.put(tries, String(tried + 1));
    const normal = typeof code === "string" ? normalizeCode(code) : null;
    if (normal === null || !(await sameSecret(await hmacHex(this.opts.relayToken, await sha256Hex(normal)), e.code_mac))) {
      const wrong = Number(this.get(tries) ?? "0") - Number(this.get(rights) ?? "0");
      return { ok: false, res: error(403, "wrong code", { attempts_left: Math.max(0, ENROL_ATTEMPTS - wrong) }) };
    }
    this.put(rights, String(Number(this.get(rights) ?? "0") + 1));
    return { ok: true, e, s };
  }

  private async enrolOptions(req: Request): Promise<Response> {
    const body = await readJson(req, 1024);
    if (body === null) return error(413, "too large");
    if (!isObject(body?.value)) return error(400, "malformed request");
    const c = await this.checkCode(body.value.code);
    if (!c.ok) return c.res;
    return json(200, {
      challenge: c.e.challenge,
      rp: { id: c.e.rp_id, name: "Purser for Northwind Outdoor" },
      user: { id: c.e.user_id, name: c.e.user_name, displayName: c.e.user_name },
      // D20: under MFA only ES256, the one kind the Worker verifies at sign-in (security review, 1 Nov).
      pubKeyCredParams: this.opts.mfa ? [{ type: "public-key", alg: -7 }] : [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 120_000,
      attestation: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      // Empty on purpose: a replacement passkey may be made on the same phone, which then overwrites the old one.
      excludeCredentials: [],
      expires_at: c.e.expires_at,
    });
  }

  private async enrol(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || !isObject(v.credential) || typeof v.credential.id !== "string") return error(400, "malformed submission");
    const c = await this.checkCode(v.code);
    if (!c.ok) return c.res;
    if (this.queued("window_id = ?", c.e.window_id) >= 2) return error(429, "a passkey for this code is already waiting for the runner");
    return json(202, { ticket: this.queue("registration", null, c.e.window_id, body!.text) });
  }
}
