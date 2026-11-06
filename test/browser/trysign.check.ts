// Browser check of /try/sign (not part of npm test; needs Playwright with Chromium from the environment):
//   npx tsx test/browser/trysign.check.ts [screenshot dir]
//   npx tsx test/browser/trysign.check.ts --live [base URL] [screenshot dir]
// By default a local relay built with TRY_SIGN_ENABLED=on serves the page. With --live, the same visit runs against the
// deployed relay (default https://kit11.max-31b.workers.dev; only once Max has deployed it with the flag on), at 390 px
// light and 1440 px dark only (two test worlds, to stay well inside the relay's limits), screenshots in
// out/try-sign-live unless a directory is given. Chromium's virtual authenticator (WebAuthn over CDP,
// user verification on) plays the visitor's Face ID. At 360, 390 and 1440 px, light and dark (six test worlds, the
// relay's limit per address an hour), it goes through the whole visit in its three steps (6 Nov: the progress indicator
// moves 1 → 2 → 3, the start button is above the fold): start a test world, see the waiting proposal as the CFO's
// approval sheet (amount, beneficiary, IBAN, reference, the terms hash short with Copy and tap-to-expand, all terms),
// see (a) blocked by a rule with no button and the three locks, the one that stopped it marked, each linking its real
// example from the records; create a test passkey, sign (b), see the server verify it and the stand-in execute it, then
// tamper field by field (the amount + 0.01, the IBAN, the currency), each time seeing which field changed, the new hash
// next to the signed one, and the server refusing the same signature. The receipt downloads as receipt.json and
// verifies offline (src/try/receipt.ts, as npm run verify-receipt); with one cent more it fails. "What's real?" opens
// to the honest lines. After
// the passkey, after signing and after the tamper, the layout
// is checked (Max, 5 Nov: on an iPhone at 390 px the hashes and the tamper line ran off the screen): the page is no
// wider than the screen, and nothing inside a card (no element, no line of text) runs outside that card's box, with
// 1 px tolerance. CI runs it (.github/workflows/ci.yml, job judge). A test world only: nothing here reaches the runner,
// Airwallex or Metal.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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
const { TRY_SIGN_LABEL, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
const { cfoApproval, tryLocks } = await import("../../src/try/examples.js");
const { letThroughOf, loadRecord } = await import("../../src/redesign/run.js");
const { canonical } = await import("../../worker/src/trySign.js");
const { verifyReceipt } = await import("../../src/try/receipt.js");
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
// The examples the page must link, from the records themselves (not from the page's code).
const LOCKS = tryLocks();
const METAL_TX = letThroughOf(loadRecord().record)?.tx ?? "";
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

/** A screenshot of the screen as the visitor sees it, scrolled so this element is near the top (below the header and the steps). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shotAt(page: any, selector: string, path: string): Promise<void> {
  await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 150, behavior: "instant" }); })()`);
  await page.waitForTimeout(800); // the page's own smooth scroll to the result, and the copy button's state, settle
  await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 150, behavior: "instant" }); })()`);
  await page.screenshot({ path });
}

const RUNS: [number, "light" | "dark"][] = args.live ? [[390, "light"], [1440, "dark"]]
  : [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"], [1440, "light"], [1440, "dark"]];
for (const [width, scheme] of RUNS) {
  const tag = `${args.live ? "live-" : ""}${width}-${scheme}`;
  const mobile = width < 600;
  const height = mobile ? 844 : 900;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
  // The Copy button writes the whole hash to the clipboard; the check reads it back.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: local.url });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });
  const steps = async () => (await page.locator("ol.progress li").evaluateAll((ls: Element[]) => ls.map((l) => (l.classList.contains("done") ? "done" : l.classList.contains("on") ? "on" : "-")))) as string[];

  // The landing carries the button in this bundle, and it leads here.
  await page.goto(`${local.url}/home`);
  const button = page.locator('a[href="try/sign"]');
  check(await button.count() === 1, `${tag}: the landing has the "Sign with your own Face ID" button`);
  await button.click();
  await page.waitForURL(`${local.url}/try/sign`);
  check((await page.locator(".testband").innerText()).trim() === TRY_SIGN_LABEL, `${tag}: the label at the top reads "${TRY_SIGN_LABEL}"`);
  const band = await page.locator(".testband").boundingBox();
  check(!!band && band.y === 0, `${tag}: the label is the first thing on the page`);
  // One line of disclaimer (from 390 px; at 360 px it may wrap), then "What's real?", closed until asked.
  if (width >= 390) check(!!band && band.height <= 44, `${tag}: the disclaimer is one line (${band?.height} px high)`);
  check(!(await page.locator("details.wr").evaluate((d: HTMLDetailsElement) => d.open)), `${tag}: "What's real?" is closed until asked`);
  await page.locator("details.wr > summary").click();
  const wr = await page.locator("details.wr").innerText();
  check([...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits].every((l) => wr.includes(l)) && /no Airwallex or Metal call/.test(wr) && /no Claude call/.test(wr),
    `${tag}: "What's real?" opens to the honest lines (test world, stand-in executor, no Airwallex, Metal or Claude call; the signature and its check real)`);
  await page.locator("details.wr > summary").click();
  // The three steps, and the start button above the fold.
  check(JSON.stringify((await page.locator("ol.progress li .t").allInnerTexts()).map((t: string) => t.trim())) === JSON.stringify(TRY_SIGN_STEPS), `${tag}: three steps: ${TRY_SIGN_STEPS.join(" → ")}`);
  check(JSON.stringify(await steps()) === '["on","-","-"]' && await page.locator("#pg-1").getAttribute("aria-current") === "step", `${tag}: step 1 is under way`);
  const go = await page.locator("#go-world").boundingBox();
  check(!!go && go.y + go.height <= height, `${tag}: the start button is above the fold (its bottom at ${go ? Math.round(go.y + go.height) : "?"} of ${height} px)`);
  check(!(await page.locator("#w-facts").isVisible()), `${tag}: the world's facts stay hidden until there is a world`);
  await page.screenshot({ path: join(shots, `${tag}-1-start.png`) });

  // Six requests a visit (world, passkey, signature, three tampers) and six visits: the relay's 30 a minute per address
  // (TRY_SIGN_PER_MINUTE) can answer 429 to the last ones; then the check waits out the minute, as a visitor would.
  for (let attempt = 0; ; attempt++) {
    await page.click("#go-world");
    await page.waitForFunction(() => !document.getElementById("s-props")?.hidden || document.getElementById("w-status")?.classList.contains("bad"));
    if (!(await page.locator("#s-props").isHidden())) break;
    const said = await page.locator("#w-status").innerText();
    if (attempt > 0 || !/a minute/.test(said)) throw new Error(`${tag}: no test world: ${said}`);
    console.log(`info  ${tag}: the relay asks to wait a minute (${said}); waiting`);
    await page.waitForTimeout(61_000);
  }
  // The refused attempt's 429 is the browser's console error, not the page's.
  errors.splice(0, errors.length, ...errors.filter((e) => !/status of 429/.test(e)));
  check(JSON.stringify(await steps()) === '["done","on","-"]', `${tag}: after the proposal, step 1 is done and step 2 under way`);

  // (b): the approval sheet, as the CFO's.
  const waiting = page.locator("article.prop.sheet");
  const terms = JSON.parse((await waiting.locator("details.terms pre").textContent()) ?? "{}") as Record<string, string>;
  const sheetText = await waiting.innerText();
  const facts = Object.fromEntries((await waiting.locator("dl.facts").evaluate((d: Element) => [...d.querySelectorAll("dt")].map((t) => [t.textContent, t.nextElementSibling?.textContent])))) as Record<string, string>;
  const iban = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();
  check(/You are approving · T-0002/i.test(sheetText) && (await waiting.locator(".title").innerText()).includes(`Pay ${terms.payee} EUR 1,850.00`), `${tag}: (b) is the approval sheet: "You are approving", "Pay ${terms.payee} EUR 1,850.00"`);
  check(facts.Amount === "EUR 1,850.00" && facts.Beneficiary === terms.payee && facts.IBAN === iban(terms.payee_iban ?? "") && facts.Reference === terms.reference && facts.Proposal === "T-0002" && /^in \d+ min/.test(facts.Expires ?? ""),
    `${tag}: (b) the sheet's exact terms: amount, beneficiary, IBAN ${facts.IBAN}, reference, proposal, expiry`);
  const hash = (await waiting.locator(".hash").getAttribute("data-hash")) ?? "";
  check(/^[0-9a-f]{64}$/.test(hash) && hash === sha256(canonical(terms)), `${tag}: (b) shows its terms' hash, checked on the device and here`);
  const short = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;
  check((await waiting.locator(".hash code").innerText()).trim() === short(hash) && await waiting.locator(".hash code").getAttribute("title") === hash,
    `${tag}: (b) the hash is shown shortened, first 12 and last 8 (${short(hash)}), the whole of it on hover`);
  await waiting.locator(".hash button.exp").click();
  check((await waiting.locator(".hash code").innerText()).trim() === hash && await waiting.locator(".hash button.exp").getAttribute("aria-expanded") === "true", `${tag}: (b) a tap on the hash shows all 64 characters`);
  await waiting.locator(".hash button.exp").click();
  check((await waiting.locator(".basis").innerText()).trim() === cfoApproval().line, `${tag}: (b) names the CFO's real sheet it follows, from the record: ${cfoApproval().line.slice(0, 60)}…`);
  check(await waiting.locator("button[data-sign]").isDisabled(), `${tag}: (b) cannot be signed before there is a passkey`);
  await shotAt(page, "article.prop.sheet", join(shots, `${tag}-2-sheet.png`));

  // (a): blocked, nothing to sign, and the three locks.
  const blocked = page.locator("article.prop.blocked");
  check((await blocked.innerText()).includes("T-0001") && (await blocked.innerText()).includes("Check: fail"), `${tag}: (a) shows "Check: fail" and its rule`);
  check((await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) names the blocking rule`);
  check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
  const locks = await blocked.locator(".lock").evaluateAll((ls: Element[]) => ls.map((l) => ({ id: (l as HTMLElement).dataset.lock, hit: l.classList.contains("hit"), text: l.textContent ?? "", href: l.querySelector("a")?.getAttribute("href") ?? "" }))) as { id: string; hit: boolean; text: string; href: string }[];
  check(locks.map((l) => l.id).join() === "purser,airwallex,metal" && locks.filter((l) => l.hit).map((l) => l.id).join() === "purser" && /Stopped this one \(simulated\)/.test(locks[0]!.text),
    `${tag}: (a) three locks, Purser's policy marked as the one that stopped it (simulated)`);
  check(locks.every((l, i) => l.text.includes(LOCKS[i]!.example) && l.text.includes(`Real example · ${LOCKS[i]!.run}`)), `${tag}: (a) each lock names its real example and the run it is from`);
  check(locks[0]!.href === "/proof#stops", `${tag}: (a) Purser's policy links the main run's stops on Proof`);
  check(locks[1]!.href.endsWith("/blob/main/docs/runs/visa-tap-live-2026-11-02.json") && /EUR 45\.00/.test(locks[1]!.text) && /LIMIT_EXCEEDED/.test(locks[1]!.text) && /Separate TAP run, 2 Nov/.test(locks[1]!.text),
    `${tag}: (a) Airwallex's card limit links the separate TAP run of 2 November (EUR 45.00, LIMIT_EXCEEDED)`);
  check(/^0x[0-9a-f]{64}$/.test(METAL_TX) && locks[2]!.href === `https://testnet.metalntwx.com/tx/${METAL_TX}`, `${tag}: (a) Metal's mandate links the on-chain refusal on Metal's explorer (${METAL_TX.slice(0, 10)}…${METAL_TX.slice(-4)})`);
  check(/simulation in your test world; the examples are real/.test(await blocked.innerText()), `${tag}: (a) says the blocked payment is simulated and the examples real`);
  await shotAt(page, "article.prop.blocked .locks", join(shots, `${tag}-3-locks.png`));

  await page.click("#go-key");
  await page.waitForFunction(() => document.getElementById("k-status")?.classList.contains("ok") || document.getElementById("k-status")?.classList.contains("bad"));
  check((await page.locator("#k-status").getAttribute("class"))!.includes("ok"), `${tag}: the test passkey is made and registered (${(await page.locator("#k-status").innerText()).slice(0, 60)}…)`);
  await layout(page, tag, "with the passkey made", width);

  await waiting.locator("button[data-sign]").click();
  await page.waitForSelector("#result:not([hidden])");
  check(JSON.stringify(await steps()) === '["done","done","done"]', `${tag}: verified: all three steps done`);
  check(await page.locator("#r-hash .hash").getAttribute("data-hash") === hash && (await page.locator("#r-hash code").innerText()).trim() === short(hash), `${tag}: the result shows the signed hash, shortened`);
  await page.locator("#r-hash button.copy").click();
  await page.waitForFunction(() => /Copied|Select/.test(document.querySelector("#r-hash button.copy")?.textContent ?? ""));
  const copied = await page.evaluate("navigator.clipboard.readText()") as string;
  check(copied === hash && (await page.locator("#r-hash button.copy").innerText()).includes("Copied"), `${tag}: Copy puts the whole signed hash on the clipboard (${copied.length} characters)`);
  check((await page.locator("#result").innerText()).includes("Verified by the server"), `${tag}: "Verified by the server"`);
  check(/Test transfer test-[0-9a-f]{12}: EUR 1,850\.00/.test(await page.locator("#r-exec").innerText()), `${tag}: "Executed in your test world" by the stand-in`);
  // The receipt: downloaded as the visitor would, then checked offline as npm run verify-receipt does.
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#r-receipt")]);
  const saved = join(shots, `${tag}-receipt.json`);
  await download.saveAs(saved);
  const receipt = JSON.parse(readFileSync(saved, "utf8")) as { terms: Record<string, string>; terms_sha256: string; public_key: { x: string } };
  const verdict = verifyReceipt(receipt);
  check(download.suggestedFilename() === "receipt.json" && verdict.ok && receipt.terms_sha256 === hash && JSON.stringify(receipt.terms) === JSON.stringify(terms),
    `${tag}: receipt.json downloads and verifies offline (${verdict.checks.filter((c) => c.ok).length} of ${verdict.checks.length} checks)`);
  check(!verifyReceipt({ ...receipt, terms: { ...receipt.terms, amount: "1850.01" } }).ok && !verifyReceipt({ ...receipt, terms: { ...receipt.terms, payee_iban: "DE00000000000000000666" } }).ok,
    `${tag}: the receipt with one cent more, or another IBAN, fails`);
  check(!/"token"/.test(readFileSync(saved, "utf8")) && Object.keys(receipt).sort().join() === "algorithm,assertion,credential_id,note,origin,public_key,receipt,rp_id,terms,terms_sha256,verified_by_server_at,verify",
    `${tag}: the receipt carries what it needs and no world token`);
  await shotAt(page, "#result", join(shots, `${tag}-4-signed-verified.png`));
  await layout(page, tag, "after signing", width);

  // Tamper, field by field: the visitor's own edit, sent with the same signature, refused by the server.
  check(await page.locator("#t-send").isDisabled(), `${tag}: nothing to send until a field is changed`);
  const beforeTamper = errors.length;
  const tampers: [string, string, () => Promise<void>, string][] = [
    ["amount", "1850.01", async () => { await page.click("#go-tamper"); }, "EUR 1,850.01"],
    ["payee_iban", "DE00000000000000000666", async () => { await page.fill("#t-amount", terms.amount!); await page.fill("#t-iban", "de00 0000 0000 0000 0006 66"); await page.click("#t-send"); }, "DE00 0000 0000 0000 0006 66"],
    ["currency", "USD", async () => { await page.fill("#t-iban", iban(terms.payee_iban!)); await page.selectOption("#t-currency", "USD"); await page.click("#t-send"); }, "USD"],
  ];
  for (const [field, value, act, shown] of tampers) {
    await page.evaluate(`document.getElementById("tamper").hidden = true`);
    await act();
    await page.waitForSelector("#tamper:not([hidden])");
    const expect = canonical({ ...terms, [field]: value });
    const changedRows = await page.locator("#t-what tr.chg").evaluateAll((rs: Element[]) => rs.map((r) => (r as HTMLElement).dataset.row));
    check(JSON.stringify(changedRows) === JSON.stringify([field]) && (await page.locator("#t-what tr.chg").innerText()).includes(shown), `${tag}: tamper ${field}: shows that ${field} changed, and only it (now ${shown})`);
    const oldH = await page.locator("#t-what .hash.old").getAttribute("data-hash"), newH = await page.locator("#t-what .hash.new").getAttribute("data-hash");
    check(oldH === hash && newH === sha256(expect) && newH !== hash && (await page.locator("#t-what .hash.new code").innerText()).trim() === short(newH ?? ""),
      `${tag}: tamper ${field}: the new hash (${short(newH ?? "")}) next to the signed one (${short(hash)})`);
    const head = await page.locator("#t-head").innerText();
    const why = await page.locator("#t-why").innerText();
    check(head.startsWith("Refused") && /challenge|signature was made for hash/.test(why), `${tag}: tamper ${field}: the server refuses the same signature (${why.slice(0, 70)}…)`);
  }
  // On a phone the tamper and its refusal fill the screen; on a laptop the whole result card fits.
  await shotAt(page, mobile ? "#tamper" : "#tamper-box", join(shots, `${tag}-5-tamper-refused.png`));
  await layout(page, tag, "after the tamper", width);
  // The terms, opened: the canonical JSON is one long line of text.
  await page.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
  await layout(page, tag, "with all terms open", width);
  // The errors expected: the browser logs each refused tamper (HTTP 400) as a failed request.
  const unexpected = errors.filter((e, i) => !(i >= beforeTamper && /status of 400/.test(e)));
  check(unexpected.length === 0 && errors.length - beforeTamper === tampers.length, `${tag}: no console or CSP errors besides the ${tampers.length} refused tampers${unexpected.length ? `: ${unexpected.join(" | ")}` : ""}`);
  await context.close();
}

await browser.close();
local.server?.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
