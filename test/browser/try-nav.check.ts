// /try after Back, Forward and a reload (review, 16 Nov), offline on `npm run judge`, in Chromium with a virtual passkey:
//  1. EUR 120.00 within the limit: the agent's payment runs in the background; a reload then opens the paid screen, never
//     "Held" for an invoice that was paid.
//  2. EUR 1,850.00 sent to the CFO, then Back and "Send to CFO for approval" again: the same terms to sign, never a loop of
//     "File it again".
//  3. Back, then Forward to the approval: not the EUR 120.00 payment's screen for an invoice nobody signed.
//   npx tsx test/browser/try-nav.check.ts [screenshot dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { startJudge } from "../../src/cli/judge.js";
import { gotoLoaded, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "test-results/try-nav";
mkdirSync(shots, { recursive: true });
const judge = await startJudge(0);
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };
const browser = await launchBrowser();
const errors: string[] = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const text = (p: Page) => p.evaluate(() => document.body.innerText);
  const click = async (name: string | RegExp, timeout = 60_000) => { const b = page.getByRole("button", { name }).first(); await b.waitFor({ timeout }); await b.click(); };
  const settle = async (ms = 1500) => { await page.waitForLoadState("networkidle").catch(() => undefined); await page.waitForTimeout(ms); };

  await gotoLoaded(page, `${judge.url}/try`);
  await click(/Start the live demo|Launch the live transfer demo/);
  await click(/A small invoice inside the agent's limit/);
  await click(/Give it to the AI agent/);
  await page.getByRole("button", { name: "See the agent pay it" }).waitFor({ timeout: 60_000 });
  await settle(3000);
  // 1. A reload after the agent's payment ran in the background.
  await page.reload();
  await page.getByRole("button", { name: /Try an invoice above EUR 500/ }).waitFor({ timeout: 30_000 }).catch(() => undefined);
  await settle();
  const t1 = await text(page);
  await page.screenshot({ path: join(shots, "1-reload-after-agent-paid.png") });
  ok(!/Held: a person must look/.test(t1), "reload after the agent paid EUR 120.00: not shown as held");
  ok(await page.getByRole("button", { name: /Try an invoice above EUR 500/ }).isVisible(), "reload after the agent paid EUR 120.00: its paid screen, with the way to the next invoice");

  // 2. EUR 1,850.00 to the CFO, Back, then Send again.
  await click(/Try an invoice above EUR 500/);
  await page.locator(".samples button[aria-pressed=true]").first().waitFor({ timeout: 30_000 });
  await click(/Give it to the AI agent/);
  await click(/Send to CFO for approval/);
  await page.getByRole("button", { name: /Create your approval passkey|Approve & sign/ }).first().waitFor({ timeout: 60_000 });
  await page.goBack();
  await settle();
  await click(/Send to CFO for approval/, 30_000);
  const signable = await page.getByRole("button", { name: /Create your approval passkey|Approve & sign/ }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
  const t2 = await text(page);
  await page.screenshot({ path: join(shots, "2-back-then-send-again.png") });
  ok(signable, "Back, then Send to CFO again: the terms to sign");
  ok(!/File it again/.test(t2) && !/not ready to pay/.test(t2), "Back, then Send to CFO again: no 'File it again' loop");

  // 3. Back, then Forward to the approval of an invoice nobody signed.
  await page.goBack();
  await settle();
  await page.goForward();
  await settle();
  const t3 = await text(page);
  await page.screenshot({ path: join(shots, "3-back-forward.png") });
  ok(!(await page.getByRole("button", { name: /Now try to change it/ }).isVisible().catch(() => false)), "Back then Forward: no paid screen for the unsigned EUR 1,850.00");
  ok(/1,850\.00/.test(t3), "Back then Forward: still the EUR 1,850.00 invoice");
  ok(errors.length === 0, `no page error${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
  judge.server.close();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\ntry-nav check passes: a reload after the agent paid, Back and Send again, Back and Forward");
