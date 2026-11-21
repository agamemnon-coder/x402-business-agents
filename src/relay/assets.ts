// The files the relay Worker serves, gathered from src/ at deploy time: the dashboard page (the same page the
// local dashboard serves, under the same CSP), the phone's approval and enrolment pages, their stylesheet, the
// phone script with its TypeScript types stripped, and the Inter font. npm run relay:deploy writes them to worker/src/pages.gen.ts.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** What /policy is, for a link preview: the CFO changes an agent's limits there, signed with a passkey. */
const POLICY_DESCRIPTION = "Purser's policy page: the CFO changes an agent's limits there, and every change is signed with a passkey.";
import { recordedRate, type RecordForExposure } from "../policy/exposureSources.js";
import { loadRecord } from "../redesign/run.js";
import { proofData, RECEIPT_SAMPLE_FILE } from "../redesign/agentData.js";
import { T0_READBACK_FILE } from "../accounting/t0Readback.js";
import ts from "typescript";
import { AWX_CALLS_CSP, AWX_CALLS_PAGE, AIRWALLEX_CSP, AIRWALLEX_PAGE, CLAUDE_CSP, CLAUDE_PAGE, HOME_CSP, HOME_PAGE, MOVED, NOT_FOUND_CSP, NOT_FOUND_PAGE, PROOF_CSP, PROOF_PAGE, REDIRECTS, TRACE_CSP, TRACE_PAGE, RUNS_CSP, RUNS_PAGE, AGENT_PAGES, AGENT_CSPS, WATCH_CSP, WATCH_PAGE, FILM_WATCH_CSP, FILM_WATCH_PAGE, CSP as DASHBOARD_CSP, DEMO_CSP, FILM_CSP, FONT, LAB_CSP, LIVE_CSP, LOGOS, FILM_STILLS, DOWNLOADS, METAL_CSP, METAL_PAGE, METAL_REPORT, METAL_REPORT_CSP, MONTH_CSP, VISA_CSP, VISA_PAGE, PAGE as DASHBOARD_PAGE, TRY_CSP, TRY_PAGE, TRY_SIGN_CSP, TRY_SIGN_PAGE, TRY_VERIFY_CSP, TRY_VERIFY_PAGE, VERIFY_BUNDLE_CSP, VERIFY_BUNDLE_PAGE, PROOF_SAMPLE_TEXT, demoPage, homeWithTrySign, filmPage, labPage, livePage, monthPage, BOOKS_CSP, BOOKS_PAGE,  SECURITY_CSP, SECURITY_PAGE, DOCS_CSP, DOCS_PAGE, PRIVACY_CSP, PRIVACY_PAGE, STATUS_CSP, STATUS_PAGE } from "../servers/dashboard.js";
import type { Pages } from "../../worker/src/core.js";
import { trySignOn } from "../try/sign.js";
import { phonePhrases } from "../ui/i18n.js";
import { RECORDED_PATH, readRecorded } from "../try/recorded.js";
import { metalRecordedOf } from "../../worker/src/metalInspector.js";
import { METAL_INSPECTOR_RECORD } from "../redesign/metalMandates.js";
import { appManifestText, offlineCsp, offlinePage, SPLASH, withAppHead } from "../pwa/manifest.js";
import { SHELL, SW_CSP, swSource } from "../pwa/sw.js";
import { APP_START_SCRIPT, appStartPage } from "../pwa/appPage.js";
import { APP_ICON_PNGS } from "../pwa/icons.gen.js";
import { ICON_VERSION } from "../ui/brand/mark.js";
import type { AppFiles } from "../../worker/src/pwa.js";
import { inlinePhonePage } from "../approve/integrity.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * The installed app's start page loads its script and stylesheet from the Worker itself; nothing inline, nothing else.
 * Images from here only, for the favicon: with img-src 'none' Firefox logged a CSP error for the icon it fetches by
 * itself (QA). The approval, enrolment and policy pages have their own CSP of hashes (src/approve/integrity.ts).
 */
const PHONE_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "font-src 'self'", "img-src 'self'",
  // The installed app (src/pwa/): its manifest and its service worker, both from this origin only.
  "manifest-src 'self'", "worker-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

/** The Android app's Digital Asset Links, once the owner made the file from docs/app/assetlinks.template.jsonc (docs/app/android-twa.md). */
const ASSET_LINKS = new URL("../../docs/app/assetlinks.json", import.meta.url);

/**
 * The installed app's files (src/pwa/, docs/app/README.md) and its images. The service worker's version is the hash of
 * the shell it stores (the offline page, the stylesheet, the font, the icons) and of its own code, so any change to
 * them is a new worker, which drops the old cache.
 */
function appFiles(css: string, images: Record<string, { type: string; data: string }>): AppFiles {
  const offline = offlinePage("site");
  const h = createHash("sha256").update(swSource("site", "00000000")).update(offline).update(css).update(FONT);
  for (const path of SHELL.site) {
    const img = images[path.slice("/assets/".length)];
    if (img) h.update(img.data);
  }
  const version = h.digest("hex").slice(0, 16);
  return {
    manifest: appManifestText("site"),
    sw: swSource("site", version), swCsp: SW_CSP,
    offline, offlineCsp: offlineCsp(),
    start: appStartPage(ICON_VERSION), startScript: APP_START_SCRIPT, startCsp: PHONE_CSP,
    ...(existsSync(ASSET_LINKS) ? { assetLinks: readFileSync(ASSET_LINKS, "utf8") } : {}),
  };
}

/** The app's icons (src/pwa/icons.gen.ts) and iPhone launch screens (docs/assets/brand/app/), served at /assets/<name>. */
const APP_IMAGES: Record<string, { type: string; data: string }> = {
  ...Object.fromEntries(Object.entries(APP_ICON_PNGS).map(([name, data]) => [name, { type: "image/png", data }])),
  ...Object.fromEntries(SPLASH.map((s) => [s.name, { type: "image/png", data: readFileSync(new URL(`../../docs/assets/brand/app/${s.name}`, import.meta.url)).toString("base64") }])),
};

/**
 * TRY_SIGN_ENABLED is read here, once, where the bundle is built: on, the bundle carries /try/sign (whose presence
 * turns its API on in the Worker) and the landing's button to it; off, neither, so no page can link to a 404.
 */
/** 1.1: the main run's recorded rate, for /try/sign's worst case (the Worker cannot read the record itself). */
/**
 * Spec 6b: the recorded agents' real outputs, for /try/sign's fallback when a live agent is unavailable (the Worker
 * cannot read the repository itself). Missing or not in its shape: none, and the page falls back to code, labelled.
 */
const TRY_AGENTS_RECORDED = (() => { try { return readRecorded(JSON.parse(read(`../../${RECORDED_PATH}`)) as unknown); } catch { return null; } })();
/** The repository's llms.txt, served at /llms.txt; missing: not served. */
const LLMS = (() => { try { return read("../../llms.txt"); } catch { return undefined; } })();
/** The signed receipt served at /receipt-sample.json (src/redesign/agentData.ts names it), byte for byte. proofData()
 * reads it too, so a missing file fails the build rather than quietly dropping the proof. */
const RECEIPT_SAMPLE = read(`../../${RECEIPT_SAMPLE_FILE}`);
/** T:0's read-back, served at /t0-readback.json byte for byte (src/accounting/t0Readback.ts); /books links it. Missing: not served. */
const T0_READBACK = (() => { try { return read(`../../${T0_READBACK_FILE}`); } catch { return undefined; } })();
const EXPOSURE_RATE = (() => { try { return recordedRate(loadRecord().record as unknown as RecordForExposure); } catch { return null; } })();
/** /metal's mandate inspector: the record's read of 12 November (its answer when it makes no chain call); missing or not in its shape: none. */
export const METAL_RECORDED = (() => { try { return metalRecordedOf(JSON.parse(read(`../../${METAL_INSPECTOR_RECORD}`)) as unknown); } catch { return null; } })();

/**
 * The site's one way through (Home, try it yourself, see the proof; the replay at /watch left the menu on 12 Nov). The
 * header's "Try" tab is the hands-on demo at /try in either bundle (owner, 12 Nov: "The demo must live on the main site
 * under the Try tab"; src/redesign/ui.ts TRY_URL); it no longer leads to /try/sign. Without /try/sign in the bundle, a
 * link to /try/sign leads to /try, so no page links to a 404.
 */
export function flowLinks(html: string, trySign: boolean): string {
  if (!trySign) return html.replace(/href="(\/?)try\/sign"/g, 'href="$1try"');
  return html.replace(/href="try" data-next="try"/g, 'href="try/sign" data-next="try"');
}

/** The phone's script as the relay serves it: TypeScript types stripped, its words (src/ui/i18n.ts, ph.*) in front. */
export function phoneScript(source = read("../approve/client.ts")): string {
  const clientCode = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
    reportDiagnostics: false,
  }).outputText;
  // The phone's payables words ride in front of the script: it has no imports (see client.ts).
  return `globalThis.PURSER_PHRASES = ${JSON.stringify(phonePhrases()).replace(/</g, "\\u003c")};\n${clientCode}`;
}

/**
 * The three phone pages (approval, enrolment, policy), each with the installed app's head tags, its script and
 * stylesheet inline and its build id, and the CSP of their hashes (src/approve/integrity.ts). The approval page integrity
 * record (docs/evidence/approval-page.json) is made from exactly these.
 */
export function phonePages(client = phoneScript(), css = read("../approve/style.css")): Record<"approve" | "enrol" | "policy", { page: string; csp: string; build: string }> {
  return {
    approve: inlinePhonePage(withAppHead(read("../approve/page.html"), "site"), client, css),
    enrol: inlinePhonePage(withAppHead(read("../approve/enrol.html"), "site"), client, css),
    // Jury scan, 14 Nov: a link to /policy previews with its own title and words.
    // Phone pages carry no absolute address (test/relay-assets.test.ts), so no og:image or og:url: the title and words.
    policy: inlinePhonePage(withAppHead(read("../approve/policy.html"), "site").replace("</title>", () => `</title><meta name="description" content="${POLICY_DESCRIPTION}"><meta property="og:type" content="website"><meta property="og:site_name" content="Purser"><meta property="og:title" content="Policy · Purser"><meta property="og:description" content="${POLICY_DESCRIPTION}">`), client, css),
  };
}

export function buildPages(env: NodeJS.ProcessEnv = process.env): Pages {
  const trySign = trySignOn(env);
  const flow = (html: string) => flowLinks(html, trySign);
  const home = trySign ? homeWithTrySign() : { page: HOME_PAGE, csp: HOME_CSP };
  const client = phoneScript();
  const css = read("../approve/style.css");
  const phone = phonePages(client, css);
  // The month-end pack (DOWNLOADS) rides with the images: served the same way, at /assets/<name>, under its own type.
  const images = { ...Object.fromEntries(Object.entries({ ...LOGOS, ...FILM_STILLS, ...DOWNLOADS }).map(([name, l]) => [name, { type: l.type, data: l.body.toString("base64") }])), ...APP_IMAGES };
  return {
    // Every public page carries the same link-preview tags and favicon (jury QA, 6 Nov, Q5): the pages built in
    // src/servers/dashboard.ts carry them already (src/ui/meta.ts withMeta), the redesign's write their own.
    // The installed app's tags (src/pwa/manifest.ts) on the relay's dashboard only: the runner's local page has no manifest.
    dashboard: withAppHead(DASHBOARD_PAGE, "site"),
    exposureRate: EXPOSURE_RATE,
    metalRecorded: METAL_RECORDED,
    ...(LLMS ? { llms: LLMS } : {}),
    // The proof as data for a tool that fetches the site, and one receipt it can verify itself (agent-surface, 12 Nov).
    proofJson: JSON.stringify(proofData(), null, 2),
    receiptSample: RECEIPT_SAMPLE,
    ...(T0_READBACK ? { t0Readback: T0_READBACK } : {}),
    tryAgentsRecorded: TRY_AGENTS_RECORDED,
    month: monthPage(),
    demo: demoPage(),
    live: livePage(),
    film: filmPage(),
    try: flow(TRY_PAGE),
    lab: labPage(),
    metal: flow(METAL_PAGE),
    metalReport: METAL_REPORT ?? "",
    visa: flow(VISA_PAGE),
    airwallex: flow(AIRWALLEX_PAGE),
    awxCalls: flow(AWX_CALLS_PAGE),
    claude: flow(CLAUDE_PAGE),
    security: flow(SECURITY_PAGE),
    docs: flow(DOCS_PAGE),
    privacy: flow(PRIVACY_PAGE),
    status: flow(STATUS_PAGE),
    books: flow(BOOKS_PAGE),
    home: flow(home.page),
    watch: flow(FILM_WATCH_PAGE),
    replay: flow(WATCH_PAGE),
    proof: flow(PROOF_PAGE),
    verify: flow(VERIFY_BUNDLE_PAGE),
    proofSamples: PROOF_SAMPLE_TEXT,
    trace: flow(TRACE_PAGE),
    runs: flow(RUNS_PAGE),
    agents: Object.fromEntries(Object.entries(AGENT_PAGES).map(([id, html]) => [id, { page: flow(html), csp: AGENT_CSPS[id]! }])),
    notFound: flow(NOT_FOUND_PAGE),
    ...(trySign ? { trySign: flow(TRY_SIGN_PAGE), tryVerify: flow(TRY_VERIFY_PAGE) } : {}),
    redirects: REDIRECTS,
    // Without /try/sign in the bundle (the deployed site), its address answers 301 to the hands-on demo at /try, so the
    // README's badge, old screenshots and the film's links never land on a 404 (judge panel, 13 Nov).
    moved: trySign ? MOVED : { ...MOVED, "/try/sign": "/try", "/try/sign/": "/try" },
    // The CFO's own pages are private and reference nothing outside the relay (test/relay-assets.test.ts): no
    // link-preview tags with an absolute image there.
    // Each phone page is one document: its script and stylesheet inline, under a CSP of their hashes, so the served HTML
    // is all that runs and its SHA-256 is published (src/approve/integrity.ts, docs/evidence/approval-page.json).
    approve: phone.approve.page,
    enrol: phone.enrol.page,
    policy: phone.policy.page,
    client,
    css,
    font: FONT.toString("base64"),
    images,
    versions: assetVersions(FONT, images),
    app: appFiles(css, images),
    csp: { dashboard: DASHBOARD_CSP, month: MONTH_CSP, demo: DEMO_CSP, live: LIVE_CSP, film: FILM_CSP, try: TRY_CSP, lab: LAB_CSP, metal: METAL_CSP, metalReport: METAL_REPORT_CSP, visa: VISA_CSP, airwallex: AIRWALLEX_CSP, awxCalls: AWX_CALLS_CSP, claude: CLAUDE_CSP, security: SECURITY_CSP, docs: DOCS_CSP, privacy: PRIVACY_CSP, status: STATUS_CSP, books: BOOKS_CSP, home: home.csp, watch: FILM_WATCH_CSP, replay: WATCH_CSP, proof: PROOF_CSP, verify: VERIFY_BUNDLE_CSP, trace: TRACE_CSP, runs: RUNS_CSP, notFound: NOT_FOUND_CSP, ...(trySign ? { trySign: TRY_SIGN_CSP, tryVerify: TRY_VERIFY_CSP } : {}), approve: phone.approve.csp, enrol: phone.enrol.csp, policy: phone.policy.csp },
  };
}

/**
 * The content version of the font and of each image, by the path the Worker serves it at: the first 12 hex digits of the
 * SHA-256 of its bytes (the same rule as src/ui/assetVersions.ts, whose constants the pages link with). The Worker
 * caches "<path>?v=<version>" for a year (site audit, 19 Nov, finding 6).
 */
export function assetVersions(font: Buffer, images: Record<string, { data: string }>): Record<string, string> {
  const v = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return {
    "/assets/inter.woff2": v(font),
    ...Object.fromEntries(Object.entries(images).map(([name, img]) => [`/assets/${name}`, v(Buffer.from(img.data, "base64"))])),
  };
}

export function pagesModule(pages: Pages): string {
  return `// Generated by npm run relay:deploy from src/ (src/relay/assets.ts). Do not edit; not in git.\nimport type { Pages } from "./core.js";\nexport const PAGES: Pages = ${JSON.stringify(pages)};\n`;
}
