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
const { StandInQuotes } = await import("../support/fxStandIn.js");
const fxStandIn = new StandInQuotes();
const { StandInLine } = await import("../support/lineStandIn.js");
const lineStandIn = new StandInLine();
const { TAMPER_VERDICT, TRY_SIGN_HOOK, TRY_SIGN_LABEL, TRY_SIGN_SIGNED, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
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
  // The FX quote from a labelled stand-in (no network in CI): it says "stand-in" wherever the page shows it.
  // The agent's sentence from a labelled stand-in too (no model call in CI): the page says "Stand-in sentence".
  local = await startLocalRelay({ port: 0, token: "browser-check", trySignFx: fxStandIn, trySignLine: lineStandIn.source });
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
let run = 0;
for (const [width, scheme] of RUNS) {
  // Locally, each visit comes from an address of its own (the local relay reads cf-connecting-ip as the Worker does),
  // so six visits stay inside the per-address limits; on the hosted site Cloudflare sets that header itself.
  const address = `198.51.${100 + run++}.7`;
  const tag = `${args.live ? "live-" : ""}${width}-${scheme}`;
  const mobile = width < 600;
  const height = mobile ? 844 : 900;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, ...(args.live ? {} : { extraHTTPHeaders: { "cf-connecting-ip": address } }) });
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
  // The button; the first of the three sentences under the heading links here too ("Try it in 30 seconds.", 6 Nov).
  const button = page.locator('a.btn[href="try/sign"]');
  check(await button.count() === 1, `${tag}: the landing has the "Sign with your own Face ID" button`);
  check(await page.locator('.why a[href="try/sign"]').count() === 1, `${tag}: "Try it in 30 seconds." under the heading links here`);
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
  check([...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits, ...WHATS_REAL.sources].every((l) => wr.includes(l)) && /No payment or conversion at Airwallex, no Metal call, and no money moves/.test(wr),
    `${tag}: "What's real?" opens to the honest lines (test world, stand-in executor, no payment or conversion, the FX quote read-only; the signature and its check real)`);
  await page.locator("details.wr > summary").click();
  // The three steps, and the start button above the fold.
  check(JSON.stringify((await page.locator("ol.progress li .t").allInnerTexts()).map((t: string) => t.trim())) === JSON.stringify(TRY_SIGN_STEPS), `${tag}: three steps: ${TRY_SIGN_STEPS.join(" → ")}`);
  check(JSON.stringify(await steps()) === '["on","-","-"]' && await page.locator("#pg-1").getAttribute("aria-current") === "step", `${tag}: step 1 is under way`);
  const go = await page.locator("#go-world").boundingBox();
  check(!!go && go.y + go.height <= height, `${tag}: the start button is above the fold (its bottom at ${go ? Math.round(go.y + go.height) : "?"} of ${height} px)`);
  check(!(await page.locator("#w-facts").isVisible()), `${tag}: the world's facts stay hidden until there is a world`);
  // Directly under the button, one line of what is at stake, also above the fold.
  const hook = await page.locator("#hook").boundingBox();
  check((await page.locator("#go-world + #hook").innerText()).trim() === TRY_SIGN_HOOK && !!hook && hook.y + hook.height <= height, `${tag}: under the start button: "${TRY_SIGN_HOOK}"`);
  check(await page.locator("summary", { hasText: "What's real?" }).count() === 1 && await page.locator("footer details").count() === 0, `${tag}: one "What's real?" on the page, under the disclaimer`);
  // The sticky area is opaque (Max, 6 Nov: text showed through it while scrolling): the header and the steps, edge to edge.
  const opaque = await page.evaluate(`(() => {
    const alpha = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); const p = m ? m[1].split(",").map((x) => x.trim()) : []; return p.length === 4 ? Number(p[3]) : p.length === 3 ? 1 : 0; };
    const h = getComputedStyle(document.querySelector("header.top")), o = getComputedStyle(document.querySelector("ol.progress"));
    return { header: alpha(h.backgroundColor), blur: h.backdropFilter, steps: alpha(o.backgroundColor) === 1 || alpha(o.boxShadow.split(") ")[0] + ")") === 1, shadow: o.boxShadow };
  })()`) as { header: number; blur: string; steps: boolean; shadow: string };
  check(opaque.header === 1 && (opaque.blur === "none" || opaque.blur === "") && /100vmax|\d{3,}px/.test(opaque.shadow), `${tag}: the sticky header and steps are opaque (header alpha ${opaque.header}, steps shadow ${opaque.shadow.slice(0, 40)}…)`);
  await page.screenshot({ path: join(shots, `${tag}-1-start.png`) });

  // Six requests a visit (world, passkey, signature, three tampers) and six visits: the relay's 30 a minute per address
  // (TRY_SIGN_PER_MINUTE) can answer 429 to the last ones; then the check waits out the minute, as a visitor would.
  // A short quote at 390 px: light, expiring before the passkey; dark, expiring once the passkey is made.
  if (!args.live && (tag === "390-light" || tag === "390-dark")) fxStandIn.validityMs = 12_000;
  // At 360 px dark the model is down: the fixed sentence, labelled "fixed text (model unavailable)".
  lineStandIn.fail = !args.live && tag === "360-dark";
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

  // The quote's end (once, at 390 px light): a quote that expires shows "expired", the sign button goes off, and "Get a
  // new quote" brings new terms with a new quote id and a new hash, to sign again.
  if (!args.live && tag === "390-light") {
    const before = await page.locator("article.prop.sheet .hash").getAttribute("data-hash");
    const firstId = (JSON.parse((await page.locator("article.prop.sheet details.terms pre").textContent()) ?? "{}") as { fx: { quote_id: string } }).fx.quote_id;
    // This world's quote was made with the stand-in's short validity; the next ones get the usual 15 minutes.
    fxStandIn.validityMs = 15 * 60_000;
    await page.waitForSelector("#go-quote:not([hidden])", { timeout: 30_000 });
    check((await page.locator("#q-left").innerText()).trim() === "expired" && (await page.locator("#q-status").innerText()).trim() === "Quote expired. Get a fresh one and sign again." && await page.locator("article.prop.sheet button[data-sign]").isDisabled(),
      `${tag}: the quote expires: "expired", "Quote expired. Get a fresh one and sign again.", nothing to sign`);
    const rows = await page.locator("article.prop.sheet dl.facts dt").allInnerTexts() as string[];
    check(rows.includes("Proposal expires") && rows.includes("Quote expires") && !rows.includes("Expires"), `${tag}: the two expiry rows read "Proposal expires" and "Quote expires" (${rows.filter((r) => /xpires/.test(r)).join(", ")})`);
    check(await page.locator("#go-key").isDisabled(), `${tag}: while the quote is expired, "Create your test passkey" is off`);
    await shotAt(page, "article.prop.sheet #s-key", join(shots, `${tag}-2b-quote-expired.png`));
    await page.click("#go-quote");
    await page.waitForFunction(() => document.getElementById("q-status")?.classList.contains("ok"));
    const after = await page.locator("article.prop.sheet .hash").getAttribute("data-hash");
    const nextId = (JSON.parse((await page.locator("article.prop.sheet details.terms pre").textContent()) ?? "{}") as { fx: { quote_id: string } }).fx.quote_id;
    check(after !== before && nextId !== firstId && /^in \d+ min/.test(await page.locator("#q-left").innerText()), `${tag}: "Get a new quote": new quote ${nextId.slice(0, 13)}…, new terms, a new hash to sign`);
    check(await page.locator("#go-key").isEnabled(), `${tag}: with the new quote, "Create your test passkey" is on again`);
  }
  // With the passkey made first: the quote expires, "Sign with Face ID" goes off until a new quote is here.
  if (!args.live && tag === "390-dark") {
    await page.click("#go-key");
    await page.waitForFunction(() => document.getElementById("k-status")?.classList.contains("ok"));
    fxStandIn.validityMs = 15 * 60_000;
    const signBtn = page.locator("article.prop.sheet button[data-sign]");
    check(await signBtn.isEnabled(), `${tag}: with the passkey made, "Sign with Face ID" is on`);
    await page.waitForSelector("#go-quote:not([hidden])", { timeout: 30_000 });
    check(await signBtn.isDisabled() && (await page.locator("#q-left").innerText()).trim() === "expired", `${tag}: the quote expires: "Sign with Face ID" is off`);
    await page.waitForTimeout(1500);
    check(await signBtn.isDisabled(), `${tag}: and stays off while the quote is expired`);
    await page.click("#go-quote");
    await page.waitForFunction(() => document.getElementById("q-status")?.classList.contains("ok"));
    check(await page.locator("article.prop.sheet button[data-sign]").isEnabled() && await page.locator("#go-key").isHidden(), `${tag}: with the new quote, "Sign with Face ID" is on again (the passkey kept)`);
  }

  // (b): the approval sheet, as the CFO's.
  const waiting = page.locator("article.prop.sheet");
  // The agent's sentence: who wrote it, said on the pill; the request id behind "more".
  if (!args.live) {
    const pill = waiting.locator(".who .pill");
    const says = (await waiting.locator(".says").innerText()).trim();
    if (tag === "360-dark") {
      check((await pill.innerText()).trim() === "fixed text (model unavailable)" && await pill.getAttribute("data-voice") === "fixed-unavailable" && says === "Alpine Packaging's invoice is due Friday. It is more than I may pay alone, so I ask you.",
        `${tag}: the model down: the fixed sentence, labelled "fixed text (model unavailable)"`);
    } else {
      check((await pill.innerText()).trim() === "Stand-in sentence (local check, not Claude)" && await pill.getAttribute("data-voice") === "model" && says === lineStandIn.text,
        `${tag}: the agent's sentence from the (labelled) stand-in for Claude Haiku: "${says.slice(0, 40)}…"`);
      await waiting.locator(".says + details.more > summary").click();
      check(/^Request id req_stand-in-\d{4} \(stand-in\)\. The model was given only this test world's invoice, balance, reserve floor and limit, never your words\./.test((await waiting.locator(".says + details.more > p").innerText()).trim()),
        `${tag}: "more" names the request id and what the model was given`);
      await waiting.locator(".says + details.more > summary").click();
    }
    check((await page.locator("article.prop.blocked .who .pill").innerText()).trim() === "fixed text, no model call", `${tag}: the blocked proposal's sentence is fixed text, labelled`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const terms = JSON.parse((await waiting.locator("details.terms pre").textContent()) ?? "{}") as Record<string, any>;
  const sheetText = await waiting.innerText();
  const facts = Object.fromEntries((await waiting.locator("dl.facts").evaluate((d: Element) => [...d.querySelectorAll("dt")].map((t) => [t.textContent, t.nextElementSibling?.textContent])))) as Record<string, string>;
  const iban = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();
  check(/You are approving · T-0002/i.test(sheetText) && (await waiting.locator(".title").innerText()).includes(`Pay ${terms.payee} EUR 1,850.00`), `${tag}: (b) is the approval sheet: "You are approving", "Pay ${terms.payee} EUR 1,850.00"`);
  check(facts.Amount === "EUR 1,850.00" && facts.Beneficiary === terms.payee && facts.IBAN === iban(terms.payee_iban ?? "") && facts.Reference === terms.reference && facts.Proposal === "T-0002" && /^in \d+ min/.test(facts["Proposal expires"] ?? ""),
    `${tag}: (b) the sheet's exact terms: amount, beneficiary, IBAN ${facts.IBAN}, reference, proposal, expiry`);
  const hash = (await waiting.locator(".hash").getAttribute("data-hash")) ?? "";
  if (!args.live) {
    // The quote is in the terms and in the sheet's table, with its own countdown.
    const q = terms.fx as { quote_id: string; buy_amount: string; sell_amount: string; client_rate: string; source: string };
    check(!!q && q.source === "stand-in" && (facts["FX quote"] ?? "").startsWith("EUR 1,850.00 for USD ") && (facts["FX quote"] ?? "").includes(`quote ${q.quote_id.slice(0, 8)}…`) && /^in \d+ min/.test(facts["Quote expires"] ?? ""),
      `${tag}: (b) the FX quote is in the terms and the sheet (${facts["FX quote"]}), with its countdown`);
  }
  check(/^[0-9a-f]{64}$/.test(hash) && hash === sha256(canonical(terms)), `${tag}: (b) shows its terms' hash, checked on the device and here`);
  const short = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;
  check((await waiting.locator(".hash code").innerText()).trim() === short(hash) && await waiting.locator(".hash code").getAttribute("title") === hash,
    `${tag}: (b) the hash is shown shortened, first 12 and last 8 (${short(hash)}), the whole of it on hover`);
  await waiting.locator(".hash button.exp").click();
  check((await waiting.locator(".hash code").innerText()).trim() === hash && await waiting.locator(".hash button.exp").getAttribute("aria-expanded") === "true", `${tag}: (b) a tap on the hash shows all 64 characters`);
  await waiting.locator(".hash button.exp").click();
  check((await waiting.locator(".basis").innerText()).trim() === cfoApproval().line, `${tag}: (b) names the CFO's real sheet it follows, from the record: ${cfoApproval().line.slice(0, 60)}…`);
  if (tag !== "390-dark") check(await waiting.locator("button[data-sign]").isDisabled(), `${tag}: (b) cannot be signed before there is a passkey`);
  await shotAt(page, "article.prop.sheet", join(shots, `${tag}-2-sheet.png`));

  // (a): blocked, nothing to sign, and the three locks.
  const blocked = page.locator("article.prop.blocked");
  check((await blocked.innerText()).includes("T-0001") && (await blocked.innerText()).includes("Check: fail"), `${tag}: (a) shows "Check: fail" and its rule`);
  check((await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) names the blocking rule`);
  check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
  const locks = await blocked.locator(".lock").evaluateAll((ls: Element[]) => ls.map((l) => ({ id: (l as HTMLElement).dataset.lock, hit: l.classList.contains("hit"), text: l.textContent ?? "", href: l.querySelector("a")?.getAttribute("href") ?? "" }))) as { id: string; hit: boolean; text: string; href: string }[];
  check(locks.map((l) => l.id).join() === "purser,airwallex,metal" && locks.filter((l) => l.hit).map((l) => l.id).join() === "purser" && /Stopped this one \(simulated\)/.test(locks[0]!.text),
    `${tag}: (a) three locks, Purser's policy marked as the one that stopped it (simulated)`);
  check(locks.every((l, i) => l.text.includes(`Real example, ${LOCKS[i]!.run}: ${LOCKS[i]!.example}`)), `${tag}: (a) each lock names its real example and the run it is from`);
  // One sentence each; the example is behind a closed "more" (a native <details>), the link always visible.
  const mores = await blocked.locator(".lock > details.more").evaluateAll((ds: Element[]) => ds.map((d) => `${(d as HTMLDetailsElement).open}:${d.querySelector("summary")?.textContent}`)) as string[];
  check(mores.join() === "false:more,false:more,false:more" && await blocked.locator(".lock a").evaluateAll((as: Element[]) => as.every((a) => (a as HTMLElement).offsetHeight > 0)) as boolean,
    `${tag}: (a) each lock: one sentence, its example behind "more", its link visible`);
  await blocked.locator(".lock.purser details.more > summary").click();
  check((await blocked.locator(".lock.purser details.more").innerText()).includes("only the shortfall"), `${tag}: (a) "more" opens to the example (P-0005, only the shortfall)`);
  await blocked.locator(".lock.purser details.more > summary").click();
  check(locks[0]!.href === "/proof#airwallex" && /P-0005: the invoice needed EUR 260\.00 and EUR 150\.00 was free, so Purser's plan converted only the shortfall: EUR 110\.00 for USD 124\.29/.test(locks[0]!.text),
    `${tag}: (a) Purser's policy: the floors that held at P-0005 (FX only for the shortfall), linked to the FX row on Proof`);
  check(locks[1]!.href.endsWith("/blob/main/docs/runs/visa-tap-live-2026-11-02.json") && /EUR 45\.00/.test(locks[1]!.text) && /LIMIT_EXCEEDED/.test(locks[1]!.text) && /Separate TAP run, 2 Nov/.test(locks[1]!.text),
    `${tag}: (a) Airwallex's card limit links the separate TAP run of 2 November (EUR 45.00, LIMIT_EXCEEDED)`);
  check(/^0x[0-9a-f]{64}$/.test(METAL_TX) && locks[2]!.href === `https://testnet.metalntwx.com/tx/${METAL_TX}`, `${tag}: (a) Metal's mandate links the on-chain refusal on Metal's explorer (${METAL_TX.slice(0, 10)}…${METAL_TX.slice(-4)})`);
  if (!args.live) {
    const q = terms.fx as { quote_id: string };
    const fxq = blocked.locator(".lock.airwallex .fxq.live");
    check(await fxq.count() === 1 && (await fxq.innerText()).includes("Used in this signature") && (await fxq.innerText()).includes("Stand-in quote (local check, not Airwallex)") && (await fxq.innerText()).includes(`Quote ${q.quote_id.slice(0, 8)}…${q.quote_id.slice(-4)}`),
      `${tag}: (a) at Airwallex's lock, the quote marked "Used in this signature" (here a labelled stand-in)`);
  }
  check(/simulation in your test world; the examples are real/.test(await blocked.innerText()), `${tag}: (a) says the blocked payment is simulated and the examples real`);
  await shotAt(page, "article.prop.blocked .locks", join(shots, `${tag}-3-locks.png`));

  if (await page.locator("#go-key").isVisible()) await page.click("#go-key");
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
  const ok = await page.locator("#result .bigok svg").boundingBox();
  const okColor = await page.locator("#result .bigok svg").evaluate((e: Element) => getComputedStyle(e).color);
  const okWant = await page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--ok").trim()`) as string;
  check((await page.locator("#r-head").innerText()).trim() === TRY_SIGN_SIGNED && !!ok && ok.width >= 48 && okColor.length > 0 && okWant.length > 0,
    `${tag}: a big green check (${ok ? Math.round(ok.width) : "?"} px, ${okColor}): "${TRY_SIGN_SIGNED}"`);
  check(await page.locator("#r-checks details.more").count() === 1 && await page.locator("#r-exec details.more").count() === 1, `${tag}: the result's explanations are one sentence each, the rest behind "more"`);
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
  check(await page.locator("#result .receipt details.more").count() === 1 && /^Check it offline with one command, no server: npm run verify-receipt -- receipt\.json\.$/.test((await page.locator("#result .receipt > p").innerText()).trim()),
    `${tag}: the receipt's explanation is one sentence, the rest behind "more"`);
  // /try/verify (A3): "Verify this receipt here" opens the receipt in a page that checks it with WebCrypto, with no
  // server call (its CSP allows no connection); one field changed, in the page or in the file, and it is invalid.
  if (!args.live) {
    const [vp] = await Promise.all([context.waitForEvent("page"), page.click("#r-verify")]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v: any = vp;
    v.on("pageerror", (e: Error) => errors.push(`verify: ${e.message}`));
    v.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(`verify: ${m.text()}`); });
    await v.waitForSelector("#v-verdict:not([hidden])");
    await v.waitForLoadState("networkidle");
    const calls: string[] = [];
    v.on("request", (q: { url(): string }) => calls.push(q.url()));
    const verdict = async () => ({ ok: await v.locator("#v-verdict").getAttribute("data-ok"), failed: await v.locator("#v-verdict").getAttribute("data-failed"), text: (await v.locator("#v-verdict").innerText()).trim() });
    check((await v.locator("#v-lead").innerText()).trim() === "Don't trust our server: check it yourself." && new URL(v.url()).hash === "", `${tag}: /try/verify: "Don't trust our server: check it yourself."; the receipt came in the link's fragment, then cleared`);
    const good = await verdict();
    check(good.ok === "true" && good.text === "Signature valid for these terms", `${tag}: /try/verify: "${good.text}"`);
    await v.screenshot({ path: join(shots, `${tag}-6-verify-valid.png`) });
    await layout(v, tag, "/try/verify, valid", width);
    await v.click("#v-flip");
    await v.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "false");
    const flipped = await verdict();
    check(flipped.failed === "terms hash" && flipped.text === "Invalid: the terms hash check fails" && (await v.locator("#v-why").innerText()).includes("the terms were changed") && await v.locator("#v-terms dd.chg").count() === 1,
      `${tag}: /try/verify: "Change one field" (amount + 0.01): "${flipped.text}"`);
    await v.screenshot({ path: join(shots, `${tag}-7-verify-one-field-changed.png`) });
    await layout(v, tag, "/try/verify, invalid", width);
    await v.selectOption("#v-field", "payee_iban");
    await v.waitForFunction(() => document.querySelector("#v-terms dd.chg")?.getAttribute("data-field") === "payee_iban");
    check((await verdict()).failed === "terms hash", `${tag}: /try/verify: the IBAN changed instead: invalid, the terms hash check named`);
    await v.click("#v-flip");
    await v.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "true");
    check((await verdict()).ok === "true", `${tag}: /try/verify: the toggle off: valid again`);
    // The file itself, one field changed in it: invalid; the file as downloaded: valid.
    const file = JSON.parse(readFileSync(saved, "utf8")) as { terms: Record<string, string> };
    await v.setInputFiles("#v-file", { name: "receipt.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...file, terms: { ...file.terms, currency: "USD" } })) });
    await v.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "false");
    check((await verdict()).failed === "terms hash" && (await v.locator("#v-status").innerText()).includes("receipt.json"), `${tag}: /try/verify: an uploaded receipt.json with the currency changed: invalid, the terms hash check named`);
    await v.setInputFiles("#v-file", saved);
    await v.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "true");
    check((await verdict()).ok === "true", `${tag}: /try/verify: the downloaded receipt.json, uploaded: valid`);
    check(calls.length === 0, `${tag}: /try/verify made no request while checking (${calls.length}${calls.length ? `: ${calls.slice(0, 3).join(", ")}` : ""})`);
    await v.close();
  }
  await shotAt(page, "#result", join(shots, `${tag}-4-signed-verified.png`));
  await layout(page, tag, "after signing", width);

  // Tamper, field by field: the visitor's own edit, sent with the same signature, refused by the server.
  check(await page.locator("#t-send").isDisabled(), `${tag}: nothing to send until a field is changed`);
  const beforeTamper = errors.length;
  const tampers: [string, string, () => Promise<void>, string, string][] = [
    ["amount", "1850.01", async () => { await page.click("#go-tamper"); }, "EUR 1,850.01", TAMPER_VERDICT.cent],
    ["payee_iban", "DE00000000000000000666", async () => { await page.fill("#t-amount", terms.amount!); await page.fill("#t-iban", "de00 0000 0000 0000 0006 66"); await page.click("#t-send"); }, "DE00 0000 0000 0000 0006 66", TAMPER_VERDICT.field],
    ["currency", "USD", async () => { await page.fill("#t-iban", iban(terms.payee_iban!)); await page.selectOption("#t-currency", "USD"); await page.click("#t-send"); }, "USD", TAMPER_VERDICT.field],
    ...(args.live ? [] : [["fx.client_rate", "1.129678", async () => { await page.selectOption("#t-currency", "EUR"); await page.fill("#t-rate", "1.129678"); await page.click("#t-send"); }, "1.129678", TAMPER_VERDICT.field] as [string, string, () => Promise<void>, string, string]]),
  ];
  for (const [field, value, act, shown, last] of tampers) {
    await page.evaluate(`document.getElementById("tamper").hidden = true`);
    await act();
    await page.waitForSelector("#tamper:not([hidden])");
    const expect = canonical(field === "fx.client_rate" ? { ...terms, fx: { ...terms.fx, client_rate: value } } : { ...terms, [field]: value });
    const changedRows = await page.locator("#t-what tr.chg").evaluateAll((rs: Element[]) => rs.map((r) => (r as HTMLElement).dataset.row));
    check(JSON.stringify(changedRows) === JSON.stringify([field]) && (await page.locator("#t-what tr.chg").innerText()).includes(shown), `${tag}: tamper ${field}: shows that ${field} changed, and only it (now ${shown})`);
    const oldH = await page.locator("#t-what .hash.old").getAttribute("data-hash"), newH = await page.locator("#t-what .hash.new").getAttribute("data-hash");
    check(oldH === hash && newH === sha256(expect) && newH !== hash && (await page.locator("#t-what .hash.new code").innerText()).trim() === short(newH ?? ""),
      `${tag}: tamper ${field}: the new hash (${short(newH ?? "")}) next to the signed one (${short(hash)})`);
    const head = await page.locator("#t-head").innerText();
    const why = await page.locator("#t-why").innerText();
    // One clean sentence (Max, 6 Nov: no "The server: refused: the server's verifier…").
    check(head.startsWith("Refused") && why.trim() === `The server refused it: the signature was made for hash ${hash.slice(0, 12)}…, not for your terms (${(newH ?? "").slice(0, 12)}…).` && !/…\.|\.\.\.\./.test(why),
      `${tag}: tamper ${field}: the server refuses the same signature, said once (${why.slice(0, 60)}…)`);
    check((await page.locator("#t-verdict").innerText()).trim() === last && await page.locator("#t-verdict").isVisible(), `${tag}: tamper ${field}: it ends with "${last}"`);
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
