// The live dashboard: one static page that polls GET api/snapshot. It reads the ledger and nothing else,
// so it holds no key and cannot approve or move money. "Review and approve" hands over to the approval page.
// The page uses relative URLs only, so the same file can later be served by another host unchanged.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "../db/open.js";
import { buildSnapshot } from "../dashboard/snapshot.js";

export const PAGE = readFileSync(new URL("../dashboard/page.html", import.meta.url), "utf8");

const inlineHash = (tag: "script" | "style") => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(PAGE);
  if (!m) throw new Error(`page.html has no inline ${tag}`);
  return `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`;
};
// Only the page's own script and style may run; data arrives over fetch from this origin only.
export const CSP = [
  "default-src 'none'", `script-src ${inlineHash("script")}`, `style-src ${inlineHash("style")}`, "connect-src 'self'",
  "img-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface DashboardOptions {
  /** Where "Review and approve" goes: the approval page that records decisions. */
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
