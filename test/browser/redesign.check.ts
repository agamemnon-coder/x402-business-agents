// The tabs as a juror opens them (Home, Try, Proof) and the replay at /watch (out of the menu since 12 Nov), at 390 and
// 1440 px, light and dark, against the judge server on a port the system picks. Fails on a console or page error (a CSP violation is one), "null", "undefined" or
// "NaN" on screen, a page wider than the screen, not exactly one h1, a nameless control, an image with no alt text,
// text under 14 px in the stage, the timeline or a card, or an internal link that does not end in a 200 (old addresses
// redirect). External links (the testnet explorer, the partners' docs) are not fetched.
//   npx tsx test/browser/redesign.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startJudge } from "../../src/cli/judge.js";
import { agentRun } from "../../src/redesign/run.js";
import { checkHome } from "./homeStory.js";
import { CHROME, checkTaps } from "./tapTargets.js";

const shots = process.argv[2] ?? "test-results/redesign";
mkdirSync(shots, { recursive: true });
const { server, url: base } = await startJudge(0);
/** The main run's tool names as its record writes them (set_buy_policy, plan_invoice…; "market" and "position" are also plain words). */
const TOOLS = [...new Set(agentRun().events.flatMap((e) => (e.k === "say" ? e.tools ?? [] : [])))].filter((t) => t.includes("_"));
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

// Every internal link on the tabs and the replay answers 200 (after a redirect, for an old address).
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

    // "/" is Home itself for a guest (no redirect). Home is one story (home-story, 12 Nov): two buttons, the hero whose
    // fourth step is the visitor's own check, three proof rows (test/browser/homeStory.ts; pages.check.ts runs it in
    // full, with the play-through). The replay stage and its four-eyes frame left Home: Watch plays the run.
    await page.goto(`${base}/`, { waitUntil: "load" });
    if (new URL(page.url()).pathname !== "/") fail(`/ ${tag}: a guest is sent away from / (${page.url()})`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, `home-first-${tag}.png`) });
    await look(page, `/home ${tag}`, w);
    if ((await page.locator("main a.btn.primary").count()) !== 1) fail(`/home ${tag}: not one primary button`);
    if (await page.locator("#hero-demo").evaluate((e) => e.getBoundingClientRect().right > window.innerWidth + 1)) fail(`/home ${tag}: the hero runs off the page`);
    // The menu: Home, Try, Proof first, no Watch, at most five items (a link, or a fold's header).
    const tabs = (await page.locator("nav.tabs > a, nav.tabs summary").allInnerTexts()).map((t) => t.trim());
    if (tabs.slice(0, 3).join() !== "Home,Try,Proof" || tabs.length > 5 || tabs.some((t) => /watch/i.test(t)) || (await page.locator('nav.tabs a[href*="watch"]').count())) fail(`/home ${tag}: the menu is not Home, Try, Proof (at most five, no Watch): ${tabs.join(", ")}`);
    if (w < 500) await checkTaps(page, { name: `/home ${tag}, header and footer`, scopes: CHROME, fail });
    await checkHome(page, { url: `${base}/`, name: `/home ${tag}`, width: w, height: h, touch: w < 500, tryHref: "try", fail, quick: true });
    await look(page, `/home ${tag}, after the hero's check`, w);
    await page.goto(`${base}/home?demo=4`, { waitUntil: "load" });
    await page.screenshot({ path: join(shots, `home-${tag}.png`) });
    await page.screenshot({ path: join(shots, `home-full-${tag}.png`), fullPage: true });

    // The replay at /watch: the start, then each moment by its jump. Its heading says what it is, under the Proof tab.
    await page.goto(`${base}/watch`, { waitUntil: "load" });
    await page.waitForTimeout(5000);
    await look(page, `/watch ${tag}`, w);
    if ((await page.locator("h1").innerText()).trim() !== "Replay of the main run, 3 November") fail(`/watch ${tag}: the heading does not say it is a replay of the main run of 3 November`);
    if (!/^\d\d:\d\d–\d\d:\d\d UTC · test money · real Claude decisions$/.test((await page.locator(".pill.run").innerText()).trim())) fail(`/watch ${tag}: no run label beside the heading`);
    if ((await page.locator('nav.tabs a[aria-current="page"]').allInnerTexts()).join() !== "Proof") fail(`/watch ${tag}: the Proof tab is not the current one`);
    if (w < 500) await checkTaps(page, { name: `/watch ${tag}, header and footer`, scopes: CHROME, fail });
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
    // In sight, no proposal number and no tool name: every step of the highlights and of the full run, stepped through
    // with the fold closed. Then the fold opens: there the tools and ids are, and a long line gets its "more".
    for (const mode of ["", "full=1&"]) {
      await page.goto(`${base}/watch?${mode}autoplay=0`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      if (await page.locator("#steps").evaluate((d) => (d as HTMLDetailsElement).open)) fail(`/watch ${tag}: the fold of every step is open before anyone asks`);
      const total = Number(/of (\d+)/.exec(await page.locator("#count").innerText())?.[1] ?? 0);
      if (total < 10) fail(`/watch ${tag}: the replay has ${total} steps`);
      for (let step = 1; step <= total; step++) {
        const seen = await page.evaluate(`(() => { const main = document.querySelector("main"); return { text: main.innerText, chips: [...main.querySelectorAll(".tool")].filter((e) => e.offsetParent && !e.closest("details")).length, tips: [...main.querySelectorAll("[title]")].filter((e) => !e.closest("details")).map((e) => e.title).join(" ") }; })()`) as { text: string; chips: number; tips: string };
        const id = /\bP-\d{3,}/.exec(`${seen.text} ${seen.tips}`)?.[0];
        const tool = TOOLS.find((t) => seen.text.includes(t));
        if (id || seen.chips || tool) fail(`/watch ${mode ? "full run" : "highlights"} ${tag}, step ${step}: ${id ? `proposal number ${id}` : tool ? `the tool name ${tool}` : "a tool chip"} in sight`);
        if (step < total) await page.locator("#fwd").click();
      }
    }
    await page.locator("#steps > summary").click();
    await page.waitForTimeout(200);
    const fold = await page.evaluate(`(() => { const d = document.getElementById("steps"); return { open: d.open, rows: d.querySelectorAll("ol.log li").length, chips: [...d.querySelectorAll(".tool")].filter((e) => e.offsetParent).length, more: [...d.querySelectorAll("button.more")].filter((e) => !e.hidden).length, head: d.querySelector("summary").getBoundingClientRect().height }; })()`) as { open: boolean; rows: number; chips: number; more: number; head: number };
    if (!fold.open || fold.rows < 10 || !fold.chips || !fold.more || fold.head < 44) fail(`/watch ${tag}: the fold does not open to every step with its tools (${JSON.stringify(fold)})`);
    await look(page, `/watch, fold open ${tag}`, w);

    await page.goto(`${base}/try`, { waitUntil: "load" });
    await page.waitForTimeout(600);
    if ((await page.locator("nav > a, nav summary").allInnerTexts()).map((t) => t.trim()).slice(0, 3).join() !== "Home,Try,Proof" || (await page.locator("nav > a, nav summary").count()) > 5 || (await page.locator('nav a[href*="watch"]').count())) fail(`/try ${tag}: the menu is not Home, Try, Proof (at most five, no Watch)`);
    if (w < 500) await checkTaps(page, { name: `/try ${tag}, header and footer`, scopes: CHROME, fail });
    if (!(await page.isVisible("#q-price")) || (await page.locator("text=Open a dispute").count())) fail(`/try ${tag}: "Raise the supplier price" missing, or a live dispute offered`);
    if ((await page.locator("#examples i").count()) > 0) fail(`/try ${tag}: dots without a legend`);
    await page.screenshot({ path: join(shots, `try-${tag}.png`) });
    await page.screenshot({ path: join(shots, `try-full-${tag}.png`), fullPage: true });

    await page.goto(`${base}/proof`, { waitUntil: "load" });
    await look(page, `/proof ${tag}`, w);
    if (w < 500) await checkTaps(page, { name: `/proof ${tag}, header and footer`, scopes: CHROME, fail });
    // Airwallex, Metal, Claude (Visa TAP is on /visa; its footer link left Proof on 12 Nov).
    if ((await page.locator(".pcard").count()) !== 3) fail(`/proof ${tag}: not three partner cards`);
    // The jury's order (12 Nov): the guarantees directly under the heading, on the first screen; each partner card with
    // one claim to tap in sight; four tiles; every closed line still closed; the utility links last.
    const order = (await page.evaluate(`(() => {
      const h1 = document.querySelector("main h1"), g = document.getElementById("guarantees"), u = document.querySelector("main .util");
      const shown = (e) => e.getBoundingClientRect().height > 0 && e.checkVisibility();
      return {
        first: h1 && h1.nextElementSibling === g, top: g ? Math.round(g.getBoundingClientRect().top + scrollY) : -1, promises: g ? g.querySelectorAll("li .by").length : 0,
        claims: [...document.querySelectorAll(".pcard > ul.lead a.c")].filter(shown).length, tiles: document.querySelectorAll(".nums a.num").length,
        closed: [...document.querySelectorAll("main details.deep")].filter((d) => !d.open).length, last: !!u && !u.nextElementSibling && u.querySelectorAll("a").length,
      };
    })()`)) as { first: boolean; top: number; promises: number; claims: number; tiles: number; closed: number; last: number | false };
    if (!order.first || order.top < 0 || order.top >= h || order.promises !== 7) fail(`/proof ${tag}: the seven guarantees are not directly under the heading on the first screen (top ${order.top} px, ${order.promises} promises)`);
    if (order.claims !== 3 || order.tiles !== 4 || order.closed !== 5 || order.last !== 4) fail(`/proof ${tag}: not three claims in sight, four tiles, five closed lines and four utility links last (${JSON.stringify(order)})`);
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
console.log(`redesign check passes: /home, /try, /proof and the replay at /watch at 390 and 1440 px, light and dark, the menu, the tap targets of header and footer at 390 px, links and redirects (screenshots in ${shots})`);
