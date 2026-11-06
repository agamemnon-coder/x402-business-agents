// /try/sign in WebKit (Safari's engine), up to the passkey step (not part of npm test; needs Playwright's WebKit):
//   npx tsx test/browser/trysign-webkit.check.ts [screenshot dir]
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
// three locks with their links. CI runs it (.github/workflows/ci.yml, job webkit, in Playwright's image); there
// (Playwright's WebKit on Ubuntu, 6 Nov) the build has no PublicKeyCredential, so CI sees the fallback and the layout.
// Step 0, "Set the policy" (Max, item 1), runs in WebKit either way: a stricter change and a refused loosening need no
// passkey. Where the build has no WebAuthn, a second page defines bare PublicKeyCredential and navigator.credentials
// (empty, nothing behind them) before the page loads, only so its presence check lets "Start" open a world; nothing
// makes, uses or simulates a passkey (no button that would call them is pressed). The one step left out in WebKit is the signed loosening (it needs a passkey): it is
// skipped by name below and checked in Chromium with a virtual authenticator.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const shots = resolve(process.argv[2] ?? "out/try-sign-webkit");
mkdirSync(shots, { recursive: true });
process.env.TRY_SIGN_ENABLED = "on";
const { TRY_POLICY, TRY_SIGN_HOOK, TRY_SIGN_LABEL, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
const { startLocalRelay } = await import("../../src/relay/local.js");
const local = await startLocalRelay({ port: 0, token: "browser-check-webkit" });
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { webkit } = require("playwright") as { webkit: any };
const browser = await webkit.launch();

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Step 0 (Max, item 1) in WebKit, up to the signature: a stricter change holds at once and the three panels follow it;
// the result line lands below the sticky step bar; a looser one is refused with its terms to sign, their hash computed
// in WebKit, the refusal below the bar, and nothing changes. The signed loosening is the one step skipped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function policyStep(page: any, tag: string, errors: string[]): Promise<void> {
  // As above: only the console error Playwright's own screenshot stylesheet causes, during the screenshot, is set aside.
  const shot = async (path: string) => {
    const before = errors.length;
    await page.screenshot({ path });
    errors.splice(before, errors.length - before, ...errors.slice(before).filter((e) => !/^Refused to apply a stylesheet/.test(e)));
  };
  const belowBar = async (id: string) => {
    await page.waitForTimeout(1200); // the page's own smooth scroll settles
    return page.evaluate(`(() => ({ top: document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().top, bar: document.querySelector("ol.progress").getBoundingClientRect().bottom }))()`) as Promise<{ top: number; bar: number }>;
  };
  check(await page.locator("#policy").isVisible() && !(await page.locator("details#pol").evaluate((d: HTMLDetailsElement) => d.open)), `${tag}: step 0 "${TRY_POLICY.title}" is shown once the world is open, closed until asked`);
  await page.locator("details#pol > summary").click();
  const awxBefore = (await page.locator("#pl-awx").textContent()) ?? "";
  await page.fill("#pf-monthly", "40.00");
  await page.click("#p-apply");
  await page.waitForFunction(() => /^Stricter/.test(document.getElementById("p-status")?.textContent ?? ""));
  const awxAfter = (await page.locator("#pl-awx").textContent()) ?? "";
  check(/"amount": 50,/.test(awxBefore) && /"amount": 40,/.test(awxAfter) && (await page.locator('#pl-metal dd[data-value="40.00"]').count()) === 1 && (await page.locator("#pl-purser").textContent() ?? "").includes('"card.treasury.monthly": "40.00"')
    && (await page.locator("#p-locks").getAttribute("data-state")) === "in-force",
    `${tag}: step 0: a stricter month (50.00 → 40.00) holds at once; Purser's rule, the Airwallex body and the Metal budget follow it`);
  const res = await belowBar("p-status");
  check(res.top >= res.bar, `${tag}: step 0: after the change the result line is below the sticky step bar (its top ${Math.round(res.top)} px, bar bottom ${Math.round(res.bar)} px)`);
  await shot(join(shots, `${tag}-policy-stricter.png`));
  check(JSON.stringify(await page.locator("#p-locks .ns").allInnerTexts()) === JSON.stringify(["Rules in code, checked before anything is signed", TRY_POLICY.notSent.airwallex, TRY_POLICY.notSent.metal]), `${tag}: step 0: the Airwallex and Metal panels say they are not sent`);
  const purserBefore = (await page.locator("#pl-purser").textContent()) ?? "";
  const floorBefore = (await page.locator("#w-floor").innerText()).trim();
  await page.click(`input[name="pf-mccs"][value="7372"]`);
  await page.click("#p-apply");
  await page.waitForSelector("#p-refused:not([hidden])");
  const pterms = (await page.locator("#p-terms").textContent()) ?? "";
  check((await page.locator("#p-rhead").innerText()).trim() === TRY_POLICY.refused && /merchant categories/.test(await page.locator("#p-why").innerText()) && /Nothing changed\.$/.test((await page.locator("#p-why").innerText()).trim())
    && (await page.locator("#p-hash .hash").getAttribute("data-hash")) === sha256(pterms) && (await page.locator("#p-locks").getAttribute("data-state")) === "proposed",
    `${tag}: step 0: one more merchant category is looser: refused until signed, the terms' hash computed in WebKit`);
  const ref = await belowBar("p-refused");
  check(ref.top >= ref.bar, `${tag}: step 0: the refusal is below the sticky step bar (its top ${Math.round(ref.top)} px, bar bottom ${Math.round(ref.bar)} px)`);
  await shot(join(shots, `${tag}-policy-refused.png`));
  // Refused, so the policy in force is the one before: "Undo my edits" shows it again, unchanged; the world too.
  await page.click("#p-reset");
  check((await page.locator("#p-locks").getAttribute("data-state")) === "in-force" && ((await page.locator("#pl-purser").textContent()) ?? "") === purserBefore && (await page.locator("#p-ver").innerText()).trim() === "Policy v2"
    && (await page.locator("#w-floor").innerText()).trim() === floorBefore && await page.locator('article.prop.blocked[data-proposal="T-0001"]').count() === 1,
    `${tag}: step 0: after the refusal the policy in force is unchanged (v2, MCC 5734 only), T-0001 still blocked`);
  console.log(`skip  ${tag}: step 0: signing the looser policy (needs a passkey; WebKit here has no virtual authenticator; checked in Chromium)`);
}

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
  check((await page.locator("#go-world + #hook").innerText()).trim() === TRY_SIGN_HOOK, `${tag}: under the start button: "${TRY_SIGN_HOOK}"`);
  check(await page.locator("summary", { hasText: "What's real?" }).count() === 1 && await page.locator("footer details").count() === 0, `${tag}: one "What's real?" on the page`);
  const header = await page.evaluate(`getComputedStyle(document.querySelector("header.top")).backgroundColor`) as string;
  check(/^rgb\(/.test(header), `${tag}: the sticky header is opaque (${header})`);
  const band = await page.locator(".testband").boundingBox();
  check(!!band && band.y === 0 && band.height <= 44, `${tag}: the disclaimer is one line at the top (${band?.height} px high)`);
  await page.locator("details.wr > summary").click();
  const wr = await page.locator("details.wr").innerText();
  check([...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits, ...WHATS_REAL.sources].every((l) => wr.includes(l)), `${tag}: "What's real?" opens to its honest lines`);
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
    // Step 0 lives in a test world, so without one it stays hidden (and offers nothing to change).
    check(await page.locator("#policy").count() === 1 && await page.locator("#policy").isHidden(), `${tag}: step 0 "${TRY_POLICY.title}" waits for a test world (hidden)`);
    // Step 0 needs no passkey, so it is checked here too: a second page where WebAuthn's two names exist and nothing
    // more (no passkey is made, used or simulated), so "Start" opens a world.
    const p0 = await context.newPage();
    p0.on("pageerror", (e: Error) => errors.push(e.message));
    p0.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });
    // Bare names, nothing behind them: any call to make or use a passkey would throw (and none is made on this path).
    await p0.addInitScript(`
      if (!window.PublicKeyCredential) window.PublicKeyCredential = function PublicKeyCredential() {};
      if (!navigator.credentials) Object.defineProperty(navigator, "credentials", { value: Object.freeze({}), configurable: true });
    `);
    await p0.goto(`${local.url}/try/sign`);
    await p0.click("#go-world");
    await p0.waitForSelector("#s-props:not([hidden])");
    check(/^[0-9a-f]{16}$/.test((await p0.locator("#w-id").innerText()).trim()), `${tag}: step 0: a test world of its own is open`);
    await policyStep(p0, tag, errors);
    const wide0 = await p0.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)") as number;
    check(wide0 <= width, `${tag}: step 0: the page is no wider than the screen (${wide0} ≤ ${width})`);
    await p0.close();
  } else {
    await page.click("#go-world");
    await page.waitForSelector("#s-props:not([hidden])");
    check(/^[0-9a-f]{16}$/.test((await page.locator("#w-id").innerText()).trim()), `${tag}: a test world of its own is open`);
    const blocked = page.locator("article.prop.blocked");
    check((await blocked.innerText()).includes("Check: fail") && (await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) shows "Check: fail" and the rule that blocks it`);
    check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
    const locks = await blocked.locator(".lock").evaluateAll((ls: Element[]) => ls.map((l) => `${(l as HTMLElement).dataset.lock}${l.classList.contains("hit") ? "!" : ""} ${l.querySelector("a")?.getAttribute("href") ?? ""}`)) as string[];
    check(locks.length === 3 && /^purser! \/proof#airwallex$/.test(locks[0]!) && /^airwallex https:\/\/github\.com\/.+visa-tap-live-2026-11-02\.json$/.test(locks[1]!) && /^metal https:\/\/testnet\.metalntwx\.com\/tx\/0x2e92f9cb[0-9a-f]{52}1871$/.test(locks[2]!),
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
    await policyStep(page, tag, errors);
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
