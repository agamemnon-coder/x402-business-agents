// The live dashboard: one static page that polls GET api/snapshot. It reads the ledger and nothing else,
// so it holds no key and cannot approve or move money. "Review: approve or reject" hands over to the approval page.
// The page uses relative URLs only, so the same file can later be served by another host unchanged.

import { visaPage } from "../visa/page.js";
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
import { AGENT_DISPLAY, RECORDING_NAMES_NOTE } from "../config/brand.js";
import { kit11NamesRecorded } from "../demo/oldNames.js";
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

/**
 * Until the live run with the Kit 11 names is recorded, every page that plays the 30 October recording says, at the
 * top, that it was made before the rename (src/config/brand.ts). The dashboard shows it in its recorded-run lines; the
 * film, a fixed 1920x1080 stage, at the bottom. Added before each page's CSP hash is taken.
 */
const NAMES_NOTE = kit11NamesRecorded() ? null : RECORDING_NAMES_NOTE;
const withNamesNote = (page: string, where: "top" | "bottom" = "top") => !NAMES_NOTE ? page : page
  .replace("</style>", () => `.names-note { margin: 0; padding: 10px 16px; font: 500 13.5px/1.5 Inter, system-ui, sans-serif; background: #fff7e6; color: #5c3b00; border-bottom: 1px solid #f0d9a8; text-align: center; }
details.names-note summary { cursor: pointer; }
.names-note.bottom { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; border-bottom: 0; border-top: 1px solid #f0d9a8; }
@media (prefers-color-scheme: dark) { .names-note { background: #2a2110; color: #f3dca8; border-color: #4a3a1c; } }
</style>`)
  // One line at the top, the full note folded (design review); the film's fixed stage keeps it as one line at the bottom.
  .replace(/<body[^>]*>/, (m) => where === "bottom"
    ? `${m}\n<p class="names-note bottom" role="note">${NAMES_NOTE}</p>`
    : `${m}\n<details class="names-note" role="note"><summary>Recorded 30 October, before the agents took Kit 11's names · details</summary>${NAMES_NOTE}</details>`);

const PAGE_TEMPLATE = withNav(readFileSync(new URL("../dashboard/page.html", import.meta.url), "utf8"), "overview");
const RECORDED_FILE = new URL("../../docs/demo/snapshot.json", import.meta.url);
// D19: an autonomous dry run, recorded the same way (npm run autonomy-record), for /?autonomy; absent: the page hides it.
const AUTONOMY_FILE = new URL("../../docs/demo/autonomy.json", import.meta.url);
const AUTONOMY_JSON = (() => { try { return readFileSync(AUTONOMY_FILE, "utf8").trim(); } catch { return "null"; } })();
/** Inter (OFL, src/ui/inter-LICENSE.txt), served as /assets/inter.woff2 by every host of the pages. */
export const FONT = readFileSync(new URL("../ui/inter.woff2", import.meta.url));
/** The sponsors' official logos (src/ui/logos/README.md), served as /assets/<name> for the landing's "Built on". */
export const LOGOS: Record<string, { type: string; body: Buffer }> = {
  "logo-airwallex.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/airwallex.png", import.meta.url)) },
  "logo-metal.svg": { type: "image/svg+xml", body: readFileSync(new URL("../ui/logos/metal.svg", import.meta.url)) },
  "logo-claude.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/claude.png", import.meta.url)) },
};
const MONTH_TEMPLATE = withNav(readFileSync(new URL("../dashboard/month.html", import.meta.url), "utf8"), "month");
const DEMO_TEMPLATE = withNav(withNamesNote(readFileSync(new URL("../demo/demo.html", import.meta.url), "utf8")), "demo");
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

/**
 * The dashboard page: the icon set goes into its script (so before the CSP hash), and the recorded run a guest sees
 * (docs/demo/snapshot.json unless one is given) into its data block, "<" escaped.
 */
export function dashboardPage(recorded: Recorded = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as Recorded): string {
  return PAGE_TEMPLATE
    .replace("__ICONS_JSON__", () => JSON.stringify(ICONS))
    .replace("__RECORDED_JSON__", () => JSON.stringify(NAMES_NOTE ? { ...recorded, names_note: NAMES_NOTE } : recorded).replace(/</g, "\\u003c"))
    .replace("__AUTONOMY_JSON__", () => AUTONOMY_JSON.replace(/</g, "\\u003c"))
    .replace("__AGENTS_JSON__", AGENTS_JSON)
    .replace("__REDTEAM_JSON__", () => REDTEAM_JSON);
}
export const PAGE = dashboardPage();
// Only the page's own script and style may run; data arrives over fetch from this origin only.
export const CSP = cspFor(PAGE);
/** The month replay carries its data inside the page, so it needs no request at all once loaded. */
export const MONTH_CSP = cspFor(MONTH_TEMPLATE);

/** The Scenario Lab (E) carries its results inside the page, like the month replay. */
export const LAB_CSP = cspFor(LAB_TEMPLATE);
export interface LabData { mode: "live" | "recorded"; at: string; results: ScenarioResult[] }
/** The Lab page: results run now (on the runner) or the ones recorded by npm run lab (docs/lab/results.json). */
export function labPage(data: LabData = { mode: "recorded", ...(JSON.parse(readFileSync(LAB_FILE, "utf8")) as Omit<LabData, "mode">) }): string {
  return LAB_TEMPLATE.replace("__LAB_JSON__", () => JSON.stringify(data).replace(/</g, "\\u003c"));
}

/** "Purser live": the animated day, its timeline inside the page (src/live/timeline.ts), built from the recordings. */
// The banner about the old (30 October) recording stays on /live for now (withNamesNote): Max removes it after
// Monday's reserve run is recorded, not before. Do not drop it with other /live fixes.
const LIVE_TEMPLATE = withNav(withNamesNote(readFileSync(new URL("../live/live.html", import.meta.url), "utf8")), "live");
export const LIVE_CSP = cspFor(LIVE_TEMPLATE);
export function livePage(story: Story = JSON.parse(readFileSync(STORY_FILE, "utf8")) as Story, recorded: Recorded = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as Recorded): string {
  return LIVE_TEMPLATE.replace("__LIVE_JSON__", () => JSON.stringify(buildLiveTimeline(story, recorded)).replace(/</g, "\\u003c"));
}

const FILM_TEMPLATE = withNamesNote(readFileSync(new URL("../film/film.html", import.meta.url), "utf8"), "bottom");
export const FILM_CSP = cspFor(FILM_TEMPLATE);
/** The film (src/film/): its facts from the recordings and the latest red team and Lab reports, its scenes timed. */
export function filmPage(story: Story = JSON.parse(readFileSync(STORY_FILE, "utf8")) as Story, recorded: Recorded = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as Recorded): string {
  const redteam = JSON.parse(readFileSync(REDTEAM_FILE, "utf8")) as { attempts: number; blocked: number };
  const lab = JSON.parse(readFileSync(LAB_FILE, "utf8")) as { results: { passed: boolean }[] };
  const data = buildFilm(story, recorded, { redteam, lab: { total: lab.results.length, passed: lab.results.filter((r) => r.passed).length } });
  return FILM_TEMPLATE.replace("__FILM_JSON__", () => JSON.stringify({ data, scenes: filmTimeline() }).replace(/</g, "\\u003c"));
}

/** Try Purser (src/try/): the page; its requests go to POST /api/try. */
// It carries the recorded run's rails and AI tricks, so each answer can show the same flow as it ran live.
export const TRY_PAGE = (() => {
  const rec = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as { snapshot?: { rails?: unknown }; proof?: { ai_tricks?: number } };
  // The example shown before a visitor runs a try: one real Claude call, recorded once and labelled (src/try/example.json).
  const example = JSON.parse(readFileSync(new URL("../try/example.json", import.meta.url), "utf8")) as unknown;
  const data = { rails: rec.snapshot?.rails ?? null, ai_tricks: rec.proof?.ai_tricks ?? null, worlds: WORLD_CHANGES.map(({ id, label, detail }) => ({ id, label, detail })), example };
  return withNav(readFileSync(new URL("../try/try.html", import.meta.url), "utf8"), "try").replace("__TRY_JSON__", () => JSON.stringify(data).replace(/</g, "\\u003c"));
})();
export const TRY_CSP = cspFor(TRY_PAGE);

/** "How Purser uses Metal" (src/metal/): the features, mandates and Dispute desk case recorded in docs/demo/metal.json. */
const METAL_FILE = new URL("../../docs/demo/metal.json", import.meta.url);
const metalData = () => JSON.parse(readFileSync(METAL_FILE, "utf8")) as { dispute: DisputeCase | null };
export const METAL_PAGE = withNav(withNamesNote(readFileSync(new URL("../metal/metal.html", import.meta.url), "utf8")), "metal").replace("__METAL_JSON__", () => JSON.stringify(metalData()).replace(/</g, "\\u003c"));
export const METAL_CSP = cspFor(METAL_PAGE);
/** /visa: agent recognition, then the agent's own Airwallex Visa card (src/visa/page.ts). */
export const VISA_PAGE = withNav(visaPage(), "visa");
// No script on /visa: a style-only policy, as for the evidence report.
export const VISA_CSP = ["default-src 'none'", `style-src ${inlineHash(VISA_PAGE, "style")}`, "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
/** The evidence report the seller sends for the recorded case: no script at all, only its own style. */
export const METAL_REPORT = (() => {
  const c = metalData().dispute;
  return c ? disputeReportHtml(c) : null;
})();
export const METAL_REPORT_CSP = METAL_REPORT ? [
  "default-src 'none'", `style-src ${inlineHash(METAL_REPORT, "style")}`, "img-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ") : "";

/** The public demo page (K5 replay) plays a recorded run; no request, no key, nothing live. */
export const DEMO_CSP = cspFor(DEMO_TEMPLATE);

/** The demo page with the recorded story in it (docs/demo/story.json unless one is given), "<" escaped. */
export function demoPage(story: Story = JSON.parse(readFileSync(STORY_FILE, "utf8")) as Story): string {
  return DEMO_TEMPLATE.replace("__STORY_JSON__", () => JSON.stringify(story).replace(/</g, "\\u003c"));
}

/** The month replay page with the simulated month in it (JSON, with "<" escaped so it cannot close the block). */
export function monthPage(report: MonthReport = simulateMonth()): string {
  return MONTH_TEMPLATE.replace("__MONTH_JSON__", () => JSON.stringify(report).replace(/</g, "\\u003c")).replace("__AGENTS_JSON__", AGENTS_JSON);
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
    const logo = LOGOS[String(req.params.name)];
    if (!logo) return next();
    res.type(logo.type).send(logo.body);
  });

  app.get("/demo", (_req, res) => {
    res.setHeader("Content-Security-Policy", DEMO_CSP);
    res.type("html").send(demoPage());
  });

  app.get("/try", (_req, res) => {
    res.setHeader("Content-Security-Policy", TRY_CSP);
    res.type("html").send(TRY_PAGE);
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
  app.get("/visa", (_req, res) => {
    res.setHeader("Content-Security-Policy", VISA_CSP);
    res.type("html").send(VISA_PAGE);
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
