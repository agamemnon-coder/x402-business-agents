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
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { SyncBatch } from "../../cloud/src/sync.js";
import { APPROVE, BAND, BOOKS, COMPANY, ENDED, GONE, INVOICE, PAY, START, STEPS, WORK } from "../../cloud/src/tryCopy.js";
import { PROOF_URL, RUNS_URL } from "../../cloud/src/tryPage.js";
import { batchesFor } from "../../src/cloudsync/client.js";
import type { DB } from "../../src/db/open.js";
import { EngineHost } from "../../src/engine/host.js";
import { termsHash, type Terms } from "../../src/lib/terms.js";
import { softPasskey } from "../../src/metal/softPasskey.js";
import { liveRuns } from "../../src/redesign/runs.js";
import { EN } from "../fakes/apInvoices.js";
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
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });
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
const SAMPLES = [{ key: "clean", title: "A clean invoice from a supplier on file" }, { key: "again", title: "The same file again" }];
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
const stand = { payDelay: 0, payAnswers: 0, fileDelay: 0, refuseCompose: false };
async function laneC(method: string, path: string, session: string, body: Record<string, unknown>, res: ServerResponse): Promise<boolean> {
  const m = /^\/v1\/engine\/proposals\/([A-Za-z0-9_-]+)\/(approve|terms|pay)$/.exec(path);
  if (!m) return false;
  const [, id, what] = m as unknown as [string, string, string];
  if (method === "POST" && what === "approve") {
    if (!body.credential || typeof body.terms_sha256 !== "string") { send(res, 400, { error: "terms_sha256 and credential are required" }); return true; }
    kept.set(`${session} ${id}`, body.credential);
    send(res, 200, { status: "approved", message: `${id} is approved and held: nothing is paid until it is paid with this signature.`, settled: null, held: true });
    return true;
  }
  const L = await ledgerOf(session, id);
  if (!L) { send(res, 404, { error: "no proposal" }); return true; }
  if (method === "GET" && what === "terms") {
    const { canonicalTerms } = await import("../../src/lib/terms.js");
    send(res, 200, { proposal_id: id, status: L.status, terms: L.terms, canonical: canonicalTerms(L.terms), terms_sha256: L.terms_sha256, approved: kept.has(`${session} ${id}`), expires_at: L.terms.expires_at });
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
  send(res, 200, { ...base, outcome: a.json.status === "approved" ? "paid" : "refused", changed: [], transfers_after: L.transfers(), settled: a.json.settled ?? null,
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
  if (req.method === "POST" && url.pathname === "/v1/try/start") {
    const t = await company(`visitor-${++made}`);
    visitors.set(t.session, t);
    return send(res, 201, { tenant: t.id, session: t.session, visitor_token: `vt-${made}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), company: { name: "Test company" }, pool: "public", mode: { claude: "code", agents: "code", rail_awx: "off" } });
  }
  if (req.method === "POST" && url.pathname === "/v1/try/session") {
    const t = [...visitors.values()].find((v) => v.id === json().tenant_id);
    return t ? send(res, 200, { session: t.session, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }) : send(res, 410, { code: "gone", message: "gone" });
  }
  if (req.method === "GET" && url.pathname === "/v1/engine/samples") return send(res, 200, { items: SAMPLES });
  if (req.method === "GET" && url.pathname === "/v1/engine/suppliers") return send(res, 200, { items: [SUPPLIER] });
  const sample = /^\/v1\/engine\/samples\/([a-z]+)$/.exec(url.pathname);
  // Filing a sample or a written invoice is held fileDelay ms (the skeleton's check); refuseCompose answers one 400.
  if (req.method === "POST" && (sample || url.pathname === "/v1/engine/compose") && stand.fileDelay) await new Promise((r) => setTimeout(r, stand.fileDelay));
  if (req.method === "POST" && sample) { const r = await upload(session, clean, `${sample[1]}.pdf`); return send(res, r.status, r.json); }
  if (req.method === "POST" && url.pathname === "/v1/engine/compose" && stand.refuseCompose) { stand.refuseCompose = false; return send(res, 400, { error: "invalid", message: "amount is in euros with two decimals, such as 1850.00" }); }
  if (req.method === "POST" && url.pathname === "/v1/engine/compose") { const b = json(); const r = await upload(session, await composed(b), `${b.invoice_no}.pdf`); return send(res, r.status, r.json); }
  if (await laneC(req.method ?? "GET", url.pathname, session, body ? JSON.parse(body.toString()) as Record<string, unknown> : {}, res)) return;
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
}
/** The page's kept state in this tab. */
const keptState = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("purser.try") ?? "{}") as Record<string, unknown>);
/** A context with Chromium's virtual passkey authenticator (the platform kind, with user verification). */
async function passkeyContext(width: number, scheme: "light" | "dark"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
  return ctx;
}

// Part 0: the start screen in its two zones (the illustration, the card, the trust line) at a phone and a laptop, light
// and dark: both zones in view, nothing wider than the screen, no large empty band, the feather mark, no console or CSP
// error. Screenshots (the viewport) when a directory is given: try-start-<width>-<scheme>.png.
for (const [width, height, scheme] of [[390, 844, "light"], [390, 844, "dark"], [1440, 900, "light"], [1440, 900, "dark"]] as const) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = `start ${width}x${height} ${scheme}`;
  await page.goto(`${ORIGIN}/try`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  await page.waitForTimeout(700);
  const box = (sel: string) => page.locator(sel).first().boundingBox();
  const [hero, card, trust, main] = [await box(".hero"), await box("#main"), await box(".trust"), await box("#main .btn.primary")];
  ok(!!hero && !!card && !!trust && !!main, `${tag}: the illustration, the card, its button and the trust line are shown`);
  if (hero && card && trust && main) {
    ok(main.y + main.height <= height && card.y >= 0 && card.y + card.height <= height && trust.y + trust.height <= height + 1, `${tag}: the card, its button and the trust line are in view without scrolling`);
    if (width === 390) {
      ok(hero.y + hero.height <= card.y + 40 && hero.height >= 0.38 * height, `${tag}: a phone: the illustration's band on top (${Math.round(hero.height)} px, at least 38% of the screen), the card below`);
      ok(trust.y + trust.height >= 0.95 * height && trust.y - (card.y + card.height) < 0.15 * height, `${tag}: no empty band: the trust line ends the screen, close under the card`);
    } else {
      ok(hero.x === 0 && Math.abs(hero.width - width / 2) < 2 && hero.height >= height - 1 && card.x >= width / 2, `${tag}: a wide screen: the illustration left (the full height), the card right`);
      const above = card.y, below = height - (trust.y + trust.height);
      ok(Math.abs(above - below) < 0.15 * height, `${tag}: no empty band: the card and the trust line are centred (${Math.round(above)} px above, ${Math.round(below)} px below)`);
    }
  }
  ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${tag}: nothing wider than ${width} px`);
  ok(await page.locator(".brand .mk svg").count() === 1 && (await page.textContent(".brand"))!.trim() === "Purser", `${tag}: the brand is the feather mark and the name`);
  ok(await page.getAttribute(".hero svg.scene", "aria-label") === "How Purser pays an invoice: an illustration", `${tag}: the illustration is named as one`);
  if (shots) { await page.waitForTimeout(5800); await page.screenshot({ path: join(shots, `try-start-${width}-${scheme}.png`) }); }
  ok(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}
{
  // With reduced motion the illustration stands still on its paid frame.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/try`);
  await page.waitForSelector(".scene");
  const still = await page.evaluate(() => [...document.querySelectorAll(".scene *")].every((e) => getComputedStyle(e).animationName === "none")
    && getComputedStyle(document.querySelector(".sc-paid")!).opacity === "1" && getComputedStyle(document.querySelector(".sc-refused")!).opacity === "0");
  ok(still, "reduced motion: the illustration does not move, and shows its paid frame");
  await ctx.close();
}

// Part 1: a visit at each size.
for (const [width, scheme] of [[390, "light"], [1440, "dark"]] as const) {
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
  await page.goto(`${ORIGIN}/try#j=jury-token-123`);
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
  const startReq = page.waitForRequest((r) => r.url().endsWith("/v1/try/start"));
  await page.click(`text=${START.button}`);
  ok(JSON.parse((await startReq).postData() ?? "{}").token === "jury-token-123", `${tag}: the token goes in the start request's body`);
  await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
  await page.waitForSelector(".samples .btn");
  const warm = asked.slice(asked.indexOf("POST /v1/try/start") + 1, asked.indexOf("POST /v1/try/start") + 3).sort().join(", ");
  ok(warm === "GET /v1/engine, GET /v1/engine/samples" && asked.filter((x) => x === "GET /v1/engine/samples").length === 1, `${tag}: right after the start: the engine's status and the samples, once (${asked.join(", ")})`);
  ok((await page.textContent(".band"))!.includes(BAND.line) && (await page.textContent(".band"))!.includes(BAND.claudeCode), `${tag}: the band says test company, test money, simulated bank, and Purser's code reads today`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag}: focus moved to the new heading`);
  await screenChecks(page, `${tag} screen 1 (samples)`, width);
  ok(!(await page.isVisible(".hero")) && !(await page.isVisible(".trust")) && await page.locator(".prog li.on").count() === 1, `${tag}: after the start: no illustration, no trust line; the rail lights the current step`);
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
    await page.fill("#f-amt", "-5");
    const before = asked.length;
    await page.click(`text=${INVOICE.send}`);
    await page.waitForTimeout(300);
    ok(await page.isVisible("#f-amt-hint") && !asked.slice(before).some((x) => x.endsWith("/compose")), `${tag}: an amount that is not one is not sent, the hint says how to write one`);
    // A compose the server still refuses: its words calmly under the form, the form as it was sent.
    await page.fill("#f-amt", "10k");
    stand.refuseCompose = true;
    await page.click(`text=${INVOICE.send}`);
    await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
    await page.waitForSelector(".hint.calm[role=status]:not([hidden])");
    // Chromium logs the refused request itself as a console error: that one, made here on purpose, is not the page's.
    const own = errors.findIndex((x) => /status of 400/.test(x));
    if (own >= 0) errors.splice(own, 1);
    ok((await page.textContent(".hint.calm[role=status]"))!.includes("amount is in euros") && await page.locator(".note").count() === 0 && await page.inputValue("#f-amt") === "10000.00", `${tag}: a refused compose: its words calmly under the form, no red box, the form kept`);
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
  ok(/Answered in \d+\.\d s, measured in your browser\./.test(result), `${tag}: the round trip is the browser's own measure`);
  await page.waitForTimeout(1500);
  ok(await page.locator(".live li").count() > 0, `${tag}: the engine's steps are in the live panel`);
  ok(await page.locator(".live li:visible").count() <= 3, `${tag}: the live panel shows at most three rows`);
  await screenChecks(page, `${tag} screen 2`, width);
  await shot("2-work");
  await design("2-work", { full: true });

  await page.reload();
  await page.waitForSelector(".result .btn.primary", { timeout: 20_000 });
  ok((await page.textContent("h1")) === WORK.heading && (await page.textContent(".result"))!.includes(WORK.ready), `${tag}: a reload returns to the result, from the server`);

  // Screen 3: the proposal, the approval passkey (made by the virtual authenticator), the approval (held).
  const visitor = [...visitors.values()].at(-1)!;
  await page.click(`.result .btn.primary:has-text("${WORK.pay}")`);
  await page.waitForSelector(`h1:text-is("${APPROVE.heading}")`);
  await page.waitForSelector(`.btn.primary:has-text("${APPROVE.create}")`, { timeout: 20_000 });
  ok((await page.textContent(".stepname")) === STEPS.names.approve, `${tag}: the steps say Approve`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag} screen 3: focus on the heading`);
  ok((await page.textContent(".amount")) === "EUR 1,850.00", `${tag}: the amount, large, once (${await page.textContent(".amount")})`);
  const st = await keptState(page);
  const pid = (st.proposal as { id: string }).id;
  const L0 = (await ledgerOf(visitor.session, pid))!;
  const transfers0 = L0.transfers();
  ok((await page.textContent(".short"))!.startsWith(L0.terms_sha256.slice(0, 12)), `${tag}: the first 12 characters of the terms' hash`);
  ok((await page.textContent("#main"))!.includes(APPROVE.saves.replace("{host}", "localhost")), `${tag}: before the passkey exists, it says a test passkey is saved for this host`);
  ok(await page.locator("pre.terms").textContent() === "", `${tag}: the exact terms are not fetched before the fold opens`);
  await page.click(`summary:has-text("${APPROVE.terms}")`);
  await page.waitForFunction(() => (document.querySelector("pre.terms")?.textContent ?? "") !== "");
  ok(createHash("sha256").update((await page.textContent("pre.terms"))!).digest("hex") === L0.terms_sha256, `${tag}: the fold holds the canonical terms, whose SHA-256 is the proposal's hash`);
  await page.click(`summary:has-text("${APPROVE.terms}")`);
  await screenChecks(page, `${tag} screen 3 (create)`, width, 1, false);
  await page.click(`.btn.primary:has-text("${APPROVE.create}")`);
  await page.waitForSelector(`.btn.primary:has-text("Approve EUR 1,850.00 with your passkey")`, { timeout: 20_000 });
  ok(((await cloud("GET", "/v1/engine", visitor.session)).json.passkey as { credential_id?: string } | null)?.credential_id !== undefined, `${tag}: the engine holds the approval passkey the browser made`);
  ok(!(await page.innerText("#main")).includes(APPROVE.saves.replace("{host}", "localhost")), `${tag}: once it exists, the saving sentence goes`);
  await screenChecks(page, `${tag} screen 3 (approve)`, width, 1, false);
  await shot2("3-approve");
  const approveReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/approve`));
  await page.click(`.btn.primary:has-text("Approve EUR 1,850.00")`);
  const ab = JSON.parse((await approveReq).postData() ?? "{}") as { terms_sha256?: string; credential?: { response?: { signature?: string } } };
  ok(ab.terms_sha256 === L0.terms_sha256 && typeof ab.credential?.response?.signature === "string" && Object.keys(ab).sort().join() === "credential,terms_sha256", `${tag}: approve carries the terms' hash and the passkey's signature, nothing else`);
  await page.waitForSelector(`text=${APPROVE.approved}`);
  ok(await page.locator(".tick svg").count() === 1, `${tag}: the approval's tick, once its answer is back`);
  await design("3-approve", { full: true });
  ok((await ledgerOf(visitor.session, pid))!.transfers() === transfers0, `${tag}: approved and held: no transfer`);
  const cred1 = (await keptState(page)).cred as { response: { signature: string } } | null;
  ok(cred1?.response.signature === ab.credential?.response?.signature, `${tag}: the approval's signature is kept in this tab for screen 4`);
  await screenChecks(page, `${tag} screen 3 (approved)`, width);

  // Screen 4: the signed terms in three fields; one cent more is refused, with nothing drawn before the answer.
  await page.click(`.btn.primary:has-text("${APPROVE.next}")`);
  await page.waitForSelector(`h1:text-is("${PAY.heading}")`);
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.00");
  await screenChecks(page, `${tag} screen 4`, width);
  ok(await page.inputValue("#p-payee") === L0.terms.beneficiary_name && await page.inputValue("#p-acct") === L0.terms.iban_last4, `${tag}: the fields hold the signed payee and account ending`);
  ok(await page.getAttribute("#p-amt", "inputmode") === "decimal", `${tag}: the amount field asks for a decimal keyboard`);
  await page.fill("#p-amt", "1850,01");
  stand.payDelay = 800;
  const answered = stand.payAnswers;
  const payReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  const payRes = page.waitForResponse((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  const t0 = Date.now();
  await page.click(`.btn.primary:has-text("${PAY.button}")`);
  const pb = JSON.parse((await payReq).postData() ?? "{}") as { terms: Record<string, unknown>; credential: { response: { signature: string } } };
  ok(Object.keys(pb).join() === "terms,credential" && JSON.stringify(pb.terms) === JSON.stringify({ ...L0.terms, amount: "1850.01" }) && pb.credential.response.signature === cred1?.response.signature,
    `${tag}: pay carries exactly the stored terms with the amount written in (1850.01) and the kept signature`);
  const outcomeShown = () => page.evaluate(() => document.querySelectorAll(".stamp, .layer, .hash, .verdict, .proof, .outcome .card").length);
  await page.waitForTimeout(150);
  const early = await outcomeShown();
  await page.waitForTimeout(450);
  ok(early === 0 && await outcomeShown() === 0 && stand.payAnswers === answered, `${tag}: 800 ms: nothing of the outcome is on the page while the answer is held`);
  const res = await payRes;
  const rawText = await res.text();
  await page.waitForSelector(".stamp");
  stand.payDelay = 0;
  ok(Date.now() - t0 >= 800, `${tag}: 800 ms: the outcome came after the answer`);
  ok((await page.textContent(".stamp")) === PAY.stamp, `${tag}: refused: the stamp`);
  const layers = await page.locator(".layer").allTextContents();
  ok(layers.length === 2 && layers[0] === "Your signature: The signature is over other terms than the ones sent." && layers[1] === PAY.executor, `${tag}: refused: one row per layer (${layers.join(" | ")})`);
  const hashes = await page.locator(".hash").allTextContents();
  const raw = JSON.parse(rawText) as { signed_sha256: string; sent_sha256: string };
  ok(hashes.length === 2 && hashes[0] === `${PAY.signed}${raw.signed_sha256}` && hashes[1] === `${PAY.sent}${raw.sent_sha256}` && raw.signed_sha256 === L0.terms_sha256 && raw.sent_sha256 !== raw.signed_sha256, `${tag}: refused: the signed and the sent hash`);
  const marks = await page.locator(".hash").nth(1).locator("mark").allTextContents();
  const diffs = [...raw.sent_sha256].filter((c, i) => c !== raw.signed_sha256[i]).length;
  ok(marks.join("").length === diffs && diffs > 0, `${tag}: refused: every differing character marked (${diffs})`);
  ok((await page.textContent(".verdict")) === `${PAY.vAmountCent} ${PAY.vCover}`, `${tag}: refused: the verdict, from the two values`);
  const proofs = await page.locator(".proof").allTextContents();
  const ms = Number(/^Round trip (\d+) ms, measured in your browser$/.exec(proofs[0] ?? "")?.[1]);
  ok(ms >= 800 && proofs[1] === PAY.transfers.replace("{n}", "0") && proofs.length === 2, `${tag}: refused: the round trip measured in the browser (${proofs[0]}), Transfers made: 0, no sandbox line with the rail off`);
  ok((await ledgerOf(visitor.session, pid))!.transfers() === transfers0, `${tag}: refused: the stand-in bank made no transfer`);
  ok(await page.locator("pre.raw").evaluate((e) => e.textContent) === rawText, `${tag}: refused: the raw answer exactly as received`);
  ok(!(await page.isVisible(`text=${PAY.line}`)), `${tag}: refused: the line gives way to the answer`);
  await screenChecks(page, `${tag} screen 4 (refused)`, width, 1, false);
  await shot2("4-refused");
  ok(await page.locator(".refusal.shake").count() === 1 && await page.locator(".proof.xfer").count() === 1, `${tag}: refused: the card shakes once and says the transfers in big type`);
  ok(await page.locator(".f.changed #p-amt").count() === 1 && await page.locator(".f.changed").count() === 1, `${tag}: the edited field, and only it, glows while it differs from the signed value`);
  await design("4-refused", { full: true });
  if (shots && width === 390) { await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await page.screenshot({ path: join(shots, "try-4-refused-390-dark.png") }); await page.emulateMedia({ colorScheme: "light" }); }
  await page.click(`button.link:has-text("${PAY.putBack}")`);
  ok(await page.inputValue("#p-amt") === "1850.00", `${tag}: put back what you signed`);

  if (width === 390) {
    // A reload that lost the kept signature: the passkey is asked again for the same terms before anything is sent.
    await page.evaluate(() => { const o = JSON.parse(sessionStorage.getItem("purser.try") ?? "{}") as Record<string, unknown>; o.cred = null; sessionStorage.setItem("purser.try", JSON.stringify(o)); });
    await page.reload();
    await page.waitForSelector(`h1:text-is("${PAY.heading}")`);
    await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.00");
    ok((await keptState(page)).cred === null, `${tag}: after the reload no signature is kept`);
  }
  const paidReq = page.waitForRequest((r) => r.url().endsWith(`/proposals/${pid}/pay`));
  await page.click(`.btn.primary:has-text("${PAY.button}")`);
  const pp = JSON.parse((await paidReq).postData() ?? "{}") as { terms: Record<string, unknown>; credential: { response: { signature: string; clientDataJSON: string } } | null };
  ok(JSON.stringify(pp.terms) === JSON.stringify(L0.terms) && !!pp.credential, `${tag}: pay as signed: the signed terms and a signature`);
  if (width === 390) {
    const cd = JSON.parse(Buffer.from(pp.credential!.response.clientDataJSON, "base64url").toString()) as { challenge: string };
    ok(pp.credential!.response.signature !== cred1?.response.signature && cd.challenge === (st.proposal as { challenge: string }).challenge, `${tag}: after the reload the passkey signed again, over the same challenge`);
  }
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
  const mine = entries.filter((e) => String(e.source_key ?? "").split("@")[0] === `ap-accrual|${invId}` || ids.has(e.entry_id));
  const apiLines = mine.flatMap((e) => e.lines);
  const shownAccounts = await page.locator(".blk.booked tbody td.mono").allTextContents();
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
  if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: join(shots, `b3-5-books-${width}-${scheme}.png`), fullPage: true }); }
  await design("5-paid", { full: true, wide: true });

  // Screen 6: the export as a file, the recorded runs, start again.
  await page.click(`.btn.primary:has-text("${BOOKS.next}")`);
  await page.waitForSelector(`h1:text-is("${COMPANY.heading}")`);
  await screenChecks(page, `${tag} screen 6`, width);
  const dl = page.waitForEvent("download");
  await page.click(`.btn.primary:has-text("${COMPANY.download}")`);
  const file = await (await dl).path();
  const batch = JSON.parse(readFileSync(file, "utf8")) as { invoices: { id: string }[]; ledger_entries: unknown[] };
  ok(SyncBatch.safeParse(batch).success && batch.invoices.some((i) => i.id === invId) && batch.ledger_entries.length === entries.length, `${tag}: the export downloads the company as JSON in the sync format`);
  await page.click(`summary:has-text("${COMPANY.runs}")`);
  const runs = liveRuns();
  const links = await page.locator("ul.runs a").evaluateAll((as) => as.map((a) => [(a as HTMLAnchorElement).href, a.textContent ?? ""]));
  ok(links.length === 3 && links.every(([h, t]) => { const k = h!.slice(`${RUNS_URL}#`.length); const r = runs.find((x) => x.key === k); return h!.startsWith(`${RUNS_URL}#`) && !!r && t!.includes(`recorded ${r.date}`); }), `${tag}: the recorded runs link to keys on /runs, with their dates`);
  await page.click(`summary:has-text("${COMPANY.runs}")`);
  await screenChecks(page, `${tag} screen 6 (after the download)`, width, 1, false);
  if (shots) await page.screenshot({ path: join(shots, `b3-6-company-${width}-${scheme}.png`), fullPage: true });
  ok(await page.locator("ul.did li").count() === 3 && await page.getAttribute("a.proofl", "href") === PROOF_URL, `${tag}: screen 6: what you just did in three icons, and the site's proof page`);
  await design("6-company", { full: true });
  await page.click(`button:has-text("${COMPANY.again}")`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  ok(!(await keptState(page)).session, `${tag}: start again shows screen 0 and forgets the company in this tab`);
  ok(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}

// Part 2: the poller, on Chromium's stand-in clock, with every /v1 answer stubbed in the page.
const T0 = new Date("2026-11-12T12:00:00Z").getTime();
interface Stubs { events: (n: number) => { status: number; body: unknown }; session: () => { status: number; body: unknown }; expiresIn?: number }
async function poller(stubs: Stubs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
      return fulfil(route, 200, { kind: "invoice", sha256: "0".repeat(64), invoice: { id: "AP-0001", status: "ready", status_words: "Ready to pay", payable: true, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-1", currency: "EUR", total: "1850.00", due_date: "2026-11-26", read_by: "parser", findings: [], doc_sha256: "0".repeat(64), proposal: null } });
    }
    return fulfil(route, 404, { error: "no such stub" });
  });
  await page.goto(`${ORIGIN}/try`);
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

await browser.close();
server.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
