// npm run submission: the submission pack's files (awards item 6), from the recorded pages and files. Writes
//   docs/submission/screens/1-6 *.png   six screenshots of the recorded pages at 1440 x 900 (npm run judge serves them)
//   docs/submission/screens/7-* .. 13-*  close-ups for the deck, one panel each (rails, inspector, enterprise cards,
//                                        Try Purser, overview, Claude, the run's result)
//   docs/submission/screens/14-dispute   the main run's dispute on /watch, at the CFO's rejection of the refund batch
//   docs/submission/purser-deck.pdf      sixteen slides, one picture each (src/submission/deck.ts); the phone screens
//                                        (screens/phone-*.png) come from test/browser/approve.check.ts, a dev-test world
//   out/submission/purser-source.zip     git archive of the current commit: code and docs, no keys, no ledger
// Nothing is sent anywhere; Max uploads them.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // The CFO dashboard, its disputes and its books replay the main run (3 Nov), not the 30 October recording.
  ["2-dashboard", "/?autonomy"],
  ["3-metal", "/metal"],
  ["4-live", "/live?scene=refuse&autoplay=0"],
  ["5-disputes", "/?autonomy&disputes"],
  ["6-books", "/?autonomy&books"],
  ["15-watch", "/watch"],
  ["16-proof", "/proof"],
  // The main run's card story (3 Nov): the TAP-signed card buy approved by Airwallex; the TAP run's decline labelled.
  ["17-visa", "/visa"],
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
  // The sticky header stays out of close-ups: it would otherwise lie across the element being captured.
  // Set on the elements themselves: the pages' CSP refuses an added stylesheet.
  const unstick = () => page.evaluate(() => document.querySelectorAll<HTMLElement>(".top, header").forEach((e) => e.style.setProperty("position", "static", "important")));
  // One panel per slide, so its text stays readable at slide size.
  const CLOSEUPS: [string, string, string[]][] = [
    ["7-rails", "/", [".rail.awx header", "#rail-awx"]],
    ["8-inspector", "/metal", ["#inspector-sec"]],
    ["9-four-eyes", "/metal", ["#card-four-eyes"]],
    ["9-compliance", "/metal", ["#card-compliance"]],
    ["11-overview", "/?recorded", ["#kpis", "#cards"]],
    ["12-claude", "/?recorded", ["#claude-panel"]],
    ["13-result", "/?recorded&books", ["#books .panel.bk"]],
  ];
  for (const [name, path, sels] of CLOSEUPS) {
    await page.goto(`${judge.url}${path}`, { waitUntil: "load" });
    await unstick();
    await page.waitForTimeout(1200);
    // A panel no longer on its page (the landing became Home on 2 Nov): the earlier close-up is kept as it was.
    if ((await page.locator(sels[0]!).count()) === 0) { console.log(`screens/${name}.png  kept: ${path} has no ${sels[0]}`); continue; }
    // One element, or the box around several (the three enterprise cards), captured from the full page.
    const boxes = await Promise.all(sels.map(async (sel) => (await page.locator(sel).first().boundingBox())!));
    const [x, y] = [Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y))];
    const clip = { x: x - 8, y: y - 8, width: Math.max(...boxes.map((b) => b.x + b.width)) - x + 16, height: Math.max(...boxes.map((b) => b.y + b.height)) - y + 16 };
    await page.evaluate((top) => window.scrollTo(0, top), 0);
    await page.screenshot({ path: resolve(shots, `${name}.png`), clip, fullPage: true });
    console.log(`screens/${name}.png  ${path} ${sels.join(" ")}`);
  }
  // The dispute slide, from the main run (3 Nov): /watch's full run held at the CFO's Face ID rejection of the refund
  // batch, so the three refunds on chain sit just under it. The step is found in the page's own run data.
  await page.goto(`${judge.url}/watch?full=1&autoplay=0`, { waitUntil: "load" });
  const rejectAt = await page.evaluate(() => (JSON.parse(document.getElementById("run-data")!.textContent!) as { events: { k: string; status?: string; title?: string }[] }).events
    .findIndex((e) => e.k === "face" && e.status === "REJECTED" && /refund/i.test(e.title ?? "")));
  if (rejectAt < 0) throw new Error("the main run on /watch has no rejected refund batch");
  await page.goto(`${judge.url}/watch?full=1&at=${rejectAt}&autoplay=0`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(shots, "14-dispute.png") });
  console.log(`screens/14-dispute.png  /watch?full=1&at=${rejectAt}&autoplay=0`);
  // Two moments of the film (1920x1080), from the same recorded pages: the card declined then raised, and the
  // mandate refusing the price rise. Taken here, not from a rendered video, so they always show the pages as they are.
  const film = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, t] of [["live-decline", 50], ["live-refuse", 95.5]] as const) {
    await film.goto(`${judge.url}/film?t=${t}`, { waitUntil: "load" });
    await film.waitForTimeout(900);
    await film.screenshot({ path: resolve(shots, `${name}.png`) });
    console.log(`screens/${name}.png  /film?t=${t}`);
  }
  await film.close();
  await page.goto(`${judge.url}/try?q=${encodeURIComponent("Pay our supplier €1,180")}`, { waitUntil: "load" });
  await page.waitForSelector(".outcome.show", { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(shots, "10-try.png") });
  console.log("screens/10-try.png  /try (offline: code reads the task)");

  const png = (name: string) => `data:image/png;base64,${readFileSync(resolve(shots, `${name}.png`)).toString("base64")}`;
  const deckShots: DeckShots = {
    landing: png("1-landing"), dashboard: png("2-dashboard"), metal: png("3-metal"), live: png("4-live"), disputes: png("5-disputes"), books: png("6-books"),
    rails: png("7-rails"), inspector: png("8-inspector"), fourEyes: png("9-four-eyes"), compliance: png("9-compliance"), try: png("10-try"),
    overview: png("11-overview"), claude: png("12-claude"), result: png("13-result"), dispute: png("14-dispute"), watch: png("15-watch"), proof: png("16-proof"), visa: png("17-visa"),
    // Moments of the film, taken above.
    refuse: png("live-refuse"), decline: png("live-decline"),
    phoneOptions: png("phone-options"), phoneConfirm: png("phone-confirm"),
    // Max's photo for the team slide, when he has added it (docs/submission/screens/max.jpg); a placeholder until then.
    max: existsSync(resolve(shots, "max.jpg")) ? `data:image/jpeg;base64,${readFileSync(resolve(shots, "max.jpg")).toString("base64")}` : "",
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
