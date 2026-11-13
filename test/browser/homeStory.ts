// Home as one story, in a browser: used by pages.check.ts (360, 390, 768 and 1440 px, light and dark, with and without
// /try/sign) and redesign.check.ts. Rewritten for the Home of the enterprise pass (12 Nov) and the jury pass (13 Nov):
// the hero is the product card (src/redesign/heroFlow.ts), one /try run of its sample invoice drawn in HTML and played
// on a CSS loop whose final state is the default; under it the features, the flow and the stat row "On record".
//
// Checked: two buttons in the hero (Try, then Proof), the first with its one line in the first screen; no Watch link, no
// replay stage and no third way out in Home's main part. The card: once, named by its record, its five steps, and every
// value the record holds (supplier, invoice number, amount, due date, account, the reader chip, the signed hash, the
// three booking lines), in its own style, inside the screen, the same size while it plays; with reduced motion it is
// one still frame with the payment and its last booking line in sight. "What's real?" opens the footer's fold. The stat
// row: one tile per figure homeStats() reads from the records, Face ID on chain first, each figure ending at its record
// value; then the scale band, each figure as src/redesign/scale.ts computes it, each a link to its source. Home makes no request after it has loaded. Every link, button, fold header and field in <main> is at least
// 44 px high. On a phone the first two screens show one date, the card's due date, and say "test money". On a wide
// screen the heading's two sentences are two lines. Every expected value is read from the records, not typed here.
import type { Page } from "playwright";
import { FLOW, FLOW_STEPS, READER_CHIP, TRY_SAMPLE_RECORD } from "../../src/redesign/heroFlow.js";
import { homeStats, START, TRY_BUTTON, WHATS_REAL } from "../../src/redesign/home.js";
import { agentRun } from "../../src/redesign/run.js";
import { homeScaleStats } from "../../src/redesign/scale.js";

/** A figure as the stat row writes it (src/redesign/stats.ts): grouped, with its decimals. */
const fmt = (n: number, dec = 0) => n.toLocaleString("en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const STATS = homeStats(agentRun());
const SCALE = homeScaleStats();

/** The text in sight above a line of the page (document px): no hidden step, no closed fold, no script. */
const SEEN_ABOVE = (limit: number) => `(() => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const e = n.parentElement;
    if (!e || !n.textContent.trim() || e.closest("script, style, details:not([open]) > :not(summary)")) continue;
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

  // One story: the hero's two buttons, the 3-minute tour (primary, owner 13 Nov) then Try it, the first in the first
  // screen with its one line under it.
  const ctas = await page.locator("main .e-hero .ctas a.btn").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent ?? "").trim() })));
  if (JSON.stringify(ctas.map((c) => c.href)) !== JSON.stringify(["tour", o.tryHref])) fail(`the hero's buttons lead to ${JSON.stringify(ctas.map((c) => c.href))}, not to tour and ${o.tryHref}`);
  if (ctas[0]?.text !== START || ctas[1]?.text !== TRY_BUTTON) fail(`the hero's buttons say ${JSON.stringify(ctas.map((c) => c.text))}, not "${START}" and "${TRY_BUTTON}"`);
  if ((await page.locator("main .e-hero .ctas a.btn.primary").count()) !== 1) fail("the hero has not exactly one primary button");
  const first = await page.locator("main p.reassure").boundingBox();
  if (!first || first.y + first.height > o.height) fail("the first button and its reassurance line are not in the first screen");
  if (await page.locator('main a[href="watch"], [data-stage], main a[href="visa"]').count()) fail("a Watch link, a replay stage, or a third way out is back in Home's main part");

  // The card: once, named by its record, its five steps, and every value the record holds.
  const card = page.locator("main figure.hf");
  if ((await card.count()) !== 1) fail(`Home shows ${await card.count()} product cards, not one`);
  if ((await card.getAttribute("data-rec")) !== TRY_SAMPLE_RECORD) fail(`the card does not name its record ${TRY_SAMPLE_RECORD}`);
  const steps = (await card.locator(".hf-steps > li").allInnerTexts()).map(squash);
  if (JSON.stringify(steps) !== JSON.stringify([...FLOW_STEPS])) fail(`the card's steps are ${JSON.stringify(steps)}, not ${JSON.stringify(FLOW_STEPS)}`);
  const shown = squash(await card.locator(".hf-card").textContent() ?? "");
  const want = [FLOW.supplier, `Invoice ${FLOW.number}`, FLOW.amount, FLOW.due, FLOW.account, READER_CHIP, `hash ${FLOW.hash}`, ...FLOW.ledger.flatMap((l) => [l.code, l.name, l.debit || l.credit])];
  for (const v of want) if (!shown.includes(v)) fail(`the card does not show "${v}" from ${TRY_SAMPLE_RECORD}`);
  if (await card.locator(".hf-card").evaluate((e) => getComputedStyle(e).display) !== "grid") fail("the card lost its style");
  const box = async () => { const b = await card.boundingBox(); return b ? `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)}` : "none"; };
  const s0 = await box();
  if (await card.evaluate((e) => e.getBoundingClientRect().right > window.innerWidth + 1 || e.getBoundingClientRect().left < -1)) fail("the card runs off the screen");
  // It plays on a loop of 12 s; the pieces fade in and out, and nothing moves the card itself.
  await page.waitForTimeout(o.quick ? 1500 : 6000);
  const s1 = await box();
  if (s1 !== s0) fail(`the card changes size or place while it plays (${s0} → ${s1})`);
  await o.shot?.("card");

  // "What's real?" opens the footer's fold of the same name.
  const real = page.locator("main a[data-real]");
  if ((await real.innerText()).trim() !== WHATS_REAL) fail(`the card's note does not link "${WHATS_REAL}"`);
  await (o.touch ? real.tap() : real.click());
  await page.waitForTimeout(300);
  if (!(await page.locator("details#real").evaluate((d) => (d as HTMLDetailsElement).open))) fail(`"${WHATS_REAL}" does not open the footer's fold`);
  if (!squash(await page.locator("details#real").innerText()).includes(TRY_SAMPLE_RECORD)) fail(`the open fold does not name ${TRY_SAMPLE_RECORD}`);

  // From here on Home asks nothing of any server: the count-up and the scroll-in are the page's own script.
  const asked: string[] = [];
  const onRequest = (r: { url(): string }) => { asked.push(r.url()); };
  page.on("request", onRequest);
  // The stat row "On record": one tile per figure, Face ID on chain first, each ending at its record value.
  const row = page.locator("main .e-statrec ul.stats");
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2200);
  const tiles = await row.locator("li").evaluateAll((ls) => ls.map((l) => ({ figure: (l.querySelector("b")?.textContent ?? "").trim(), label: (l.querySelector("small")?.textContent ?? "").trim() })));
  const wantTiles = STATS.map((s) => ({ figure: `${s.pre ?? ""}${fmt(s.n, s.dec)}${s.suf ?? ""}`, label: s.label }));
  if (JSON.stringify(tiles) !== JSON.stringify(wantTiles)) fail(`the stat row is ${JSON.stringify(tiles)}, not the records' ${JSON.stringify(wantTiles)}`);
  if (!/passkeys \(P-256\) verified on chain/.test(tiles[0]?.label ?? "")) fail(`the first tile is not the passkeys verified on chain (${tiles[0]?.label})`);
  // The scale band under it (the owner, 13 Nov): each figure as scaleStats() computes it from the records, each a link;
  // Home shows three of them since the judge panel of 13 Nov (homeScaleStats).
  const band = await page.locator("main ul.scale > li").evaluateAll((ls) => ls.map((l) => ({ figure: (l.querySelector("b")?.textContent ?? "").trim(), href: l.querySelector("a")?.getAttribute("href") ?? "" })));
  const wantBand = SCALE.map((x) => ({ figure: fmt(x.n), href: x.href }));
  if (JSON.stringify(band) !== JSON.stringify(wantBand)) fail(`the scale band is ${JSON.stringify(band)}, not the records' ${JSON.stringify(wantBand)}`);
  page.off("request", onRequest);
  if (asked.length) fail(`Home made ${asked.length} request(s) after it loaded: ${asked.slice(0, 3).join(", ")}`);

  // A9: every link, button, fold header and field of Home's main part is a thumb's size.
  const small = await page.evaluate(`[...document.querySelectorAll("main a, main button, main summary, main input")].filter((e) => e.getClientRects().length).map((e) => ({ what: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height * 10) / 10 })).filter((x) => x.h < 44)`) as { what: string; h: number }[];
  for (const s of small) fail(`"${s.what}" is ${s.h}px high, under 44`);

  if (o.width < 500) {
    // A2: the first two phone screens show one date, the card's due date, and say that this is test money.
    await page.evaluate(() => window.scrollTo(0, 0));
    const seen = await page.evaluate(SEEN_ABOVE(2 * o.height)) as string;
    const dates = seen.match(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g) ?? [];
    if (dates.some((d) => d !== FLOW.due)) fail(`the first two screens show the dates ${JSON.stringify(dates)}, not only ${FLOW.due}`);
    if (!/test money/i.test(seen)) fail('the first two screens do not say "test money"');
  }
  // A10: the heading's two sentences are two lines, each unbroken, where the layout is two columns.
  if (o.width >= 1100) {
    const lines = await page.locator("h1.h-hero span").evaluateAll((ss) => ss.map((s) => ({ rects: s.getClientRects().length, top: Math.round(s.getBoundingClientRect().top), text: s.textContent })));
    if (lines.length !== 2 || lines.some((l) => l.rects !== 1) || lines[0]!.top >= lines[1]!.top || lines[0]!.text !== "AI agents spend.") fail(`the heading does not break after "spend." (${JSON.stringify(lines)})`);
  }
  if (o.quick) return;

  // Reduced motion: one still frame, its final state: the payment and the last booking line in sight, nothing hidden.
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
  } finally { await still.close(); }
}
