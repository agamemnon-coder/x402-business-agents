// npm run submission: the submission pack's files (awards item 6), from the recorded pages and files. Writes
//   docs/submission/screens/1-6 *.png   six screenshots of the recorded pages at 1440 x 900 (npm run judge serves them)
//   docs/submission/purser-deck.pdf      eight slides with the recorded figures (src/submission/deck.ts)
//   out/submission/purser-source.zip     git archive of the current commit: code and docs, no keys, no ledger
// Nothing is sent anywhere; Max uploads them.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startJudge } from "./judge.js";
import { deckHtml } from "../submission/deck.js";
import { packFacts } from "../submission/facts.js";

const root = resolve(import.meta.dirname, "../..");
const shots = resolve(root, "docs/submission/screens");
const out = resolve(root, "out/submission");
mkdirSync(shots, { recursive: true });
mkdirSync(out, { recursive: true });

const SCREENS: [string, string][] = [
  ["1-landing", "/"],
  ["2-dashboard", "/?recorded"],
  ["3-metal", "/metal"],
  ["4-live", "/live?scene=refuse&autoplay=0"],
  ["5-disputes", "/?recorded&disputes"],
  ["6-books", "/?recorded&books"],
];

const judge = await startJudge(0);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  for (const [name, path] of SCREENS) {
    await page.goto(`${judge.url}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(shots, `${name}.png`) });
    console.log(`screens/${name}.png  ${path}`);
  }
  const deck = await browser.newPage();
  await deck.setContent(deckHtml(packFacts()), { waitUntil: "load" });
  await deck.pdf({ path: resolve(root, "docs/submission/purser-deck.pdf"), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  console.log("purser-deck.pdf");
} finally {
  await browser.close();
  judge.server.close();
}
execFileSync("git", ["archive", "--format=zip", "--prefix=purser/", "-o", resolve(out, "purser-source.zip"), "HEAD"], { cwd: root });
console.log("out/submission/purser-source.zip (the current commit; commit first so it is in)");
