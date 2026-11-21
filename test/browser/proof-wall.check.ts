// /proof's stages, architecture and evidence tiles in the browser (src/redesign/proofFlow.ts, proofArch.ts,
// proofQuestions.ts; the evidence flow, the architecture drawing, the evidence map and the wall before), on `npm run judge` started here (the page under its own CSP): at 360, 390 and 1440 px, light and dark, every tile of docs/evidence/evidence-wall.json is there with its
// figure and its link, at least 44 px high, inside the screen; the page is no wider than the screen; no console error,
// page error or CSP report. Screenshots of the wall at 390 x 844 and 1440 x 900, light and dark (device scale 1).
// The full /proof check (order, tap targets, folds) is test/browser/pages.check.ts.
//   npx tsx test/browser/proof-wall.check.ts [screenshot dir] [--live <url>]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startJudge } from "../../src/cli/judge.js";
import { committedWall } from "../../src/redesign/evidenceWall.js";
import { browserName, launchBrowser } from "./support/browser.js";
import { FLOW_STEPS, recordHref } from "../../src/redesign/proofFlow.js";

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
    // The stages (src/redesign/proofFlow.ts; Max's mockup, 21 Nov): a strip of the eight stages and a list, both choosing
    // the one panel in sight; each panel shows the wall's tiles for its stage as the wall's file has them, each at least
    // 44 px high and inside the screen, its four links (a record, a log and a source file on GitHub, /verify), its limits
    // and its link to the section that proves it; the one-cent stage among them. Then the architecture: four parts, each
    // with the wall's evidence as links.
    const stg = (await page.evaluate(`(async () => {
      const f = document.querySelector("main section.pstage");
      if (!f) return null;
      const tabs = [...f.querySelectorAll('[role="tab"]')], rows = [...f.querySelectorAll(".ps-row > a")], panels = [...f.querySelectorAll(".ps-panel")];
      const shown = () => panels.filter((p) => p.getBoundingClientRect().height > 0).map((p) => p.id);
      const first = shown();
      const seen = [], tiles = [], links = [], bad = [];
      for (let i = 0; i < tabs.length; i++) {
        (i % 2 ? rows[i] : tabs[i]).click();
        await new Promise((r) => setTimeout(r, 30));
        const s = shown(); seen.push(s.join(","));
        const p = document.getElementById(tabs[i].getAttribute("aria-controls"));
        if (tabs[i].getAttribute("aria-selected") !== "true" || !rows[i].parentElement.classList.contains("on")) bad.push(p.id);
        p.querySelectorAll("details").forEach((d) => { d.open = true; });
        for (const li of p.querySelectorAll("li.pp-c")) { const a = li.querySelector("a"), r = a.getBoundingClientRect(); tiles.push({ key: li.getAttribute("data-flow"), rec: li.getAttribute("data-rec") || "", fig: (li.querySelector(".pf-f") || {}).textContent || "", href: a.getAttribute("href"), h: r.height, left: r.left, right: r.right }); }
        links.push({ id: p.id, b: [...p.querySelectorAll("a.pp-b")].map((a) => ({ href: a.getAttribute("href"), h: a.getBoundingClientRect().height })), limits: p.querySelectorAll(".pf-lim li").length, more: !!document.getElementById((p.querySelector("a.pf-more").getAttribute("href") || "").slice(1)) });
        p.querySelectorAll("details").forEach((d) => { d.open = false; });
      }
      tabs[0].click();
      const tabH = tabs.map((t) => t.getBoundingClientRect().height), rowH = rows.map((t) => t.getBoundingClientRect().height);
      const cent = !!f.querySelector("#pf-cent a.pf-try[href='books#cent']"), nf = !!f.querySelector("a.pf-nf[href='security#not-finished']");
      const arch = document.querySelector("main figure.parch");
      const chips = arch ? [...arch.querySelectorAll("li[data-arch]")].map((li) => { const a = li.querySelector("a"), r = a.getBoundingClientRect(); return { key: li.getAttribute("data-arch"), href: a.getAttribute("href"), fig: (a.querySelector("b") || {}).textContent || "", h: r.height, left: r.left, right: r.right }; }) : [];
      return { n: panels.length, first, seen, bad, tiles, links, tabH, rowH, cent, nf, chips, width: f.getBoundingClientRect().width };
    })()`)) as { n: number; first: string[]; seen: string[]; bad: string[]; tiles: { key: string; rec: string; fig: string; href: string; h: number; left: number; right: number }[]; links: { id: string; b: { href: string; h: number }[]; limits: number; more: boolean }[]; tabH: number[]; rowH: number[]; cent: boolean; nf: boolean; chips: { key: string; href: string; fig: string; h: number; left: number; right: number }[]; width: number } | null;
    if (!stg) fail(`${tag}: no stages`);
    else {
      if (stg.n !== FLOW_STEPS.length || stg.first.join() !== FLOW_STEPS[0]!.id) fail(`${tag}: ${stg.n} stages (${FLOW_STEPS.length} expected), in sight on load: ${stg.first.join()}`);
      if (stg.seen.join("|") !== FLOW_STEPS.map((x) => x.id).join("|") || stg.bad.length) fail(`${tag}: the strip and the list do not choose one panel each (${JSON.stringify(stg.seen)}; not marked: ${stg.bad.join()})`);
      if ([...stg.tabH, ...stg.rowH].some((x) => x < 44)) fail(`${tag}: a tab or a row under 44 px`);
      const all = new Map(wall.groups.flatMap((g) => g.tiles).map((t) => [t.key, t] as const));
      const keys = FLOW_STEPS.flatMap((x) => x.keys.filter((k) => all.has(k)));
      if (stg.tiles.length !== keys.length) fail(`${tag}: ${stg.tiles.length} tiles in the stages, ${keys.length} expected`);
      for (const t of stg.tiles) {
        const r = all.get(t.key);
        if (!r || r.fig !== t.fig || recordHref(r) !== t.href || !t.rec) fail(`${tag}: stage tile ${t.key} not as its record says (${JSON.stringify(t)})`);
        else if (t.h < 44 || t.left < 0 || t.right > w + 0.5) fail(`${tag}: stage tile ${t.key} under 44 px or outside the screen (${JSON.stringify(t)})`);
      }
      const repo = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
      for (const l of stg.links) {
        const hrefs = l.b.map((x) => x.href);
        if (hrefs.length !== 4 || !hrefs[0]!.startsWith(repo) || !/\.md$/.test(hrefs[1]!) || !/\/src\/.+\.ts$/.test(hrefs[2]!) || hrefs[3] !== "verify" || l.b.some((x) => x.h < 44)) fail(`${tag}: ${l.id}'s four links are not a record, a log, a source file and /verify, each 44 px (${JSON.stringify(l.b)})`);
        if (l.limits < 1 || !l.more) fail(`${tag}: ${l.id} without its limits or its link to a section on the page`);
      }
      if (!stg.cent || !stg.nf) fail(`${tag}: no one-cent stage with its link to the books' one-cent demo, or no "What is not finished"`);
      if (w >= 2560 && stg.width < 900) fail(`${tag}: the stages are a narrow column (${stg.width} px)`);
      if (stg.chips.length < 10) fail(`${tag}: the architecture has ${stg.chips.length} evidence chips`);
      for (const c of stg.chips) {
        const r = all.get(c.key);
        if (!r || r.fig !== c.fig || recordHref(r) !== c.href) fail(`${tag}: architecture chip ${c.key} not as its record says (${JSON.stringify(c)})`);
        else if (c.h < 44 || c.left < 0 || c.right > w + 0.5) fail(`${tag}: architecture chip ${c.key} under 44 px or outside the screen (${JSON.stringify(c)})`);
      }
    }
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
      await page.locator("#stages").screenshot({ path: join(shots, `proof-stages-${w}-${scheme}.png`) });
      await page.locator("#architecture").screenshot({ path: join(shots, `proof-map-${w}-${scheme}.png`) });
      await page.locator("#evidence").screenshot({ path: join(shots, `proof-wall-${w}-${scheme}.png`) });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(shots, `proof-top-${w}-${scheme}.png`) });
    }
    if (!failed) console.log(`ok    /proof evidence tiles ${tag}: ${tiles.length} tiles`);
    await context.close();
  }
}
// Under prefers-reduced-motion: nothing in the stages or the architecture moves, and the stages still choose a panel.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${base}/proof`, { waitUntil: "load" });
  await page.locator('main section.pstage [role="tab"]').nth(4).click();
  const still = (await page.evaluate(`(() => { const f = document.querySelector("main section.pstage"), a = document.querySelector("main figure.parch"); if (!f || !a) return null; return { moving: [...f.querySelectorAll("*"), ...a.querySelectorAll("*")].filter((e) => getComputedStyle(e).animationName !== "none").length, shown: [...f.querySelectorAll(".ps-panel")].filter((p) => p.getBoundingClientRect().height > 0).map((p) => p.id).join() }; })()`)) as { moving: number; shown: string } | null;
  if (!still || still.moving || still.shown !== FLOW_STEPS[4]!.id) fail(`reduced motion: the stages or the architecture move, or the strip does not choose (${JSON.stringify(still)})`);
  await page.evaluate(() => document.querySelectorAll("header, .top, nav.top").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
  await page.locator("#architecture").screenshot({ path: join(shots, "proof-map-1440-reduced-motion.png") });
  if (!failed) console.log("ok    /proof stages and architecture under reduced motion: still");
  await context.close();
}
await browser.close();
judge?.server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
