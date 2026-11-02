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

    // "/" sends a guest to Home: the headline, then the animation (v4, C2), its first scene's line with the tx.
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForURL(/\/home$/);
    await page.waitForTimeout(1500);
    await look(page, `/home ${tag}`, w);
    if (!/Refused on chain/.test(await page.locator("#line").innerText())) fail(`/home ${tag}: the first scene's line does not say "Refused on chain"`);
    if ((await page.locator("#line a[href*='testnet.metalntwx.com/tx/0x']").count()) !== 1) fail(`/home ${tag}: no tx link on the first scene`);
    if (!/^(Sourcing|Support|Treasury) · Claude call ✓ · (Haiku|Sonnet|Opus) · [\d,]+ tokens · [\d.]+ s · req_\w+…$/.test(await page.locator("#call").innerText())) fail(`/home ${tag}: no Claude call badge`);
    if ((await page.locator("nav.tabs a").count()) !== 4) fail(`/home ${tag}: not four tabs`);
    if ((await page.locator(".ctas a.btn").count()) !== 3) fail(`/home ${tag}: not three buttons`);
    if (!/Replay of agent run 1 · 2 Nov · test money · real Claude decisions/.test(await page.evaluate(() => document.body.innerText))) fail(`/home ${tag}: no run label`);
    // On a phone the animation sits right under the headline.
    const gap = await page.evaluate(() => { const h = document.querySelector("h1")!.getBoundingClientRect(), f = document.querySelector(".film")!.getBoundingClientRect(); return Math.round(f.top - h.bottom); });
    if (gap > 40) fail(`/home ${tag}: ${gap}px between the headline and the animation`);
    await page.screenshot({ path: join(shots, `home-${tag}.png`) });
    // Each scene, still (as with reduced motion): what it must show, all of it visible, and nothing on top of anything else.
    const wants = [/Refused on chain/, /Face ID 1 of 2 → 2 of 2/, /12 orders disputed: 9 valid, 3 refunded/, /€240 licence paid by SWIFT · Face ID/];
    for (const n of [1, 2, 3, 4]) {
      await page.goto(`${base}/home?scene=${n}`, { waitUntil: "load" });
      await page.waitForTimeout(500);
      if (!wants[n - 1]!.test(await page.locator("#line").innerText())) fail(`/home scene ${n} ${tag}: the line does not say ${wants[n - 1]}`);
      if ((await page.locator(`[data-s="${n - 1}"][aria-pressed="true"]`).count()) !== 1) fail(`/home scene ${n} ${tag}: its button is not pressed`);
      const clash = await page.evaluate(`(() => {
        const svg = [...document.querySelectorAll(".film-svg")].find((e) => e.getBoundingClientRect().width > 0);
        const shown = [...svg.querySelectorAll(".refused, .bubble, .tap, .phone, .tiles, .box, .gate text")].filter((e) => getComputedStyle(e).opacity !== "0" && !(e.closest(".refused, .bubble, .tap, .tiles") && getComputedStyle(e.closest(".refused, .bubble, .tap, .tiles")).opacity === "0"));
        const r = shown.map((e) => [e.getAttribute("class"), e.getBoundingClientRect()]);
        const out = [];
        for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i][1], b = r[j][1]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(r[i][0] + " / " + r[j][0]); }
        return out;
      })()`) as string[];
      for (const c of clash) fail(`/home scene ${n} ${tag}: overlap ${c}`);
      await page.locator(".film").screenshot({ path: join(shots, `home-scene${n}-${tag}.png`) });
    }
    await page.goto(`${base}/home?scene=2`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    if (!/2 of 2/.test(await page.evaluate(() => [...document.querySelectorAll(".film-svg")].find((e) => e.getBoundingClientRect().width > 0)!.querySelector(".pt2")!.textContent!))) fail(`/home ${tag}: the four-eyes scene lacks "2 of 2"`);

    // Watch: the start, then each moment by its jump.
    await page.goto(`${base}/watch`, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    await look(page, `/watch ${tag}`, w);
    if (!/Replay of agent run 1 · 2 Nov · test money · real Claude decisions/.test(await page.locator(".pill.run").innerText())) fail(`/watch ${tag}: no run label`);
    if (!/^Highlights$/.test(await page.locator('#mode button[aria-pressed="true"]').innerText())) fail(`/watch ${tag}: not on the highlights by default`);
    if (!/^Full run \(\d+ steps\)$/.test(await page.locator('#mode button[data-mode="full"]').innerText())) fail(`/watch ${tag}: no full-run button with its steps`);
    await page.screenshot({ path: join(shots, `watch-${tag}.png`) });
    for (const n of [1, 2, 3, 4]) {
      await page.goto(`${base}/watch?scene=${n}&autoplay=0`, { waitUntil: "load" });
      await page.waitForTimeout(500);
      await look(page, `/watch scene ${n} ${tag}`, w);
      if ((await page.locator("ol.log li").count()) < (n === 1 ? 1 : 2)) fail(`/watch scene ${n} ${tag}: nothing before the jump`);
      // The Metal lane in full, never cut off (v4, C6).
      for (const v of await page.locator("[data-stage] .lane .verdict").all()) if (await v.evaluate((e) => e.textContent!.trim() !== "" && e.scrollWidth > e.clientWidth + 1)) fail(`/watch scene ${n} ${tag}: a rail's result is cut off`);
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
    // The menu on one line (v4, C4).
    const rows = await page.evaluate(() => { const t = [...document.querySelectorAll("header.top > *")].filter((e) => (e as HTMLElement).offsetParent).map((e) => Math.round(e.getBoundingClientRect().top)); return Math.max(...t) - Math.min(...t); });
    if (rows > 12) fail(`/try ${tag}: the menu wraps (${rows}px)`);
    if ((await page.locator("#examples i").count()) > 0) fail(`/try ${tag}: dots without a legend`);
    await page.screenshot({ path: join(shots, `try-${tag}.png`) });
    await page.screenshot({ path: join(shots, `try-full-${tag}.png`), fullPage: true });

    await page.goto(`${base}/proof`, { waitUntil: "load" });
    await look(page, `/proof ${tag}`, w);
    if ((await page.locator(".pcard").count()) !== 4) fail(`/proof ${tag}: not four partner cards`);
    if (!/decisions by Claude \(0 fallbacks\)/.test(await page.locator(".nums").innerText()) || !/routine payments by code/.test(await page.locator(".nums").innerText())) fail(`/proof ${tag}: no split between Claude and code`);
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
