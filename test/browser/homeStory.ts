// Home as one story, in a browser: used by pages.check.ts (360, 390, 768 and 1440 px, light and dark, with and without
// /try/sign) and redesign.check.ts. Rewritten for the Home of 21 Nov (Max: "We have enormously many headings on the
// homepage. Make it clean, tighter and prettier"): the hero with the product card (src/redesign/heroFlow.ts), the
// integrations band, four agents, one proof row, the judge tour's map and how to start in three steps.
//
// Checked: two buttons in the hero (the judge tour, then Try), the first with its sandbox line in the first screen; no
// Watch link and no replay stage in Home's main part. The card: once, named by its record, its five steps, and every
// value the record holds, in its own style, inside the screen, the same size while it plays; with reduced motion one
// still frame. "What's real?" opens the footer's fold. The band: every mark loaded, the list once for readers; with
// reduced motion it stands still. The agents: four tiles, each card chip as Airwallex read it back. The proof row: one
// tile per proofTiles(), each value from its record. The judge tour: its map of seven stops; the hero's first button
// starts it, the bar shows "1 of 7", Next and Back walk it, a stop on the site shows the bar there, and the close button
// ends it. Home makes no request after it has loaded. Every link and button in <main> is at least 44 px high. On a
// phone the first two screens show one date, the card's due date, and say "test money". On a wide screen the heading's
// two sentences are two lines. Every expected value is read from the records, not typed here.
import type { Page } from "playwright";
import { FLOW, FLOW_STEPS, READER_CHIP, TRY_SAMPLE_RECORD } from "../../src/redesign/heroFlow.js";
import { agentRoster, agentTiles, PILOT_CTA, proofTiles, START, START_ID, TOUR_BUTTON, WATCH_BUTTON, WHATS_REAL } from "../../src/redesign/home.js";
import { FILM_URL } from "../../src/config/brand.js";
import { BAND } from "../../src/redesign/integrations.js";
import { TOUR_STOPS } from "../../src/redesign/tour.js";

/** The text in sight above a line of the page (document px): no hidden step, no closed fold, no script. */
const SEEN_ABOVE = (limit: number) => `(() => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const e = n.parentElement;
    if (!e || !n.textContent.trim() || e.closest("script, style, details:not([open]) > :not(summary), aside.tbar")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.top + scrollY >= ${limit} || getComputedStyle(e).visibility === "hidden") continue;
    out.push(n.textContent);
  }
  return out.join(" ");
})()`;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export async function checkHome(page: Page, o: { url: string; name: string; width: number; height: number; touch: boolean; tryHref: string; fail: (what: string) => void; shot?: (name: string) => Promise<void>; quick?: boolean }): Promise<void> {
  const fail = (what: string) => o.fail(`${o.name}: ${what}`);
  await page.goto(o.url, { waitUntil: "load" });
  await page.evaluate(() => { try { sessionStorage.removeItem("purser.tour"); } catch { /* no storage */ } });

  // The hero's three buttons (the owner's concept, 21 Nov): Try (the one primary), Watch the demo, Start a pilot; the
  // sandbox line in the first screen. The judge tour's button is under its map.
  const ctas = await page.locator("main .e-hero .ctas a.btn").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent ?? "").trim() })));
  if (JSON.stringify(ctas.map((c) => c.href)) !== JSON.stringify([o.tryHref, FILM_URL, `#${START_ID}`])) fail(`the hero's buttons lead to ${JSON.stringify(ctas.map((c) => c.href))}, not to ${o.tryHref}, ${FILM_URL} and #${START_ID}`);
  if (JSON.stringify(ctas.map((c) => c.text)) !== JSON.stringify([START, WATCH_BUTTON, PILOT_CTA])) fail(`the hero's buttons say ${JSON.stringify(ctas.map((c) => c.text))}, not "${START}", "${WATCH_BUTTON}" and "${PILOT_CTA}"`);
  if ((await page.locator("main .e-hero .ctas a.btn.primary").getAttribute("href")) !== o.tryHref) fail("the hero's primary button is not Try");
  if ((await page.locator(`main .e-tour a.btn[data-tour-start]`).count()) !== 1 || (await page.locator(`main .e-tour a.btn[data-tour-start]`).innerText()).trim() !== TOUR_BUTTON) fail(`the judge tour's part has no "${TOUR_BUTTON}" button`);
  if ((await page.locator("main .e-hero .ctas a.btn.primary").count()) !== 1) fail("the hero has not exactly one primary button");
  const first = await page.locator("main p.reassure").boundingBox();
  if (!first || first.y + first.height > o.height) fail("the first button and its sandbox line are not in the first screen");
  if (await page.locator('main a[href="watch"], [data-stage]').count()) fail("a Watch link or a replay stage is in Home's main part");

  // The card: once, named by its record, its five steps, and every value the record holds.
  const card = page.locator("main figure.hf");
  if ((await card.count()) !== 1) fail(`Home shows ${await card.count()} product cards, not one`);
  if ((await card.getAttribute("data-rec")) !== TRY_SAMPLE_RECORD) fail(`the card does not name its record ${TRY_SAMPLE_RECORD}`);
  const steps = (await card.locator(".hf-steps > li").allInnerTexts()).map(squash);
  if (JSON.stringify(steps) !== JSON.stringify([...FLOW_STEPS])) fail(`the card's steps are ${JSON.stringify(steps)}, not ${JSON.stringify(FLOW_STEPS)}`);
  const shown = squash(await card.locator(".hf-card").textContent() ?? "");
  const want = [FLOW.supplier, `Invoice ${FLOW.number}`, FLOW.amount, FLOW.due, FLOW.account, READER_CHIP, "Signed with a passkey", "fingerprint of the terms", ...FLOW.ledger.flatMap((l) => [l.code, l.name, l.debit || l.credit])];
  for (const v of want) if (!shown.includes(v)) fail(`the card does not show "${v}" from ${TRY_SAMPLE_RECORD}`);
  if ((await card.locator(".hf-pill span[title]").getAttribute("title")) !== `SHA-256 of the signed terms: ${FLOW.hash}`) fail(`the card's tooltip does not hold the hash ${FLOW.hash} from ${TRY_SAMPLE_RECORD}`);
  if (await card.locator(".hf-card").evaluate((e) => getComputedStyle(e).display) !== "grid") fail("the card lost its style");
  const box = async () => { const b = await card.boundingBox(); return b ? `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)}` : "none"; };
  await page.waitForTimeout(1200);
  const s0 = await box();
  if (await card.evaluate((e) => e.getBoundingClientRect().right > window.innerWidth + 1 || e.getBoundingClientRect().left < -1)) fail("the card runs off the screen");
  await page.waitForTimeout(o.quick ? 1500 : 6000);
  const s1 = await box();
  if (s1 !== s0) fail(`the card changes size or place while it plays (${s0} → ${s1})`);
  await o.shot?.("card");

  // "What's real?" opens the footer's fold of the same name.
  const real = page.locator("main a[data-real]").first();
  if ((await real.innerText()).trim() !== WHATS_REAL) fail(`the card's note does not link "${WHATS_REAL}"`);
  await (o.touch ? real.tap() : real.click());
  await page.waitForTimeout(300);
  if (!(await page.locator("details#real").evaluate((d) => (d as HTMLDetailsElement).open))) fail(`"${WHATS_REAL}" does not open the footer's fold`);
  if (!squash(await page.locator("details#real").innerText()).includes(TRY_SAMPLE_RECORD)) fail(`the open fold does not name ${TRY_SAMPLE_RECORD}`);

  // From here on Home asks nothing of any server.
  const asked: string[] = [];
  const onRequest = (r: { url(): string }) => { asked.push(r.url()); };
  page.on("request", onRequest);
  // The band: each mark once for readers (the copy for the loop is hidden from them), every image loaded.
  const band = await page.evaluate(() => ({
    names: [...document.querySelectorAll("main .lband .lb-row:not(.lb-dup) .lb-i")].map((li) => (li.querySelector("img")?.getAttribute("alt") || li.textContent || "").trim()),
    dupHidden: [...document.querySelectorAll("main .lband .lb-dup")].every((u) => u.getAttribute("aria-hidden") === "true"),
    broken: [...document.querySelectorAll("main .lband img")].filter((i) => !(i as HTMLImageElement).complete || !(i as HTMLImageElement).naturalWidth).map((i) => i.getAttribute("src")),
  }));
  if (JSON.stringify(band.names) !== JSON.stringify(BAND.map((b) => b.name))) fail(`the band shows ${JSON.stringify(band.names)}, not ${JSON.stringify(BAND.map((b) => b.name))}`);
  if (!band.dupHidden) fail("the band's second copy is not hidden from screen readers");
  if (band.broken.length) fail(`the band's marks did not load: ${band.broken.join(", ")}`);
  // The agents: four tiles, in order, each card chip the last four digits Airwallex read back.
  const tiles = await page.locator("main ul.agents > li").evaluateAll((ls) => ls.map((l) => ({ title: (l.querySelector("b.ag-t")?.textContent ?? "").trim(), card: (l.querySelector(".card")?.textContent ?? "").trim() })));
  const roster = agentRoster();
  const wantTiles = agentTiles().map((t) => ({ title: t.title, card: (() => { const a = roster.find((r) => r.id === t.id); return a ? `••${a.last4}` : ""; })() }));
  if (JSON.stringify(tiles) !== JSON.stringify(wantTiles)) fail(`the agents are ${JSON.stringify(tiles)}, not ${JSON.stringify(wantTiles)}`);
  // The proof row: one tile per record, each value as proofTiles() reads it.
  const proof = await page.locator("main ul.prow > li .pv").allInnerTexts();
  const wantProof = proofTiles().map((t) => t.value);
  if (JSON.stringify(proof.map(squash)) !== JSON.stringify(wantProof)) fail(`the proof row is ${JSON.stringify(proof)}, not the records' ${JSON.stringify(wantProof)}`);
  // The tour's map: the seven stops, in order.
  const stops = (await page.locator("main ol.tmap li b").allInnerTexts()).map(squash);
  if (JSON.stringify(stops) !== JSON.stringify(TOUR_STOPS.map((s) => s.title))) fail(`the tour's map is ${JSON.stringify(stops)}`);
  page.off("request", onRequest);
  if (asked.length) fail(`Home made ${asked.length} request(s) after it loaded: ${asked.slice(0, 3).join(", ")}`);

  // Every link and button of Home's main part is a thumb's size.
  const small = await page.evaluate(`[...document.querySelectorAll("main a, main button, main summary, main input")].filter((e) => e.getClientRects().length).map((e) => ({ what: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height * 10) / 10 })).filter((x) => x.h < 44)`) as { what: string; h: number }[];
  for (const s of small) fail(`"${s.what}" is ${s.h}px high, under 44`);

  if (o.width < 500) {
    // The first two phone screens show one date, the card's due date, and say that this is test money.
    await page.evaluate(() => window.scrollTo(0, 0));
    const seen = await page.evaluate(SEEN_ABOVE(2 * o.height)) as string;
    const dates = seen.match(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g) ?? [];
    if (dates.some((d) => d !== FLOW.due)) fail(`the first two screens show the dates ${JSON.stringify(dates)}, not only ${FLOW.due}`);
    if (!/test money/i.test(seen)) fail('the first two screens do not say "test money"');
  }
  // The heading's two sentences are two lines, each unbroken, where the layout is two columns.
  if (o.width >= 1100) {
    const lines = await page.locator("h1.h-hero span").evaluateAll((ss) => ss.map((s) => ({ rects: s.getClientRects().length, top: Math.round(s.getBoundingClientRect().top), text: s.textContent })));
    if (lines.length !== 2 || lines.some((l) => l.rects !== 1) || lines[0]!.top >= lines[1]!.top || lines[0]!.text !== "AI agents spend.") fail(`the heading does not break after "spend." (${JSON.stringify(lines)})`);
  }
  // Release gate: the actual Home CTAs, not just their markup, at jury desktop and phone sizes.
  // A relative /try link must resolve on the same public origin, and the page must be real (not a 404).
  // The film intentionally opens YouTube in a new tab; check its destination/target without leaving Home.
  if (o.width === 390 || o.width === 1440) {
    const tryLink = page.locator("main .e-hero .ctas a.btn.primary");
    const filmLink = page.locator("main .e-hero .ctas a.btn.film");
    const filmHref = await filmLink.getAttribute("href");
    const filmTarget = await filmLink.getAttribute("target");
    if (filmHref !== FILM_URL || !/^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//.test(filmHref || "") || filmTarget !== "_blank")
      fail("Watch the demo must link to the recorded YouTube film in a new tab");
    if (!(await tryLink.isVisible())) fail("Try it in 2 minutes CTA is not visible");
    await tryLink.click();
    await page.waitForURL((u) => u.pathname === "/try", { timeout: 12_000 });
    const response = await page.request.get(page.url());
    if (response.status() !== 200 || !(await response.text()).includes("test money"))
      fail(`the Try CTA landed on an invalid demo response: ${response.status()}`);
    await page.goto(o.url, { waitUntil: "load" });
  }


  // The judge tour: its button under the map starts it at stop 1, on Home's map, with the bar.
  await page.evaluate(() => window.scrollTo(0, 0));
  const start = page.locator("main .e-tour a.btn[data-tour-start]");
  await (o.touch ? start.tap() : start.click());
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  const bar = async () => page.evaluate(() => { const b = document.querySelector("aside.tbar") as HTMLElement | null; return b && !b.hidden ? { key: (b.querySelector(".tb-k span")?.textContent ?? "").trim(), title: (b.querySelector(".tb-t")?.textContent ?? "").trim(), on: document.querySelector("ol.tmap li.on")?.getAttribute("data-stop") ?? null, offscreen: b.getBoundingClientRect().right > innerWidth + 1 || b.getBoundingClientRect().left < -1 || b.getBoundingClientRect().bottom > innerHeight + 1 } : null; });
  const b1 = await bar();
  if (!b1 || b1.key !== `1 of ${TOUR_STOPS.length}` || b1.title !== TOUR_STOPS[0]!.title || b1.on !== "1") fail(`the tour's first button does not start the tour at stop 1 (${JSON.stringify(b1)})`);
  if (b1?.offscreen) fail("the tour's bar runs off the screen");
  await o.shot?.("tour");
  // Next to the first stop on the site, whose page carries the bar; Back from there.
  const onSite = TOUR_STOPS.findIndex((s) => !s.external) + 1;
  await page.goto(`${new URL(o.url).origin}/${TOUR_STOPS[onSite - 2]!.external ? "home" : TOUR_STOPS[onSite - 2]!.href}?tour=${onSite - 1}`, { waitUntil: "load" });
  await page.locator("aside.tbar a.tb-next, aside.tbar a:has-text('Next')").first().click();
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
  const b2 = await bar();
  if (!b2 || b2.key !== `${onSite} of ${TOUR_STOPS.length}` || b2.title !== TOUR_STOPS[onSite - 1]!.title || !page.url().includes(`/${TOUR_STOPS[onSite - 1]!.href}?tour=${onSite}`)) fail(`Next does not reach stop ${onSite} on its page (${page.url()}, ${JSON.stringify(b2)})`);
  // The close button ends the tour: the bar goes, and a page opened after it shows none.
  await page.locator("aside.tbar button.tb-x").click();
  if (await bar()) fail("the tour's close button does not end it");
  await page.goto(o.url, { waitUntil: "load" });
  if (await bar()) fail("the tour is still running after it was ended");
  if (o.quick) return;

  // Reduced motion: one still frame of the card, and the band stands still.
  const still = await page.context().browser()!.newPage({ viewport: { width: o.width, height: o.height }, reducedMotion: "reduce" });
  try {
    await still.goto(o.url, { waitUntil: "load" });
    await still.waitForTimeout(800);
    const hidden = await still.locator("main figure.hf").evaluate((f) => [".hf-reader", ".hf-check", ".hf-pill", ".hf-paid", ".hf-l0", ".hf-l1", ".hf-l2"].filter((s) => { const e = f.querySelector(s); return !e || +getComputedStyle(e).opacity < 0.99 || getComputedStyle(e).visibility === "hidden"; }));
    if (hidden.length) fail(`with reduced motion the card is not one still frame of its final state (${hidden.join(", ")} not shown)`);
    const a = await still.locator("main figure.hf").boundingBox();
    await still.waitForTimeout(1500);
    const b = await still.locator("main figure.hf").boundingBox();
    if (JSON.stringify(a) !== JSON.stringify(b)) fail("with reduced motion the card still moves");
    const moving = await still.evaluate(() => [...document.querySelectorAll("main .lband *, main .e-hero .copy *")].filter((e) => getComputedStyle(e).animationName !== "none").length);
    if (moving) fail(`with reduced motion ${moving} part(s) of the hero or the band still animate`);
    if (await still.locator("main .lband .lb-dup").isVisible()) fail("with reduced motion the band's second copy shows");
  } finally { await still.close(); }
}
