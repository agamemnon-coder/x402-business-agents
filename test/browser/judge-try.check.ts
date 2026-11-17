// The hands-on /try on `npm run judge` (src/cli/judgeTry.ts), in Chromium with a virtual passkey, as a judge without
// internet runs it: launch, the EUR 120.00 invoice paid by the agent alone, the EUR 1,850.00 invoice sent to the CFO and
// approved with the passkey, the one-cent change refused, the result, and the proof downloaded and verified by the
// repo's own verifier (src/cli/verifyBundle.ts). On the way: the offline label, "no Claude call" and the simulated bank
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
  if (!(await next.count())) await click(/Approve & sign/);
  await next.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  ok(live ? /Paid · test money/i.test(await text(page)) : /simulated bank/i.test(await text(page)), live ? "EUR 1,850.00 paid: the page says test money" : "EUR 1,850.00 paid: the page says the simulated bank paid");
  await click("Now try to change it");
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", null, { timeout: 20_000 });
  await click("Try to pay with my earlier approval");
  await page.waitForSelector(".why .head", { timeout: 30_000 });
  ok(/Blocked|refused/i.test(await text(page)), "1,850.01: refused");
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(shots, "3-refused.png") });
  await click("See your result");
  const dl = page.locator(".finishdl").first();
  await dl.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(shots, "4-result.png") });
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
  ok(outside.length === 0, `no request left ${live ? home : "localhost"}${outside.length ? `: ${[...new Set(outside)].slice(0, 5).join(", ")}` : ""}`);
  ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
} finally {
  await browser.close();
  judge?.server.close();
}
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
