// /proof's "Check it on chain" (src/redesign/chainCheck.ts) in the browser, on `npm run judge` started here (the page
// under its own CSP, connect-src 'self'):
// 1. as the local copy answers (no chain call): each button says "Not read from the chain: a local copy makes no chain
//    calls." and shows no chain data and no verdict;
// 2. with METAL_RPC_URL set in this shell, the page's requests to /api/alta/tx/<hash> are answered by the Worker's own
//    desk (worker/src/altaTx.ts) run in this process against Alta testnet: each transaction reads live and the page
//    says "Matches the records". Without it, step 2 is skipped and said so.
// At 1440 and 390 px, dark: nothing wider than the screen, every button at least 44 px, no console error, page error or
// CSP violation. Screenshots of the fold at 1440 and 390, dark.
//   npx tsx test/browser/proof-chain.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { startJudge } from "../../src/cli/judge.js";
import { ALTA_TX_TARGETS } from "../../src/servers/dashboard.js";
import { AltaTxDesk } from "../../worker/src/altaTx.js";
import { sqlOver } from "../support/trySign.js";
import { browserName, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "test-results/proof-chain";
mkdirSync(shots, { recursive: true });
const judge = await startJudge(0);
const live = process.env.METAL_RPC_URL ? new AltaTxDesk(sqlOver(new Database(":memory:")), { rpcUrl: process.env.METAL_RPC_URL, targets: ALTA_TX_TARGETS }) : null;
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const browser = await launchBrowser(browserName());
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const mode of ["local", "live"] as const) {
    if (mode === "live" && !live) { console.log(`skip  ${w}: METAL_RPC_URL is not set, so no live read`); continue; }
    const tag = `${w} dark ${mode}`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: "dark", isMobile: w < 500, hasTouch: w < 500 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`)); });
    if (mode === "live") await page.route("**/api/alta/tx/*", async (route) => {
      const r = await live!.fetch(new Request(route.request().url()));
      await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() });
    });
    await page.goto(`${judge.url}/proof`, { waitUntil: "load" });
    await page.evaluate(() => { const d = document.getElementById("check-chain") as HTMLDetailsElement | null; if (d) { d.open = true; d.scrollIntoView(); } });
    const n = await page.locator("#chain-check .ccx").count();
    ok(n === ALTA_TX_TARGETS.length, `${tag}: ${n} transactions in the fold, ${ALTA_TX_TARGETS.length} in the allowlist`);
    for (let i = 0; i < n; i++) {
      const li = page.locator("#chain-check .ccx").nth(i);
      const btn = li.locator(".ccx-b");
      const bh = (await btn.boundingBox())?.height ?? 0;
      await btn.click();
      await li.locator(".ccx-r:not([hidden])").waitFor({ timeout: 30_000 });
      await page.waitForFunction((el) => !(el as HTMLButtonElement).disabled, await btn.elementHandle(), { timeout: 30_000 });
      const text = (await li.locator(".ccx-r").innerText()).replace(/\s+/g, " ");
      const label = await li.locator(".ccx-h b").innerText();
      if (mode === "local") ok(/Not read from the chain: a local copy makes no chain calls\./.test(text) && !/Verdict|Status/.test(text) && bh >= 44, `${tag}: ${label}: says it was not read, shows no chain data (${text.slice(0, 90)})`);
      else ok(/Read live from Alta testnet/.test(text) && /Verdict Matches the records/.test(text) && bh >= 44, `${tag}: ${label}: read live and matches the records (${text.slice(0, 120)})`);
    }
    const over = (await page.evaluate(() => document.documentElement.scrollWidth)) - w;
    ok(over <= 1, `${tag}: the page is no wider than the screen (${over}px over)`);
    ok(!errors.length, `${tag}: no console, page or CSP error${errors.length ? `: ${errors.join(" | ").slice(0, 300)}` : ""}`);
    if (mode === "live" || !live) {
      await page.evaluate(() => document.querySelectorAll("header, .top, nav.top, main .pq-nav").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
      await page.locator("#check-chain").screenshot({ path: join(shots, `proof-chain-${w}-dark.png`) });
    }
    await context.close();
  }
}
await browser.close();
judge.server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
