// The vault's local page (npm run vault -- serve): browse the folders and open the PDFs. Read-only, on 127.0.0.1, the
// same pattern as the payables page (Host check, rate limit) and no scripts at all: one inline stylesheet allowed by
// its hash. Every path is resolved inside the vault folder; anything that would leave it is refused.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import express from "express";
import { rateLimit } from "express-rate-limit";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CSS = "body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#111;background:#fff;max-width:900px}h1{font-size:20px}a{color:#1d4ed8;text-decoration:none}a:hover{text-decoration:underline}ul{list-style:none;padding:0}li{padding:6px 0;border-bottom:1px solid #eee}.f::before{content:'📁 '}.d::before{content:'📄 '}.n{color:#666;font-size:12px}.crumbs{color:#666}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}a{color:#93c5fd}li{border-color:#333}}";
export const VAULT_PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(CSS).digest("base64")}'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const href = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export function vaultApp(rootDir: string, opts: { rateLimit?: { windowMs: number; limit: number } } = {}) {
  const root = resolve(rootDir);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) { res.status(403).type("text/plain").send("forbidden host"); return; }
    res.set({ "content-security-policy": VAULT_PAGE_CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" });
    next();
  });
  app.use(rateLimit({ windowMs: opts.rateLimit?.windowMs ?? 60_000, limit: opts.rateLimit?.limit ?? 300, standardHeaders: "draft-8", legacyHeaders: false }));

  /** The vault-relative path of a request, or null when it would leave the vault (or cannot be decoded). */
  const inside = (raw: string): { rel: string; abs: string } | null => {
    let rel: string;
    try { rel = raw.split("/").filter(Boolean).map(decodeURIComponent).join("/"); } catch { return null; }
    if (rel.split("/").some((s) => s === ".." || s === "." || s.includes("\\") || s.includes("\u0000"))) return null;
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    return { rel, abs };
  };

  const page = (title: string, body: string) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

  const listing = (rel: string, abs: string): string => {
    const parts = rel ? rel.split("/") : [];
    const crumbs = [`<a href="/">Kluis</a>`, ...parts.map((p, i) => `<a href="/browse/${href(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`)].join(" / ");
    const entries = existsSync(abs) ? readdirSync(abs, { withFileTypes: true }).filter((e) => !e.name.endsWith(".tmp")).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)) : [];
    const items = entries.map((e) => {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return `<li class="f"><a href="/browse/${href(p)}">${esc(e.name)}</a></li>`;
      const size = statSync(resolve(abs, e.name)).size;
      return `<li class="d"><a href="/file/${href(p)}">${esc(e.name)}</a> <span class="n">${(size / 1024).toFixed(1)} kB</span></li>`;
    });
    return page(rel || "Purser-kluis", `<h1>Purser-kluis</h1><p class="crumbs">${crumbs}</p><ul>${items.join("") || "<li>Nog niets in deze map.</li>"}</ul><p class="n">Alleen lezen. Bestanden worden toegevoegd, nooit vervangen of verwijderd; index.json in elk jaar noemt ze allemaal met hun sha256.</p>`);
  };

  app.get("/", (_req, res) => { res.type("html").send(listing("", root)); });
  app.use("/browse", (req, res) => {
    const p = inside(req.path);
    if (!p || !existsSync(p.abs) || !statSync(p.abs).isDirectory()) { res.status(404).type("text/plain").send("not in the vault"); return; }
    res.type("html").send(listing(p.rel, p.abs));
  });
  app.use("/file", (req, res) => {
    const p = inside(req.path);
    if (!p || !existsSync(p.abs) || !statSync(p.abs).isFile()) { res.status(404).type("text/plain").send("not in the vault"); return; }
    const name = p.rel.split("/").pop()!;
    res.type(name.endsWith(".json") ? "application/json" : "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name.replace(/[^\w. -]+/g, "_")}"`);
    res.send(readFileSync(p.abs));
  });
  return app;
}
