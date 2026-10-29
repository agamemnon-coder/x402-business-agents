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

export const PAGE = readFileSync(new URL("../dashboard/page.html", import.meta.url), "utf8");
const MONTH_TEMPLATE = readFileSync(new URL("../dashboard/month.html", import.meta.url), "utf8");

/** The hash of a page's one inline script or style (a data block, <script type=…>, is not a script and not hashed). */
const inlineHash = (page: string, tag: "script" | "style") => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(page);
  if (!m) throw new Error(`the page has no inline ${tag}`);
  return `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`;
};
const cspFor = (page: string) => [
  "default-src 'none'", `script-src ${inlineHash(page, "script")}`, `style-src ${inlineHash(page, "style")}`, "connect-src 'self'",
  "img-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");
// Only the page's own script and style may run; data arrives over fetch from this origin only.
export const CSP = cspFor(PAGE);
/** The month replay carries its data inside the page, so it needs no request at all once loaded. */
export const MONTH_CSP = cspFor(MONTH_TEMPLATE);

/** The month replay page with the simulated month in it (JSON, with "<" escaped so it cannot close the block). */
export function monthPage(report: MonthReport = simulateMonth()): string {
  return MONTH_TEMPLATE.replace("__MONTH_JSON__", () => JSON.stringify(report).replace(/</g, "\\u003c"));
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
    res.type("html").send(PAGE);
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
