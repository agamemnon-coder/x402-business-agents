// Purser as an installed app, in Chromium against the local relay (src/relay/local.ts, the Worker's own page logic):
// Chromium's own installability check (CDP Page.getInstallabilityErrors, what decides "Install app") on the CFO's
// pages; the service worker installed and in control; offline, a page shows "Offline: nothing can be approved without
// a connection" and the approval page is never a stored copy; /api/ answers never come from the worker; /app takes a
// pasted private link to the dashboard. Screenshots at 390 px (a phone, no browser bar) in the given folder.
//   npx tsx test/browser/pwa.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { startLocalRelay } from "../../src/relay/local.js";
import { viewKey } from "../../src/relay/config.js";
import { OFFLINE_LINE } from "../../src/pwa/manifest.js";

const shots = process.argv[2] ?? "test-results/pwa";
mkdirSync(shots, { recursive: true });
const TOKEN = "pwa-check-token";
const relay = await startLocalRelay({ port: 0, token: TOKEN });
const base = relay.url;
const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures.push(what); };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);

  for (const path of ["/app", "/?recorded", "/approve/P-0001", "/enrol"]) {
    await page.goto(`${base}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    const inst = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: { errorId: string }[] };
    const manifest = (await cdp.send("Page.getAppManifest")) as { url: string; errors: { message: string }[] };
    check(inst.installabilityErrors.length === 0, `${path}: Chromium finds it installable (installability errors: ${JSON.stringify(inst.installabilityErrors.map((e) => e.errorId))})`);
    check(manifest.url.endsWith("/manifest.webmanifest") && manifest.errors.length === 0, `${path}: the manifest parses without errors (${JSON.stringify(manifest.errors.map((e) => e.message))})`);
  }

  // The worker: installed and, after a reload, in control.
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: "load" });
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), "the service worker controls the page after a reload");
  const cacheNames = await page.evaluate(() => caches.keys());
  check(cacheNames.length === 1 && /^purser-shell-[0-9a-f]{16}$/.test(cacheNames[0]!), `one cache, named after the build (${cacheNames.join(", ")})`);
  const stored = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0]!)).keys()).map((r) => new URL(r.url).pathname));
  check(!stored.some((p) => /^\/(api|v1|approve)\b|^\/enrol$|^\/policy$|approve\.js$/.test(p)), `the cache holds only the shell (${stored.join(", ")})`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "pwa-app-390.png") });

  // /api/ is never answered by the worker.
  const api = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/snapshot")), page.evaluate(() => fetch("/api/snapshot").then((r) => r.status))]);
  check(!api[0].fromServiceWorker(), `/api/snapshot comes from the network, not the worker (status ${api[1]})`);

  // Online, the approval page is the network's; offline, the offline page, never a stored copy.
  const online = await page.goto(`${base}/approve/P-0001`, { waitUntil: "load" });
  check(!!online && online.ok(), "online: /approve/P-0001 loads from the network");
  await page.screenshot({ path: join(shots, "pwa-approve-guest-390.png") });
  await ctx.setOffline(true);
  for (const path of ["/approve/P-0001", "/?dashboard", "/app"]) {
    await page.goto(`${base}${path}`, { waitUntil: "load" }).catch(() => null);
    const text = await page.locator("body").innerText();
    check(text.includes(OFFLINE_LINE) && !/Approve|EUR|USD/.test(text), `offline: ${path} shows the offline page and no terms`);
  }
  await page.screenshot({ path: join(shots, "pwa-offline-390.png") });
  await ctx.setOffline(false);

  // /app: a pasted private link goes to the dashboard, which keeps the key on this device.
  const key = viewKey(TOKEN);
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await page.fill("#link", `${base}/#view=${key}`);
  await Promise.all([page.waitForURL(/\?dashboard/), page.click("#open")]);
  await page.waitForTimeout(600);
  check(await page.evaluate(() => localStorage.getItem("kit11.view")) === key, "/app: the pasted link's key is kept on this device");
  check(!page.url().includes("view="), "the key left the address bar");
  await page.screenshot({ path: join(shots, "pwa-dashboard-390.png") });
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await page.waitForURL(/\?dashboard/);
  check(true, "/app goes straight to the dashboard once the device holds the key");
  // A link for another address is refused.
  await page.evaluate(() => localStorage.removeItem("kit11.view"));
  await page.goto(`${base}/app`, { waitUntil: "load" });
  await page.fill("#link", `https://evil.example/#view=${key}`);
  await page.click("#open");
  check((await page.locator("#say").innerText()).includes("another address"), "/app: a link for another address is refused");
  await page.goto(`${base}/?recorded`, { waitUntil: "load" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "pwa-recorded-390.png") });
  // Expected and left out: the offline loads, the check's own /api/snapshot without a key (401), and the dashboard asking
  // a relay no runner has synced (503).
  const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR|status of (401|503) /.test(e));
  check(real.length === 0, `no other console errors (${JSON.stringify(real)})`);
} finally {
  await browser.close();
  relay.server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
