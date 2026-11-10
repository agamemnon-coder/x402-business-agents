// The files the relay Worker serves, gathered from src/ at deploy time: the dashboard page (the same page the
// local dashboard serves, under the same CSP), the phone's approval and enrolment pages, their stylesheet, the
// phone script with its TypeScript types stripped, and the Inter font. npm run relay:deploy writes them to worker/src/pages.gen.ts.

import { readFileSync } from "node:fs";
import { recordedRate, type RecordForExposure } from "../policy/exposureSources.js";
import { loadRecord } from "../redesign/run.js";
import ts from "typescript";
import { AIRWALLEX_CSP, AIRWALLEX_PAGE, CLAUDE_CSP, CLAUDE_PAGE, HOME_CSP, HOME_PAGE, JUDGE_CSP, JUDGE_PAGE, NOT_FOUND_CSP, NOT_FOUND_PAGE, PROOF_CSP, PROOF_PAGE, REDIRECTS, TRACE_CSP, TRACE_PAGE, RUNS_CSP, RUNS_PAGE, AGENT_PAGES, AGENT_CSPS, WATCH_CSP, WATCH_PAGE, CSP as DASHBOARD_CSP, DEMO_CSP, FILM_CSP, FONT, LAB_CSP, LIVE_CSP, LOGOS, DOWNLOADS, METAL_CSP, METAL_PAGE, METAL_REPORT, METAL_REPORT_CSP, MONTH_CSP, VISA_CSP, VISA_PAGE, PAGE as DASHBOARD_PAGE, TRY_CSP, TRY_PAGE, TRY_SIGN_CSP, TRY_SIGN_PAGE, TRY_VERIFY_CSP, TRY_VERIFY_PAGE, demoPage, homeWithTrySign, filmPage, labPage, livePage, monthPage } from "../servers/dashboard.js";
import type { Pages } from "../../worker/src/core.js";
import { trySignOn } from "../try/sign.js";
import { RECORDED_PATH, readRecorded } from "../try/recorded.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * The phone pages load their script and stylesheet from the Worker itself; nothing inline, nothing else. Images from
 * here only, for the favicon: with img-src 'none' Firefox logged a CSP error for the icon it fetches by itself (QA).
 */
const PHONE_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "font-src 'self'", "img-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

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
const EXPOSURE_RATE = (() => { try { return recordedRate(loadRecord().record as unknown as RecordForExposure); } catch { return null; } })();

/**
 * The site's one way through (Max, 7 Nov: watch the agents, try it yourself, see the proof). With /try/sign in the
 * bundle the header's "Try" tab leads there; without it, a link to /try/sign (the next step under /watch) leads to /try,
 * so no page links to a 404.
 */
export function flowLinks(html: string, trySign: boolean): string {
  if (!trySign) return html.replace(/href="(\/?)try\/sign"/g, 'href="$1try"');
  return html.replace(/(<nav class="tabs" aria-label="Main">(?:(?!<\/nav>)[\s\S])*?<a href=")(\/?)try"/, "$1$2try/sign\"").replace(/href="try" data-next="try"/g, 'href="try/sign" data-next="try"');
}

export function buildPages(env: NodeJS.ProcessEnv = process.env): Pages {
  const trySign = trySignOn(env);
  const flow = (html: string) => flowLinks(html, trySign);
  const home = trySign ? homeWithTrySign() : { page: HOME_PAGE, csp: HOME_CSP };
  const client = ts.transpileModule(read("../approve/client.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
    reportDiagnostics: false,
  }).outputText;
  return {
    // Every public page carries the same link-preview tags and favicon (jury QA, 6 Nov, Q5): the pages built in
    // src/servers/dashboard.ts carry them already (src/ui/meta.ts withMeta), the redesign's write their own.
    dashboard: DASHBOARD_PAGE,
    exposureRate: EXPOSURE_RATE,
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
    claude: flow(CLAUDE_PAGE),
    home: flow(home.page),
    watch: flow(WATCH_PAGE),
    proof: flow(PROOF_PAGE),
    trace: flow(TRACE_PAGE),
    runs: flow(RUNS_PAGE),
    agents: Object.fromEntries(Object.entries(AGENT_PAGES).map(([id, html]) => [id, { page: flow(html), csp: AGENT_CSPS[id]! }])),
    notFound: flow(NOT_FOUND_PAGE),
    ...(trySign ? { trySign: flow(TRY_SIGN_PAGE), tryVerify: flow(TRY_VERIFY_PAGE), judge: flow(JUDGE_PAGE) } : {}),
    redirects: REDIRECTS,
    // The CFO's own pages are private and reference nothing outside the relay (test/relay-assets.test.ts): no
    // link-preview tags with an absolute image there.
    approve: read("../approve/page.html"),
    enrol: read("../approve/enrol.html"),
    policy: read("../approve/policy.html"),
    client,
    css: read("../approve/style.css"),
    font: FONT.toString("base64"),
    // The month-end pack (DOWNLOADS) rides with the images: served the same way, at /assets/<name>, under its own type.
    images: Object.fromEntries(Object.entries({ ...LOGOS, ...DOWNLOADS }).map(([name, l]) => [name, { type: l.type, data: l.body.toString("base64") }])),
    csp: { dashboard: DASHBOARD_CSP, month: MONTH_CSP, demo: DEMO_CSP, live: LIVE_CSP, film: FILM_CSP, try: TRY_CSP, lab: LAB_CSP, metal: METAL_CSP, metalReport: METAL_REPORT_CSP, visa: VISA_CSP, airwallex: AIRWALLEX_CSP, claude: CLAUDE_CSP, home: home.csp, watch: WATCH_CSP, proof: PROOF_CSP, trace: TRACE_CSP, runs: RUNS_CSP, notFound: NOT_FOUND_CSP, ...(trySign ? { trySign: TRY_SIGN_CSP, tryVerify: TRY_VERIFY_CSP, judge: JUDGE_CSP } : {}), approve: PHONE_CSP, enrol: PHONE_CSP, policy: PHONE_CSP },
  };
}

export function pagesModule(pages: Pages): string {
  return `// Generated by npm run relay:deploy from src/ (src/relay/assets.ts). Do not edit; not in git.\nimport type { Pages } from "./core.js";\nexport const PAGES: Pages = ${JSON.stringify(pages)};\n`;
}
