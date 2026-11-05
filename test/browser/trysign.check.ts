// Browser check of /try/sign (not part of npm test; needs Playwright with Chromium from the environment):
//   npx tsx test/browser/trysign.check.ts [screenshot dir]
//   npx tsx test/browser/trysign.check.ts --live [base URL] [screenshot dir]
// By default a local relay built with TRY_SIGN_ENABLED=on serves the page. With --live, the same visit runs against the
// deployed relay (default https://kit11.max-31b.workers.dev; only once Max has deployed it with the flag on), at 390 px
// light and 1440 px dark only (two test worlds, to stay well inside the relay's limits), screenshots in
// out/try-sign-live unless a directory is given. Chromium's virtual authenticator (WebAuthn over CDP,
// user verification on) plays the visitor's Face ID. At 360, 390 and 1440 px, light and dark (six test worlds, the
// relay's limit per address an hour), it goes through the whole visit: start a test world, create a test passkey, see
// (a) blocked by a rule with no button, sign (b), see the server verify it and the stand-in execute it, then tamper
// (amount + 0.01) and see the same signature refused. After the passkey, after signing and after the tamper, the layout
// is checked (Max, 5 Nov: on an iPhone at 390 px the hashes and the tamper line ran off the screen): the page is no
// wider than the screen, and nothing inside a card (no element, no line of text) runs outside that card's box, with
// 1 px tolerance. CI runs it (.github/workflows/ci.yml, job judge). A test world only: nothing here reaches the runner,
// Airwallex or Metal.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const LIVE_BASE = "https://kit11.max-31b.workers.dev";

/** The command line: --live [https URL] [screenshot dir], or [screenshot dir] for the local relay. */
function parseArgs(argv: string[]): { live: boolean; base: string | null; shots: string } {
  const at = argv.indexOf("--live");
  if (at < 0) return { live: false, base: null, shots: argv[0] ?? "docs/try-sign" };
  const rest = argv.filter((_, i) => i !== at);
  const url = rest.find((a) => /^https?:\/\//.test(a));
  const base = (url ?? LIVE_BASE).replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new Error(`--live needs an https URL, not ${base}`);
  return { live: true, base, shots: rest.find((a) => a !== url) ?? "out/try-sign-live" };
}

const args = parseArgs(process.argv.slice(2));
const { TRY_SIGN_LABEL } = await import("../../src/try/sign.js");
const shots = resolve(args.shots);
mkdirSync(shots, { recursive: true });
// Local: a relay of our own with the flag on. Live: the deployed relay, as a visitor reaches it.
let local: { server: { close(): void } | null; url: string };
if (args.base) {
  const probe = await fetch(`${args.base}/try/sign`, { redirect: "manual" });
  if (probe.status !== 200) {
    console.log(`STOP  ${args.base}/try/sign answers ${probe.status}: not deployed with TRY_SIGN_ENABLED on yet; nothing checked`);
    process.exit(2);
  }
  local = { server: null, url: args.base };
} else {
  process.env.TRY_SIGN_ENABLED = "on";
  const { startLocalRelay } = await import("../../src/relay/local.js");
  local = await startLocalRelay({ port: 0, token: "browser-check" });
}
const require = createRequire(import.meta.url);
// Playwright is not a dependency of this repo; it comes with the environment (Chromium pre-installed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };

/** The layout at this moment: how wide the page is, and every element or line of text that runs outside its card. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function layout(page: any, tag: string, stage: string, width: number): Promise<void> {
  // A string, as in pages.check.ts: tsx would wrap named functions in a helper the page does not have.
  const r = await page.evaluate(`(() => {
    const out = [];
    const name = (n) => {
      const e = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
      const what = e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.classList.length ? "." + [...e.classList].join(".") : "");
      return n.nodeType === Node.TEXT_NODE ? 'text "' + (n.textContent || "").trim().slice(0, 24) + '…" in ' + what : what;
    };
    let cards = 0;
    for (const card of document.querySelectorAll(".card")) {
      if (card.getClientRects().length === 0) continue; // hidden
      cards++;
      const c = card.getBoundingClientRect();
      const walk = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        // Not rendered (display: none, the inside of a closed <details>): nothing of it shows, so nothing of it runs out.
        if (!(n.nodeType === Node.TEXT_NODE ? n.parentElement : n).checkVisibility()) continue;
        let boxes;
        if (n.nodeType === Node.TEXT_NODE) {
          if (!(n.textContent || "").trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          boxes = [...range.getClientRects()];
        } else boxes = [n.getBoundingClientRect()];
        for (const b of boxes) {
          if (b.width === 0 && b.height === 0) continue; // an empty box
          if (b.left < c.left - 1 || b.right > c.right + 1 || b.top < c.top - 1 || b.bottom > c.bottom + 1) {
            out.push(name(n) + " [" + Math.round(b.left) + ".." + Math.round(b.right) + "] outside " + name(card) + " [" + Math.round(c.left) + ".." + Math.round(c.right) + "]");
            break;
          }
        }
      }
    }
    return { doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: window.innerWidth, cards, out };
  })()`) as { doc: number; body: number; inner: number; cards: number; out: string[] };
  const widest = Math.max(r.doc, r.body);
  check(widest <= r.inner && r.inner === width, `${tag} ${stage}: the page is no wider than the screen (scrollWidth ${r.doc}, body ${r.body}, innerWidth ${r.inner}, screen ${width})`);
  check(r.cards > 0 && r.out.length === 0, `${tag} ${stage}: nothing runs outside its card (${r.cards} cards${r.out.length ? `; ${r.out.length} outside: ${r.out.slice(0, 4).join("; ")}${r.out.length > 4 ? "; …" : ""}` : ""})`);
}

/** A screenshot of the screen as the visitor sees it, scrolled so this element is near the top. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shotAt(page: any, selector: string, path: string): Promise<void> {
  await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 84, behavior: "instant" }); })()`);
  await page.waitForTimeout(800); // the page's own smooth scroll to the result, and the copy button's state, settle
  await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 84, behavior: "instant" }); })()`);
  await page.screenshot({ path });
}

const RUNS: [number, "light" | "dark"][] = args.live ? [[390, "light"], [1440, "dark"]]
  : [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"], [1440, "light"], [1440, "dark"]];
for (const [width, scheme] of RUNS) {
  const tag = `${args.live ? "live-" : ""}${width}-${scheme}`;
  const mobile = width < 600;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
  // The Copy button writes the whole hash to the clipboard; the check reads it back.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: local.url });
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
  check(!(await page.locator("#w-facts").isVisible()), `${tag}: the world's facts stay hidden until there is a world`);
  await page.screenshot({ path: join(shots, `${tag}-1-start.png`) });

  await page.click("#go-world");
  await page.waitForSelector("#s-props:not([hidden])");
  const blocked = page.locator("article.prop", { hasText: "T-0001" });
  check((await blocked.innerText()).includes("Check: fail"), `${tag}: (a) shows "Check: fail" and its rule`);
  check((await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) names the blocking rule`);
  check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
  const waiting = page.locator("article.prop", { hasText: "T-0002" });
  const hash = (await waiting.locator(".hash").getAttribute("data-hash")) ?? "";
  check(/^[0-9a-f]{64}$/.test(hash), `${tag}: (b) shows its terms' hash, checked on the device`);
  const short = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;
  check((await waiting.locator(".hash code").innerText()).trim() === short(hash) && await waiting.locator(".hash code").getAttribute("title") === hash,
    `${tag}: (b) the hash is shown shortened, first 12 and last 8 (${short(hash)}), the whole of it on hover`);
  check(await waiting.locator("button[data-sign]").isDisabled(), `${tag}: (b) cannot be signed before there is a passkey`);

  await page.click("#go-key");
  await page.waitForFunction(() => document.getElementById("k-status")?.classList.contains("ok") || document.getElementById("k-status")?.classList.contains("bad"));
  check((await page.locator("#k-status").getAttribute("class"))!.includes("ok"), `${tag}: the test passkey is made and registered (${(await page.locator("#k-status").innerText()).slice(0, 60)}…)`);
  await shotAt(page, "#s-key", join(shots, `${tag}-2-passkey-made.png`));
  await layout(page, tag, "with the passkey made", width);

  await waiting.locator("button[data-sign]").click();
  await page.waitForSelector("#result:not([hidden])");
  check(await page.locator("#r-hash .hash").getAttribute("data-hash") === hash && (await page.locator("#r-hash code").innerText()).trim() === short(hash), `${tag}: the result shows the signed hash, shortened`);
  await page.locator("#r-hash button.copy").click();
  await page.waitForFunction(() => /Copied|Select/.test(document.querySelector("#r-hash button.copy")?.textContent ?? ""));
  const copied = await page.evaluate("navigator.clipboard.readText()") as string;
  check(copied === hash && (await page.locator("#r-hash button.copy").innerText()).includes("Copied"), `${tag}: Copy puts the whole signed hash on the clipboard (${copied.length} characters)`);
  check((await page.locator("#result").innerText()).includes("Verified by the server"), `${tag}: "Verified by the server"`);
  check(/Test transfer test-[0-9a-f]{12}: EUR 1,850\.00/.test(await page.locator("#r-exec").innerText()), `${tag}: "Executed in your test world" by the stand-in`);
  await shotAt(page, "#result", join(shots, `${tag}-3-signed-verified.png`));
  await layout(page, tag, "after signing", width);

  const beforeTamper = errors.length;
  await page.click("#go-tamper");
  await page.waitForSelector("#tamper:not([hidden])");
  const head = await page.locator("#t-head").innerText();
  const why = await page.locator("#t-why").innerText();
  check(head.startsWith("Refused") && /challenge|signature was made for hash/.test(why), `${tag}: the same signature on the amount + 0.01 is refused (${why.slice(0, 70)}…)`);
  check((await page.locator("#t-what").innerText()).includes("EUR 1,850.01"), `${tag}: the tampered amount is shown`);
  const changed = (await page.locator("#t-what .hash").getAttribute("data-hash")) ?? "";
  check(/^[0-9a-f]{64}$/.test(changed) && changed !== hash && (await page.locator("#t-what code").innerText()).trim() === short(changed),
    `${tag}: the changed terms' hash is shown shortened, with Copy (${short(changed)})`);
  check(await page.locator("#t-why .hash").getAttribute("data-hash") === hash && (await page.locator("#t-why code").innerText()).trim() === short(hash),
    `${tag}: the refusal shows the hash the signature was made for, shortened, with Copy (${short(hash)})`);
  // On a phone the tamper and its refusal fill the screen; on a laptop the whole result card fits.
  await shotAt(page, mobile ? "#go-tamper" : "#result", join(shots, `${tag}-4-tamper-refused.png`));
  await layout(page, tag, "after the tamper", width);
  // The terms, opened: the canonical JSON is one long line of text.
  await page.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
  await layout(page, tag, "with all terms open", width);
  // The one error expected: the browser logs the tamper's refusal (HTTP 400) as a failed request.
  const unexpected = errors.filter((e, i) => !(i >= beforeTamper && /status of 400/.test(e)));
  check(unexpected.length === 0 && errors.length - beforeTamper === 1, `${tag}: no console or CSP errors besides the refused tamper${unexpected.length ? `: ${unexpected.join(" | ")}` : ""}`);
  await context.close();
}

await browser.close();
local.server?.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
