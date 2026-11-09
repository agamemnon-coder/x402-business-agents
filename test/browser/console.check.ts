// Purser Cloud's console in Chromium, end to end, on this machine: a test company (fake data, labelled) set up from its
// starter key with a virtual passkey (Chromium's WebAuthn test authenticator), the runner's test world pushed to it,
// then every page at laptop and phone width. It checks: the passkey first run and sign-in, a supplier name that is
// HTML shows as text, no console or CSP errors, nothing wider than the phone, and an ended session goes back to sign-in.
// npx tsx test/browser/console.check.ts [screenshot dir]
import { t as tr } from "../../src/ui/i18n.js";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { batchesFor, pushToCloud } from "../../src/cloudsync/client.js";
import { payApInvoice } from "../../src/ap/pay.js";
import { DE, EN, NL } from "../fakes/apInvoices.js";
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
// The console is Dutch by default (src/ui/i18n.ts); this check walks it in English, then looks at the Dutch pages near the end.
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
const rawKeys = await page.evaluate(() => (document.body.textContent ?? "").split(/\s+/).filter((w) => /^[a-z]+(\.[a-z0-9_]+)+$/.test(w) && !/\.(js|pdf|csv|json|eml|com|nl|io|test)$/.test(w)));
ok(rawKeys.length === 0, `no raw message keys on the Dutch console${rawKeys.length ? ` (found ${rawKeys.slice(0, 5).join(", ")})` : ""}`);
await shot("19-overzicht-nederlands");
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
await browser.close();
server.close();
rmSync(dir, { recursive: true, force: true });
rmSync(w.dir, { recursive: true, force: true });
console.log(failed ? `\nconsole check: ${failed} problem(s)` : "\nconsole check: all passed");
process.exit(failed ? 1 : 0);
