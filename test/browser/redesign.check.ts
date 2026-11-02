// The redesigned Home and Watch (design pass), as a juror opens them: at 390 and 1440 px, light and dark. Fails on a
// console or page error (a CSP violation is one), "null", "undefined" or "NaN" on screen, a page wider than the
// screen, not exactly one h1, a nameless control or an image with no alt text. Screenshots: the first screen, the
// whole page, and Watch mid-run.
//   npx tsx test/browser/redesign.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startPreview } from "../../src/cli/redesignPreview.js";

const shots = process.argv[2] ?? "test-results/redesign";
mkdirSync(shots, { recursive: true });
const { server, url: base } = await startPreview(0);
const failures: string[] = [];
const fail = (what: string) => { failures.push(what); console.log(`FAIL  ${what}`); };

async function look(page: Page, name: string, width: number): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const bad = /\b(null|undefined|NaN)\b/.exec(text);
  if (bad) fail(`${name}: shows "${bad[0]}"`);
  const a11y = await page.evaluate(`(() => {
    const visible = (e) => !!e.offsetParent || getComputedStyle(e).position === "fixed";
    const named = (e) => !!(e.getAttribute("aria-label") || e.getAttribute("title") || (e.textContent || "").trim());
    return { lang: document.documentElement.lang, h1: [...document.querySelectorAll("h1")].filter(visible).length,
      unnamed: [...document.querySelectorAll("a, button")].filter((e) => visible(e) && !named(e)).map((e) => e.outerHTML.slice(0, 80)),
      noAlt: [...document.querySelectorAll("img")].filter((e) => !e.hasAttribute("alt")).length };
  })()`) as { lang: string; h1: number; unnamed: string[]; noAlt: number };
  if (!a11y.lang) fail(`${name}: no page language`);
  if (a11y.h1 !== 1) fail(`${name}: ${a11y.h1} visible h1`);
  for (const u of a11y.unnamed) fail(`${name}: a control with no name: ${u}`);
  if (a11y.noAlt) fail(`${name}: ${a11y.noAlt} images with no alt text`);
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

    // Home, as it plays (about 7 s in: a decision on the stage).
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForTimeout(7000);
    await look(page, `/ ${tag}`, w);
    if ((await page.locator(".scene").count()) !== 3) fail(`/ ${tag}: not three scenes`);
    if ((await page.locator(".tile").count()) !== 5) fail(`/ ${tag}: not five proof numbers`);
    if ((await page.locator("nav.tabs a").count()) !== 4) fail(`/ ${tag}: not four tabs`);
    await page.screenshot({ path: join(shots, `home-${tag}.png`) });
    await page.screenshot({ path: join(shots, `home-full-${tag}.png`), fullPage: true });
    // A still frame with Face ID and a refusal on the rails (the frame is picked from the record's highlights).
    await page.goto(`${base}/?frame=13`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    await look(page, `/?frame ${tag}`, w);
    await page.locator("[data-stage]").screenshot({ path: join(shots, `home-stage-${tag}.png`) });

    // Watch: the start, playing, then the dispute scene a few steps in.
    await page.goto(`${base}/watch`, { waitUntil: "load" });
    await page.waitForTimeout(6000);
    await look(page, `/watch ${tag}`, w);
    if ((await page.locator("ol.log li").count()) < 2) fail(`/watch ${tag}: nothing played`);
    if (!/Replay of .* · test money · \d+ of \d+ decisions by Claude/.test(await page.locator(".pill.run").innerText())) fail(`/watch ${tag}: no honest label`);
    await page.screenshot({ path: join(shots, `watch-${tag}.png`) });
    await page.goto(`${base}/watch?at=31&autoplay=0`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    await look(page, `/watch?at=31 ${tag}`, w);
    await page.screenshot({ path: join(shots, `watch-scene3-${tag}.png`) });
    await page.screenshot({ path: join(shots, `watch-full-${tag}.png`), fullPage: true });
    await context.close();
  }
}
await browser.close();
server.close();
if (failures.length) { console.log(`\nredesign check: ${failures.length} problem(s)`); process.exit(1); }
console.log(`redesign check passes: /, /watch at 390 and 1440 px, light and dark (screenshots in ${shots})`);
