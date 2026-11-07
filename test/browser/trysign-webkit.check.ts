// /try/sign in WebKit (Safari's engine), the whole story (not part of npm test; needs Playwright's WebKit):
//   npx tsx test/browser/trysign-webkit.check.ts [screenshot dir]
// Playwright's WebKit has no virtual authenticator, so this check injects a software passkey before the page loads
// (test/browser/support/softPasskey.ts, test only): a real ES256 key in WebCrypto, whose registrations and signatures
// the server checks for real, as it checks a phone's. With it, at 360, 390 and 1440 px, light and dark, the whole story
// runs in WebKit as an iPhone or a Mac visitor sees it: (1) the agent's request, the terms' hash computed in WebKit equal
// to the one computed here in Node; (2) signed and verified by the server; (3) one cent changed, refused; (4) a looser
// rule signed; (5) the next invoice paid alone. On every screen: at most 60 words in sight, exactly one main button,
// on the screen without scrolling; the page no wider than the screen; no console or CSP error. Then the full policy
// (#71) in WebKit: a stricter month holds at once, one more merchant category is refused until signed. And without any
// WebAuthn (no software passkey): the page says so, offers nothing to click and opens no test world.
// CI runs it (.github/workflows/ci.yml, job webkit, in Playwright's image).

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const shots = resolve(process.argv[2] ?? "out/try-sign-webkit");
mkdirSync(shots, { recursive: true });
process.env.TRY_SIGN_ENABLED = "on";
const { TRY_POLICY, TRY_SIGN_LABEL, TRY_SIGN_SCREENS: W, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
const { SOFT_PASSKEY } = await import("./support/softPasskey.js");
const { NEXT_INVOICE } = await import("../../worker/src/trySign.js");
const { startLocalRelay } = await import("../../src/relay/local.js");
const local = await startLocalRelay({ port: 0, token: "browser-check-webkit" });
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { webkit } = require("playwright") as { webkit: any };
const browser = await webkit.launch();

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const metrics: { tag: string; screen: number; words: number; primaries: number; primaryInView: boolean }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

/** Playwright's screenshot in WebKit adds a stylesheet of its own, which this page's CSP refuses: that console error is
 * the screenshot's, not the page's, so only it is set aside (the page's own errors are counted). */
async function shot(page: Page, errors: string[], path: string): Promise<void> {
  await page.waitForTimeout(350);
  const before = errors.length;
  await page.screenshot({ path });
  errors.splice(before, errors.length - before, ...errors.slice(before).filter((e) => !/^Refused to apply a stylesheet/.test(e)));
}
async function measure(page: Page, tag: string, n: number): Promise<void> {
  await page.evaluate("window.scrollTo(0, 0)");
  const m = await page.evaluate(`(() => {
    const scr = document.getElementById("scr-${n}");
    const words = scr.innerText.split(/\\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    const vis = (b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== "hidden" && !b.closest("[hidden]");
    const prim = [...document.querySelectorAll(".btn.primary")].filter(vis);
    const head = document.querySelector("header.top").getBoundingClientRect().bottom;
    const r = prim[0] ? prim[0].getBoundingClientRect() : null;
    return { words, primaries: prim.length, inView: !!r && r.top >= head && r.bottom <= innerHeight, label: prim.map((b) => b.textContent.trim()).join(" | ") };
  })()`) as { words: number; primaries: number; inView: boolean; label: string };
  metrics.push({ tag, screen: n, words: m.words, primaries: m.primaries, primaryInView: m.inView });
  check(m.words <= 60 && m.primaries === 1 && m.inView, `${tag} screen ${n}: ${m.words} words in sight (≤ 60), ${m.primaries} main button ("${m.label}"), on the screen without scrolling`);
}
const wide = async (page: Page, width: number) => (await page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)") as number) <= width;

let ip = 0;
async function visitor(width: number, scheme: "light" | "dark", soft = true) {
  const mobile = width < 600;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, extraHTTPHeaders: { "cf-connecting-ip": `198.51.150.${++ip}` } });
  const page = await context.newPage();
  if (soft) await page.addInitScript(SOFT_PASSKEY);
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });
  return { context, page, errors };
}

for (const [width, scheme] of [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"], [1440, "light"], [1440, "dark"]] as const) {
  const tag = `webkit-${width}-${scheme}`;
  const { context, page, errors } = await visitor(width, scheme);
  await page.goto(`${local.url}/try/sign`);
  check((await page.locator(".testband .tl").innerText()).trim() === TRY_SIGN_LABEL, `${tag}: the label at the top reads "${TRY_SIGN_LABEL}"`);
  await page.locator("details.wr > summary").click();
  const wr = await page.locator("details.wr").innerText();
  check([...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits, ...WHATS_REAL.sources].every((l) => wr.includes(l)) && await page.locator("footer details").count() === 0, `${tag}: one "What's real?", opening to its honest lines`);
  await page.locator("details.wr > summary").click();
  await page.waitForFunction(() => !(document.getElementById("go-sign") as HTMLButtonElement).disabled || document.getElementById("w-status")?.classList.contains("bad"));
  check(/^[0-9a-f]{16}$/.test(((await page.locator("#w-id").textContent()) ?? "").trim()), `${tag}: the test world opened when the page was shown`);
  // The opening (1.1): one sentence, one button; then screen 1.
  check((await page.locator("#s0-head").innerText()).trim() === W.intro.head, `${tag}: the opening: "${W.intro.head}"`);
  await measure(page, tag, 0);
  await page.click("#go-start");
  await page.waitForSelector("#scr-1:not([hidden])");
  check((await page.locator("#pg-count").innerText()).trim() === `1 of 6 · ${TRY_SIGN_STEPS[0]}` && (await page.locator("#s1-head").innerText()).trim() === W.ask.head, `${tag}: screen 1 of 6: "${W.ask.head}"`);
  // The terms' hash WebKit computed on the device (crypto.subtle over the canonical JSON) is the one Node computes.
  const canonical = (await page.locator("#s1-terms pre.terms").textContent()) ?? "";
  const shown = (await page.locator("#s1-terms .hash").getAttribute("data-hash")) ?? "";
  check(/^[0-9a-f]{64}$/.test(shown) && shown === sha256(canonical) && (await page.locator("#s1-terms-body").textContent() ?? "").includes("checked on this device"),
    `${tag}: the terms' hash computed in WebKit equals SHA-256 of the canonical terms (${shown.slice(0, 12)}…), checked against the server's`);
  await measure(page, tag, 1);
  await shot(page, errors, join(shots, `${tag}-1-ask.png`));
  await page.locator("#s1-other > summary").click();
  const locks = await page.locator("#s1-blocked .lock").evaluateAll((ls: Element[]) => ls.map((l) => `${(l as HTMLElement).dataset.lock}${l.classList.contains("hit") ? "!" : ""} ${l.querySelector("a")?.getAttribute("href") ?? ""}`)) as string[];
  check(locks.length === 3 && /^purser! \/proof#airwallex$/.test(locks[0]!) && /^airwallex https:\/\/github\.com\/.+visa-tap-live-2026-11-02\.json$/.test(locks[1]!) && /^metal https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}$/.test(locks[2]!)
    && await page.locator("#s1-blocked button").count() === 0, `${tag}: the payment a rule stopped: no button, three locks, Purser's marked, each with its real example's link`);
  await page.locator("#s1-other > summary").click();
  // Sign (the software passkey made, then the signature): the server verifies it.
  await page.click("#go-sign");
  await page.waitForSelector("#scr-2:not([hidden]), #s1-status.bad");
  check(await page.locator("#scr-2").isVisible() && (await page.locator("#r-head").innerText()).trim() === W.signed.head && /Test transfer test-[0-9a-f]{12}: EUR 1,850\.00/.test(await page.locator("#r-exec details.more").textContent() ?? ""),
    `${tag}: screen 2: "${W.signed.head}", verified by the server, run by the stand-in (${(await page.locator("#s1-status").innerText()).trim().slice(0, 60)})`);
  await measure(page, tag, 2);
  await shot(page, errors, join(shots, `${tag}-2-signed.png`));
  await page.click("#go-cheat");
  await page.waitForSelector("#tamper:not([hidden])");
  check((await page.locator("#t-verdict").innerText()).trim() === "One cent changed. The signature is worthless." && JSON.stringify(await page.locator("#t-table tr.chg").evaluateAll((rs: Element[]) => rs.map((r) => (r as HTMLElement).dataset.row))) === '["amount"]',
    `${tag}: screen 3: one cent changed, refused by the server with the same signature`);
  await page.click('#cheat-chips .chip[data-cheat="iban"]');
  await page.waitForFunction(() => document.querySelector("#t-table tr.chg")?.getAttribute("data-row") === "payee_iban" && /One field/.test(document.getElementById("t-verdict")?.textContent ?? ""));
  check((await page.locator("#t-verdict").innerText()).trim() === "One field changed. The signature is worthless.", `${tag}: another IBAN, refused`);
  await measure(page, tag, 3);
  await shot(page, errors, join(shots, `${tag}-3-cheat.png`));
  // Screen 4: try to trick the agent; each fake invoice blocked by Purser's code (1.3).
  await page.click("#go-trick");
  await page.waitForSelector("#scr-4:not([hidden])");
  for (const attack of ["pre_approved", "lookalike"]) {
    await page.click(`#trick-chips .chip[data-attack="${attack}"]`);
    await page.waitForFunction((a: string) => !document.getElementById("k-result")!.hidden && (document.getElementById("k-doc")!.textContent ?? "").includes(a === "lookalike" ? "Pakaging" : "Pre-approved"), attack);
    check(/^Blocked: /.test((await page.locator("#k-out").innerText()).trim()) && (await page.locator("#k-lesson").innerText()).trim() === "A prompt is not a control.", `${tag}: screen 4: the ${attack} invoice is blocked by Purser's code`);
  }
  await measure(page, tag, 4);
  await shot(page, errors, join(shots, `${tag}-4-trick.png`));
  await page.click("#go-rule");
  await page.waitForSelector("#scr-5:not([hidden])");
  await page.click('#rule-chips .chip[data-alone="2000.00"]');
  check((await page.locator("#s4-note").innerText()).trim() === W.rule.looser && (await page.locator("#go-apply").innerText()).trim() === W.rule.sign && /\(\+€[\d,]+\)$/.test((await page.locator("#s4-worst").innerText()).trim()), `${tag}: screen 5: €2,000 is looser, "${W.rule.sign}", and what it adds a month`);
  await measure(page, tag, 5);
  await shot(page, errors, join(shots, `${tag}-5-rule.png`));
  await page.click("#go-apply");
  await page.waitForSelector("#scr-6:not([hidden]), #s4-status.bad");
  check(await page.locator("#scr-6").isVisible() && await page.locator("#s5-next").getAttribute("data-state") === "alone" && await page.locator("#s5-next").getAttribute("data-proposal") === NEXT_INVOICE.id,
    `${tag}: screen 6: the rule signed, the next invoice (${NEXT_INVOICE.id}) paid alone (${(await page.locator("#s4-status").innerText()).trim().slice(0, 60)})`);
  check(await page.evaluate("window.__softPasskeyCount()") === 3, `${tag}: three uses of the passkey: made, the payment, the rule; none for the invoice paid alone`);
  await measure(page, tag, 6);
  await shot(page, errors, join(shots, `${tag}-6-paid-alone.png`));
  await page.click("#go-done");
  await page.waitForSelector("#scr-7:not([hidden])");
  check((await page.locator("#d-head").innerText()).trim() === W.done.head, `${tag}: the closing card: "${W.done.head}"`);
  await measure(page, tag, 7);
  await shot(page, errors, join(shots, `${tag}-7-done.png`));
  check(await wide(page, width), `${tag}: the page is no wider than the screen`);
  check(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await context.close();
}

// The full policy (#71) in WebKit, behind "Show all fields and what Purser sends": a stricter month holds at once and the
// panels follow; one more merchant category is looser, refused until signed, its terms' hash computed in WebKit.
{
  const tag = "webkit-policy-390";
  const { context, page, errors } = await visitor(390, "light");
  await page.goto(`${local.url}/try/sign`);
  await page.waitForFunction(() => !(document.getElementById("go-sign") as HTMLButtonElement).disabled);
  await page.click("#go-start"); await page.waitForSelector("#scr-1:not([hidden])");
  await page.click("#go-sign"); await page.waitForSelector("#scr-2:not([hidden])");
  await page.click("#go-cheat"); await page.waitForSelector("#tamper:not([hidden])");
  await page.click("#go-trick"); await page.waitForSelector("#scr-4:not([hidden])");
  await page.click("#go-rule"); await page.waitForSelector("#scr-5:not([hidden])");
  check((await page.locator("#p-open").innerText()).trim() === TRY_POLICY.open && await page.locator("#p-body").isHidden(), `${tag}: every field behind "${TRY_POLICY.open}", closed until asked`);
  await page.locator("#p-open").click();
  const awxBefore = (await page.locator("#pl-awx").textContent()) ?? "";
  await page.fill("#pf-monthly", "40.00");
  await page.click("#p-apply");
  await page.waitForFunction(() => /^Stricter/.test(document.getElementById("p-status")?.textContent ?? ""));
  const awxAfter = (await page.locator("#pl-awx").textContent()) ?? "";
  check(/"amount": 50,/.test(awxBefore) && /"amount": 40,/.test(awxAfter) && (await page.locator('#pl-metal dd[data-value="40.00"]').count()) === 1 && ((await page.locator("#pl-purser").textContent()) ?? "").includes('"card.treasury.monthly": "40.00"')
    && (await page.locator("#p-locks").getAttribute("data-state")) === "in-force", `${tag}: a stricter month (50.00 → 40.00) holds at once; Purser's rule, the Airwallex body and the Metal budget follow it`);
  check(JSON.stringify(await page.locator("#p-locks .ns").allInnerTexts()) === JSON.stringify(["Rules in code, checked before anything is signed", TRY_POLICY.notSent.airwallex, TRY_POLICY.notSent.metal]), `${tag}: the Airwallex and Metal panels say they are not sent`);
  await shot(page, errors, join(shots, `${tag}-stricter.png`));
  const purserBefore = (await page.locator("#pl-purser").textContent()) ?? "";
  await page.click(`input[name="pf-mccs"][value="7372"]`);
  await page.click("#p-apply");
  await page.waitForSelector("#p-refused:not([hidden])");
  const pterms = (await page.locator("#p-terms").textContent()) ?? "";
  check((await page.locator("#p-rhead").innerText()).trim() === TRY_POLICY.refused && /merchant categories/.test(await page.locator("#p-why").innerText()) && /Nothing changed\.$/.test((await page.locator("#p-why").innerText()).trim())
    && (await page.locator("#p-hash .hash").getAttribute("data-hash")) === sha256(pterms) && (await page.locator("#p-locks").getAttribute("data-state")) === "proposed",
    `${tag}: one more merchant category is looser: refused until signed, the terms' hash computed in WebKit`);
  await shot(page, errors, join(shots, `${tag}-refused.png`));
  await page.click("#p-reset");
  check((await page.locator("#p-locks").getAttribute("data-state")) === "in-force" && ((await page.locator("#pl-purser").textContent()) ?? "") === purserBefore && (await page.locator("#p-ver").innerText()).trim() === "Policy v2",
    `${tag}: after the refusal the policy in force is unchanged (v2, MCC 5734 only)`);
  check(await wide(page, 390) && errors.length === 0, `${tag}: no wider than the screen, no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await context.close();
}

// Without any WebAuthn (no software passkey, as in Playwright's WebKit build on CI): the page says so and opens no world.
{
  const tag = "webkit-no-webauthn-390";
  const { context, page, errors } = await visitor(390, "light", false);
  const worlds: string[] = [];
  page.on("request", (q: { url(): string; method(): string }) => { if (q.method() === "POST") worlds.push(q.url()); });
  await page.goto(`${local.url}/try/sign`);
  const has = await page.evaluate("Boolean(window.PublicKeyCredential && navigator.credentials)") as boolean;
  console.log(`info  ${tag}: this WebKit build ${has ? "has" : "has no"} WebAuthn of its own`);
  if (!has) {
    await page.waitForTimeout(800);
    check(/has no passkeys/.test(await page.locator("#w-status").innerText()) && await page.locator("#go-sign").isDisabled() && worlds.length === 0,
      `${tag}: without WebAuthn the page says so, its button is off, and no test world is opened (${worlds.length} requests)`);
    await shot(page, errors, join(shots, `${tag}.png`));
  }
  check(errors.length === 0, `${tag}: no console or CSP errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await context.close();
}

writeFileSync(join(shots, "metrics-webkit.json"), `${JSON.stringify(metrics, null, 2)}\n`);
await browser.close();
local.server.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
