// Home as one story, in a browser: used by pages.check.ts (360, 390, 768 and 1440 px, light and dark, with and without
// /try/sign) and redesign.check.ts. Since the jury pass of 13 Nov (#232) the hero is the product card (src/redesign/
// heroFlow.ts): one /try run of the sample invoice, played as a CSS loop: the invoice comes in, the reader reads it, the
// check says ready to pay, a Face ID ring closes on the signed hash, it is paid and booked. Its final state is the default,
// so with reduced motion the whole card stands still. This file checks that, as a visitor sees it:
//   - two buttons in the hero (Try it live, See the proof) with the reassurance line in the first screen, and no third
//     way out; further down only See the proof again and the Books card;
//   - the card shows the run record's values (supplier, number, amount, due day, account ending, the signed hash, the
//     three booking lines) and names its reader as the record does; it keeps its size while it plays;
//   - with reduced motion every piece of the card is in sight at once, and the stat figures stand at their values;
//   - with motion, the stat figures count up to the values in their data-count and stop there;
//   - the provenance link opens the "What's real?" fold;
//   - every link, button, fold header and field of Home's main part is at least 44 px high;
//   - on a phone the first two screens show one date and "simulated" and "test money" once each; on a wide screen the
//     heading's two sentences are two lines.
// Every expected value is read from the record behind the card (heroFlow.ts reads docs/runs/<date>-try-sample.json), not
// typed here.
import type { Page } from "playwright";
import { booksData } from "../../src/redesign/booksPage.js";
import { FLOW, FLOW_NOTE, FLOW_STEPS, READER_CHIP, TRY_SAMPLE_RECORD } from "../../src/redesign/heroFlow.js";

/** The text in sight above a line of the page (document px): no hidden piece, no closed fold, no script. */
const SEEN_ABOVE = (limit: number) => `(() => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const e = n.parentElement;
    if (!e || !n.textContent.trim() || e.closest("script, style")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.top + scrollY >= ${limit} || getComputedStyle(e).visibility === "hidden") continue;
    out.push(n.textContent);
  }
  return out.join(" ");
})()`;
/** The card's pieces that the loop brings in, and whether each is in sight now (opacity of it and its parents). */
const CARD = `(() => {
  const f = document.querySelector("figure.hf"), r = f.getBoundingClientRect();
  const sel = [".hf-inv", ".hf-reader", ".hf-check", ".hf-sign", ".hf-pill", ".hf-paid", ".hf-led tr"];
  const shown = (e) => { for (let a = e; a && a !== f; a = a.parentElement) if (+getComputedStyle(a).opacity < 0.99) return false; return true; };
  const pieces = sel.flatMap((s) => [...f.querySelectorAll(s)]);
  return { size: Math.round(r.width) + "x" + Math.round(r.height), all: pieces.length, inSight: pieces.filter(shown).length,
    animated: pieces.filter((e) => getComputedStyle(e).animationName !== "none").length, text: f.querySelector(".hf-card").textContent.replace(/\\s+/g, " ") };
})()`;
interface CardState { size: string; all: number; inSight: number; animated: number; text: string }

export async function checkHome(page: Page, o: { url: string; name: string; width: number; height: number; touch: boolean; tryHref: string; fail: (what: string) => void; shot?: (name: string) => Promise<void>; quick?: boolean }): Promise<void> {
  const fail = (what: string) => o.fail(`${o.name}: ${what}`);
  const card = () => page.evaluate(CARD) as Promise<CardState>;

  await page.goto(o.url, { waitUntil: "load" });
  // One story: two buttons in the hero, the first with its one line under it in the first screen; no Watch, no third way.
  const hero = await page.locator(".e-hero a.btn").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  if (JSON.stringify(hero) !== JSON.stringify([o.tryHref, "proof"])) fail(`the hero's buttons lead to ${JSON.stringify(hero)}, not to ${o.tryHref} and proof`);
  const all = await page.locator("main a.btn").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const want = [o.tryHref, "proof", "proof", ...(booksData().view ? ["books"] : [])];
  if (JSON.stringify(all) !== JSON.stringify(want)) fail(`Home's buttons lead to ${JSON.stringify(all)}, not ${JSON.stringify(want)}`);
  const first = await page.locator("main p.reassure").boundingBox();
  if (!first || first.y + first.height > o.height) fail("the first button and its reassurance line are not in the first screen");
  if (await page.locator('main a[href="watch"], [data-stage], main a[href="judge"], main a[href="visa"]').count()) fail("a Watch link, a replay stage, or a third way out is back in Home's main part");

  // The product card: the run record's values, its reader named as the record names it, the steps above it.
  const fig = page.locator("figure.hf");
  if ((await fig.count()) !== 1 || (await fig.getAttribute("data-rec")) !== TRY_SAMPLE_RECORD) fail(`the hero is not one product card from ${TRY_SAMPLE_RECORD}`);
  const steps = (await page.locator("figure.hf .hf-steps > li").allTextContents()).map((s) => s.trim());
  if (JSON.stringify(steps) !== JSON.stringify(FLOW_STEPS)) fail(`the card's steps are ${JSON.stringify(steps)}, not ${JSON.stringify(FLOW_STEPS)}`);
  const c0 = await card();
  const values = [FLOW.supplier, `Invoice ${FLOW.number}`, FLOW.amount, FLOW.due, FLOW.account, `hash ${FLOW.hash}`, READER_CHIP, "Purser's code holds the limits", ...FLOW.ledger.flatMap((l) => [l.code, l.debit || l.credit])];
  const missing = values.filter((v) => !c0.text.includes(v));
  if (missing.length) fail(`the card does not show ${JSON.stringify(missing)} from its run record`);
  if (await page.locator("figure.hf .hf-card").evaluate((e) => getComputedStyle(e).display) === "none") fail("the card lost its style");
  const note = await page.locator("p.hf-note").innerText();
  if (!note.includes(FLOW_NOTE)) fail(`the note under the card is not "${FLOW_NOTE}" (${note})`);

  // A10: the heading's two sentences are two lines, each unbroken, where the layout is two columns.
  if (o.width >= 1100) {
    const lines = await page.locator("h1.h-hero span").evaluateAll((ss) => ss.map((s) => ({ rects: s.getClientRects().length, top: Math.round(s.getBoundingClientRect().top), text: s.textContent })));
    if (lines.length !== 2 || lines.some((l) => l.rects !== 1) || lines[0]!.top >= lines[1]!.top || lines[0]!.text !== "AI agents spend.") fail(`the heading does not break after "spend." (${JSON.stringify(lines)})`);
  }

  // With motion the card plays its loop (its pieces animate) and keeps its size throughout.
  if (!o.quick) {
    if (c0.animated < c0.all) fail(`with motion only ${c0.animated} of the card's ${c0.all} pieces play`);
    const sizes = new Set([c0.size]);
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(1500); sizes.add((await card()).size); }
    if (sizes.size !== 1) fail(`the card changes size while it plays (${[...sizes].join(" → ")})`);
    await o.shot?.("playing");
  }

  // The stat row counts up when it comes into view and stops at each figure's own value.
  await page.locator("ul.stats").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1600);
  const stats = await page.evaluate(() => [...document.querySelectorAll("ul.stats [data-count]")].map((e) => {
    const to = Number(e.getAttribute("data-count")), d = Number(e.getAttribute("data-dec")) || 0;
    return { want: to.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }), got: e.textContent };
  }));
  if (!stats.length || stats.some((s) => s.got !== s.want)) fail(`the stat figures do not stand at their values (${JSON.stringify(stats)})`);

  // The provenance link under the card opens the footer's "What's real?" fold.
  await page.locator("p.hf-note a[data-real]").click();
  await page.waitForTimeout(300);
  if (!(await page.locator("details.real").evaluate((d) => (d as HTMLDetailsElement).open))) fail('the "What\'s real?" link under the card does not open its fold');

  // A9: every link, button, fold header and field of Home's main part is a thumb's size.
  const small = await page.evaluate(`[...document.querySelectorAll("main a, main button, main summary, main input")].filter((e) => e.getClientRects().length).map((e) => ({ what: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height * 10) / 10 })).filter((x) => x.h < 44)`) as { what: string; h: number }[];
  for (const s of small) fail(`"${s.what}" is ${s.h}px high, under 44`);

  if (o.width < 500) {
    // A2: the first two phone screens show one date: the due day of the card's invoice.
    await page.evaluate(() => window.scrollTo(0, 0));
    const seen = await page.evaluate(SEEN_ABOVE(2 * o.height)) as string;
    const dates = seen.match(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g) ?? [];
    if (JSON.stringify(dates) !== JSON.stringify([FLOW.due])) fail(`the first two screens show the dates ${JSON.stringify(dates)}, not only ${FLOW.due}`);
    if ((seen.match(/simulated/gi) ?? []).length !== 1 || (seen.match(/test money/gi) ?? []).length !== 1) fail('"simulated" and "test money" are not each in sight exactly once');
  }

  if (o.quick) return;
  // Reduced motion: the card is one still frame with every piece in sight, and the figures stand at their values.
  const still = await page.context().browser()!.newPage({ viewport: { width: o.width, height: o.height }, reducedMotion: "reduce" });
  try {
    await still.goto(o.url, { waitUntil: "load" });
    await still.waitForTimeout(300);
    const s = await still.evaluate(CARD) as CardState;
    if (s.animated !== 0 || s.inSight !== s.all) fail(`with reduced motion the card is not one still frame (${s.inSight} of ${s.all} pieces in sight, ${s.animated} playing)`);
    const figures = await still.evaluate(() => [...document.querySelectorAll("ul.stats [data-count]")].every((e) => {
      const d = Number(e.getAttribute("data-dec")) || 0;
      return e.textContent === Number(e.getAttribute("data-count")).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
    }));
    if (!figures) fail("with reduced motion the stat figures do not stand at their values");
  } finally { await still.close(); }
}
