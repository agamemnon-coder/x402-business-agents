// The README's evidence map (docs/assets/readme/evidence-map-{light,dark}.svg, drawn by npm run evidence:wall from
// src/redesign/evidenceMap.ts) in Chromium, as GitHub shows it: an <img> in a 900 px column, light and dark. Opened on its
// own, every line of text sits inside its box (with the system font the picture names), no text renders under 14 px at
// 900 px, the dots move, and under prefers-reduced-motion they do not. Screenshots: the README's top at 900 px in both
// schemes, a frame mid-loop and the still frame.
//   npx tsx test/browser/readme-map.check.ts [screenshot dir]
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { README_MAP_FILES } from "../../src/redesign/evidenceMap.js";
import { browserName, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "test-results/readme-map";
mkdirSync(shots, { recursive: true });
let failed = 0;
const fail = (what: string) => { failed++; console.log(`FAIL  ${what}`); };
const WIDTH = 900;
const dataUri = (p: string) => `data:image/svg+xml;base64,${readFileSync(p).toString("base64")}`;
const thumb = `data:image/jpeg;base64,${readFileSync("docs/assets/readme/demo-thumb.jpg").toString("base64")}`;

const browser = await launchBrowser(browserName());
for (const scheme of ["light", "dark"] as const) {
  const file = README_MAP_FILES[scheme];
  const svgText = readFileSync(file, "utf8");
  if (/<script|href="http|xlink:href|@import|url\(/i.test(svgText)) fail(`${file}: something external or a script inside`);
  if (!/@media \(prefers-reduced-motion: reduce\)/.test(svgText)) fail(`${file}: no reduced-motion rule`);
  // On its own, at the README's width: text inside its box, nothing under 14 px.
  for (const motion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: 700 }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: motion });
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(file)).href);
    await page.setViewportSize({ width: WIDTH, height: 700 });
    await page.evaluate(`(() => { const s = document.documentElement; s.setAttribute("width", "${WIDTH}"); s.removeAttribute("height"); })()`);
    const r = (await page.evaluate(`(() => {
      const svg = document.documentElement, k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const out = [], small = [];
      for (const g of svg.querySelectorAll("g.em-n, g.em-p")) {
        const box = g.querySelector("rect"), bx = box.x.baseVal.value, bw = box.width.baseVal.value;
        for (const t of g.querySelectorAll("text")) {
          const b = t.getBBox();
          if (b.x + b.width > bx + bw - 3) out.push(t.textContent);
          const px = parseFloat(getComputedStyle(t).fontSize) * k;
          if (px < 14) small.push(t.textContent + " " + px.toFixed(1));
        }
      }
      const dot = svg.querySelector(".em-dot:not(.halo)");
      return { out, small, anim: dot ? getComputedStyle(dot).animationName : null, k };
    })()`)) as { out: string[]; small: string[]; anim: string | null; k: number };
    if (r.out.length) fail(`${file} ${motion}: text wider than its box: ${r.out.join(" | ")}`);
    if (r.small.length) fail(`${file} ${motion}: text under 14 px at ${WIDTH} px: ${r.small.slice(0, 4).join(" | ")}`);
    if (motion === "no-preference" ? r.anim !== "em-move" : r.anim !== "none") fail(`${file} ${motion}: the dot's animation is ${r.anim}`);
    if (motion === "reduce" && scheme === "light") await page.locator("svg").screenshot({ path: join(shots, "readme-map-reduced-motion.png"), timeout: 90_000 });
    if (motion === "no-preference" && scheme === "light") { await page.waitForTimeout(2600); await page.locator("svg").screenshot({ path: join(shots, "readme-map-mid-animation.png"), animations: "allow", timeout: 90_000 }); }
    if (!failed) console.log(`ok    ${file} at ${WIDTH} px, ${motion}: every line in its box, none under 14 px`);
    await context.close();
  }
  // As GitHub shows it: the README's top, the demo's thumbnail, then the map as an <img> in a 900 px column.
  const context = await browser.newContext({ viewport: { width: WIDTH + 48, height: 1400 }, deviceScaleFactor: 1, colorScheme: scheme });
  const page = await context.newPage();
  const bg = scheme === "dark" ? "#0d1117" : "#ffffff", fg = scheme === "dark" ? "#e6edf3" : "#1f2328";
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${bg};color:${fg};font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"><article style="width:${WIDTH}px;margin:0 24px;padding:16px 0">
    <h1 style="text-align:center;font-size:2em">Purser · AI agents spend. You sign off.</h1>
    <p><img src="${thumb}" width="100%" alt=""></p>
    <p><a href="#"><img src="${dataUri(file)}" width="100%" alt=""></a></p>
  </article></body></html>`);
  await page.waitForTimeout(800);
  await page.locator("article").screenshot({ path: join(shots, `readme-map-${scheme}.png`), animations: "allow", timeout: 90_000 });
  await context.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
