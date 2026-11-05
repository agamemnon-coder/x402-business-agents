// npm run social-preview: renders docs/media/social-preview.html (figures from the main run's record) to
// docs/media/social-preview.png at 1280×640 with Playwright, as the deck and the QR code are rendered.

import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { SOCIAL_HTML, SOCIAL_PNG, SOCIAL_SIZE, loadRecord, socialPreviewHtml } from "../submission/socialPreview.js";

const root = new URL("../../", import.meta.url);
const font = `data:font/woff2;base64,${readFileSync(new URL("src/ui/inter.woff2", root)).toString("base64")}`;
const html = socialPreviewHtml(readFileSync(new URL(SOCIAL_HTML, root), "utf8"), loadRecord(root), font);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: SOCIAL_SIZE, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
writeFileSync(new URL(SOCIAL_PNG, root), await page.screenshot({ type: "png" }));
await browser.close();
console.log(`social preview: ${SOCIAL_PNG} (${SOCIAL_SIZE.width}×${SOCIAL_SIZE.height})`);
