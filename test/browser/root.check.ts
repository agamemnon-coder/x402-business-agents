// Browser check of "/" (not part of npm test; needs Playwright with Chromium from the environment):
//   npx tsx test/browser/root.check.ts [screenshot dir]
// A local relay (the Worker's own routing, src/relay/local.ts) with a runner state pushed to it, at 390 and 1440 px,
// light and dark. Three cases: a guest at "/" gets Home itself (no redirect, no request to the CFO's API); /?recorded
// and /?autonomy are still the recorded dashboards the README and the deck link; the CFO's viewer link
// (/#view=<key>, the key never sent to a server) goes on from Home to the live dashboard, which then answers with the
// key (no 401) and takes the key out of the address bar. After that, "/" on the same device is the dashboard again,
// the Home tab (/home) stays Home, and a guest on the CFO's address (/?dashboard) is sent to Home. Also /health and
// /health/live as the relay answers them while its runner syncs.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { HERO } from "../../src/config/brand.js";
import { openDb } from "../../src/db/open.js";
import { viewKey } from "../../src/relay/config.js";
import { startLocalRelay } from "../../src/relay/local.js";
import { buildRelayState, stateHash } from "../../src/relay/state.js";

const shots = resolve(process.argv[2] ?? "test-results/root");
mkdirSync(shots, { recursive: true });
const TOKEN = "root-check-token";
const local = await startLocalRelay({ port: 0, token: TOKEN });
const base = local.url;
// One runner sync, as the runner sends it (src/relay/runner.ts): the dashboard has a state to show.
const sync = async () => {
  const state = buildRelayState(openDb(":memory:"), { rpId: "localhost", relayToken: TOKEN }, new Date());
  const r = await fetch(`${base}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(state), state, acks: [] }) });
  if (r.status !== 200) throw new Error(`runner sync answered ${r.status}`);
};
await sync();
const key = viewKey(TOKEN);

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };

// Without a browser: what a link preview or a fetch gets.
{
  const root = await (await fetch(`${base}/`)).text();
  check(root.includes(`<h1 class="h-hero">${HERO}</h1>`) && !root.includes('id="recorded-data"'), "no script: / is Home's HTML, nothing of the CFO dashboard");
  for (const q of ["?recorded", "?autonomy"]) check((await (await fetch(`${base}/${q}`)).text()).includes('id="recorded-data"'), `no script: /${q} is the dashboard's page`);
  const h = await fetch(`${base}/health`);
  check(h.status === 200 && ((await h.json()) as { status: string }).status === "ok", "/health: 200 ok while the runner syncs");
  check((await fetch(`${base}/health/live`)).status === 200, "/health/live: 200 while the runner syncs");
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [w, h] of [[390, 844], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const tag = `${w}-${scheme}`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
    const page = await context.newPage();
    const errors: string[] = [];
    const api: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("response", (r) => { const p = new URL(r.url()).pathname; if (p.startsWith("/api/")) api.push(`${p} ${r.status()}`); });

    // 1. A guest at "/": Home itself, no redirect, and no request to the CFO's API (a 401 would be a console error).
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    check(new URL(page.url()).pathname === "/" && !new URL(page.url()).search, `${tag} guest: stays on / (${page.url().slice(base.length)})`);
    check(await page.isVisible("h1.h-hero") && (await page.locator("h1.h-hero").innerText()).trim() === HERO, `${tag} guest: Home's heading "${HERO}"`);
    check(api.length === 0, `${tag} guest: no request to the CFO's API${api.length ? ` (${api.join(", ")})` : ""}`);
    await page.screenshot({ path: join(shots, `guest-root-${tag}.png`) });

    // 2. The replays the README and the deck link: still the recorded dashboards, labelled.
    await page.goto(`${base}/?recorded`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    check(/\?recorded$/.test(page.url()) && /Recorded run · .* · test money/.test(await page.locator("#rec-text").innerText()), `${tag} /?recorded: the recorded dashboard`);
    await page.goto(`${base}/?autonomy`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    check(/\?autonomy$/.test(page.url()) && /Replay of the main run, 3 Nov/.test(await page.locator("#rec-text").innerText()), `${tag} /?autonomy: the main run's dashboard`);
    // The CFO's address without a key: the dashboard's own guard sends a guest to Home.
    await page.goto(`${base}/?dashboard`, { waitUntil: "load" });
    await page.waitForURL(/\/home$/, { timeout: 5000 }).catch(() => undefined);
    check(/\/home$/.test(page.url()), `${tag} guest on /?dashboard: sent to /home`);

    // 3. The CFO's viewer link, on a device that never had it: on from Home to the live dashboard, which answers.
    await sync();
    api.length = 0;
    await page.goto(`${base}/#view=${key}`, { waitUntil: "load" });
    check(!page.url().includes(key), `${tag} CFO link: the key leaves the address bar at once (${page.url().slice(base.length).replace(key, "<key>")})`);
    await page.waitForSelector("#dash:not([hidden])", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const at = new URL(page.url());
    check(at.pathname === "/" && at.search === "?dashboard", `${tag} CFO link: on the dashboard (${at.pathname}${at.search})`);
    check(!page.url().includes(key) && !at.hash, `${tag} CFO link: the key left the address bar`);
    check(await page.isVisible("#dash") && !(await page.isVisible("#landing")), `${tag} CFO link: the CFO's dashboard is shown`);
    check(api.some((a) => a === "/api/snapshot 200") && !api.some((a) => / 401$/.test(a)), `${tag} CFO link: /api/snapshot answers with the key (${[...new Set(api)].join(", ")})`);
    check((await page.locator("#live .lbl").innerText()).trim() === "Live", `${tag} CFO link: the status reads Live`);
    await page.screenshot({ path: join(shots, `cfo-dashboard-${tag}.png`) });
    // The same device later: "/" goes on to the dashboard by the key it keeps; its Dashboard tab stays there; /home is Home.
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForURL(/\?dashboard$/, { timeout: 5000 }).catch(() => undefined);
    check(/\/\?dashboard$/.test(page.url()), `${tag} CFO device: "/" goes on to the dashboard (${page.url().slice(base.length)})`);
    check((await page.locator("#dtabs a", { hasText: "Dashboard" }).getAttribute("href")) === "?dashboard", `${tag} CFO device: the Dashboard tab points at ?dashboard`);
    await page.goto(`${base}/home`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    check(/\/home$/.test(page.url()) && await page.isVisible("h1.h-hero"), `${tag} CFO device: /home stays Home`);

    check(errors.length === 0, `${tag}: no console or page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
    await context.close();
  }
}
await browser.close();
local.server.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nroot check passes: / for a guest (Home itself), /?recorded and /?autonomy, the CFO's link and device, at 390 and 1440 px, light and dark (screenshots in ${shots})`);
process.exit(failures ? 1 : 0);
