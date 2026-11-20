// The hands-on /try on `npm run judge` (src/cli/judgeTry.ts), in Chromium with a virtual passkey, as a judge without
// internet runs it: launch, the EUR 120.00 invoice paid by the agent alone, the EUR 1,850.00 invoice sent to the CFO and
// approved with the passkey, the one-cent change refused, the result, and the proof downloaded and verified by the
// repo's own verifier (src/cli/verifyBundle.ts); then, in a second tab, the EUR 480.00 invoice inside the limit that code's
// cash check holds (17 Nov): its financial context on screen and no payout made. On the way: the offline label, "no Claude call" and the simulated bank
// are on screen, and no request leaves localhost.
//   npx tsx test/browser/judge-try.check.ts [screenshot dir] [--at http://localhost:4311]   (default: a judge started here)
//   npx tsx test/browser/judge-try.check.ts [screenshot dir] --at https://kit11.max-31b.workers.dev --live
//     the live site as a judge opens it (17 Nov): the same flow, with Claude on and test money; the offline label and
//     "no Claude call" are not asked for, and every request must stay on the site's own host instead of localhost.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { startJudge } from "../../src/cli/judge.js";
import { OFFLINE_TRY_NOTE } from "../../src/cli/judgeTry.js";
import { FINISH_LINKS } from "../../cloud/src/tryCopy.js";
import { gotoLoaded, launchBrowser } from "./support/browser.js";

const args = process.argv.slice(2);
const at = args.indexOf("--at");
const shots = args[0] && !args[0].startsWith("--") ? args[0] : "test-results/judge-try";
mkdirSync(shots, { recursive: true });
const judge = at >= 0 ? null : await startJudge(0);
const base = at >= 0 ? args[at + 1]!.replace(/\/$/, "") : judge!.url;
const live = args.includes("--live");
const home = new URL(base).hostname;
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const browser = await launchBrowser();
const errors: string[] = [];
const outside: string[] = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("request", (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && (live ? u.hostname !== home : u.hostname !== "localhost" && u.hostname !== "127.0.0.1")) outside.push(r.url()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const text = (p: Page) => p.evaluate(() => document.body.innerText);
  const click = async (name: string | RegExp, timeout = 60_000) => {
    const b = page.getByRole("button", { name }).first();
    await b.waitFor({ timeout });
    await b.click();
  };

  await gotoLoaded(page, `${base}/try`);
  if (!live) {
    ok(await page.locator(".judge-offline").isVisible(), "the offline label is on screen");
    ok((await page.locator(".judge-offline").innerText()).trim() === OFFLINE_TRY_NOTE, "the offline label says code reads, the simulated bank pays");
  }
  await click(/Launch the live transfer demo/);
  await click(/A small invoice inside the agent's limit/);
  await click(/Give it to the AI agent/);
  await page.getByRole("button", { name: "See the agent pay it" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  if (!live) ok(/no Claude call/i.test(await text(page)), "EUR 120.00: the page says no Claude call read it");
  // Max, 19 Nov 2026: offline, live Claude does not run; the step itself says so, not only the rail.
  if (!live) ok(await page.locator("#main .screen.work .pv-paused").isVisible(), "EUR 120.00: the reading step's notice says live Claude did not read it");
  ok(await page.getByText("Checks passed. Approved by your policy.").isVisible(), "EUR 120.00: within the limit, approved by the policy");
  await page.screenshot({ path: join(shots, "1-agent-alone.png") });
  await click("See the agent pay it");
  await click("Try an invoice above EUR 500 →");
  await page.locator(".samples button[aria-pressed=true]").first().waitFor({ timeout: 30_000 });
  ok(/1,850\.00/.test(await page.locator(".samples button[aria-pressed=true]").first().innerText()), "the EUR 1,850.00 invoice is picked");
  await click(/Give it to the AI agent/);
  await click(/Send to CFO for approval/);
  // The passkey: set up first if the page asks (a fresh company has none), then sign.
  for (let i = 0; i < 6 && !(await page.getByRole("button", { name: /Approve & sign/ }).count()); i++) {
    const setup = page.getByRole("button", { name: /passkey|Face ID|Touch ID|Windows Hello|Set up/i }).first();
    if (await setup.count() && await setup.isVisible()) await setup.click().catch(() => undefined);
    await page.waitForTimeout(1_500);
  }
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: join(shots, "2-approve.png") });
  // The page's own passkey button may already have signed (live: its "Face ID" button matched above); else sign here.
  const next = page.getByRole("button", { name: "Now try to change it" });
  const sign = page.getByRole("button", { name: /Approve & sign/ }).first();
  await Promise.race([next.waitFor({ timeout: 60_000 }), sign.waitFor({ timeout: 60_000 })]).catch(() => undefined);
  if (!(await next.count())) {
    // Jury, 17 Nov: "Don't sign" stayed on screen after the signature, and a tap on it sent the page back to step 1 while
    // the pay call still went out. Here the pay call is held until "Don't sign" has been looked for: on the sheet before
    // signing, gone (hidden or disabled) once signed and while paying.
    const notNow = page.locator(".acts.sign button.quiet");
    ok(await notNow.isVisible() && await notNow.isEnabled(), "before signing: \"Don't sign\" is on the sheet");
    let release = () => undefined as void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route(/\/v1\/engine\/proposals\/[^/]+\/pay$/, async (route) => { await held; await route.continue(); });
    await click(/Approve & sign/);
    await page.getByRole("button", { name: "Paying…" }).waitFor({ timeout: 60_000 });
    ok(!(await notNow.isVisible()) || !(await notNow.isEnabled()), "signed, paying: \"Don't sign\" is gone (hidden or disabled)");
    ok((await page.getByRole("button", { name: "Don't sign" }).count()) === 0, "signed, paying: no \"Don't sign\" button a person can reach");
    release(); // the route stays: every later pay call (the one-cent change too) goes straight through
  }
  await next.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  ok(live ? /Paid · test money/i.test(await text(page)) : /simulated bank/i.test(await text(page)), live ? "EUR 1,850.00 paid: the page says test money" : "EUR 1,850.00 paid: the page says the simulated bank paid");
  await click("Now try to change it");
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", null, { timeout: 20_000 });
  await page.waitForTimeout(800);
  // 19 Nov 2026 (live review): "0 extra calls · blocked locally by SHA-256" only once the change was tried, not before.
  ok(!/extra calls/.test(await page.locator(".pv-rail").innerText()), "the tamper step, before trying: no \"extra calls\" line yet");
  await click("Try to pay with my earlier approval");
  await page.waitForSelector(".why .head", { timeout: 30_000 });
  ok(/Blocked|refused/i.test(await text(page)), "1,850.01: refused");
  await page.waitForTimeout(800);
  {
    // 19 Nov 2026: the SHA-256 check is Purser's code, not an AI agent; and now the line about extra calls is earned.
    const rail = await page.locator(".pv-rail").innerText();
    ok(/Purser’s code\s*blocked: the fingerprint does not match/.test(rail) && !/Checker agent\s*blocked/.test(rail), "1,850.01: the rail credits Purser's code with the block");
    ok(/0 extra calls · blocked locally by SHA-256/.test(rail), "1,850.01: after the try, \"0 extra calls · blocked locally by SHA-256\"");
  }
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(shots, "3-refused.png") });
  await click("See your result");
  const dl = page.locator(".finishdl").first();
  await dl.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(shots, "4-result.png") });
  {
    // 21 Nov 2026 (owner, judges on Monday): the finish sums the run up from the engine's own records, row by row: the
    // agent's EUR 120.00 within the limit, the EUR 1,850.00 signed with the passkey (its proof file), the one cent refused
    // (its proof file); no row for the test company's seeded original (paid before it started); then Purser Cloud's demo
    // company, the only main button; the details folded under "Under the hood".
    await page.locator(".fin-row").nth(2).waitFor({ timeout: 30_000 });
    const rows = (await page.locator(".fin-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    ok(rows.length === 3, `the finish: three rows, one per thing this run did (${rows.length})`);
    ok(/^Paid by the agent .*BTX-2026-23.*EUR 500\.00 limit.*EUR 120\.00/.test(rows[0] ?? ""), `the finish: the agent paid EUR 120.00 within the limit (${rows[0]})`);
    ok(/^Paid with your passkey .*BTX-2026-21.*EUR 1,850\.00 Proof file/.test(rows[1] ?? ""), `the finish: EUR 1,850.00 signed with the passkey, with its proof file (${rows[1]})`);
    ok(/^Refused: one cent changed .*amount changed.*No transfer was made\. EUR 1,850\.01 Proof file/.test(rows[2] ?? ""), `the finish: EUR 1,850.01 refused, no transfer, with its proof file (${rows[2]})`);
    ok(!rows.some((r) => /BTX-2026-17/.test(r)), "the finish: no row for the seeded original paid before the company started");
    ok(/^EUR 1,970\.00 paid\s*·\s*EUR 1,850\.01 refused$/.test((await page.locator(".fin-total").innerText()).trim()), `the finish: the totals (${await page.locator(".fin-total").innerText()})`);
    const go = page.locator(".fin-cloud a.fin-go");
    ok(await go.isVisible() && await go.getAttribute("href") === FINISH_LINKS.cloud && await go.getAttribute("target") === "_blank", "the finish: \"Open Purser Cloud\" opens its demo company (#/guest) in a new tab");
    ok(await page.locator(".fin-cloud a.fin-own").getAttribute("href") === FINISH_LINKS.start, "the finish: a starter key's set-up is the console's own #/start");
    const primaries = await page.locator("#main .screen.company .btn.primary").evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).offsetParent !== null && !b.closest("details:not([open])")).map((b) => (b.textContent ?? "").trim()));
    ok(primaries.length === 1 && /Open Purser Cloud/.test(primaries[0] ?? ""), `the finish: one main button, Open Purser Cloud (${primaries.join(" | ")})`);
    ok((await page.locator(".fin-hood").getAttribute("open")) === null && !(await page.locator(".pv-verify").isVisible()), "the finish: how every step is verified is folded under the hood");
    await page.locator(".fin-hood > summary").click();
    ok(await page.locator(".pv-verify").isVisible(), "the finish: one tap opens how every step is verified");
  }
  if (!live) {
    // 19 Nov 2026 (live review): the finish says who read the invoice in this run; offline, code did, and no call is counted.
    const card = await page.locator(".pv-verify").innerText();
    ok(/Read by Purser's code/.test(card) && !/Claude read the invoice/.test(card) && !/This run: \d+ calls/.test(card), `the finish: "Read by Purser's code", no Claude calls claimed (${card.replace(/\s+/g, " ").slice(0, 140)})`);
    // Max, 19 Nov 2026: and plainly, in the end card itself (21 Nov: on the run's summary, in plain view; the fold has it too).
    ok(/^Live Claude is off for this demo right now\./.test(await page.locator(".pv-verify .pv-paused").innerText()), "the finish: the fold's notice says live Claude did not read this invoice");
    const paused = page.locator(".fin-sum .pv-paused");
    ok(await paused.isVisible() && /^Live Claude is off for this demo right now\. Purser's code read this invoice instead\./.test(await paused.innerText()), "the finish: the notice says live Claude did not read this invoice");
  }
  const [download] = await Promise.all([page.waitForEvent("download"), dl.click()]);
  const file = join(shots, download.suggestedFilename() || "purser-proof.json");
  await download.saveAs(file);
  ok(download.suggestedFilename() === "purser-proof.json", `the proof downloads as ${download.suggestedFilename()}`);
  // The repo's own verifier, as the page tells the judge to run it (node + tsx, no npx: Windows too).
  const tsx = fileURLToPath(import.meta.resolve("tsx/cli"));
  const verifier = fileURLToPath(new URL("../../src/cli/verifyBundle.ts", import.meta.url));
  let out = "";
  try { out = execFileSync(process.execPath, [tsx, verifier, file], { encoding: "utf8" }); } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
  console.log(out.trim().split("\n").map((l) => `      ${l}`).join("\n"));
  ok(/\bVALID\b/.test(out) && !/INVALID/.test(out), "npm run verify-bundle on the downloaded proof: VALID");
  // 17 Nov: the sample inside the limit that code's cash check holds ("Inside the limit — but cash says wait"), in a
  // second tab (a test company of its own): the financial context on screen, code's decision, and no payout made.
  {
    const p2 = await ctx.newPage();
    p2.on("pageerror", (e) => errors.push(e.message));
    p2.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    p2.on("request", (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && (live ? u.hostname !== home : u.hostname !== "localhost" && u.hostname !== "127.0.0.1")) outside.push(r.url()); });
    const press = async (name: string | RegExp) => { const b = p2.getByRole("button", { name }).first(); await b.waitFor({ timeout: 60_000 }); await b.click(); };
    await gotoLoaded(p2, `${base}/try`);
    await press(/Launch the live transfer demo/);
    await press(/Inside the limit — but cash says wait/);
    ok(/480\.00/.test(await p2.locator(".samples button[aria-pressed=true]").first().innerText()), "cash sample: the EUR 480.00 invoice is picked");
    await press(/Give it to the AI agent/);
    const panel = p2.locator(".why.cashctx");
    await panel.waitFor({ timeout: 60_000 });
    await p2.waitForTimeout(800);
    const said = await panel.innerText();
    ok(/below the cash floor/.test(said) && /Available after paying/.test(said) && /Cash floor/.test(said) && /Spoken for/.test(said), "cash sample: the financial context and the hold are on screen");
    ok(/Decided by Purser's code, not the agent/.test(said), "cash sample: code's check decided, not the agent");
    ok(/No transfer was sent to Airwallex/.test(said), "cash sample: the page says no transfer was sent");
    ok((await panel.locator(".cmp mark").count()) === 1, "cash sample: the figure below the floor is marked");
    await p2.screenshot({ path: join(shots, "5-cash-held.png") });
    // The engine's own record: no transfer, no approval within the limit, nothing executed; the invoice still open.
    const rec = await p2.evaluate(async () => {
      const st = JSON.parse(sessionStorage.getItem("purser.try") || "{}") as { session?: string };
      const h = { authorization: `Bearer ${st.session ?? ""}` };
      const ev = await (await fetch("/v1/engine/events?after=0&limit=200", { headers: h })).json() as { items: { event: string }[] };
      const inv = await (await fetch("/v1/engine/invoices", { headers: h })).json() as { items: { invoice_no: string; status: string }[] };
      return { events: ev.items.map((e) => e.event), status: inv.items.find((i) => i.invoice_no === "BTX-2026-24")?.status ?? null };
    });
    ok(!rec.events.some((e) => /^(transfer\.|airwallex\.transfer|proposal\.executed|proposal\.within_limit)/.test(e)), "cash sample: no payout made (no transfer, nothing approved or executed)");
    ok(rec.status === "ready", `cash sample: the invoice stays open (${String(rec.status)})`);
    await p2.close();
  }
  ok(outside.length === 0, `no request left ${live ? home : "localhost"}${outside.length ? `: ${[...new Set(outside)].slice(0, 5).join(", ")}` : ""}`);
  ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
} finally {
  await browser.close();
  judge?.server.close();
}
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
