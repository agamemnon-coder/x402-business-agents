// The partner pages' evidence strips (src/redesign/evidenceWall.ts evidenceStripHtml) on `npm run judge` started here:
// /airwallex, /alta and /visa (and the TAP section's strip on /visa) at 360, 390 and 1440 px, light and dark, and
// /airwallex's lead chips under its heading (19 Nov). Every tile
// the strip names is there with the wall's figure and link, at least 44 px high, inside the screen and its own box; the
// group link goes to /proof; the page is no wider than the screen. Screenshots of each strip at 390 and 1440, light.
//   npx tsx test/browser/partner-strips.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startJudge } from "../../src/cli/judge.js";
import { PARTNER_LEADS, PARTNER_LEAD_ID, PARTNER_STRIPS, committedWall } from "../../src/redesign/evidenceWall.js";
import { browserName, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "test-results/partner-strips";
mkdirSync(shots, { recursive: true });
const judge = await startJudge(0);
const wall = committedWall();
if (!wall) throw new Error("no docs/evidence/evidence-wall.json: run npm run evidence:wall");
const tiles = new Map(wall.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
let failed = 0;
const fail = (what: string) => { failed++; console.log(`FAIL  ${what}`); };

const PAGES: [string, (keyof typeof PARTNER_STRIPS)[]][] = [["/airwallex", ["airwallex"]], ["/alta", ["alta"]], ["/visa", ["visa", "tap"]]];
const browser = await launchBrowser(browserName());
for (const [w, h] of [[360, 800], [390, 844], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const phone = w < 500;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: phone, hasTouch: phone });
    for (const [path, strips] of PAGES) {
      const tag = `${path} ${w} ${scheme}`;
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(`${judge.url}${path}`, { waitUntil: "load" });
      for (const strip of strips) {
        const id = `live-${strip}`;
        const seen = (await page.evaluate(`(() => { const s = document.getElementById("${id}"); if (!s) return null;
          return { group: (s.querySelector(".ps-h a") || {}).getAttribute ? s.querySelector(".ps-h a").getAttribute("href") : null,
            tiles: [...s.querySelectorAll("li.ew-t")].map((li) => { const a = li.querySelector("a"), r = li.getBoundingClientRect();
              return { key: li.getAttribute("data-wall"), fig: (li.querySelector(".ew-f") || {}).textContent || "", href: a.getAttribute("href"), h: a.getBoundingClientRect().height, left: r.left, right: r.right, spill: a.scrollWidth > a.clientWidth + 1 }; }) }; })()`)) as { group: string | null; tiles: { key: string; fig: string; href: string; h: number; left: number; right: number; spill: boolean }[] } | null;
        if (!seen) { fail(`${tag}: no strip #${id}`); continue; }
        if (seen.group !== `proof#${PARTNER_STRIPS[strip].group}`) fail(`${tag}: the strip's link is ${seen.group}`);
        const want = PARTNER_STRIPS[strip].keys.filter((k) => tiles.has(k));
        if (seen.tiles.map((t) => t.key).join() !== want.join()) fail(`${tag}: tiles ${seen.tiles.map((t) => t.key).join()} not ${want.join()}`);
        for (const t of seen.tiles) {
          const rec = tiles.get(t.key);
          if (!rec || t.fig !== rec.fig || t.href !== rec.href) fail(`${tag}: ${t.key} not as the wall's file says (${t.fig})`);
          if (t.h < 44 || t.left < 0 || t.right > w + 0.5 || t.spill) fail(`${tag}: ${t.key} under 44 px, outside the screen or spilling (${JSON.stringify(t)})`);
        }
        if (scheme === "light" && (w === 390 || w === 1440)) {
          await page.evaluate(() => document.querySelectorAll("header, .top").forEach((e) => { (e as HTMLElement).style.visibility = "hidden"; }));
          await page.locator(`#${id}`).screenshot({ path: join(shots, `strip-${strip}-${w}.png`) });
        }
      }
      // /airwallex's lead (19 Nov): the strongest of the wall's figures as chips under the heading, each the wall's figure
      // and link, at least 44 px high, inside the screen, above the page's path of products.
      if (path === "/airwallex") {
        const lead = (await page.evaluate(`(() => { const s = document.getElementById("${PARTNER_LEAD_ID("airwallex")}"), h1 = document.querySelector("main h1"), path = document.querySelector("ol.awpath"); if (!s) return null;
          return { below: s.getBoundingClientRect().top >= h1.getBoundingClientRect().bottom, beforePath: !!path && !!(s.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING),
            chips: [...s.querySelectorAll("li")].map((li) => { const a = li.querySelector("a"), r = a.getBoundingClientRect(); return { key: li.getAttribute("data-wall"), fig: (a.querySelector("b") || {}).textContent || "", href: a.getAttribute("href"), h: r.height, left: r.left, right: r.right, spill: a.scrollWidth > a.clientWidth + 1 }; }) }; })()`)) as { below: boolean; beforePath: boolean; chips: { key: string; fig: string; href: string; h: number; left: number; right: number; spill: boolean }[] } | null;
        const want = PARTNER_LEADS.airwallex.items.map((i) => i.key).filter((k) => tiles.has(k));
        if (!lead) fail(`${tag}: no lead #${PARTNER_LEAD_ID("airwallex")}`);
        else {
          if (!lead.below || !lead.beforePath) fail(`${tag}: the lead is not between the heading and the path of products`);
          if (lead.chips.map((c) => c.key).join() !== want.join()) fail(`${tag}: lead chips ${lead.chips.map((c) => c.key).join()} not ${want.join()}`);
          for (const c of lead.chips) {
            const rec = tiles.get(c.key);
            if (!rec || c.fig !== rec.fig || c.href !== rec.href) fail(`${tag}: lead ${c.key} not as the wall's file says (${c.fig})`);
            if (c.h < 44 || c.left < 0 || c.right > w + 0.5 || c.spill) fail(`${tag}: lead ${c.key} under 44 px, outside the screen or spilling (${JSON.stringify(c)})`);
          }
          if (scheme === "light" && (w === 390 || w === 1440)) await page.locator(`#${PARTNER_LEAD_ID("airwallex")}`).screenshot({ path: join(shots, `lead-airwallex-${w}.png`) });
        }
      }
      const over = (await page.evaluate(() => document.documentElement.scrollWidth)) - w;
      if (over > 1) fail(`${tag}: the page is ${over}px wider than the screen`);
      if (errors.length) fail(`${tag}: errors: ${errors.join(" | ").slice(0, 200)}`);
      if (!failed) console.log(`ok    ${tag}: ${strips.join(", ")}`);
      await page.close();
    }
    await context.close();
  }
}
await browser.close();
judge.server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
