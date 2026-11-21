// The README's small demo (docs/assets/readme/demo-*.svg, drawn by scripts/readme-demo-svg.ts) in Chromium, as GitHub
// shows it: an <img> in the README's column, about 830 px on a desktop and 326 px on a 390 px phone (where the README
// picks the narrow drawing). Opened on its own at that width: every line of text sits inside its card (with the system
// font the picture names), none renders under 8.5 px, the progress rail animates, and under prefers-reduced-motion
// nothing moves and the last frame shows. Screenshots of each, mid-animation and still. Replaces the evidence map's
// check (21 Nov 2026, Max: "the second architecture animation can go").
//   npx tsx test/browser/readme-demo.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEMO_FILES } from "../../scripts/readme-demo-svg.js";
import { browserName, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "test-results/readme-demo";
mkdirSync(shots, { recursive: true });
let failed = 0;
const fail = (what: string) => { failed++; console.log(`FAIL  ${what}`); };

const browser = await launchBrowser(browserName());
for (const [key, file] of Object.entries(DEMO_FILES)) {
  const width = key.startsWith("narrow") ? 326 : 830;
  const scheme = key.endsWith("dark") ? "dark" : "light";
  for (const motion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: motion });
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(file)).href);
    await page.evaluate(`(() => { const s = document.documentElement; s.setAttribute("width", "${width}"); s.removeAttribute("height"); })()`);
    const r = (await page.evaluate(`(() => {
      const svg = document.documentElement, vb = svg.viewBox.baseVal, k = svg.getBoundingClientRect().width / vb.width;
      const out = [], small = [];
      for (const t of svg.querySelectorAll("text")) {
        if (!t.textContent.trim()) continue;
        const b = t.getBBox(), box = t.parentNode.querySelector(":scope > rect");
        const right = box && box.width.baseVal.value > 100 ? box.x.baseVal.value + box.width.baseVal.value : vb.width;
        if (b.x + b.width > right - 2 || b.x < 0) out.push(t.textContent);
        const px = parseFloat(getComputedStyle(t).fontSize) * k;
        if (px < 8.5) small.push(t.textContent.slice(0, 30) + " " + px.toFixed(1));
      }
      const fill = svg.querySelector(".fill");
      return { out, small, anim: fill ? getComputedStyle(fill).animationName : null };
    })()`)) as { out: string[]; small: string[]; anim: string | null };
    if (r.out.length) fail(`${file} at ${width} px: text outside its card: ${r.out.join(" | ")}`);
    if (r.small.length) fail(`${file} at ${width} px: text under 8.5 px: ${r.small.slice(0, 4).join(" | ")}`);
    if (motion === "no-preference" ? !/^grow/.test(r.anim ?? "") : r.anim !== "none") fail(`${file} ${motion}: the rail's animation is ${r.anim}`);
    if (motion === "no-preference") await page.waitForTimeout(2200);
    await page.locator("svg").screenshot({ path: join(shots, `${key}-${motion === "reduce" ? "still" : "mid"}.png`), animations: "allow", timeout: 90_000 });
    if (!r.out.length && !r.small.length) console.log(`ok    ${file} at ${width} px, ${motion}: every line in its card, none under 8.5 px`);
    await context.close();
  }
}
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
