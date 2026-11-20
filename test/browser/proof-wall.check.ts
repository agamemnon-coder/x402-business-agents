// /proof's architecture and evidence tiles in the browser (src/redesign/proofArch.ts, src/redesign/proofQuestions.ts; the
// evidence map and wall before 21 Nov), on `npm run judge` started here (the page under its own CSP): at 360, 390 and 1440 px, light and dark, every tile of docs/evidence/evidence-wall.json is there with its
// figure and its link, at least 44 px high, inside the screen; the page is no wider than the screen; no console error,
// page error or CSP report. Screenshots of the wall at 390 x 844 and 1440 x 900, light and dark (device scale 1).
// The full /proof check (order, tap targets, folds) is test/browser/pages.check.ts.
//   npx tsx test/browser/proof-wall.check.ts [screenshot dir] [--live <url>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startJudge } from "../../src/cli/judge.js";
import { committedWall } from "../../src/redesign/evidenceWall.js";
import { browserName, launchBrowser } from "./support/browser.js";

const args = process.argv.slice(2);
const liveAt = args.indexOf("--live");
const shots = args[0] && !args[0].startsWith("--") ? args[0] : "test-results/proof-wall";
mkdirSync(shots, { recursive: true });
const judge = liveAt >= 0 ? null : await startJudge(0);
const base = liveAt >= 0 ? args[liveAt + 1]!.replace(/\/$/, "") : judge!.url;
const wall = committedWall();
if (!wall) throw new Error("no docs/evidence/evidence-wall.json: run npm run evidence:wall");
const want = wall.groups.flatMap((g) => g.tiles).filter((t) => !t.offProof);

let failed = 0;
const fail = (what: string) => { failed++; console.log(`FAIL  ${what}`); };
const browser = await launchBrowser(browserName());
for (const [w, h] of [[360, 800], [390, 844], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const tag = `${w} ${scheme}`;
    const phone = w < 500;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/proof`, { waitUntil: "load" });
    const tiles = (await page.evaluate(`(() => [...document.querySelectorAll("main section.ewall li.ew-t")].map((li) => { const a = li.querySelector("a"), r = li.getBoundingClientRect();
      return { key: li.getAttribute("data-wall"), rec: li.getAttribute("data-rec") || "", href: a ? a.getAttribute("href") : null, fig: (li.querySelector(".ew-f") || {}).textContent || "", tag: (li.querySelector(".ew-tag") || {}).textContent || "", h: a ? a.getBoundingClientRect().height : 0, left: r.left, right: r.right };
    }))()`)) as { key: string; rec: string; href: string | null; fig: string; tag: string; h: number; left: number; right: number }[];
    if (tiles.length !== want.length) fail(`${tag}: ${tiles.length} tiles, the wall's file has ${want.length}`);
    for (const t of want) {
      const seen = tiles.find((x) => x.key === t.key);
      if (!seen || seen.fig !== t.fig || seen.href !== t.href || !seen.rec || !seen.tag) fail(`${tag}: tile ${t.key} not as its record says (${JSON.stringify(seen)})`);
      else if (seen.h < 44 || seen.left < 0 || seen.right > w + 0.5) fail(`${tag}: tile ${t.key} under 44 px or outside the screen (${JSON.stringify(seen)})`);
    }
    // Each tile's text inside its own box: no figure or line spills over the tile's edge.
    const spill = (await page.evaluate(`(() => [...document.querySelectorAll("main section.ewall li.ew-t a")].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.parentElement.getAttribute("data-wall")))()`)) as string[];
    if (spill.length) fail(`${tag}: text wider than its tile: ${spill.join(", ")}`);
    const over = (await page.evaluate(() => document.documentElement.scrollWidth)) - w;
    if (over > 1) fail(`${tag}: the page is ${over}px wider than the screen`);
    // The tiles' colours come from the theme: the figure is not the background's colour in either scheme.
    const contrast = (await page.evaluate(`(() => { const a = document.querySelector("main section.ewall li.ew-t a"); if (!a) return null; const f = a.querySelector(".ew-f"); return [getComputedStyle(a).backgroundColor, getComputedStyle(f).color]; })()`)) as [string, string] | null;
    if (!contrast || contrast[0] === contrast[1]) fail(`${tag}: the tile's figure has the tile's own colour (${JSON.stringify(contrast)})`);
    // The architecture (src/redesign/proofArch.ts, 21 Nov; the evidence map before it): one drawing in sight (wide, or
    // tall on a phone), every part a link to a section or block on the page, 44 px or more and inside the screen; its
    // dots move. The dots run under the boxes (drawn before them), so no dot crosses a box's text.
    const map = (await page.evaluate(`(() => {
      const svgs = [...document.querySelectorAll("main figure.parch svg")].filter((e) => e.getBoundingClientRect().height > 0);
      const links = svgs.flatMap((s) => [...s.querySelectorAll("a")]).map((a) => { const r = a.getBoundingClientRect(), href = a.getAttribute("href") || ""; return { href, to: !!document.getElementById(href.slice(1)), h: r.height, left: r.left, right: r.right }; });
      const dot = svgs[0] ? svgs[0].querySelector(".pa-dot") : null;
      const order = svgs[0] ? [...svgs[0].children].map((e) => e.tagName.toLowerCase()) : [];
      return { shown: svgs.map((s) => s.getAttribute("class")), links, anim: dot ? getComputedStyle(dot).animationName : null, under: order.lastIndexOf("path") < order.indexOf("a") };
    })()`)) as { shown: string[]; links: { href: string; to: boolean; h: number; left: number; right: number }[]; anim: string | null; under: boolean };
    if (map.shown.length !== 1 || map.shown[0] !== (w <= 760 ? "pa-tall" : "pa-wide")) fail(`${tag}: the architecture shows ${JSON.stringify(map.shown)}, not one ${w <= 760 ? "tall" : "wide"} drawing`);
    if (map.links.length < 10) fail(`${tag}: only ${map.links.length} parts in the architecture`);
    for (const l of map.links) if (!l.href.startsWith("#") || !l.to || l.h < 44 || l.left < 0 || l.right > w + 0.5) fail(`${tag}: part ${JSON.stringify(l)} does not link to a section on the page, or is under 44 px or outside the screen`);
    if (map.anim !== "pa-move") fail(`${tag}: the architecture's dot does not move (animation ${map.anim})`);
    if (!map.under) fail(`${tag}: a line or dot is drawn over the boxes`);
    // The questions' nav sits under the site's header, never behind it, once the reader is in a section.
    await page.evaluate(() => document.getElementById("q-ai")?.scrollIntoView());
    const stuck = (await page.evaluate(`(() => { const h = document.querySelector("header.top"), n = document.querySelector("main .pq-nav"); return h && n ? [h.getBoundingClientRect().bottom, n.getBoundingClientRect().top] : null; })()`)) as [number, number] | null;
    if (!stuck || stuck[1] < stuck[0] - 1.5) fail(`${tag}: the questions' nav slides under the header (${JSON.stringify(stuck)})`);
    await page.evaluate(() => scrollTo(0, 0));
    if (errors.length) fail(`${tag}: console or page errors: ${errors.join(" | ").slice(0, 300)}`);
    if (w === 390 || w === 1440) {
      // For the element shots only: the nav in its place (a stitched shot of a tall element repeats a sticky bar).
      await page.evaluate(() => document.querySelectorAll("main .pq-nav").forEach((e) => { (e as HTMLElement).style.position = "static"; }));
      // The sticky header would sit over a tall element's shot: hidden for the picture only (CSSOM, allowed by the CSP).
      await page.evaluate(() => document.querySelectorAll("header, .top, nav.top").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
      await page.locator("#architecture").screenshot({ path: join(shots, `proof-map-${w}-${scheme}.png`) });
      await page.locator("#evidence").screenshot({ path: join(shots, `proof-wall-${w}-${scheme}.png`) });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(shots, `proof-top-${w}-${scheme}.png`) });
      if (w === 1440 && scheme === "light") {
        // One frame mid-loop: the green dot on its way, the red one leaving.
        await page.reload({ waitUntil: "load" });
        await page.evaluate(() => document.querySelectorAll("header, .top, nav.top").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
        await page.waitForTimeout(2600);
        await page.locator("#architecture").screenshot({ path: join(shots, "proof-map-1440-mid-animation.png"), animations: "allow" });
      }
    }
    if (!failed) console.log(`ok    /proof evidence tiles ${tag}: ${tiles.length} tiles`);
    await context.close();
  }
}
// Under prefers-reduced-motion: nothing moves, the dots are hidden, the drawing is the same.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${base}/proof`, { waitUntil: "load" });
  const still = (await page.evaluate(`(() => [...document.querySelectorAll("main figure.parch .pa-dot, main figure.parch .pa-box")].map((e) => [getComputedStyle(e).animationName, getComputedStyle(e).opacity]))()`)) as [string, string][];
  if (!still.length || still.some(([a]) => a !== "none")) fail(`reduced motion: something in the architecture still moves (${JSON.stringify(still.filter(([a]) => a !== "none").slice(0, 3))})`);
  await page.evaluate(() => document.querySelectorAll("header, .top, nav.top").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
  await page.locator("#architecture").screenshot({ path: join(shots, "proof-map-1440-reduced-motion.png") });
  if (!failed) console.log("ok    /proof architecture under reduced motion: still");
  await context.close();
}
await browser.close();
judge?.server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
