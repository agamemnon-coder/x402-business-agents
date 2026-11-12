// Home as one story, in a browser (home-story, 12 Nov; the jury panel's A2, A6, A7, A9, A10 and the hero's step 4):
// used by pages.check.ts (360, 390, 768 and 1440 px, light and dark, with and without /try/sign) and redesign.check.ts.
// The hero plays steps 1 to 3 once and rests on step 4, valid; one tap on "+1 cent" shows 240.01, the Refused stamp and
// two different hashes, with no request made; Reset is valid again; another amount typed is refused, the signed one typed
// back is valid; the keyboard alone reaches and uses the controls; the hero keeps its size throughout; every link,
// button and field in <main> is at least 44 px high; on a phone the first two screens show one date and no second
// transfer id, and the three proof rows fit one screen; on a wide screen the heading's two sentences are two lines; with
// reduced motion the hero is one still frame and its controls work. Every expected value is read from the receipt file
// and the run records, not typed here.
import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import { HERO_VERDICT, heroDemoFacts } from "../../src/redesign/heroDemo.js";
import { HERO_RECEIPT_FILE, heroReceipt } from "../../src/redesign/heroReceipt.js";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const FACTS = heroDemoFacts()!;
const RECEIPT = heroReceipt(FACTS, HERO_RECEIPT_FILE)!;
const SIGNED = RECEIPT.data.terms_sha256;
const AMOUNT = RECEIPT.shown.amount;
const plusCent = (a: string) => ((Math.round(Number(a) * 100) + 1) / 100).toFixed(2);
/** Every transfer id the run records hold: Home may show the hero's, and no other. */
const TRANSFERS = [
  ...(JSON.parse(read("docs/demo/airwallex-run.json")) as { invoices: { transfer_id: string | null }[] }).invoices.flatMap((i) => (i.transfer_id ? [i.transfer_id] : [])),
  ...(JSON.parse(read("docs/demo/main-run.json")) as { ledger: { events: { payload: Record<string, unknown> }[] } }).ledger.events.flatMap((e) => (typeof e.payload.transfer_id === "string" ? [e.payload.transfer_id] : [])),
];

/** The text in sight above a line of the page (document px): no hidden step, no closed fold, no script. */
const SEEN_ABOVE = (limit: number) => `(() => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const e = n.parentElement;
    if (!e || !n.textContent.trim() || e.closest("script, style")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.top + scrollY >= ${limit} || getComputedStyle(e).visibility === "hidden") continue;
    let shown = true;
    for (let a = e; a; a = a.parentElement) if (+getComputedStyle(a).opacity === 0) { shown = false; break; }
    if (shown) out.push(n.textContent);
  }
  return out.join(" ");
})()`;
const HERO_STATE = `(() => {
  const b = document.getElementById("hero-demo"), q = (s) => b.querySelector(s), r = b.getBoundingClientRect();
  return { phase: b.getAttribute("data-phase"), run: b.classList.contains("run"), verdict: b.getAttribute("data-verdict"), said: q(".hd-verdict").textContent, amount: q(".hd-in").value, iban: q(".hd-iban b").textContent,
    signed: q(".hd-signed").title, now: q(".hd-now").title, signedShort: q(".hd-signed").textContent, nowShort: q(".hd-now").textContent, stamp: +getComputedStyle(q(".hd-stamp")).opacity,
    stampShown: getComputedStyle(q(".hd-stamp")).display !== "none", size: Math.round(r.width) + "x" + Math.round(r.height), focus: document.activeElement && (document.activeElement.getAttribute("data-act") || document.activeElement.className) };
})()`;
interface HeroState { phase: string; run: boolean; verdict: string; said: string; amount: string; iban: string; signed: string; now: string; signedShort: string; nowShort: string; stamp: number; stampShown: boolean; size: string; focus: string }

export async function checkHome(page: Page, o: { url: string; name: string; width: number; height: number; touch: boolean; tryHref: string; fail: (what: string) => void; shot?: (name: string) => Promise<void>; quick?: boolean }): Promise<void> {
  const fail = (what: string) => o.fail(`${o.name}: ${what}`);
  const state = () => page.evaluate(HERO_STATE) as Promise<HeroState>;
  // Polled from here with page.evaluate: Home's CSP allows no eval, which waitForFunction's own polling would need.
  const until = async (what: string, pred: string, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(50)) if (await page.evaluate(`(() => { const b = document.getElementById("hero-demo"); return ${pred}; })()`)) return;
    fail(`${what} (after ${ms} ms: ${JSON.stringify(await state())})`);
  };
  const refused = (what: string) => until(what, 'b.getAttribute("data-verdict") === "refused"');
  const valid = (what: string) => until(what, 'b.getAttribute("data-verdict") === "valid"');
  const press = async (act: string) => { const b = page.locator(`#hero-demo [data-act="${act}"]`); if (o.touch) await b.tap(); else await b.click(); };

  await page.goto(o.url, { waitUntil: "load" });
  // One story: two buttons that lead somewhere, the first in the first screen with its one line under it; no Watch.
  const buttons = await page.locator("main a.btn").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  if (JSON.stringify(buttons) !== JSON.stringify([o.tryHref, "proof"])) fail(`the buttons lead to ${JSON.stringify(buttons)}, not to ${o.tryHref} and proof`);
  const first = await page.locator("main p.reassure").boundingBox();
  if (!first || first.y + first.height > o.height) fail("the first button and its reassurance line are not in the first screen");
  if (await page.locator('main a[href="watch"], [data-stage], main a[href="judge"], main a[href="visa"]').count()) fail("a Watch link, a replay stage, or a third way out is back in Home's main part");
  if ((await page.locator("#hero-demo .hd-steps > li").count()) !== 4 || (await page.locator("#hero-demo .hd-steps > li").last().innerText()).replace(/\s+/g, " ").trim() !== "4 +1 cent") fail('the hero has not four tabs ending in "+1 cent"');
  if (await page.locator("#hero-demo .hd-stage").evaluate((e) => getComputedStyle(e).display) !== "grid") fail("the hero lost its style");

  // A10: the heading's two sentences are two lines, each unbroken, where the layout is two columns.
  if (o.width >= 1100) {
    const lines = await page.locator("h1.h-hero span").evaluateAll((ss) => ss.map((s) => ({ rects: s.getClientRects().length, top: Math.round(s.getBoundingClientRect().top), text: s.textContent })));
    if (lines.length !== 2 || lines.some((l) => l.rects !== 1) || lines[0]!.top >= lines[1]!.top || lines[0]!.text !== "AI agents spend.") fail(`the heading does not break after "spend." (${JSON.stringify(lines)})`);
  }

  // The hero plays steps 1 to 3 once when it comes into view, then rests on step 4 with the browser's own verdict.
  const s0 = (await state()).size;
  await page.locator("#hero-demo").scrollIntoViewIfNeeded();
  await page.evaluate(() => { const b = document.getElementById("hero-demo")!; window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 70); });
  if (!o.quick) {
    await until("the hero does not play", 'b.getAttribute("data-phase") !== "4"', 6000);
    const mid = await state();
    if (mid.size !== s0) fail(`the hero changes size while it plays (${s0} → ${mid.size})`);
  }
  // One tap at any moment, also while steps 1 to 3 play, goes straight to step 4 and changes the amount by one cent.
  // From here on Home asks nothing of any server.
  const asked: string[] = [];
  const onRequest = (r: { url(): string }) => { asked.push(r.url()); };
  page.on("request", onRequest);
  if (o.quick) {
    await press("cent");
  } else {
    await until("the hero does not rest on step 4 after playing once", 'b.getAttribute("data-phase") === "4" && !b.classList.contains("run")', 15000);
    await valid("at rest the hero does not show a valid signature");
    const rest = await state();
    if (rest.said !== HERO_VERDICT.valid || rest.amount !== AMOUNT || rest.signed !== SIGNED || rest.now !== SIGNED || rest.size !== s0 || rest.stamp !== 0) fail(`at rest step 4 is not the receipt's terms, valid (${JSON.stringify(rest)})`);
    await page.waitForTimeout(4000);
    if ((await state()).phase !== "4") fail("the hero loops on by itself after resting");
    await o.shot?.("rest");
    await press("cent");
  }
  await refused('one tap on "+1 cent" does not show refused');
  await page.waitForTimeout(900);
  const bad = await state();
  if (bad.phase !== "4" || bad.amount !== plusCent(AMOUNT) || !bad.said.includes(HERO_VERDICT.refused) || !bad.stampShown || bad.stamp < 0.99) fail(`after "+1 cent": not ${plusCent(AMOUNT)}, the stamp and "${HERO_VERDICT.refused}" (${JSON.stringify(bad)})`);
  if (bad.signed !== SIGNED || !/^[0-9a-f]{64}$/.test(bad.now) || bad.now === bad.signed || bad.nowShort === bad.signedShort || !bad.signed.startsWith(bad.signedShort.replace("…", "")) || !bad.now.startsWith(bad.nowShort.replace("…", ""))) fail(`after "+1 cent": not two different hashes, short in sight and whole in the title (${JSON.stringify(bad)})`);
  if (bad.size !== s0) fail(`the hero changes size when the verdict changes (${s0} → ${bad.size})`);
  if (await page.locator("#hero-demo .hd-in").evaluate((e) => getComputedStyle(e).color) === await page.locator("#hero-demo .hd-k b").evaluate((e) => getComputedStyle(e).color)) fail("the refused amount is not red");
  await o.shot?.("refused");
  await press("reset");
  await valid('"Reset" does not show valid');
  // Any other amount fails; the signed amount typed back passes again.
  const field = page.locator("#hero-demo .hd-in");
  await field.fill("199.00");
  await refused("another amount typed is not refused");
  await field.fill(AMOUNT);
  await valid("the signed amount typed back is not valid again");
  await press("iban");
  await refused('"Change the IBAN" is not refused');
  const iban = await state();
  if (iban.iban === `····${RECEIPT.shown.ibanLast4}` || iban.amount !== AMOUNT) fail(`"Change the IBAN" did not change the last four only (${JSON.stringify(iban)})`);
  await press("reset");
  await valid('"Reset" after the IBAN does not show valid');

  // The keyboard alone: Tab from the button reaches the amount, then "+1 cent", "Change the IBAN" and "Reset", in order.
  await page.locator("main a.btn.primary").focus();
  await page.keyboard.press("Tab");
  if ((await state()).focus !== "hd-in") fail(`Tab from the button does not reach the amount field (${(await state()).focus})`);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(plusCent(AMOUNT));
  await refused("an amount typed with the keyboard is not refused");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => { const e = document.activeElement!, cs = getComputedStyle(e); return { act: e.getAttribute("data-act"), outline: `${cs.outlineStyle} ${cs.outlineWidth}` }; });
  if (ring.act !== "cent" || ring.outline !== "solid 3px") fail(`Tab does not reach "+1 cent" with a visible focus ring (${JSON.stringify(ring)})`);
  await page.keyboard.press("Enter");
  await until('Enter on "+1 cent" does not add a cent', `b.querySelector(".hd-in").value === "${plusCent(plusCent(AMOUNT))}"`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  if ((await state()).focus !== "reset") fail(`Tab does not reach "Reset" (${(await state()).focus})`);
  await page.keyboard.press("Space");
  await valid('Space on "Reset" does not show valid');
  const end = await state();
  if (end.amount !== AMOUNT || end.now !== SIGNED || end.size !== s0) fail(`after "Reset" the terms are not the signed ones (${JSON.stringify(end)})`);
  page.off("request", onRequest);
  if (asked.length) fail(`the hero's check made ${asked.length} request(s): ${asked.slice(0, 3).join(", ")}`);

  // A9: every link, button, fold header and field of Home's main part is a thumb's size.
  const small = await page.evaluate(`[...document.querySelectorAll("main a, main button, main summary, main input")].filter((e) => e.getClientRects().length).map((e) => ({ what: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height * 10) / 10 })).filter((x) => x.h < 44)`) as { what: string; h: number }[];
  for (const s of small) fail(`"${s.what}" is ${s.h}px high, under 44`);

  if (o.width < 500) {
    // A2: the first two phone screens show one date, and no transfer id but the hero's.
    const seen = await page.evaluate(SEEN_ABOVE(2 * o.height)) as string;
    const dates = seen.match(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g) ?? [];
    if (JSON.stringify(dates) !== JSON.stringify([FACTS.date])) fail(`the first two screens show the dates ${JSON.stringify(dates)}, not only ${FACTS.date}`);
    const ids = [...new Set(TRANSFERS.filter((id) => seen.includes(id.slice(0, 8))))];
    if (ids.some((id) => id !== FACTS.transfer)) fail(`the first two screens show another transfer than the hero's (${ids.join(", ")})`);
    if ((seen.match(/simulated/gi) ?? []).length !== 1 || (seen.match(/test money/gi) ?? []).length !== 1) fail('"simulated" and "test money" are not each in sight exactly once');
    // The three proof rows fit one phone screen, heading and button included.
    const locks = await page.locator("section.locks").evaluate((e) => { const b = e.querySelector("a.btn")!.getBoundingClientRect(), h = e.querySelector("h2")!.getBoundingClientRect(); return { rows: e.querySelectorAll("a.row").length, height: Math.round(b.bottom - h.top) }; });
    if (locks.rows !== 3 || locks.height > o.height - 64) fail(`the three rows with their heading and button are ${locks.height}px high (${locks.rows} rows): more than one screen under the menu`);
  }
  for (const row of await page.locator("a.row").all()) if (!(await row.getAttribute("href"))) fail("a proof row leads nowhere");

  if (o.quick) return;
  // Step 3, still: the one transfer id is the record's.
  await page.goto(new URL("/home?demo=3", o.url).href, { waitUntil: "load" });
  const paid = await page.locator("#hero-demo .hd-paid").innerText();
  if ((await state()).phase !== "3" || !paid.includes(FACTS.transfer.slice(0, 8))) fail(`?demo=3 is not the still frame of step 3 with the record's transfer (${paid})`);
  await press("cent");
  await refused("a tap on a still frame of step 3 does not go to step 4, refused");

  // Reduced motion: one still frame, step 4, valid; the controls work.
  const still = await page.context().browser()!.newPage({ viewport: { width: o.width, height: o.height }, reducedMotion: "reduce" });
  try {
    await still.goto(o.url, { waitUntil: "load" });
    await still.waitForTimeout(1500);
    const q = async () => still.evaluate(HERO_STATE) as Promise<HeroState>;
    const a = await q();
    if (a.phase !== "4" || a.run || a.verdict !== "valid") fail(`with reduced motion the hero is not one still frame of step 4, valid (${JSON.stringify(a)})`);
    await still.locator('#hero-demo [data-act="cent"]').click();
    await still.waitForTimeout(1200);
    const b = await q();
    if (b.verdict !== "refused" || b.amount !== plusCent(AMOUNT) || b.stamp < 0.99) fail(`with reduced motion "+1 cent" does not show ${plusCent(AMOUNT)}, refused (${JSON.stringify(b)})`);
  } finally { await still.close(); }
}
