// Purser Cloud's console in Chromium, end to end, on this machine: a test company (fake data, labelled) set up from its
// starter key with a virtual passkey (Chromium's WebAuthn test authenticator), the runner's test world pushed to it,
// then every page at laptop and phone width. It checks: the passkey first run and sign-in, a supplier name that is
// HTML shows as text, no console or CSP errors, nothing wider than the phone, and an ended session goes back to sign-in.
// That cloud runs no engine, and its page never asks for one. Then the engine pass: a second cloud that runs an engine
// (test money, on its stand-in bank), a company of its own, and an invoice uploaded in the console and watched at work.
// npx tsx test/browser/console.check.ts [screenshot dir]
import { t as tr } from "../../src/ui/i18n.js";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { batchesFor, pushToCloud } from "../../src/cloudsync/client.js";
import { payApInvoice } from "../../src/ap/pay.js";
import { DE, EN, NL } from "../fakes/apInvoices.js";
import { pdfOf } from "../fakes/pdf.js";
import { world } from "../support/rt4World.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8790 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "console-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

// The runner's test world: one invoice paid, one waiting for the CFO, two waiting for a new supplier.
const now = new Date();
const w = await world(now);
const paidId = await w.add(EN, "bergtex-21.pdf");
await w.pay(paidId);
const second = EN.replaceAll("BTX-2026-21", "BTX-2026-24").replace("Subtotal EUR 1,554.62", "Subtotal EUR 1,100.00").replace("VAT 19% EUR 295.38", "VAT 19% EUR 209.00").replace("Total due EUR 1,850.00", "Total due EUR 1,309.00");
const waitingId = await w.add(second, "bergtex-24.pdf");
const filed = await payApInvoice(w.db, w.awx, waitingId, now);
ok(filed.kind === "proposed", "the second Bergtex invoice is filed for the CFO's Face ID");
await w.add(DE, "lagerhaus.pdf");
await w.add(NL, "zeeland.pdf");

// The cloud, served by its own request handler over SQLite and a folder.
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "console-check-"));
/** A cloud on this machine (SQLite in memory, a folder for blobs), served on a port by its own request handler. */
function cloudEnv(origin: string, blobs: string): CloudEnv {
  return { sql: sqliteSql(":memory:"), blobs: dirBlobs(blobs), sessionSecret: "c".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
    rpId: "localhost", origin, mailDomain: "in.purser.test", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
    // The Worker's static assets: pdf.js, as npm run cloud:pdfjs copies it.
    asset: async (path) => (path === "/assets/pdfjs.mjs" ? new Response(readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")))) : null) };
}
async function serve(env: CloudEnv, port: number) {
  const s = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handle(new Request(`${env.origin}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => s.listen(port, "127.0.0.1", () => r()));
  return s;
}
const caller = (origin: string) => async (method: string, path: string, key: string, body?: unknown) => {
  const r = await fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json() as Record<string, unknown> };
};
// The cloud of the walk below runs no engine. Its clock can be moved forward (the step-up walk below).
let skewMs = 0;
const env = { ...cloudEnv(ORIGIN, join(dir, "blobs")), now: () => new Date(Date.now() + skewMs) };
const server = await serve(env, PORT);
const call = caller(ORIGIN);
const made = await call("POST", "/v1/admin/tenants", ADMIN, { slug: "northwind", name: "Northwind Outdoor (test company)", owner: { display_name: "The CFO" } });
const starter = made.json.api_key as string;
// The console is English unless a person chose Dutch (12 Nov); the company is set to English all the same, and the
// check turns Dutch near the end through the person's own language, as a person would.
ok((await call("POST", "/v1/company", starter, { language: "en" })).status === 200, "the company's pages can be set to English");


// Chromium with a virtual passkey authenticator (the platform kind: user verification, discoverable credentials).
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
/**
 * A browser context of its own, in English, with a page, its console errors, every URL it asked for, and its own virtual
 * passkey authenticator (the platform kind: user verification, discoverable credentials). Both clouds use the relying
 * party "localhost", so each company's passkey lives in its own context's authenticator.
 */
async function passkeyContext(): Promise<{ ctx: BrowserContext; page: Page; errors: string[]; urls: string[]; cdp: CDPSession; internal: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: shots ? 2 : 1 });
  const urls: string[] = [];
  ctx.on("request", (r) => urls.push(r.url()));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId: internal } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { ctx, page, errors, urls, cdp, internal };
}
/** A company's first run in the console, from its starter key to the owner's passkey made and signed in (the first run's last step on screen). */
async function firstRun(p: Page, origin: string, slug: string, key: string, snap: (name: string) => Promise<void> = async () => {}) {
  await p.goto(`${origin}/#/start`);
  await p.fill("#start-slug", slug);
  await p.fill("#start-key", key);
  ok((await p.evaluate(() => document.documentElement.lang)) === "en" && (await p.textContent("h1")) === "Set up your company", "the first run paints in English, with nothing chosen");
  ok(await p.evaluate(() => document.querySelector("ol.stepper li.now")?.getAttribute("aria-current") === "step" && document.querySelectorAll("ol.stepper li").length === 3), "the first run marks the current of its three steps");
  await snap("01-eerste-keer-1-bedrijf");
  await p.click("text=Continue");
  await p.waitForSelector("#start-name");
  // Each stage fades in (a quarter of a second); the screenshot waits for it.
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => { const li = document.querySelectorAll("ol.stepper li"); return li[0]?.className === "done" && !!li[0]?.querySelector("svg") && li[1]?.className === "now"; }), "the first run ticks the step that is done");
  await snap("02-eerste-keer-2-passkey");
  await p.click("text=Make my passkey");
  await p.waitForSelector("text=Make the key for my computer", { timeout: 20_000 });
}
// The sign-in in its two zones (the illustration, the card, the trust line), at a phone and a laptop, light and dark:
// both zones in view, nothing wider than the screen, no large empty band, the feather mark, no console or CSP error.
// Screenshots (the viewport) when a directory is given: console-signin-<width>-<scheme>.png.
for (const [width, height, scheme] of [[390, 844, "light"], [390, 844, "dark"], [1440, 900, "light"], [1440, 900, "dark"]] as const) {
  const c = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1 });
  const p = await c.newPage();
  const errs: string[] = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", (e) => errs.push(String(e)));
  const tag = `sign-in ${width}x${height} ${scheme}`;
  await p.goto(`${ORIGIN}/#/sign-in`);
  await p.waitForSelector("text=Sign in with your passkey");
  await p.waitForTimeout(500);
  const box = (sel: string) => p.locator(sel).first().boundingBox();
  const [hero, card, trust] = [await box(".hero"), await box(".auth"), await box(".trust")];
  ok(!!hero && !!card && !!trust, `${tag}: the illustration, the card and the trust line are shown`);
  if (hero && card && trust) {
    ok(card.y + card.height <= height && trust.y + trust.height <= height + 1, `${tag}: the card and the trust line are in view without scrolling`);
    if (width === 390) {
      // Since 13 Nov the band is Purser Cloud's own calm panel, not /try's illustration: on top, compact, the card below.
      ok(hero.y + hero.height <= card.y + 40 && hero.height >= 80, `${tag}: a phone: the panel on top (${Math.round(hero.height)} px), the card below`);
      ok(trust.y + trust.height >= 0.95 * height && trust.y - (card.y + card.height) < 0.15 * height, `${tag}: no empty band: the trust line ends the screen, close under the card`);
    } else {
      ok(hero.x === 0 && Math.abs(hero.width - width / 2) < 2 && hero.y + hero.height >= height - 1 && card.x >= width / 2, `${tag}: a wide screen: the illustration left (to the bottom), the card right`);
      const above = card.y - hero.y, below = height - (trust.y + trust.height);
      ok(Math.abs(above - below) < 0.15 * height, `${tag}: no empty band: the card and the trust line are centred (${Math.round(above)} px above, ${Math.round(below)} px below)`);
    }
  }
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= width, `${tag}: nothing wider than ${width} px`);
  ok((await p.textContent(".trust"))!.includes(tr("en", "cs.trust_works")) && (await p.textContent(".trust"))!.includes(tr("en", "cs.trust_test")), `${tag}: the trust line`);
  ok(await p.locator("header .brand .mk svg").count() === 1, `${tag}: the brand's feather mark`);
  // 12 Nov: signed out too, the test-money chip is on the page, in the console's bar under the site's header.
  ok(await p.isVisible(".appbar .test") && !(await p.isVisible(".appbar .apptabs")), `${tag}: signed out, the test-money chip shows (the pages do not)`);
  if (shots) { await p.waitForTimeout(5800); await p.screenshot({ path: join(shots, `console-signin-${width}-${scheme}.png`) }); }
  ok(errs.length === 0, `${tag}: no console or CSP errors${errs.length ? `: ${errs.join(" | ")}` : ""}`);
  await c.close();
}

const { ctx, page, errors, urls } = await passkeyContext();
const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
// The PDF frame's worker keeps a request open in Playwright's count, so "network idle" is waited for briefly, not forever.
const settleOn = async (p: Page) => { await p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(250); };
const settle = () => settleOn(page);
const text = async () => (await page.textContent("body")) ?? "";

// First run.
await firstRun(page, ORIGIN, "northwind", starter, shot);
ok((await text()).includes("northwind@in.purser.test"), "the first run shows the inbox address");
await page.click("text=Make the key for my computer");
await page.waitForSelector(".once code");
const cmd = (await page.textContent(".once code")) ?? "";
ok(/^PURSER_CLOUD_URL=http:\/\/localhost:\d+ PURSER_CLOUD_KEY=pck_k\w+_[\w-]+ npm run cloud -- push$/.test(cmd), "the first run gives the one command, with a sync key, once");
const syncKey = /PURSER_CLOUD_KEY=(\S+)/.exec(cmd)![1]!;
// The runner pushes with the sync key the first run made (the starter key only makes the first passkey).
await pushToCloud(w.db, { url: ORIGIN, key: syncKey }, now);
// A supplier whose name is HTML, as any runner could push it: the console must show it as text.
const one = (batchesFor(w.db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }, { now }).find((b) => Array.isArray(b.invoices) && (b.invoices as unknown[]).length)!.invoices as { id: string; vendor: string; body: Record<string, unknown> }[])[0]!;
const evil = '<img src=x onerror="document.title=\'pwned\'">Evil Supplies';
const push = await call("POST", "/v1/sync", syncKey, { invoices: [{ ...one, id: "AP-9001", vendor: evil, status: "needs_review", body: { ...one.body, id: "AP-9001", vendor: evil, status: "needs_review", status_words: "Needs a person", invoice_no: "<b>X-1</b>", findings: [{ code: "duplicate", level: "review", detail: "<script>alert(1)</script> looks like an invoice on file" }] } }] });
ok(push.status === 200, "a supplier name with HTML in it is pushed like any other");
// The screenshot shows the command with its key cut short (it is a throwaway key, but a key all the same).
await page.evaluate(() => { const c = document.querySelector(".once code"); if (c) c.textContent = (c.textContent ?? "").replace(/(pck_k\w{4})\w*_[\w-]+/, "$1…"); });
await settle();
await shot("03-eerste-keer-3-inbox-en-computer");
ok((await text()).includes(tr("en", "cs.starter_gone")), "the first run says the starter key is gone");
ok((await call("GET", "/v1/me", starter)).status === 401, "the starter key stopped working once the owner's passkey existed (red team round 5)");

// Sign out, sign in with the passkey.
await page.click("#out");
await page.waitForSelector("text=Sign in with your passkey");
await page.fill("#slug", "northwind");
await settle();
await shot("04-inloggen");
await page.click("text=Sign in with your passkey");
await page.waitForSelector("text=Waits for the CFO's Face ID", { timeout: 20_000 });
await settle();
ok((await text()).includes("BTX-2026-24"), "the overview lists the invoice that waits for the CFO");
ok(!(await page.isVisible(".hero")) && !(await page.isVisible(".trust")), "signed in: no illustration and no trust line");
await shot("05-overzicht");

await page.goto(`${ORIGIN}/#/invoices`);
await page.waitForSelector(".row:not(.th)");
await settle();
await shot("06-facturen");
ok((await page.$$("img")).length === 0 && (await text()).includes('<img src=x onerror="document.title=\'pwned\'">Evil Supplies'), "a supplier name with HTML shows as text, never as markup");
ok(!(await page.title()).includes("pwned"), "no script from a supplier's text ran");

await page.goto(`${ORIGIN}/#/invoices/${encodeURIComponent(paidId)}`);
await page.waitForSelector(".card.paper") /* 14 Nov: the invoice reads as a document; was "What Purser read" */;
await settle();
await shot("07-factuur-detail");
const detail = await text();
ok(detail.includes("IBAN …3000") && !detail.includes("DE89370400440532013000"), "the invoice shows the account masked, never whole");
await page.waitForSelector("iframe.pdfframe");
const pdfFrame = page.frameLocator("iframe.pdfframe");
await pdfFrame.locator("canvas").first().waitFor({ timeout: 20_000 });
await settle();
ok(await pdfFrame.locator("canvas").count() >= 1, "the invoice's PDF is drawn on a canvas, in its sandboxed frame");
ok((await page.$$(".pages canvas")).length === 0, "the console page itself parses no supplier PDF (red team round 5)");
const frame = page.frames().find((f) => f.url().endsWith("/pdfview"))!;
const reach = await frame.evaluate(() => {
  const out: string[] = [];
  try { void window.parent.sessionStorage; out.push("parent-storage"); } catch { /* blocked */ }
  try { void window.sessionStorage; out.push("own-storage"); } catch { /* blocked */ }
  try { void window.parent.document; out.push("parent-document"); } catch { /* blocked */ }
  return out;
});
ok(reach.length === 0, `the PDF frame reaches neither the console's session nor its page (${reach.join(", ") || "nothing"})`);
ok(await page.evaluate(() => { try { return (document.querySelector("iframe.pdfframe") as HTMLIFrameElement).contentDocument === null; } catch { return true; } }), "the console cannot reach into the PDF frame either (an opaque origin)");
await shot("16-factuur-met-pdf");
await page.goto(`${ORIGIN}/#/invoices/AP-9001`);
await page.waitForSelector(".card.paper") /* 14 Nov: the invoice reads as a document; was "What Purser read" */;
ok((await page.$$("script")).length === 1 && (await text()).includes("<script>alert(1)</script> looks like"), "a finding's text with a script tag shows as text");

await page.goto(`${ORIGIN}/#/transactions`);
await page.waitForSelector(".trow:not(.th)");
await settle();
await shot("08-transacties");
await page.goto(`${ORIGIN}/#/books`);
await page.waitForSelector("text=VAT overview");
await settle();
await shot("09-boekhouding");
await page.goto(`${ORIGIN}/#/settings`);
await page.waitForSelector("text=API keys");
await settle();
await shot("10-instellingen");
// An invite: one-time link and its QR code, which a phone's camera reads as exactly that link.
await page.fill('input[placeholder="Name"]', "Fleur (test person)");
await page.click("text=Add and invite");
await page.waitForSelector("img.qr");
await settle();
const link = (await page.textContent("#invite-link")) ?? "";
const inviteLink = new URL(link);
const q = new URLSearchParams(inviteLink.hash.slice("#/enrol?".length));
ok(inviteLink.origin === ORIGIN && inviteLink.hash.startsWith("#/enrol?") && [...q.keys()].sort().join(",") === "e,k", "an invite is a one-time link to this console, its secret after the #, naming no company (red team round 5)");
const { PNG } = require("pngjs") as typeof import("pngjs");
const jsQR = require("jsqr") as typeof import("jsqr").default;
const png = PNG.sync.read(await (await page.$("img.qr"))!.screenshot());
const read = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
ok(read?.data === link, "the invite's QR code reads as exactly the link");
// The screenshot shows the link with its secret cut short (a throwaway test enrolment, but a secret all the same).
await page.evaluate(() => { const c = document.querySelector("#invite-link"); if (c) c.textContent = (c.textContent ?? "").replace(/(&k=)[^&]+/, "$1…"); });
await page.evaluate(() => window.scrollTo(0, 0));
await shot("17-uitnodigen");
// The invited person opens the link: the secret leaves the address bar at once, and the server names the company.
const guest = await ctx.newPage();
await guest.goto(link);
await guest.waitForSelector("text=You were added to");
ok(new URL(guest.url()).hash === "#/enrol", "the invite's secret is cleared from the address bar on opening (red team round 5)");
const guestText = (await guest.textContent("body")) ?? "";
ok(guestText.includes("Northwind Outdoor (test company)") && guestText.includes("Fleur (test person)"), "the invite page shows the company and person the server says the secret is for");
await guest.close();
// A person's passkeys, and the company's last owner passkey cannot be removed.
page.on("dialog", (d) => { void d.accept(); });
await page.click("tr:has-text(\"The CFO\") >> text=Passkeys");
await page.waitForSelector("#passkeys li");
ok((await page.$$("#passkeys li")).length === 1, "Settings lists the owner's one passkey");
await page.click("#passkeys >> text=Remove");
await page.waitForSelector("text=last owner passkey");
ok(true, "the company's last owner passkey cannot be removed");
// Alerts (Settings, Alerts): an e-mail address added is shown masked, never whole (WhatsApp is not offered, 14 Nov). Then, with "Ask again" switched on
// and six minutes on by the cloud's clock, the sign-in no longer counts as a fresh passkey check: adding an address asks the passkey again (the virtual
// authenticator answers), and the console sends the request once more with the step-up token.
await page.waitForSelector("#alerts");
ok(!(await page.locator("#alert-channel option").allTextContents()).some((o) => /whatsapp/i.test(o)), "Settings, Alerts offers e-mail, Slack and Teams, not WhatsApp");
await page.selectOption("#alert-channel", "email");
await page.fill("#alert-target", "alerts@example.com");
await page.click("#alert-add");
await page.waitForSelector("#alerts >> text=a***@example.com");
ok(!((await page.textContent("#alerts")) ?? "").includes("alerts@example.com"), "Settings, Alerts shows an e-mail address masked, never whole");
// "Ask again before sensitive changes" is off by default; the owner switches it on (the fresh sign-in is the check).
ok(!(await page.isChecked("#step-up")), "Settings, Security: \"Ask again before sensitive changes\" is off by default");
await page.check("#step-up");
await page.waitForSelector("#security .note-ok");
skewMs = 6 * 60_000;
const stepUps: string[] = [];
page.on("request", (r) => { if (r.url().includes("/v1/auth/step-up")) stepUps.push(r.url()); });
await page.selectOption("#alert-channel", "email");
await page.fill("#alert-target", "cfo@example.com");
await page.click("#alert-add");
await page.waitForSelector("#alerts >> text=c***@example.com");
ok(stepUps.length === 2, `a sensitive setting after five minutes asks for the passkey again, and then goes through (${stepUps.length} step-up calls)`);
skewMs = 0;
await page.evaluate(() => window.scrollTo(0, 0));

// The phone.
await page.setViewportSize({ width: 390, height: 844 });
for (const [hash, name, wait] of [["#/overview", "11-telefoon-overzicht", "text=Waits for the CFO's Face ID"], ["#/invoices", "12-telefoon-facturen", ".row:not(.th)"], [`#/invoices/${encodeURIComponent(paidId)}`, "18-telefoon-factuur-met-pdf", "iframe.pdfframe"], ["#/transactions", "14-telefoon-transacties", ".trow:not(.th)"], ["#/settings", "15-telefoon-instellingen", "text=API keys"]] as const) {
  await page.goto(`${ORIGIN}/${hash}`);
  await page.waitForSelector(wait);
  if (wait === "iframe.pdfframe") await page.frameLocator("iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 });
  await settle();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(wide <= 0, `${hash} at 390 px: nothing wider than the phone (${wide} px over)`);
  await shot(name);
}
// The invite on the phone.
await page.goto(`${ORIGIN}/#/settings`);
await page.waitForSelector("text=API keys");
await page.fill('input[placeholder="Name"]', "Sam (test person)");
await page.click("text=Add and invite");
await page.waitForSelector("img.qr");
await settle();
ok(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "the invite at 390 px: nothing wider than the phone");
await page.evaluate(() => { const c = document.querySelector("#invite-link"); if (c) c.textContent = (c.textContent ?? "").replace(/(&k=)[^&]+/, "$1…"); document.querySelector("img.qr")?.scrollIntoView({ block: "center" }); });
if (shots) await page.screenshot({ path: join(shots, "19-telefoon-uitnodigen.png") });

// A person's own language: Dutch for them while the company stays English, with Dutch amounts; then back to the company's.
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${ORIGIN}/#/settings`);
await page.waitForSelector("text=API keys");
await page.locator('label:has-text("My language") + select').selectOption("nl");
await page.waitForSelector(`text=${tr("nl", "cs.api_keys")}`, { timeout: 20_000 });
ok((await page.evaluate(() => document.documentElement.lang)) === "nl", "a person who chooses Dutch gets the console in Dutch");
await page.goto(`${ORIGIN}/#/overview`);
await page.waitForSelector(`text=${tr("nl", "cs.waits_head")}`, { timeout: 20_000 });
await settle();
const nlText = await page.innerText("main");
ok(nlText.includes(tr("nl", "cs.nav.overview")) && !/\b(Overview|Invoices|Waits for|Supplier|Overdue|Blocked|Sign out)\b/.test(nlText), "the Dutch overview has no English words");
ok(/€\s?\d{1,3}(\.\d{3})*,\d{2}/.test(nlText), "amounts are written the Dutch way (€ 1.309,00)");
// No raw message keys on a Dutch page (the console once showed nav.invoices, ov.tile.open and test.label as words).
const rawKeys = await page.evaluate(() => (document.body.textContent ?? "").split(/\s+/).filter((w) => /^[a-z]+(\.[a-z0-9_]+)+$/.test(w) && !/\.(js|pdf|csv|json|eml|com|nl|io|ai|test)$/.test(w)));
ok(rawKeys.length === 0, `no raw message keys on the Dutch console${rawKeys.length ? ` (found ${rawKeys.slice(0, 5).join(", ")})` : ""}`);
await shot("19-overzicht-nederlands");
// The Dutch books and settings (screenshot pass, 9 November): no English left in the journal, the VAT overview or the
// key names, a role or status pill on one line, no "nothing this quarter" above input VAT, the nav on a phone in view.
await page.goto(`${ORIGIN}/#/books`);
await page.waitForSelector(`text=${tr("nl", "cs.vat_overview")}`, { timeout: 20_000 });
await page.waitForSelector("text=#1", { timeout: 20_000 });
await settle();
const booksText = await page.innerText("main");
ok(!/\(received\)|Transfer fee|balance before the run|sandbox test money|\binvoice\b/.test(booksText), "the Dutch journal has no English entries");
ok(!(booksText.includes(tr("nl", "cs.nothing_quarter")) && !/5b[^\n]*€\s?0,00/.test(booksText)), "the VAT overview never says 'nothing this quarter' above input VAT");
await page.goto(`${ORIGIN}/#/settings`);
await page.waitForSelector(`text=${tr("nl", "cs.api_keys")}`, { timeout: 20_000 });
await page.waitForSelector("text=runner", { timeout: 20_000 });
await page.waitForSelector("#integrations dl", { timeout: 20_000 });
await settle();
const setText = await page.innerText("main");
ok(!/first owner's passkey only|runner \(sync\)/.test(setText), "the Dutch settings name Purser's own keys in Dutch");
// Koppelingen (docs/moneybird.md): this test world never synced to an ERP, so Moneybird reads "niet gekoppeld".
const ints = await page.innerText("#integrations");
ok(ints.includes(tr("nl", "cs.int.title")) && ints.includes("Moneybird") && ints.includes(tr("nl", "cs.int.status.not_connected")) && ints.includes("documents"), "the Dutch settings show the Koppelingen card: Moneybird, niet gekoppeld, and how to connect it");
if (shots) await page.locator("#integrations").screenshot({ path: join(shots, "16-koppelingen.png") });
const tallPills = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".pill")].filter((p) => p.getBoundingClientRect().height > 32).map((p) => p.textContent));
ok(tallPills.length === 0, `every role and status pill stays on one line${tallPills.length ? ` (${tallPills.join(", ")})` : ""}`);
{
  const was = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  const off = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("nav.tabs a")].filter((a) => a.getBoundingClientRect().right > window.innerWidth + 0.5).map((a) => a.textContent));
  ok(off.length === 0, `at 390 px every page in the nav is in view${off.length ? ` (cut: ${off.join(", ")})` : ""}`);
  if (was) await page.setViewportSize(was);
}
if (shots) {
  const was = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  await shot("19b-overzicht-nederlands-telefoon");
  if (was) await page.setViewportSize(was);
}
await page.goto(`${ORIGIN}/#/settings`);
await page.locator(`label:has-text("${tr("nl", "cs.language_mine")}") + select`).selectOption("");
await page.waitForSelector("text=API keys", { timeout: 20_000 });
ok((await page.evaluate(() => document.documentElement.lang)) === "en", "following the company again brings its English back");

// An ended session goes back to sign-in, with a word about why.
await page.evaluate(() => { const k = "purser.cloud.session"; const s = JSON.parse(sessionStorage.getItem(k) ?? "{}"); s.exp = Date.now() + 60_000; s.token = "pcs.expired.token"; sessionStorage.setItem(k, JSON.stringify(s)); });
await page.goto(`${ORIGIN}/#/invoices`);
await page.waitForSelector("text=Your sign-in ended");
ok(true, "a session the cloud no longer takes goes back to sign-in, saying why");
await page.setViewportSize({ width: 1440, height: 1000 });

// 401 (an ended session) and 409 (the last owner passkey refused) are answers the check asks for, not errors.
// A 403 is the step-up walk's own first answer (step_up_required), which the console turns into a passkey check.
ok(errors.filter((e) => !/(401 \(Unauthorized\)|409 \(Conflict\))/.test(e) && !(stepUps.length && /403 \(Forbidden\)/.test(e))).length === 0, `no console or CSP errors${errors.length ? ` (${errors.join(" | ")})` : ""}`);
ok(urls.length > 0 && !urls.some((u) => new URL(u).pathname.startsWith("/v1/engine")), "a cloud with no engine: its console never asked for one (no /v1/engine request)");
await ctx.close();
server.close();

// --- The engine pass ------------------------------------------------------------------------------------------------
// A second cloud that runs an engine (cloud/src/engine/node.ts: test money on a stand-in bank inside Purser), with its
// own database, blobs and port, and a company of its own (an engine starts its ledger at AP-0001, which would collide
// with the test world's invoices above). Its own browser context holds its own passkey. The steps are functions over
// one EnginePass, so the next ones (pay, the approval passkey, approve) follow the upload in the same form.
interface EnginePass { origin: string; page: Page; errors: string[]; settle(): Promise<void>; invoiceId: string; pdf: Buffer }
async function enginePass() {
  const port = PORT + 100;
  const origin = `http://localhost:${port}`;
  const envE = cloudEnv(origin, join(dir, "engine-blobs"));
  envE.engine = nodeEngines({ sql: envE.sql, blobs: envE.blobs, rpId: "localhost", origin });
  const serverE = await serve(envE, port);
  const callE = caller(origin);
  const madeE = await callE("POST", "/v1/admin/tenants", ADMIN, { slug: "harbour", name: "Harbour Tools (test company)", owner: { display_name: "The CFO" } });
  ok(madeE.status === 201 && (await callE("POST", "/v1/company", madeE.json.api_key as string, { language: "en" })).status === 200, "engine pass: a company of its own on a cloud that runs an engine, in English");
  const { ctx: ctxE, page: p, errors: errs, cdp: cdpE, internal: internalE } = await passkeyContext();
  await firstRun(p, origin, "harbour", madeE.json.api_key as string);
  const E: EnginePass = { origin, page: p, errors: errs, settle: () => settleOn(p), invoiceId: "", pdf: await pdfOf(EN) };
  await engineUpload(E);
  const proposal = await enginePay(E);
  await engineSetUp(E);
  await engineApprove(E, proposal);
  await engineProof(E);
  await engineArchive(E);
  await engineClaude(E);
  await engineSecondKey(E, cdpE, internalE);
  ok(errs.length === 0, `engine pass: no console or CSP errors${errs.length ? ` (${errs.join(" | ")})` : ""}`);
  await ctxE.close();
  await engineGuestArchive(origin);
  serverE.close();
}

/**
 * Review, 13 Nov (the live purser-try runs an engine): a guest, who has none, opened #/archive and read "Could not load
 * this page: no such route", GET /v1/engine/vault having answered 404 with an error in the console. The page now asks
 * the engine first: the guest reads why there is no archive, with a way back, and the vault is never asked.
 */
async function engineGuestArchive(origin: string) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  const errors: string[] = [], vault: string[] = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("request", (r) => { if (r.url().includes("/v1/engine/vault")) vault.push(r.url()); });
  await p.goto(`${origin}/#/sign-in`);
  await p.waitForSelector("#guest");
  await p.click("#guest");
  await p.waitForSelector(".dash", { timeout: 20_000 });
  await p.goto(`${origin}/#/archive`);
  await p.waitForSelector("text=kept by Purser's engine", { timeout: 10_000 }).catch(() => {});
  const text = (await p.textContent("main")) ?? "";
  ok(/kept by Purser's engine/.test(text) && !/Could not load/.test(text) && vault.length === 0 && errors.length === 0, `engine cloud, guest: #/archive says the archive needs the engine, asks the vault nothing, no console error${errors.length ? ` (${errors.join(" | ")})` : ""}`);
  await c.close();
}

/**
 * A second key for high-risk payments (src/policy/secondKey.ts), with two of Chromium's virtual authenticators on one
 * page: the internal one (the platform passkey, Face ID) and a USB one (a cross-platform security key). The owner adds the
 * security key in Settings, Security; sets the rule (at or above EUR 1000.00) with Face ID; then a EUR 1,309.00 invoice
 * waits on Face ID alone, the page says why and asks for the key, and it is approved once the key signs the same terms.
 */
async function engineSecondKey(E: EnginePass, cdp: CDPSession, internal: string) {
  const p = E.page;
  const { authenticatorId: usb } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  // A person touches one authenticator at a time: Face ID on the phone, or the key in the USB port. Only the one in use
  // answers (with two answering at once, Chromium's virtual environment ends the request).
  const touch = async (which: "face" | "key") => {
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: internal, enabled: which === "face" });
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: usb, enabled: which === "key" });
  };
  await touch("key");
  await p.goto(`${E.origin}/#/settings`);
  await p.waitForSelector("#add-key");
  ok(!(await p.isChecked("#step-up")), "second key: Settings, Security shows \"Ask again before sensitive changes\" off by default");
  await p.click("#add-key");
  await p.waitForSelector("#security .note-ok", { timeout: 20_000 });
  const onUsb = (await cdp.send("WebAuthn.getCredentials", { authenticatorId: usb })).credentials;
  ok(onUsb.length === 1 && /Security key added/.test((await p.textContent("#security")) ?? ""), `second key: "Add a security key" registers a credential on the USB authenticator (${onUsb.length})`);
  await touch("face");
  await p.fill("#second-key-eur", "1000.00");
  await p.click("#second-key-save");
  await p.waitForSelector("#second-key-save:not([disabled])", { timeout: 20_000 });
  await p.waitForFunction(() => /Saved|refused|failed|cancel|not|first/i.test(document.querySelector("#security")?.lastElementChild?.previousElementSibling?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
  const saved = (await p.textContent("#security")) ?? "";
  ok(saved.includes("Saved: approved with your Face ID."), `second key: the rule (at or above EUR 1000.00) is saved with the CFO's Face ID (${saved.slice(saved.indexOf("Save with Face ID"), saved.indexOf("Save with Face ID") + 200)})`);
  await p.goto(`${E.origin}/#/invoices`);
  await p.waitForSelector("#eng-file", { state: "attached" });
  const big = EN.replaceAll("BTX-2026-21", "BTX-2026-24").replace("Subtotal EUR 1,554.62", "Subtotal EUR 1,100.00").replace("VAT 19% EUR 295.38", "VAT 19% EUR 209.00").replace("Total due EUR 1,850.00", "Total due EUR 1,309.00");
  await p.setInputFiles("#eng-file", { name: "bergtex-BTX-2026-24.pdf", mimeType: "application/pdf", buffer: await pdfOf(big) });
  await p.waitForSelector("#view .note-ok", { timeout: 30_000 });
  const id = /as (AP-\d+)\./.exec((await p.textContent("#view .note-ok")) ?? "")?.[1] ?? "";
  await p.goto(`${E.origin}/#/invoices/${id}`);
  await p.waitForSelector("#pay .btn");
  await p.click("#pay .btn");
  await p.waitForSelector("#pay >> text=High-risk: amount at or above EUR 1000.00", { timeout: 20_000 });
  ok((await p.textContent("#pay .btn"))?.trim() === "Approve with passkey", "second key: a high-risk payment says why before anything is signed, and asks for Face ID first");
  const signs = async (authenticatorId: string) => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.reduce((n, c) => n + c.signCount, 0);
  const usbBefore = await signs(usb);
  await p.click("#pay .btn");
  await p.waitForSelector("#pay >> text=Touch your security key", { timeout: 20_000 });
  ok(/Touch your security key\./.test((await p.textContent("#pay")) ?? "") && await p.locator(".dhead .st.paid").count() === 0, "second key: on Face ID alone the payment keeps waiting, and the page asks for the security key");
  ok(await signs(usb) === usbBefore, "second key: the security key has not signed yet");
  await touch("key");
  await p.click("#pay .btn");
  await p.waitForSelector("#pay .note-ok", { timeout: 30_000 });
  ok(/approved/.test((await p.textContent("#pay .note-ok")) ?? "") && await signs(usb) > usbBefore, "second key: approved once the security key on the USB authenticator signed the same terms");
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: usb });
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: internal, enabled: true });
}

/** Settings, Connect Claude: the owner makes a token that may propose; it is shown once, with the Claude Code command. */
async function engineClaude(E: EnginePass) {
  const p = E.page;
  await p.goto(`${E.origin}/#/settings`);
  await p.waitForSelector("#claude-make");
  ok((await p.textContent("#claude .once code")) === `${E.origin}/mcp`, "Connect Claude: the page shows Purser's /mcp address");
  await p.fill("#claude-name", "Claude (finance)");
  await p.check("#claude-propose");
  await p.click("#claude-make");
  await p.waitForSelector("#claude ul.tokens li");
  const shown = (await p.locator("#claude .once code.cmd").allTextContents()).join(" ");
  ok(/pck_k[A-Za-z0-9]{12}_/.test(shown) && /claude mcp add --transport http purser .*\/mcp --header "Authorization: Bearer pck_/.test(shown), "Connect Claude: the new token is shown once, with the Claude Code command");
  ok(/Reads and proposes/.test((await p.textContent("#claude ul.tokens")) ?? ""), "Connect Claude: the token is listed as one that reads and proposes");
  ok((await p.locator("#view table td", { hasText: "Claude (finance)" }).count()) === 0, "Connect Claude: the token is not listed again among the API keys");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Connect Claude: nothing is wider than the screen");
  if (shots) await p.locator("#claude").screenshot({ path: join(shots, "connect-claude-1440.png") });
}

/** Upload an invoice on the Invoices page and watch the engine read it; a refused file and the same file again. */
async function engineUpload(E: EnginePass) {
  const p = E.page;
  await p.goto(`${E.origin}/#/invoices`);
  await p.waitForSelector("#work");
  await p.waitForSelector("#eng-file", { state: "attached" });
  // 12 Nov: the test-money chip sits in the console's own bar (.appbar) under the site's header (cloud/src/siteHeader.ts).
  ok((await p.textContent(".appbar .test .tl"))?.trim() === "Engine: test money", "engine pass: the header's test-money chip reads \"Engine: test money\"");
  ok(/stand-in bank.*Nothing is sent to Airwallex/.test((await p.textContent("#foot")) ?? ""), "engine pass: the footer says the engine pays on a stand-in bank and nothing goes to Airwallex");
  ok(/stand-in bank.*no real money.*nothing is sent to Airwallex/.test((await p.getAttribute(".appbar .test", "title")) ?? ""), "engine pass: the chip's title says the stand-in bank, no real money, nothing sent to Airwallex");
  ok((await p.$$(".appbar .test")).length === 1 && (await p.$$("header .test")).length === 0, "engine pass: one chip in the header, not two");
  ok(await p.isVisible(".appbar .test"), "engine pass: signed in, the test-money chip is visible");

  await p.setInputFiles("#eng-file", { name: "bergtex-BTX-2026-21.pdf", mimeType: "application/pdf", buffer: E.pdf });
  ok(await p.isDisabled("#view .drop.eng button"), "engine pass: while the upload runs its button is disabled");
  await p.waitForSelector("#view .note-ok", { timeout: 30_000 });
  const done = (await p.textContent("#view .note-ok")) ?? "";
  const id = /as (AP-\d+)\./.exec(done)?.[1] ?? "";
  E.invoiceId = id;
  ok(id === "AP-0001", `engine pass: the upload says where the invoice is in the list (${done})`);
  const row = p.locator(`a.row[href="#/invoices/${id}"]`);
  ok(await row.count() === 1 && await row.locator(".st.ready").count() === 1 && (await row.textContent())!.includes("BTX-2026-21"), "engine pass: after the sync the list shows the uploaded invoice once, ready to pay");
  await p.waitForSelector("#work li", { timeout: 10_000 });
  const lines = await p.$$eval("#work li", (ls) => ls.map((l) => ({ time: l.querySelector("time")?.textContent ?? "", who: l.querySelector("b")?.textContent ?? "", text: l.querySelector("span")?.textContent ?? "" })));
  const received = lines.find((l) => /came in and was checked/.test(l.text));
  ok(!!received && received.who === "The parser" && /^\d{2}:\d{2}:\d{2}$/.test(received.time), `engine pass: the panel "At work" shows the received line, who and when (${JSON.stringify(received ?? lines[0] ?? null)})`);
  ok(await p.locator("#work ol[aria-live] li").count() <= 6 && await p.getAttribute("#work ol[aria-live]", "aria-live") === "polite", "engine pass: the panel shows at most six lines in view, in a polite live region");
  await E.settle();

  // The screenshots: the Invoices page with the panel, after the upload, laptop and phone, light and dark.
  const wide = async () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const [w, h] of [[1440, 1000], [390, 844]] as const) {
    await p.setViewportSize({ width: w, height: h });
    for (const scheme of ["light", "dark"] as const) {
      await p.emulateMedia({ colorScheme: scheme });
      await p.waitForTimeout(150);
      if (shots) await p.screenshot({ path: join(shots, `engine-01-upload-${w}-${scheme}.png`), fullPage: true });
    }
  }
  await p.emulateMedia({ colorScheme: "light" });
  const over = await wide();
  ok(over <= 0, `engine pass: the Invoices page at 390 px is no wider than the phone (${over} px over)`);
  const head = await p.evaluate(() => {
    // (No named function in here: the bundler would wrap it in a helper the page does not have.)
    // 12 Nov: the first row of the console's bar (.appbar), beside the company and sign-out; the brand is the site header's now.
    const chip = document.querySelector(".appbar .test")!.getBoundingClientRect(), brand = document.querySelector(".appbar .who-am-i")!.getBoundingClientRect();
    return { sameRow: Math.abs(chip.top - brand.top) < 12, inView: chip.right <= window.innerWidth, label: getComputedStyle(document.querySelector(".appbar .test .tl")!).display };
  });
  ok(head.sameRow && head.inView && head.label === "none", `engine pass: at 390 px the chip keeps to the header's first row as an icon, as before (${JSON.stringify(head)})`);
  await p.setViewportSize({ width: 1440, height: 1000 });

  // A file that says it is a PDF but is not one: the engine refuses it, and the page says so in the engine's words.
  const before = E.errors.length;
  await p.setInputFiles("#eng-file", { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some words") });
  await p.waitForSelector("#view .note-bad", { timeout: 20_000 });
  const refused = (await p.textContent("#view .note-bad")) ?? "";
  ok(/^notes\.pdf .*nothing was filed$/.test(refused), `engine pass: a refused upload shows the engine's own sentence (${refused})`);
  // The refused upload's 400 is the answer this step asks for; it is the only error tolerated, and only here.
  const during = E.errors.splice(before);
  ok(during.every((e) => /400 \(Bad Request\)/.test(e)), `engine pass: the refused upload logs nothing but its 400 (${during.join(" | ")})`);
  // Refused in the page before anything is sent: a file of another kind.
  await p.setInputFiles("#eng-file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just some words") });
  await p.waitForSelector("text=Only a PDF, JPEG or PNG can be uploaded");
  ok(true, "engine pass: a file of another kind is refused in the page, in words, before sending");

  // The same file again: already filed, with a link to its invoice.
  await p.setInputFiles("#eng-file", { name: "bergtex-again.pdf", mimeType: "application/pdf", buffer: E.pdf });
  await p.waitForSelector("text=This file was already filed", { timeout: 20_000 });
  ok(await p.locator(`#view .note-info a[href="#/invoices/${id}"]`).count() === 1, "engine pass: the same file again says it was already filed, with a link to its invoice");
  ok(await p.locator("a.row").count() === 1, "engine pass: the list still holds the invoice once");

  // The invoice's own page opens, with the document drawn.
  await p.click(`a.row[href="#/invoices/${id}"]`);
  await p.waitForSelector(".card.paper") /* 14 Nov: the invoice reads as a document; was "What Purser read" */;
  await p.frameLocator("iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 });
  ok((await p.textContent("main"))!.includes("Bergtex Textil GmbH"), "engine pass: the uploaded invoice's page opens, its PDF drawn");
  await E.settle();
}

/** A GET of the cloud's API as the page's own signed-in session, from inside the page. */
async function apiAs(E: EnginePass, path: string): Promise<Record<string, unknown>> {
  return E.page.evaluate(async (path) => {
    const s = JSON.parse(sessionStorage.getItem("purser.cloud.session") ?? "{}") as { token?: string };
    return (await fetch(path, { headers: { authorization: `Bearer ${s.token ?? ""}` } })).json() as Promise<Record<string, unknown>>;
  }, path);
}
/** Screenshots of the page at a width and in a colour scheme, then back to laptop width in light. */
async function engineShot(E: EnginePass, name: string, width: 1440 | 390, scheme: "light" | "dark") {
  const p = E.page;
  await p.setViewportSize(width === 1440 ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
  await p.emulateMedia({ colorScheme: scheme });
  await p.waitForTimeout(150);
  if (shots) await p.screenshot({ path: join(shots, `engine-${name}-${width}-${scheme}.png`), fullPage: true });
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (width === 390) ok(over <= 0, `engine pass: ${name} at 390 px is no wider than the phone (${over} px over)`);
  await p.emulateMedia({ colorScheme: "light" });
  await p.setViewportSize({ width: 1440, height: 1000 });
}
type Proposal = { id: string; status: string; terms_sha256: string; challenge: string; facts: [string, string][]; warnings: string[] };

/** On the invoice's page, "Pay…" files the payment: the proposal shows the engine's facts, the stand-in bank, the fingerprint folded. */
async function enginePay(E: EnginePass): Promise<Proposal> {
  const p = E.page;
  await p.waitForSelector("#pay");
  ok((await p.textContent("#pay"))!.includes("Ready to pay. Nothing is paid until a passkey approves the exact terms."), "engine pass: the payment card says the invoice is ready, and that nothing is paid before a passkey approves");
  ok(await p.locator("#pay .btn").count() === 1 && (await p.textContent("#pay .btn"))?.trim() === "Pay…", "engine pass: the card's one button reads \"Pay…\"");
  ok(await p.locator("#view #work").count() === 1, "engine pass: the panel \"At work\" is on the invoice's page too");
  // The answer is held back a moment, so the button can be seen working meanwhile.
  await p.route("**/v1/engine/invoices/*/pay", async (r) => { await new Promise((done) => setTimeout(done, 600)); await r.continue(); });
  const answer = p.waitForResponse((r) => /\/v1\/engine\/invoices\/[^/]+\/pay$/.test(r.url()) && r.request().method() === "POST");
  await p.click("#pay .btn");
  ok(await p.isDisabled("#pay .btn") && (await p.textContent("#pay .btn"))?.trim() === "Working …", "engine pass: while the payment is filed its button is off and says it is working");
  const res = await answer;
  // The route stays until the page's own follow-up (the sync) is answered: removing the last route while that request is
  // paused for interception can leave it hanging, so the page never heard back (seen once in four runs).
  const proposal = ((await res.json()) as { proposal: Proposal }).proposal;
  ok(res.status() === 200 && /^[0-9a-f]{64}$/.test(proposal.terms_sha256) && proposal.status === "PENDING_APPROVAL", `engine pass: "Pay…" filed the payment (${proposal.id})`);
  await p.waitForSelector("#pay dl.read");
  const shown = await p.$$eval("#pay dl.facts dt", (ds) => ds.map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""]));
  ok(await p.locator("#pay > dl.facts dt").count() === Math.min(4, proposal.facts.length), "engine pass: the first four facts are in view, the rest in a fold, as on the phone page");
  ok(JSON.stringify(shown) === JSON.stringify(proposal.facts) && shown.length > 0, `engine pass: the proposal shows the engine's facts as it gives them (${shown.length} facts, the first ${JSON.stringify(shown[0])})`);
  ok((await p.textContent("#pay .note-info"))?.trim() === tr("en", "cs.eng.stand_in"), "engine pass: beside the facts, the line that it runs on the stand-in bank with test money and nothing is sent to Airwallex");
  ok((await p.textContent("#pay p.fine"))?.trim() === "The passkey signs exactly these terms. If one of them changes, the approval fails.", "engine pass: one sentence says the passkey signs exactly these terms");
  ok(!(await p.isVisible("#pay details dd.mono")), "engine pass: the terms' fingerprint is folded away at first");
  await p.click("#pay details:has(dl.facts) summary");
  await p.click("#pay details:has(dd.mono) summary");
  const hash = (await p.textContent("#pay details dd.mono"))?.trim() ?? "";
  ok(hash === proposal.terms_sha256 && hash.length === 64, `engine pass: the fold holds the whole terms hash, as the API gives it (${hash})`);
  ok((await p.$$eval("#pay details dd.mono", (ds) => ds.map((d) => d.textContent)))[1] === proposal.id, "engine pass: and the request's id, last");
  // The head follows the engine once it fed the read model: the invoice waits for its approval.
  await p.waitForSelector(".dhead .st.waiting_cfo", { timeout: 10_000 });
  ok(true, "engine pass: after filing, the page's status chip says the invoice waits for its approval");
  await p.unroute("**/v1/engine/invoices/*/pay");
  await E.settle();
  await engineShot(E, "02-proposal", 1440, "light");
  await engineShot(E, "02-proposal", 390, "dark");
  return proposal;
}

/** The first time: set up approval on this device, with the engine's enrolment window and this context's virtual authenticator. */
async function engineSetUp(E: EnginePass) {
  const p = E.page;
  ok((await apiAs(E, "/v1/engine")).passkey === null, "engine pass: the engine has no approval passkey yet");
  ok((await p.textContent("#pay .btn"))?.trim() === "Set up approval on this device", "engine pass: so the card's button reads \"Set up approval on this device\"");
  await p.click("#pay .btn");
  await p.waitForSelector("text=Approval is set up on this device.", { timeout: 20_000 });
  const pk = (await apiAs(E, "/v1/engine")).passkey as { credential_id: string; label: string } | null;
  ok(!!pk && /^[A-Za-z0-9_-]{16,}$/.test(pk.credential_id) && pk.label === "The CFO", `engine pass: the passkey made in the page is the engine's approval passkey now (${JSON.stringify(pk)})`);
  ok((await p.textContent("#pay .btn"))?.trim() === "Approve with passkey", "engine pass: the button now reads \"Approve with passkey\"");
}

/**
 * The approval: first over other terms, refused in the engine's words; then the real one, which pays.
 * Changing only terms_sha256 in the approve request's body is not refused: the engine checks the signature against the
 * terms it holds and does not compare the body's hash (src/passkey/process.ts processAssertion), so that request is
 * approved. The other terms are therefore put where the page reads the proposal (its GET /v1/engine/invoices): the page
 * then shows them, the passkey signs them and the request carries their terms_sha256, as a page showing other terms would.
 * Order: the spec's "second pass" runs first here; it proves the same and leaves the proposal to approve for real.
 */
async function engineApprove(E: EnginePass, proposal: Proposal) {
  const p = E.page;
  const id = E.invoiceId;
  const approveUrl = /\/v1\/engine\/proposals\/[^/]+\/approve$/;
  const challengeOf = (hex: string) => Buffer.from(hex, "hex").toString("base64url");
  ok(challengeOf(proposal.terms_sha256) === proposal.challenge, "engine pass: what the passkey signs is the terms hash's 32 bytes");
  const other = createHash("sha256").update("other terms").digest("hex");
  ok(other !== proposal.terms_sha256, "engine pass: the other terms' hash is another 64-hex value");
  await p.route("**/v1/engine/invoices", async (r) => {
    const real = await r.fetch();
    const j = (await real.json()) as { items: { id: string; proposal: Proposal | null }[] };
    for (const i of j.items) if (i.id === id && i.proposal) i.proposal = { ...i.proposal, terms_sha256: other, challenge: challengeOf(other) };
    await r.fulfill({ response: real, json: j });
  });
  await p.reload();
  await p.waitForSelector("#pay .btn");
  await p.click("#pay details:has(dd.mono) summary");
  ok((await p.textContent("#pay details dd.mono"))?.trim() === other, "engine pass: the page shows the other terms' fingerprint, the one its passkey will sign");
  let answer = p.waitForResponse((r) => approveUrl.test(r.url()) && r.request().method() === "POST");
  await p.click("#pay .btn");
  let res = await answer;
  ok((JSON.parse(res.request().postData() ?? "{}") as { terms_sha256?: string }).terms_sha256 === other, "engine pass: the approval request carries the other terms_sha256");
  const refused = (await res.json()) as { status: string; message: string; settled: unknown };
  ok(refused.status === "refused" && refused.settled === null, `engine pass: a signature over other terms is refused by the engine (${refused.message})`);
  await p.waitForSelector("#pay .note-bad");
  ok((await p.textContent("#pay .note-bad"))?.trim() === refused.message, "engine pass: the page shows the refusal as the engine words it");
  ok(await p.locator(".dhead .st.paid").count() === 0 && await p.locator("#pay .note-ok").count() === 0, "engine pass: nothing on the page says paid or approved");
  ok(!(await p.isDisabled("#pay .btn")) && (await p.textContent("#pay .btn"))?.trim() === "Approve with passkey", "engine pass: the button is back");
  await p.click("#pay details:has(dd.mono) summary");
  await engineShot(E, "02-refused", 390, "light");
  await p.unroute("**/v1/engine/invoices");
  ok((((await apiAs(E, "/v1/engine/invoices")).items as { id: string; status: string }[]).find((i) => i.id === id)?.status) === "waiting_cfo", "engine pass: after the refusal the invoice is still not paid (the engine)");
  ok(((await apiAs(E, `/v1/invoices/${id}`)).status) === "waiting_cfo", "engine pass: nor in the read model");

  // The page again, with the engine's own proposal: approve properly.
  await p.reload();
  await p.waitForSelector("#pay .btn");
  await p.click("#pay details:has(dd.mono) summary");
  ok((await p.textContent("#pay details dd.mono"))?.trim() === proposal.terms_sha256, "engine pass: on the page again, the engine's own terms and fingerprint");
  await p.click("#pay details:has(dd.mono) summary");
  answer = p.waitForResponse((r) => approveUrl.test(r.url()) && r.request().method() === "POST");
  await p.click("#pay .btn");
  res = await answer;
  ok((JSON.parse(res.request().postData() ?? "{}") as { terms_sha256?: string }).terms_sha256 === proposal.terms_sha256, "engine pass: this time the request carries the proposal's own terms_sha256");
  const approved = (await res.json()) as { status: string; message: string; settled: { invoice_status: string; error: string | null } | null };
  ok(approved.status === "approved" && approved.settled?.invoice_status === "paid", `engine pass: the real signature is approved and paid on the stand-in bank (${approved.message})`);
  await p.waitForSelector("#pay .note-ok");
  ok((await p.textContent("#pay .note-ok"))?.trim() === approved.message, "engine pass: the page shows the engine's approved message as it words it");
  ok(approved.settled?.error === null ? await p.locator("#pay .note-warn").count() === 0 : (await p.textContent("#pay .note-warn"))!.includes(approved.settled!.error!), "engine pass: what failed after the approval, if anything, is said; here nothing did");
  await p.waitForSelector(".dhead .st.paid", { timeout: 10_000 });
  const read = await apiAs(E, `/v1/invoices/${id}`);
  ok((await p.textContent(".dhead .st.paid"))?.trim() === read.status_words && read.status_words === tr("en", "status.paid"), `engine pass: the page's status chip reads the paid words (${read.status_words as string})`);
  ok((((await apiAs(E, "/v1/invoices?limit=200")).items as { id: string; status: string }[]).find((i) => i.id === id)?.status) === "paid", "engine pass: GET /v1/invoices shows the invoice paid");
  await p.waitForFunction(() => /payment of .* was sent at the stand-in bank/.test(document.querySelector("#work")?.textContent ?? "") && /New files in the archive/.test(document.querySelector("#work")?.textContent ?? ""), undefined, { timeout: 15_000 });
  ok(true, "engine pass: the panel \"At work\" carries on: sent at the stand-in bank, filed in the archive");
  await E.settle();
  await engineShot(E, "02-approved", 1440, "dark");
  await engineShot(E, "02-approved", 390, "light");
}

type Payment = { id: string; invoice_no: string; status: string; amount: string; currency: string; fee_actual: string | null; transfer_id: string | null; method: string; updated_at: string };
type Entry = { entry_id: number; source_key: string | null; reverses: number | null; entry_hash: string; lines: { account: string; debit_cents: number; credit_cents: number }[] };
type VaultFile = { path: string; kind: string; bytes: number; sha256: string; added_at: string };
/** Every page of a list route, as the page's session. */
async function allAs<T>(E: EnginePass, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let cursor: string | null = null, n = 0; n < 50; n++) {
    const r = await apiAs(E, `${path}${path.includes("?") ? "&" : "?"}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...(r.items as T[]));
    cursor = (r.next_cursor as string | null) ?? null;
    if (!cursor) break;
  }
  return out;
}
const enMoney = (currency: string, amount: string) => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The paid invoice's proof, right after the approval and on the page again: paid (the payment as GET /v1/payments has
 * it, labelled stand-in bank and test money), booked (this invoice's journal lines, debits equal to credits, and the
 * ledger chain's head) and archived (the original and the receipt, one opened in the sandboxed frame). Every value is
 * compared to what the API answers; none is typed here.
 */
async function engineProof(E: EnginePass) {
  const p = E.page;
  const id = E.invoiceId;
  await p.waitForSelector("#proof .pb.paid:not(.wait)", { timeout: 15_000 });
  await p.waitForSelector("#proof .pb.archived:not(.wait)", { timeout: 15_000 });
  ok(await p.locator("#pay + #proof").count() === 1, "proof: right after the approval the proof follows the payment card, which keeps the engine's message");

  const inv = await apiAs(E, `/v1/invoices/${id}`) as { invoice_no: string; vendor: string; doc_sha256: string; status: string };
  const pay = (await allAs<Payment>(E, "/v1/payments")).filter((x) => x.invoice_no === `${inv.invoice_no} · ${inv.vendor}`);
  ok(pay.length === 1 && pay[0]!.status === "PAID", `proof: GET /v1/payments holds this invoice's one payment, by the read model's link (${JSON.stringify(pay.map((x) => x.status))})`);
  const pm = pay[0]!;
  const tx = (await allAs<{ id: string; fee: { amount: string; currency: string } | null; proof: string | null; booking: { entry_ids: number[] }; invoice: { ap_id: string | null } | null }>(E, "/v1/transactions")).find((x) => x.id === `transfer:${pm.id}`);
  ok(!!tx && tx.invoice?.ap_id === id, "proof: the transactions register's row of that payment names this invoice");

  // Paid.
  const paidLine = (await p.textContent("#proof .pb.paid p.pr")) ?? "";
  ok(paidLine.includes(pm.status) && paidLine.includes(enMoney(pm.currency, pm.amount)), `proof: the paid line shows the payment's status and amount as the API gives them (${paidLine})`);
  ok(await p.isVisible("#proof .pb.paid .pill.warn") && (await p.textContent("#proof .pb.paid .pill.warn"))?.trim() === tr("en", "cs.eng.test_bank"), "proof: the paid block itself says \"Stand-in bank, test money\"");
  ok(!(await p.isVisible("#proof .pb.paid details dl")), "proof: the transfer's details are folded at first");
  await p.click("#proof .pb.paid summary");
  const paidDl = Object.fromEntries(await p.$$eval("#proof .pb.paid dl dt", (ds) => ds.map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""])));
  const fee = /^([A-Z]{3}) (\d+\.\d{2})$/.exec(pm.fee_actual ?? "");
  ok(!!fee && paidDl["Bank fee"] === enMoney(fee[1]!, fee[2]!) && tx?.fee?.amount === fee[2], `proof: the fee is the payment's own, and the register agrees (${paidDl["Bank fee"]})`);
  ok(paidDl["Transfer reference"] === pm.transfer_id && pm.transfer_id === tx?.proof && paidDl["Payment id"] === pm.id, `proof: the transfer's reference and the payment's id, last (${paidDl["Transfer reference"]}, ${paidDl["Payment id"]})`);

  // Booked.
  const entries = await allAs<Entry>(E, "/v1/ledger/entries");
  const ids = new Set(tx?.booking.entry_ids ?? []);
  const mine = entries.filter((e) => (e.source_key ?? "").split("@")[0] === `ap-accrual|${id}` || ids.has(e.entry_id));
  ok(mine.length >= 2 && mine.some((e) => (e.source_key ?? "").startsWith("ap-accrual|")) && ids.size > 0, `proof: the API holds this invoice's accrual and the payment's entries (${mine.map((e) => e.entry_id).join(", ")})`);
  await p.click("#proof .pb.booked summary");
  const shownIds = await p.$$eval("#proof .pb.booked tr.en td", (ts) => ts.map((td) => Number(/^#(\d+)/.exec(td.textContent ?? "")?.[1] ?? 0)));
  ok(JSON.stringify(shownIds) === JSON.stringify(mine.map((e) => e.entry_id)), `proof: the journal shows exactly those entries (${shownIds.join(", ")})`);
  const rows = await p.$$eval("#proof .pb.booked tr.ln", (trs) => trs.map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent ?? "")));
  const toC = (s: string) => (s ? Math.round(Number(s.replace(/[^\d.]/g, "")) * 100) : 0);
  const lines = mine.flatMap((e) => e.lines);
  const dr = rows.reduce((n, r) => n + toC(r[1]!), 0), cr = rows.reduce((n, r) => n + toC(r[2]!), 0);
  ok(rows.length === lines.length && rows.every((r, k) => r[0]!.startsWith(lines[k]!.account) && toC(r[1]!) === lines[k]!.debit_cents && toC(r[2]!) === lines[k]!.credit_cents), `proof: each line's account, debit and credit as the API gives them (${rows.length} lines)`);
  ok(dr > 0 && dr === cr && dr === lines.reduce((n, l) => n + l.debit_cents, 0), `proof: the lines' debits equal their credits (${dr} = ${cr} cents)`);
  ok((await p.textContent("#proof .pb.booked p.pr"))!.includes(tr("en", "cs.eng.booked_line", { n: mine.length })), "proof: the booked line says how many entries, and that debit equals credit");
  const head = entries[entries.length - 1]!;
  ok((await p.textContent("#proof .pb.booked dd.mono"))?.trim() === head.entry_hash && (await p.textContent("#proof .pb.booked dt"))!.includes(`#${head.entry_id}`), `proof: the ledger chain's head is the newest entry's own hash, as the API gives it (#${head.entry_id})`);

  // Archived.
  const files = (await apiAs(E, "/v1/engine/vault")).files as VaultFile[];
  const original = files.find((f) => f.kind === "invoice" && f.sha256 === inv.doc_sha256);
  const receipt = files.find((f) => f.kind === "receipt" && /\/Payments\//.test(f.path) && nameOf(f.path).includes(inv.invoice_no));
  const listed = await p.$$eval("#proof .pb.archived ul.files li", (ls) => ls.map((l) => [l.querySelector("button")?.textContent ?? "", l.querySelector(".fd")?.textContent ?? ""]));
  ok(!!original && !!receipt && JSON.stringify(listed) === JSON.stringify([original, receipt].map((f) => [nameOf(f!.path), f!.path.split("/").slice(1, -1).join(" / ")])), `proof: the archive block lists the original and the receipt, name and folder (${listed.map((l) => l[0]).join(" | ")})`);
  await p.click("#proof .pb.archived summary");
  ok(JSON.stringify(await p.$$eval("#proof .pb.archived dd.mono", (ds) => ds.map((d) => d.textContent))) === JSON.stringify([original!.sha256, receipt!.sha256]), "proof: their fingerprints, last, as the archive's index gives them");
  await p.click("#proof .pb.archived ul.files li:nth-child(2) button");
  await p.frameLocator("#proof iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 });
  ok(await p.getAttribute("#proof iframe.pdfframe", "sandbox") === "allow-scripts" && await p.getAttribute("#proof iframe.pdfframe", "title") === nameOf(receipt!.path), "proof: the receipt opens in the sandboxed frame and is drawn");

  // On the page again: nothing to pay, so the proof is first in the column; on a phone the column comes before the document.
  await p.reload();
  await p.waitForSelector("#proof .pb.archived:not(.wait)", { timeout: 15_000 });
  ok(await p.locator("#pay").count() === 0 && await p.locator(".stack > #proof:first-child").count() === 1, "proof: a paid invoice has no payment card; the proof is first in the column");
  const at = async () => p.evaluate(() => { const a = document.querySelector("#proof")!.getBoundingClientRect(), d = document.querySelector(".docv")!.getBoundingClientRect(); return { proofTop: a.top, docTop: d.top, proofLeft: a.left, docLeft: d.left }; });
  const wide = await at();
  ok(wide.docLeft < wide.proofLeft && Math.abs(wide.docTop - wide.proofTop) < 40, `proof: at 1440 px the document stays on the left and the proof on the right, as before (${JSON.stringify(wide)})`);
  await p.setViewportSize({ width: 390, height: 844 });
  const narrow = await at();
  ok(narrow.proofTop < narrow.docTop, `proof: at 390 px the proof comes before the document (${JSON.stringify(narrow)})`);
  await p.setViewportSize({ width: 1440, height: 1000 });
  await E.settle();
  await engineShot(E, "03-proof", 1440, "light");
  await engineShot(E, "03-proof", 390, "dark");

  // Before the read model has the payment, the paid block says so in one sentence and shows nothing as done.
  await p.route(/\/v1\/payments(\?|$)/, (r) => r.fulfill({ json: { items: [], next_cursor: null } }));
  await p.reload();
  await p.waitForSelector("#proof .pb.paid.wait", { timeout: 15_000 });
  ok((await p.textContent("#proof .pb.paid p.wt"))?.trim() === tr("en", "cs.eng.paid_wait") && await p.locator("#proof .pb.paid .pill").count() === 0, "proof: with no payment in the read model the paid block says it is not here yet, and shows no status");
  await p.unroute(/\/v1\/payments(\?|$)/);
  await p.reload();
  await p.waitForSelector("#proof .pb.paid:not(.wait)", { timeout: 15_000 });
}

/** The archive page, from the proof's link: the vault's folders with their Dutch names, collapsed below the year, a file drawn. */
async function engineArchive(E: EnginePass) {
  const p = E.page;
  await p.click("#proof a.arch");
  await p.waitForSelector(".archive details");
  ok((await p.textContent("main h1"))?.trim() === "Archive", "archive: the page opens from the proof's link, with its title");
  // Seven since 14 Nov (Agents and Tokenisation joined on 13 Nov; Invoices and Books are two tabs again); the archive is not one.
  ok(await p.locator("#tabs a").count() === 7 && await p.locator("#tabs a[aria-current]").count() === 0, "archive: the menu keeps its seven items");
  const files = (await apiAs(E, "/v1/engine/vault")).files as VaultFile[];
  ok(files.length >= 2 && await p.locator(".archive ul.files li").count() === files.length, `archive: every file of GET /v1/engine/vault is in the tree (${files.length})`);
  const tree = await p.$$eval(".archive details", (ds) => ds.map((d) => { let depth = 0; for (let x = d.parentElement; x; x = x.parentElement) if (x.tagName === "DETAILS") depth++; return { name: d.querySelector("summary")?.textContent ?? "", depth, open: (d as HTMLDetailsElement).open }; }));
  ok(tree.some((d) => d.name.startsWith("Purchase invoices")) && tree.some((d) => d.name.startsWith("Payments")), `archive: an English company's folders are in English (${tree.map((d) => d.name).join(" | ")})`);
  ok(tree.every((d) => d.open === d.depth < 2), "archive: the company and its years are open, everything below the year folded");
  await p.locator(".archive summary", { hasText: /^\d{4}-Q\d/ }).first().click();
  await p.locator(".archive summary", { hasText: /^Payments/ }).first().click();
  const receipt = files.find((f) => /\/Payments\//.test(f.path))!;
  const b = p.locator(".archive ul.files button", { hasText: nameOf(receipt.path) });
  ok(await b.isVisible(), "archive: opening the quarter and Payments shows the receipt");
  await b.click();
  await p.frameLocator(".docv iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 });
  ok((await p.textContent(".docv .bar2 .fn"))?.trim() === nameOf(receipt.path) && await p.getAttribute(".docv iframe.pdfframe", "sandbox") === "allow-scripts", "archive: the file opens in the same sandboxed frame, its name above it");
  await E.settle();
  await engineShot(E, "03-archive", 1440, "dark");
  await engineShot(E, "03-archive", 390, "light");
  // The Books page links to the archive too.
  await p.goto(`${E.origin}/#/books`);
  await p.waitForSelector(".head a[href=\"#/archive\"]");
  ok(true, "archive: the Books page links to it");
}

await enginePass();

/**
 * Try as guest (13 Nov): from the sign-in, one click opens the demo company read only, its ribbon on top and the
 * dashboard first; at laptop and phone width, with motion and without: no console or CSP error, nothing wider than the
 * screen, the charts drawn, and no way to write (no upload, no keys, no people).
 */
async function guestPass() {
  // A cloud of its own, fresh: the demo company is made on the first guest's click.
  const port = PORT + 200;
  const ORIGIN = `http://localhost:${port}`;
  const serverG = await serve(cloudEnv(ORIGIN, join(dir, "guest-blobs")), port);
  for (const [width, height, motion] of [[1440, 1000, "no-preference"], [390, 844, "no-preference"], [390, 844, "reduce"]] as const) {
    const tag = `guest ${width}x${height} ${motion}`;
    const c = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, deviceScaleFactor: shots ? 2 : 1 });
    const p = await c.newPage();
    const errors: string[] = [];
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${ORIGIN}/#/sign-in`);
    await p.waitForSelector("#guest");
    await p.click("#guest");
    await p.waitForSelector(".dash", { timeout: 20_000 });
    // Review, 13 Nov: no empty band below the first screen. Without any scroll (a page read whole, or a full-page
    // screenshot), every card has risen in, the ones below the first screen too.
    await p.waitForTimeout(600);
    const hidden = await p.evaluate(() => [...document.querySelectorAll(".dash .rise")].filter((n) => getComputedStyle(n).opacity !== "1").length);
    ok(hidden === 0, `${tag}: no empty band: every card is shown without scrolling (${hidden} hidden)`);
    // The console is not one of the site's pages: its header marks no item ("More" was marked on every page).
    ok(await p.locator('header.top summary.on, header.top a[aria-current="page"]').count() === 0, `${tag}: the site header marks no menu item on the console`);
    // Review, 13 Nov, at 390 px: no page wraps onto a line of its own ("Settings" did), and below 420 px the company chip shows the company's own name whole ("Northwind Outdoor (d…" was cut).
    const tabs = await p.locator("#tabs a").evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().top)));
    // Jury round 2, 13 Nov: on a phone the six pages are two rows of three (they need about 480 px of a 390 px screen;
    // one scrolling row cut "Toke…" even under a fade); wider, one row. Either way every tab is whole, inside the bar.
    const rows = new Set(tabs).size;
    ok(width < 640 ? rows === 2 && tabs.filter((t) => t === tabs[0]).length === 3 : rows === 1, `${tag}: the pages are ${width < 640 ? "two rows of three" : "one row"} (${tabs.join(", ")})`);
    const cut = await p.evaluate(() => { const nav = document.querySelector("#tabs") as HTMLElement; const r = nav.getBoundingClientRect(); return [...nav.querySelectorAll("a")].filter((a) => { const b = a.getBoundingClientRect(); return b.right > Math.min(r.right, innerWidth) + 1 || b.left < -1 || a.scrollWidth > a.clientWidth + 1; }).map((a) => (a as HTMLElement).innerText.trim()); });
    ok(cut.length === 0, `${tag}: every tab is whole, none cut or off the screen (${JSON.stringify(cut)})`);
    if (width < 420) {
      const chip = await p.evaluate(() => { const cn = document.querySelector("#co .cn") as HTMLElement | null; return cn ? { text: cn.innerText.trim(), cut: cn.scrollWidth > cn.clientWidth + 1 } : null; });
      ok(chip?.text === "Northwind Outdoor" && !chip.cut, `${tag}: the company chip reads "Northwind Outdoor", whole (${JSON.stringify(chip)})`);
    }
    for (let y = 0; y < 6000; y += 500) { await p.mouse.wheel(0, 500); await p.waitForTimeout(120); }
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(1600);
    ok(await p.isVisible("#demo") && /Demo company/.test((await p.textContent("#demo")) ?? ""), `${tag}: the demo ribbon says what it is`);
    ok(await p.locator(".kpis .kpi").count() === 4 && await p.locator("svg.chart path.line").count() === 1 && await p.locator("svg.ring .seg").count() >= 2 && await p.locator(".sbars li").count() >= 2 && await p.locator(".feed li").count() >= 8, `${tag}: the dashboard's figures, cash line, invoices ring, spend bars and decisions`);
    ok(await p.evaluate(() => [...document.querySelectorAll(".rise")].every((n) => getComputedStyle(n).opacity === "1")), `${tag}: every part has risen in`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: nothing is wider than the screen`);
    for (const tab of ["invoices", "transactions", "books", "settings"]) { await p.goto(`${ORIGIN}/#/${tab}`); await p.waitForTimeout(900); }
    // Settings, Connect Claude: the demo company's public read-only token and the steps; no way to make a token.
    await p.waitForSelector("#claude");
    ok(/purser-demo-read-only/.test((await p.textContent("#claude")) ?? "") && await p.locator("#claude-make").count() === 0, `${tag}: Connect Claude shows the demo's read-only token and makes none`);
    ok(await p.locator("button", { hasText: /upload|new key|invite/i }).count() === 0, `${tag}: a guest has no button that writes`);
    ok(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? ` (${errors.slice(0, 2).join(" | ")})` : ""}`);
    if (shots && motion === "no-preference") { await p.goto(`${ORIGIN}/#/overview`); await p.waitForSelector(".dash"); for (let y = 0; y < 8000; y += 400) { await p.mouse.wheel(0, 400); await p.waitForTimeout(150); } await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(2200); await p.screenshot({ path: join(shots, `guest-dashboard-${width}.png`), fullPage: true }); }
    await c.close();
  }
  serverG.close();
}
await guestPass();

await browser.close();
rmSync(dir, { recursive: true, force: true });
rmSync(w.dir, { recursive: true, force: true });
console.log(failed ? `\nconsole check: ${failed} problem(s)` : "\nconsole check: all passed");
process.exit(failed ? 1 : 0);
