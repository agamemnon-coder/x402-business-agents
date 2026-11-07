// npm run submission: the submission pack's files (awards item 6), from the recorded pages and files. Writes
//   docs/submission/screens/1-6 *.png   six screenshots of the recorded pages at 1440 x 900 (npm run judge serves them)
//   docs/submission/screens/7-* .. 13-*  close-ups for the deck, one panel each (rails, inspector, enterprise cards,
//                                        Try Purser, overview, Claude, the run's result)
//   docs/submission/screens/14-dispute   the main run's dispute on /watch, at the CFO's rejection of the refund batch
//   docs/submission/screens/18-try-sign  /try/sign on a local relay: the exact terms signed and verified, then the same
//                                        signature refused on the amount + 0.01 (the form's screenshot 6 since 6 Nov)
//   docs/submission/purser-deck.pdf      twelve dark slides in the story's order (src/submission/deck.ts)
//   docs/evidence/deck/slide-NN.png      each slide as a PNG, 1280 x 720 (section D, 6 Nov)
// `npm run submission -- --deck-only` renders only the deck (PDF and PNGs) from the screenshots already in
// docs/submission/screens, with no server and no browser visit: for a change to the deck's words alone.
//   docs/media/try-sign-qr.png           the QR code to /try/sign, as on the deck's QR slide (src/submission/qr.ts)
//   docs/internal/spiekkaart-demo.pdf    Max's one-page cheat sheet for Demo Day, from spiekkaart-demo.html
//   out/submission/purser-source.zip     git archive of the current commit: code and docs, no keys, no ledger
// Nothing is sent anywhere; Max uploads them.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { startJudge } from "./judge.js";
import { deckHtml, type DeckShots } from "../submission/deck.js";
import { QR_PNG, qrPng, qrSvg } from "../submission/qr.js";
import { packFacts } from "../submission/facts.js";
import { startLocalRelay } from "../relay/local.js";

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

const deckOnly = process.argv.includes("--deck-only");
const judge = deckOnly ? null : await startJudge(0);
const browser = await chromium.launch();
try {
  if (!deckOnly) await takeScreens();
  await renderDeck();
  if (!deckOnly) {
    // Max's cheat sheet: one A4 from its HTML source (docs/internal/spiekkaart-demo.html), the QR code beside it.
    const card = await browser.newPage();
    await card.goto(`file://${resolve(root, "docs/internal/spiekkaart-demo.html")}`, { waitUntil: "load" });
    await card.pdf({ path: resolve(root, "docs/internal/spiekkaart-demo.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    console.log("docs/internal/spiekkaart-demo.pdf");
  }
} finally {
  await browser.close();
  judge?.server.close();
}
if (!deckOnly) {
  execFileSync("git", ["archive", "--format=zip", "--prefix=purser/", "-o", resolve(out, "purser-source.zip"), "HEAD"], { cwd: root });
  console.log("out/submission/purser-source.zip (the current commit; commit first so it is in)");
}

async function takeScreens(): Promise<void> {
  const judgeUrl = judge!.url;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  for (const [name, path] of SCREENS) {
    await page.goto(`${judgeUrl}${path}`, { waitUntil: "load" });
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
    await page.goto(`${judgeUrl}${path}`, { waitUntil: "load" });
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
  await page.goto(`${judgeUrl}/watch?full=1&autoplay=0`, { waitUntil: "load" });
  const rejectAt = await page.evaluate(() => (JSON.parse(document.getElementById("run-data")!.textContent!) as { events: { k: string; status?: string; title?: string }[] }).events
    .findIndex((e) => e.k === "face" && e.status === "REJECTED" && /refund/i.test(e.title ?? "")));
  if (rejectAt < 0) throw new Error("the main run on /watch has no rejected refund batch");
  await page.goto(`${judgeUrl}/watch?full=1&at=${rejectAt}&autoplay=0`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(shots, "14-dispute.png") });
  console.log(`screens/14-dispute.png  /watch?full=1&at=${rejectAt}&autoplay=0`);
  // Two moments of the film (1920x1080), from the same recorded pages: the card declined then raised, and the
  // mandate refusing the price rise. Taken here, not from a rendered video, so they always show the pages as they are.
  const film = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, t] of [["live-decline", 50], ["live-refuse", 95.5]] as const) {
    await film.goto(`${judgeUrl}/film?t=${t}`, { waitUntil: "load" });
    await film.waitForTimeout(900);
    await film.screenshot({ path: resolve(shots, `${name}.png`) });
    console.log(`screens/${name}.png  /film?t=${t}`);
  }
  await film.close();
  // Sign one yourself (jury review, 6 Nov, #7: the form's screenshot 6, in place of /visa): a local relay with /try/sign
  // on, Chromium's virtual authenticator as the visitor's passkey; a test world only, nothing reaches Airwallex or Metal.
  {
    process.env.TRY_SIGN_ENABLED = "on";
    const relay = await startLocalRelay({ port: 0, token: "submission" });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
      const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      await p.goto(`${relay.url}/try/sign`, { waitUntil: "load" });
      // The world opens when the page is shown; one button signs (the passkey made on the way); then one cent changed.
      await p.waitForFunction(() => !(document.getElementById("go-sign") as HTMLButtonElement).disabled);
      await p.click("#go-sign");
      await p.waitForSelector("#scr-2:not([hidden])");
      await p.click("#go-cheat");
      await p.waitForSelector("#tamper:not([hidden])");
      await p.waitForTimeout(900);
      await p.screenshot({ path: resolve(shots, "18-try-sign.png") });
      console.log("screens/18-try-sign.png  /try/sign (local relay): signed and verified, then one cent changed and refused");
      await ctx.close();
    } finally {
      relay.server.close();
    }
  }
  await page.goto(`${judgeUrl}/try?q=${encodeURIComponent("Pay our supplier €1,180")}`, { waitUntil: "load" });
  await page.waitForSelector(".outcome.show", { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(shots, "10-try.png") });
  console.log("screens/10-try.png  /try (offline: code reads the task)");

}

async function renderDeck(): Promise<void> {
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
  const qr = await qrSvg();
  writeFileSync(resolve(root, QR_PNG), await qrPng());
  console.log(QR_PNG);
  const deck = await browser.newPage();
  await deck.setContent(deckHtml(packFacts(), deckShots, qr), { waitUntil: "load" });
  await deck.pdf({ path: resolve(root, "docs/submission/purser-deck.pdf"), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  console.log("purser-deck.pdf");
  // Each slide as a PNG (section D): one screenshot per <section>, at the slide's own size.
  const pngs = resolve(root, "docs/evidence/deck");
  mkdirSync(pngs, { recursive: true });
  await deck.setViewportSize({ width: 1280, height: 720 });
  const sections = deck.locator("section");
  const n = await sections.count();
  for (let i = 0; i < n; i++) {
    await sections.nth(i).screenshot({ path: resolve(pngs, `slide-${String(i + 1).padStart(2, "0")}.png`) });
  }
  console.log(`docs/evidence/deck/slide-01..${String(n).padStart(2, "0")}.png`);
}
