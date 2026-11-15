// Recording mode (/try?present=1, cloud/src/try/presentMode.ts) in Chromium at 1920×1080, on this machine: a real
// cloud with an engine in this process (test money on a simulated bank), Chromium's virtual passkey authenticator, and
// the presenter's keys only (→ for each step, typing the changed cent). The whole run: the opener, start, a sample, the
// engine's check, the approval with the passkey, paid, one cent changed and refused, the outcome card with this run's
// own numbers. At every step: no vertical or horizontal scroll at 1080p, the test-money label on screen, the bottom-right
// 340×340 px clear for the camera bubble, no console or CSP error. Without the flag, /try has none of it.
// npx tsx test/browser/present.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { PRESENT_AFTER, PRESENT_BEFORE, PRESENT_MONEY, PRESENT_OUTCOME, PRESENT_TRY } from "../../cloud/src/try/presentMode.js";
import { BOOKS } from "../../cloud/src/tryCopy.js";
import { gotoLoaded, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 9290 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "present-check-admin-token-not-a-secret";
const W = 1920, H = 1080, CAM = 340;
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "present-check-"));
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "t".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 }, tryIt: {},
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });
await handle(new Request(`${ORIGIN}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify({ op: "set", key: "starts", value: "on" }) }), env);

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("cf-connecting-ip", "127.0.0.1");
  const r = await handle(new Request(`${ORIGIN}${req.url ?? "/"}`, { method: req.method ?? "GET", headers, ...(chunks.length && req.method !== "GET" ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const errors: string[] = [];
/** One step's frame: no scroll at 1080p, the label on screen, the camera corner clear of the page's content. */
async function frame(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(700);
  const m = await page.evaluate(([cam]) => {
    const de = document.documentElement;
    const corner = { x: innerWidth - cam!, y: innerHeight - cam! };
    // Visible things of the page (text, buttons, inputs, images) that reach into the camera corner.
    const hits: string[] = [];
    for (const e of document.querySelectorAll("#main *, .pv-lane, .pv-card.on .in")) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") continue;
      if (r.right > corner.x && r.bottom > corner.y && r.left < innerWidth && r.top < innerHeight) hits.push(`${e.tagName.toLowerCase()}.${(e as HTMLElement).className}`);
    }
    const money = [...document.querySelectorAll(".pv-money")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; });
    // A card over the page holds the page still (overflow hidden): nothing scrolls on screen.
    const still = getComputedStyle(de).overflow === "hidden";
    return { sh: still ? innerHeight : de.scrollHeight, sw: de.scrollWidth, hits: hits.slice(0, 3), money };
  }, [CAM]);
  ok(m.sh <= H, `${name}: no scroll at 1080p (${m.sh} px)`);
  ok(m.sw <= W, `${name}: nothing wider than the screen (${m.sw} px)`);
  ok(m.money, `${name}: the test-money label is on screen`);
  ok(m.hits.length === 0, `${name}: the camera corner (${CAM}×${CAM}) is clear${m.hits.length ? `: ${m.hits.join(", ")}` : ""}`);
  if (shots) await page.screenshot({ path: join(shots, `present-${name}.png`) });
}
const next = async (page: Page) => { await page.keyboard.press("ArrowRight"); };

const browser = await launchBrowser("chromium");
try {
  // Without the flag: the normal page, nothing of recording mode.
  const plain = await (await browser.newContext()).newPage();
  await gotoLoaded(plain, `${ORIGIN}/try`);
  ok(await plain.locator(".pv-money, .pv-card, .pv-lane").count() === 0 && !(await plain.evaluate(() => document.body.classList.contains("present"))), "/try without ?present=1 is the normal page");
  await plain.context().close();

  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: shots ? 2 : 1, colorScheme: "dark" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  await gotoLoaded(page, `${ORIGIN}/try?present=1`);
  // The opener.
  ok(await page.locator(".pv-card.on").count() === 1 && (await page.locator(".pv-ba .before p").textContent()) === PRESENT_BEFORE && (await page.locator(".pv-ba .after p").textContent()) === PRESENT_AFTER, "the opener: Before and After");
  await frame(page, "01-opener");
  await next(page);
  ok(await page.locator(".pv-card.on").count() === 0, "→ closes the opener");
  await frame(page, "02-start");
  // Start: the page's own button.
  await next(page);
  await page.waitForSelector(".screen.invoice button[aria-pressed]", { timeout: 20_000 });
  await frame(page, "03-invoice");
  ok(await page.locator('.screen.invoice [aria-pressed="true"]').count() === 1, "the first sample is picked, as on /try");
  await next(page); // send it
  await page.waitForSelector(".screen.work .btn.primary", { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await frame(page, "04-checked");
  // If the first sample was held (a copy of a filed invoice), → files another, as a presenter would.
  for (let i = 0; i < 4 && !(await page.locator(".screen.approve").count()); i++) {
    await next(page);
    await page.waitForSelector(".screen.approve, .screen.invoice button[aria-pressed], .screen.work .btn.primary", { timeout: 30_000 });
    if (await page.locator(".screen.invoice").count()) {
      const samples = page.locator(".screen.invoice button[aria-pressed]");
      await samples.nth(Math.min(i + 1, (await samples.count()) - 1)).click();
      await next(page);
      await page.waitForSelector(".screen.work .btn.primary", { timeout: 30_000 });
      await page.waitForTimeout(1_000);
    }
  }
  await page.waitForSelector(".screen.approve", { timeout: 20_000 });
  await page.waitForTimeout(800);
  ok(await page.locator(".pv-lane").isVisible(), "the approval: the phone lane is there");
  await frame(page, "05-approve-phone");
  // Approve with the passkey: set up and sign, each the page's own main button.
  for (let i = 0; i < 4 && !(await page.locator(".screen.books").count()); i++) {
    await next(page);
    await page.waitForTimeout(2_500);
  }
  await page.waitForSelector(`h1:text-is("${BOOKS.heading}")`, { timeout: 30_000 });
  await page.waitForSelector(".blk.filed a.file", { timeout: 20_000 }).catch(() => undefined);
  await frame(page, "06-paid");
  // One cent: → opens screen 5's own link; the presenter types the cent; → pays.
  await next(page);
  // The panel opens with the one-cent change filled in (15 Nov); the presenter types it anyway, as a person would.
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", null, { timeout: 20_000 });
  await page.fill("#p-amt", "1850.01");
  await frame(page, "07-change");
  await page.locator("#p-amt").blur();
  await next(page);
  await page.waitForSelector(".why .head", { timeout: 20_000 });
  await frame(page, "08-refused");
  // The outcome.
  await next(page);
  ok(await page.locator(".pv-out.on").count() === 1, "→ after the refusal: the outcome card");
  const figs = await page.locator(".pv-out .pv-figs li").allTextContents();
  ok(/^\d+ s/.test(figs[0] ?? "") && figs[0]!.includes(PRESENT_OUTCOME.time), `the outcome: the time from start to paid (${figs[0]})`);
  ok((figs[1] ?? "").startsWith("EUR 1,850.00"), `the outcome: the amount paid (${figs[1]})`);
  ok(/^\d+Steps the engine recorded · \d+ of them by Claude/.test(figs[2] ?? ""), `the outcome: the engine's steps (${figs[2]})`);
  ok((figs[3] ?? "").startsWith(PRESENT_OUTCOME.refusedYes), `the outcome: the refusal by both layers (${figs[3]})`);
  ok((await page.locator(".pv-out .pv-try").textContent())?.includes(PRESENT_TRY), "the outcome: try it yourself");
  ok(await page.locator(".pv-out .pv-money").filter({ hasText: PRESENT_MONEY }).isVisible(), "the outcome: test money");
  await frame(page, "09-outcome");
  // R: start again, the opener again.
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await page.waitForSelector(".pv-card.on", { timeout: 10_000 });
  ok(new URL(page.url()).search === "?present=1" && await page.locator(".pv-figs b.none").count() >= 3, "R: a fresh start in recording mode, the outcome empty");
  const real = errors.filter((e) => !/Failed to load resource/.test(e));
  ok(real.length === 0, `no console or page error${real.length ? `: ${real.join(" | ")}` : ""}`);
  await ctx.close();
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
