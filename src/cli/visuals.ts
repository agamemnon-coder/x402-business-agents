// npm run visuals: writes Purser's visual system (src/visuals/svg.ts) to docs/assets/, a light and a dark file of each
// visual in each layout, every figure read from its run record; then renders the social preview (1280×640 PNG) with
// Playwright, as the deck and the other previews are rendered. `--check` writes nothing and fails when a committed
// file differs from what the code draws now (the test holds the same).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { visualFiles, SOCIAL_PNG } from "../visuals/files.js";
import { SOCIAL_SIZE } from "../visuals/svg.js";

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
  await page.setContent(`<!doctype html><style>@font-face{font-family:Inter;src:url("${font}") format("woff2");font-weight:100 900}html,body{margin:0}</style>${svg}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(new URL(SOCIAL_PNG, root), await page.locator("svg").screenshot({ type: "png" }));
  await browser.close();
  console.log(`wrote ${SOCIAL_PNG} (${SOCIAL_SIZE.width}×${SOCIAL_SIZE.height})`);
}
