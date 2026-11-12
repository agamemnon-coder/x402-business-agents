// The hands-on page (/try) in Chromium, on this machine. Lane C's try routes (/v1/try/start and /session, the samples,
// the suppliers and compose) are not merged yet: this check's server stands in for them, in this file only, on top of
// a real cloud with an engine in this process (test/support/cloud.ts). Two parts:
// 1. A visit at 390 px light and one at 1440 px dark: start, an invoice, the engine at work, the result; one main
//    button per screen, focus on the heading, nothing wider than the phone, no console or CSP error; a reload returns
//    to the result. Screenshots of screens 0, 1 and 2 when a directory is given.
// 2. The poller with Chromium's stand-in clock and stubbed answers: the cadence (every second in flight, once more a
//    second after), a 401 stops it and renews once, a hidden page makes no request at all, and on coming back the
//    session is renewed before the next poll.
// npx tsx test/browser/try.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Page, Route } from "playwright";
import { BAND, ENDED, GONE, INVOICE, START, WORK } from "../../cloud/src/tryCopy.js";
import { EN } from "../fakes/apInvoices.js";
import { pdfOf } from "../fakes/pdf.js";
import { ORIGIN as CLOUD, testCloud, type TestTenant } from "../support/cloud.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8890 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

// The cloud with an engine per company; a visitor's company is a test tenant made by the test helpers.
const c = testCloud({ engine: true });
const visitors = new Map<string, TestTenant>();
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
const send = (res: import("node:http").ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const upload = async (session: string, bytes: Buffer, filename: string) => c.req("POST", "/v1/engine/documents", { key: session, body: { filename, mime: "application/pdf", base64: bytes.toString("base64") } });

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = new URL(req.url ?? "/", ORIGIN);
  const session = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const json = () => JSON.parse(body?.toString() ?? "{}") as Record<string, string>;
  // Lane C's routes, stood in for here only.
  if (req.method === "POST" && url.pathname === "/v1/try/start") {
    const t = await c.tenant(`visitor-${++made}`);
    await c.req("POST", "/v1/company", { key: t.session, body: { language: "en" } });
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
  if (req.method === "POST" && sample) { const r = await upload(session, clean, `${sample[1]}.pdf`); return send(res, r.status, r.json); }
  if (req.method === "POST" && url.pathname === "/v1/engine/compose") { const b = json(); const r = await upload(session, await composed(b), `${b.invoice_no}.pdf`); return send(res, r.status, r.json); }
  // Everything else is the cloud's own answer (a browser's Origin is this server's; the cloud is configured with its own).
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "host").map(([k, v]) => [k, k === "origin" ? CLOUD : String(v)]));
  const r = await c.fetch(`${CLOUD}${req.url}`, { method: req.method, headers, ...(body ? { body } : {}) });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/** The things every screen must hold: one main button (when it has one yet), no overflow, focus on the heading. */
async function screenChecks(page: Page, name: string, width: number) {
  ok(await page.locator(".btn.primary:visible").count() === 1, `${name}: exactly one main button`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth) <= width, `${name}: nothing wider than ${width} px`);
}

// Part 1: a visit at each size.
for (const [width, scheme] of [[390, "light"], [1440, "dark"]] as const) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = `${width} ${scheme}`;
  const shot = async (n: string) => { if (shots) await page.screenshot({ path: join(shots, `b1-${n}-${width}-${scheme}.png`), fullPage: true }); };

  await page.goto(`${ORIGIN}/try#j=jury-token-123`);
  await page.waitForSelector(`h1:text-is("${START.heading}")`);
  ok(new URL(page.url()).hash === "", `${tag}: the token is gone from the address bar`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag}: focus is on the heading`);
  ok(await page.locator(".band").count() === 0, `${tag}: no band before the start`);
  await screenChecks(page, `${tag} screen 0`, width);
  await shot("0-start");

  const startReq = page.waitForRequest((r) => r.url().endsWith("/v1/try/start"));
  await page.click(`text=${START.button}`);
  ok(JSON.parse((await startReq).postData() ?? "{}").token === "jury-token-123", `${tag}: the token goes in the start request's body`);
  await page.waitForSelector(`h1:text-is("${INVOICE.heading}")`);
  await page.waitForSelector(".samples .btn");
  ok((await page.textContent(".band"))!.includes(BAND.line) && (await page.textContent(".band"))!.includes(BAND.claudeCode), `${tag}: the band says test company, test money, simulated bank, and Purser's code reads today`);
  ok(await page.evaluate(() => document.activeElement?.tagName) === "H1", `${tag}: focus moved to the new heading`);
  await screenChecks(page, `${tag} screen 1 (samples)`, width);
  await shot("1-invoice");

  if (width === 390) {
    ok(await page.getAttribute(`.samples .btn:has-text("${SAMPLES[0]!.title}")`, "aria-pressed") === "true", `${tag}: the first sample is picked`);
    await page.click(`text=${INVOICE.send}`);
  } else {
    await page.click(`text=${INVOICE.tabWrite}`);
    await page.waitForFunction(() => (document.querySelector("#f-iban") as HTMLInputElement | null)?.value !== "");
    await page.fill("#f-amt", "1.234,5");
    await page.click(`text=${INVOICE.send}`);
    ok(await page.evaluate(() => (document.querySelector("#f-amt") as HTMLInputElement).validationMessage) !== "", `${tag}: an amount that is not an amount is refused before anything is sent`);
    await page.fill("#f-amt", "1850,00");
    await screenChecks(page, `${tag} screen 1 (write your own)`, width);
    await shot("1-write");
    const composeReq = page.waitForRequest((r) => r.url().endsWith("/v1/engine/compose"));
    await page.click(`text=${INVOICE.send}`);
    const sent = JSON.parse((await composeReq).postData() ?? "{}") as Record<string, string>;
    ok(sent.amount === "1850.00" && sent.supplier_key === "bergtex" && sent.iban === SUPPLIER.iban && /^INV-\d{4}$/.test(sent.invoice_no!), `${tag}: compose sends the fields, the amount with a dot`);
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

  await page.reload();
  await page.waitForSelector(".result .btn.primary", { timeout: 20_000 });
  ok((await page.textContent("h1")) === WORK.heading && (await page.textContent(".result"))!.includes(WORK.ready), `${tag}: a reload returns to the result, from the server`);
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
c.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
