// Browser check of /try/sign (not part of npm test; needs Playwright with Chromium from the environment):
//   npx tsx test/browser/trysign.check.ts [screenshot dir]
// A local relay built with TRY_SIGN_ENABLED=on serves the page; Chromium's virtual authenticator (WebAuthn over CDP,
// user verification on) plays the visitor's Face ID. At 390 and 1440 px, light and dark, it goes through the whole
// visit: start a test world, create a test passkey, see (a) blocked by a rule with no button, sign (b), see the server
// verify it and the stand-in execute it, then tamper (amount + 0.01) and see the same signature refused. A test world
// only: nothing here reaches the runner, Airwallex or Metal.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

process.env.TRY_SIGN_ENABLED = "on";
const { startLocalRelay } = await import("../../src/relay/local.js");
const { TRY_SIGN_LABEL } = await import("../../src/try/sign.js");

const shots = resolve(process.argv[2] ?? "docs/try-sign");
mkdirSync(shots, { recursive: true });
const local = await startLocalRelay({ port: 0, token: "browser-check" });
const require = createRequire(import.meta.url);
// Playwright is not a dependency of this repo; it comes with the environment (Chromium pre-installed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };

for (const width of [390, 1440]) {
  for (const scheme of ["light", "dark"] as const) {
    const tag = `${width}-${scheme}`;
    const mobile = width < 600;
    const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });

    // The landing carries the button in this bundle, and it leads here.
    await page.goto(`${local.url}/home`);
    const button = page.locator('a[href="try/sign"]');
    check(await button.count() === 1, `${tag}: the landing has the "Sign with your own Face ID" button`);
    await button.click();
    await page.waitForURL(`${local.url}/try/sign`);
    check((await page.locator(".testband").innerText()).trim() === TRY_SIGN_LABEL, `${tag}: the label at the top reads "${TRY_SIGN_LABEL}"`);
    const band = await page.locator(".testband").boundingBox();
    check(!!band && band.y === 0, `${tag}: the label is the first thing on the page`);
    await page.screenshot({ path: join(shots, `${tag}-1-start.png`) });

    await page.click("#go-world");
    await page.waitForSelector("#s-props:not([hidden])");
    const blocked = page.locator("article.prop", { hasText: "T-0001" });
    check((await blocked.innerText()).includes("Check: fail"), `${tag}: (a) shows "Check: fail" and its rule`);
    check((await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) names the blocking rule`);
    check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
    const waiting = page.locator("article.prop", { hasText: "T-0002" });
    const hash = (await waiting.locator(".hash").innerText()).trim();
    check(/^[0-9a-f]{64}$/.test(hash), `${tag}: (b) shows its terms' hash, checked on the device`);
    check(await waiting.locator("button[data-sign]").isDisabled(), `${tag}: (b) cannot be signed before there is a passkey`);

    await page.click("#go-key");
    await page.waitForFunction(() => document.getElementById("k-status")?.classList.contains("ok") || document.getElementById("k-status")?.classList.contains("bad"));
    check((await page.locator("#k-status").getAttribute("class"))!.includes("ok"), `${tag}: the test passkey is made and registered (${(await page.locator("#k-status").innerText()).slice(0, 60)}…)`);
    await waiting.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `${tag}-2-proposals.png`), fullPage: true });

    await waiting.locator("button[data-sign]").click();
    await page.waitForSelector("#result:not([hidden])");
    check((await page.locator("#r-hash").innerText()).trim() === hash, `${tag}: the result shows the signed hash`);
    check((await page.locator("#result").innerText()).includes("Verified by the server"), `${tag}: "Verified by the server"`);
    check(/Test transfer test-[0-9a-f]{12}: EUR 1,850\.00/.test(await page.locator("#r-exec").innerText()), `${tag}: "Executed in your test world" by the stand-in`);

    const beforeTamper = errors.length;
    await page.click("#go-tamper");
    await page.waitForSelector("#tamper:not([hidden])");
    const head = await page.locator("#t-head").innerText();
    const why = await page.locator("#t-why").innerText();
    check(head.startsWith("Refused") && /challenge|signature was made for hash/.test(why), `${tag}: the same signature on the amount + 0.01 is refused (${why.slice(0, 70)}…)`);
    check((await page.locator("#t-what").innerText()).includes("EUR 1,850.01"), `${tag}: the tampered amount is shown`);
    await page.locator("#result").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `${tag}-3-signed-tamper.png`), fullPage: true });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `${tag}: no sideways scrolling (${overflow} px)`);
    // The one error expected: the browser logs the tamper's refusal (HTTP 400) as a failed request.
    const unexpected = errors.filter((e, i) => !(i >= beforeTamper && /status of 400/.test(e)));
    check(unexpected.length === 0 && errors.length - beforeTamper === 1, `${tag}: no console or CSP errors besides the refused tamper${unexpected.length ? `: ${unexpected.join(" | ")}` : ""}`);
    await context.close();
  }
}

await browser.close();
local.server.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
