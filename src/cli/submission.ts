// npm run submission: the submission pack's files (awards item 6), from the recorded pages and files. Writes
//   docs/submission/screens/1-6 *.png   six screenshots of the recorded pages at 1440 x 900 (npm run judge serves them)
//   docs/submission/screens/7-* .. 10-*  close-ups for the deck: the rails, the mandate inspector, the enterprise
//                                        cards, a Try Purser result
//   docs/submission/purser-deck.pdf      fifteen slides, one picture each (src/submission/deck.ts); the phone screens
//                                        (screens/phone-*.png) come from test/browser/approve.check.ts, a dev-test world
//   out/submission/purser-source.zip     git archive of the current commit: code and docs, no keys, no ledger
// Nothing is sent anywhere; Max uploads them.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import QRCode from "qrcode";
import { startJudge } from "./judge.js";
import { deckHtml, TRY_URL, type DeckShots } from "../submission/deck.js";
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
  // Close-ups: one part of a page each, so a slide shows one thing.
  const CLOSEUPS: [string, string, string][] = [
    ["7-rails", "/", "#rails-sec"],
    ["8-inspector", "/metal", "#inspector-sec"],
    ["9-enterprise", "/metal", "#features"],
  ];
  for (const [name, path, sel] of CLOSEUPS) {
    await page.goto(`${judge.url}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.locator(sel).first().screenshot({ path: resolve(shots, `${name}.png`) });
    console.log(`screens/${name}.png  ${path} ${sel}`);
  }
  await page.goto(`${judge.url}/try?q=${encodeURIComponent("Pay our supplier €1,180")}`, { waitUntil: "load" });
  await page.waitForSelector(".outcome.show", { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(shots, "10-try.png") });
  console.log("screens/10-try.png  /try (offline: code reads the task)");

  const png = (name: string) => `data:image/png;base64,${readFileSync(resolve(shots, `${name}.png`)).toString("base64")}`;
  const deckShots: DeckShots = {
    landing: png("1-landing"), dashboard: png("2-dashboard"), metal: png("3-metal"), live: png("4-live"), disputes: png("5-disputes"), books: png("6-books"),
    rails: png("7-rails"), inspector: png("8-inspector"), enterprise: png("9-enterprise"), try: png("10-try"),
    phoneOptions: png("phone-options"), phoneConfirm: png("phone-confirm"),
  };
  const qr = await QRCode.toString(TRY_URL, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const deck = await browser.newPage();
  await deck.setContent(deckHtml(packFacts(), deckShots, qr), { waitUntil: "load" });
  await deck.pdf({ path: resolve(root, "docs/submission/purser-deck.pdf"), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  console.log("purser-deck.pdf");
} finally {
  await browser.close();
  judge.server.close();
}
execFileSync("git", ["archive", "--format=zip", "--prefix=purser/", "-o", resolve(out, "purser-source.zip"), "HEAD"], { cwd: root });
console.log("out/submission/purser-source.zip (the current commit; commit first so it is in)");
