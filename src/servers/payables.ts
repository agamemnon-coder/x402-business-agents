// Payables: the local pages (npm run payables, 127.0.0.1: the overview at /, one invoice at /invoices/:id, built in
// src/servers/payablesPage.ts) and their JSON routes under /api/payables. The pages render everything from the JSON
// with textContent, never as HTML, and run only the script carrying the response's nonce. Like the approvals page: a loopback Host only, and a post
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
import { invoiceDetail } from "../ap/detail.js";
import { insights } from "../ap/insights.js";
import { payApInvoice, rejectApInvoice, syncPayments } from "../ap/pay.js";
import { publicInvoice } from "../ap/public.js";
import { apInvoice, apInvoices } from "../ap/store.js";
import { proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import type { DB } from "../db/open.js";
import { FONT, PDFJS, detailPage, overviewPage } from "./payablesPage.js";

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


function statusFor(message: string): number {
  if (/^no (payables invoice|supplier request) /.test(message)) return 404;
  if (/not a PDF|larger than|not an IBAN|not a BIC|checksum|needs a name|say how|say who|say why|address/.test(message)) return 400;
  if (/not ready|not waiting|already|German \(DE\)|looks like|on file|not verified|pays EUR only|never cleared|waits for the CFO/.test(message)) return 409;
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
  /** A page's policy: only the script with this response's nonce, and pdf.js from this origin (the document viewer). */
  const pageCsp = (res: Response): string => {
    const nonce = randomBytes(18).toString("base64");
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data: blob:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`);
    return nonce;
  };
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

  app.get("/", (_req, res) => { const nonce = pageCsp(res); res.type("html").send(overviewPage(issue(), nonce)); });
  app.get("/invoices/:id", (req, res) => {
    const id = String(req.params.id);
    if (!apInvoice(db, id)) { res.status(404).type("text/plain").send(`no payables invoice ${id}`); return; }
    const nonce = pageCsp(res);
    res.type("html").send(detailPage(issue(), nonce, id));
  });
  // The pages' own files: the font, and pdf.js for the document viewer (it draws the supplier's PDF on a canvas, without eval).
  app.get("/assets/inter.woff2", (_req, res) => { res.setHeader("Cache-Control", "private, max-age=86400"); res.type("font/woff2").send(FONT); });
  app.get("/assets/pdfjs.mjs", (_req, res) => { res.setHeader("Cache-Control", "private, max-age=86400"); res.type("text/javascript").send(PDFJS); });

  app.get("/api/payables/invoices", (_req, res) => { res.json(apInvoices(db).map(publicInvoice)); });
  app.get("/api/payables/invoices/:id", (req, res) => {
    const inv = apInvoice(db, String(req.params.id));
    if (!inv) { res.status(404).json({ error: `no payables invoice ${req.params.id}` }); return; }
    res.json(publicInvoice(inv));
  });
  app.get("/api/payables/invoices/:id/detail", async (req, res) => {
    try {
      const d = await invoiceDetail(db, String(req.params.id));
      if (!d) { res.status(404).json({ error: `no payables invoice ${req.params.id}` }); return; }
      res.json(d);
    } catch (e) { fail(res, e); }
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
      res.json(out.kind === "proposed" ? { kind: "proposed", proposal_id: out.proposal.proposal_id, invoice: publicInvoice(apInvoice(db, id)!) } : { kind: "escalated", reason: out.reason, invoice: publicInvoice(apInvoice(db, id)!) });
    } catch (e) { fail(res, e); }
  });
  // A person rejects the invoice: it is never paid. Never one filed for the CFO (that is decided on the phone) or paid.
  app.post("/api/payables/invoices/:id/reject", express.json({ limit: "10kb" }), async (req, res) => {
    try {
      const b = (req.body ?? {}) as { reason?: unknown };
      const id = String(req.params.id);
      await rejectApInvoice(db, id, typeof b.reason === "string" ? b.reason : "", opts.inbox, opts.inbox.now?.() ?? new Date());
      res.json(publicInvoice(apInvoice(db, id)!));
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
