// /try/sign in WebKit (Safari's engine), up to the passkey step (not part of npm test; needs Playwright's WebKit):
//   npx playwright install --with-deps webkit && npx tsx test/browser/trysign-webkit.check.ts [screenshot dir]
// Playwright's WebKit has no virtual authenticator, so nothing here makes or uses a passkey, and nothing stands in for
// one: the passkey and the signature are checked in Chromium (test/browser/trysign.check.ts, with a virtual
// authenticator) and by the server's tests. What WebKit checks is everything before them, as an iPhone visitor sees it:
// the label, a test world opened by the server, (a) blocked by a rule with nothing to sign, (b) with its terms' hash
// computed on the device (canonical JSON and SHA-256 in WebKit) and equal to the hash the server sent and to one
// computed here in Node, its signing button off until there is a passkey, the passkey button ready; no console or CSP
// error; the page no wider than the screen. If this WebKit build has no WebAuthn at all, the page must say so and offer
// nothing to click, and the check says which of the two it saw. Either way (6 Nov) it checks the demo's frame as Safari
// draws it: the three steps with step 1 under way, the start button above the fold at 390 px, the one-line disclaimer
// and "What's real?" opening to its honest lines; with WebAuthn, the approval sheet's terms (IBAN included) and the
// three locks with their links. CI runs it (.github/workflows/ci.yml, job judge); there
// (Playwright's WebKit on Ubuntu, 6 Nov) the build has no PublicKeyCredential, so CI sees the fallback and the layout.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const shots = resolve(process.argv[2] ?? "out/try-sign-webkit");
mkdirSync(shots, { recursive: true });
process.env.TRY_SIGN_ENABLED = "on";
const { TRY_SIGN_LABEL, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
const { startLocalRelay } = await import("../../src/relay/local.js");
const local = await startLocalRelay({ port: 0, token: "browser-check-webkit" });
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { webkit } = require("playwright") as { webkit: any };
const browser = await webkit.launch();

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

for (const [width, scheme] of [[390, "light"], [1440, "dark"]] as const) {
  const tag = `webkit-${width}-${scheme}`;
  const mobile = width < 600;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${local.url}/try/sign`);
  check((await page.locator(".testband").innerText()).trim() === TRY_SIGN_LABEL, `${tag}: the label at the top reads "${TRY_SIGN_LABEL}"`);
  check(!(await page.locator("#w-facts").isVisible()), `${tag}: the world's facts stay hidden until there is a world`);
  const height = mobile ? 844 : 900;
  check(JSON.stringify((await page.locator("ol.progress li .t").allInnerTexts()).map((t: string) => t.trim())) === JSON.stringify(TRY_SIGN_STEPS)
    && await page.locator("#pg-1").getAttribute("aria-current") === "step", `${tag}: three steps (${TRY_SIGN_STEPS.join(" → ")}), step 1 under way`);
  const go = await page.locator("#go-world").boundingBox();
  check(!!go && go.y + go.height <= height, `${tag}: the start button is above the fold (its bottom at ${go ? Math.round(go.y + go.height) : "?"} of ${height} px)`);
  const band = await page.locator(".testband").boundingBox();
  check(!!band && band.y === 0 && band.height <= 44, `${tag}: the disclaimer is one line at the top (${band?.height} px high)`);
  await page.locator("details.wr > summary").click();
  const wr = await page.locator("details.wr").innerText();
  check([...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits].every((l) => wr.includes(l)), `${tag}: "What's real?" opens to its honest lines`);
  // Playwright's screenshot in WebKit adds a stylesheet of its own, which this page's CSP refuses: that console error is
  // the screenshot's, not the page's, so only it is set aside (the page's own errors are counted below).
  const beforeShot = errors.length;
  await page.screenshot({ path: join(shots, `${tag}-whats-real.png`) });
  errors.splice(beforeShot, errors.length - beforeShot, ...errors.slice(beforeShot).filter((e) => !/^Refused to apply a stylesheet/.test(e)));
  await page.locator("details.wr > summary").click();
  const webauthn = await page.evaluate("Boolean(window.PublicKeyCredential && navigator.credentials)") as boolean;
  console.log(`info  ${tag}: this WebKit build ${webauthn ? "has" : "has no"} WebAuthn (PublicKeyCredential)`);
  if (!webauthn) {
    // The honest fallback: it says so, and there is nothing to start.
    check(/has no passkeys/.test(await page.locator("#w-status").innerText()) && await page.locator("#go-world").isDisabled(), `${tag}: without WebAuthn the page says so and its start button is off`);
  } else {
    await page.click("#go-world");
    await page.waitForSelector("#s-props:not([hidden])");
    check(/^[0-9a-f]{16}$/.test((await page.locator("#w-id").innerText()).trim()), `${tag}: a test world of its own is open`);
    const blocked = page.locator("article.prop.blocked");
    check((await blocked.innerText()).includes("Check: fail") && (await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) shows "Check: fail" and the rule that blocks it`);
    check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
    const locks = await blocked.locator(".lock").evaluateAll((ls: Element[]) => ls.map((l) => `${(l as HTMLElement).dataset.lock}${l.classList.contains("hit") ? "!" : ""} ${l.querySelector("a")?.getAttribute("href") ?? ""}`)) as string[];
    check(locks.length === 3 && /^purser! \/proof#stops$/.test(locks[0]!) && /^airwallex https:\/\/github\.com\/.+visa-tap-live-2026-11-02\.json$/.test(locks[1]!) && /^metal https:\/\/testnet\.metalntwx\.com\/tx\/0x2e92f9cb[0-9a-f]{52}1871$/.test(locks[2]!),
      `${tag}: (a) the three locks, Purser's policy marked, each with its real example's link`);
    const waiting = page.locator("article.prop.sheet");
    const shown = (await waiting.locator(".hash").getAttribute("data-hash")) ?? "";
    const canonical = await waiting.locator("details.terms pre").textContent() ?? "";
    // The hash WebKit computed on the device (crypto.subtle over the page's canonical JSON) is the one Node computes.
    check(/^[0-9a-f]{64}$/.test(shown) && shown === sha256(canonical), `${tag}: (b) the terms' hash computed in WebKit equals SHA-256 of the canonical terms (${shown.slice(0, 12)}…)`);
    check((await waiting.innerText()).includes("checked on this device") && await waiting.locator(".status.bad").count() === 0, `${tag}: (b) the page found its own hash equal to the server's`);
    check(await waiting.locator("button[data-sign]").isDisabled(), `${tag}: (b) cannot be signed before there is a passkey`);
    const terms = JSON.parse(canonical) as Record<string, string>;
    check((await waiting.innerText()).includes(String(terms.payee_iban).replace(/(.{4})/g, "$1 ").trim()) && /you are approving/i.test(await waiting.innerText()), `${tag}: (b) the approval sheet shows the beneficiary's IBAN`);
    check(await page.locator("#go-key").isVisible() && !(await page.locator("#go-key").isDisabled()), `${tag}: the passkey step is ready (not taken: WebKit has no virtual authenticator)`);
  }
  const wide = await page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)") as number;
  check(wide <= width, `${tag}: the page is no wider than the screen (${wide} ≤ ${width})`);
  check(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.screenshot({ path: join(shots, `${tag}.png`), fullPage: true });
  await context.close();
}

await browser.close();
local.server.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
