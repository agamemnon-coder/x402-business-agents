// Purser Cloud's console in Chromium, end to end, on this machine: a test company (fake data, labelled) set up from its
// starter key with a virtual passkey (Chromium's WebAuthn test authenticator), the runner's test world pushed to it,
// then every page at laptop and phone width. It checks: the passkey first run and sign-in, a supplier name that is
// HTML shows as text, no console or CSP errors, nothing wider than the phone, and an ended session goes back to sign-in.
// Then the demo deployment (cloud/src/demo.ts) over the seeded test world (src/demoworld): no sign-in, every screen at
// 390 and 1440 px in light and dark, in English, with no console error and no request that is not a GET.
// npx tsx test/browser/console.check.ts [screenshot dir] [demo screenshot dir, by default ../cloud-demo next to the first]
import { t as tr } from "../../src/ui/i18n.js";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { DEMO_SITE } from "../../cloud/src/console.js";
import { BOOKS_JS } from "../../cloud/src/consoleBooks.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { batchesFor, pushToCloud } from "../../src/cloudsync/client.js";
import { payApInvoice } from "../../src/ap/pay.js";
import { DE, EN, NL } from "../fakes/apInvoices.js";
import { world } from "../support/rt4World.js";
import { localDemo } from "../../src/demoworld/bundle.js";
import { MESSAGES } from "../../src/ui/i18n.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const demoShots = process.argv[3] ?? (shots ? join(dirname(shots), "cloud-demo") : "");
if (demoShots) mkdirSync(demoShots, { recursive: true });
const PORT = 8790 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "console-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

// The demo's seeded world is built first and alone: its build sets a fixed clock for the whole process while it runs.
const demoDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "console-demo-"));
const DEMO_PORT = 8890 + Math.floor(Math.random() * 100);
const DEMO_ORIGIN = `http://localhost:${DEMO_PORT}`;
const demo = await localDemo(demoDir, { origin: DEMO_ORIGIN });

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
const env: CloudEnv = { sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "c".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, mailDomain: "in.purser.test", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  // The Worker's static assets: pdf.js, as npm run cloud:pdfjs copies it.
  asset: async (path) => (path === "/assets/pdfjs.mjs" ? new Response(readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")))) : null) };
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));
const call = async (method: string, path: string, key: string, body?: unknown) => {
  const r = await fetch(`${ORIGIN}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json() as Record<string, unknown> };
};
const made = await call("POST", "/v1/admin/tenants", ADMIN, { slug: "northwind", name: "Northwind Outdoor (test company)", owner: { display_name: "The CFO" } });
const starter = made.json.api_key as string;
// The console is English by default (since 12 November); this check walks it in English, then looks at the Dutch pages near the end.
ok((await call("POST", "/v1/company", starter, { language: "en" })).status === 200, "the company's pages can be set to English");


// Chromium with a virtual passkey authenticator (the platform kind: user verification, discoverable credentials).
const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: shots ? 2 : 1 });
await ctx.addInitScript(() => { try { if (!localStorage.getItem("purser.cloud.lang")) localStorage.setItem("purser.cloud.lang", "en"); } catch { /* none */ } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
// The PDF frame's worker keeps a request open in Playwright's count, so "network idle" is waited for briefly, not forever.
const settle = async () => { await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(250); };
const text = async () => (await page.textContent("body")) ?? "";

// First run.
await page.goto(`${ORIGIN}/#/start`);
await page.fill("#start-slug", "northwind");
await page.fill("#start-key", starter);
await shot("01-eerste-keer-1-bedrijf");
await page.click("text=Continue");
await page.waitForSelector("#start-name");
await shot("02-eerste-keer-2-passkey");
await page.click("text=Make my passkey");
await page.waitForSelector("text=Make the key for my computer", { timeout: 20_000 });
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
ok((await text()).includes("The starter key stopped working when your passkey was made"), "the first run says the starter key is gone");
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
await shot("05-overzicht");

await page.goto(`${ORIGIN}/#/invoices`);
await page.waitForSelector(".row:not(.th)");
await settle();
await shot("06-facturen");
ok((await page.$$("img")).length === 0 && (await text()).includes('<img src=x onerror="document.title=\'pwned\'">Evil Supplies'), "a supplier name with HTML shows as text, never as markup");
ok(!(await page.title()).includes("pwned"), "no script from a supplier's text ran");

await page.goto(`${ORIGIN}/#/invoices/${encodeURIComponent(paidId)}`);
await page.waitForSelector("text=What Purser read");
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
await page.waitForSelector("text=What Purser read");
ok((await page.$$("script")).length === 1 && (await text()).includes("<script>alert(1)</script> looks like"), "a finding's text with a script tag shows as text");

await page.goto(`${ORIGIN}/#/transactions`);
await page.waitForSelector(".trow:not(.th)");
await settle();
await shot("08-transacties");
await page.goto(`${ORIGIN}/#/books`);
await page.waitForSelector("#bookings details.ent");
await settle();
ok((await page.$$("#cards [data-card]")).length === 5 && (await page.$("#agree")) !== null, "a signed-in company's books show the five report cards and whether books, payments and signatures agree");
await shot("09-boekhouding");
// The vault: this company's runner has filed no vault in the cloud, and the page says so.
await page.goto(`${ORIGIN}/#/vault`);
await page.waitForSelector(`text=${tr("en", "cs.vault.none")}`);
ok((await page.$$("#tabs a")).length <= 5, "the menu has at most five pages (Settings is behind the company's name)");
await settle();
await shot("09b-kluis");
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

// The phone.
await page.setViewportSize({ width: 390, height: 844 });
for (const [hash, name, wait] of [["#/overview", "11-telefoon-overzicht", "text=Waits for the CFO's Face ID"], ["#/invoices", "12-telefoon-facturen", ".row:not(.th)"], [`#/invoices/${encodeURIComponent(paidId)}`, "18-telefoon-factuur-met-pdf", "iframe.pdfframe"], ["#/transactions", "14-telefoon-transacties", ".trow:not(.th)"], ["#/books", "14b-telefoon-boekhouding", "#bookings details.ent"], ["#/vault", "14c-telefoon-kluis", `text=${tr("en", "cs.vault.none")}`], ["#/settings", "15-telefoon-instellingen", "text=API keys"]] as const) {
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
const rawKeys = await page.evaluate(() => (document.body.textContent ?? "").split(/\s+/).filter((w) => /^[a-z]+(\.[a-z0-9_]+)+$/.test(w) && !/\.(js|pdf|csv|json|eml|com|nl|io|test)$/.test(w)));
ok(rawKeys.length === 0, `no raw message keys on the Dutch console${rawKeys.length ? ` (found ${rawKeys.slice(0, 5).join(", ")})` : ""}`);
await shot("19-overzicht-nederlands");
// The Dutch books and settings (screenshot pass, 9 November): no English left in the journal, the VAT overview or the
// key names, a role or status pill on one line, no "nothing this quarter" above input VAT, the nav on a phone in view.
await page.goto(`${ORIGIN}/#/books`);
await page.waitForSelector("#bookings details.ent", { timeout: 20_000 });
await page.click("[data-card=vat]");
await page.waitForSelector(`#report >> text=${tr("nl", "cs.owed_5a")}`, { timeout: 20_000 });
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
ok(errors.filter((e) => !/(401 \(Unauthorized\)|409 \(Conflict\))/.test(e)).length === 0, `no console or CSP errors${errors.length ? ` (${errors.join(" | ")})` : ""}`);

// --- The demo deployment: the seeded test world, read-only, no sign-in -------------------------------------------------
const demoEnvWithPdf = { ...demo.env, asset: env.asset };
const demoServer = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${DEMO_ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), demoEnvWithPdf);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => demoServer.listen(DEMO_PORT, "127.0.0.1", () => r()));
const listed = await (await fetch(`${DEMO_ORIGIN}/v1/demo/companies`)).json() as { companies: { slug: string; name: string; counts: Record<string, number>; invoices_by_status: Record<string, number> }[] };
ok(listed.companies.length === 3, "the demo lists its three test companies");
const first = demo.companies[0]!;
const st = first.states;
// Words a Dutch page has and an English one must not (the console's frame and the demo's own lines).
const DUTCH = /\b(Overzicht|Facturen|Transacties|Boekhouding|Instellingen|Testgeld|Testbedrijven|testwereld|Betaald|Geblokkeerd|Goedkeuring|Geboekt)\b/;
const demoErrors: string[] = [];
const notGet: string[] = [];
const SCREENS: [string, string, string][] = [
  ["01-companies", "#/", ".grid2 .card"],
  ["02-overview", `#/c/${first.slug}/overview`, "text=When it is due"],
  ["03-invoices", `#/c/${first.slug}/invoices`, ".row:not(.th)"],
  ["04-invoice", `#/c/${first.slug}/invoices/${st.paid_foreign_currency}`, "text=Approval and payment"],
  ["05-transactions", `#/c/${first.slug}/transactions`, ".trow:not(.th)"],
  ["06-books", `#/c/${first.slug}/books`, "#bookings details.ent"],
  ["07-vault", `#/c/${first.slug}/vault`, "#proof"],
];
const demoShotPaths: string[] = [];
for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    const dctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: demoShots ? 2 : 1, colorScheme: scheme });
    const dp = await dctx.newPage();
    dp.on("console", (m) => { if (m.type() === "error") demoErrors.push(`${scheme} ${width}: ${m.text()}`); });
    dp.on("pageerror", (e) => demoErrors.push(`${scheme} ${width}: ${String(e)}`));
    dctx.on("request", (r) => { if (r.url().startsWith(DEMO_ORIGIN) && r.method() !== "GET") notGet.push(`${r.method()} ${r.url()}`); });
    for (const [name, hash, wait] of SCREENS) {
      await dp.goto(`${DEMO_ORIGIN}/${hash}`);
      await dp.waitForSelector(wait, { timeout: 20_000 });
      if (name === "04-invoice") { await dp.frameLocator("iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 }); await dp.waitForSelector("text=Booked"); }
      if (name === "07-vault") {
        await dp.frameLocator("iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 });
        await dp.click("#verify");
        await dp.waitForSelector("#verify-result[data-match=true]");
        const frame = dp.frames().find((f) => f.url().includes("/pdfview"))!;
        const inked = await frame.evaluate(() => { const c = document.querySelector("canvas")!; const x = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < x.length; i += 16) if (x[i]! < 200) n++; return n; });
        ok(inked > 0, `${name} at ${width} px, ${scheme}: the payment proof's PDF is drawn in the page`);
      }
      await dp.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await dp.waitForTimeout(250);
      const where = `${name} at ${width} px, ${scheme}`;
      const body = await dp.innerText("body");
      ok((await dp.evaluate(() => document.documentElement.lang)) === "en" && !DUTCH.test(body), `${where}: in English (${DUTCH.exec(body)?.[0] ?? "no Dutch word"})`);
      ok(body.includes(MESSAGES.en["cs.demo.banner"]) && (await dp.$(`.banner a[href="${DEMO_SITE}"]`)) !== null, `${where}: the test-world line and "What is this?" are on the screen`);
      ok((await dp.$$("#tabs a[data-tab=settings], #out, #who, #co")).length === 0, `${where}: no settings, no person, no sign-out`);
      const wide = await dp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(wide <= 0, `${where}: nothing wider than the screen (${wide} px over)`);
      const raw = await dp.evaluate(() => (document.body.textContent ?? "").split(/\s+/).filter((x) => /^[a-z]+(\.[a-z0-9_]+)+$/.test(x) && !/\.(js|pdf|csv|json|eml|com|nl|io|test|dev)$/.test(x)));
      ok(raw.length === 0, `${where}: no raw message keys${raw.length ? ` (${raw.slice(0, 5).join(", ")})` : ""}`);
      if (name === "01-companies") ok(!(await dp.isVisible("#tabs")), `${where}: no company tabs before a company is chosen`);
      if (demoShots) { await dp.evaluate(() => window.scrollTo(0, 0)); const f = join(demoShots, `${scheme}-${width}-${name}.png`); await dp.screenshot({ path: f, fullPage: true }); demoShotPaths.push(f); }
      // The books' details: a report card opened, and the newest booking with its lines and its proof.
      if (name === "06-books") {
        await dp.click("[data-card=vat]");
        await dp.waitForSelector("#report table.vat");
        await dp.click("#bookings details.ent summary");
        await dp.waitForSelector("#bookings details.ent[open] .kv");
        const over = await dp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        ok(over <= 0, `${where}, details open: nothing wider than the screen (${over} px over)`);
        if (demoShots) { await dp.evaluate(() => window.scrollTo(0, 0)); const f = join(demoShots, `${scheme}-${width}-06b-books-details.png`); await dp.screenshot({ path: f, fullPage: true }); demoShotPaths.push(f); }
      }
      // On a phone the PDF sits below the fold, and a full-page capture leaves a frame out of view blank: one more
      // capture with the document in view.
      if (name === "07-vault" && width === 390 && demoShots) {
        await dp.locator("iframe.pdfframe").scrollIntoViewIfNeeded();
        await dp.waitForTimeout(400);
        const f = join(demoShots, `${scheme}-${width}-07b-vault-document.png`); await dp.screenshot({ path: f }); demoShotPaths.push(f);
      }
    }
    await dctx.close();
  }
}
// What the screens say, against the demo's own answers (light, laptop).
{
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const dp = await dctx.newPage();
  dp.on("console", (m) => { if (m.type() === "error") demoErrors.push(`content: ${m.text()}`); });
  dp.on("pageerror", (e) => demoErrors.push(`content: ${String(e)}`));
  dctx.on("request", (r) => { if (r.url().startsWith(DEMO_ORIGIN) && r.method() !== "GET") notGet.push(`${r.method()} ${r.url()}`); });
  await dp.goto(`${DEMO_ORIGIN}/`);
  await dp.waitForSelector(".grid2 .card");
  const cards = await dp.$$eval(".grid2 .card", (cs) => cs.map((c) => c.textContent ?? ""));
  ok(cards.length === 3 && listed.companies.every((c, k) => cards[k]!.includes(c.name) && cards[k]!.includes(`${c.counts.invoices} invoices`) && cards[k]!.includes(`Documents in the archive${c.counts.documents}`) && cards[k]!.includes(`Payments${c.counts.payments}`)),
    "each company's card shows its name and its counts as the demo counts them");
  ok(listed.companies.every((c, k) => cards[k]!.includes(`Paid${c.invoices_by_status.paid ?? 0}`)), "each card shows its paid invoices from the demo's count by state");
  ok((await dp.$("#tabs")) !== null && !(await dp.isVisible("#tabs")), "the companies' page shows no company tabs");
  // Into a company, then the switcher to another.
  await dp.click(`.grid2 .card:first-child a.btn`);
  await dp.waitForSelector("text=When it is due");
  ok(new URL(dp.url()).hash === `#/c/${first.slug}/overview`, "a card opens its company's overview");
  ok((await dp.innerText("main")).includes(MESSAGES.en["cs.demo.next.cfo_1"]), "the overview says what waits for the CFO, and asks nobody to sign");
  await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/invoices`);
  await dp.waitForSelector(".row:not(.th)");
  await dp.selectOption("#cosel", listed.companies[1]!.slug);
  await dp.waitForFunction((h) => location.hash === h, `#/c/${listed.companies[1]!.slug}/invoices`);
  await dp.waitForSelector(".row:not(.th)");
  ok(await dp.inputValue("#cosel") === listed.companies[1]!.slug, "the switcher in the header goes to the same page of another company");
  // The invoice paid in a foreign currency: document, reading, checks, approval with its signed terms, payment, booking.
  await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/invoices/${st.paid_foreign_currency}`);
  await dp.waitForSelector("text=Booked");
  const inv = await dp.innerText("main");
  ok(["What Purser read", "Checks", "Approval and payment", MESSAGES.en["cs.dt.test_passkey"], "Signed terms, SHA-256:", "stand-in", "Booked"].every((x) => inv.includes(x)), "an invoice shows its reading, checks, approval with a test passkey, signed terms, stand-in payment and booking");
  ok(/Airwallex FX/.test(inv) && /Airwallex transfer/.test(inv), "the foreign-currency payment shows the conversion and the transfer");
  const fraud = await (await fetch(`${DEMO_ORIGIN}/v1/demo/${first.slug}/invoices/${st.held_possible_fraud}`)).json() as { findings: { detail: string }[] };
  await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/invoices/${st.held_possible_fraud}`);
  await dp.waitForSelector("text=Blocks payment");
  ok((await dp.innerText("main")).includes(fraud.findings[0]!.detail), "the invoice held as possible fraud shows the finding that holds it");
  await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/invoices/${st.waiting_for_cfo}`);
  await dp.waitForSelector("text=Approval and payment");
  ok((await dp.innerText("main")).includes("Nothing is paid until then"), "the invoice that waits for the CFO says nothing is paid until then");
  // Books: the agree line, the five cards against the reports the demo serves, the closed month, a booking's proof.
  {
    const B = new Function(`${BOOKS_JS}\nreturn { reportCards, period, agreement };`)() as { period(l: string, today: string, demo: boolean): { end: string; from: string; quarter: string; as_of: string }; agreement(c: unknown): { moved: number }; reportCards(r: unknown): { trial: { by: Record<string, { debit: number }> }; pnl: { by: Record<string, { result: number }> }; balance: { by: Record<string, { assets: number }> }; vat: { balance: number }; payables: { by: Record<string, { open: number }> } } };
    const api = async <T,>(p: string) => await (await fetch(`${DEMO_ORIGIN}/v1/demo/${first.slug}${p}`)).json() as T;
    const fmt = (c: number) => `${c < 0 ? "-" : ""}${String(Math.floor(Math.abs(c) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
    const entries = (await api<{ items: { entry_id: number; posting_date: string }[] }>("/ledger/entries?limit=200")).items;
    const p = B.period(entries.map((e) => e.posting_date).sort().at(-1)!, new Date().toISOString().slice(0, 10), true);
    const c = B.reportCards({ trial: await api(`/reports/trial?to=${p.end}`), pnl: await api(`/reports/pnl?from=${p.from}&to=${p.end}`), balance: await api(`/reports/balance?to=${p.end}`), vat: await api(`/reports/vat?quarter=${p.quarter}`), payables: await api(`/reports/payables?as_of=${p.as_of}`) });
    const sum = await api<{ check: unknown }>("/transactions/summary");
    await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/books`);
    await dp.waitForSelector("#bookings details.ent");
    const card = (k: string) => dp.innerText(`[data-card=${k}]`);
    ok((await dp.getAttribute("#agree", "class")) === "note-ok" && (await dp.innerText("#agree")).includes(`${B.agreement(sum.check).moved} money movements`), "books, payments and signatures agree, as the register's own check counts them");
    ok((await card("trial")).includes("Balanced") && (await card("trial")).includes(`EUR ${fmt(c.trial.by.EUR!.debit)}`), "the trial balance card: balanced, with its debits to the cent");
    ok((await card("pnl")).includes(fmt(c.pnl.by.EUR!.result)), "the profit and loss card shows the result to the cent");
    ok((await card("balance")).includes("Balanced") && (await card("balance")).includes(fmt(c.balance.by.EUR!.assets)), "the balance sheet card: balanced, with its assets to the cent");
    ok((await card("vat")).includes(MESSAGES.en["cs.bk.vat_prep"]) && (await card("vat")).includes(fmt(c.vat.balance)), "the VAT card says preparation, not a filing, with its balance to the cent");
    ok((await card("payables")).includes(fmt(c.payables.by.EUR!.open)), "the open payables card shows what is open to the cent");
    await dp.click("[data-card=trial]");
    const trialRows = (await api<{ rows: { account: string }[] }>(`/reports/trial?to=${p.end}`)).rows;
    const report = await dp.innerText("#report");
    ok(trialRows.every((r) => report.includes(r.account)), "the trial balance card opens to every account in it");
    ok((await dp.$$("#bookings details.ent")).length === entries.length, "the timeline holds every booking");
    ok((await dp.innerText("#bookings h2.sub-h:has-text('Oct 2026')")).includes(MESSAGES.en["cs.bk.closed"]) && !(await dp.innerText("#bookings h2.sub-h:has-text('Nov 2026')")).includes(MESSAGES.en["cs.bk.closed"]), "October, the closed month, shows as locked; November does not");
    const txs = (await api<{ items: { id: string; rail: string; invoice: { ap_id: string | null } | null; booking: { entry_ids: number[] }; approval: { terms_sha256: string | null; proposal_id: string | null } }[] }>("/transactions?limit=200")).items;
    const paidTx = txs.find((x) => x.rail === "airwallex_transfer" && x.invoice?.ap_id === st.paid_foreign_currency)!;
    await dp.click(`details[data-entry="${paidTx.booking.entry_ids[0]}"] summary`);
    const entry = await dp.innerText(`details[data-entry="${paidTx.booking.entry_ids[0]}"]`);
    const payments = (await api<{ items: { id: string }[] }>("/payments")).items.map((x) => x.id);
    const pid = paidTx.id.replace(/^transfer:/, "");
    ok(payments.includes(pid) && entry.includes(pid) && entry.includes(paidTx.approval.terms_sha256!) && entry.includes(paidTx.approval.proposal_id!) && entry.includes(`Invoice ${st.paid_foreign_currency}`), "a payment's booking shows its payment id, the request the CFO approved, the signed terms' hash and its invoice");
    // The agree line is computed: a register that says a movement is not booked turns it into what differs.
    await dp.route("**/transactions/summary*", async (r) => { const res = await r.fetch(); const j = await res.json() as { check: Record<string, unknown> }; j.check.without_booking = ["transfer:not-booked-test"]; await r.fulfill({ response: res, json: j }); });
    await dp.reload();
    await dp.waitForSelector("#agree.note-bad");
    ok((await dp.innerText("#agree")).includes("Not booked: transfer:not-booked-test"), "when the register finds a movement not booked, the books say so instead of the tick");
    await dp.unroute("**/transactions/summary*");
  }
  // The vault: its own folders, a payment proof, the PDF in the page, a download and the document check.
  {
    let tamper = false;
    await dp.route("**/documents/*", async (r) => { const res = await r.fetch(); const b = Buffer.from(await res.body()); if (tamper) b[b.length >> 1] = b[b.length >> 1]! ^ 1; await r.fulfill({ response: res, body: b }); });
    const v = await (await fetch(`${DEMO_ORIGIN}/v1/demo/${first.slug}/vault`)).json() as { files: { path: string; sha256: string; key: string; kind: string }[] };
    const txs = (await (await fetch(`${DEMO_ORIGIN}/v1/demo/${first.slug}/transactions?limit=200`)).json() as { items: { id: string; invoice: { ap_id: string | null } | null; approval: { terms_sha256: string | null } }[] }).items;
    await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/vault`);
    await dp.waitForSelector("#proof");
    await dp.frameLocator("iframe.pdfframe").locator("canvas").first().waitFor({ timeout: 20_000 });
    const tree = await dp.innerText("#folders");
    ok([["Inkoopfacturen", "Purchase invoices"], ["Betalingen", "Payments"], ["Rapporten", "Reports"], ["_Geblokkeerd", "Blocked"]].every(([nl, en]) => tree.includes(nl!) && tree.includes(en!)), "the vault shows its folders as stored, each Dutch name with its English word");
    const pays = v.files.filter((f) => f.path.split("/").at(-2) === "Betalingen");
    ok((await dp.$$("#files li")).length === pays.length && pays.length > 0, "the payments folder lists its payment proofs");
    const shown = pays[0]!;
    const proofTx = txs.find((x) => x.invoice?.ap_id === shown.key.replace(/^receipt:/, "") && x.approval.terms_sha256)!;
    const proof = await dp.innerText("#proof");
    ok(proof.includes(proofTx.approval.terms_sha256!) && proof.includes(proofTx.id.replace(/^transfer:/, "")) && proof.includes(MESSAGES.en["cs.dt.test_passkey"]), "a payment proof shows the signed terms' hash, the payment id and that a test passkey signed");
    const [download] = await Promise.all([dp.waitForEvent("download"), dp.click("#download")]);
    const got = readFileSync((await download.path())!);
    ok(createHash("sha256").update(got).digest("hex") === shown.sha256, "the download is the file whose hash is on record");
    await dp.click("#verify");
    await dp.waitForSelector("#verify-result[data-match=true]");
    ok((await dp.innerText("#verify-result")).includes(shown.sha256), "Verify: this browser's SHA-256 of the bytes matches the one on record");
    tamper = true;
    await dp.click("#verify");
    await dp.waitForSelector("#verify-result[data-match=false]");
    ok((await dp.innerText("#verify-result")).includes("Mismatch"), "Verify: one changed byte in the download is a mismatch");
    tamper = false;
    await dp.unroute("**/documents/*");
    await dp.click("#folders button:has-text('Rapporten')");
    await dp.waitForSelector(`#files >> text=${MESSAGES.en["cs.vault.k.month"]}`);
    ok((await dp.innerText("#files")).includes("2026-10 Maandrapport.pdf"), "the reports folder holds the closed month's report");
  }
  // Screens that do not exist here.
  for (const hash of ["#/settings", "#/sign-in", "#/start", "#/platform", `#/c/${first.slug}/settings`, "#/c/not-a-demo-company/overview"]) {
    await dp.goto(`${DEMO_ORIGIN}/${hash}`);
    await dp.waitForSelector(`text=${MESSAGES.en["cs.not_here"]}`);
  }
  ok(true, "settings, sign-in, first run, the platform and a company not in the demo are not here");
  // The language: Dutch on one click, remembered, and back.
  await dp.goto(`${DEMO_ORIGIN}/#/c/${first.slug}/overview`);
  await dp.waitForSelector("text=When it is due");
  ok(!/\bnull\b/.test(await dp.innerText("main")), "the overview writes no 'null' where a company has no inbox");
  await dp.click("#lang");
  await dp.waitForSelector(`text=${MESSAGES.nl["cs.demo.banner"]}`);
  ok((await dp.evaluate(() => document.documentElement.lang)) === "nl", "the switch shows the console in Dutch");
  await dp.reload();
  await dp.waitForSelector(`text=${MESSAGES.nl["cs.demo.banner"]}`);
  ok((await dp.evaluate(() => document.documentElement.lang)) === "nl", "the choice is remembered in this browser");
  if (demoShots) { const f = join(demoShots, "light-1440-07-overview-dutch.png"); await dp.screenshot({ path: f, fullPage: true }); demoShotPaths.push(f); }
  await dp.click("#lang");
  await dp.waitForSelector(`text=${MESSAGES.en["cs.demo.banner"]}`);
  ok((await dp.evaluate(() => document.documentElement.lang)) === "en", "and back to English");
  await dctx.close();
}
ok(notGet.length === 0, `the demo console sent nothing but GET${notGet.length ? ` (${notGet.slice(0, 5).join(", ")})` : ""}`);
ok(demoErrors.length === 0, `the demo console had no console or CSP errors${demoErrors.length ? ` (${demoErrors.slice(0, 5).join(" | ")})` : ""}`);
if (demoShotPaths.length) console.log(`demo screenshots (${demoShotPaths.length}):\n${demoShotPaths.join("\n")}`);

await browser.close();
server.close();
demoServer.close();
demo.close();
rmSync(dir, { recursive: true, force: true });
rmSync(w.dir, { recursive: true, force: true });
rmSync(demoDir, { recursive: true, force: true });
console.log(failed ? `\nconsole check: ${failed} problem(s)` : "\nconsole check: all passed");
process.exit(failed ? 1 : 0);
