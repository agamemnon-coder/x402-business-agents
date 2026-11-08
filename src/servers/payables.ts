// Payables: the local page (npm run payables, 127.0.0.1) and its JSON routes under /api/payables. The page renders
// everything from the JSON with textContent, never as HTML. Like the approvals page: a loopback Host only, and a post
// needs this page's own Origin and its form token. Nothing here approves money: paying files a proposal that the CFO
// approves with Face ID on the phone; a new supplier is requested here and verified and approved as in src/ap/vendors.ts.
// The same handlers can later sit behind the authenticated agent API.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { rateLimit } from "express-rate-limit";
import type { Request, Response } from "express";
import type { AirwallexRail, PayoutRail } from "../airwallex/port.js";
import { apJournal, invoicesCsv, journalCsv } from "../ap/books.js";
import { clearPossibleDuplicate, ingestDocument, recheck, type InboxDeps } from "../ap/inbox.js";
import { insights } from "../ap/insights.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import { apInvoice, apInvoices } from "../ap/store.js";
import { proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import type { DB } from "../db/open.js";

export interface PayablesOptions {
  inbox: InboxDeps;
  /** The Airwallex sandbox; null without keys (paying and adding a supplier then answer 503). */
  rail: (AirwallexRail & PayoutRail) | null;
  /** Requests per window per client; the default suits one person working on the page. */
  rateLimit?: { windowMs: number; limit: number };
  /**
   * Where a supplier verification code is shown: the terminal that runs this page (the default prints it there). A
   * local process that can fetch the page token cannot read it, so it cannot record a verification on its own.
   */
  notify?: (line: string) => void;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TOKEN_TTL_MS = 30 * 60 * 1000;
/** A supplier verification code: six digits, ten minutes, three wrong tries, used once. */
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 3;
const sha = (s: string) => createHash("sha256").update(s).digest();

const PAGE = (csrf: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf" content="${csrf}">
<title>Purser · Payables</title>
<style>
:root{--bg:#fff;--fg:#14161a;--muted:#5d6470;--line:#e3e6ea;--ok:#127a3e;--warn:#9a6200;--bad:#b42318;--card:#f7f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e8eaee;--muted:#9aa1ad;--line:#262a31;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--card:#171a20}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0 4px}h2{font-size:17px;margin:24px 0 8px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}.tile b{display:block;font-size:20px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.st{font-weight:600}.st.ready,.st.paid{color:var(--ok)}.st.blocked,.st.rejected{color:var(--bad)}.st.needs_review,.st.needs_vendor,.st.waiting_cfo{color:var(--warn)}
.drop{border:2px dashed var(--line);border-radius:12px;padding:18px;text-align:center}
button{font:inherit;padding:4px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
#msg{min-height:1.5em}.wrap{overflow-x:auto}
</style></head><body><main>
<h1>Payables</h1>
<p class="muted">Supplier invoices in, read, checked, paid with the CFO's Face ID, and booked. Test money only: the Airwallex sandbox.</p>
<div class="drop"><p>Drop PDF invoices or saved e-mails (.eml) here, or <input type="file" id="file" multiple accept=".pdf,.eml,application/pdf,message/rfc822"></p><p id="msg" class="muted"></p></div>
<h2>Insight</h2><div id="tiles" class="grid"></div>
<h2>Invoices</h2><div class="wrap"><table><thead><tr><th>Id</th><th>Supplier</th><th>Number</th><th>Due</th><th>Amount</th><th>Status</th><th>Why</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
<p><a href="/api/payables/export/journal.csv">Journal (CSV)</a> · <a href="/api/payables/export/invoices.csv">Invoices (CSV)</a> · <button id="sync">Check payments</button></p>
</main><script>
const csrf=document.querySelector('meta[name=csrf]').content;
const msg=(t)=>{document.getElementById('msg').textContent=t};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
async function post(path,body,headers){const r=await fetch(path,{method:'POST',headers:Object.assign({'x-csrf':csrf},headers||{}),body});const j=await r.json().catch(()=>({error:r.statusText}));if(!r.ok)throw new Error(j.error||r.statusText);return j}
async function load(){
  const [list,x]=await Promise.all([fetch('/api/payables/invoices').then(r=>r.json()),fetch('/api/payables/insights').then(r=>r.json())]);
  const tiles=document.getElementById('tiles');tiles.replaceChildren();
  const sum=(a)=>a.length?a.map(v=>v.currency+' '+v.total).join(' · '):'none';
  for(const [k,v] of [['Open',sum(x.open)],['Due in 7 days',sum(x.due_7)],['Overdue',sum(x.overdue)],['Blocked',String(x.blocked.count)],['Waiting for a supplier',String(x.waiting.needs_vendor)],['Waiting for Face ID',String(x.waiting.waiting_cfo)],['SWIFT fees paid',sum(x.costs.swift_fees)]]){const t=el('div',undefined,'tile');t.append(el('span',k,'muted'),el('b',v));tiles.append(t)}
  for(const r of x.price_rises){const t=el('div',undefined,'tile');t.append(el('span','Price rise','muted'),el('b',r.vendor+' +'+r.change_pct+'%'));tiles.append(t)}
  const rows=document.getElementById('rows');rows.replaceChildren();
  for(const i of list){
    const tr=el('tr');
    const doc=el('a',i.id);doc.href='/api/payables/invoices/'+encodeURIComponent(i.id)+'/document';doc.target='_blank';doc.rel='noopener';
    const td0=el('td');td0.append(doc);
    const why=i.findings.filter(f=>f.level!=='warn').map(f=>f.detail).join('; ')||i.findings.map(f=>f.detail).join('; ');
    const tdWhy=el('td');tdWhy.append(el('div',why));if(i.review_note)tdWhy.append(el('div','Note: '+i.review_note,'muted'));
    const act=el('td');
    if(i.status==='ready'&&i.currency==='EUR'){const b=el('button','Pay (Face ID)');b.onclick=async()=>{try{const j=await post('/api/payables/invoices/'+i.id+'/pay');msg(j.kind==='proposed'?i.id+': waiting for the CFO\\'s Face ID on the phone':i.id+': '+j.reason);load()}catch(e){msg(e.message)}};act.append(b)}
    if(i.status==='needs_vendor'){const b=el('button','Request supplier');b.onclick=async()=>{try{const j=await post('/api/payables/invoices/'+i.id+'/supplier-request');msg(j.add_id+': now verify it with the supplier on a number you already had (npm run payables -- supplier-verify)');load()}catch(e){msg(e.message)}};act.append(b)}
    tr.append(td0,el('td',i.vendor),el('td',i.invoice_no),el('td',i.due_date),el('td',(i.currency+' '+i.total).trim()),el('td',i.status.replace(/_/g,' '),'st '+i.status),tdWhy,act);
    rows.append(tr)}
}
async function send(files){for(const f of files){msg('Filing '+f.name+' ...');try{const j=await post('/api/payables/documents',f,{'content-type':'application/octet-stream','x-filename':encodeURIComponent(f.name)});const n=j.kind==='email'?j.results.length+' PDF(s) from the e-mail':j.kind==='duplicate_document'?'already filed':j.invoice.id+': '+j.invoice.status.replace(/_/g,' ');msg(f.name+': '+n)}catch(e){msg(f.name+': '+e.message)}}load()}
document.getElementById('file').onchange=(e)=>send(e.target.files);
const drop=document.querySelector('.drop');drop.ondragover=(e)=>{e.preventDefault()};drop.ondrop=(e)=>{e.preventDefault();send(e.dataTransfer.files)};
document.getElementById('sync').onclick=async()=>{try{const j=await post('/api/payables/sync');msg(j.changed.length+' invoice(s) changed');load()}catch(e){msg(e.message)}};
load();
</script></body></html>`;

function statusFor(message: string): number {
  if (/^no (payables invoice|supplier request) /.test(message)) return 404;
  if (/not a PDF|larger than|not an IBAN|not a BIC|checksum|needs a name|say how|say who|say why|address/.test(message)) return 400;
  if (/not ready|not waiting|already|German \(DE\)|looks like|on file|not verified|pays EUR only|never cleared/.test(message)) return 409;
  if (/only a person|verification code|last four/.test(message)) return 403;
  return 500;
}

export function payablesApp(db: DB, opts: PayablesOptions) {
  const app = express();
  app.disable("x-powered-by");
  // A page token, valid for half an hour and for several posts (the page uploads many files): a page elsewhere cannot
  // read it, so it cannot post here even where a browser sends no Origin we can check.
  const tokens = new Map<string, number>();
  const issue = (): string => {
    const now = Date.now();
    for (const [t, exp] of tokens) if (exp <= now) tokens.delete(t);
    const t = randomBytes(32).toString("hex");
    tokens.set(t, now + TOKEN_TTL_MS);
    return t;
  };
  const valid = (t: unknown) => typeof t === "string" && (tokens.get(t) ?? 0) > Date.now();

  // A runaway script or a page left polling cannot hammer the ledger or the document store (CodeQL: missing rate limit).
  app.use(rateLimit({ windowMs: opts.rateLimit?.windowMs ?? 60_000, limit: opts.rateLimit?.limit ?? 300, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "too many requests; wait a minute" } }));

  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) { res.status(403).type("text/plain").send("forbidden host"); return; }
    if (req.method === "POST") {
      if (req.headers.origin !== `http://${req.headers.host}`) { res.status(403).json({ error: "forbidden origin" }); return; }
      if (!valid(req.headers["x-csrf"])) { res.status(403).json({ error: "this page's token is missing or expired; reload the page" }); return; }
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const csp = (res: Response) => res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  const fail = (res: Response, e: unknown) => { const m = (e as Error).message; res.status(statusFor(m)).json({ error: m }); };
  const deps = (): InboxDeps => opts.inbox;
  const notify = opts.notify ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  // One verification code per supplier request, shown only in this terminal (red team round 2: the page token alone
  // let any local process record "a person verified these bank details").
  const codes = new Map<string, { hash: Buffer; exp: number; tries: number }>();
  const issueCode = (key: string): string => {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    codes.set(key, { hash: sha(`${key}:${code}`), exp: Date.now() + CODE_TTL_MS, tries: 0 });
    return code;
  };
  /** Uses the code for `key` once; throws (403) when it is missing, expired, wrong, or `also` fails; three misses void it. */
  const takeCode = (key: string, given: unknown, also: () => boolean, alsoWhy: string): void => {
    const held = codes.get(key);
    if (!held || held.exp <= Date.now()) { codes.delete(key); throw new Error("ask for a verification code first (it is shown in the terminal that runs this page); a code works once, for 10 minutes"); }
    const miss = (why: string) => { if (++held.tries >= CODE_TRIES) codes.delete(key); return new Error(why); };
    if (!timingSafeEqual(held.hash, sha(`${key}:${typeof given === "string" ? given.trim() : ""}`))) throw miss("the verification code is not the one shown in the terminal");
    if (!also()) throw miss(alsoWhy);
    codes.delete(key);
  };

  app.get("/", (_req, res) => { csp(res); res.type("html").send(PAGE(issue())); });

  app.get("/api/payables/invoices", (_req, res) => { res.json(apInvoices(db)); });
  app.get("/api/payables/invoices/:id", (req, res) => {
    const inv = apInvoice(db, String(req.params.id));
    if (!inv) { res.status(404).json({ error: `no payables invoice ${req.params.id}` }); return; }
    res.json(inv);
  });
  app.get("/api/payables/invoices/:id/document", (req, res) => {
    const inv = apInvoice(db, String(req.params.id));
    const doc = inv && (db.prepare("SELECT path, filename FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string; filename: string } | undefined);
    if (!doc) { res.status(404).json({ error: `no payables invoice ${req.params.id}` }); return; }
    // The document is the supplier's file: it may not run anything or load anything in this origin (red team round 2).
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename.replace(/[^\w.-]+/g, "_")}"`);
    res.type("application/pdf").send(readFileSync(doc.path));
  });
  app.get("/api/payables/insights", (_req, res) => { res.json(insights(db)); });
  app.get("/api/payables/export/journal.csv", (_req, res) => { res.type("text/csv").setHeader("Content-Disposition", 'attachment; filename="payables-journal.csv"'); res.send(journalCsv(apJournal(db))); });
  app.get("/api/payables/export/invoices.csv", (_req, res) => { res.type("text/csv").setHeader("Content-Disposition", 'attachment; filename="payables-invoices.csv"'); res.send(invoicesCsv(apInvoices(db))); });

  app.post("/api/payables/documents", express.raw({ type: () => true, limit: "16mb" }), async (req: Request, res: Response) => {
    try {
      let filename: string;
      try { filename = decodeURIComponent(String(req.headers["x-filename"] ?? "upload.pdf")).slice(0, 200); } catch {
        res.status(400).json({ error: "the file name is not valid percent-encoding; nothing was filed" });
        return;
      }
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.json(await ingestDocument(db, deps(), { bytes, filename, source: "upload" }));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/payables/invoices/:id/pay", async (req, res) => {
    if (!opts.rail) { res.status(503).json({ error: "Airwallex sandbox keys are not set; the payment cannot be planned" }); return; }
    try {
      const id = String(req.params.id);
      const out = await payApInvoice(db, opts.rail, id, new Date(), opts.inbox.reader);
      res.json(out.kind === "proposed" ? { kind: "proposed", proposal_id: out.proposal.proposal_id, invoice: apInvoice(db, id) } : { kind: "escalated", reason: out.reason, invoice: apInvoice(db, id) });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/payables/invoices/:id/supplier-request", (req, res) => {
    try { res.json(requestPayeeAddForInvoice(db, String(req.params.id), "human")); } catch (e) { fail(res, e); }
  });
  app.post("/api/payables/suppliers/:addId/verify-code", (req, res) => {
    const addId = String(req.params.addId);
    const add = db.prepare("SELECT vendor, status FROM payee_adds WHERE add_id = ?").get(addId) as { vendor: string; status: string } | undefined;
    if (!add) { res.status(404).json({ error: `no supplier request ${addId}` }); return; }
    if (add.status !== "REQUESTED") { res.status(409).json({ error: `${addId} is ${add.status.toLowerCase()}, not waiting for a verification` }); return; }
    const code = issueCode(`verify:${addId}`);
    notify(`Payables: the verification code for ${addId} (${add.vendor}) is ${code}. Type it on the page with the last four characters of the IBAN you checked with the supplier. It works once, for 10 minutes.`);
    res.json({ ok: true, shown: "in the terminal that runs this page" });
  });
  app.post("/api/payables/suppliers/:addId/verify", express.json({ limit: "10kb" }), (req, res) => {
    try {
      const b = (req.body ?? {}) as { by?: unknown; how?: unknown; street?: unknown; city?: unknown; postcode?: unknown; code?: unknown; iban_last4?: unknown };
      const s = (v: unknown) => (typeof v === "string" ? v : "");
      const addId = String(req.params.addId);
      // The person proves they are at this terminal (the code) and read the bank details back (the IBAN's last four).
      const add = db.prepare("SELECT iban FROM payee_adds WHERE add_id = ?").get(addId) as { iban: string } | undefined;
      takeCode(`verify:${addId}`, b.code, () => !!add && s(b.iban_last4).replace(/\s+/g, "").toUpperCase() === add.iban.replace(/\s+/g, "").toUpperCase().slice(-4),
        "the last four characters of the IBAN are not those of this request: check the bank details with the supplier again");
      res.json(recordPayeeAddVerification(db, addId, { by: s(b.by), how: s(b.how), actor: "human", address: { street: s(b.street), city: s(b.city), postcode: s(b.postcode) } }));
    } catch (e) { fail(res, e); }
  });
  // "Not a duplicate": the same supplier and total as an earlier invoice under another number (monthly rent). A person
  // at this terminal clears it once; a match on the invoice number itself is never cleared (clearPossibleDuplicate).
  app.post("/api/payables/invoices/:id/not-duplicate-code", (req, res) => {
    const id = String(req.params.id);
    const inv = apInvoice(db, id);
    if (!inv) { res.status(404).json({ error: `no payables invoice ${id}` }); return; }
    const code = issueCode(`dup:${id}`);
    notify(`Payables: the code to clear ${id} (${inv.vendor} ${inv.invoice_no}, ${inv.currency} ${inv.total}) as not a duplicate is ${code}. It works once, for 10 minutes.`);
    res.json({ ok: true, shown: "in the terminal that runs this page" });
  });
  app.post("/api/payables/invoices/:id/not-duplicate", express.json({ limit: "10kb" }), async (req, res) => {
    try {
      const b = (req.body ?? {}) as { by?: unknown; note?: unknown; code?: unknown };
      const s = (v: unknown) => (typeof v === "string" ? v : "");
      const id = String(req.params.id);
      takeCode(`dup:${id}`, b.code, () => true, "");
      res.json(await clearPossibleDuplicate(db, opts.inbox, id, { by: s(b.by), note: s(b.note), actor: "human" }));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/payables/suppliers/:addId/propose", (req, res) => {
    try { res.json(proposePayeeAdd(db, String(req.params.addId), "human")); } catch (e) { fail(res, e); }
  });
  app.post("/api/payables/sync", async (_req, res) => {
    try {
      const paid = await syncPayments(db, opts.inbox);
      const checked = await recheck(db, opts.inbox);
      res.json({ changed: [...paid, ...checked.filter((x) => x.status !== "needs_vendor")].map((x) => ({ id: x.id, status: x.status })) });
    } catch (e) { fail(res, e); }
  });
  return app;
}
