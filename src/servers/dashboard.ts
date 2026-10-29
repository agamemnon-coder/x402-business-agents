// The live dashboard: one static page that polls GET api/snapshot. It reads the ledger and nothing else,
// so it holds no key and cannot approve or move money. "Review: approve or reject" hands over to the approval page.
// The page uses relative URLs only, so the same file can later be served by another host unchanged.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "../db/open.js";
import { buildSnapshot } from "../dashboard/snapshot.js";
import { simulateMonth, type MonthReport } from "../sim/month.js";
import type { Story } from "../demo/story.js";
import type { Recorded } from "../demo/recorded.js";
import { ICONS } from "../ui/icons.js";
import { AGENT_DISPLAY } from "../config/brand.js";

/** What each agent is called on the pages (docs/decisions.md D2), as a data block: no markup, not part of any hash. */
const AGENTS_JSON = JSON.stringify(Object.fromEntries(Object.entries(AGENT_DISPLAY).map(([id, a]) => [id, a.name])));

/** The red team's latest summary (npm run redteam writes docs/redteam/report.json); "null" before the first run. */
const REDTEAM_FILE = new URL("../../docs/redteam/report.json", import.meta.url);
const REDTEAM_JSON = (() => {
  try {
    const r = JSON.parse(readFileSync(REDTEAM_FILE, "utf8")) as { ran_at: string; attempts: number; blocked: number };
    return JSON.stringify({ ran_at: r.ran_at, attempts: r.attempts, blocked: r.blocked }).replace(/</g, "\\u003c");
  } catch {
    return "null";
  }
})();

const PAGE_TEMPLATE = readFileSync(new URL("../dashboard/page.html", import.meta.url), "utf8");
const RECORDED_FILE = new URL("../../docs/demo/snapshot.json", import.meta.url);
/** Inter (OFL, src/ui/inter-LICENSE.txt), served as /assets/inter.woff2 by every host of the pages. */
export const FONT = readFileSync(new URL("../ui/inter.woff2", import.meta.url));
/** The sponsors' official logos (src/ui/logos/README.md), served as /assets/<name> for the landing's "Built on". */
export const LOGOS: Record<string, { type: string; body: Buffer }> = {
  "logo-airwallex.png": { type: "image/png", body: readFileSync(new URL("../ui/logos/airwallex.png", import.meta.url)) },
  "logo-metal.svg": { type: "image/svg+xml", body: readFileSync(new URL("../ui/logos/metal.svg", import.meta.url)) },
};
const MONTH_TEMPLATE = readFileSync(new URL("../dashboard/month.html", import.meta.url), "utf8");
const DEMO_TEMPLATE = readFileSync(new URL("../demo/demo.html", import.meta.url), "utf8");
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
    .replace("__RECORDED_JSON__", () => JSON.stringify(recorded).replace(/</g, "\\u003c"))
    .replace("__AGENTS_JSON__", AGENTS_JSON)
    .replace("__REDTEAM_JSON__", () => REDTEAM_JSON);
}
export const PAGE = dashboardPage();
// Only the page's own script and style may run; data arrives over fetch from this origin only.
export const CSP = cspFor(PAGE);
/** The month replay carries its data inside the page, so it needs no request at all once loaded. */
export const MONTH_CSP = cspFor(MONTH_TEMPLATE);

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

  app.get("/month", (_req, res) => {
    res.setHeader("Content-Security-Policy", MONTH_CSP);
    res.type("html").send(monthPage());
  });

  app.get("/api/snapshot", (_req, res) => {
    res.json(buildSnapshot(db, opts.now?.() ?? new Date()));
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
