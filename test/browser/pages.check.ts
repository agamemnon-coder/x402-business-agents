// The guest pages as a juror opens them, with no key: /, /?recorded, /demo (every step) and /month (start and end), at phone
// (390 px) and laptop (1440 px) width, light and dark. Fails on any console error or page error, on "null",
// "undefined" or "NaN" anywhere on screen, and on a page wider than the screen.
//   npx tsx test/browser/pages.check.ts [screenshot dir]            against `npm run judge` started here
//   npx tsx test/browser/pages.check.ts [screenshot dir] --live <url>   against a hosted relay (no key)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startJudge } from "../../src/cli/judge.js";

const args = process.argv.slice(2);
const liveAt = args.indexOf("--live");
const shots = args[0] && !args[0].startsWith("--") ? args[0] : "test-results/pages";
mkdirSync(shots, { recursive: true });
const judge = liveAt >= 0 ? null : await startJudge(0);
const base = liveAt >= 0 ? args[liveAt + 1]!.replace(/\/$/, "") : judge!.url;

const failures: string[] = [];
const fail = (what: string) => { failures.push(what); console.log(`FAIL  ${what}`); };

async function look(page: Page, name: string, width: number): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const bad = /\b(null|undefined|NaN)\b/.exec(text);
  if (bad) fail(`${name}: shows "${bad[0]}" (…${text.slice(Math.max(0, bad.index - 60), bad.index + 20).replace(/\s+/g, " ")}…)`);
  // Against the device width, not innerWidth: a phone browser widens its layout viewport to fit an overflowing page.
  const over = await page.evaluate(() => document.documentElement.scrollWidth) - width;
  if (over > 1) fail(`${name}: ${over}px wider than the screen`);
}

const browser = await chromium.launch();
for (const [w, h] of [[390, 844], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
    const page = await context.newPage();
    const tag = `${w}-${scheme}`;
    page.on("console", (m) => { if (m.type() === "error") fail(`${tag} ${page.url()}: console error: ${m.text()}`); });
    page.on("pageerror", (e) => fail(`${tag} ${page.url()}: page error: ${e.message}`));
    page.on("requestfailed", (r) => fail(`${tag} ${page.url()}: request failed: ${r.url()}`));

    await page.goto(`${base}/`, { waitUntil: "load" });
    // Long enough for a page that polls to show it (it must not, without a key).
    await page.waitForTimeout(2500);
    await look(page, `/ ${tag}`, w);
    if (!(await page.isVisible("text=Watch the demo"))) fail(`/ ${tag}: no "Watch the demo" for a guest`);
    await page.screenshot({ path: join(shots, `home-${tag}.png`), fullPage: true });

    // The CFO's dashboard as it stood at the end of a recorded live run: labelled as such, with Metal as visible as
    // the cards, chain money in test USD (never "$" or "USDZ"), and bank transfers told apart from card payments.
    await page.goto(`${base}/?recorded`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await look(page, `/?recorded ${tag}`, w);
    const rec = await page.evaluate(() => document.body.innerText);
    for (const want of [/Recorded run of/, /On-chain budgets/i, /test USD/, /Company cards/i]) {
      if (!want.test(rec)) fail(`/?recorded ${tag}: missing ${want}`);
    }
    for (const bad of [/USDZ/, /\$\s?\d/]) {
      const m = bad.exec(rec);
      if (m) fail(`/?recorded ${tag}: shows "${m[0]}" (…${rec.slice(Math.max(0, m.index - 60), m.index + 20).replace(/\s+/g, " ")}…)`);
    }
    await page.screenshot({ path: join(shots, `recorded-${tag}.png`), fullPage: true });

    await page.goto(`${base}/demo`, { waitUntil: "load" });
    const steps = await page.locator("#steps button").count();
    if (steps < 5) fail(`/demo ${tag}: only ${steps} steps`);
    for (let i = 0; i < steps; i++) {
      await look(page, `/demo step ${i + 1} ${tag}`, w);
      if (i === 0) await page.screenshot({ path: join(shots, `demo-${tag}.png`), fullPage: true });
      if (i < steps - 1) await page.click("#next");
    }

    for (const q of ["", "?at=end"]) {
      await page.goto(`${base}/month${q}`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      await look(page, `/month${q} ${tag}`, w);
      await page.screenshot({ path: join(shots, `month${q ? "-end" : ""}-${tag}.png`), fullPage: true });
    }
    await context.close();
  }
}
await browser.close();
judge?.server.close();
if (failures.length) {
  console.log(`\npages check: ${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`pages check passes: /, /?recorded, /demo (every step), /month at 390 and 1440 px, light and dark (screenshots in ${shots})`);
