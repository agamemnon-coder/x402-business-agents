// The four tabs as a juror opens them (Home, Watch, Try, Proof), at 390 and 1440 px, light and dark, against the judge
// server on a port the system picks. Fails on a console or page error (a CSP violation is one), "null", "undefined" or
// "NaN" on screen, a page wider than the screen, not exactly one h1, a nameless control, an image with no alt text,
// text under 14 px in the stage, the timeline or a card, or an internal link that does not end in a 200 (old addresses
// redirect). External links (the testnet explorer, the partners' docs) are not fetched.
//   npx tsx test/browser/redesign.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startJudge } from "../../src/cli/judge.js";

const shots = process.argv[2] ?? "test-results/redesign";
mkdirSync(shots, { recursive: true });
const { server, url: base } = await startJudge(0);
const failures: string[] = [];
const fail = (what: string) => { failures.push(what); console.log(`FAIL  ${what}`); };

async function look(page: Page, name: string, width: number): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const bad = /\b(null|undefined|NaN)\b/.exec(text);
  if (bad) fail(`${name}: shows "${bad[0]}"`);
  const a11y = await page.evaluate(`(() => {
    const visible = (e) => !!e.offsetParent || getComputedStyle(e).position === "fixed";
    const named = (e) => !!(e.getAttribute("aria-label") || e.getAttribute("title") || (e.textContent || "").trim());
    const small = [...document.querySelectorAll(".stage *, ol.log *, .card *, .tile *")].filter((e) => visible(e) && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.className + ": " + (e.textContent || "").trim().slice(0, 30));
    return { lang: document.documentElement.lang, h1: [...document.querySelectorAll("h1")].filter(visible).length,
      unnamed: [...document.querySelectorAll("a, button")].filter((e) => visible(e) && !named(e)).map((e) => e.outerHTML.slice(0, 80)),
      noAlt: [...document.querySelectorAll("img")].filter((e) => !e.hasAttribute("alt")).length, small, body: parseFloat(getComputedStyle(document.body).fontSize) };
  })()`) as { lang: string; h1: number; unnamed: string[]; noAlt: number; small: string[]; body: number };
  if (!a11y.lang) fail(`${name}: no page language`);
  if (a11y.h1 !== 1) fail(`${name}: ${a11y.h1} visible h1`);
  for (const u of a11y.unnamed) fail(`${name}: a control with no name: ${u}`);
  if (a11y.noAlt) fail(`${name}: ${a11y.noAlt} images with no alt text`);
  if (a11y.body < 17) fail(`${name}: body text ${a11y.body}px, under 17`);
  for (const s of a11y.small.slice(0, 5)) fail(`${name}: text under 14 px: ${s}`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth) - width;
  if (over > 1) fail(`${name}: ${over}px wider than the screen`);
}

// Every internal link on the four tabs answers 200 (after a redirect, for an old address).
{
  const seen = new Set<string>();
  for (const path of ["/home", "/watch", "/try", "/proof"]) {
    const html = await (await fetch(`${base}${path}`)).text();
    for (const m of html.matchAll(/href="([^"#]*)(#[^"]*)?"/g)) {
      const href = m[1]!;
      if (!href || /^(https?:|mailto:)/.test(href) || href.startsWith("assets/") && !href.includes(".")) continue;
      const url = new URL(href, `${base}${path}`).toString();
      if (seen.has(url)) continue;
      seen.add(url);
      const res = await fetch(url);
      if (res.status !== 200) fail(`link ${href} on ${path}: ${res.status}`);
    }
  }
  for (const [from, to] of [["/live", "/watch"], ["/demo", "/watch"]] as const) {
    const res = await fetch(`${base}${from}`, { redirect: "manual" });
    if (res.status !== 302 || res.headers.get("location") !== to) fail(`${from} does not redirect to ${to}`);
  }
  console.log(`link check: ${seen.size} internal links`);
}

const browser = await chromium.launch();
for (const [w, h] of [[390, 844], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
    const page = await context.newPage();
    const tag = `${w}-${scheme}`;
    page.on("console", (m) => { if (m.type() === "error") fail(`${tag} ${page.url()}: console error: ${m.text()}`); });
    page.on("pageerror", (e) => fail(`${tag} ${page.url()}: page error: ${e.message}`));
    page.on("requestfailed", (r) => { if (!/testnet\.metalntwx\.com/.test(r.url())) fail(`${tag} ${page.url()}: request failed: ${r.url()}`); });

    // "/" sends a guest to Home. The first frame already shows the refusal on chain; then it plays.
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForURL(/\/home$/);
    await page.waitForTimeout(300);
    // The main run: Metal refused the purchase let through to it, on chain ("Refused by Metal · on chain").
    if (!/Refused · recorded on chain|Refused by Metal · on chain/.test(await page.locator("[data-stage]").innerText())) fail(`/home ${tag}: the first frame does not show the refusal on chain`);
    await page.screenshot({ path: join(shots, `home-first-${tag}.png`) });
    await page.waitForTimeout(9000);
    await look(page, `/home ${tag}`, w);
    if ((await page.locator(".scene").count()) !== 3) fail(`/home ${tag}: not three moments`);
    if ((await page.locator(".tiles .tile").count()) !== 5) fail(`/home ${tag}: not five proof numbers`);
    // The stylesheet parsed to the end (a stray brace once dropped the tiles' style).
    if (await page.locator(".tiles .tile").first().evaluate((e) => getComputedStyle(e).display) !== "flex") fail(`/home ${tag}: the proof tiles lost their style`);
    if ((await page.locator("nav.tabs a").count()) !== 4) fail(`/home ${tag}: not four tabs`);
    if (!/Replay of the main run, 3 Nov \d\d:\d\d–\d\d:\d\d UTC · test money · real Claude decisions/.test(await page.evaluate(() => document.body.innerText))) fail(`/home ${tag}: no run label`);
    // The rail's line is said in full (Max, 2 Nov: it was cut off).
    for (const s of await page.locator("[data-stage] .lane .ln small").all()) if (await s.evaluate((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).display === "none")) fail(`/home ${tag}: a rail line is cut off or hidden`);
    await page.screenshot({ path: join(shots, `home-${tag}.png`) });
    await page.screenshot({ path: join(shots, `home-full-${tag}.png`), fullPage: true });
    // The four-eyes moment, still: 2 of 2 signatures and who the second approver is.
    const sig = await page.evaluate(() => (JSON.parse(document.getElementById("run-data")!.textContent!) as { events: { k: string; signers?: string[] }[]; moments: number[] }).moments.findIndex((i, _n, all) => { const d = JSON.parse(document.getElementById("run-data")!.textContent!) as { events: { k: string; signers?: string[] }[] }; void all; return d.events[i]!.k === "face" && (d.events[i]!.signers ?? []).length > 1; }));
    await page.goto(`${base}/home?frame=${sig}`, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const stage = await page.locator("[data-stage]").innerText();
    if (!/2 of 2 signatures/.test(stage) || !/second approver: labelled test passkey/.test(stage)) fail(`/home ${tag}: the four-eyes frame lacks "2 of 2 signatures" or its label`);
    await page.locator("[data-stage]").screenshot({ path: join(shots, `home-stage-foureyes-${tag}.png`) });

    // Watch: the start, then each moment by its jump.
    await page.goto(`${base}/watch`, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    await look(page, `/watch ${tag}`, w);
    if (!/Replay of the main run, 3 Nov \d\d:\d\d–\d\d:\d\d UTC · test money · real Claude decisions/.test(await page.locator(".pill.run").innerText())) fail(`/watch ${tag}: no run label`);
    if (!/^Highlights$/.test(await page.locator('#mode button[aria-pressed="true"]').innerText())) fail(`/watch ${tag}: not on the highlights by default`);
    if (!/^Full run \(\d+ steps\)$/.test(await page.locator('#mode button[data-mode="full"]').innerText())) fail(`/watch ${tag}: no full-run button with its steps`);
    await page.screenshot({ path: join(shots, `watch-${tag}.png`) });
    for (const n of [1, 2, 3]) {
      await page.goto(`${base}/watch?scene=${n}&autoplay=0`, { waitUntil: "load" });
      await page.waitForTimeout(500);
      await look(page, `/watch scene ${n} ${tag}`, w);
      if ((await page.locator("ol.log li").count()) < (n === 1 ? 1 : 2)) fail(`/watch scene ${n} ${tag}: nothing before the jump`);
      await page.screenshot({ path: join(shots, `watch-scene${n}-${tag}.png`) });
    }
    await page.screenshot({ path: join(shots, `watch-full-${tag}.png`), fullPage: true });
    await page.goto(`${base}/watch?full=1&autoplay=0&scene=1`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    await look(page, `/watch full run ${tag}`, w);
    await page.screenshot({ path: join(shots, `watch-fullrun-${tag}.png`) });

    await page.goto(`${base}/try`, { waitUntil: "load" });
    await page.waitForTimeout(600);
    if ((await page.locator("nav a").count()) !== 4) fail(`/try ${tag}: not the four tabs`);
    if (!(await page.isVisible("#q-price")) || (await page.locator("text=Open a dispute").count())) fail(`/try ${tag}: "Raise the supplier price" missing, or a live dispute offered`);
    if ((await page.locator("#examples i").count()) > 0) fail(`/try ${tag}: dots without a legend`);
    await page.screenshot({ path: join(shots, `try-${tag}.png`) });
    await page.screenshot({ path: join(shots, `try-full-${tag}.png`), fullPage: true });

    await page.goto(`${base}/proof`, { waitUntil: "load" });
    await look(page, `/proof ${tag}`, w);
    if ((await page.locator(".pcard").count()) !== 4) fail(`/proof ${tag}: not four partner cards`);
    await page.screenshot({ path: join(shots, `proof-${tag}.png`) });
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await look(page, `/proof open ${tag}`, w);
    await page.screenshot({ path: join(shots, `proof-full-${tag}.png`), fullPage: true });
    await context.close();
  }
}
await browser.close();
server.close();
if (failures.length) { console.log(`\nredesign check: ${failures.length} problem(s)`); process.exit(1); }
console.log(`redesign check passes: /home, /watch, /try, /proof at 390 and 1440 px, light and dark, links and redirects (screenshots in ${shots})`);
