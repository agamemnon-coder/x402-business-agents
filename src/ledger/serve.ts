// `npm run ledger -- serve`: the read-only books page on this machine. The same guard as the payables and vault pages
// (seam review L3): only a request addressed to this machine by name (127.0.0.1, localhost, [::1]) is answered, so a
// web page elsewhere cannot read the books through DNS rebinding; strict headers, no scripts.

import express from "express";
import type { DB } from "../db/open.js";
import { LEDGER_PAGE_CSP, ledgerPage } from "./page.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function thisQuarter(d: string): string {
  return `${d.slice(0, 4)}Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
}

export function ledgerApp(db: DB, now: () => Date = () => new Date()) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) { res.status(403).type("text/plain").send("forbidden host"); return; }
    res.set({ "content-security-policy": LEDGER_PAGE_CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" });
    next();
  });
  app.get("/", (_req, res) => {
    const d = now().toISOString().slice(0, 10);
    res.type("html").send(ledgerPage(db, { asOf: d, quarter: thisQuarter(d), year: Number(d.slice(0, 4)) }));
  });
  return app;
}
