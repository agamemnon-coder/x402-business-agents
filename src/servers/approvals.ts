// A localhost approval page: the same decision the CLI records, with the exact terms laid out so a person
// reads what they approve. The page shows what is stored and never computes an amount. The decision goes
// through decide() (typed 8-hex prefix of the hash) and then the executor, which re-checks the hash itself.

import { randomBytes } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "../db/open.js";
import { PREFIX_LENGTH, termsHash, type Terms } from "../lib/terms.js";
import { decide, expireDue, type ProposalRow } from "../policy/approvals.js";

export interface ApprovalsOptions {
  approver: string;
  execute: (db: DB, id: string) => Promise<void>;
}

type Row = ProposalRow & { explanation: string | null };

const EXPLORER_TX = "https://testnet.metalntwx.com/tx/";
// Not preceded or followed by more hex, so a longer hex string is not cut into a fake tx hash.
const TX_HASH = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Escapes text and turns each 66-char 0x tx hash in it into an explorer link. */
function linkify(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TX_HASH)) {
    out += esc(text.slice(last, m.index));
    out += `<a href="${EXPLORER_TX}${esc(m[0])}" target="_blank" rel="noopener noreferrer"><code>${esc(m[0])}</code></a>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

const muted = (s: string) => `<span class="muted">${esc(s)}</span>`;

/** Every field of the stored JSON, nested objects and arrays included, as nested tables. */
function renderValue(v: unknown): string {
  if (v === null) return muted("null");
  if (Array.isArray(v)) {
    if (v.length === 0) return muted("(empty list)");
    const grid = gridOf(v);
    if (grid) return grid;
    return table(v.map((x, i) => [`[${i + 1}]`, x] as [string, unknown]));
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length === 0 ? muted("(empty object)") : table(entries);
  }
  if (v === "") return muted('"" (empty text)');
  return linkify(String(v));
}

/** A list of flat records with the same keys (refunds, evidence, steps) reads best as one row per item. */
function gridOf(items: unknown[]): string | null {
  const flat = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((y) => y === null || typeof y !== "object" || (Array.isArray(y) && y.every((z) => typeof z !== "object")));
  if (!items.every(flat)) return null;
  const keys = Object.keys(items[0] as object);
  if (!items.every((x) => Object.keys(x as object).join("\u0000") === keys.join("\u0000"))) return null;
  const cell = (y: unknown) => (Array.isArray(y) ? y.map((z) => linkify(String(z))).join("<br>") : renderValue(y));
  const head = `<tr>${keys.map((k) => `<th scope="col">${esc(k)}</th>`).join("")}</tr>`;
  const rows = (items as Record<string, unknown>[]).map((x) => `<tr>${keys.map((k) => `<td>${cell(x[k])}</td>`).join("")}</tr>`).join("");
  return `<table class="terms grid"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function table(entries: [string, unknown][]): string {
  const rows = entries.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${renderValue(v)}</td></tr>`).join("");
  return `<table class="terms"><tbody>${rows}</tbody></table>`;
}

function renderProposal(p: Row, csrf: string): string {
  let termsHtml: string;
  let changed: boolean;
  try {
    const terms = JSON.parse(p.terms_json) as Terms;
    termsHtml = renderValue(terms);
    changed = termsHash(terms) !== p.terms_sha256;
  } catch (e) {
    // Terms that cannot be read or hashed cannot be approved on trust; show the raw text and the warning.
    termsHtml = `<pre>${esc(p.terms_json)}</pre><p class="muted">${esc((e as Error).message)}</p>`;
    changed = true;
  }
  const pending = p.status === "PENDING_APPROVAL";
  const head = p.terms_sha256.slice(0, PREFIX_LENGTH);
  return `
<article class="card ${pending ? "pending" : ""}" id="${esc(p.proposal_id)}">
  <header>
    <h2>${esc(p.proposal_id)} <span class="kind">${esc(p.kind)}</span></h2>
    <span class="status status-${esc(p.status)}">${esc(p.status)}</span>
  </header>
  <p>Expires <time data-expires="${esc(p.expires_at)}">${esc(p.expires_at)}</time> <span class="countdown" data-countdown="${esc(p.expires_at)}"></span></p>
  ${changed ? `<p class="alarm" role="alert">Terms changed: the stored terms no longer hash to the recorded sha256. Do not approve.</p>` : ""}
  <h3>Exact terms</h3>
  ${termsHtml}
  <h3>sha256 of the terms</h3>
  <p class="hash"><code><strong>${esc(head)}</strong>${esc(p.terms_sha256.slice(PREFIX_LENGTH))}</code></p>
  ${p.explanation ? `<h3>Advisory review by Claude (not used for any amount)</h3><p class="advisory">${esc(p.explanation)}</p>` : ""}
  ${pending ? `
  <form method="post" action="/proposals/${encodeURIComponent(p.proposal_id)}/decision" autocomplete="off">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <label>First ${PREFIX_LENGTH} hex characters of the sha256 above
      <input name="prefix" required minlength="${PREFIX_LENGTH}" maxlength="${PREFIX_LENGTH}" pattern="[0-9a-fA-F]{${PREFIX_LENGTH}}" inputmode="text" spellcheck="false" autocapitalize="off"></label>
    <label>Note (optional)
      <input name="note" maxlength="500"></label>
    <div class="buttons">
      <button type="submit" name="decision" value="approve" class="approve">Approve and run</button>
      <button type="submit" name="decision" value="reject" class="reject">Reject</button>
    </div>
  </form>` : ""}
</article>`;
}

const CSS = `
:root { color-scheme: light dark; --bg:#f6f7f9; --fg:#14181f; --card:#fff; --line:#c9ced6; --muted:#566070; --accent:#0b5cd5;
  --ok-bg:#e1f5e6; --ok-fg:#0d4a1e; --bad-bg:#fde4e4; --bad-fg:#7a1010; --warn:#b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg:#101319; --fg:#e8ebf0; --card:#1a1f28; --line:#394150; --muted:#9aa5b5; --accent:#6ea8ff;
  --ok-bg:#12351e; --ok-fg:#b9efc8; --bad-bg:#431515; --bad-fg:#ffc9c9; --warn:#ff8a80; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:1.125rem/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 60rem; margin: 0 auto; padding: 1rem; }
h1 { font-size: 1.6rem; } h2 { font-size: 1.3rem; margin:0; } h3 { font-size: 1.05rem; margin: 1.1rem 0 .3rem; color: var(--muted); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 1rem; }
code { overflow-wrap: anywhere; } pre { white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: var(--accent); }
.muted { color: var(--muted); }
.card { background:var(--card); border:1px solid var(--line); border-radius:.6rem; padding:1rem 1.2rem; margin:1rem 0; }
.card.pending { border-width: 2px; border-color: var(--accent); }
.card header { display:flex; flex-wrap:wrap; gap:.5rem 1rem; align-items:baseline; justify-content:space-between; }
.kind { font-weight: 400; color: var(--muted); font-size: 1rem; }
.status { font-weight:700; padding:.1rem .6rem; border:1px solid var(--line); border-radius:1rem; font-size:.95rem; }
.status-PENDING_APPROVAL { border-color: var(--accent); color: var(--accent); }
.status-EXECUTED { background:var(--ok-bg); color:var(--ok-fg); }
.status-REJECTED, .status-FAILED, .status-EXPIRED, .status-NEEDS_REAPPROVAL { background:var(--bad-bg); color:var(--bad-fg); }
table.terms { border-collapse: collapse; width:100%; margin:.1rem 0; }
table.terms th, table.terms td { border:1px solid var(--line); padding:.3rem .6rem; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
table.terms th { width: 14rem; font-weight:600; background: color-mix(in srgb, var(--line) 25%, transparent); }
table.terms table.terms { margin: 0; }
table.grid th { width: auto; } table.grid td { font-variant-numeric: tabular-nums; }
.hash code { font-size: 1.05rem; } .hash strong { background: color-mix(in srgb, var(--accent) 25%, transparent); padding: 0 .15rem; }
.advisory { border-left: 4px solid var(--muted); padding-left: .8rem; margin: .3rem 0; white-space: pre-wrap; }
.alarm { background: var(--warn); color: #fff; font-weight: 700; padding: .6rem .8rem; border-radius: .4rem; }
.flash { padding:.7rem 1rem; border-radius:.5rem; font-weight:600; overflow-wrap:anywhere; }
.flash.ok { background:var(--ok-bg); color:var(--ok-fg); } .flash.err { background:var(--bad-bg); color:var(--bad-fg); }
form { margin-top: 1.1rem; display:grid; gap:.7rem; }
label { display:grid; gap:.25rem; font-weight:600; }
input { font: inherit; padding:.45rem .6rem; border:1px solid var(--line); border-radius:.4rem; background:var(--bg); color:var(--fg); }
input[name=prefix] { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing:.1em; max-width: 12rem; }
.buttons { display:flex; gap:.8rem; flex-wrap:wrap; }
button { font: inherit; font-weight:700; padding:.55rem 1.1rem; border-radius:.45rem; border:2px solid; cursor:pointer; background:transparent; color:inherit; }
button.approve { border-color: var(--accent); background: var(--accent); color: #fff; } button.reject { border-color: var(--warn); color: var(--warn); }
button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
`;

// Countdown only; the page works without it, and the raw timestamp stays visible.
const COUNTDOWN_JS = `
(function () {
  var els = document.querySelectorAll("[data-countdown]");
  function tick() {
    var now = Date.now();
    els.forEach(function (el) {
      var ms = Date.parse(el.getAttribute("data-countdown")) - now;
      if (isNaN(ms)) { el.textContent = ""; return; }
      if (ms <= 0) { el.textContent = "(expired)"; return; }
      var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      el.textContent = "(in " + (h ? h + "h " : "") + m + "m " + (s % 60) + "s)";
    });
  }
  tick(); setInterval(tick, 1000);
})();
`;

function renderPage(db: DB, csrf: string, flash?: { kind: "ok" | "err"; text: string }): string {
  expireDue(db);
  const pending = db.prepare("SELECT * FROM proposals WHERE status = 'PENDING_APPROVAL' ORDER BY created_at, proposal_id").all() as Row[];
  const others = db.prepare("SELECT * FROM proposals WHERE status != 'PENDING_APPROVAL' ORDER BY created_at DESC, proposal_id DESC LIMIT 10").all() as Row[];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approvals</title>
<meta name="csrf" content="${esc(csrf)}">
<style>${CSS}</style>
</head>
<body>
<main>
  <h1>Approvals</h1>
  ${flash ? `<p class="flash ${flash.kind}" role="${flash.kind === "err" ? "alert" : "status"}">${esc(flash.text)}</p>` : ""}
  <h2>Waiting for approval (${pending.length})</h2>
  ${pending.length ? pending.map((p) => renderProposal(p, csrf)).join("") : `<p class="muted">Nothing waits for approval.</p>`}
  <h2>Recent decided or closed (latest 10)</h2>
  ${others.length ? others.map((p) => renderProposal(p, csrf)).join("") : `<p class="muted">Nothing yet.</p>`}
</main>
<script>${COUNTDOWN_JS}</script>
</body>
</html>`;
}

/** Maps decide()'s messages to an HTTP status. Anything unexpected is a 500. */
function statusFor(message: string): number {
  if (/^no proposal /.test(message)) return 404;
  if (/typed prefix/.test(message)) return 400;
  if (/passkey is enrolled/.test(message)) return 403;
  if (/not waiting for approval|no longer/.test(message)) return 409;
  return 500;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** How long a rendered form stays usable. */
const FORM_TTL_MS = 30 * 60 * 1000;

export function approvalsApp(db: DB, opts: ApprovalsOptions) {
  const app = express();
  app.disable("x-powered-by");
  // One random token per render, usable once: a page elsewhere cannot read it, so it cannot post a decision here
  // even if a browser sends a form without an Origin we can check (security review H2).
  const tokens = new Map<string, number>();
  const issue = (): string => {
    const now = Date.now();
    for (const [t, exp] of tokens) if (exp <= now) tokens.delete(t);
    const t = randomBytes(32).toString("hex");
    tokens.set(t, now + FORM_TTL_MS);
    return t;
  };
  const redeem = (t: unknown): boolean => {
    if (typeof t !== "string" || !tokens.has(t)) return false;
    const ok = tokens.get(t)! > Date.now();
    tokens.delete(t);
    return ok;
  };

  // The page can approve money movements, so refuse requests whose Host is not loopback (DNS rebinding)
  // and cross-site form posts; the typed hash prefix is a second barrier.
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) {
      res.status(403).type("text/plain").send("forbidden host");
      return;
    }
    // A post must come from this page itself: its exact origin. A missing Origin or "null" (a sandboxed frame or a
    // data: URL elsewhere) is refused, not let through.
    if (req.method === "POST" && req.headers.origin !== `http://${req.headers.host}`) {
      res.status(403).type("text/plain").send("forbidden origin");
      return;
    }
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/", (req, res) => {
    const msg = typeof req.query.msg === "string" ? req.query.msg.slice(0, 300) : "";
    res.type("html").send(renderPage(db, issue(), msg ? { kind: "ok", text: msg } : undefined));
  });

  app.post("/proposals/:id/decision", express.urlencoded({ extended: false, limit: "10kb" }), async (req: Request, res: Response) => {
    const fail = (code: number, text: string) => res.status(code).type("html").send(renderPage(db, issue(), { kind: "err", text }));
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!redeem(body.csrf)) {
      fail(403, "This form expired or was not sent from this page. Nothing was decided; the page is fresh now.");
      return;
    }
    const { prefix, note, decision } = body;
    if (typeof prefix !== "string" || (note !== undefined && typeof note !== "string")) {
      fail(400, "malformed form: prefix and note must be single text fields");
      return;
    }
    if (decision !== "approve" && decision !== "reject") {
      fail(400, "decision must be approve or reject");
      return;
    }
    const wanted = decision === "approve" ? "APPROVED" : "REJECTED";
    let result;
    try {
      result = decide(db, { proposalId: id, decision: wanted, typedPrefix: prefix, approver: opts.approver, method: "web", note: note?.trim() || undefined });
    } catch (e) {
      const message = (e as Error).message;
      fail(statusFor(message), message);
      return;
    }
    // decide() answers EXPIRED (and records it) instead of throwing when the proposal ran out.
    if (result !== wanted) {
      fail(409, `${id} is ${result}; no decision was recorded`);
      return;
    }
    if (wanted === "APPROVED") {
      try {
        await opts.execute(db, id);
      } catch (e) {
        fail(500, `${id} was approved, but execution failed: ${(e as Error).message}`);
        return;
      }
    }
    res.redirect(303, `/?msg=${encodeURIComponent(wanted === "APPROVED" ? `${id} approved and executed` : `${id} rejected`)}`);
  });

  // Last resort for anything unexpected (e.g. an unreadable ledger); no stack trace on the page.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).type("text/plain").send(`error: ${err.message}`);
  });

  return app;
}
