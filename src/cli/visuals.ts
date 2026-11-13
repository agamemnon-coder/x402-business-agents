// npm run visuals: writes Purser's visual system (src/visuals/svg.ts) to docs/assets/, a light and a dark file of each
// visual in each layout, every figure read from its run record; then renders the social preview (1280×640 PNG) with
// Playwright, as the deck and the other previews are rendered. `--check` writes nothing and fails when a committed
// file differs from what the code draws now (the test holds the same).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { visualFiles, SOCIAL_PNG } from "../visuals/files.js";
import { SOCIAL_BUILT_WITH, SOCIAL_LOGOS, SOCIAL_SIZE } from "../visuals/svg.js";
import { BUILT_WITH, BUILT_WITH_PNG } from "../visuals/logos.js";

const root = new URL("../../", import.meta.url);
const check = process.argv.includes("--check");
const files = visualFiles();
let stale = 0;
mkdirSync(new URL("docs/assets/", root), { recursive: true });
for (const [path, body] of Object.entries(files)) {
  let now = "";
  try { now = readFileSync(new URL(path, root), "utf8"); } catch { /* new */ }
  if (now === body) continue;
  if (check) { console.error(`stale: ${path}`); stale++; continue; }
  writeFileSync(new URL(path, root), body);
  console.log(`wrote ${path}`);
}
if (check) {
  if (stale) { console.error(`${stale} visual(s) differ from the code: npm run visuals`); process.exit(1); }
  console.log(`visuals: ${Object.keys(files).length} files match the code`);
} else if (!process.argv.includes("--no-png")) {
  const { chromium } = await import("playwright");
  const font = `data:font/woff2;base64,${readFileSync(new URL("src/ui/inter.woff2", root)).toString("base64")}`;
  const svg = readFileSync(new URL("docs/assets/social-preview.svg", root), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: SOCIAL_SIZE, deviceScaleFactor: 1 });
  // The "Built with" row on the preview: the partners' official files, unmodified, each on a white tile, under the
  // label the SVG draws (SOCIAL_BUILT_WITH); Visa with the agent that ran on it, as the site names it ("Visa (Airi)").
  const logo = (name: string) => {
    const l = BUILT_WITH.find((x) => x.name === name)!, body = readFileSync(new URL(l.file, root)), type = l.file.endsWith(".svg") ? "image/svg+xml" : "image/png";
    return `<span class="t"><img alt="${l.alt}" style="height:${Math.round(l.height * 0.8)}px" src="data:${type};base64,${body.toString("base64")}">${name === "Visa" ? "<em>(Airi)</em>" : ""}</span>`;
  };
  const row = SOCIAL_LOGOS.map(logo).join("");
  await page.setContent(`<!doctype html><style>@font-face{font-family:Inter;src:url("${font}") format("woff2");font-weight:100 900}html,body{margin:0}.c{position:relative;width:${SOCIAL_SIZE.width}px;height:${SOCIAL_SIZE.height}px}.c>svg{display:block}.bw{position:absolute;left:${SOCIAL_BUILT_WITH.x}px;top:${SOCIAL_BUILT_WITH.y + 14}px;display:flex;gap:10px}.t{display:inline-flex;align-items:center;gap:7px;height:46px;padding:0 15px;background:#fff;border:1.5px solid #e3e6ec;border-radius:12px}.t img{display:block;width:auto}.t em{font:italic 600 17px Inter,sans-serif;color:#586174}</style><div class="c">${svg}<div class="bw">${row}</div></div>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const social = await page.locator(".c").screenshot({ type: "png" });
  writeFileSync(new URL(SOCIAL_PNG, root), social);
  // The same image is every page's link preview (src/ui/meta.ts OG_IMAGE, served at /assets/og.png): one file, two places.
  writeFileSync(new URL("src/ui/brand/og.png", root), social);
  // The "Built with" row: each official logo file, unmodified, on its own white tile with clear space; transparent
  // around the tiles so it sits on GitHub's light and dark themes alike. Rendered at 2x.
  const tile = (l: (typeof BUILT_WITH)[number]) => {
    const body = readFileSync(new URL(l.file, root)), type = l.file.endsWith(".svg") ? "image/svg+xml" : "image/png";
    return `<div class="t"><img alt="${l.alt}" style="height:${l.height}px" src="data:${type};base64,${body.toString("base64")}"></div>`;
  };
  const strip = await browser.newPage({ viewport: { width: 900, height: 200 }, deviceScaleFactor: 2 });
  await strip.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}.row{display:inline-flex;gap:16px;padding:2px}.t{background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:20px 30px;display:flex;align-items:center}img{display:block;width:auto}</style><div class="row">${BUILT_WITH.map(tile).join("")}</div>`, { waitUntil: "load" });
  writeFileSync(new URL(BUILT_WITH_PNG, root), await strip.locator(".row").screenshot({ type: "png", omitBackground: true }));
  await browser.close();
  console.log(`wrote ${SOCIAL_PNG} and src/ui/brand/og.png (${SOCIAL_SIZE.width}×${SOCIAL_SIZE.height}) and ${BUILT_WITH_PNG}`);
}
