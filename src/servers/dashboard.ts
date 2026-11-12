// The live dashboard: one static page that polls GET api/snapshot. It reads the ledger and nothing else,
// so it holds no key and cannot approve or move money. "Review: approve or reject" hands over to the approval page.
// The page uses relative URLs only, so the same file can later be served by another host unchanged.

import { withMeta } from "../ui/meta.js";
import { airwallexPage, claudePage, metalPage, notFoundPage, t0Page, visaPage } from "../redesign/partners.js";
import { inspectorRecord } from "../redesign/metalMandates.js";
import { METAL_INSPECTOR_PATH, localInspector } from "../../worker/src/metalInspector.js";
import { WORLD_CHANGES } from "../try/world.js";
import { localTryAnswer } from "../try/local.js";
import { buildFilm } from "../film/film.js";
import { filmTimeline } from "../film/script.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "../db/open.js";
import { buildSnapshot } from "../dashboard/snapshot.js";
import { systemHealth, systemHealthPage, SYSTEM_HEALTH_CSP } from "../dashboard/health.js";
import { agentTraces } from "../dashboard/trace.js";
import { simulateMonth, type MonthReport } from "../sim/month.js";
import { runAll, runScenario, SCENARIOS, type ScenarioResult } from "../lab/scenarios.js";
import type { Story } from "../demo/story.js";
import type { Recorded } from "../demo/recorded.js";
import { ICONS } from "../ui/icons.js";
import { AGENT_DISPLAY, CFO_VIEW_LINE, CORE_SENTENCE, SECOND_APPROVER, WORLD_SETUP } from "../config/brand.js";
import { EXPOSURE_HOW, exposureOf, exposureWords } from "../policy/exposure.js";
import { exposurePolicyFromRecord, recordedRate, type RecordForExposure } from "../policy/exposureSources.js";
import { loadRecord, replayRecord, runLabel } from "../redesign/run.js";
import { homePage } from "../redesign/home.js";
import { trySignPage } from "../try/sign.js";
import { tryVerifyPage } from "../try/verify.js";
import { watchPage } from "../redesign/watch.js";
import { filmWatchCsp, filmWatchPage } from "../redesign/filmWatch.js";
import { filmId } from "../config/film.js";
import { filmStills } from "../film/stills.js";
import { proofPage } from "../redesign/proof.js";
import { judgePage } from "../redesign/judge.js";
import { loadTrace, TRACE_LINK, tracePage } from "../redesign/trace.js";
import { runsPage } from "../redesign/runs.js";
import { pricingPage } from "../redesign/pricing.js";
import { securityPage } from "../redesign/security.js";
import { docsPage } from "../redesign/docs.js";
import { statusPage } from "../redesign/status.js";
import { agentPages } from "../redesign/agents.js";
import { monthEndPack, PACK_LINK, PACK_NAME } from "../accounting/monthPack.js";
import { restyle } from "../redesign/ui.js";
import { withNav } from "../ui/nav.js";
import { buildLiveTimeline } from "../live/timeline.js";
import { health, prometheus } from "../ops/health.js";
import type { DisputeCase } from "../seller/desk.js";
import { disputeReportHtml } from "../seller/report.js";

/** What each agent is called on the pages (docs/decisions.md D2), as a data block: no markup, not part of any hash. */
const AGENTS_JSON = JSON.stringify(Object.fromEntries(Object.entries(AGENT_DISPLAY).map(([id, a]) => [id, a.name])));

/** The red team's latest summary (npm run redteam writes docs/redteam/report.json); "null" before the first run. */
const REDTEAM_FILE = new URL("../../docs/redteam/report.json", import.meta.url);
const REDTEAM_JSON = (() => {
  try {
    const r = JSON.parse(readFileSync(REDTEAM_FILE, "utf8")) as { ran_at: string; attempts: number; blocked: number; inconclusive?: number; caught_after?: number; model: string | null; results: { id: string }[] };
    const documents = r.results.filter((x) => x.id === "document").length;
    return JSON.stringify({ ran_at: r.ran_at, attempts: r.attempts, blocked: r.blocked, inconclusive: r.inconclusive ?? 0, caught_after: r.caught_after ?? 0, model: r.model, documents }).replace(/</g, "\\u003c");
  } catch {
    return "null";
  }
})();

const PAGE_TEMPLATE = withNav(readFileSync(new URL("../dashboard/page.html", import.meta.url), "utf8"), "overview");
const RECORDED_FILE = new URL("../../docs/demo/snapshot.json", import.meta.url);
// The agent run (the main run, 3 Nov; src/redesign/run.ts), recorded with npm run autonomy-record, for /?autonomy, with
// its label, the world set-up and who the second approver was. Replayed with its figures counted as Home, Watch and
// Proof count them, and its lines worded as they word them (replayRecord; final review, 4 Nov).
const AUTONOMY_JSON = (() => {
  try {
    const { record, standIn } = loadRecord();
    return JSON.stringify({ ...replayRecord(record), label: runLabel(record), about: standIn ? "" : `${WORLD_SETUP} ${SECOND_APPROVER}` });
  } catch { return "null"; }
})();
/** Inter (OFL, src/ui/inter-LICENSE.txt), served as /assets/inter.woff2 by every host of the pages. */
export const FONT = readFileSync(new URL("../ui/inter.woff2", import.meta.url));
/**
 * Files to download, served as /assets/<name> beside the images: the main run's month-end pack (Max's last round, 1.3),
 * built here from the record and its companion (src/accounting/monthPack.ts), the same bytes on every build.
 */
export const DOWNLOADS: Record<string, { type: string; body: Buffer }> = (() => {
  const pack = monthEndPack(loadRecord().record, loadTrace());
  return { [pack.name]: { type: "application/zip", body: pack.zip } };
})();
/** The sponsors' official logos (src/ui/logos/README.md), served as /assets/<name> for the landing's "Built on". */
export const LOGOS: Record<string, { type: string; body: Buffer }> = {
  "logo-airwallex.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/airwallex.png", import.meta.url)) },
  "logo-metal.svg": { type: "image/svg+xml", body: readFileSync(new URL("../ui/logos/metal.svg", import.meta.url)) },
  "logo-claude.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/claude.png", import.meta.url)) },
  // Added 12 Nov on the owner's stated permission (docs/evidence/logo-permissions.md); sources in src/ui/logos/README.md.
  "logo-visa.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/visa.png", import.meta.url)) },
  "logo-cloudflare.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/cloudflare.png", import.meta.url)) },
  // Purser's own mark and its link preview (src/ui/brand/), for every public page's favicon and Open Graph image.
  "favicon.svg": { type: "image/svg+xml", body: readFileSync(new URL("../ui/brand/favicon.svg", import.meta.url)) },
  "og.png": { type: "image/png", body: readFileSync(new URL("../ui/brand/og.png", import.meta.url)) },
};
/** /watch's stills (src/film/stills/: the poster and the chapter thumbnails, real frames of the film's shots), as /assets/film-<name>. */
export const FILM_STILLS = filmStills();
const MONTH_TEMPLATE = withNav(readFileSync(new URL("../dashboard/month.html", import.meta.url), "utf8"), "month");
const DEMO_TEMPLATE = withNav(readFileSync(new URL("../demo/demo.html", import.meta.url), "utf8"), "demo");
const LAB_TEMPLATE = withNav(readFileSync(new URL("../dashboard/lab.html", import.meta.url), "utf8"), "lab");
const LAB_FILE = new URL("../../docs/lab/results.json", import.meta.url);
const STORY_FILE = new URL("../../docs/demo/story.json", import.meta.url);

/** The hash of a page's one inline script or style (a data block, <script type=…>, is not a script and not hashed). */
const inlineHash = (page: string, tag: "script" | "style") => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(page);
  if (!m) throw new Error(`the page has no inline ${tag}`);
  return `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`;
};
const cspFor = (page: string) => [
  "default-src 'none'", `script-src ${inlineHash(page, "script")}`, `style-src ${inlineHash(page, "style")}`, "connect-src 'self'",
  "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

/** "30 October": a recording's day, in words (UTC), the same on every device. */
const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
/**
 * /?recorded's label line: which run it is (final review, 4 Nov: it read "Recorded run · Oct 30, 2026", which a juror
 * could take for the main run of 3 November).
 */
export const recordedLabel = (recorded: Pick<Recorded, "recorded_at">) => `Recorded run · the ${dayLong(recorded.recorded_at)} run, an earlier recording · test money · nothing here is live`;
/**
 * The dashboard page: the icon set goes into its script (so before the CSP hash), and the recorded run a guest sees
 * (docs/demo/snapshot.json unless one is given) into its data block with its label line, "<" escaped.
 */
export function dashboardPage(recorded: Recorded = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as Recorded): string {
  return PAGE_TEMPLATE
    .replace("__ICONS_JSON__", () => JSON.stringify(ICONS))
    .replace("__RECORDED_JSON__", () => JSON.stringify({ ...recorded, label: recordedLabel(recorded) }).replace(/</g, "\\u003c"))
    .replace("__AUTONOMY_JSON__", () => AUTONOMY_JSON.replace(/</g, "\\u003c"))
    .replace("__AGENTS_JSON__", AGENTS_JSON)
    .replace("__REDTEAM_JSON__", () => REDTEAM_JSON)
    // The Overview's line: the core sentence, word for word (who holds which limit; never "every limit").
    .replace("__CORE_SENTENCE__", () => CORE_SENTENCE.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    // The CFO's view (/?autonomy) opens with this line (Max's last round, item 4); the page shows it on that view only.
    .replace("__CFO_VIEW_LINE__", () => CFO_VIEW_LINE.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    // Under it, on that view only: "Trace any payment" (Max's last round, 1.2), to /trace.
    .replace("__TRACE_LINK__", () => TRACE_LINK)
    // And the month-end pack (1.3): one download, built from the record (DOWNLOADS).
    .replace("__PACK_NAME__", () => PACK_NAME).replace("__PACK_LINK__", () => PACK_LINK)
    // 1.1: under that line, the worst case the main run's policy allows (src/policy/exposure.ts), one block.
    .replace("__CFO_EXPOSURE__", () => CFO_EXPOSURE);
}
/** The CFO's view's worst case: from the policy the main run ended with and the one rate it recorded (none: no block). */
const CFO_EXPOSURE = (() => {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  try {
    const { record } = loadRecord();
    const r = record as unknown as RecordForExposure;
    const p = exposurePolicyFromRecord(r);
    const w = exposureWords(exposureOf(p), p, recordedRate(r));
    return `<p class="hl">${esc(w.headline)}</p><p>${esc(w.tasks)}</p><p>${esc(w.above)}</p><details class="how"><summary>${esc(EXPOSURE_HOW)}</summary><ul>${w.how.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>`;
  } catch { return ""; }
})();
/**
 * Words the public pages no longer use (Max, v4): older records and Lab results still carry them in their text, so the
 * pages that show those records say them in today's words. Display only; the records stay as they were written.
 */
const PUBLIC_WORDS: [RegExp, string][] = [
  [/warehouse software/g, "warehouse data"], [/\bare stand-ins\b/g, "are simulated"], [/\bis a stand-in\b/g, "is simulated"],
  [/\ba stand-in passkey\b/g, "a test passkey"], [/\bstand-ins\b/g, "simulations"], [/\bstand-in\b/g, "simulated"],
];
export const publicWords = (text: string) => PUBLIC_WORDS.reduce((t, [re, to]) => t.replace(re, to), text);
// Every page carries the same link-preview tags and favicon (jury QA, 6 Nov, Q5; src/ui/meta.ts): tags only, so no CSP
// hash below changes. The local server, npm run judge and the relay serve the same pages.
export const PAGE = withMeta(publicWords(dashboardPage()), { description: "The CFO's dashboard: each agent's card and mandate, what it paid and what was stopped, the books and the audit log." });
// Only the page's own script and style may run; data arrives over fetch from this origin only.
export const CSP = cspFor(PAGE);
/** The month replay carries its data inside the page, so it needs no request at all once loaded. */
export const MONTH_CSP = cspFor(MONTH_TEMPLATE);

/** The Scenario Lab (E) carries its results inside the page, like the month replay. */
export const LAB_CSP = cspFor(LAB_TEMPLATE);
export interface LabData { mode: "live" | "recorded"; at: string; results: ScenarioResult[] }
/** The Lab page: results run now (on the runner) or the ones recorded by npm run lab (docs/lab/results.json). */
export function labPage(data: LabData = { mode: "recorded", ...(JSON.parse(readFileSync(LAB_FILE, "utf8")) as Omit<LabData, "mode">) }): string {
  return withMeta(LAB_TEMPLATE.replace("__LAB_JSON__", () => publicWords(JSON.stringify(data)).replace(/</g, "\\u003c")), { description: "The Scenario Lab: stories run against Purser's rules on stand-ins, each with its expected outcome." });
}

/** "Purser live": the animated day, its timeline inside the page (src/live/timeline.ts), built from the recordings. */
const LIVE_TEMPLATE = withNav(readFileSync(new URL("../live/live.html", import.meta.url), "utf8"), "live");
export const LIVE_CSP = cspFor(LIVE_TEMPLATE);
export function livePage(story: Story = JSON.parse(readFileSync(STORY_FILE, "utf8")) as Story, recorded: Recorded = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as Recorded): string {
  return withMeta(LIVE_TEMPLATE.replace("__LIVE_JSON__", () => JSON.stringify(buildLiveTimeline(story, recorded)).replace(/</g, "\\u003c")));
}

const FILM_TEMPLATE = readFileSync(new URL("../film/film.html", import.meta.url), "utf8");
export const FILM_CSP = cspFor(FILM_TEMPLATE);
/** The film (src/film/): its facts from the recordings and the latest red team and Lab reports, its scenes timed. */
export function filmPage(story: Story = JSON.parse(readFileSync(STORY_FILE, "utf8")) as Story, recorded: Recorded = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as Recorded): string {
  const redteam = JSON.parse(readFileSync(REDTEAM_FILE, "utf8")) as { attempts: number; blocked: number };
  const lab = JSON.parse(readFileSync(LAB_FILE, "utf8")) as { results: { passed: boolean }[] };
  const data = buildFilm(story, recorded, { redteam, lab: { total: lab.results.length, passed: lab.results.filter((r) => r.passed).length } });
  return withMeta(FILM_TEMPLATE.replace("__FILM_JSON__", () => JSON.stringify({ data, scenes: filmTimeline() }).replace(/</g, "\\u003c")), { description: "The earlier animation of 30 October. The film of the main run (3:58) is on YouTube: https://youtu.be/kCUsFHrxE-o" });
}

/**
 * What each copy of Try says about who reads a request (final review, 4 Nov): the hosted page asks Claude; the offline
 * copy (npm run judge, the local server) asks no model and says so in its own words. Each copy carries only its own
 * words, so the hosted page never says "offline copy" (it did, in spans only a stylesheet hid).
 */
const TRY_WORDS: Record<string, Record<"hosted" | "offline", string>> = {
  __TRY_MODELS__: { hosted: "The models are real: Claude Haiku sorts your request and Claude Sonnet reads it, and you see what each call cost.", offline: "In this offline copy no model is asked: code alone reads your request. The hosted page asks Claude Haiku to sort it and Claude Sonnet to read it, and shows what each call cost." },
  __TRY_FAIR_WHERE__: { hosted: "", offline: " on the hosted page" },
  __TRY_LEAD__: { hosted: "A separate demo world: Claude reads your task, and code applies the CFO's limits. No money moves.", offline: "A separate demo world: in this offline copy code reads your task (the hosted page asks Claude), and code applies the CFO's limits. No money moves." },
  __TRY_IDLE__: { hosted: "Pick an example or type your own: Claude Haiku sorts it and Claude Sonnet reads it. Northwind's limits apply either way.", offline: "Pick an example or type your own: in this offline copy, code alone reads it. Northwind's limits apply either way." },
  // Offline, neutral: the recorded example (a real Claude call, labelled) fills this node's line when the page opens.
  __TRY_NODE__: { hosted: "Purser: Claude reads, the rails enforce", offline: "Purser reads, the rails enforce" },
  __TRY_NODE_SUB__: { hosted: "Haiku sorts · Sonnet reads · the CFO policy decides", offline: "No model in this offline copy · the CFO policy decides" },
  __TRY_WORLD_LEAD__: { hosted: "Change the market; the Sourcing agent decides with Claude Haiku, inside its limits.", offline: "Change the market; the Sourcing agent decides inside its limits (with Claude Haiku on the hosted page)." },
  __TRY_WORLD_IDLE__: { hosted: "Pick a change: the Sourcing agent decides with Claude Haiku.", offline: "Pick a change: in this offline copy no model is asked, so the Sourcing agent's fallback in code answers, labelled as such." },
};
/** Try Purser (src/try/): the page; its requests go to POST /api/try. */
// It carries the recorded run's rails and AI tricks, so each answer can show the same flow as it ran live, and names
// that run by its day.
function tryPage(mode: "hosted" | "offline"): string {
  const rec = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as { recorded_at: string; snapshot?: { rails?: unknown }; proof?: { ai_tricks?: number } };
  // The example shown before a visitor runs a try: one real Claude call, recorded once and labelled (src/try/example.json).
  const example = JSON.parse(readFileSync(new URL("../try/example.json", import.meta.url), "utf8")) as unknown;
  const data = { rails: rec.snapshot?.rails ?? null, ai_tricks: rec.proof?.ai_tricks ?? null, worlds: WORLD_CHANGES.map(({ id, label, detail }) => ({ id, label, detail })), example,
    // The offline copy's own words for what its script writes; none on the hosted page.
    offline: mode === "offline" ? { thinking: "Code checks the words and reads the request…", example: ". Press Run it to try it here: in this offline copy code alone reads it." } : false };
  const text = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = restyle(withNav(readFileSync(new URL("../try/try.html", import.meta.url), "utf8"), "try"));
  for (const [key, words] of Object.entries(TRY_WORDS)) html = html.replace(key, () => text(words[mode]));
  return withMeta(html.replace("__TRY_PROOF_RUN__", () => text(`the run recorded on ${dayLong(rec.recorded_at)}`)).replace("__TRY_JSON__", () => JSON.stringify(data).replace(/</g, "\\u003c")), { description: "Give an agent a task of yours: Claude reads it, code applies the CFO's limits, no money moves." });
}
/** The hosted page (the relay): Claude reads each request. */
export const TRY_PAGE = tryPage("hosted");
/** The offline copy (npm run judge, the local dashboard server): no model is asked, and the page says so. */
export const TRY_PAGE_OFFLINE = tryPage("offline");
// Both copies carry the same script and style, so one CSP answers for both.
export const TRY_CSP = cspFor(TRY_PAGE);

/** The recorded Dispute desk case of 30 October (docs/demo/metal.json), for its evidence report in the Archive. */
const METAL_FILE = new URL("../../docs/demo/metal.json", import.meta.url);
const metalData = () => JSON.parse(readFileSync(METAL_FILE, "utf8")) as { dispute: DisputeCase | null };
// The partner pages (src/redesign/partners.ts): short, picture first, the details folded; no script (but /airwallex's one,
// below), so a style-only policy.
const styleOnlyCsp = (page: string) => ["default-src 'none'", `style-src ${inlineHash(page, "style")}`, "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
export const METAL_PAGE = metalPage();
/** /metal's inspector on a local server (this dashboard, the judge's): the record's read of 12 November, no chain call. */
const METAL_DESK = localInspector(inspectorRecord().recorded);
export async function sendInspector(res: Response): Promise<void> {
  const r = await METAL_DESK.fetch(new globalThis.Request(`http://localhost${METAL_INSPECTOR_PATH}`));
  res.status(r.status);
  r.headers.forEach((v, k) => { res.setHeader(k, v); });
  res.send(await r.text());
}
// /metal has one script (jury panel, 12 Nov): it asks this origin's read-only inspector (GET /api/metal/mandates) for
// the mandates' spend; so its hash and connect-src 'self', nothing else.
export const METAL_CSP = cspFor(METAL_PAGE);
export const VISA_PAGE = visaPage();
export const VISA_CSP = styleOnlyCsp(VISA_PAGE);
export const AIRWALLEX_PAGE = airwallexPage();
export const CLAUDE_PAGE = claudePage();
// /airwallex has one inline script (OPEN_TARGET_JS: a link into its cards' fold opens it), hashed like its style; it
// connects nowhere, so no connect-src.
const styleAndScriptCsp = (page: string) => ["default-src 'none'", `script-src ${inlineHash(page, "script")}`, `style-src ${inlineHash(page, "style")}`, "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
export const AIRWALLEX_CSP = AIRWALLEX_PAGE.includes("<script>") ? styleAndScriptCsp(AIRWALLEX_PAGE) : styleOnlyCsp(AIRWALLEX_PAGE);
export const CLAUDE_CSP = styleOnlyCsp(CLAUDE_PAGE);
/** /pricing and /security (12 Nov), the product pages under "More" (src/ui/more.ts): no script, so a style-only policy. */
export const PRICING_PAGE = pricingPage();
export const PRICING_CSP = styleOnlyCsp(PRICING_PAGE);
export const SECURITY_PAGE = securityPage();
export const SECURITY_CSP = styleOnlyCsp(SECURITY_PAGE);
/** /docs, "Docs and API" (12 Nov), under "More" too (src/redesign/docs.ts): no script, so a style-only policy. */
export const DOCS_PAGE = docsPage();
export const DOCS_CSP = styleOnlyCsp(DOCS_PAGE);
/**
 * /status (12 Nov), under "More" too (src/redesign/status.ts). Its one small script reads the site's own /health, so its
 * policy names that script and the style by hash and allows requests to the site itself only (connect-src 'self').
 * The offline copy (`npm run judge`, which has no /health) carries no script: a style-only policy.
 */
export const STATUS_PAGE = statusPage();
export const STATUS_CSP = cspFor(STATUS_PAGE);
export const STATUS_PAGE_OFFLINE = statusPage("offline");
export const STATUS_OFFLINE_CSP = styleOnlyCsp(STATUS_PAGE_OFFLINE);
/** /t0 (owner, 12 Nov): Purser's books in T:0's ledger, from the T:0 run records; no script, so a style-only policy. */
export const T0_PAGE = t0Page();
export const T0_CSP = styleOnlyCsp(T0_PAGE);
/** /trace: any payment of the main run, step by step (src/redesign/trace.ts); no script, so a style-only policy. */
export const TRACE_PAGE = tracePage();
export const TRACE_CSP = styleOnlyCsp(TRACE_PAGE);
/** /runs: every live run, newest first (src/redesign/runs.ts); one inline script (copy an id), its own hash only, no connect. */
export const RUNS_PAGE = runsPage();
export const RUNS_CSP = styleAndScriptCsp(RUNS_PAGE);
/** /agents/<id>: one page per Kit 11 agent from the main run (src/redesign/agents.ts); no script. */
export const AGENT_PAGES: Record<string, string> = agentPages();
export const AGENT_CSPS: Record<string, string> = Object.fromEntries(Object.entries(AGENT_PAGES).map(([id, html]) => [id, styleOnlyCsp(html)]));
/** The clean 404, for any address that is not a page; its links and assets absolute, since it answers at any depth. */
export const NOT_FOUND_PAGE = notFoundPage().replace(/(href|src)="(?!https?:|#|\/)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
export const NOT_FOUND_CSP = styleOnlyCsp(NOT_FOUND_PAGE);
/** The public pages of the redesign (src/redesign/): Home, Watch and Proof, from the recorded agent run. */
export const HOME_PAGE = homePage();
export const WATCH_PAGE = watchPage();
export const PROOF_PAGE = proofPage();
/** Home's hero checks a signature in the browser and Home calls no server: its CSP allows no connection at all. */
const homeCsp = (html: string) => cspFor(html).replace("connect-src 'self'", "connect-src 'none'");
export const HOME_CSP = homeCsp(HOME_PAGE);
/** /try/sign (TRY_SIGN_ENABLED): the page, under the same kind of hash-based CSP; the bundle carries it only when on. */
export const TRY_SIGN_PAGE = trySignPage();
export const TRY_SIGN_CSP = cspFor(TRY_SIGN_PAGE);
/** /try/verify checks a receipt in the browser and calls no server: its CSP allows no connection at all. */
export const TRY_VERIFY_PAGE = tryVerifyPage();
export const TRY_VERIFY_CSP = cspFor(TRY_VERIFY_PAGE).replace("connect-src 'self'", "connect-src 'none'");
/** /judge (with /try/sign only: three of its five steps go there): ticks kept in the browser, no fetch, so no connection. */
export const JUDGE_PAGE = judgePage();
export const JUDGE_CSP = cspFor(JUDGE_PAGE).replace("connect-src 'self'", "connect-src 'none'");
/** Home with its "Sign with your own Face ID" button: only in a bundle that also carries /try/sign. */
export function homeWithTrySign(): { page: string; csp: string } {
  const page = homePage(undefined, { trySign: true });
  return { page, csp: homeCsp(page) };
}
export const WATCH_CSP = cspFor(WATCH_PAGE);
/**
 * /watch: the film (src/redesign/filmWatch.ts). No script and no frame while there is no film; with its id set
 * (src/config/film.ts), its few lines of script and youtube-nocookie.com's player only. The replay of the main run
 * (WATCH_PAGE above) moved to /replay.
 */
export const FILM_WATCH_PAGE = filmWatchPage();
export const FILM_WATCH_CSP = filmWatchCsp(FILM_WATCH_PAGE, filmId() !== null, cspFor, styleOnlyCsp);
export const PROOF_CSP = cspFor(PROOF_PAGE);
/** Old addresses of pages folded into the four tabs: they redirect, so no link a juror has ends in a 404. */
export const REDIRECTS: Record<string, string> = { "/live": "/replay", "/demo": "/replay", "/overview": "/home" };
/** The label on the public evidence report: the customer in the 30 October case is simulated. */
export const SIMULATED_CUSTOMER = "Summit Outfitters is a simulated customer run by us; we filed this claim on its behalf (30 October recorded run).";
/** The evidence report the seller sends for the recorded case: no script at all, only its own style. */
export const METAL_REPORT = (() => {
  const c = metalData().dispute;
  // On the public page the report says who the customer is: simulated, its claim filed by us (the report a customer
  // receives is built by disputeReportHtml alone).
  // Its CSP allows Purser's own icon (img-src 'self'): with none, Firefox fetched /favicon.ico by itself and logged a
  // CSP error (QA). withMeta adds the tags and the favicon link.
  return c ? withMeta(disputeReportHtml(c).replace(/(<\/h1>)/, `$1\n<p><strong>${SIMULATED_CUSTOMER}</strong></p>`)) : null;
})();
export const METAL_REPORT_CSP = METAL_REPORT ? [
  "default-src 'none'", `style-src ${inlineHash(METAL_REPORT, "style")}`, "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ") : "";

/** The public demo page (K5 replay) plays a recorded run; no request, no key, nothing live. */
export const DEMO_CSP = cspFor(DEMO_TEMPLATE);

/** The demo page with the recorded story in it (docs/demo/story.json unless one is given), "<" escaped. */
export function demoPage(story: Story = JSON.parse(readFileSync(STORY_FILE, "utf8")) as Story): string {
  return withMeta(DEMO_TEMPLATE.replace("__STORY_JSON__", () => JSON.stringify(story).replace(/</g, "\\u003c")));
}

/** The month replay page with the simulated month in it (JSON, with "<" escaped so it cannot close the block). */
export function monthPage(report: MonthReport = simulateMonth()): string {
  return withMeta(MONTH_TEMPLATE.replace("__MONTH_JSON__", () => JSON.stringify(report).replace(/</g, "\\u003c")).replace("__AGENTS_JSON__", AGENTS_JSON), { description: "A month of Northwind Outdoor's agents in 90 seconds, simulated: what they paid inside their limits and what the CFO signed." });
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface DashboardOptions {
  /** Where "Review: approve or reject" goes: the approval page that records decisions. */
  approvalsUrl: string;
  now?: () => Date;
}

export function dashboardApp(db: DB, opts: DashboardOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");

  // The ledger shows payments and addresses: answer loopback hosts only (DNS rebinding).
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) {
      res.status(403).type("text/plain").send("forbidden host");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/", (_req, res) => {
    res.setHeader("Content-Security-Policy", CSP);
    // Here the snapshot needs no viewer key (loopback only).
    res.type("html").send(PAGE.replace('<body data-mode="relay">', '<body data-mode="local">'));
  });

  app.get("/assets/inter.woff2", (_req, res) => {
    res.type("font/woff2").send(FONT);
  });
  app.get("/assets/:name", (req, res, next) => {
    const logo = LOGOS[String(req.params.name)] ?? DOWNLOADS[String(req.params.name)];
    if (!logo) return next();
    res.type(logo.type).send(logo.body);
  });

  app.get("/demo", (_req, res) => {
    res.setHeader("Content-Security-Policy", DEMO_CSP);
    res.type("html").send(demoPage());
  });

  app.get("/try", (_req, res) => {
    res.setHeader("Content-Security-Policy", TRY_CSP);
    res.type("html").send(TRY_PAGE_OFFLINE);
  });
  // Locally Try Purser reads with code alone: no model is asked from this server (the relay asks Claude, with limits).
  app.post("/api/try", express.json({ limit: "2kb" }), async (req, res) => {
    const a = await localTryAnswer(req.body, "this local server asks no model; the hosted page does");
    res.status(a.status).json(a.json);
  });

  app.get("/metal", (_req, res) => {
    res.setHeader("Content-Security-Policy", METAL_CSP);
    res.type("html").send(METAL_PAGE);
  });
  // /metal's inspector, as a local copy answers it: the record's read of 12 November, no chain call.
  app.get(METAL_INSPECTOR_PATH, (_req, res) => { void sendInspector(res); });
  app.get("/visa", (_req, res) => {
    res.setHeader("Content-Security-Policy", VISA_CSP);
    res.type("html").send(VISA_PAGE);
  });
  app.get("/airwallex", (_req, res) => {
    res.setHeader("Content-Security-Policy", AIRWALLEX_CSP);
    res.type("html").send(AIRWALLEX_PAGE);
  });
  app.get("/trace", (_req, res) => {
    res.setHeader("Content-Security-Policy", TRACE_CSP);
    res.type("html").send(TRACE_PAGE);
  });
  app.get("/runs", (_req, res) => {
    res.setHeader("Content-Security-Policy", RUNS_CSP);
    res.type("html").send(RUNS_PAGE);
  });
  app.get("/agents/:id", (req, res, next) => {
    const id = req.params.id;
    if (!Object.hasOwn(AGENT_PAGES, id)) return next();
    res.setHeader("Content-Security-Policy", AGENT_CSPS[id]!);
    res.type("html").send(AGENT_PAGES[id]);
  });
  app.get("/claude", (_req, res) => {
    res.setHeader("Content-Security-Policy", CLAUDE_CSP);
    res.type("html").send(CLAUDE_PAGE);
  });
  app.get("/pricing", (_req, res) => {
    res.setHeader("Content-Security-Policy", PRICING_CSP);
    res.type("html").send(PRICING_PAGE);
  });
  app.get("/security", (_req, res) => {
    res.setHeader("Content-Security-Policy", SECURITY_CSP);
    res.type("html").send(SECURITY_PAGE);
  });
  app.get("/docs", (_req, res) => {
    res.setHeader("Content-Security-Policy", DOCS_CSP);
    res.type("html").send(DOCS_PAGE);
  });
  // /status as the relay serves it. This server's own /health (below) has the runner's shape, not the relay's, so here
  // the page says the status could not be read and links to /health: it never reads another shape as good.
  app.get("/status", (_req, res) => {
    res.setHeader("Content-Security-Policy", STATUS_CSP);
    res.type("html").send(STATUS_PAGE);
  });
  app.get("/t0", (_req, res) => {
    res.setHeader("Content-Security-Policy", T0_CSP);
    res.type("html").send(T0_PAGE);
  });
  app.get("/metal/report", (_req, res, next) => {
    if (!METAL_REPORT) return next();
    res.setHeader("Content-Security-Policy", METAL_REPORT_CSP);
    res.type("html").send(METAL_REPORT);
  });

  app.get("/film", (_req, res) => {
    res.setHeader("Content-Security-Policy", FILM_CSP);
    res.type("html").send(filmPage());
  });

  app.get("/live", (_req, res) => {
    res.setHeader("Content-Security-Policy", LIVE_CSP);
    res.type("html").send(livePage());
  });

  app.get("/month", (_req, res) => {
    res.setHeader("Content-Security-Policy", MONTH_CSP);
    res.type("html").send(monthPage());
  });

  // The Scenario Lab, run on click: each scenario in a fresh throwaway world (no money, nothing outside), so a run
  // is also the reset. ?run=<id> runs one, ?run=all or nothing runs them all.
  app.get("/lab", async (req, res) => {
    const id = String(req.query.run ?? "all");
    const one = SCENARIOS.find((s) => s.id === id);
    const results = one ? [await runScenario(one)] : await runAll();
    res.setHeader("Content-Security-Policy", LAB_CSP);
    res.type("html").send(labPage({ mode: "live", at: new Date().toISOString(), results }));
  });

  app.get("/api/snapshot", (_req, res) => {
    res.json(buildSnapshot(db, opts.now?.() ?? new Date()));
  });

  // Monitoring (B7): the alarms and numbers, as JSON (503 while an alarm stands) and as Prometheus metrics.
  app.get("/health", (_req, res) => {
    const h = health(db, opts.now?.() ?? new Date());
    res.status(h.status === "ok" ? 200 : 503).set("cache-control", "no-store").json(h);
  });
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").set("cache-control", "no-store").send(prometheus(health(db, opts.now?.() ?? new Date())));
  });

  // System health (src/dashboard/health.ts): runs, agents, SLOs and a trace per run, read from the ledger; loopback only.
  app.get("/system-health", (_req, res) => {
    res.setHeader("Content-Security-Policy", SYSTEM_HEALTH_CSP);
    res.type("html").send(systemHealthPage(systemHealth(db, opts.now?.() ?? new Date())));
  });
  app.get("/api/system-health", (_req, res) => {
    res.json(systemHealth(db, opts.now?.() ?? new Date()));
  });
  app.get("/api/trace/:seq", (req, res) => {
    const seq = String(req.params.seq);
    if (!/^\d{1,12}$/.test(seq)) {
      res.status(400).type("text/plain").send("bad run");
      return;
    }
    const trace = agentTraces(db).find((t) => t.run_seq === Number(seq));
    if (!trace) {
      res.status(404).type("text/plain").send("no such run");
      return;
    }
    res.json(trace);
  });

  app.get("/approve/:id", (req, res) => {
    const id = String(req.params.id);
    if (!/^P-\d{4,}$/.test(id)) {
      res.status(400).type("text/plain").send("bad proposal id");
      return;
    }
    res.redirect(302, `${opts.approvalsUrl.replace(/\/$/, "")}/#${id}`);
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).type("text/plain").send(`error: ${err.message}`);
  });

  return app;
}
