// The hands-on page (/try) in Chromium, on this machine. Lane C's try routes are not merged yet: this check's server
// stands in for them, in this file only, on top of a real cloud with an engine in this process (cloud/src/engine/node.ts),
// served on localhost so that Chromium's virtual passkey authenticator makes passkeys the engine verifies. Two parts:
// 1. A visit at 390 px light and one at 1440 px dark: start, an invoice, the engine at work, the result; then the
//    approval passkey made (virtual authenticator), the exact terms approved (held), the amount changed by one cent and
//    refused with both layers, the signed terms put back and paid. One main button per screen, focus on the heading,
//    nothing wider than the screen, no console or CSP error; a reload returns to the result; the pay step's answer is
//    held 800 ms and nothing of the outcome is on the page before it. Screenshots when a directory is given.
// 2. The poller with Chromium's stand-in clock and stubbed answers: the cadence (every second in flight, once more a
//    second after), a 401 stops it and renews once, a hidden page makes no request at all, and on coming back the
//    session is renewed before the next poll.
// npx tsx test/browser/try.check.ts [screenshot dir]
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page, Route } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import type { LiveFxSource } from "../../cloud/src/engine/liveFx.js";
import { recordedQuote } from "../../src/try/examples.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { CLOUD_URL, DID } from "../../cloud/src/try/books.js";
import { SyncBatch } from "../../cloud/src/sync.js";
import { FINISH_LINKS, VERIFY_YOURSELF } from "../../cloud/src/tryCopy.js";
import { SCRIPT, TRACE } from "../../cloud/src/tryCopy.js";
import { WORST_CASE_LINE } from "../../src/evals/worstCase.js";
import { APPROVE, BAND, BOOKS, INBOX, FX_HOLD, WORK_CHECKS, COMPANY, ENDED, FX_CARD, GONE, GUIDE, PAYOUT_CARD, INVOICE, LIVE, PAY, RUN, START, STEPS, TAMPER, WORK } from "../../cloud/src/tryCopy.js";
import { PROOF_URL, RUNS_URL, VERIFY_URL } from "../../cloud/src/tryPage.js";
import { SAMPLES as GEN_SAMPLES } from "../../cloud/src/engine/samples.gen.js";
import { batchesFor } from "../../src/cloudsync/client.js";
import { recordsPdf } from "../../src/engine/recordsPdf.js";
import { FILM_URL, TRAILER_URL } from "../../src/config/brand.js";
import type { DB } from "../../src/db/open.js";
import { EngineHost } from "../../src/engine/host.js";
import { termsHash, type Terms } from "../../src/lib/terms.js";
import { softPasskey } from "../../src/metal/softPasskey.js";
import { liveRuns } from "../../src/redesign/runs.js";
import { EN } from "../fakes/apInvoices.js";
import { negotiateClaudeOf } from "../../cloud/src/try/negotiateRoutes.js";
import { NEG_COPY } from "../../cloud/src/try/negotiateKit.js";
import { CHANGED_IBAN, type AgentAnswer } from "../../src/negotiate/negotiate.js";
import { pdfOf } from "../fakes/pdf.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8890 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "try-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

// The cloud with an engine per company, on this machine's origin; the passkey's relying party is "localhost".
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "try-check-"));
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "t".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  // 15 Nov: the hands-on routes on (part 1n's real start and POST /v1/try/negotiate); parts 0 to 2 keep their stand-ins.
  tryIt: { claude: false },
};
// 14 Nov: /try's live FX quote (cloud/src/engine/liveFx.ts). No network here: kit11's AwxFx entrypoint is stood in for by
// a source that answers with the main run's recorded Airwallex sandbox quote id and rate (src/try/examples.ts), for
// exactly the amount asked, valid 15 minutes. It is a check's stand-in, not a live quote. fxDown: it answers unavailable.
const REC_FX = recordedQuote();
const fxStand = { down: false, asked: 0 };
const fxSource: LiveFxSource = {
  quote: async (a) => {
    fxStand.asked++;
    if (fxStand.down) return { ok: false, reason: "unavailable" };
    const sell = (Math.ceil(Number(a.buyAmount) * Number(REC_FX.client_rate) * 100) / 100).toFixed(2);
    return { ok: true, quote: { quote_id: REC_FX.quote_id, buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: a.buyAmount, sell_amount: sell, client_rate: REC_FX.client_rate, valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() }, market_rate: REC_FX.client_rate };
  },
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN, liveFx: { source: fxSource, allowed: async () => true } });
const cloud = async (method: string, path: string, key: string | null, body?: unknown) => {
  const r = await handle(new Request(`${ORIGIN}${path}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  return { status: r.status, json };
};
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
/** A visitor's company: made by the platform, its owner's passkey enrolled (a soft passkey) and signed in, in English. */
interface Visitor { id: string; session: string }
async function company(slug: string): Promise<Visitor> {
  const made = await cloud("POST", "/v1/admin/tenants", ADMIN, { slug, name: `${slug} test company`, owner: { display_name: "Owner" } });
  const id = (made.json.tenant as { id: string }).id, starter = made.json.api_key as string, owner = (made.json.owner as { id: string }).id;
  const pk = softPasskey();
  const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const e = await cloud("POST", `/v1/users/${owner}/enrolment`, starter);
  const ea = pk.assert("0x00", { challenge: e.json.token as string, origin: ORIGIN, rpId: "localhost" });
  await cloud("POST", "/v1/auth/enrol", null, { tenant: slug, enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id,
    x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url"),
    assertion: { authenticatorData: b64u(ea.authenticatorData), clientDataJSON: b64u(ea.clientDataJSON), signature: b64u(ea.signature) } });
  const ch = await cloud("POST", "/v1/auth/challenge", null, { tenant: slug });
  const la = pk.assert("0x00", { challenge: ch.json.challenge as string, origin: ORIGIN, rpId: "localhost" });
  const s = await cloud("POST", "/v1/auth/login", null, { tenant: slug, challenge_id: ch.json.challenge_id, credential_id,
    assertion: { authenticatorData: b64u(la.authenticatorData), clientDataJSON: b64u(la.clientDataJSON), signature: b64u(la.signature) } });
  const session = s.json.session as string;
  await cloud("POST", "/v1/company", session, { language: "en" });
  return { id, session };
}

const visitors = new Map<string, Visitor>();
let made = 0;
const SUPPLIER = { key: "bergtex", name: "Bergtex Textil GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX" };
// With the engine's own rows and measured outcomes (cloud/src/engine/samples.gen.ts), as GET /v1/engine/samples gives them (14 Nov, inbox table).
const GEN = (k: string) => { const g = GEN_SAMPLES.find((x) => x.key === k)!; return { row: g.row, expect: g.expect }; };
const SAMPLES = [{ key: "clean", title: "A clean invoice from a supplier on file", ...GEN("clean") }, { key: "again", title: "The same file again", ...GEN("again") }];
const clean = await pdfOf(EN);
const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** An invoice as the compose route would write it: Bergtex's layout with the visitor's number, amount, dates and IBAN. */
const composed = (b: Record<string, string>) => {
  const total = Number(b.amount), net = Math.round((total / 1.19) * 100) / 100, vat = Math.round((total - net) * 100) / 100;
  const eur = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pdfOf([SUPPLIER.name, "Textilweg 4, 72760 Reutlingen", "VAT ID: DE123456789", `INVOICE ${b.invoice_no}`, `Invoice date: ${long(b.issue_date!)}`, `Due date: ${long(b.due_date!)}`,
    `Subtotal EUR ${eur(net)}`, `VAT 19% EUR ${eur(vat)}`, `Total due EUR ${eur(total)}`, `IBAN: ${b.iban!.replace(/(.{4})/g, "$1 ").trim()}`, `BIC: ${SUPPLIER.bic}`, `Payment reference: ${b.invoice_no}`].join("\n"));
};
const send = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const upload = async (session: string, bytes: Buffer, filename: string) => cloud("POST", "/v1/engine/documents", session, { filename, mime: "application/pdf", base64: bytes.toString("base64") });

// The engine's own ledger, reached through the engine handle in this process: each company's database, found when the
// engine reads one of its proposals (GET /v1/engine/proposals/{id} runs EngineHost.proposal; ledgerOf reads it right
// after, so the database is that company's although proposal ids repeat across companies).
const ledgers = new Map<string, DB>();
const proposalOf = EngineHost.prototype.proposal;
EngineHost.prototype.proposal = function (this: EngineHost, id: string) {
  ledgers.set(id, (this as unknown as { deps: { db: DB } }).deps.db);
  return proposalOf.call(this, id);
};
/** Each visitor's engine database, by session, once one of its proposals was read (for the export's stand-in). */
const dbOf = new Map<string, DB>();
/** The proposal's exact terms as the engine holds them, and the count of the stand-in bank's transfers, read from its ledger. */
async function ledgerOf(session: string, id: string) {
  const p = await cloud("GET", `/v1/engine/proposals/${encodeURIComponent(id)}`, session);
  if (p.status !== 200) return null;
  const db = ledgers.get(id)!;
  dbOf.set(session, db);
  const row = db.prepare("SELECT terms_json, terms_sha256, status FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string; terms_sha256: string; status: string };
  const transfers = () => (db.prepare("SELECT COUNT(*) AS n FROM transfers").get() as { n: number }).n;
  return { terms: JSON.parse(row.terms_json) as Terms, terms_sha256: row.terms_sha256, status: row.status, transfers };
}

// Lane C's approve-held, terms and pay routes, stood in for here until try-core-1112 merges. Approve keeps the
// signature and answers held (it verifies nothing itself, and the engine pays nothing). Terms answers the engine's own
// terms and hash. Pay: terms whose canonical hash is not the signed one are refused by both layers and nothing moves;
// the signed terms go to the engine's real approve with the signature the browser sent, which verifies it and pays on
// the stand-in bank. The pay answer is held payDelay ms (the 800 ms test).
const kept = new Map<string, unknown>();
const paid = new Set<string>();
// finishDelay, statusDelay, approveDelay hold the passkey's finish, GET /v1/engine and the approval (screen 3's labels).
const stand = { realStart: false, payDelay: 0, payAnswers: 0, fileDelay: 0, refuseCompose: false, suppliersDelay: 0, samplesDelay: 0, samplesFail: 0, finishDelay: 0, statusDelay: 0, approveDelay: 0 };
async function laneC(method: string, path: string, session: string, body: Record<string, unknown>, res: ServerResponse): Promise<boolean> {
  const m = /^\/v1\/engine\/proposals\/([A-Za-z0-9_-]+)\/(approve|terms|pay)$/.exec(path);
  if (!m) return false;
  const [, id, what] = m as unknown as [string, string, string];
  if (method === "POST" && what === "approve") {
    if (!body.credential || typeof body.terms_sha256 !== "string") { send(res, 400, { error: "terms_sha256 and credential are required" }); return true; }
    if (stand.approveDelay) await new Promise((r) => setTimeout(r, stand.approveDelay));
    kept.set(`${session} ${id}`, body.credential);
    send(res, 200, { status: "approved", message: `${id} is approved and held: nothing is paid until it is paid with this signature.`, settled: null, held: true });
    return true;
  }
  const L = await ledgerOf(session, id);
  if (!L) { send(res, 404, { error: "no proposal" }); return true; }
  if (method === "GET" && what === "terms") {
    const { canonicalTerms } = await import("../../src/lib/terms.js");
    // The note on the terms' FX quote, as the engine gives it (cloud/src/engine/liveFx.ts).
    const tenant = visitors.get(session)?.id;
    const real = tenant ? await env.engine!(tenant).terms(id) : null;
    send(res, 200, { proposal_id: id, status: L.status, terms: L.terms, canonical: canonicalTerms(L.terms), terms_sha256: L.terms_sha256, approved: kept.has(`${session} ${id}`), expires_at: L.terms.expires_at, ...(real?.fx_quote ? { fx_quote: real.fx_quote } : {}), ...(real?.fx_limit_bps ? { fx_limit_bps: real.fx_limit_bps } : {}) });
    return true;
  }
  if (method !== "POST" || what !== "pay") return false;
  if (stand.payDelay) await new Promise((r) => setTimeout(r, stand.payDelay));
  stand.payAnswers++;
  const sent = body.terms as Terms;
  const sentSha = (() => { try { return termsHash(sent); } catch { return createHash("sha256").update(JSON.stringify(sent ?? null)).digest("hex"); } })();
  const before = L.transfers();
  const base = { signed_sha256: L.terms_sha256, sent_sha256: sentSha, transfers_before: before, sandbox_calls: 0, request_id: `req_${randomUUID()}` };
  if (!body.credential) { send(res, 200, { ...base, outcome: "not_signed", layers: { signature: { verified: false, reason: "No signature was sent." }, executor: { accepted: null, said: "" } }, changed: [], transfers_after: before, settled: null }); return true; }
  if (sentSha !== L.terms_sha256) {
    const changed = Object.keys({ ...L.terms, ...(sent ?? {}) }).filter((k) => JSON.stringify((L.terms as Record<string, unknown>)[k]) !== JSON.stringify((sent as Record<string, unknown> | null)?.[k]))
      .map((field) => ({ field, from: (L.terms as Record<string, unknown>)[field], to: (sent as Record<string, unknown> | null)?.[field] }));
    send(res, 200, { ...base, outcome: "refused", layers: { signature: { verified: false, reason: "The signature is over other terms than the ones sent." },
      executor: { accepted: false, said: "the terms in this payment do not hash to the approved terms; nothing was paid" } }, changed, transfers_after: L.transfers(), settled: null });
    return true;
  }
  if (paid.has(`${session} ${id}`)) { send(res, 200, { ...base, outcome: "paid_once", layers: { signature: { verified: true, reason: "" }, executor: { accepted: true, said: "" } }, changed: [], transfers_after: L.transfers(), settled: null }); return true; }
  const a = await cloud("POST", `/v1/engine/proposals/${encodeURIComponent(id)}/approve`, session, { terms_sha256: L.terms_sha256, credential: body.credential });
  if (a.json.status === "approved") paid.add(`${session} ${id}`);
  // 14 Nov (step 2): the Paid step's Airwallex card, drawn from a stand-in note: the 10 Nov run's recorded sandbox
  // transfer id (docs/runs/2026-11-10-airwallex-two-locks.md) and its recorded status, for this payment's own amount and
  // hash. A check's stand-in, not a live transfer (cloud/src/engine/livePayout.ts makes the real one).
  const awx = a.json.status === "approved" ? { airwallex_payout: { source: "airwallex-sandbox", transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: (L.terms as { amount?: string }).amount, currency: (L.terms as { currency?: string }).currency, request_id: "stand-in", terms_sha256: L.terms_sha256 } } : {};
  send(res, 200, { ...base, ...awx, outcome: a.json.status === "approved" ? "paid" : "refused", changed: [], transfers_after: L.transfers(), settled: a.json.settled ?? null,
    layers: a.json.status === "approved" ? { signature: { verified: true, reason: "" }, executor: { accepted: true, said: "" } } : { signature: { verified: false, reason: String(a.json.message ?? "") }, executor: { accepted: false, said: "" } } });
  return true;
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = new URL(req.url ?? "/", ORIGIN);
  const session = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const json = () => JSON.parse(body?.toString() ?? "{}") as Record<string, string>;
  // Lane C's routes, stood in for here only.
  // Part 1n: the hands-on deployment's own routes, every one (no stand-in), streamed as a Worker sends them.
  if (stand.realStart) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers, ...(body ? { body } : {}) }), env);
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h);
    if (r.body) { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(Buffer.from(value)); } }
    return res.end();
  }
  if (req.method === "POST" && url.pathname === "/v1/try/start") {
    const t = await company(`visitor-${++made}`);
    visitors.set(t.session, t);
    return send(res, 201, { tenant: t.id, session: t.session, visitor_token: `vt-${made}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), company: { name: "Test company" }, pool: "public", mode: { claude: "code", agents: "code", rail_awx: "off" } });
  }
  if (req.method === "POST" && url.pathname === "/v1/try/session") {
    const t = [...visitors.values()].find((v) => v.id === json().tenant_id);
    return t ? send(res, 200, { session: t.session, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }) : send(res, 410, { code: "gone", message: "gone" });
  }
  if (req.method === "GET" && url.pathname === "/v1/engine/samples") {
    // H3: held samplesDelay ms (the queued tap's check); samplesFail answers that many 503s first (the Retry's check).
    if (stand.samplesDelay) await new Promise((r) => setTimeout(r, stand.samplesDelay));
    if (stand.samplesFail) { stand.samplesFail--; return send(res, 503, { error: "busy" }); }
    return send(res, 200, { items: SAMPLES });
  }
  if (req.method === "GET" && url.pathname === "/v1/engine/suppliers") {
    if (stand.suppliersDelay) await new Promise((r) => setTimeout(r, stand.suppliersDelay));
    return send(res, 200, { items: [SUPPLIER] });
  }
  const sample = /^\/v1\/engine\/samples\/([a-z]+)$/.exec(url.pathname);
  // Filing a sample or a written invoice is held fileDelay ms (the skeleton's check); refuseCompose answers one 400.
  if (req.method === "POST" && (sample || url.pathname === "/v1/engine/compose") && stand.fileDelay) await new Promise((r) => setTimeout(r, stand.fileDelay));
  if (req.method === "POST" && sample) { const r = await upload(session, clean, `${sample[1]}.pdf`); return send(res, r.status, r.json); }
  if (req.method === "POST" && url.pathname === "/v1/engine/compose" && stand.refuseCompose) { stand.refuseCompose = false; return send(res, 400, { error: "invalid", message: "amount is in euros with two decimals, such as 1850.00" }); }
  if (req.method === "POST" && url.pathname === "/v1/engine/compose") { const b = json(); const r = await upload(session, await composed(b), `${b.invoice_no}.pdf`); return send(res, r.status, r.json); }
  if (req.method === "POST" && url.pathname === "/v1/engine/passkey/finish" && stand.finishDelay) await new Promise((r) => setTimeout(r, stand.finishDelay));
  if (req.method === "GET" && url.pathname === "/v1/engine" && stand.statusDelay) await new Promise((r) => setTimeout(r, stand.statusDelay));
  if (await laneC(req.method ?? "GET", url.pathname, session, body ? JSON.parse(body.toString()) as Record<string, unknown> : {}, res)) return;
  if (req.method === "GET" && url.pathname === "/v1/engine/export.pdf") {
    // The records as a PDF (14 Nov), built by the engine's own renderer from the same batches.
    const db = dbOf.get(session);
    if (!db) return send(res, 404, { error: "no company" });
    const pdf = await recordsPdf({ format: "purser.cloud-sync/v1", company: "Try check company (test)", made_at: new Date().toISOString(), batches: batchesFor(db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }) }, `${ORIGIN}/try?v=1`);
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="purser-test-company-records.pdf"' });
    return res.end(pdf);
  }
  if (req.method === "GET" && url.pathname === "/v1/engine/export") {
    // Lane C's export, stood in for here: the company in the product's sync format (src/cloudsync/client.ts batchesFor,
    // what the engine feeds the read model with), every batch in one, as a JSON file.
    const db = dbOf.get(session);
    if (!db) return send(res, 404, { error: "no company" });
    const all: Record<string, unknown[]> = {};
    for (const b of batchesFor(db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] })) for (const [k, v] of Object.entries(b)) if (Array.isArray(v)) all[k] = [...(all[k] ?? []), ...v];
    res.writeHead(200, { "content-type": "application/json", "content-disposition": 'attachment; filename="purser-test-company.json"' });
    return res.end(JSON.stringify(all));
  }
  // Everything else is the cloud's own answer.
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(body ? { body } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/** The things every screen must hold: one main button (main: how many; screen 5 has none until B3), no overflow, focus on the heading. */
async function screenChecks(page: Page, name: string, width: number, main = 1, focus = true) {
  ok(await page.locator(".btn.primary:visible").count() === main, `${name}: ${main === 1 ? "exactly one main button" : `${main} main buttons`}`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${name}: nothing wider than ${width} px`);
  if (focus) ok(await page.evaluate(() => document.activeElement?.tagName === "H1" || document.activeElement?.classList.contains("primary")), `${name}: focus on the heading (or on the main button an answer just drew)`);
  const hits = await overlaps(page);
  ok(hits.length === 0, `${name}: no two blocks overlap${hits.length ? ` (${hits.slice(0, 3).join(" | ")})` : ""}`);
}
/**
 * 15 Nov polish (Max: "no overlapping elements at 1024, 1440 or 390 px"): every two visible blocks on the screen (headings,
 * paragraphs, list rows, terms, buttons, cards, the step bar, folds) that are not one inside the other must not
 * intersect by more than 2 px either way. Fixed and sticky things (the site header) and what a closed fold hides are
 * left out.
 */
// (A string, not a function: the check's own compiler would wrap inner functions in helpers the page does not have.)
const OVERLAPS = `(async () => {
  // Entrance animations (a translate on the way in) settle first; endless ones (a glowing step) are left as they are.
  await Promise.all(document.getAnimations().filter((a) => { const t = a.effect && a.effect.getTiming(); return t && t.iterations !== Infinity; }).map((a) => a.finished.catch(() => null)));
  const sel = ".screen :is(h1,h2,h3,p,li,dt,dd,button,a.btn,.card,.vflow,details,summary,table,dl,figure,pre,input,select,textarea,label)";
  const fixed = (e) => { for (let n = e; n; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return true; } return false; };
  const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); const host = e.tagName === "SUMMARY" ? e.parentElement : e; if (host && host.parentElement && host.parentElement.closest("details:not([open])")) return false; const shut = e.closest("details:not([open])"); if (shut && shut !== e && !(e.tagName === "SUMMARY" && e.parentElement === shut)) return false; return r.width > 2 && r.height > 2 && st.visibility !== "hidden" && st.display !== "none" && !fixed(e); });
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "") + '"' + (e.textContent || "").trim().slice(0, 24) + '"';
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.contains(b) || b.contains(a)) continue;
    const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
    if (w > 2 && h > 2) out.push(name(a) + " x " + name(b) + " (" + Math.round(w) + "x" + Math.round(h) + ")");
  }
  return out;
})()`;
const overlaps = (page: Page) => page.evaluate(OVERLAPS) as Promise<string[]>;
/** The page's kept state in this tab. */
const keptState = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("purser.try") ?? "{}") as Record<string, unknown>);
/** A context with Chromium's virtual passkey authenticator (the platform kind, with user verification). */
async function passkeyContext(width: number, scheme: "light" | "dark"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
  return ctx;
}

// Part 0: the start screen (14 Nov, owner: enterprise-grade) at a phone and a laptop, light and dark: the eyebrow, the
// headline, the three steps and the one-cent refusal, the button and the trailer link in view without scrolling, the
// partners' logos loaded (the official files) with "No endorsement implied"; one column on a phone, the steps beside the
// words on a laptop; nothing wider than the screen, the feather mark, no console or CSP error. Screenshots (the viewport)
// when a directory is given: try-start-<width>-<scheme>.png.
for (const [width, height, scheme] of [[390, 844, "light"], [390, 844, "dark"], [1440, 900, "light"], [1440, 900, "dark"]] as const) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = `start ${width}x${height} ${scheme}`;
  await page.goto(`${ORIGIN}/try?v=1`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  await page.waitForTimeout(900);
  const box = (sel: string) => page.locator(sel).first().boundingBox();
  const [h1, flow, main, trailer, partners] = [await box("main > h1"), await box(".start .flow"), await box("#main .btn.primary"), await box(".start .trailer"), await box(".start .partners")];
  ok(!!h1 && !!flow && !!main && !!trailer && !!partners, `${tag}: the headline, the steps, the button, the trailer link and the partners are shown`);
  ok(await page.locator(".start .flow li").count() === 4 && (await page.textContent(".start .fend"))!.includes(START.flowEnd), `${tag}: three steps and the one-cent refusal`);
  if (h1 && flow && main && trailer) {
    ok(main.y + main.height <= height && trailer.y + trailer.height <= height, `${tag}: the button and the trailer link are in view without scrolling`);
    if (width === 390) ok(flow.y > h1.y + h1.height - 1 && main.y > flow.y + flow.height - 1, `${tag}: a phone: one column, the headline, the steps, then the button`);
    else ok(flow.x >= h1.x + h1.width - 1 && flow.y < main.y + main.height && partners!.y + partners!.height <= height + 1, `${tag}: a laptop: the steps beside the words, the partners in view`);
  }
  const logos = await page.locator(".start .logos img").evaluateAll((im) => im.map((i) => [(i as HTMLImageElement).alt, (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0]));
  ok(JSON.stringify(logos) === JSON.stringify([["Alta (formerly Metal)", true], ["Claude", true]]), `${tag}: the partners' logos are loaded (${JSON.stringify(logos)})`);
  const ptext = (await page.textContent(".start .partners"))!;
  ok(ptext.includes(`Alta${START.formerly}`) || ptext.includes(START.formerly) && ptext.includes(START.visa) && ptext.includes("No endorsement implied"), `${tag}: Alta (formerly Metal), Visa in text, no endorsement implied`);
  ok(await page.getAttribute(".start .trailer", "href") === TRAILER_URL, `${tag}: the trailer link`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${tag}: nothing wider than ${width} px`);
  ok(await page.locator(".brand .mk svg").count() === 1 && (await page.textContent(".brand"))!.trim() === "Purser", `${tag}: the brand is the feather mark and the name`);
  if (shots) { await page.waitForTimeout(2600); await page.screenshot({ path: join(shots, `try-start-${width}-${scheme}.png`) }); }
  ok(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}
{
  // With reduced motion the start stands still, the refusal in sight.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/try?v=1`);
  await page.waitForSelector(".start .flow");
  const still = await page.evaluate(() => [...document.querySelectorAll(".start *")].every((e) => getComputedStyle(e).animationName === "none")
    && getComputedStyle(document.querySelector(".start .fend")!).opacity === "1");
  ok(still, "reduced motion: the start does not move, and shows the refusal");
  await ctx.close();
}

// Part 0b (H3, 12 Nov): the samples are slow (held 800 ms). Screen 1 is drawn at once; the button is off and the cards a
// skeleton while they are held; a tap meanwhile is kept and files the first sample once they arrive. Then a failed read:
// calm words and Retry, which reads them again.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const filed: string[] = [];
  const order: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (r.method() === "POST" && u.pathname.startsWith("/v1/engine/samples/")) { filed.push(u.pathname); order.push("file"); } });
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/v1/engine/samples") order.push("samples"); });
  await page.goto(`${ORIGIN}/try?v=1`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  stand.samplesDelay = 800;
  const t0 = Date.now();
  await page.click(`text=${START.button}`);
  await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
  const send = page.locator(`.btn.primary:has-text("${INVOICE.send}")`);
  const off = await send.getAttribute("aria-disabled") === "true" && await page.locator(".samples .btn.skel").count() === 5 && await page.locator(".samples .btn:not(.skel)").count() === 0;
  ok(off, `H3: while the samples are held: screen 1 is drawn, the button is off and the cards a skeleton (${Date.now() - t0} ms after the click)`);
  order.push("tap");
  await send.click();
  await page.waitForSelector(`h1:text-is("${WORK.heading}")`, { timeout: 15_000 });
  ok(order.join(" ") === "tap samples file", `H3: the tap came while they were held and filed nothing until they arrived (${order.join(" ")})`);
  await page.waitForSelector(`h1:text-is("${WORK.heading}")`, { timeout: 15_000 });
  ok(filed.length === 1 && filed[0] === `/v1/engine/samples/${SAMPLES[0]!.key}`, `H3: the kept tap files the first sample once they arrive (${filed.join(", ") || "none"})`);
  stand.samplesDelay = 0;
  // A failed read: calm words and Retry; Retry reads them again and the button comes on.
  stand.samplesFail = 1;
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${ORIGIN}/try?v=1`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  await page.click(`text=${START.button}`);
  await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
  await page.waitForSelector(`.hint.calm:has-text("${INVOICE.failed}")`);
  ok(await send.getAttribute("aria-disabled") === "true" && await page.locator(".note").count() === 0, "H3: a failed read says so calmly (no red box), the button stays off");
  await page.click(`button.link:text-is("${INVOICE.retry}")`);
  await page.waitForSelector(".samples .btn[aria-pressed=true]");
  ok(await send.getAttribute("aria-disabled") === null, "H3: Retry reads them again; the first sample is picked and the button is on");
  // The one 503 asked for above is the browser's own log line of a failed read; anything else counts.
  const other = errors.filter((e) => !/status of 503/.test(e));
  ok(other.length === 0 && errors.length <= 1, `H3: no console or CSP errors but the one held 503${other.length ? `: ${other.join(" | ")}` : ""}`);
  stand.samplesFail = 0;
  await ctx.close();
}

// Part 1: a visit at each size.
// 15 Nov polish: 1024 px light as well (Max: "no overlapping elements at 1024, 1440 or 390 px").
for (const [width, scheme] of [[390, "light"], [1024, "light"], [1440, "dark"]] as const) {
  const ctx = await passkeyContext(width, scheme);
  const page = await ctx.newPage();
  // The blobs the page makes, kept here so the check can read a file's first bytes (no fetch: the page's policy allows none).
  await page.addInitScript({ content: "window.__blobs=new Map();const mk=URL.createObjectURL.bind(URL);URL.createObjectURL=(b)=>{const u=mk(b);window.__blobs.set(u,b);return u};" });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = `${width} ${scheme}`;
  const shot = async (n: string) => { if (shots) await page.screenshot({ path: join(shots, `b1-${n}-${width}-${scheme}.png`), fullPage: true }); };
  const shot2 = async (n: string) => { if (shots) await page.screenshot({ path: join(shots, `b2-${n}-${width}-${scheme}.png`), fullPage: true }); };
  /** The design pass's screenshots (design-1112): at 390 px the viewport (and the full page when asked), at 1440 px dark only those named. */
  const design = async (n: string, o: { full?: boolean; wide?: boolean } = {}) => {
    if (!shots || (width === 1440 && !o.wide)) return;
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(shots, `try-${n}-${width}-${scheme}.png`) });
    if (o.full) await page.screenshot({ path: join(shots, `try-${n}-${width}-${scheme}-full.png`), fullPage: true });
  };
  await page.goto(`${ORIGIN}/try?v=1#j=jury-token-123`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  ok(new URL(page.url()).hash === "", `${tag}: the token is gone from the address bar`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag}: focus is on the heading`);
  ok(await page.locator(".band").count() === 0, `${tag}: no band before the start`);
  await screenChecks(page, `${tag} screen 0`, width);
  await shot("0-start");
  await design("0-start");

  // Nothing starts a company before the click (not the load, not a hover); right after the start: the engine warmed.
  const asked: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/v1/")) asked.push(`${r.method()} ${u.pathname}`); });
  await page.hover(`text=${START.button}`);
  await page.waitForTimeout(300);
  ok(asked.length === 0, `${tag}: no request on load or hover (${asked.join(", ") || "none"})`);
  // At 1440 the suppliers' answer is held 800 ms: write your own's button stays off until it is in.
  stand.suppliersDelay = width === 1440 ? 800 : 0;
  const startReq = page.waitForRequest((r) => r.url().endsWith("/v1/try/start"));
  await page.click(`text=${START.button}`);
  ok(JSON.parse((await startReq).postData() ?? "{}").token === "jury-token-123", `${tag}: the token goes in the start request's body`);
  await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
  if (width === 1440) {
    await page.click(`text=${INVOICE.tabWrite}`);
    const held = await page.isDisabled(`.btn.primary:has-text("${INVOICE.send}")`) && await page.locator(".f.loading #f-sup").count() === 1 && await page.locator(".f.loading #f-iban").count() === 1;
    ok(held, `${tag}: while the suppliers are held: the button is off, the supplier and the IBAN a skeleton`);
    await page.waitForFunction(() => (document.querySelector("#f-iban") as HTMLInputElement | null)?.value !== "");
    ok(!(await page.isDisabled(`.btn.primary:has-text("${INVOICE.send}")`)) && await page.locator(".f.loading").count() === 0, `${tag}: once the suppliers are in: the button is on, the fields filled`);
    stand.suppliersDelay = 0;
    await page.click(`text=${INVOICE.tabSample}`);
    // These clicks moved focus; the page had put it on the heading (checked next), as show() does.
    await page.focus("h1");
  }
  await page.waitForSelector(".samples .btn");
  const warm = asked.slice(asked.indexOf("POST /v1/try/start") + 1, asked.indexOf("POST /v1/try/start") + 3).sort().join(", ");
  ok(warm === "GET /v1/engine, GET /v1/engine/samples" && asked.filter((x) => x === "GET /v1/engine/samples").length === 1, `${tag}: right after the start: the engine's status and the samples, once (${asked.join(", ")})`);
  ok((await page.textContent(".band"))!.includes(BAND.line) && (await page.textContent(".band"))!.includes(BAND.claudeCode), `${tag}: the band says test company, test money, simulated bank, and Purser's code reads today`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag}: focus moved to the new heading`);
  await screenChecks(page, `${tag} screen 1 (samples)`, width);
  ok(!(await page.isVisible(".start .partners")) && await page.locator(".prog li.on").count() === 1 && /^\d+:\d\d$/.test((await page.textContent(".band .clock"))!.trim()), `${tag}: after the start: no partners row; the rail lights the current step, the run's clock in the band`);
  ok(await page.getAttribute(".band a.same", "href") === `${PROOF_URL}#run-main-1`, `${tag}: "Same step, live" goes to the same step in a live run on /proof`);
  await shot("1-invoice");
  await design("1-invoice");

  if (width === 390) {
    // An amount that is not one: a calm hint under the field on blur, never a red box; the samples tab files after.
    await page.click(`text=${INVOICE.tabWrite}`);
    await page.fill("#f-amt", "12abc");
    await page.locator("#f-amt").blur();
    ok(await page.isVisible(`#f-amt-hint:text-is("${INVOICE.amountBad}")`) && await page.locator(".note").count() === 0 && await page.getAttribute("#f-amt", "aria-invalid") === "true", `${tag}: an amount that is not one: the calm hint under the field, no red box`);
    if (shots) { await page.locator("#f-amt").scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, "try-1-amount-hint-390-light.png") }); }
    await page.click(`text=${INVOICE.tabSample}`);
    ok(await page.getAttribute(`.samples .btn:has-text("${SAMPLES[0]!.title}")`, "aria-pressed") === "true", `${tag}: the first sample is picked`);
    // 14 Nov (inbox table): each row says its supplier, number, amount, due date and the risk the engine measured.
    const rowsTxt = await page.locator(".samples.inbox .btn.row").allInnerTexts();
    ok(rowsTxt.length === 2 && rowsTxt[0]!.includes("Bergtex Textil GmbH") && rowsTxt[0]!.includes("BTX-2026-21") && rowsTxt[0]!.includes("EUR 1,850.00") && rowsTxt[0]!.includes(INBOX.risk.clean!) && rowsTxt[1]!.includes(INBOX.risk.duplicate_document!),
      `${tag}: the samples are an inbox: supplier, number, amount, due and the engine's risk per row (${rowsTxt.map((r) => r.replace(/\s+/g, " ")).join(" | ")})`);
    // The answer held: the card's skeleton (labels only, no amount) under who is reading.
    stand.fileDelay = 2500;
    await page.click(`text=${INVOICE.send}`);
    await page.waitForSelector(".inv.skel");
    const skel = (await page.textContent(".result")) ?? "";
    ok(skel.includes(WORK.readingCode) && ["Supplier", "Invoice number", "Amount", "Due", "Status"].every((k) => skel.includes(k)) && await page.locator(".inv.skel .sk").count() === 5, `${tag}: while the request is held: "${WORK.readingCode}" over the card's five labels with placeholders`);
    ok(!/\d/.test(skel) && !/EUR|Bergtex|Ready/.test(skel), `${tag}: the skeleton holds nothing of the outcome (${skel})`);
    if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: join(shots, "try-2-reading-390-light.png") }); }
    await page.waitForSelector(".inv:not(.skel)", { timeout: 20_000 });
    stand.fileDelay = 0;
    ok(await page.locator(".inv.skel").count() === 0, `${tag}: the skeleton turned into the card when the answer came`);
  } else {
    await page.click(`text=${INVOICE.tabWrite}`);
    await page.waitForFunction(() => (document.querySelector("#f-iban") as HTMLInputElement | null)?.value !== "");
    for (const [typed, want] of [["10.000", "10000.00"], ["€ 10.000,00", "10000.00"], ["EUR 10,000.00", "10000.00"], ["1.850,01", "1850.01"], ["1850.5", "1850.50"], ["10k", "10000.00"]] as const) {
      await page.fill("#f-amt", typed);
      await page.locator("#f-amt").blur();
      ok(await page.inputValue("#f-amt") === want, `${tag}: "${typed}" reads as ${want} on blur`);
    }
    // Past the demo's cap: 10k reads as 10000.00, the calm hint says the cap, and nothing is sent.
    await page.fill("#f-amt", "10k");
    await page.locator("#f-amt").blur();
    let before = asked.length;
    await page.click(`text=${INVOICE.send}`);
    await page.waitForTimeout(300);
    ok(await page.isVisible(`#f-amt-hint:text-is("${INVOICE.amountCap}")`) && await page.inputValue("#f-amt") === "10000.00" && !asked.slice(before).some((x) => x.endsWith("/compose")) && await page.locator(".note").count() === 0,
      `${tag}: "10k": the calm hint "${INVOICE.amountCap}" under the field, no request sent`);
    await page.fill("#f-amt", "-5");
    before = asked.length;
    await page.click(`text=${INVOICE.send}`);
    await page.waitForTimeout(300);
    ok(await page.isVisible("#f-amt-hint") && !asked.slice(before).some((x) => x.endsWith("/compose")), `${tag}: an amount that is not one is not sent, the hint says how to write one`);
    // A compose the server still refuses: its words calmly under the form, the form as it was sent.
    await page.fill("#f-amt", "1k");
    stand.refuseCompose = true;
    await page.click(`text=${INVOICE.send}`);
    await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
    await page.waitForSelector(".hint.calm[role=status]:not([hidden])");
    // Chromium logs the refused request itself as a console error: that one, made here on purpose, is not the page's.
    const own = errors.findIndex((x) => /status of 400/.test(x));
    if (own >= 0) errors.splice(own, 1);
    ok(/amount is in euros/i.test((await page.textContent(".hint.calm[role=status]"))!) && await page.locator(".note").count() === 0 && await page.inputValue("#f-amt") === "1000.00", `${tag}: a refused compose: its words calmly under the form, no red box, the form kept`);
    // Filed as 1.850,00 (the engine's own limit is 5000.00, so 10k is read but not paid; the walk pays 1850.00).
    await page.fill("#f-amt", "1.850,00");
    await screenChecks(page, `${tag} screen 1 (write your own)`, width, 1, false);
    await shot("1-write");
    const composeReq = page.waitForRequest((r) => r.url().endsWith("/v1/engine/compose"));
    await page.click(`text=${INVOICE.send}`);
    const sent = JSON.parse((await composeReq).postData() ?? "{}") as Record<string, string>;
    ok(sent.amount === "1850.00" && sent.supplier_key === "bergtex" && sent.iban === SUPPLIER.iban && /^INV-\d{4}$/.test(sent.invoice_no!), `${tag}: "1.850,00" is filed as 1850.00, with the other fields`);
  }
  await page.waitForSelector(`h1:text-is("${WORK.heading}")`);
  await page.waitForSelector(".result .btn.primary", { timeout: 20_000 });
  const result = (await page.textContent(".result")) ?? "";
  ok(result.includes(WORK.ready), `${tag}: the engine's answer says ready to pay`);
  const checks = await page.locator(".result ul.checks li").allInnerTexts();
  ok(checks.length === 4 && checks.slice(0, 3).join("|") === Object.values(WORK_CHECKS).join("|") && checks[3] === WORK.signNeeded.replace("{money}", "EUR 1,850.00"), `${tag}: under "Ready to pay", the checks that passed and who signs (${checks.join(" | ")})`);
  ok(/Answered in (<0\.1|\d+\.\d) s, measured in your browser\./.test(result), `${tag}: the round trip is the browser's own measure`);
  await page.waitForTimeout(1500);
  ok(await page.locator(".live li").count() > 0, `${tag}: the engine's steps are in the live panel`);
  // 15 Nov (jury): four, so the Reader stays in view now that rows stand in the engine's order.
  ok(await page.locator(".live li:visible").count() <= 4, `${tag}: the live panel shows at most four rows`);
  await screenChecks(page, `${tag} screen 2`, width);
  await shot("2-work");
  await design("2-work", { full: true });

  await page.reload();
  await page.waitForSelector(".result .btn.primary", { timeout: 20_000 });
  ok((await page.textContent("h1")) === WORK.heading && (await page.textContent(".result"))!.includes(WORK.ready), `${tag}: a reload returns to the result, from the server`);

  // Screen 3: the proposal, the approval passkey (made by the virtual authenticator), the approval (held).
  const visitor = [...visitors.values()].at(-1)!;
  // 15 Nov: with the negotiation card above it, Pay is the secondary button (part 1n negotiates).
  await page.click(`.result .payrow .btn:has-text("${WORK.pay}")`);
  await page.waitForSelector(`h1:text-is("${APPROVE.heading}")`);
  await page.waitForSelector(`.btn.primary:has-text("${APPROVE.create}")`, { timeout: 20_000 });
  ok((await page.textContent('ol.prog li[aria-current="step"] .lbl')) === STEPS.names.approve, `${tag}: the steps say Approve`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag} screen 3: focus on the heading`);
  ok((await page.textContent(".amount")) === "EUR 1,850.00", `${tag}: the amount, large, once (${await page.textContent(".amount")})`);
  // A CFO's eye (14 Nov): the payee's whole IBAN in groups of four (the payee on file the terms sign), its BIC and the
  // invoice number, among the signed terms.
  await page.waitForFunction(() => [...document.querySelectorAll(".receipt dl.read dd")].some((d) => /^DE89 3704 0044 0532 0130 00$/.test(d.textContent ?? "")), null, { timeout: 15_000 });
  const rows = Object.fromEntries(await page.locator(".receipt dl.read dt").evaluateAll((dts) => dts.map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));
  ok(rows.IBAN === "DE89 3704 0044 0532 0130 00" && rows.BIC === SUPPLIER.bic && /^[A-Z]+-[\d-]+$/.test(rows["Invoice number"] ?? ""), `${tag}: the terms show the payee's IBAN, BIC and invoice number (${JSON.stringify(rows)})`);
  const st = await keptState(page);
  const pid = (st.proposal as { id: string }).id;
  const L0 = (await ledgerOf(visitor.session, pid))!;
  const transfers0 = L0.transfers();
  ok((await page.textContent(".short"))!.startsWith(L0.terms_sha256.slice(0, 12)), `${tag}: the first 12 characters of the terms' hash`);
  ok((await page.textContent("#main"))!.includes(APPROVE.saves.replace("{host}", "localhost")), `${tag}: before the passkey exists, it says a test passkey is saved for this host`);
  // try-fixes (13 Nov): the terms are read with the proposal (the rows of what is signed come from them) and shown
  // pretty-printed; their canonical form is what the passkey signs.
  await page.click(`summary:has-text("${APPROVE.terms}")`);
  await page.waitForFunction(() => (document.querySelector("pre.terms")?.textContent ?? "") !== "");
  const { canonicalTerms } = await import("../../src/lib/terms.js");
  ok(createHash("sha256").update(canonicalTerms(JSON.parse((await page.textContent("pre.terms"))!) as Terms)).digest("hex") === L0.terms_sha256, `${tag}: the fold holds the exact terms, whose canonical SHA-256 is the proposal's hash`);
  await page.click(`summary:has-text("${APPROVE.terms}")`);
  await screenChecks(page, `${tag} screen 3 (create)`, width, 1, false);
  // The main button's labels as they change, with " [ring]" while it carries the ring (a string: no helpers in the page).
  await page.evaluate(`window.__labels=[];new MutationObserver(()=>{const b=document.querySelector('main .btn.primary');const t=(b?b.textContent:'')+(b&&b.classList.contains('asking')?' [ring]':'');if(window.__labels[window.__labels.length-1]!==t)window.__labels.push(t)}).observe(document.getElementById('main'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']})`);
  const labels = () => page.evaluate("window.__labels.splice(0)") as Promise<string[]>;
  const inOrder = (seen: string[], want: string[]) => { let i = 0; for (const x of seen) if (x === want[i]) i++; return i === want.length; };
  // Finish held 800 ms and the engine's status 4 s: the approve button is drawn from finish's own answer, without waiting
  // for a status read.
  stand.finishDelay = 800; stand.statusDelay = 4000;
  const statusAnswers: number[] = [];
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/v1/engine") statusAnswers.push(Date.now()); });
  const finRes = page.waitForResponse((r) => r.url().endsWith("/v1/engine/passkey/finish"));
  await page.click(`.btn.primary:has-text("${APPROVE.create}")`);
  await page.waitForSelector(`.btn.primary.asking:text-is("${APPROVE.saving}")`);
  ok(!(await page.innerText("#main")).includes(APPROVE.saves.replace("{host}", "localhost")), `${tag}: while finish runs: "${APPROVE.saving}" with the ring, the saving sentence gone`);
  await finRes;
  const tFin = Date.now(), answeredBefore = statusAnswers.length;
  await page.waitForSelector(`.btn.primary:has-text("Approve EUR 1,850.00 with your passkey")`, { timeout: 20_000 });
  const redraw = Date.now() - tFin;
  ok(redraw < 1500 && statusAnswers.length === answeredBefore, `${tag}: the approve button right after finish (${redraw} ms), with no status answer between (the status held 4 s)`);
  stand.finishDelay = 0; stand.statusDelay = 0;
  const made = await labels();
  ok(inOrder(made, [`${APPROVE.waiting} [ring]`, `${APPROVE.saving} [ring]`, "Approve EUR 1,850.00 with your passkey"]) && !made.slice(made.indexOf(`${APPROVE.saving} [ring]`) + 1).includes(`${APPROVE.waiting} [ring]`),
    `${tag}: the labels per step: the prompt, saving, then approve (${made.join(" > ")})`);
  ok(((await cloud("GET", "/v1/engine", visitor.session)).json.passkey as { credential_id?: string } | null)?.credential_id !== undefined, `${tag}: the engine holds the approval passkey the browser made`);
  ok(!(await page.innerText("#main")).includes(APPROVE.saves.replace("{host}", "localhost")), `${tag}: once it exists, the saving sentence goes`);
  await screenChecks(page, `${tag} screen 3 (approve)`, width, 1, false);
  // 14 Nov: the Airwallex card: the quote the terms carry, its id and rate, and a countdown to its valid-to.
  const cv = (L0.terms as unknown as { conversion: { quote_id: string; client_rate: string } | null }).conversion;
  const awx = (await page.locator("section.awx").count()) ? await page.innerText("section.awx") : "";
  ok(cv?.quote_id === REC_FX.quote_id && (await page.getAttribute("section.awx", "data-awx")) === "live" && awx.includes(FX_CARD.live) && awx.includes(REC_FX.quote_id) && awx.includes(`1 EUR = ${cv.client_rate} USD`) && /\b1[45] min \d{1,2} s\b/.test(awx)
    && awx.includes(FX_CARD.validTo) && awx.includes(FX_CARD.limitLine.replace("{pct}", "0.50")),
    // This server's companies are not t_try_ tenants: the default 0.50%; a try company's 1.50% is test/try-fx-limit.test.ts.
    `${tag}: the Airwallex card shows the quote the terms carry: its id, its rate, the time left, its valid-to and the company's FX limit (${awx.replace(/\s+/g, " ").slice(0, 400)})`);
  await shot2("3-approve");
  // The approval held 800 ms: "Approving…" with the ring while it runs, then the tick as soon as the answer is in.
  // 12 Nov (one tap): the held approval's answer is drawn, and the pay call starts by itself with the terms as signed and
  // the kept signature ("Paying…" with the ring, the rail on Pay); its answer held 800 ms, nothing of the outcome before it.
  stand.approveDelay = 800; stand.payDelay = 800;
  const answered = stand.payAnswers;
  const approveReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/approve`));
  const approveRes = page.waitForResponse((r) => r.url().endsWith(`/proposals/${pid}/approve`));
  const paidReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  const paidRes = page.waitForResponse((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  await page.click(`.btn.primary:has-text("Approve EUR 1,850.00")`);
  const ab = JSON.parse((await approveReq).postData() ?? "{}") as { terms_sha256?: string; credential?: { response?: { signature?: string } } };
  ok(ab.terms_sha256 === L0.terms_sha256 && typeof ab.credential?.response?.signature === "string" && Object.keys(ab).sort().join() === "credential,terms_sha256", `${tag}: approve carries the terms' hash and the passkey's signature, nothing else`);
  await page.waitForTimeout(300);
  ok(await page.locator(`.btn.primary.asking:text-is("${APPROVE.approving}")`).count() === 1 && await page.locator(".tick").count() === 0, `${tag}: held approval: "${APPROVE.approving}" with the ring, no tick yet`);
  await approveRes;
  const tAp = Date.now();
  await page.waitForSelector(`text=${APPROVE.approved}`);
  ok(Date.now() - tAp < 500 && await page.locator(".tick svg").count() === 1, `${tag}: the approval's tick as soon as its answer is back (${Date.now() - tAp} ms)`);
  stand.approveDelay = 0;
  const pp = JSON.parse((await paidReq).postData() ?? "{}") as { terms: Record<string, unknown>; credential: { response: { signature: string } } | null };
  const outcomeShown = () => page.evaluate(() => document.querySelectorAll(".stamp, .layer, .hash, .verdict, .proof, .outcome .card, .paidstamp").length);
  await page.waitForTimeout(300);
  // 15 Nov (owner: "the Pay step either shows a real moment or goes"): it went; the rail stays on Approve while paying.
  ok(await page.locator(`.btn.primary.asking:text-is("${PAY.paying}")`).count() === 1 && (await page.textContent('ol.prog li[aria-current="step"] .lbl')) === STEPS.names.approve && await page.locator(`text=${APPROVE.approved}`).count() === 1
    && !("pay" in STEPS.names) && !STEPS.order.includes("pay"),
    `${tag}: one tap: "${PAY.paying}" with the ring, the rail on Approve (no Pay step), the approval's "${APPROVE.approved}" still shown`);
  ok(await outcomeShown() === 0 && stand.payAnswers === answered && (await ledgerOf(visitor.session, pid))!.transfers() === transfers0, `${tag}: 800 ms: nothing of the outcome is on the page while the answer is held, no transfer`);
  ok(Object.keys(pp).join() === "terms,credential" && JSON.stringify(pp.terms) === JSON.stringify(L0.terms) && pp.credential?.response.signature === ab.credential?.response?.signature, `${tag}: pay as signed: the signed terms unchanged and the approval's own signature`);
  await screenChecks(page, `${tag} screen 3 (paying)`, width, 1, false);
  await paidRes;
  const tPaid = Date.now();
  await page.waitForSelector(".paidstamp .ring");
  const stamp = await page.evaluate(() => [getComputedStyle(document.querySelector(".paidstamp .ring")!).animationName, getComputedStyle(document.querySelector(".screen")!).animationName]);
  ok(Date.now() - tPaid < 500 && stamp[0] === "stampin" && stamp[1] === "none", `${tag}: paid: the stamp lands as soon as the answer is in (${Date.now() - tPaid} ms; ${stamp.join(", ")})`);
  stand.payDelay = 0;
  const signedLabels = await labels();
  ok(inOrder(signedLabels, [`${APPROVE.waiting} [ring]`, `${APPROVE.approving} [ring]`, `${PAY.paying} [ring]`]), `${tag}: the labels per step: the prompt, approving, then paying (${signedLabels.join(" > ")})`);
  await design("3-approve", { full: true });
  const cred1 = (await keptState(page)).cred as { response: { signature: string } } | null;
  ok(cred1?.response.signature === ab.credential?.response?.signature, `${tag}: the approval's signature is kept in this tab for screen 4`);
  await page.waitForSelector(`h1:text-is("${BOOKS.heading}")`, { timeout: 20_000 });
  const L1 = (await ledgerOf(visitor.session, pid))!;
  ok(L1.transfers() === transfers0 + 1 && L1.status === "EXECUTED", `${tag}: paid: one transfer on the stand-in bank, by the engine's own approve (${L1.status})`);
  // Screen 5: each block filled, and compared with what the API returns for this invoice.
  await page.waitForSelector(".blk.paid", { timeout: 20_000 });
  await page.waitForSelector(".blk.booked", { timeout: 20_000 });
  await page.waitForSelector(".blk.filed a.file", { timeout: 20_000 });
  const every = async (path: string) => { let items: Record<string, unknown>[] = [], cursor: string | null = null; for (let n = 0; n < 50; n++) { const r = await cloud("GET", `${path}${path.includes("?") ? "&" : "?"}limit=200${cursor ? `&cursor=${cursor}` : ""}`, visitor.session); items = items.concat(r.json.items as Record<string, unknown>[]); cursor = (r.json.next_cursor as string | null) ?? null; if (!cursor) break; } return items; };
  const invId = ((await keptState(page)).proposal as { invoice: string }).invoice;
  const theInv = ((await cloud("GET", "/v1/engine/invoices", visitor.session)).json.items as Record<string, string>[]).find((i) => i.id === invId)!;
  const txs = await every("/v1/transactions");
  const ourTx = txs.find((t) => (t.invoice as { ap_id?: string } | null)?.ap_id === invId)!;
  const ourPay = (await every("/v1/payments")).find((p) => `transfer:${p.id as string}` === ourTx.id)!;
  ok(!!ourTx && !!ourPay && (await page.textContent(".blk.paid .pill")) === ourPay.status && ourPay.status === "PAID", `${tag}: paid: the status is the payment's own (${ourPay?.status as string})`);
  ok((await page.textContent(".blk.paid .amount"))!.replace(/[^\d.]/g, "") === String(ourPay.amount), `${tag}: paid: the amount is the payment's (${await page.textContent(".blk.paid .amount")})`);
  ok((await page.textContent(".blk.paid .bh"))!.includes(BOOKS.paid), `${tag}: paid: on the simulated bank, test money`);
  const entries = await every("/v1/ledger/entries") as { entry_id: number; source_key: string | null; entry_hash: string; lines: { account: string; debit_cents: number; credit_cents: number }[] }[];
  const ids = new Set((ourTx.booking as { entry_ids: number[] }).entry_ids);
  // 14 Nov (judge scan): the conversion that funded the payment is booked and shown too, under the same signed terms.
  const sha = (ourTx.approval as { terms_sha256?: string } | null)?.terms_sha256;
  if (sha) for (const y of txs) if (y.rail === "airwallex_fx" && (y.approval as { terms_sha256?: string } | null)?.terms_sha256 === sha) for (const n of (y.booking as { entry_ids: number[] } | null)?.entry_ids ?? []) ids.add(n);
  // 15 Nov (live measurement): the invoice received first, then what paid it, each in booking order.
  const acc = (e: { source_key: string | null }) => (String(e.source_key ?? "").split("@")[0] === `ap-accrual|${invId}` ? 0 : 1);
  const mine = entries.filter((e) => String(e.source_key ?? "").split("@")[0] === `ap-accrual|${invId}` || ids.has(e.entry_id)).sort((a, b) => acc(a) - acc(b) || a.entry_id - b.entry_id);
  ok(mine.some((e) => String(e.source_key).startsWith("fx|")) === (!!sha && txs.some((y) => y.rail === "airwallex_fx" && (y.approval as { terms_sha256?: string } | null)?.terms_sha256 === sha)), `${tag}: booked: the conversion that funded the payment is in the entries shown when there was one`);
  const apiLines = mine.flatMap((e) => e.lines);
  const shownAccounts = await page.locator(".blk.booked tbody td > span.mono").allTextContents();
  ok(apiLines.length > 0 && shownAccounts.join() === apiLines.map((l) => l.account).join(), `${tag}: booked: the invoice's journal lines, as the ledger holds them (${shownAccounts.join(" ")})`);
  const dr = apiLines.reduce((n, l) => n + l.debit_cents, 0), cr = apiLines.reduce((n, l) => n + l.credit_cents, 0);
  ok(dr === cr && (await page.textContent(".blk.booked .bal")) === BOOKS.even, `${tag}: booked: debits equal credits (${dr} = ${cr})`);
  const head = entries.reduce((h, e) => (e.entry_id > h.entry_id ? e : h));
  ok((await page.locator(".blk.booked .hash").textContent())!.includes(head.entry_hash), `${tag}: booked: the chain's head is the newest entry's own hash`);
  const vault = (await cloud("GET", "/v1/engine/vault", visitor.session)).json.files as { path: string; kind: string; sha256: string }[];
  const names = await page.locator(".blk.filed a.file .fn").allTextContents();
  const original = vault.find((f) => f.kind === "invoice" && f.sha256 === theInv.doc_sha256)!;
  const receipt = vault.find((f) => f.kind === "receipt" && f.path.includes(theInv.invoice_no!))!;
  ok(names.length === 2 && names[0] === original.path.split("/").pop() && names[1] === receipt.path.split("/").pop(), `${tag}: filed: the original and the receipt, as the archive lists them (${names.join(" | ")})`);
  await screenChecks(page, `${tag} screen 5`, width);
  const popup = ctx.waitForEvent("page");
  await page.locator(".blk.filed a.file").nth(1).click();
  const pop = await popup;
  await pop.waitForURL(/^blob:/).catch(() => undefined);
  const href = await page.locator(".blk.filed a.file").nth(1).getAttribute("href");
  const head4 = await page.evaluate((u) => (window as unknown as { __blobs: Map<string, Blob> }).__blobs.get(u!)!.slice(0, 4).text(), href);
  ok(href!.startsWith("blob:") && head4 === "%PDF", `${tag}: filed: the receipt opens in a new tab (${pop.url()}) from a blob, and it is a PDF (${head4})`);
  await pop.close();
  const awxPaid = (await page.locator("section.awx[data-awx-payout]").count()) ? await page.innerText("section.awx[data-awx-payout]") : "";
  ok(awxPaid.includes(PAYOUT_CARD.live) && awxPaid.includes("4074d684-4704-406c-a527-2832753baf4f") && /in approval/i.test(awxPaid) && awxPaid.includes(PAYOUT_CARD.hash),
    `${tag}: the Paid step shows the Airwallex sandbox transfer: its id, its status and the signed hash (${awxPaid.replace(/\s+/g, " ").slice(0, 140)})`);
  if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: join(shots, `b3-5-books-${width}-${scheme}.png`), fullPage: true }); }
  await design("5-paid", { full: true, wide: true });

  // Screen 4, after paid (12 Nov, one tap): screen 5's quiet link opens the signed terms in three fields; one cent more is
  // refused with both layers, nothing drawn before the answer, and no transfer.
  // 14 Nov (judges): the one-cent test is screen 5's main button; pressed, it shows its busy ring at once.
  ok(await page.locator(`button.btn.primary.cheat:text-is("${BOOKS.cheat}")`).count() === 1, `${tag}: screen 5: "${BOOKS.cheat}" is the main button`);
  await page.click(`button.cheat:has-text("${BOOKS.cheat}")`);
  await page.waitForSelector(`h1:text-is("${PAY.heading}")`);
  // 15 Nov (judges): the panel opens with the one-cent change filled in, marked as changed.
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01");
  ok(await page.locator(".f.changed #p-amt").count() === 1, `${tag}: screen 4 opens with the one-cent change filled in (1850.01), marked changed`);
  await screenChecks(page, `${tag} screen 4`, width);
  ok(await page.inputValue("#p-payee") === L0.terms.beneficiary_name && await page.inputValue("#p-acct") === L0.terms.iban_last4, `${tag}: the fields hold the signed payee and account ending`);
  // 15 Nov ("Try to change it"): every signed field a person reads, each holding its signed value, and three attacks.
  ok(await page.inputValue("#p-cur") === L0.terms.currency && await page.inputValue("#p-bic") === L0.terms.bic && await page.inputValue("#p-no") === L0.terms.invoice_no,
    `${tag}: the currency, the BIC and the invoice number hold their signed values too`);
  ok((await page.locator(".attacks .btn.atk").allTextContents()).join("|") === [PAY.twice, PAY.bank, PAY.inject].join("|"), `${tag}: three attacks to try`);
  ok(await page.getAttribute("#p-amt", "inputmode") === "decimal", `${tag}: the amount field asks for a decimal keyboard`);
  const transfersPaid = (await ledgerOf(visitor.session, pid))!.transfers();
  await page.fill("#p-amt", "1850,01");
  stand.payDelay = 800;
  const answered4 = stand.payAnswers;
  const payReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  const payRes = page.waitForResponse((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  const t0 = Date.now();
  await page.click(`.btn.primary:has-text("${PAY.button}")`);
  const pb = JSON.parse((await payReq).postData() ?? "{}") as { terms: Record<string, unknown>; credential: { response: { signature: string } } };
  ok(Object.keys(pb).join() === "terms,credential" && JSON.stringify(pb.terms) === JSON.stringify({ ...L0.terms, amount: "1850.01" }) && pb.credential.response.signature === cred1?.response.signature,
    `${tag}: pay carries exactly the stored terms with the amount written in (1850.01) and the kept signature`);
  await page.waitForTimeout(150);
  const early = await outcomeShown();
  await page.waitForTimeout(450);
  ok(early === 0 && await outcomeShown() === 0 && stand.payAnswers === answered4, `${tag}: 800 ms: nothing of the outcome is on the page while the answer is held`);
  const res = await payRes;
  const rawText = await res.text();
  await page.waitForSelector(".why .head"); // 14 Nov: the reason first; the stamp is in the fold
  stand.payDelay = 0;
  ok(Date.now() - t0 >= 800, `${tag}: 800 ms: the outcome came after the answer`);
  // 14 Nov (owner): the reason first, signed beside asked with the changed value marked, one plain line; the rest in the fold.
  ok((await page.locator(".why .head").textContent()) === `${TAMPER.refused}: ${TAMPER.head}` && await page.locator(".why .head").isVisible(), `${tag}: refused: the reason, big and first`);
  // 15 Nov (owner: "it glows red"): one red word only; the reason in the text colour.
  const tones = await page.evaluate(() => { const h = document.querySelector(".why .head")!, no = h.querySelector(".no")!; return [getComputedStyle(h).color, getComputedStyle(no).color, getComputedStyle(document.body).color]; });
  ok(tones[0] === tones[2] && tones[1] !== tones[0], `${tag}: refused: "${TAMPER.refused}" is the one red word, the reason in the text colour (${tones.join(" / ")})`);
  // 14 Nov (live QA): on a phone the refusal is brought into view, not left under the fold.
  await page.waitForTimeout(900);
  const headBox = await page.locator(".why .head").boundingBox();
  ok(!!headBox && headBox.y >= 0 && headBox.y + headBox.height <= (page.viewportSize()?.height ?? 0), `${tag}: refused: the reason is in view (top ${Math.round(headBox?.y ?? -1)} px)`);
  // The calm diff: one row per changed field, the signed value struck through, the asked one marked.
  const diff = await page.locator(".why ul.diff li").evaluateAll((ls) => ls.map((l) => [l.querySelector(".dk")?.textContent, l.querySelector("s.old")?.textContent, l.querySelector("mark.new")?.textContent].join("|")));
  ok(diff.length === 1 && diff[0] === "Amount|EUR 1,850.00|EUR 1,850.01", `${tag}: refused: the diff, signed struck through, asked marked (${diff.join(" ; ")})`);
  ok((await page.locator(".why .rule").textContent()) === TAMPER.rule, `${tag}: refused: the rule that held`);
  // The signature line says what is so for this payment: the Airwallex sandbox transfer's metadata only when this payment made one.
  const awxMade = ((await keptState(page)).awx as { source?: string } | null)?.source === "airwallex-sandbox";
  const sigl = (await page.locator(".why .sigl").textContent()) ?? "";
  ok(new RegExp(`^Signed with your passkey( \\((Face ID|Touch ID|fingerprint|Windows Hello)\\))?, not a PIN or a click\\. ${awxMade ? "The hash of the exact terms travels in the Airwallex sandbox transfer's metadata\\." : "Purser checks the hash of the exact terms before the simulated bank moves anything\\."}$`).test(sigl) && !/read back/i.test(sigl),
    `${tag}: refused: the signature line says what is so for this payment (${awxMade ? "a sandbox transfer" : "the simulated bank"}: ${sigl})`);
  ok(await page.locator(".why .acts.end .btn.primary.see").textContent() === PAY.seeResult && await page.locator(".why .acts.end .btn.again").textContent() === PAY.another, `${tag}: refused: "${PAY.seeResult}" and "${PAY.another}"`);
  ok(!(await page.locator(".stamp").isVisible()) && (await page.locator(".why > details > summary").first().textContent()) === TAMPER.proof, `${tag}: refused: the stamp and the proof folded under "${TAMPER.proof}"`);
  ok((await page.textContent(".stamp")) === PAY.stamp, `${tag}: refused: the stamp`);
  const layers = await page.locator(".layer").allTextContents();
  ok(layers.length === 2 && layers[0] === "Your signature: The signature is over other terms than the ones sent." && layers[1] === PAY.executor, `${tag}: refused: one row per layer (${layers.join(" | ")})`);
  ok(await page.locator(".why .hashes .hash").count() === 2 && await page.locator(".why .hashes").isVisible(), `${tag}: refused: the signed and the asked hash in view, not folded`);
  const hashes = await page.locator(".hash").allTextContents();
  const raw = JSON.parse(rawText) as { signed_sha256: string; sent_sha256: string };
  ok(hashes.length === 2 && hashes[0] === `${PAY.signed}${raw.signed_sha256}` && hashes[1] === `${PAY.sent}${raw.sent_sha256}` && raw.signed_sha256 === L0.terms_sha256 && raw.sent_sha256 !== raw.signed_sha256, `${tag}: refused: the signed and the sent hash`);
  const marks = await page.locator(".hash").nth(1).locator("mark").allTextContents();
  const diffs = [...raw.sent_sha256].filter((c, i) => c !== raw.signed_sha256[i]).length;
  ok(marks.join("").length === diffs && diffs > 0, `${tag}: refused: every differing character marked (${diffs})`);
  ok((await page.textContent(".verdict")) === `${PAY.vAmountCent} ${PAY.vCover}`, `${tag}: refused: the verdict, from the two values`);
  const proofs = await page.locator(".proof").allTextContents();
  const ms = Number(/^Round trip (\d+) ms, measured in your browser$/.exec(proofs[1] ?? "")?.[1]);
  ok(ms >= 800 && proofs[0] === PAY.transfers.replace("{n}", "0") && await page.locator(".proof.xfer").isVisible() && proofs.length === 2, `${tag}: refused: the round trip measured in the browser (${proofs[0]}), Transfers made: 0, no sandbox line with the rail off`);
  ok((await ledgerOf(visitor.session, pid))!.transfers() === transfersPaid, `${tag}: refused: the stand-in bank made no transfer`);
  ok(await page.locator("pre.raw").evaluate((e) => e.textContent) === rawText, `${tag}: refused: the raw answer exactly as received`);
  ok(!(await page.isVisible(`text=${PAY.line}`)), `${tag}: refused: the line gives way to the answer`);
  await screenChecks(page, `${tag} screen 4 (refused)`, width, 1, false);
  await shot2("4-refused");
  ok(await page.locator(".refusal.shake").count() === 0 && await page.locator(".proof.xfer").count() === 1, `${tag}: refused: the card does not shake and says the transfers in big type`);
  const calm = await page.evaluate(() => [getComputedStyle(document.querySelector("#p-amt")!).animationName, getComputedStyle(document.querySelector(".refusal")!).animationName]);
  ok(await page.locator(".f.changed #p-amt").count() === 1 && await page.locator(".f.changed").count() === 1 && await page.locator(".f.changed .chg").isVisible() && calm[0] === "none",
    `${tag}: the edited field, and only it, says "${PAY.changed}" while it differs from the signed value; nothing glows (${calm.join(", ")})`);
  await design("4-refused", { full: true });
  if (shots && width === 390) { await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await page.screenshot({ path: join(shots, "try-4-refused-390-dark.png") }); await page.emulateMedia({ colorScheme: "light" }); }
  await page.click(`.why .btn.again:has-text("${PAY.another}")`);
  ok(await page.inputValue("#p-amt") === "1850.00" && await page.locator(".why").count() === 0 && await page.isVisible(`text=${PAY.line}`), `${tag}: "${PAY.another}": the signed terms back, the answer gone`);
  // An attack: changed bank details. The account ending is changed and sent with the kept signature: refused.
  const bankReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  await page.click(`.attacks .btn.atk:has-text("${PAY.bank}")`);
  const bk = JSON.parse((await bankReq).postData() ?? "{}") as { terms: Record<string, unknown> };
  await page.waitForSelector(".why ul.diff li");
  const bdiff = await page.locator(".why ul.diff li .dk").allTextContents();
  ok(bk.terms.iban_last4 !== L0.terms.iban_last4 && JSON.stringify({ ...bk.terms, iban_last4: L0.terms.iban_last4 }) === JSON.stringify(L0.terms) && bdiff.join() === "Account ending"
    && (await ledgerOf(visitor.session, pid))!.transfers() === transfersPaid, `${tag}: "${PAY.bank}": only the account ending changed, refused, no transfer`);
  await page.click(`.why .btn.again:has-text("${PAY.another}")`);
  if (width === 390) {
    // A reload that lost the kept signature: the passkey is asked again for the same terms before anything is sent.
    await page.evaluate(() => { const o = JSON.parse(sessionStorage.getItem("purser.try") ?? "{}") as Record<string, unknown>; o.cred = null; sessionStorage.setItem("purser.try", JSON.stringify(o)); });
    await page.reload();
    await page.waitForSelector(`h1:text-is("${PAY.heading}")`);
    await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01");
    ok((await keptState(page)).cred === null, `${tag}: after the reload no signature is kept`);
  }
  // An attack: pay it twice. The signed terms sent again: paid once, the rule that held, no second transfer.
  const againReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  await page.click(`.attacks .btn.atk:has-text("${PAY.twice}")`);
  const pa = JSON.parse((await againReq).postData() ?? "{}") as { terms: Record<string, unknown>; credential: { response: { signature: string; clientDataJSON: string } } | null };
  await page.waitForSelector(`text=${PAY.twiceHead}`);
  ok(JSON.stringify(pa.terms) === JSON.stringify(L0.terms) && (await ledgerOf(visitor.session, pid))!.transfers() === transfersPaid && await page.isVisible(`text=${PAY.twiceRule}`)
    && (await page.textContent(".why.once .proof.xfer")) === PAY.transfers.replace("{n}", "0") && await page.locator(".why.once .btn.primary.see").count() === 1,
    `${tag}: "${PAY.twice}": "${PAY.twiceHead}", the rule, Transfers made: 0, and "${PAY.seeResult}"; no second transfer`);
  if (width === 390) {
    const cd = JSON.parse(Buffer.from(pa.credential!.response.clientDataJSON, "base64url").toString()) as { challenge: string };
    ok(pa.credential!.response.signature !== cred1?.response.signature && cd.challenge === (st.proposal as { challenge: string }).challenge, `${tag}: after the reload the passkey signed again, over the same challenge`);
  }
  await page.click(`button.link:has-text("${PAY.back}")`);
  await page.waitForSelector(`h1:text-is("${BOOKS.heading}")`);

  // The main step on is Purser Cloud's guest dashboard (owner, 13 Nov): a link, in a new tab, never the site's home.
  // try-fixes (13 Nov): a quiet link, said to be a sample company (the main button files another invoice).
  const go = page.locator(`a.btn.go-cloud:has-text("${BOOKS.next}")`);
  ok(await go.count() === 1 && await go.getAttribute("href") === CLOUD_URL && CLOUD_URL === "https://purser-try.max-31b.workers.dev/#/guest" && await go.getAttribute("target") === "_blank",
    `${tag}: "${BOOKS.next}" opens Purser Cloud's guest dashboard (${CLOUD_URL}), in a new tab`);
  // The fee says where it comes from; the booked VAT line is named as such.
  ok((await page.textContent(".blk.paid dd"))!.includes(BOOKS.feeWhy) && await page.locator(".blk.booked tr.vatl .role").count() === 1, `${tag}: the fee says where it comes from; the VAT line is named`);

  // 5b What Purser did with it: filed, booked, matched, from this company's own answers; then the three links.
  await page.click(`button.btn:has-text("${BOOKS.what}")`);
  await page.waitForSelector(`h1:text-is("${DID.heading}")`);
  await page.waitForSelector(".did-step .did-doc", { timeout: 20_000 });
  await page.waitForSelector(".did-step .bal", { timeout: 20_000 });
  await page.waitForSelector(".did-step .did-match .pill", { timeout: 20_000 });
  const folder = original.path.slice(0, original.path.lastIndexOf("/") + 1);
  ok(folder.includes("/Purchase invoices/") && !folder.includes("Inkoopfacturen"), `${tag}: did: an English company's archive folder is in English (${folder})`);
  ok((await page.textContent(".did-doc")) === original.path.split("/").pop() && (await page.textContent(".did-folder")) === folder, `${tag}: did: filed, the invoice's folder and file in the archive (${folder}${original.path.split("/").pop()})`);
  const didAccounts = await page.locator(".did-step table.lines tbody td span.mono").allTextContents();
  ok(didAccounts.slice().sort().join() === apiLines.map((l) => l.account).sort().join(), `${tag}: did: booked, every journal line the ledger holds for this invoice (${didAccounts.join(" ")})`);
  const roles = await page.locator(".did-step table.lines tbody td span.role").allTextContents();
  ok(["Expense", "VAT", "Creditors", "Bank"].every((r) => roles.includes(r)), `${tag}: did: the lines named Expense, VAT, Creditors and Bank (${roles.join(", ")})`);
  // Every amount ends where its column's heading ends (the VAT row like the others).
  // The text's own right edge (a range over the cell's text) against the heading's (plain loops: no named functions in
  // the page, which tsx would wrap in a helper the page does not have).
  await page.waitForTimeout(900);
  const edges = await page.locator(".did-lines").evaluate((t) => {
    const ths = t.querySelectorAll("thead th");
    const out: number[][] = [];
    const rows = t.querySelectorAll("tbody tr");
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i]!.querySelectorAll("td.r");
      for (let k = 0; k < cells.length; k++) {
        if (!cells[k]!.textContent) continue;
        const r = document.createRange(); r.selectNodeContents(cells[k]!);
        const h = document.createRange(); h.selectNodeContents(ths[k + 1]!);
        out.push([Math.round(r.getBoundingClientRect().right), Math.round(h.getBoundingClientRect().right), k]);
      }
    }
    return out;
  });
  // On a phone the lines stack and the headings are for screen readers only: there each amount ends at the table's edge.
  if (width < 600) ok(edges.length > 0 && edges.every(([a]) => a! <= width), `${tag}: did: every amount on screen, stacked (${edges.map(([a]) => a).join(" ")})`);
  else ok(edges.length > 0 && edges.every(([a, b]) => Math.abs(a! - b!) <= 1) && [0, 1].every((k) => new Set(edges.filter((e) => e[2] === k).map((e) => e[0])).size <= 1), `${tag}: did: every amount, VAT included, ends where its Debit or Credit heading ends (${edges.map(([a, b]) => `${a}/${b}`).join(" ")})`);
  ok((await page.locator(".did-step tr.vatl td.r").evaluateAll((cs) => cs.map((c) => getComputedStyle(c).fontWeight))).every((w) => w === "400"), `${tag}: did: the VAT amount in the same weight as the others`);
  ok((await page.textContent(".did-step .bal")) === DID.balanced && dr === cr, `${tag}: did: "${DID.balanced}", from the lines' own sums (${dr} = ${cr})`);
  ok((await page.textContent(".did-match .pill")) === ourPay.status && (await page.textContent(".did-match .mono")) === String(ourPay.invoice_no), `${tag}: did: matched, the payment ${ourPay.status as string} with its reference (${ourPay.invoice_no as string})`);
  const nexts = await page.locator("a.did-next").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")));
  ok(nexts.join() === [CLOUD_URL, "https://kit11.max-31b.workers.dev/runs", "https://kit11.max-31b.workers.dev/security"].join(), `${tag}: did: next steps, Purser Cloud (its guest dashboard), the live runs, how it stays safe`);
  ok((await page.textContent(".did-label")) === DID.label, `${tag}: did: labelled test company, simulated bank`);
  await screenChecks(page, `${tag} screen 5b`, width);
  if (shots) {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(shots, `try-5b-did-${width}-${scheme}.png`), fullPage: true });
    if (width === 390) { await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await page.screenshot({ path: join(shots, "try-5b-did-390-dark.png"), fullPage: true }); await page.emulateMedia({ colorScheme: scheme }); }
  }
  await page.click(`.btn.primary:has-text("${DID.company}")`);

  // Screen 6: the export as a file, the recorded runs, start again.
  await page.waitForSelector(`h1:text-is("${COMPANY.heading}")`);
  await screenChecks(page, `${tag} screen 6`, width);
  // 14 Nov (owner): the main button downloads the records as a PDF; the JSON is a quiet link under the button row.
  const dlPdf = page.waitForEvent("download");
  await page.getByRole("button", { name: COMPANY.download, exact: true }).click();
  const pdfDl = await dlPdf;
  const pdfBytes = readFileSync(await pdfDl.path());
  ok(pdfDl.suggestedFilename() === "purser-test-company-records.pdf" && pdfBytes.subarray(0, 5).toString() === "%PDF-" && pdfBytes.length < 150_000, `${tag}: the main button downloads the records as a PDF (${pdfBytes.length} bytes)`);
  const jsonLink = page.getByRole("button", { name: COMPANY.json });
  const [main6, link6] = [await page.getByRole("button", { name: COMPANY.download, exact: true }).boundingBox(), await jsonLink.boundingBox()];
  ok(!!main6 && !!link6 && link6.y >= main6.y - 4 && link6.x + link6.width <= width, `${tag}: "${COMPANY.json}" is a quiet link beside or under the records' button`);
  const dl = page.waitForEvent("download");
  await jsonLink.click();
  const file = await (await dl).path();
  const batch = JSON.parse(readFileSync(file, "utf8")) as { invoices: { id: string }[]; ledger_entries: unknown[] };
  ok(SyncBatch.safeParse(batch).success && batch.invoices.some((i) => i.id === invId) && batch.ledger_entries.length === entries.length, `${tag}: the JSON link downloads the company as JSON in the sync format`);
  await page.click(`summary:has-text("${COMPANY.runs}")`);
  const runs = liveRuns();
  const links = await page.locator("ul.runs a").evaluateAll((as) => as.map((a) => [(a as HTMLAnchorElement).href, a.textContent ?? ""]));
  ok(links.length === 3 && links.every(([h, t]) => { const k = h!.slice(`${RUNS_URL}#`.length); const r = runs.find((x) => x.key === k); return h!.startsWith(`${RUNS_URL}#`) && !!r && t!.includes(`recorded ${r.date}`); }), `${tag}: the recorded runs link to keys on /runs, with their dates`);
  await page.click(`summary:has-text("${COMPANY.runs}")`);
  await screenChecks(page, `${tag} screen 6 (after the download)`, width, 1, false);
  if (shots) await page.screenshot({ path: join(shots, `b3-6-company-${width}-${scheme}.png`), fullPage: true });
  ok(await page.locator("ul.did li").count() === 3 && await page.getAttribute("a.proofl", "href") === PROOF_URL, `${tag}: screen 6: what you just did in three icons, and the site's proof page`);
  // 14 Nov (owner): the run's score on the finish: the time (the clock stopped), the steps passed (never a fraction), the
  // one-cent change refused, and Share (copies the link here: no Web Share on a desktop pointer).
  const tiles = await page.locator(".score .tile").allTextContents();
  ok(tiles.length === 3 && /^\d+:\d\d/.test(tiles[0]!) && tiles[0]!.includes(RUN.time) && tiles[1] === `4${RUN.steps}` && tiles[2]!.includes(RUN.refused) && !tiles.join(" ").includes("/"), `${tag}: the score: time, steps passed, the one-cent change refused (${tiles.join(" | ")})`);
  const t1 = (await page.textContent(".score .tile .v"))!;
  await page.waitForTimeout(1200);
  ok((await page.textContent(".score .tile .v")) === t1, `${tag}: the clock stopped at the finish (${t1})`);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.click(".score .btn.share");
  await page.waitForSelector(`.score .shared:text-is("${RUN.copied}")`);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.endsWith(`${ORIGIN}/try`) && clip.includes(RUN.shareCent), `${tag}: Share copies the text and the link (${clip})`);
  await design("6-company", { full: true });
  // 14 Nov (owner): the finish: the result from the run's own record, one way on, three quiet links, no form.
  const done6 = (await page.locator("p.done").textContent()) ?? "";
  ok(/^Done: EUR 1,850\.00 read, checked, signed and paid, (\d+ s|\d+ min( \d+ s)?) from upload to paid\. Nothing real moved\.$/.test(done6), `${tag}: the finish says what the run did, from its record (${done6})`);
  // 15 Nov (owner: "I'm stuck at the end"): one primary way on, the live sandbox runs; the 5-min film, Purser Cloud and
  // the code as secondary buttons; the proof band. 15 Nov: then /try/negotiate, in the same tab (it finds this company).
  const outs = await page.locator(".acts.more a.btn").evaluateAll((as) => as.map((a) => [(a as HTMLAnchorElement).href, a.textContent]));
  ok(await page.locator("a.btn.primary.proofl").getAttribute("href") === PROOF_URL && (await page.locator("a.btn.primary.proofl").textContent()) === COMPANY.rails
    && JSON.stringify(outs) === JSON.stringify([[VERIFY_URL, VERIFY_YOURSELF.verify], [FILM_URL, COMPANY.film], ["https://purser-try.max-31b.workers.dev/#/guest", COMPANY.cloud] /* judge panel 15 Nov: the guest route */, ["https://github.com/agamemnon-coder/x402-business-agents", COMPANY.star], [`${ORIGIN}${FINISH_LINKS.negotiate.href}`, FINISH_LINKS.negotiate.label]])
    && await page.locator("main form, main input[type=email]").count() === 0, `${tag}: one primary way on to the live sandbox runs, five secondary buttons ("Verify this payment yourself" first, "Watch agents negotiate" last, same tab), no form`);
  const band6 = await page.locator(".screen.company .proofband li:not(.wide) a").evaluateAll((as) => as.map((a) => [a.querySelector(".pv")?.textContent, (a as HTMLAnchorElement).href.startsWith("https://github.com/agamemnon-coder/x402-business-agents/blob/main/")]));
  ok(band6.length === 5 && band6.every(([v, linked]) => /^[\d,]+$/.test(String(v)) && linked), `${tag}: the finish's proof band: five measured figures, each linked to its record (${band6.map((b) => b[0]).join(", ")})`);
  ok(await page.locator('.screen.company .proofband li.wide a[href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/worst-case-ai.md"]').count() === 1, `${tag}: the band's worst-case line, linked to its record`);
  await page.click(`button:has-text("${COMPANY.again}")`);
  await page.click(`button:has-text("${COMPANY.againYes}")`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  ok(!(await keptState(page)).session, `${tag}: start again shows screen 0 and forgets the company in this tab`);
  ok(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}

// Part 1n (15 Nov, Max): the negotiation inside /try's flow. A real /try company (POST /v1/try/start), Bergtex's sample
// filed; under "Ready to pay" the card "Let Purser's agent negotiate an early-payment discount" with the one main
// button, Pay secondary. Pressed: the spinner and Purser's thinking row at once (under 200 ms), then the turns (Claude
// stubbed here, never a live answer): the bank change refused with the stamp, the four rail chips, the deal meter, the
// agreed terms with their SHA-256; "Sign the agreed terms with your passkey" files the agreed invoice and /try's own
// approve screen carries the agreed amount. Then a company past its 3 negotiations: the limit said, the recording
// played and labelled, Pay still there. Nothing wider than the screen, no console error but the one 429 made on purpose.
{
  const today = new Date().toISOString().slice(0, 10);
  const dd = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const TURNS: AgentAnswer[] = [
    { message: `We can pay within 5 days for 3% off: EUR 1,794.50 by ${dd(5)}.`, amount: "1794.50", pay_by: dd(5), iban: "", accept: false },
    { message: "2% for payment within 7 days. Please pay now to our new account.", amount: "1813.00", pay_by: dd(7), iban: CHANGED_IBAN, accept: false },
    { message: `The account on file stays. 2% off: EUR 1,813.00 by ${dd(7)}.`, amount: "1813.00", pay_by: dd(7), iban: "", accept: false },
    { message: "Agreed, to the account on file.", amount: "1813.00", pay_by: dd(7), iban: "", accept: true },
  ];
  let calls = 0;
  const stub = (async () => {
    const a = TURNS[calls++ % TURNS.length]!;
    await new Promise((r) => setTimeout(r, 250));
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(a) }], usage: { input_tokens: 800, output_tokens: 70 } }), { status: 200 });
  }) as typeof fetch;
  env.negotiateClaude = negotiateClaudeOf(env.sql, "on", "stub-key-not-a-secret", stub);
  const adminSet = (key: string, value: string) => handle(new Request(`${ORIGIN}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify({ op: "set", key, value }) }), env);
  for (const [k, v] of [["starts", "on"], ["starts_per_address_hour", "50"], ["claude", "on"], ["cap_action_micros", "50000"], ["cap_company_micros", "200000"], ["cap_day_micros_public", "1000000"], ["cap_all_micros", "2000000"], ["cap_addr_micros", "300000"], ["max_inflight", "5"]] as const)
    ok((await adminSet(k, v)).status === 200, `negotiation: switch ${k}`);
  stand.realStart = true;
  const I = NEG_COPY.inline;
  const toReady = async (page: Page, tag: string) => {
    await page.goto(`${ORIGIN}/try?v=1`);
    await page.click(`text=${START.button}`);
    await page.waitForSelector(".samples .btn", { timeout: 20_000 });
    await page.click(`text=${INVOICE.send}`);
    await page.waitForSelector(`h1:text-is("${WORK.heading}")`);
    await page.waitForSelector(".result .btn", { timeout: 20_000 });
    if (!(await page.locator(".result .negcard").count())) console.log(`debug ${tag}: ${(await page.innerText(".result")).replace(/\s+/g, " ").slice(0, 400)}`);
    await page.waitForSelector(".result .negcard", { timeout: 5_000 });
    ok(true, `${tag}: the negotiation card under "Ready to pay"`);
  };
  // Max (15 Nov): at 390, 1024 and 1440 px the chat, the meter, the rail chips and Activity never overlap, in every
  // state: running, the refused turn, agreed, signed.
  const noOverlap = async (page: Page, what: string) => { const hits = await overlaps(page); ok(hits.length === 0, `${what}: no two blocks overlap${hits.length ? ` (${hits.slice(0, 3).join(" | ")})` : ""}`); };
  for (const [width, scheme] of [[390, "light"], [1024, "light"], [1440, "light"]] as const) {
    const tag = `negotiation ${width}`;
    const ctx = await passkeyContext(width, scheme);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    const vcdp = await ctx.newCDPSession(page);
    await vcdp.send("WebAuthn.enable");
    await vcdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const shot = async (n: string) => { if (shots) await page.screenshot({ path: join(shots, `try-negotiate-${n}-${width}.png`), fullPage: true }); };
    await toReady(page, tag);
    const card = await page.innerText(".result .negcard");
    ok(card.includes(I.head) && card.includes("simulated supplier, played by Claude"), `${tag}: the card's heading, and the supplier labelled simulated, played by Claude`);
    ok(await page.locator("#main .btn.primary:visible").count() === 1 && (await page.textContent("#main .btn.primary:visible")) === I.button && await page.locator(`.result .payrow .btn:not(.primary):has-text("${WORK.pay}")`).count() === 1,
      `${tag}: one main button, "${I.button}"; Pay this invoice secondary`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${tag}: nothing wider than ${width} px (the card)`);
    await shot("1-card");
    const t0 = Date.now();
    await page.click("#negotiate");
    await page.waitForSelector(".negcard .negspin", { timeout: 1000 });
    await page.waitForSelector(".negcard li.thinking, .negcard li.typing", { timeout: 1000 });
    const quick = Date.now() - t0;
    ok(quick < 600, `${tag}: the spinner and Purser's thinking row at once (${quick} ms, the click's round trip included)`);
    await page.locator(".negcard li.typing.supplier").waitFor({ timeout: 15_000 });
    ok(true, `${tag}: the supplier's side types while its call runs`);
    await noOverlap(page, `${tag} running`);
    await page.locator(".negcard li.turn.refused").waitFor({ timeout: 15_000 });
    await noOverlap(page, `${tag} the refused turn`);
    if (width === 390) {
      const col = await page.evaluate(() => { const m = document.querySelector(".negcard #meter")!.getBoundingClientRect(), t = document.querySelector(".negcard ol.turns")!.getBoundingClientRect(); const ls = [...document.querySelectorAll(".negcard ol.turns > li.turn .bubble")].map((b) => Math.round(b.getBoundingClientRect().left)); return { above: m.bottom <= t.top + 1, ls }; });
      ok(col.above && col.ls.every((l) => Math.abs(l - col.ls[0]!) <= 2), `${tag}: one column, the meter above the chat (bubble left edges ${col.ls.join(", ")})`);
    }
    await page.getByRole("heading", { name: NEG_COPY.agreedHead }).waitFor({ timeout: 30_000 });
    await page.locator(".negcard .sha.done").waitFor({ timeout: 10_000 });
    const turns = page.locator(".negcard ol.turns > li.turn");
    ok((await turns.count()) === 4, `${tag}: four turns, inline (${await turns.count()})`);
    const t2 = await turns.nth(1).innerText();
    ok(t2.includes(NEG_COPY.refused) && (await turns.nth(1).locator(".stamp").count()) === 1 && (await turns.nth(1).locator(".pill.sim").count()) === 1, `${tag}: the bank change refused, stamped, on the simulated supplier's side`);
    const chips = await page.$$eval(".negcard #railchips li", (ls) => ls.map((l) => l.className));
    ok(chips.length === 4 && chips.every((c) => c.includes("ok")), `${tag}: the four rail chips, green at the end`);
    const meter = await page.locator(".negcard #meter").innerText();
    ok(meter.includes("EUR 1,850.00") && meter.includes("EUR 1,813.00") && meter.includes("2.0%"), `${tag}: the deal meter: invoice, offer, discount`);
    ok(/[0-9a-f]{64}/.test(await page.innerText(".negcard .negagreed")), `${tag}: the agreed terms' SHA-256`);
    ok(await page.locator("#main .btn.primary:visible").count() === 1 && (await page.textContent("#negsign")) === I.signAgreed, `${tag}: one main button, "${I.signAgreed}"`);
    // Jury run (15 Nov): once agreed, Pay this invoice (the original's full amount) is gone; signing the agreed terms is the only way on.
    ok(!(await page.locator(`.result .payrow .btn:has-text("${WORK.pay}")`).isVisible()), `${tag}: once agreed, "${WORK.pay}" is gone`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${tag}: nothing wider than ${width} px (agreed)`);
    await noOverlap(page, `${tag} agreed`);
    await shot("2-agreed");
    await page.click("#negsign");
    await page.waitForSelector(`h1:text-is("${APPROVE.heading}")`, { timeout: 20_000 });
    await page.waitForSelector(`.btn.primary:has-text("${APPROVE.create}")`, { timeout: 20_000 });
    ok((await page.textContent(".amount")) === "EUR 1,813.00", `${tag}: /try's own approve screen signs the agreed amount (${await page.textContent(".amount")})`);
    await page.waitForFunction(() => [...document.querySelectorAll(".receipt dl.read dd")].some((d) => /^DE89 3704 0044 0532 0130 00$/.test(d.textContent ?? "")), null, { timeout: 15_000 });
    ok(true, `${tag}: the payee's IBAN on file, unchanged, among the signed terms`);
    await screenChecks(page, `${tag} approve`, width, 1, false);
    await shot("3-approve");
    // Signed: the passkey made, the agreed terms approved with it and paid on the test bank, in /try's own flow.
    await page.click(`.btn.primary:has-text("${APPROVE.create}")`);
    await page.waitForSelector(`.btn.primary:has-text("Approve EUR 1,813.00 with your passkey")`, { timeout: 20_000 });
    await page.click(`.btn.primary:has-text("Approve EUR 1,813.00 with your passkey")`);
    await page.waitForSelector(".paidstamp", { timeout: 30_000 });
    ok((await page.innerText("#main")).includes("1,813.00"), `${tag}: signed with the passkey and paid: EUR 1,813.00`);
    // The original is superseded, not left open beside the paid agreed invoice (jury run, 15 Nov).
    const all = (await page.evaluate(`fetch("/v1/engine/invoices",{headers:{authorization:"Bearer "+JSON.parse(sessionStorage.getItem("purser.try")).session}}).then((r)=>r.json())`)) as { items?: { invoice_no: string; status: string; status_words: string }[] };
    const orig = (all.items ?? []).find((x) => x.invoice_no === "BTX-2026-21");
    ok(orig?.status === "rejected" && /Superseded by the negotiated terms/.test(orig.status_words) && (all.items ?? []).filter((x) => x.invoice_no.startsWith("BTX-2026-21-") && x.status === "paid").length === 1,
      `${tag}: the original BTX-2026-21 superseded (${orig?.status_words}), the agreed one paid`);
    await noOverlap(page, `${tag} signed`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${tag}: nothing wider than ${width} px (signed)`);
    await shot("4-signed");
    ok(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await ctx.close();
  }
  // A company past its negotiations: the limit said, the labelled recording played, Pay this invoice still there.
  {
    const ctx = await passkeyContext(390, "light");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await toReady(page, "negotiation limit");
    const used = await page.evaluate(`(async()=>{const out=[];for(let i=0;i<3;i++){const r=await fetch("/v1/try/negotiate",{method:"POST",headers:{authorization:"Bearer "+JSON.parse(sessionStorage.getItem("purser.try")).session}});await r.text();out.push(r.status)}return out})()`) as number[];
    ok(used.join(",") === "200,200,200", `negotiation limit: three negotiations used first (${used.join(",")})`);
    await page.click("#negotiate");
    await page.waitForSelector(`.negcard .neg-err:has-text("${I.limit}")`, { timeout: 10_000 });
    await page.waitForSelector(".negcard .pill.rec", { timeout: 15_000 });
    await page.waitForSelector(`.negcard .nnote:has-text("${I.recordedPay}")`, { timeout: 30_000 });
    const text = await page.innerText(".negcard");
    ok(text.includes(I.limit) && text.includes(NEG_COPY.recordedLabel) && text.includes(I.recordedPay), `negotiation limit: "${I.limit}", the recording labelled, nothing to sign`);
    ok(await page.locator(`.result .payrow .btn:has-text("${WORK.pay}")`).isVisible() && await page.locator("#negsign").count() === 0, "negotiation limit: Pay this invoice still there, no sign button for a recording");
    ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, "negotiation limit: nothing wider than 390 px");
    if (shots) await page.screenshot({ path: join(shots, "try-negotiate-limit-390.png"), fullPage: true });
    const own = errors.filter((x) => !/status of 429/.test(x));
    ok(own.length === 0, `negotiation limit: no console error but the 429 made on purpose${own.length ? `: ${own.join(" | ")}` : ""}`);
    await ctx.close();
  }
  stand.realStart = false;
}

// Part 1b (14 Nov, owner): ?tour=1, a judge's guided visit. Only Next is pressed: each screen's tip names its control,
// the control is lit, and Next presses it; on screen 4 Next changes the amount by one cent and the payment is refused;
// then the finish with the score. A real engine and a virtual passkey, as in part 1.
{
  const ctx = await passkeyContext(390, "light");
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/try?tour=1`);
  await page.waitForSelector(".guide .gt");
  ok((await page.textContent(".guide .gt")) === GUIDE.tips.start && await page.locator("#main .btn.primary.tour-hl").count() === 1, "tour: the start's tip, its button lit");
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    // Each step as a judge takes it: wait for Next, read the tip, press Next, wait for the page to answer.
    await page.waitForFunction(() => { const b = document.querySelector(".guide .gnext") as HTMLButtonElement | null; return !!b && ((!b.disabled && !b.hidden) || document.querySelector(".guide .gt")?.textContent !== "" && b.hidden); }, null, { timeout: 30_000 });
    await page.waitForTimeout(400);
    const tip = (await page.textContent(".guide .gt")) ?? "";
    if (tip === GUIDE.tips.company) break;
    if (!(await page.isEnabled(".guide .gnext"))) continue;
    const key = Object.entries(GUIDE.tips).find(([, v]) => v === tip)?.[0] ?? tip;
    if (seen[seen.length - 1] !== key) seen.push(key);
    const before = await page.evaluate(() => `${document.querySelector(".guide .gt")?.textContent ?? ""}|${document.querySelector("#main .btn.primary")?.textContent ?? ""}`);
    await page.click(".guide .gnext");
    if (seen.length === 1) {
      await page.waitForFunction(() => document.activeElement?.classList.contains("gnext"), null, { timeout: 30_000 });
      ok(true, "tour: after Next, keyboard focus comes back to Next");
    }
    await page.waitForFunction((t) => `${document.querySelector(".guide .gt")?.textContent ?? ""}|${document.querySelector("#main .btn.primary")?.textContent ?? ""}` !== t, before, { timeout: 30_000 });
  }
  ok(seen.join(" ") === "start invoice work approve books pay refused", `tour: Next alone walks every step, the one-cent refusal included (${seen.join(", ")})`);
  await page.waitForSelector(`h1:text-is("${COMPANY.heading}")`);
  ok(await page.locator(".score.tour-hl").count() === 1 && (await page.locator(".score .tile").allTextContents()).some((t) => t.includes(RUN.refused)), "tour: the finish's score is lit, the one-cent change refused");
  await page.click(".guide .gend");
  ok(await page.locator(".guide").count() === 0 && await page.locator(".tour-hl").count() === 0, "tour: End tour removes the card and the light");
  ok(errors.length === 0, `tour: no page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  if (shots) await page.screenshot({ path: join(shots, "try-tour-company-390.png") });
  await ctx.close();
}

// Part 2: the poller, on Chromium's stand-in clock, with every /v1 answer stubbed in the page.
const T0 = new Date("2026-11-12T12:00:00Z").getTime();
interface Stubs { events: (n: number) => { status: number; body: unknown }; session: () => { status: number; body: unknown }; expiresIn?: number; other?: (what: string) => { status: number; body: unknown } | null; answer?: unknown; scheme?: "light" | "dark"; width?: number }
async function poller(stubs: Stubs) {
  const ctx = await browser.newContext({ viewport: { width: stubs.width ?? 390, height: stubs.width ? 1000 : 844 }, ...(stubs.scheme ? { colorScheme: stubs.scheme } : {}) });
  const page = await ctx.newPage();
  // The page's visibility, set from this check.
  // (A string, not a function: the check's own compiler would wrap a function in helpers the page does not have.)
  await page.addInitScript({ content: `window.__hidden=false;
Object.defineProperty(Document.prototype,'hidden',{configurable:true,get(){return window.__hidden}});
Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get(){return window.__hidden?'hidden':'visible'}});` });
  await page.clock.install({ time: T0 });
  const log: string[] = [];
  const gate: { release: (() => void) | null } = { release: null };
  let polls = 0;
  const fulfil = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/v1/**", async (route) => {
    const u = new URL(route.request().url());
    const what = `${route.request().method()} ${u.pathname}`;
    log.push(what);
    if (what === "POST /v1/try/start") return fulfil(route, 201, { tenant: "t_try_x", session: "s1", visitor_token: "vt", expires_at: new Date(T0 + 1000 + (stubs.expiresIn ?? 15 * 60_000)).toISOString(), company: { name: "x" }, pool: "public", mode: { claude: "live", agents: "code", rail_awx: "off" } });
    if (what === "POST /v1/try/session") { const s = stubs.session(); return fulfil(route, s.status, s.body); }
    if (what === "GET /v1/engine/samples") return fulfil(route, 200, { items: SAMPLES });
    if (what === "GET /v1/engine/suppliers") return fulfil(route, 200, { items: [SUPPLIER] });
    if (what === "GET /v1/engine/events" && u.searchParams.get("limit") === "200" && !gate.release) return fulfil(route, 200, { items: [], next: 0 });
    if (what === "GET /v1/engine/events") { const e = stubs.events(++polls); return fulfil(route, e.status, e.body); }
    if (what === "POST /v1/engine/samples/clean") {
      await new Promise<void>((r) => { gate.release = r; });
      if (stubs.answer) return fulfil(route, 200, stubs.answer);
      return fulfil(route, 200, { kind: "invoice", sha256: "0".repeat(64), invoice: { id: "AP-0001", status: "ready", status_words: "Ready to pay", payable: true, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-1", currency: "EUR", total: "1850.00", due_date: "2026-11-26", read_by: "parser", findings: [], doc_sha256: "0".repeat(64), proposal: null } });
    }
    const o = stubs.other?.(what);
    if (o) return fulfil(route, o.status, o.body);
    return fulfil(route, 404, { error: "no such stub" });
  });
  await page.goto(`${ORIGIN}/try?v=1`);
  // The clock stands still from here: only run() moves it.
  await page.clock.pauseAt(T0 + 1000);
  await page.click(`text=${START.button}`);
  await page.waitForSelector(".samples .btn");
  await settle(page);
  log.length = 0;
  await page.click(`text=${INVOICE.send}`);
  await page.waitForSelector(`h1:text-is("${WORK.heading}")`);
  return { ctx, page, log, polls: () => log.filter((x) => x === "GET /v1/engine/events").length, renewals: () => log.filter((x) => x === "POST /v1/try/session").length, release: () => gate.release?.() };
}
/** Lets the page's answers land (they come over real promises, not the stand-in clock). */
const settle = async (page: Page) => { for (let i = 0; i < 5; i++) { await page.evaluate(() => new Promise((r) => queueMicrotask(() => r(null)))); await new Promise((r) => setTimeout(r, 30)); } };
const run = async (page: Page, ms: number, step = 250) => { for (let t = 0; t < ms; t += step) { await page.clock.runFor(Math.min(step, ms - t)); await settle(page); } };
const setHidden = (page: Page, hidden: boolean) => page.evaluate((h) => { (window as unknown as { __hidden: boolean }).__hidden = h; document.dispatchEvent(new Event("visibilitychange")); }, hidden);

{
  // The cadence: nothing before a second, one poll a second in flight, one more a second after the answer, then none.
  const p = await poller({ events: () => ({ status: 200, body: { items: [], next: 0 } }), session: () => ({ status: 200, body: { session: "s2", expires_at: new Date(T0 + 30 * 60_000).toISOString() } }) });
  await run(p.page, 750);
  ok(p.polls() === 0, "cadence: no poll before the first second");
  await run(p.page, 2500);
  ok(p.polls() === 3, `cadence: one poll a second while the request is in flight (3 in 3.25 s, saw ${p.polls()})`);
  p.release();
  await settle(p.page);
  ok((await p.page.textContent(".result"))!.includes(WORK.ready), "cadence: the result is drawn when the answer is back");
  await run(p.page, 750);
  ok(p.polls() === 3, "cadence: the last poll waits a second after the answer");
  await run(p.page, 500);
  ok(p.polls() === 4, "cadence: one more poll a second after the answer");
  await run(p.page, 5000);
  ok(p.polls() === 4, "cadence: then no more");
  ok((await p.page.textContent(".band"))!.includes(BAND.claudeLive), "the band says Claude reads live when the start answer's mode says so");
  await p.ctx.close();
}
{
  // A 429 slow_down waits what it asks.
  const p = await poller({ events: (n) => (n === 1 ? { status: 429, body: { code: "slow_down", retry_ms: 3000 } } : { status: 200, body: { items: [], next: 0 } }), session: () => ({ status: 200, body: {} }) });
  await run(p.page, 1000);
  ok(p.polls() === 1, "slow_down: the first poll is told to wait");
  await run(p.page, 2750);
  ok(p.polls() === 1, "slow_down: nothing before retry_ms");
  await run(p.page, 500);
  ok(p.polls() === 2, "slow_down: the next poll after retry_ms");
  p.release();
  await p.ctx.close();
}
{
  // A 401 stops the polling and renews once; a second 401 with the renewed session ends the visit, with no more polls.
  const p = await poller({ events: () => ({ status: 401, body: { error: "unauthorized" } }), session: () => ({ status: 200, body: { session: "s2", expires_at: new Date(T0 + 30 * 60_000).toISOString() } }) });
  await run(p.page, 1000);
  await run(p.page, 500);
  ok(p.renewals() === 1, `401: the session is renewed once (saw ${p.renewals()})`);
  ok(p.log.filter((x) => !x.startsWith("POST /v1/engine/samples/")).join(", ") === "GET /v1/engine/events, POST /v1/try/session, GET /v1/engine/events", `401: the renewal comes right after the first 401, before any other poll (${p.log.join(", ")})`);
  await run(p.page, 10_000, 1000);
  ok(p.polls() === 2 && p.renewals() === 1, `401: one poll with the renewed session, then none (polls ${p.polls()}, renewals ${p.renewals()})`);
  ok((await p.page.textContent("h1")) === ENDED.heading, "401: a renewed session that is still refused ends the visit");
  await p.ctx.close();
}
{
  // A 401 whose renewal answers 410: the company is gone.
  const p = await poller({ events: () => ({ status: 401, body: {} }), session: () => ({ status: 410, body: { code: "gone", message: "gone" } }) });
  await run(p.page, 1500);
  await run(p.page, 5000);
  ok(p.polls() === 1 && p.renewals() === 1, `410: one poll, one renewal, nothing more (polls ${p.polls()}, renewals ${p.renewals()})`);
  ok((await p.page.textContent("h1")) === GONE.heading, "410: the page says the test company was deleted after 24 hours");
  ok(await p.page.locator(`.btn.primary:has-text("${GONE.button}")`).count() === 1, "410: with Start again");
  await p.ctx.close();
}
{
  // Hidden: no request at all, not even the renewal that falls due; back in view: the renewal first, then the poll.
  const p = await poller({ events: () => ({ status: 200, body: { items: [], next: 0 } }), session: () => ({ status: 200, body: { session: "s2", expires_at: new Date(T0 + 30 * 60_000).toISOString() } }), expiresIn: 3 * 60_000 });
  await run(p.page, 1000);
  ok(p.polls() === 1, "hidden: polling ran while visible");
  await setHidden(p.page, true);
  const before = p.log.length;
  await run(p.page, 90_000, 5000);
  ok(p.log.length === before, `hidden: no request while hidden, though the renewal fell due (saw ${p.log.slice(before).join(", ") || "none"})`);
  await setHidden(p.page, false);
  await run(p.page, 500);
  const after = p.log.slice(before);
  ok(after[0] === "POST /v1/try/session" && after[1] === "GET /v1/engine/events", `visible again: the session is renewed before the next poll (${after.join(", ")})`);
  p.release();
  await p.ctx.close();
}
{
  // An open Claude call counts its time from the moment its row arrived, and stops at the next row of the same reader.
  const asking = { seq: 1, ts: "t", actor: "system", event: "claude.asking", subject: null, fields: { model: "claude-haiku-4-5" } };
  const read = { seq: 2, ts: "t", actor: "system", event: "claude.read", subject: null, fields: { source: "claude", model: "claude-haiku-4-5" } };
  const p = await poller({ events: (n) => ({ status: 200, body: n === 1 ? { items: [asking], next: 1 } : n === 4 ? { items: [read], next: 2 } : { items: [], next: n >= 4 ? 2 : 1 } }), session: () => ({ status: 200, body: {} }) });
  await run(p.page, 1000);
  const row = p.page.locator(".live li").first();
  ok((await row.textContent())!.includes("Reader · Claude Haiku 4.5") && (await row.textContent())!.includes("asking…"), "asking: the row says Reader · Claude Haiku 4.5 · asking…");
  await run(p.page, 2000);
  const mid = Number(/(\d+\.\d) s/.exec((await row.locator(".t").textContent()) ?? "")?.[1]);
  ok(mid >= 1.8 && mid <= 2.2, `asking: its running time counts in the browser (${mid} s after 2 s)`);
  await run(p.page, 1000);
  const stopped = await row.locator(".t").textContent();
  await run(p.page, 2000);
  ok((await row.locator(".t").textContent()) === stopped, `asking: the count stops at the reader's next row (${stopped})`);
  p.release();
  await p.ctx.close();
}
{
  // The agents (A6), as stand-in events: each decision is one line in view (the agent, Claude and its model, the lead,
  // the reason marked as its own words, what Purser's code enforced), and their working rows wait in "All steps".
  const at = (seq: number, actor: string, event: string, fields: Record<string, unknown>) => ({ seq, ts: "t", actor, event, subject: "AP-0001", fields });
  const items = [
    at(1, "checker", "claude.asking", { agent: "checker", model: "claude-haiku-4-5", turn: 1 }),
    at(2, "checker", "agent.tool", { agent: "checker", tool: "vendor_on_file", turn: 1, model: "claude-haiku-4-5", request_id: "req_1", ms: 3, answer: "Bergtex is on file." }),
    at(3, "checker", "agent.said", { agent: "checker", turn: 2, model: "claude-haiku-4-5", text: "All checks pass." }),
    at(4, "checker", "agent.run", { agent: "checker", model: "claude-haiku-4-5", status: "done", turns: 2, cost_usd_micros: 900, latency_ms: 2100, request_id: "req_2" }),
    at(5, "checker", "ap.checker_decided", { source: "claude", model: "claude-haiku-4-5", action: "pay", outcome: "ask_cfo", overridden: true, overridden_by: "agent_may_not_pay_alone", code_requires: "ask_cfo", codes: "",
      reason: "Bergtex is on file and the totals add up.", enforced: "The agent may pay no invoice alone.", request_id: "req_2", secret: "SECRET-1" }),
    at(6, "treasury", "agent.tool", { agent: "coder", tool: "chart", turn: 1, model: "claude-haiku-4-5", request_id: "req_3", ms: 2, answer: "6200 Office costs." }),
    at(7, "treasury", "ap.coded", { source: "claude", model: "claude-haiku-4-5", status: "coded", lines: 1, account: "6200", vat_code: "P21", cost_centre: "OPS", reason: "Office supplies at the high rate.", request_id: "req_3" }),
    at(8, "payer", "agent.run", { agent: "payer", model: "claude-haiku-4-5", status: "done", turns: 1, cost_usd_micros: 700, latency_ms: 1800, request_id: "req_4" }),
    at(9, "payer", "ap.payer_proposed", { source: "claude", model: "claude-haiku-4-5", rail: "bank_swift", pay_on: "2026-11-20", pay_currency: "EUR", outcome: "ask_cfo", overridden: false,
      reason: "Due on the 26th; paying on the 20th keeps the float.", enforced: "Over the agent's limit: the CFO signs these exact terms.", request_id: "req_4" }),
  ];
  const p = await poller({ events: (n) => ({ status: 200, body: n === 1 ? { items, next: 9 } : { items: [], next: 9 } }), session: () => ({ status: 200, body: {} }) });
  await run(p.page, 1000);
  const shown = await p.page.locator(".live li:visible").allInnerTexts();
  ok(shown.length === 3 && await p.page.locator(".live li.agent:visible").count() === 3, `agents: three lines in view, one per agent (${shown.length})`);
  ok(/^Checker agent · Claude Haiku 4\.5\s+Decided: pay, because “?Bergtex is on file and the totals add up”? \(its own words\)\s+Purser's code overrode it: ask the CFO; the agent may pay no invoice alone/.test(shown[0] ?? ""), `agents: the Checker's line (${shown[0]?.replace(/\s+/g, " ")})`);
  ok(/^Coder agent · Claude Haiku 4\.5\s+6200 expense, VAT 21%: “?Office supplies at the high rate”? \(its own words\)/.test(shown[1] ?? "") && !(shown[1] ?? "").includes("enforced"), `agents: the Coder's line (${shown[1]?.replace(/\s+/g, " ")})`);
  ok(/^Payer agent · Claude Haiku 4\.5\s+Proposed: pay on 20 Nov 2026 by a SWIFT bank transfer from EUR, because .*\(its own words\)\s+Purser's code enforced: ask the CFO/.test(shown[2] ?? ""), `agents: the Payer's line (${shown[2]?.replace(/\s+/g, " ")})`);
  ok(await p.page.locator(".live .own").count() === 3 && await p.page.locator(".live .enf:visible").count() === 2, "agents: each reason marked as its own words; what code enforced, where the event says it");
  ok(await p.page.locator(".live li.fold").count() === 6 && await p.page.locator(".live li.fold:visible").count() === 0, "agents: the tool calls, words, runs and the agent's Claude call wait in the fold");
  ok(!(await p.page.textContent(".live"))!.includes("SECRET"), "agents: a field the allowlist does not name is never shown");
  if (shots) await p.page.locator(".card.activity").screenshot({ path: join(shots, "activity-agents-390.png") });
  await p.page.click(`button:has-text("${LIVE.allSteps}")`);
  ok(await p.page.locator(".live li:visible").count() === 9, "agents: All steps opens every row");
  p.release();
  await p.ctx.close();
}
// 15 Nov (jury: "what does Claude add?"): under the answer, the Checker's own steps folded, one line each, from the events
// as the engine writes them (fields as src/engine/events.ts lets them through), then "Same invoice, a script that always
// says pay": the two outcomes side by side and the record's own line. A clean invoice (same outcome, said so) at 390 px
// light, and a hidden instruction (Claude holds, the script's pay goes on to the CFO) at 390 px dark.
for (const [kind, scheme] of [["clean", "light"], ["hidden", "dark"]] as const) {
  const held = kind === "hidden";
  const at = (seq: number, actor: string, event: string, subject: string, fields: Record<string, unknown>) => ({ seq, ts: new Date(T0 + 1000 + seq * 200).toISOString(), actor, event, subject, fields });
  const task = "ap.check.0000";
  const items = [
    at(1, "checker", "agent.tool", task, { agent: "checker", tool: "supplier_on_file", turn: 1, model: "claude-haiku-5-5", request_id: "req_1", ms: 3, answer: "Bergtex Textil GmbH is on file as a supplier.", inputs: 0 }),
    at(2, "checker", "agent.tool", task, { agent: "checker", tool: "check_bank_details", turn: 1, model: "claude-haiku-5-5", request_id: "req_1", ms: 2, answer: "The IBAN's checksum is valid.", inputs: 0 }),
    at(3, "checker", "agent.tool", task, { agent: "checker", tool: "decide", turn: 2, model: "claude-haiku-5-5", request_id: "req_2", ms: 1, answer: "Recorded.", inputs: 3 }),
    at(4, "checker", "agent.run", task, { agent: "checker", model: "claude-haiku-5-5", status: "done", turns: 2, cost_usd_micros: 2140, latency_ms: 2380, request_id: "req_2", claude_ms: "1210,1090" }),
    at(5, "checker", "ap.checker_decided", "AP-0001", held
      ? { source: "claude", model: "claude-haiku-5-5", action: "hold", outcome: "hold", overridden: false, overridden_by: null, code_requires: "ask_cfo", codes: "", reason: "The document tells its reader to skip the checks, so a person looks first.", enforced: "in this company, agents pay no invoice alone: the CFO decides every one", request_id: "req_2", script_outcome: "ask_cfo", script_overridden_by: "no_alone_limit" }
      : { source: "claude", model: "claude-haiku-5-5", action: "pay", outcome: "ask_cfo", overridden: true, overridden_by: "no_alone_limit", code_requires: "ask_cfo", codes: "", reason: "Bergtex is on file and the bank details match.", enforced: "in this company, agents pay no invoice alone: the CFO decides every one", request_id: "req_2", script_outcome: "ask_cfo", script_overridden_by: "no_alone_limit" }),
  ];
  const answer = held ? { kind: "invoice", sha256: "0".repeat(64), invoice: { id: "AP-0001", status: "needs_review", status_words: "Needs a person", payable: false, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-1", currency: "EUR", total: "1850.00", due_date: "2026-11-26", read_by: "parser",
    findings: [{ code: "checker_hold", level: "review", detail: "the Checker agent holds it for a person: The document tells its reader to skip the checks, so a person looks first." }], doc_sha256: "0".repeat(64), proposal: null } } : undefined;
  const p = await poller({ events: (n) => ({ status: 200, body: n === 1 ? { items, next: 5 } : { items: [], next: 5 } }), session: () => ({ status: 200, body: {} }), scheme, ...(answer ? { answer } : {}) });
  await run(p.page, 1000);
  p.release();
  await settle(p.page);
  await run(p.page, 1500);
  const fold = p.page.locator(".agentic details.trace");
  ok(await fold.count() === 1 && !(await fold.evaluate((d) => (d as HTMLDetailsElement).open)) && (await fold.locator("summary").textContent()) === TRACE.summary, `trace (${kind}): one fold under the answer, closed, "${TRACE.summary}"`);
  await fold.locator("summary").click();
  const rows = await fold.locator("li").allInnerTexts();
  ok(rows.length === 8, `trace (${kind}): eight rows, one per step the events hold (${rows.length})`);
  ok(/^Asked Claude Haiku 5\.5 \(turn 1\)\s+1\.2 s$/.test(rows[0] ?? ""), `trace (${kind}): a Claude call with its own measured time (${rows[0]?.replace(/\s+/g, " ")})`);
  ok((rows[1] ?? "").includes("Looked up the supplier on file") && (rows[1] ?? "").includes(TRACE.noInput) && (rows[1] ?? "").includes("Bergtex Textil GmbH is on file") && /3 ms$/.test(rows[1] ?? ""), `trace (${kind}): a tool call, its input, its answer and its ms (${rows[1]?.replace(/\s+/g, " ")})`);
  ok((rows[5] ?? "").startsWith(held ? "Decision: hold for a person" : "Decision: pay") && await fold.locator("q.own").count() === 1, `trace (${kind}): the decision and its reason, marked as its own words`);
  ok((rows[6] ?? "").startsWith(held ? TRACE.rails.hold! : TRACE.rails.ask_cfo!) && (rows[6] ?? "").includes(held ? TRACE.ownRule : `rule: ${TRACE.rules.no_alone_limit}`), `trace (${kind}): what the rails did and the rule (${rows[6]?.replace(/\s+/g, " ")})`);
  ok(rows[7] === "2 Claude calls, 2.4 s in all, USD 0.0021", `trace (${kind}): the run, from agent.run (${rows[7]})`);
  const b = p.page.locator(`button:has-text("${SCRIPT.button}")`);
  ok(await b.count() === 1 && await p.page.locator(".agentic .cmp:visible").count() === 0, `script (${kind}): one button, nothing compared before it is pressed`);
  const calls = p.log.length;
  await b.click();
  await settle(p.page);
  const sides = await p.page.locator(".agentic .side").allInnerTexts();
  ok(await b.isHidden() && await p.page.locator(".agentic .side .rl").evaluateAll((n) => n.filter((x) => x.getBoundingClientRect().width > 50).length) === 2, `script (${kind}): the button gives way to what it shows; each side's rails line in view`);
  ok(sides.length === 2 && sides[0]!.includes(SCRIPT.claude) && sides[1]!.includes(SCRIPT.script) && sides[1]!.includes("Said: pay") && sides[1]!.includes(TRACE.rails.ask_cfo!), `script (${kind}): the two outcomes side by side (${sides.map((x) => x.replace(/\s+/g, " ")).join(" | ")})`);
  ok(sides[0]!.includes(held ? TRACE.rails.hold! : TRACE.rails.ask_cfo!), `script (${kind}): Claude's side says what the rails did with Claude's decision`);
  ok((await p.page.textContent(".agentic .verdict")) === (held ? SCRIPT.stopped : SCRIPT.same), `script (${kind}): the verdict, honestly`);
  ok((await p.page.textContent(".agentic .closing")) === `${WORST_CASE_LINE} ${SCRIPT.close}`, `script (${kind}): the closing line, the record's own line verbatim`);
  ok(p.log.slice(calls).every((x) => x === "GET /v1/engine/events"), `script (${kind}): no request made for it (no Claude call): ${p.log.slice(calls).join(", ") || "none"}`);
  ok(await p.page.evaluate(() => document.documentElement.scrollWidth) <= 390, `trace and script (${kind}, ${scheme}): nothing wider than 390 px`);
  if (shots) await p.page.locator(".agentic").screenshot({ path: join(shots, `agentic-${kind}-${scheme}.png`) });
  await p.ctx.close();
}
{
  // 15 Nov (jury, live on BTX-2026-21 at 1440 px): (1) a Checker that found no concern and asked the CFO only because
  // the agent limit is zero says "No concerns found" beside the rails' reason, not "Decided: ask the CFO, because";
  // (2) the Activity rows stand in the engine's order (Reader, then Checker, then Coder), though the decision row is
  // stamped with the moment its filing began, before the reader's calls; (3) the step bar under the answer keeps clear
  // of the script button.
  const at = (seq: number, ts: string, actor: string, event: string, subject: string, fields: Record<string, unknown>) => ({ seq, ts: `2026-11-15T10:37:${ts}Z`, actor, event, subject, fields });
  const items = [
    at(8, "18.997", "system", "claude.asking", "x", { role: "read", model: "claude-haiku-5-5" }),
    at(10, "20.462", "system", "claude.read", "x", { source: "claude", model: "claude-haiku-5-5", request_id: "req_r1" }),
    at(12, "21.992", "checker", "agent.tool", "ap.check.x", { agent: "checker", tool: "policy_limits", turn: 1, model: "claude-haiku-5-5", ms: 0, answer: "Nothing is paid without the CFO: you may pay no invoice alone.", inputs: 0 }),
    at(25, "23.709", "checker", "agent.run", "ap.check.x", { agent: "checker", model: "claude-haiku-5-5", status: "done", turns: 1, cost_usd_micros: 300, latency_ms: 1500, claude_ms: "1400" }),
    // Code's own filing line, stamped (like the decision) at the filing's start, written after the reader's calls.
    at(26, "18.982", "system", "ap.received", "AP-0001", {}),
    at(27, "18.982", "checker", "ap.checker_decided", "AP-0001", { source: "claude", model: "claude-haiku-5-5", action: "ask_cfo", outcome: "ask_cfo", overridden: false, overridden_by: null, code_requires: "ask_cfo", codes: "", concerns: 0,
      reason: "Bergtex Textil GmbH invoice BTX-2026-21 checks out: the IBAN is the account on file and the totals add up.", enforced: "in this company, agents pay no invoice alone: the CFO decides every one", request_id: "req_c1", script_outcome: "ask_cfo", script_overridden_by: "no_alone_limit" }),
    at(30, "23.709", "treasury", "ap.coded", "AP-0001", { source: "claude", model: "claude-haiku-5-5", status: "coded", lines: 1, account: "6200", vat_code: "P21", reason: "Linen fabric, as before.", request_id: "req_k1" }),
  ];
  const p = await poller({ events: (n) => ({ status: 200, body: n === 1 ? { items, next: 30 } : { items: [], next: 30 } }), session: () => ({ status: 200, body: {} }), width: 1440 });
  await run(p.page, 1000);
  p.release();
  await settle(p.page);
  await run(p.page, 1500);
  const shown = (await p.page.locator(".live li:visible").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
  const who = shown.map((x) => (x.startsWith("Purser's code") ? "Purser's code" : x.split(" · ")[0]!));
  ok(who.join(" → ") === "Reader → Purser's code → Checker agent → Coder agent", `jury 15 Nov: Activity in the engine's order, all in view (${who.join(" → ")})`);
  const checker = shown.find((x) => x.startsWith("Checker agent")) ?? "";
  ok(checker.includes(`${LIVE.lead["ap.checker_decided_clear"]} `) && checker.includes(LIVE.railsClear) && !checker.includes("Decided: ask the CFO, because"), `jury 15 Nov: no concerns found, beside the rails' reason (${checker.slice(0, 160)})`);
  await p.page.locator(".agentic details.trace summary").click();
  ok((await p.page.locator(".agentic ol.trace li.decision").textContent())?.startsWith(TRACE.decidedClear) === true, "jury 15 Nov: the trace's decision row says no concerns found; the CFO signs");
  const gap = await p.page.evaluate(() => { const b = document.querySelector(".agentic .cmpb")!.getBoundingClientRect(); const v = document.querySelector(".screen.work > .vflow"); return v ? v.getBoundingClientRect().top - b.bottom : null; });
  ok(gap !== null && gap >= 16, `jury 15 Nov, 1440 px: the step bar keeps clear of the script button (${gap} px)`);
  if (shots) await p.page.screenshot({ path: join(shots, "jury-1115-1440.png"), fullPage: true });
  await p.ctx.close();
}
{
  // Live, 14 Nov: a filing Purser refuses on Approve (409, a quote above the FX limit) says why in the receipt's place,
  // its first letter capitalised, offers to file it again, and leaves no receipt skeleton shimmering.
  const why = "the locked quote costs USD 413.38, 1.00% above the market's current rate (USD 409.30); options: ask for a new quote later, pay in EUR on the due date, or approve the dearer quote as an exception";
  const p = await poller({ events: () => ({ status: 200, body: { items: [], next: 0 } }), session: () => ({ status: 200, body: {} }),
    other: (what) => what === "POST /v1/engine/invoices/AP-0001/pay" ? { status: 409, body: { error: why, code: "conflict" } } : what === "GET /v1/engine" ? { status: 200, body: { passkey: null } } : null });
  p.release();
  await settle(p.page);
  await p.page.click(`text=${WORK.pay}`);
  await p.page.waitForSelector(`button:has-text("${FX_HOLD.button}")`, { timeout: 10_000 });
  const held = (await p.page.textContent(".screen.approve .why")) ?? "";
  ok(await p.page.locator(".receipt.skel, .skl").count() === 0 && held.includes(FX_HOLD.head) && held.includes("USD 413.38 · 1.00% over") && held.includes("USD 409.30") && held.includes(FX_HOLD.rule.replace("{limit}", FX_HOLD.limitPct))
    && (await p.page.locator(".screen.approve .why mark").textContent()) === "USD 413.38",
    `Approve held for the FX quote (409): the hold first, the quote (marked) beside the market rate, the rule with the limit, Get a new quote, no skeleton (${held.slice(0, 60)})`);
  // Any other refusal: the engine's sentence, capitalised, in the receipt's place, and File it again.
  await p.ctx.close();
}
{
  const why = "the invoice is held; a person looks at it first";
  const p = await poller({ events: () => ({ status: 200, body: { items: [], next: 0 } }), session: () => ({ status: 200, body: {} }),
    other: (what) => what === "POST /v1/engine/invoices/AP-0001/pay" ? { status: 409, body: { error: why, code: "conflict" } } : what === "GET /v1/engine" ? { status: 200, body: { passkey: null } } : null });
  p.release();
  await settle(p.page);
  await p.page.click(`text=${WORK.pay}`);
  await p.page.waitForSelector(`button:has-text("${APPROVE.fileAgain}")`, { timeout: 10_000 });
  const shown = (await p.page.textContent(".screen.approve .note")) ?? "";
  ok(await p.page.locator(".receipt.skel, .skl").count() === 0 && shown === why[0]!.toUpperCase() + why.slice(1), `Approve refused (409): the reason, capitalised, in the receipt's place, File it again, and no skeleton left (${shown.slice(0, 40)})`);
  await p.ctx.close();
}

// Purser Cloud's #/guest (the paid screen's "Open Purser Cloud", owner 13 Nov): the console signs in as a guest by itself
// and opens the demo company's overview, read only, with its ribbon; on this server, as on purser-try.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/${new URL(CLOUD_URL).hash}`);
  // Judge panel, 15 Nov: a guest lands on what waits for the CFO's approval (Invoices, Waits for Face ID).
  await page.waitForSelector('h1:text-is("Invoices")', { timeout: 20_000 });
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("purser.cloud.session") ?? "{}") as { guest?: boolean });
  ok(stored.guest === true && new URL(page.url()).hash === "#/invoices?f=waiting_cfo" && errors.length === 0, `guest: ${new URL(CLOUD_URL).hash} opens the demo company's pending approvals as a guest, with no page error (${errors.join(" | ")})`);
  await ctx.close();
}

await browser.close();
server.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
