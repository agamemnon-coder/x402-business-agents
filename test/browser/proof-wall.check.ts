// /proof's evidence flow and evidence tiles in the browser (src/redesign/proofFlow.ts, src/redesign/proofQuestions.ts; the
// architecture drawing, the evidence map and the wall before), on `npm run judge` started here (the page under its own CSP): at 360, 390 and 1440 px, light and dark, every tile of docs/evidence/evidence-wall.json is there with its
// figure and its link, at least 44 px high, inside the screen; the page is no wider than the screen; no console error,
// page error or CSP report. Screenshots of the wall at 390 x 844 and 1440 x 900, light and dark (device scale 1).
// The full /proof check (order, tap targets, folds) is test/browser/pages.check.ts.
//   npx tsx test/browser/proof-wall.check.ts [screenshot dir] [--live <url>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startJudge } from "../../src/cli/judge.js";
import { committedWall } from "../../src/redesign/evidenceWall.js";
import { browserName, launchBrowser } from "./support/browser.js";
import { FLOW_STEPS } from "../../src/redesign/proofFlow.js";

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
// 2560 and 3840 px (Max, 21 Nov: "razor-sharp at 4K"): no narrow column, nothing wider than the screen.
for (const [w, h] of [[360, 800], [390, 844], [1440, 900], [2560, 1440], [3840, 2160]] as const) {
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
    // The evidence flow (src/redesign/proofFlow.ts, 21 Nov; the animated architecture and the evidence map before it): the
    // path of one payment, every step closed on load and a link in the overview to it; each step opened shows the wall's
    // tiles for it, as the wall's file has them, each at least 44 px high and inside the screen, its limits and its link
    // to the section that proves it; the one-cent step is one of them. Scrolled to its end, every connector is lit.
    const flow = (await page.evaluate(`(() => {
      const f = document.querySelector("main figure.pflow");
      if (!f) return null;
      const steps = [...f.querySelectorAll("li.pf-step details.pf-x")];
      const track = [...f.querySelectorAll("ol.pf-track a")].map((a) => { const r = a.getBoundingClientRect(), href = a.getAttribute("href") || ""; return { href, to: !!document.getElementById(href.slice(1)), h: r.height }; });
      const open = steps.filter((d) => d.open).length;
      steps.forEach((d) => { d.open = true; });
      const tiles = [...f.querySelectorAll("li.pf-e")].map((li) => { const a = li.querySelector("a"), r = a.getBoundingClientRect(); return { key: li.getAttribute("data-flow"), rec: li.getAttribute("data-rec") || "", fig: (li.querySelector(".pf-f") || {}).textContent || "", href: a.getAttribute("href"), h: r.height, left: r.left, right: r.right }; });
      const more = steps.map((d) => { const a = d.querySelector("a.pf-more"); return a ? !!document.getElementById((a.getAttribute("href") || "").slice(1)) : false; });
      const limits = steps.map((d) => d.querySelectorAll(".pf-lim li").length);
      const cent = !!f.querySelector("details#pf-cent a.pf-try[href='books#cent']");
      steps.forEach((d) => { d.open = false; });
      return { n: steps.length, open, track, tiles, more, limits, cent, width: f.getBoundingClientRect().width };
    })()`)) as { n: number; open: number; track: { href: string; to: boolean; h: number }[]; tiles: { key: string; rec: string; fig: string; href: string; h: number; left: number; right: number }[]; more: boolean[]; limits: number[]; cent: boolean; width: number } | null;
    if (!flow) fail(`${tag}: no evidence flow`);
    else {
      if (flow.n !== FLOW_STEPS.length || flow.open) fail(`${tag}: the flow has ${flow.n} steps (${FLOW_STEPS.length} expected), ${flow.open} open on load`);
      if (flow.track.length !== flow.n || flow.track.some((x) => !x.to || x.h < 44)) fail(`${tag}: the overview does not link every step, or a link is under 44 px (${JSON.stringify(flow.track)})`);
      const all = new Map(wall.groups.flatMap((g) => g.tiles).map((t) => [t.key, t] as const));
      const keys = FLOW_STEPS.flatMap((x) => x.keys.filter((k) => all.has(k)));
      if (flow.tiles.length !== keys.length) fail(`${tag}: ${flow.tiles.length} tiles in the flow, ${keys.length} expected`);
      for (const t of flow.tiles) {
        const r = all.get(t.key);
        if (!r || r.fig !== t.fig || r.href !== t.href || !t.rec) fail(`${tag}: flow tile ${t.key} not as its record says (${JSON.stringify(t)})`);
        else if (t.h < 44 || t.left < 0 || t.right > w + 0.5) fail(`${tag}: flow tile ${t.key} under 44 px or outside the screen (${JSON.stringify(t)})`);
      }
      if (flow.more.some((x) => !x) || flow.limits.some((x) => x < 1)) fail(`${tag}: a step without its limits or its link to a section on the page`);
      if (!flow.cent) fail(`${tag}: no one-cent step with its link to the books' one-cent demo`);
      if (w >= 2560 && flow.width < 900) fail(`${tag}: the flow is a narrow column (${flow.width} px)`);
    }
    await page.evaluate(() => document.querySelector("main figure.pflow")?.scrollIntoView({ block: "end" }));
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(120); }
    await page.waitForTimeout(1200);
    const lit = (await page.evaluate(`(() => { const s = [...document.querySelectorAll("main figure.pflow li.pf-step")]; return [s.filter((x) => x.classList.contains("lit")).length, s.length]; })()`)) as [number, number];
    if (lit[0] !== lit[1]) fail(`${tag}: ${lit[0]} of ${lit[1]} steps lit after scrolling past the flow`);
    await page.evaluate(() => scrollTo(0, 0));
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
    }
    if (!failed) console.log(`ok    /proof evidence tiles ${tag}: ${tiles.length} tiles`);
    await context.close();
  }
}
// Under prefers-reduced-motion: nothing moves, and every connector of the flow is lit from the start.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${base}/proof`, { waitUntil: "load" });
  const still = (await page.evaluate(`(() => { const f = document.querySelector("main figure.pflow"); if (!f) return null; return { js: f.classList.contains("js"), moving: [...f.querySelectorAll("*")].filter((e) => getComputedStyle(e).animationName !== "none").length, dark: [...f.querySelectorAll(".pf-light")].filter((e) => getComputedStyle(e).transform !== "none").length }; })()`)) as { js: boolean; moving: number; dark: number } | null;
  if (!still || still.js || still.moving || still.dark) fail(`reduced motion: the flow moves or a connector is dark (${JSON.stringify(still)})`);
  await page.evaluate(() => document.querySelectorAll("header, .top, nav.top").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
  await page.locator("#architecture").screenshot({ path: join(shots, "proof-map-1440-reduced-motion.png") });
  if (!failed) console.log("ok    /proof evidence flow under reduced motion: still, every connector lit");
  await context.close();
}
await browser.close();
judge?.server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
