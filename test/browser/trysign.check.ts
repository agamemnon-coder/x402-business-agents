// Browser check of /try/sign (not part of npm test; needs Playwright with Chromium from the environment):
//   npx tsx test/browser/trysign.check.ts [screenshot dir]
//   npx tsx test/browser/trysign.check.ts --live [base URL] [screenshot dir]
// By default a local relay built with TRY_SIGN_ENABLED=on serves the page. With --live, the same visit runs against the
// deployed relay (default https://kit11.max-31b.workers.dev; only once Max has deployed it with the flag on), at 390 px
// light and 1440 px dark only (two test worlds, to stay well inside the relay's limits), screenshots in
// out/try-sign-live unless a directory is given. Chromium's virtual authenticator (WebAuthn over CDP, user verification
// on) plays the visitor's Face ID.
//
// The demo is one story of five screens (Max, 7 Nov). At 360, 390 and 1440 px, light and dark, it goes through all of
// it: the test world opens when the page is shown; (1) the agent's request with one button, "Sign with Face ID", which
// makes the test passkey and signs; the exact terms (amount, beneficiary, IBAN, reference, the hash short with Copy and
// tap-to-expand, every field as hashed) and the payment a rule stopped, with its three locks, each linking its real
// example; (2) signed and verified by the server, run by the stand-in, the receipt downloaded and verified offline and on
// /try/verify; (3) try to cheat: one cent, another IBAN, another currency, the FX rate, each refused by the server with
// the same signature; (4) change the rule: what the Treasury agent may pay alone, a looser rule signed; (5) the agent's
// next invoice paid alone under it. On every screen: at most 60 words in sight, exactly one main button in sight and
// within the screen without scrolling, nothing outside its card, the page no wider than the screen, no console error.
// Then, apart: the full policy behind "Show all fields and what Purser sends" (#71: a stricter change holds at once, a
// looser one is refused until signed, the panels follow); a stricter rule by its chip (applied at once, no signature);
// the agent's sentence shown as text, never markup; and one timed visit, the opening to the closing card in at most 75 s.
// CI runs it (.github/workflows/ci.yml, job judge). A test world only: nothing here reaches the runner, Airwallex or Metal.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
// Spec 6b: the Treasury agent's advice (Opus on the Worker) from a labelled stand-in: it plays the runner's tool loop
// and quotes code's numbers; the page labels it "stand-in, not Claude".
const { StandInAdvisor } = await import("../support/adviceStandIn.js");
const advisor = new StandInAdvisor();
// Section 6: the invoice reader's stand-in, as the line's: it reads the document's own lines, labelled "stand-in, not Claude".
const { parseInvoiceFallback } = await import("../../src/claude/invoiceReading.js");
const readerStandIn = async (doc: string) => ({ value: parseInvoiceFallback(doc), requestId: "req_standin_reader", costUsd: 0, model: "stand-in", ms: 300 });
const { LOCK_CHANNELS, mainRunWorst, OTHER_IBAN, TAMPER_VERDICT, TRY_POLICY, TRY_SIGN_END, TRY_SIGN_LABEL, TRY_SIGN_SCREENS: W, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
const { ALONE_PER_DAY, PAID_ALONE, defaultPolicy, exposurePolicyOfWorld, threeLocks } = await import("../../src/try/policy.js");
// 1.1: the worst case, read from the policy code (src/policy/exposure.ts) with the main run's recorded rate.
const { exposureOf, exposureWords } = await import("../../src/policy/exposure.js");
const { recordedRate } = await import("../../src/policy/exposureSources.js");
// The test world's worst case (Max, 7 Nov): Purser's figure plus what its Treasury agent may pay alone, ALONE_PER_DAY a
// day; computed by Purser's own code from the world's policy with "may pay alone" (and the Treasury card's month) set.
const worldExpo = (alone: string, treasuryMonthly?: string) => {
  const p = defaultPolicy(new Date(), { reserve_floor: "25000.00", alone_limit: "500.00" });
  const ep = exposurePolicyOfWorld({ ...p, agents: { ...p.agents, treasury: { ...p.agents.treasury, alone, ...(treasuryMonthly ? { monthly: treasuryMonthly } : {}) } } });
  return exposureWords(exposureOf(ep), ep, WORST_RATE);
};
const WORST_RATE = recordedRate((await import("../../src/redesign/run.js")).loadRecord().record as unknown as Parameters<typeof recordedRate>[0]);
const WORST = worldExpo("500.00");
const { cfoApproval, tryLocks } = await import("../../src/try/examples.js");
const { letThroughOf, loadRecord } = await import("../../src/redesign/run.js");
const { canonical, NEXT_INVOICE } = await import("../../worker/src/trySign.js");
const { ATTACKS, TRICKS, runTrick } = await import("../../worker/src/trick.js");
const { adviceGiven, amountsFit, cleanReason } = await import("../../worker/src/agentLine.js");
/** Live mode: the labels the deployed page may show, live, recorded or a labelled fallback (spec 6b). */
const LIVE_READ_LABEL = /^(Claude Sonnet · live · invoice reader|recorded: the live agent was unavailable|read by code · .+)$/;
const LIVE_ADVICE_LABEL = /^(Claude Opus · live · treasury advice|recorded: the live agent was unavailable|fixed text · .+)$/;
const LIVE_TRICK_LABEL = /^(Claude Sonnet · live · invoice reader|recorded: the live agent was unavailable|live agent unavailable · read by code)$/;
const { verifyReceipt } = await import("../../src/try/receipt.js");
const { checkChain } = await import("../../worker/src/worldChain.js");
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
  local = await startLocalRelay({ port: 0, token: "browser-check", trySignFx: fxStandIn, trySignAdvisor: advisor.ask, trySignReader: readerStandIn, trySignRecorded: null });
}
const require = createRequire(import.meta.url);
// Playwright is not a dependency of this repo; it comes with the environment (Chromium pre-installed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; };
/** What was measured per screen, for the report (docs/try-sign/metrics.json). */
const metrics: { tag: string; screen: number; words: number; primaries: number; primaryInView: boolean; ms?: number }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

/** The layout at this moment: how wide the page is, and every element or line of text that runs outside its card. */
async function layout(page: Page, tag: string, stage: string, width: number): Promise<void> {
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
        if (!(n.nodeType === Node.TEXT_NODE ? n.parentElement : n).checkVisibility()) continue;
        let boxes;
        if (n.nodeType === Node.TEXT_NODE) {
          if (!(n.textContent || "").trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          boxes = [...range.getClientRects()];
        } else boxes = [n.getBoundingClientRect()];
        for (const b of boxes) {
          if (b.width === 0 && b.height === 0) continue;
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

/**
 * A screen as the visitor first sees it (the page scrolls to the top on each screen): its words in sight (a closed
 * "Show …" or "more" shows only its line), the main buttons in sight (exactly one), and that one inside the screen
 * without scrolling, above the bottom edge and below the site's header.
 */
async function measure(page: Page, tag: string, n: number, ms?: number): Promise<void> {
  await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  // Screen 1's count leaves out the agent's own reason (Opus's one or two sentences, at most 400 characters, checked by
  // the server): the page's own words stay within 60 around it.
  const m = await page.evaluate(`(() => {
    const scr = document.getElementById("scr-${n}");
    const count = (t) => t.split(/\\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    const says = scr.querySelector("#s1-ask .says");
    const words = count(scr.innerText) - (says && says.checkVisibility() ? count(says.innerText) : 0);
    const prim = [...document.querySelectorAll(".btn.primary")].filter((b) => b.checkVisibility() && b.getClientRects().length > 0);
    const head = document.querySelector("header.top").getBoundingClientRect().bottom;
    const r = prim[0] ? prim[0].getBoundingClientRect() : null;
    return { words, primaries: prim.length, inView: !!r && r.top >= head && r.bottom <= innerHeight, label: prim.map((b) => b.textContent.trim()).join(" | ") };
  })()`) as { words: number; primaries: number; inView: boolean; label: string };
  if (process.env.WORDS) console.log(`words ${tag} ${n}: ${await page.evaluate(`document.getElementById("scr-${n}").innerText.split(/\\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).join(" | ")`)}`);
  metrics.push({ tag, screen: n, words: m.words, primaries: m.primaries, primaryInView: m.inView, ...(ms === undefined ? {} : { ms }) });
  check(m.words <= 60, `${tag} screen ${n}: ${m.words} words in sight (at most 60)`);
  check(m.primaries === 1, `${tag} screen ${n}: exactly one main button in sight (${m.primaries}: ${m.label})`);
  check(m.inView, `${tag} screen ${n}: the main button "${m.label}" is on the screen without scrolling`);
}

// The full policy (#71, behind "Show all fields and what Purser sends"): the Treasury agent's policy as the form shows
// it, the three panels as the page shows them, and what Purser's own code makes of that policy (src/try/policy.ts
// threeLocks: the card body IssuingRest sends, the mandate's terms the owner signer passes to metal-agent, Purser's
// settings), to compare field for field.
type FormPolicy = { reserve_floor: string; agents: { treasury: { per_tx: string; monthly: string; mccs: string[]; currencies: string[]; end_date: string; alone: string } } };
const formPolicy = (page: Page) => page.evaluate(`(() => {
  const v = (f) => document.getElementById("pf-" + f).value, ck = (f) => [...document.querySelectorAll('input[name="pf-' + f + '"]:checked')].map((n) => n.value).sort();
  return { reserve_floor: v("reserve_floor"), agents: { treasury: { per_tx: v("per_tx"), monthly: v("monthly"), mccs: ck("mccs"), currencies: ck("currencies"), end_date: v("end_date"), alone: v("alone") } } };
})()`) as Promise<FormPolicy>;
const panels = (page: Page) => page.evaluate(`(() => ({
  awx: document.getElementById("pl-awx").textContent, purser: document.getElementById("pl-purser").textContent, args: document.getElementById("pl-margs").textContent,
  metal: [...document.querySelectorAll("#pl-metal dd")].map((d) => d.dataset.value), state: document.getElementById("p-locks").dataset.state,
  pills: [...document.querySelectorAll("#p-locks .state")].map((n) => n.textContent), changed: document.querySelectorAll("#p-locks .ln.chg, #p-locks dd.chg").length,
  labels: [...document.querySelectorAll("#p-locks .ns")].map((n) => n.textContent),
}))()`) as Promise<{ awx: string; purser: string; args: string; metal: string[]; state: string; pills: string[]; changed: number; labels: string[] }>;
function expectedLocks(policy: FormPolicy, worldId: string) {
  const l = threeLocks(policy as unknown as Parameters<typeof threeLocks>[0], "treasury", new Date(), worldId);
  return {
    awx: JSON.stringify({ authorization_controls: l.airwallex.authorization_controls }, null, 2), purser: JSON.stringify(l.purser.settings, null, 2),
    cap: l.metal.params.cap, budget: l.metal.params.budget, payee: l.metal.params.payee,
    args: `metal-agent ${l.metal.args.slice(0, l.metal.args.indexOf("--expires-in")).map((a) => (/^[A-Za-z0-9_.,:/-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`,
  };
}
const panelsMatch = (pn: Awaited<ReturnType<typeof panels>>, ex: ReturnType<typeof expectedLocks>) =>
  pn.awx.trimEnd() === ex.awx && pn.purser.trimEnd() === ex.purser && pn.metal[0] === ex.cap && pn.metal[1] === ex.budget && pn.metal[2] === ex.payee && pn.args.startsWith(ex.args);
/** An element scrolled to the middle of the screen is not under the sticky main button at the bottom. */
const clearOfBar = async (page: Page, sel: string, n: number) => page.evaluate(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: "center", behavior: "instant" });
  const r = e.getBoundingClientRect(), bar = document.querySelector("#scr-${n} .bar").getBoundingClientRect();
  return r.bottom <= bar.top + 0.5 || r.top >= bar.bottom;
})()`) as Promise<boolean>;

/**
 * The page's animations running or holding their end now (inside the story: the screens and the diagram), each with its
 * duration and delay in ms: the motion pass (Max, 7 Nov) keeps every one between 150 and 400 ms.
 */
const motion = (page: Page) => page.evaluate(`document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest(".story")).map((a) => {
  const t = a.effect.getTiming();
  return { name: a.animationName || a.transitionProperty || "?", ms: Number(t.duration), delay: Number(t.delay) };
})`) as Promise<{ name: string; ms: number; delay: number }[]>;
async function motionOk(page: Page, tag: string, where: string, want: string[]): Promise<void> {
  const m = await motion(page);
  const names = [...new Set(m.map((a) => a.name))];
  check(want.every((w) => names.includes(w)) && m.every((a) => a.ms >= 150 && a.ms <= 400), `${tag}: ${where}: ${want.join(", ")} play, each between 150 and 400 ms (${m.map((a) => `${a.name} ${a.ms}`).join(", ")})`);
}

/** A browser context with Chromium's virtual authenticator (user verification on): the visitor's Face ID. */
async function visitor(o: { width: number; scheme?: "light" | "dark"; ip: string; reducedMotion?: "reduce" }) {
  const mobile = o.width < 600;
  const context = await browser.newContext({ viewport: { width: o.width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: o.scheme ?? "light", ...(o.reducedMotion ? { reducedMotion: o.reducedMotion } : {}), ...(args.live ? {} : { extraHTTPHeaders: { "cf-connecting-ip": o.ip } }) });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: local.url });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }) as { authenticatorId: string };
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });
  const signCount = async () => ((await cdp.send("WebAuthn.getCredentials", { authenticatorId })) as { credentials: { signCount: number }[] }).credentials.map((c) => c.signCount);
  return { context, page, cdp, authenticatorId, errors, mobile, height: mobile ? 844 : 900, signCount };
}
/** Opens /try/sign and waits for the test world (it opens when the page is shown); over the relay's minute limit, waits once. */
async function openWorld(page: Page, tag: string, goto = true): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    if (goto || attempt > 0) await page.goto(`${local.url}/try/sign`);
    await page.waitForFunction(() => !(document.getElementById("go-sign") as HTMLButtonElement).disabled || document.getElementById("w-status")?.classList.contains("bad"));
    if (await page.locator("#go-sign").isEnabled()) return;
    const said = await page.locator("#w-status").innerText();
    if (attempt > 0 || !/a minute/.test(said)) throw new Error(`${tag}: no test world: ${said}`);
    console.log(`info  ${tag}: the relay asks to wait a minute (${said}); waiting`);
    await page.waitForTimeout(61_000);
  }
}
/** Past the opening line to screen 1 (Max, 7 Nov, 1.1: one sentence and one button first). */
async function start(page: Page): Promise<void> {
  if (await page.locator("#scr-0").isVisible()) { await page.click("#go-start"); await page.waitForSelector("#scr-1:not([hidden])"); }
}
/** Screens 1 to 5 the short way: sign, one cheat, one trick, on to the rule. */
async function toRule(page: Page): Promise<void> {
  await start(page);
  await page.click("#go-sign");
  await page.waitForSelector("#scr-2:not([hidden])");
  await page.click("#go-cheat");
  await page.waitForSelector("#tamper:not([hidden])");
  await page.click("#go-trick");
  await page.waitForSelector("#scr-4:not([hidden])");
  await page.click('#trick-chips .chip[data-attack="pre_approved"]');
  await page.waitForSelector("#k-result:not([hidden])");
  await page.click("#go-rule");
  await page.waitForSelector("#scr-5:not([hidden])");
}
const dots = async (page: Page) => (await page.locator("ol.dots li").evaluateAll((ls: Element[]) => ls.map((l) => (l.classList.contains("done") ? "done" : l.classList.contains("on") ? "on" : "-")))) as string[];
const shot = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: join(shots, name) }); };

const RUNS: [number, "light" | "dark"][] = args.live ? [[390, "light"], [1440, "dark"]]
  : [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"], [1440, "light"], [1440, "dark"]];
let run = 0;
// ONLY=390-light (say) runs that one visit and nothing else: for working on one screen size.
const ONLY = process.env.ONLY;
for (const [width, scheme] of RUNS.filter(([w, s]) => !ONLY || ONLY === `${w}-${s}`)) {
  // Locally, each visit comes from an address of its own (the local relay reads cf-connecting-ip as the Worker does).
  const tag = `${args.live ? "live-" : ""}${width}-${scheme}`;
  // A short quote at 390 px: light, expiring before anything is signed; dark, expiring once the passkey is made.
  if (!args.live && (tag === "390-light" || tag === "390-dark")) fxStandIn.validityMs = 12_000;
  // At 360 px dark the Treasury agent is down: the fixed sentence, labelled "fixed text · <why>".
  advisor.fail = !args.live && tag === "360-dark";
  // Live, every visit comes from this machine's one address: the relay allows it 30 requests a minute (the agents' steps
  // are five of them), so the second visit starts a minute after the first.
  if (args.live && run > 0) { console.log(`info  ${tag}: a minute's pause for the relay's per-address limit`); await new Promise((r) => setTimeout(r, 61_000)); }
  const v = await visitor({ width, scheme, ip: `198.51.${100 + run++}.7` });
  const { page, errors, mobile, height } = v;

  // One flow (Max, 7 Nov): Home's second step leads here, and so does Watch's "Now try it yourself", the way a visitor
  // comes: they watch the agents first, then try it.
  await page.goto(`${local.url}/home`);
  check(await page.locator('ol.flow a[href="try/sign"]').count() === 1, `${tag}: Home's flow leads to /try/sign`);
  await page.goto(`${local.url}/watch`);
  const button = page.locator('a.nextstep[href="try/sign"]');
  check(await button.count() === 1, `${tag}: Watch ends in "Now try it yourself", to /try/sign`);
  await button.click();
  await page.waitForURL(`${local.url}/try/sign`);
  const t0 = Date.now();
  check((await page.locator(".testband .tl").innerText()).trim() === TRY_SIGN_LABEL, `${tag}: the label at the top reads "${TRY_SIGN_LABEL}"`);
  const band = await page.locator(".testband").boundingBox();
  check(!!band && band.y === 0, `${tag}: the label is the first thing on the page`);
  // A thin band (Max's review): about half its height before (44 px in one line, 63 px in two at 390 px).
  check(!!band && band.height <= (width >= 390 ? 24 : 40), `${tag}: the band at the top is thin (${band?.height} px)`);
  const labelLines = await page.locator(".testband .tl").evaluate((e: Element) => { const r = document.createRange(); r.selectNodeContents(e.lastChild as Node); return new Set([...r.getClientRects()].map((b) => Math.round(b.top))).size; }) as number;
  if (width >= 390) check(labelLines === 1, `${tag}: the disclaimer is one line (${labelLines})`);
  // "What's real?": one link in the band, closed until asked, opening to the honest lines.
  check(!(await page.locator("details.wr").evaluate((d: HTMLDetailsElement) => d.open)), `${tag}: "What's real?" is closed until asked`);
  await page.locator("details.wr > summary").click();
  const wr = await page.locator("details.wr").innerText();
  check([...WHATS_REAL.simulated, ...WHATS_REAL.real, ...WHATS_REAL.limits, ...WHATS_REAL.sources].every((l) => wr.includes(l)) && /No payment or conversion at Airwallex, no Metal call, and no money moves/.test(wr),
    `${tag}: "What's real?" opens to the honest lines (test world, stand-in executor, no payment or conversion, the FX quote read-only; the signature and its check real)`);
  await page.locator("details.wr > summary").click();
  check(await page.locator("summary", { hasText: "What's real?" }).count() === 1 && await page.locator("footer details").count() === 0 && await page.locator(".testband details.wr").count() === 1,
    `${tag}: one "What's real?" on the page, in the band at the top`);
  // One progress indicator: six dots (Max, 7 Nov: "Trick the agent" after the cheat).
  check(JSON.stringify((await page.locator("ol.dots li .t").allTextContents()).map((t: string) => t.trim())) === JSON.stringify(TRY_SIGN_STEPS) && await page.locator("ol.progress").count() === 0 && TRY_SIGN_STEPS.length === 6,
    `${tag}: one progress indicator, six steps: ${TRY_SIGN_STEPS.join(" → ")}`);
  // ── The opening (1.1): one sentence, one button. ──
  check(await page.locator("#scr-0").isVisible() && (await page.locator("#s0-head").innerText()).trim() === W.intro.head && (await page.locator("#go-start").innerText()).trim() === W.intro.start
    && JSON.stringify(await dots(page)) === '["-","-","-","-","-","-"]' && (await page.locator("#pg-count").innerText()).trim() === "6 steps · about a minute",
    `${tag}: the opening: "${W.intro.head}", one button "${W.intro.start}"`);
  await measure(page, tag, 0);
  await shot(page, `${tag}-0-intro.png`);
  await page.click("#go-start");
  await page.waitForSelector("#scr-1:not([hidden])");
  check(JSON.stringify(await dots(page)) === '["on","-","-","-","-","-"]' && await page.locator("#pg-1").getAttribute("aria-current") === "step" && (await page.locator("#pg-count").innerText()).trim() === `1 of 6 · ${TRY_SIGN_STEPS[0]}`,
    `${tag}: step 1 of 6 under way`);
  // The header and the sticky main button are opaque: nothing shows through them while the card scrolls.
  const opaque = await page.evaluate(`(() => {
    const alpha = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); const p = m ? m[1].split(",").map((x) => x.trim()) : []; return p.length === 4 ? Number(p[3]) : p.length === 3 ? 1 : 0; };
    const h = getComputedStyle(document.querySelector("header.top")), b = getComputedStyle(document.querySelector("#scr-1 .bar"));
    return { header: alpha(h.backgroundColor), blur: h.backdropFilter, bar: alpha(b.backgroundColor), sticky: b.position };
  })()`) as { header: number; blur: string; bar: number; sticky: string };
  check(opaque.header === 1 && (opaque.blur === "none" || opaque.blur === "") && opaque.bar === 1 && opaque.sticky === "sticky", `${tag}: the header and the sticky main button are opaque (header ${opaque.header}, button bar ${opaque.bar}, ${opaque.sticky})`);

  await openWorld(page, tag, false);
  check(/^[0-9a-f]{16}$/.test((await page.locator("#w-id").textContent() ?? "").trim()), `${tag}: the test world opened when the page was shown, with no click`);
  // From 1024 px the diagram beside the story: one policy, three locks; Purser's limit and the signature lit on screen 1.
  const dg = await page.evaluate(`(() => {
    const d = document.getElementById("diagram"), s = document.getElementById("scr-1");
    if (!d.checkVisibility()) return null;
    const r = d.getBoundingClientRect(), q = s.getBoundingClientRect();
    const lit = [...d.querySelectorAll(".dn")].filter((n) => getComputedStyle(n).opacity === "1" && !n.classList.contains("d-policy")).map((n) => n.classList[1]);
    return { left: r.left, top: r.top, bottom: r.bottom, storyTop: q.top, locks: d.querySelectorAll(".dlocks li").length, lit };
  })()`) as { left: number; top: number; bottom: number; storyTop: number; locks: number; lit: string[] } | null;
  if (width >= 1024) {
    check(!!dg && dg.left > width * 0.45 && dg.bottom <= height && dg.locks === 3 && Math.abs(dg.top - dg.storyTop) <= 2,
      `${tag}: the diagram "one policy → three locks" beside the story (from x ${Math.round(dg?.left ?? 0)}, three locks, level with the screen, above the fold)`);
    await page.waitForTimeout(400);
    const lit = (await page.evaluate(`[...document.querySelectorAll("#diagram .dn")].filter((n) => getComputedStyle(n).opacity === "1" && !n.classList.contains("d-policy")).map((n) => n.classList[1]).join()`)) as string;
    check(lit === "d-purser,d-sign", `${tag}: on screen 1 the diagram lights Purser's limit and the signature (${lit})`);
    check((await motion(page)).filter((a) => a.name === "dnlit").length === 2, `${tag}: the diagram's lit parts light up as the step opens`);
    // 1.2 on desktop: the lock that just stopped another payment, in one line, with the real example as a link.
    check(await page.locator("#diagram .dstop").isVisible() && /^Just stopped another payment · a real one$/.test((await page.locator("#diagram .dstop").innerText()).trim()) && !!(await page.locator("#dg-real").getAttribute("href")),
      `${tag}: on screen 1 the diagram says the Purser lock just stopped another payment, with a real example linked`);
  } else check(dg === null, `${tag}: below 1024 px the diagram is not shown`);

  // ── Screen 1: the agent's request. ──
  check((await page.locator("#s1-head").innerText()).trim() === W.ask.head && (await page.locator("#s1-other > summary").innerText()).trim() === W.ask.other, `${tag}: screen 1 says "${W.ask.head}", and "${W.ask.other}" in one line`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const terms = JSON.parse((await page.locator("#s1-terms pre.terms").textContent()) ?? "{}") as Record<string, any>;
  check((await page.locator("#s1-amt").innerText()).trim() === "EUR 1,850.00" && (await page.locator("#s1-to").innerText()).includes(terms.payee.replace(/ \(test payee\)$/, "")) && (await page.locator("#s1-to").innerText()).includes("INV-2026-118") && !(await page.locator("#s1-ask").innerText()).includes("Treasury agent"),
    `${tag}: the payment in sight: EUR 1,850.00 to ${terms.payee}, invoice INV-2026-118`);
  // Spec 6b: the agents' steps came in one by one, each from the server's answer; then they fold under "What the agents did".
  const steps = await page.locator("#s1-steps li.st").evaluateAll((ls: Element[]) => ls.map((l) => `${(l as HTMLElement).dataset.step}:${(l as HTMLElement).dataset.state}`)) as string[];
  check(steps.join() === "read:done,check:done,quote:done,advise:done,ready:done" && !(await page.locator("#s1-steps").isVisible()) && (await page.locator("#s1-did > summary").innerText()).trim() === W.ask.did,
    `${tag}: the five steps came in (${steps.join(" ")}) and fold under "${W.ask.did}"`);
  if (!args.live) {
    check(terms.agent_advice === (tag === "360-dark" ? "none" : "pay_now") && (tag === "360-dark" ? await page.locator("#s1-advice").count() === 0 : (await page.locator("#s1-advice").innerText()).trim() === "Advice: pay now"),
      `${tag}: the agent's advice in sight and in the signed terms (agent_advice ${terms.agent_advice})`);
    await page.locator("#s1-did > summary").click();
    const did = await page.locator("#s1-did").innerText();
    const ticks = await page.locator("#s1-did ul.ticks li.ok").count();
    check(/read_invoice · stand-in · 0\.3 s · req_standin_reader/.test(did) && /quote · stand-in · [\d.]+ s · stand-in-\d{4}/.test(did) && (tag === "360-dark" || /advise · stand-in · 0\.4 s · req_stand-in-advice-\d{4}/.test(did)) && ticks === 4
      && did.includes("Needed EUR 1,870.00 (invoice + EUR 20.00 fee ceiling). Free EUR 1,000.00 above the floor. Code converts the EUR 870.00 short.") && did.includes("The stand-in read: Pay EUR 1,850.00 to Alpine Packaging, IBAN …0118."),
      `${tag}: "${W.ask.did}": each call with its model, time and request id, Purser's code's four checks, the plan in code's words, what the reader read`);
    check((await page.locator('#st-read .pill[data-label]').innerText()).trim() === "stand-in, not Claude" && (await page.locator('#st-check .sl b').innerText()).trim() === "Purser's code",
      `${tag}: each step says who did it: the reader (labelled), Purser's code`);
    await shot(page, `${tag}-1e-agents.png`);
    await page.locator("#s1-did > summary").click();
  } else {
    // Live (spec 6b): the real agents, or their recordings, or code, each labelled; their structure, not a stand-in's words.
    const readLabel = ((await page.locator("#st-read .pill[data-label]").textContent()) ?? "").trim(); // in the closed fold
    const adviceLabel = (await page.locator("#s1-ask .who .pill").innerText()).trim();
    check(LIVE_READ_LABEL.test(readLabel) && LIVE_ADVICE_LABEL.test(adviceLabel), `${tag}: the reader and the adviser are labelled (${readLabel} · ${adviceLabel})`);
    await page.locator("#s1-did > summary").click();
    const did = await page.locator("#s1-did").innerText();
    const ticks = await page.locator("#s1-did ul.ticks li.ok").count();
    check(ticks === 4 && did.includes("Needed EUR 1,870.00 (invoice + EUR 20.00 fee ceiling). Free EUR 1,000.00 above the floor. Code converts the EUR 870.00 short.")
      && (!/^Claude Sonnet/.test(readLabel) || /read_invoice · claude-[a-z0-9-]+ · [\d.]+ s · req_\S+/.test(did)) && (!/^Claude Opus/.test(adviceLabel) || /advise · claude-[a-z0-9-]+ · [\d.]+ s · req_\S+/.test(did)),
      `${tag}: "${W.ask.did}": Purser's code's four checks, the plan in code's words, and each live call with its Claude model and request id (req_…)`);
    await shot(page, `${tag}-1e-agents.png`);
    await page.locator("#s1-did > summary").click();
    if (/^Claude Opus/.test(adviceLabel)) {
      // The reason: every amount in it one of code's numbers for this payment, as the server checked it.
      const says = (await page.locator("#s1-ask .says").innerText()).trim();
      const fx = terms.fx as { sell_amount: string; buy_amount: string; client_rate: string; valid_to_at: string } | null;
      const today = new Date(Date.parse(String(terms.expires_at)) - 3_600_000).toISOString().slice(0, 10); // the world opened an hour before it expires
      const due = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      const sold = fx ? (Math.round(800_000 - Number(fx.sell_amount) * 100) / 100).toFixed(2) : "8000.00";
      const facts = { proposalId: "T-0002", invoiceNo: "INV-2026-118", vendor: "Alpine Packaging", amount: String(terms.amount), dueDate: due, today, eurAvailable: "26000.00", eurFloor: "25000.00", eurObligations: "0.00",
        usdAvailable: "8000.00", usdFloor: "3000.00", quote: fx ? { sell: `USD ${fx.sell_amount}`, buy: `EUR ${fx.buy_amount}`, rate: fx.client_rate, validTo: fx.valid_to_at } : null, after: { eurFree: "0.00", usdAvailable: sold }, feeMax: "20.00" };
      const advised = /^wait_until (\S+)$/.exec(String(terms.agent_advice))?.[1];
      check(amountsFit(says, adviceGiven(facts, "500.00", advised ? [advised] : [])) && cleanReason(says) === says, `${tag}: Opus's reason is one or two plain sentences, every amount one of code's numbers: "${says.slice(0, 60)}…"`);
      await page.evaluate(`document.getElementById("s1-terms").open = true`);
      const vm = page.locator("#s1-terms-body > div:nth-child(2) details.more");
      await vm.locator("summary").click();
      check(/^Request id req_\S+ \(claude-[a-z0-9-]+\)\./.test((await vm.locator("p").innerText()).trim()), `${tag}: "Show the exact terms" names the reason's request id (req_…) and its Claude model`);
      await page.evaluate(`document.getElementById("s1-terms").open = false`);
    }
  }
  if (!args.live) {
    const q = terms.fx as { sell_amount: string; sell_currency: string } | null;
    check(!!q && q.sell_amount === "982.82" && (await page.locator("#s1-fx").innerText()).trim() === `stand-in quote: ${q.sell_currency} ${q.sell_amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`,
      `${tag}: the quote in one line under the amount (${(await page.locator("#s1-fx").innerText()).trim()}), labelled a stand-in here`);
  }
  check((await page.locator("#k-status").innerText()).trim() === "" && await page.locator("#go-sign").isEnabled() && (await page.locator("#go-sign").innerText()).trim() === W.ask.sign,
    `${tag}: no passkey yet; one button, "${W.ask.sign}"`);
  await measure(page, tag, 1, Date.now() - t0);
  await shot(page, `${tag}-1-ask.png`);
  await layout(page, tag, "screen 1", width);
  // On a phone (Max, 6 Nov): the heading below the header; every label of the terms on one line; the terms' last row
  // readable above the sticky button.
  if (mobile) {
    const top = await page.evaluate(`(() => ({ h: document.getElementById("s1-head").getBoundingClientRect().top, bar: document.querySelector("header.top").getBoundingClientRect().bottom }))()`) as { h: number; bar: number };
    check(top.h >= top.bar, `${tag}: the heading is below the header (heading top ${Math.round(top.h)} px, header bottom ${Math.round(top.bar)} px)`);
  }
  await page.locator("#s1-terms > summary").click();
  const labels = await page.evaluate(`(() => [...document.querySelectorAll("#s1-terms dl.facts dt")].map((dt) => { const r = document.createRange(); r.selectNodeContents(dt); const tops = new Set([...r.getClientRects()].map((b) => Math.round(b.top))); return [dt.textContent, tops.size]; }))()`) as [string, number][];
  check(labels.length >= 6 && labels.every(([, n]) => n === 1) && labels.some(([t]) => t === "Proposal expires"),
    `${tag}: every label of the terms is on one line (${labels.filter(([, n]) => n !== 1).map(([t]) => t).join(", ") || labels.map(([t]) => t).join(" · ")})`);
  check(await clearOfBar(page, "#s1-terms dl.facts > dd:last-child", 1), `${tag}: scrolled to it, the terms' last row is not under the sticky button`);
  if (mobile) await shot(page, `${tag}-1b-terms.png`);

  // The quote's end (once, at 390 px light): "expired", the one action is "Get a new quote", new terms, a new hash.
  if (!args.live && tag === "390-light") {
    const before = await page.locator("#s1-terms .hash").getAttribute("data-hash");
    fxStandIn.validityMs = 15 * 60_000;
    await page.waitForSelector("#go-quote:not([hidden])", { timeout: 30_000 });
    check((await page.locator("#q-left").innerText()).trim() === "expired" && (await page.locator("#q-status").innerText()).trim() === "Quote expired. Get a fresh one and sign again." && await page.locator("#go-sign").isHidden(),
      `${tag}: the quote expires: "expired", "Quote expired. Get a fresh one and sign again.", nothing to sign`);
    const rows = await page.locator("#s1-terms dl.facts dt").allInnerTexts() as string[];
    check(rows.includes("Proposal expires") && rows.includes("Quote expires") && !rows.includes("Expires"), `${tag}: the two expiry rows read "Proposal expires" and "Quote expires"`);
    check(await page.locator(".btn.primary:visible").count() === 1 && (await page.locator(".btn.primary:visible").innerText()).trim() === "Get a new quote", `${tag}: while the quote is expired, the one main button is "Get a new quote"`);
    await shot(page, `${tag}-1c-quote-expired.png`);
    await page.click("#go-quote");
    await page.waitForFunction(() => document.getElementById("q-status")?.classList.contains("ok"));
    const after = await page.locator("#s1-terms .hash").getAttribute("data-hash");
    const nextId = (JSON.parse((await page.locator("#s1-terms pre.terms").textContent()) ?? "{}") as { fx: { quote_id: string } }).fx.quote_id;
    check(after !== before && nextId !== terms.fx.quote_id && /^in \d+ min/.test(await page.locator("#q-left").innerText()) && await page.locator("#go-sign").isEnabled(),
      `${tag}: "Get a new quote": new quote ${nextId.slice(0, 13)}…, new terms, a new hash, "Sign with Face ID" on again`);
    Object.assign(terms, JSON.parse((await page.locator("#s1-terms pre.terms").textContent()) ?? "{}"));
  }
  // With the passkey made first (its signature stopped on the way: the request to the server fails once), the quote
  // expires: signing goes off and stays off until a new quote is here; the passkey is kept.
  if (!args.live && tag === "390-dark") {
    let once = true;
    await page.route("**/api/try-sign/sign", (route: { abort(): Promise<void>; continue(): Promise<void> }) => { if (once) { once = false; return route.abort(); } return route.continue(); });
    await page.click("#go-sign");
    await page.waitForFunction(() => /bad/.test(document.getElementById("s1-status")?.className ?? ""));
    check(/registered in this world only/.test(await page.locator("#k-status").innerText()) && /server cannot be reached/.test(await page.locator("#s1-status").innerText()), `${tag}: the passkey is made; the signature did not reach the server, nothing signed`);
    await page.unroute("**/api/try-sign/sign");
    // The request this check stopped on purpose logs its own failure in the console: that one line is the check's, not the page's.
    errors.splice(0, errors.length, ...errors.filter((e) => !/^Failed to load resource: net::ERR_FAILED$/.test(e)));
    fxStandIn.validityMs = 15 * 60_000;
    await page.waitForSelector("#go-quote:not([hidden])", { timeout: 30_000 });
    check(await page.locator("#go-sign").isHidden() && (await page.locator("#q-left").innerText()).trim() === "expired", `${tag}: the quote expires: "Sign with Face ID" is off`);
    await page.waitForTimeout(1500);
    check(await page.locator("#go-sign").isHidden(), `${tag}: and stays off while the quote is expired`);
    await page.click("#go-quote");
    await page.waitForFunction(() => document.getElementById("q-status")?.classList.contains("ok"));
    check(await page.locator("#go-sign").isEnabled() && /is kept/.test(await page.locator("#k-status").innerText()), `${tag}: with the new quote, "Sign with Face ID" is on again (the passkey kept)`);
    Object.assign(terms, JSON.parse((await page.locator("#s1-terms pre.terms").textContent()) ?? "{}"));
  }

  // The agent's sentence: who wrote it, said on the pill; the request id behind "more".
  if (!args.live) {
    const pill = page.locator("#s1-ask .who .pill");
    const says = (await page.locator("#s1-ask .says").innerText()).trim();
    if (tag === "360-dark") {
      check((await pill.innerText()).trim() === "fixed text · the live agent did not answer in time, or not in the expected shape" && await pill.getAttribute("data-voice") === "code" && says === "Alpine Packaging's invoice is due Friday. It is more than I may pay alone, so I ask you.",
        `${tag}: the agent down: the fixed sentence, labelled with why`);
    } else {
      check((await pill.innerText()).trim() === "stand-in, not Claude" && await pill.getAttribute("data-voice") === "live" && says === "It needs EUR 1870.00 with the fee ceiling and only EUR 1000.00 is free, so the FX buys the EUR 870.00 short for USD 982.82. It is above the EUR 500.00 I may pay alone, so you sign it with Face ID.",
        `${tag}: the agent's reason from the (labelled) stand-in for Claude Opus, code's numbers in it: "${says.slice(0, 40)}…"`);
      await page.evaluate(`document.getElementById("s1-terms").open = true`);
      const vm = page.locator("#s1-terms-body > div:nth-child(2) details.more");
      await vm.locator("summary").click();
      check(/^Request id req_stand-in-advice-\d{4} \(stand-in\)\. The agent was given only the invoice and this test world's balances, floors, plan and quote, never your words\./.test((await vm.locator("p").innerText()).trim()),
        `${tag}: "Show the exact terms" names who wrote the reason, and its "more" the request id and what the agent was given`);
    }
  }
  // No quote marks around the agent's words (Max's review): none in the text, none drawn by CSS.
  const marks = await page.evaluate(`[...document.querySelectorAll(".says, #k-says")].map((n) => [getComputedStyle(n, "::before").content, getComputedStyle(n, "::after").content, n.tagName, (n.textContent || "").trim()])`) as [string, string, string, string][];
  check(marks.length > 0 && marks.every(([b, a, tag, t]) => (b === "none" || b === "normal") && (a === "none" || a === "normal") && tag !== "Q" && !/^["“'‘]|["”'’]$/.test(t)),
    `${tag}: the agent's words stand without quote marks (${marks.length} places: ${marks.map(([b, a, t]) => `${t} ${b}/${a}`).join(", ")})`);
  // The exact terms, behind "Show the exact terms".
  await page.evaluate(`document.getElementById("s1-terms").open = true`);
  const facts = Object.fromEntries((await page.locator("#s1-terms dl.facts").evaluate((d: Element) => [...d.querySelectorAll("dt")].map((t) => [t.textContent, t.nextElementSibling?.textContent])))) as Record<string, string>;
  const iban = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();
  check(facts.Amount === "EUR 1,850.00" && facts.Beneficiary === terms.payee && facts.IBAN === iban(terms.payee_iban ?? "") && facts.Reference === terms.reference && facts.Proposal === "T-0002" && /^in \d+ min/.test(facts["Proposal expires"] ?? ""),
    `${tag}: the exact terms: amount, beneficiary, IBAN ${facts.IBAN}, reference, proposal, expiry`);
  const hash = (await page.locator("#s1-terms .hash").getAttribute("data-hash")) ?? "";
  if (!args.live) {
    const q = terms.fx as { quote_id: string; source: string };
    check(!!q && q.source === "stand-in" && (facts["FX quote"] ?? "").startsWith("EUR 870.00 for USD 982.82 ") && (facts["FX quote"] ?? "").includes(`quote ${q.quote_id.slice(0, 8)}…`) && /^in \d+ min/.test(facts["Quote expires"] ?? ""),
      `${tag}: the FX quote is in the terms and the table (${facts["FX quote"]}), with its countdown`);
    const fxq = page.locator("#s1-terms .fxq.live");
    check(await fxq.count() === 1 && (await fxq.innerText()).includes("Used in this signature") && (await fxq.innerText()).includes("Stand-in quote (local check, not Airwallex)") && (await fxq.innerText()).includes(`Quote ${q.quote_id.slice(0, 8)}…${q.quote_id.slice(-4)}`),
      `${tag}: the quote marked "Used in this signature" (here a labelled stand-in)`);
  }
  check(/^[0-9a-f]{64}$/.test(hash) && hash === sha256(canonical(terms)), `${tag}: the terms' hash, checked on the device and here`);
  const short = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;
  check((await page.locator("#s1-terms .hash code").innerText()).trim() === short(hash) && await page.locator("#s1-terms .hash code").getAttribute("title") === hash,
    `${tag}: the hash is shown shortened, first 12 and last 8 (${short(hash)}), the whole of it on hover`);
  await page.locator("#s1-terms .hash button.exp").click();
  check((await page.locator("#s1-terms .hash code").innerText()).trim() === hash && await page.locator("#s1-terms .hash button.exp").getAttribute("aria-expanded") === "true", `${tag}: a tap on the hash shows all 64 characters`);
  await page.locator("#s1-terms .hash button.exp").click();
  check((await page.locator("#s1-terms .basis").innerText()).trim() === cfoApproval().line, `${tag}: names the CFO's real sheet it follows, from the record: ${cfoApproval().line.slice(0, 60)}…`);
  await page.evaluate(`document.getElementById("s1-terms").open = false`);

  // The payment a rule stopped, behind its closed line: nothing to sign, and the three locks.
  check((await page.locator("#s1-other > summary").innerText()).trim() === W.ask.other && !(await page.locator("#s1-other").evaluate((d: HTMLDetailsElement) => d.open)), `${tag}: "${W.ask.other}" closed`);
  await page.locator("#s1-other > summary").click();
  const blocked = page.locator("#s1-blocked article.prop.blocked");
  check((await blocked.innerText()).includes("T-0001") && (await blocked.innerText()).includes("Check: fail"), `${tag}: (a) shows "Check: fail" and its rule`);
  check((await blocked.innerText()).includes("Reserve floor"), `${tag}: (a) names the blocking rule`);
  check(await blocked.locator("button").count() === 0, `${tag}: (a) has no signing button`);
  if (!args.live) check((await blocked.locator(".who .pill").innerText()).trim() === "fixed text, no model call", `${tag}: the blocked proposal's sentence is fixed text, labelled`);
  const locks = await blocked.locator(".lock").evaluateAll((ls: Element[]) => ls.map((l) => ({ id: (l as HTMLElement).dataset.lock, hit: l.classList.contains("hit"), text: l.textContent ?? "", href: l.querySelector("a")?.getAttribute("href") ?? "" }))) as { id: string; hit: boolean; text: string; href: string }[];
  check(locks.map((l) => l.id).join() === "purser,airwallex,metal" && locks.filter((l) => l.hit).map((l) => l.id).join() === "purser" && /Stopped this one \(simulated\)/.test(locks[0]!.text),
    `${tag}: (a) three locks, Purser's policy marked as the one that stopped it (simulated)`);
  check(locks.every((l, i) => l.text.includes(`Real example, ${LOCKS[i]!.run}: ${LOCKS[i]!.example}`)), `${tag}: (a) each lock names its real example and the run it is from`);
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
  check(/simulation in your test world; the examples are real/.test(await blocked.innerText()), `${tag}: (a) says the blocked payment is simulated and the examples real`);
  await blocked.locator(".locks").scrollIntoViewIfNeeded();
  await shot(page, `${tag}-1d-locks.png`);
  await layout(page, tag, "screen 1, all open", width);
  await page.locator("#s1-other > summary").click();

  // ── Sign: one tap, the passkey made first. Screen 2. ──
  await page.click("#go-sign");
  await page.waitForSelector("#scr-2:not([hidden])");
  await motionOk(page, tag, "screen 2, the tick draws itself in with a soft green glow", ["draw", "glow"]);
  check(/registered in this world only|is kept/.test(await page.locator("#k-status").textContent() ?? ""), `${tag}: the test passkey is made and registered, then the signature (one tap)`);
  check(JSON.stringify(await dots(page)) === '["done","on","-","-","-","-"]' && (await page.locator("#pg-count").innerText()).trim() === `2 of 6 · ${TRY_SIGN_STEPS[1]}`, `${tag}: verified: step 2 of 6`);
  const ok = await page.locator("#scr-2 .bigok svg").boundingBox();
  check((await page.locator("#r-head").innerText()).trim() === W.signed.head && (await page.locator("#r-line").innerText()).trim() === W.signed.line && !!ok && ok.width >= 48,
    `${tag}: a big green check (${ok ? Math.round(ok.width) : "?"} px): "${W.signed.head}" "${W.signed.line}"`);
  check((await page.locator("#r-exec > span").innerText()).trim() === "EUR 1,850.00 to Alpine Packaging." && /Test transfer test-[0-9a-f]{12}: EUR 1,850\.00/.test(await page.locator("#r-exec details.more").textContent() ?? "") && (await page.locator("#scr-2").innerText()).includes(W.signed.executed),
    `${tag}: "Executed in your test world" by the stand-in: the amount and the payee in sight, the test transfer's id behind "more"`);
  await measure(page, tag, 2);
  await shot(page, `${tag}-2-signed.png`);
  await page.locator("#r-details > summary").click();
  check((await page.locator("#scr-2").innerText()).includes("Verified by the server"), `${tag}: "Verified by the server"`);
  check(await page.locator("#r-hash .hash").getAttribute("data-hash") === hash && (await page.locator("#r-hash code").innerText()).trim() === short(hash), `${tag}: the details show the signed hash, shortened`);
  await page.locator("#r-hash button.copy").click();
  await page.waitForFunction(() => /Copied|Select/.test(document.querySelector("#r-hash button.copy")?.textContent ?? ""));
  const copied = await page.evaluate("navigator.clipboard.readText()") as string;
  check(copied === hash && (await page.locator("#r-hash button.copy").innerText()).includes("Copied"), `${tag}: Copy puts the whole signed hash on the clipboard (${copied.length} characters)`);
  check(await page.locator("#r-checks details.more").count() === 1 && await page.locator("#r-exec details.more").count() === 1, `${tag}: the explanations are one sentence each, the rest behind "more"`);
  check(await page.locator("#scr-2 .receipt details.more").count() === 1 && /^Check it offline with one command, no server: npm run verify-receipt -- receipt\.json\.$/.test((await page.locator("#scr-2 .receipt > p").innerText()).trim()),
    `${tag}: the receipt's explanation is one sentence, the rest behind "more"`);
  // The receipt: downloaded as the visitor would, then checked offline as npm run verify-receipt does.
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#r-receipt")]);
  const saved = join(shots, `${tag}-receipt.json`);
  await download.saveAs(saved);
  const receipt = JSON.parse(readFileSync(saved, "utf8")) as { terms: Record<string, string>; terms_sha256: string; chain: { length: number; head: string; rows: { kind: string; hash: string }[] } };
  const verdict = verifyReceipt(receipt);
  // 6c: the receipt carries the world's hash chain as it was when signed; its checks find this signature's row in it.
  check(verdict.checks.filter((c) => c.check === "chain" || c.check === "chain signature").map((c) => `${c.check}:${c.ok}`).join() === "chain:true,chain signature:true"
    && checkChain(receipt.chain.rows).ok && receipt.chain.rows[0]!.kind === "world_opened" && receipt.chain.rows.some((r) => r.kind === "signature"),
    `${tag}: the receipt carries the world's hash chain (${receipt.chain.length} rows), checked offline, its signature row found`);
  check(download.suggestedFilename() === "receipt.json" && verdict.ok && receipt.terms_sha256 === hash && JSON.stringify(receipt.terms) === JSON.stringify(terms),
    `${tag}: receipt.json downloads and verifies offline (${verdict.checks.filter((c) => c.ok).length} of ${verdict.checks.length} checks)`);
  check(!verifyReceipt({ ...receipt, terms: { ...receipt.terms, amount: "1850.01" } }).ok && !verifyReceipt({ ...receipt, terms: { ...receipt.terms, payee_iban: OTHER_IBAN } }).ok,
    `${tag}: the receipt with one cent more, or another IBAN, fails`);
  check(!/"token"/.test(readFileSync(saved, "utf8")) && Object.keys(receipt).sort().join() === "algorithm,assertion,chain,credential_id,note,origin,public_key,receipt,rp_id,terms,terms_sha256,verified_by_server_at,verify",
    `${tag}: the receipt carries what it needs and no world token`);
  // /try/verify (A3): "Check it yourself" opens the receipt in a page that checks it with WebCrypto, with no server call.
  if (!args.live) {
    const [vp] = await Promise.all([v.context.waitForEvent("page"), page.click("#r-verify")]);
    const p2: Page = vp;
    p2.on("pageerror", (e: Error) => errors.push(`verify: ${e.message}`));
    p2.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(`verify: ${m.text()}`); });
    await p2.waitForSelector("#v-verdict:not([hidden])");
    await p2.waitForLoadState("networkidle");
    const calls: string[] = [];
    p2.on("request", (q: { url(): string }) => calls.push(q.url()));
    const vv = async () => ({ ok: await p2.locator("#v-verdict").getAttribute("data-ok"), failed: await p2.locator("#v-verdict").getAttribute("data-failed"), text: (await p2.locator("#v-verdict").innerText()).trim() });
    check((await p2.locator("#v-lead").innerText()).trim() === "Don't trust our server: check it yourself." && new URL(p2.url()).hash === "", `${tag}: /try/verify: "Don't trust our server: check it yourself."; the receipt came in the link's fragment, then cleared`);
    const good = await vv();
    check(good.ok === "true" && good.text === "Signature valid for these terms", `${tag}: /try/verify: "${good.text}"`);
    check(JSON.stringify(await p2.locator("#v-checks li").evaluateAll((ls: Element[]) => ls.slice(-2).map((l) => `${(l as HTMLElement).dataset.check}:${l.className}`))) === '["chain:ok","chain signature:ok"]'
      && (await p2.locator('#v-terms dd[data-field="chain"]').innerText()).startsWith(`${receipt.chain.length} rows, head ${receipt.chain.head.slice(0, 12)}`), `${tag}: /try/verify checks the receipt's hash chain too, in the browser`);
    await p2.screenshot({ path: join(shots, `${tag}-2b-verify-valid.png`) });
    await layout(p2, tag, "/try/verify, valid", width);
    await p2.click("#v-flip");
    await p2.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "false");
    const flipped = await vv();
    check(flipped.failed === "terms hash" && flipped.text === "Invalid: the terms hash check fails" && (await p2.locator("#v-why").innerText()).includes("the terms were changed") && await p2.locator("#v-terms dd.chg").count() === 1,
      `${tag}: /try/verify: "Change one field" (amount + 0.01): "${flipped.text}"`);
    await layout(p2, tag, "/try/verify, invalid", width);
    await p2.selectOption("#v-field", "payee_iban");
    await p2.waitForFunction(() => document.querySelector("#v-terms dd.chg")?.getAttribute("data-field") === "payee_iban");
    check((await vv()).failed === "terms hash", `${tag}: /try/verify: the IBAN changed instead: invalid, the terms hash check named`);
    await p2.click("#v-flip");
    await p2.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "true");
    check((await vv()).ok === "true", `${tag}: /try/verify: the toggle off: valid again`);
    const file = JSON.parse(readFileSync(saved, "utf8")) as { terms: Record<string, string> };
    await p2.setInputFiles("#v-file", { name: "receipt.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...file, terms: { ...file.terms, currency: "USD" } })) });
    await p2.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "false");
    check((await vv()).failed === "terms hash" && (await p2.locator("#v-status").innerText()).includes("receipt.json"), `${tag}: /try/verify: an uploaded receipt.json with the currency changed: invalid, the terms hash check named`);
    await p2.setInputFiles("#v-file", saved);
    await p2.waitForFunction(() => document.getElementById("v-verdict")?.dataset.ok === "true");
    check((await vv()).ok === "true", `${tag}: /try/verify: the downloaded receipt.json, uploaded: valid`);
    check(calls.length === 0, `${tag}: /try/verify made no request while checking (${calls.length}${calls.length ? `: ${calls.slice(0, 3).join(", ")}` : ""})`);
    await p2.close();
  }
  await layout(page, tag, "screen 2, details open", width);
  await page.locator("#r-details > summary").click();

  // ── Screen 3: try to cheat. "Now try to cheat: change one cent" sends the amount + 0.01 with the same signature. ──
  check((await page.locator("#go-cheat").innerText()).trim() === W.signed.cheat, `${tag}: the one button on screen 2: "${W.signed.cheat}"`);
  const tampers: [string, string, () => Promise<void>, string, string][] = [
    ["amount", "1850.01", async () => { await page.click("#go-cheat"); }, "EUR 1,850.01", TAMPER_VERDICT.cent],
    ["payee_iban", OTHER_IBAN, async () => { await page.click('#cheat-chips .chip[data-cheat="iban"]'); }, iban(OTHER_IBAN), TAMPER_VERDICT.field],
    ["currency", "USD", async () => { await page.click('#cheat-chips .chip[data-cheat="currency"]'); }, "USD", TAMPER_VERDICT.field],
    ...(args.live ? [] : [["fx.client_rate", "1.129678", async () => {
      await page.locator("#t-any > summary").click();
      await page.click('#cheat-chips .chip[data-cheat="cent"]'); // the signed values back first
      await page.waitForFunction(() => !(document.getElementById("t-send") as HTMLButtonElement).disabled);
      await page.fill("#t-amount", terms.amount); await page.fill("#t-rate", "1.129678");
      check(await page.locator('label[data-field="fx.client_rate"]').evaluate((n: Element) => n.classList.contains("chg")) && await page.locator("#t-send").isEnabled(), `${tag}: "Change any field": the FX rate changed is marked, "Send with the same signature" on`);
      await page.click("#t-send");
    }, "1.129678", TAMPER_VERDICT.field] as [string, string, () => Promise<void>, string, string]]),
  ];
  for (const [field, value, act, shown, last] of tampers) {
    await page.evaluate(`document.getElementById("tamper").hidden = true`);
    await act();
    await page.waitForSelector("#tamper:not([hidden])");
    await page.waitForFunction(() => !(document.querySelector("#cheat-chips .chip") as HTMLButtonElement).disabled);
    if (field === "amount") {
      check(JSON.stringify(await dots(page)) === '["done","done","on","-","-","-"]' && (await page.locator("#s3-head").innerText()).trim() === W.cheat.head, `${tag}: screen 3 of 6, "${W.cheat.head}"`);
      await measure(page, tag, 3);
      await shot(page, `${tag}-3-cheat-refused.png`);
    }
    const expect = canonical(field === "fx.client_rate" ? { ...terms, fx: { ...terms.fx, client_rate: value } } : { ...terms, [field]: value });
    if (field === "amount") await motionOk(page, tag, "a refused cheat: the card shakes, the changed field lights red", ["shake", "lightred"]);
    const changedRows = await page.locator("#t-table tr.chg").evaluateAll((rs: Element[]) => rs.map((r) => (r as HTMLElement).dataset.row));
    const pair = await page.locator("#t-table tr.hrow code.hp").evaluateAll((cs: Element[]) => cs.map((c) => ({ title: c.getAttribute("title"), text: (c.textContent ?? "").trim(), marked: c.querySelectorAll(".hx").length }))) as { title: string; text: string; marked: number }[];
    check(pair.length === 2 && pair[0]!.title === hash && pair[1]!.title === sha256(canonical(field === "fx.client_rate" ? { ...terms, fx: { ...terms.fx, client_rate: value } } : { ...terms, [field]: value }))
      && pair[0]!.text === `${hash.slice(0, 12)}…` && pair[0]!.marked === 0 && pair[1]!.marked === [...pair[1]!.title.slice(0, 12)].filter((c, i) => c !== hash[i]).length && pair[1]!.marked > 0,
      `${tag}: cheat ${field}: both hashes side by side in sight (${pair.map((x) => x.text).join(" | ")}), the ${pair[1]?.marked} characters that differ marked`);
    check(JSON.stringify(changedRows) === JSON.stringify([field]) && (await page.locator("#t-table tr.chg").innerText()).includes(shown), `${tag}: cheat ${field}: "You signed / Sent now" marks ${field}, and only it (now ${shown})`);
    await page.locator("#tamper details.more > summary").click();
    const oldH = await page.locator("#t-what .hash.old").getAttribute("data-hash"), newH = await page.locator("#t-what .hash.new").getAttribute("data-hash");
    check(oldH === hash && newH === sha256(expect) && newH !== hash && (await page.locator("#t-what .hash.new code").innerText()).trim() === short(newH ?? ""),
      `${tag}: cheat ${field}: the new hash (${short(newH ?? "")}) next to the signed one (${short(hash)}), behind "more"`);
    const head = await page.locator("#t-head").innerText();
    const why = await page.locator("#t-why").innerText();
    check(head.startsWith("Refused") && why.trim() === `The server refused it: the signature was made for hash ${hash.slice(0, 12)}…, not for your terms (${(newH ?? "").slice(0, 12)}…).` && !/…\.|\.\.\.\./.test(why),
      `${tag}: cheat ${field}: the server refuses the same signature, said once (${why.slice(0, 60)}…)`);
    await page.locator("#tamper details.more > summary").click();
    check((await page.locator("#t-verdict").innerText()).trim() === last && await page.locator("#t-verdict").isVisible() && (await page.locator("#tamper .tagr").innerText()).trim() === W.cheat.refused, `${tag}: cheat ${field}: "${W.cheat.refused}", "${last}"`);
  }
  const chipLines = await page.locator("#cheat-chips .chip").evaluateAll((bs: Element[]) => bs.map((b) => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; })) as number[];
  check(chipLines.every((n) => n === 1), `${tag}: each cheat's label is on one line (${chipLines.join(", ")})`);
  await layout(page, tag, "screen 3", width);
  await page.evaluate(`document.querySelectorAll("#scr-3 details").forEach((d) => { d.open = true; })`);
  await layout(page, tag, "screen 3, all open", width);
  await page.evaluate(`document.querySelectorAll("#scr-3 details").forEach((d) => { d.open = false; })`);

  // ── Screen 4: try to trick the agent (1.3). Each fixed fake invoice is blocked by Purser's own code. ──
  check((await page.locator("#go-trick").innerText()).trim() === W.cheat.next, `${tag}: screen 3's one button: "${W.cheat.next}"`);
  await page.click("#go-trick");
  await page.waitForSelector("#scr-4:not([hidden])");
  check(JSON.stringify(await dots(page)) === '["done","done","done","on","-","-"]' && (await page.locator("#k-head").innerText()).trim() === W.trick.head && JSON.stringify((await page.locator("#trick-chips .chip").allInnerTexts()).map((t: string) => t.trim())) === JSON.stringify(ATTACKS.map((a) => TRICKS[a].label)),
    `${tag}: screen 4 of 6: "${W.trick.head}", two fake invoices: ${ATTACKS.map((a) => TRICKS[a].label).join(" · ")}`);
  for (const attack of ATTACKS) {
    await page.click(`#trick-chips .chip[data-attack="${attack}"]`);
    await page.waitForFunction((a: string) => !document.getElementById("k-result")!.hidden && (document.getElementById("k-doc")!.textContent ?? "").includes(a === "lookalike" ? "Pakaging" : "Pre-approved"), attack);
    await page.locator("#k-did > summary").click();
    const full = (await page.locator("#k-full").innerText()).trim();
    await page.locator("#k-did > summary").click();
    const want = await runTrick(attack, await readerStandIn(TRICKS[attack].text));
    const ibans = await page.locator("#k-ibans .ib").evaluateAll((bs: Element[]) => bs.map((b) => ({ iban: (b as HTMLElement).dataset.iban, text: (b.textContent ?? "").trim(), marked: [...b.querySelectorAll(".hx")].map((x) => x.textContent).join("") }))) as { iban: string; text: string; marked: string }[];
    check(ibans.length === 2 && ibans[0]!.iban === want.known.iban && ibans[0]!.text === want.known.iban && ibans[0]!.marked === "" && ibans[1]!.iban === want.invoice.iban && ibans[1]!.text === want.invoice.iban
      && ibans[1]!.marked === [...want.invoice.iban].filter((c, i) => c !== (i < 4 ? want.known.iban[i] : want.known.iban[want.known.iban.length - want.invoice.iban.length + i])).join("") && ibans[1]!.marked.length > 0,
      `${tag}: trick ${attack}: the new IBAN next to the one on file (${ibans.map((b) => b.text).join(" ≠ ")}), what differs in red (${ibans[1]?.marked})`);
    if (attack === ATTACKS[0]) await motionOk(page, tag, "a fake invoice: it slides in, then the block", ["slidein", "blockin"]);
    check((await page.locator("#k-out").innerText()).trim() === want.outcome && want.blocked && (await page.locator("#k-lesson").innerText()).trim() === "A prompt is not a control." && (await page.locator("#k-says").innerText()).trim() === want.agent.read && await page.locator("#k-says").evaluate((n: Element) => n.tagName + getComputedStyle(n, "::before").content) === "SPANnone"
      && (args.live ? LIVE_TRICK_LABEL.test((await page.locator("#k-label").innerText()).trim()) : (await page.locator("#k-label").innerText()).trim() === "stand-in, not Claude") && (await page.locator("#k-doc").innerText()).trim() === TRICKS[attack].shows && full === TRICKS[attack].text,
      `${tag}: trick ${attack}: the invoice, what the agent read (labelled), then "${want.outcome}" and "A prompt is not a control."`);
    await page.locator("#k-did > summary").click();
    const kcalls = await page.locator("#k-calls").innerText();
    const klabel = (await page.locator("#k-label").innerText()).trim();
    check(args.live ? /read_invoice/.test(kcalls) && (!/^Claude Sonnet/.test(klabel) && !klabel.startsWith("recorded") || /read_invoice · claude-[a-z0-9-]+ · [\d.]+ s · req_\S+/.test(kcalls)) : /read_invoice · stand-in · 0\.3 s · req_standin_reader/.test(kcalls),
      `${tag}: trick ${attack}: "What the agent did" lists its call with model, time and request id`);
    await page.locator("#k-did > summary").click();
    if (attack === "pre_approved") { await measure(page, tag, 4); await shot(page, `${tag}-4-trick.png`); }
  }
  await layout(page, tag, "screen 4", width);

  // ── Screen 5: change the rule. ──
  await page.click("#go-rule");
  await page.waitForSelector("#scr-5:not([hidden])");
  check(JSON.stringify(await dots(page)) === '["done","done","done","done","on","-"]' && (await page.locator("#s4-head").innerText()).trim() === W.rule.head && (await page.locator("#scr-5 .q").innerText()).trim() === W.rule.question,
    `${tag}: screen 5 of 6: "${W.rule.head}" "${W.rule.question}"`);
  const chips = (await page.locator("#rule-chips .chip").allInnerTexts()).map((t: string) => t.trim());
  const labelsOf = async () => await page.locator("#rule-chips .chip").evaluateAll((bs: Element[]) => bs.map((b) => b.getAttribute("aria-label"))) as string[];
  check(JSON.stringify(chips) === JSON.stringify(["€500", "€2,000", "€5,000"]) && JSON.stringify(await labelsOf()) === JSON.stringify(["€500, in force", "€2,000", "€5,000"]) && await page.locator('#rule-chips .chip[data-alone="500.00"] .now svg').count() === 1,
    `${tag}: three amounts: ${chips.join(" · ")}, €500 marked in force (a tick, and its name)`);
  const rl = (await page.locator("#s4-locks li > span:last-child").allInnerTexts()).map((t: string) => t.trim());
  // Each lock with its channel in front (Max's review): Purser the invoices, the Airwallex card the card spend, Metal on chain.
  const channels = (await page.locator("#s4-locks li .ch").allInnerTexts()).map((t: string) => t.trim());
  check(JSON.stringify(channels) === JSON.stringify([LOCK_CHANNELS.purser.short, LOCK_CHANNELS.airwallex.short, LOCK_CHANNELS.metal.short]) && JSON.stringify(channels) === '["Invoices","Card spend","On-chain"]',
    `${tag}: each lock shows its channel: ${channels.join(" · ")}`);
  if (width >= 1024) check(JSON.stringify(await page.locator("#diagram .dlocks small.ch").allTextContents()) === JSON.stringify([LOCK_CHANNELS.purser.long, LOCK_CHANNELS.airwallex.long, LOCK_CHANNELS.metal.long]), `${tag}: the diagram names each lock's channel`);
  const eurOf = (h: string) => Number(/EUR ([\d,]+)/.exec(h)![1]!.replace(/,/g, ""));
  check((await page.locator("#s4-worst").innerText()).trim() === `${W.rule.worst} €${eurOf(WORST.headline).toLocaleString("en-US")} a month` && JSON.stringify(rl) === JSON.stringify([`Purser: up to €500 alone, ${ALONE_PER_DAY} a day`, "Airwallex card: €25 each, €50 a month", "Metal mandate: 25 test USD each"]),
    `${tag}: one honest worst case (€${eurOf(WORST.headline).toLocaleString("en-US")} a month) and the three locks, Purser first: ${rl.join(" · ")}`);
  await page.locator("#s4-more > summary").click();
  check((await page.locator("#s4-full").innerText()).trim() === WORST.headline && (await page.locator("#s4-more").innerText()).includes(mainRunWorst()), `${tag}: behind "more": the full figure and why the main run's is EUR 300 (${mainRunWorst()})`);
  await page.locator("#s4-more > summary").click();
  check(await page.locator("#go-apply").isDisabled() && (await page.locator("#s4-note").innerText()).trim() === "", `${tag}: nothing chosen yet: the one button is off`);
  await page.click('#rule-chips .chip[data-alone="500.00"]');
  check(await page.locator("#go-apply").isDisabled() && (await page.locator("#s4-note").innerText()).trim() === W.rule.same, `${tag}: the rule in force: "${W.rule.same}"`);
  await page.click('#rule-chips .chip[data-alone="2000.00"]');
  // The figures count up to the new value (drawn over the final words, which are there at once), the locks light one by one.
  check(await page.locator("#s4-worst.counting[data-count]").count() === 1 && await page.locator("#s4-locks.lit").count() === 1, `${tag}: choosing €2,000: the worst case counts up, the three locks light up one by one`);
  await motionOk(page, tag, "choosing an amount", ["lockon"]);
  await page.waitForFunction(() => !document.querySelector("#s4-worst.counting"), undefined, { timeout: 2000 });
  check(await page.locator("#s4-argue #s4-worst + #s4-note").count() === 1 && await page.locator("#s4-argue.looser").count() === 1, `${tag}: the worst case is the argument: "${W.rule.looser}" right under it`);
  check((await page.locator("#s4-note").innerText()).trim() === W.rule.looser && (await page.locator("#go-apply").innerText()).trim() === W.rule.sign && await page.locator("#go-apply").isEnabled(),
    `${tag}: €2,000 is looser: "${W.rule.looser}", the button "${W.rule.sign}"`);
  // The worst case moves with the choice (Max, 7 Nov, 1.4): the line names €2,000, and what it adds a month shows beside it.
  const addMonth = (Number(/EUR ([\d,]+)/.exec(worldExpo("2000.00").headline)![1]!.replace(/,/g, "")) - Number(/EUR ([\d,]+)/.exec(WORST.headline)![1]!.replace(/,/g, "")));
  check((await page.locator("#s4-worst").innerText()).trim() === `${W.rule.worst} €${eurOf(worldExpo("2000.00").headline).toLocaleString("en-US")} a month (+€${addMonth.toLocaleString("en-US")})` && addMonth === 1500 * ALONE_PER_DAY * 31 && (await page.locator("#rl-purser > span:last-child").innerText()).trim() === `Purser: up to €2,000 alone, ${ALONE_PER_DAY} a day`,
    `${tag}: choosing €2,000: the worst case with what it adds (+€${addMonth.toLocaleString("en-US")}), Purser's lock follows`);
  if (width >= 1024) {
    await page.waitForTimeout(400);
    const lit = (await page.evaluate(`[...document.querySelectorAll("#diagram .dn")].filter((n) => getComputedStyle(n).opacity === "1" && !n.classList.contains("d-policy")).map((n) => n.classList[1]).join()`)) as string;
    check(lit === "d-purser,d-airwallex,d-metal" && (await page.locator("#dg-purser").innerText()).trim() === `€2,000 alone, ${ALONE_PER_DAY} a day`, `${tag}: on screen 5 the diagram lights the three locks, Purser's with the new amount (${lit})`);
  }
  await measure(page, tag, 5);
  await shot(page, `${tag}-5-rule.png`);
  await layout(page, tag, "screen 5", width);
  const before = (await v.signCount())[0] ?? 0;
  await page.click("#go-apply");
  await page.waitForSelector("#scr-6:not([hidden])");

  // ── Screen 6: the agent pays its next invoice alone. ──
  const next = page.locator("#s5-next");
  check(JSON.stringify(await dots(page)) === '["done","done","done","done","done","on"]' && (await page.locator("#s5-head").innerText()).trim() === W.alone.head, `${tag}: screen 6 of 6: "${W.alone.head}"`);
  await motionOk(page, tag, "paid alone: the payment moves through the three locks", ["fill", "stop"]);
  check(JSON.stringify(await page.locator("#s5-next ol.flow li").evaluateAll((ls: Element[]) => ls.map((l) => `${(l as HTMLElement).dataset.stop}:${(l.textContent ?? "").trim()}`))) === JSON.stringify(["purser:Purser", "rail:Airwallex · Metal", "paid:Paid"]) && await page.locator('#s5-next ol.flow[data-state="alone"]').count() === 1,
    `${tag}: screen 6: the payment goes Purser → Airwallex · Metal → Paid`);
  check(await next.getAttribute("data-proposal") === NEXT_INVOICE.id && await next.getAttribute("data-state") === "alone" && (await next.innerText()).includes("EUR 1,240.00")
    && (await next.innerText()).includes("Paid alone under your new policy (up to €2,000). No signature needed."), `${tag}: the next invoice (${NEXT_INVOICE.id}, EUR 1,240.00) "Paid alone under your new policy (up to €2,000). No signature needed."`);
  check(((await v.signCount())[0] ?? 0) === before + 1 && (await page.locator("#w-balance").textContent())?.trim() === "EUR 25,020.00",
    `${tag}: one signature, over the rule; none for the invoice; the stand-in ran it (balance EUR 25,020.00)`);
  check((await page.locator("#s5-worst").innerText()).trim() === `Your new rule: up to €2,000 alone, ${ALONE_PER_DAY} times a day (+€${(1500 * ALONE_PER_DAY * 31).toLocaleString("en-US")} a month worst case).`, `${tag}: screen 6: the new rule in one small line, with what it did to the worst case`);
  if (width >= 1024) {
    await page.waitForTimeout(400);
    const lit = (await page.evaluate(`[...document.querySelectorAll("#diagram .dn")].filter((n) => getComputedStyle(n).opacity === "1" && !n.classList.contains("d-policy")).map((n) => n.classList[1]).join()`)) as string;
    check(lit === "d-alone", `${tag}: on screen 6 the diagram lights "paid alone" (${lit})`);
  }
  await measure(page, tag, 6, Date.now() - t0);
  await shot(page, `${tag}-6-paid-alone.png`);
  await layout(page, tag, "screen 6", width);

  // ── The closing card (1.5): what the visitor did, then three ways on. ──
  check((await page.locator("#go-done").innerText()).trim() === W.alone.finish, `${tag}: screen 6's one button: "${W.alone.finish}"`);
  // 6c: on the last screen, the world's hash chain: its length, its head, and "Verify the chain" in the browser. At 390 px
  // dark one row comes back changed on its way to the page (as a server that rewrote it would send it): the page finds it.
  const tamper = !args.live && tag === "390-dark";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (tamper) await page.route("**/api/try-sign/chain", async (route: any) => { const res = await route.fetch(); const j = await res.json(); j.chain.rows[2].data_sha256 = sha256("not what happened"); await route.fulfill({ response: res, body: JSON.stringify(j) }); });
  const [chainRes] = await Promise.all([page.waitForResponse("**/api/try-sign/chain"), page.click("#go-done")]);
  await page.waitForSelector("#scr-7:not([hidden])");
  const served = ((await chainRes.json()) as { chain: { length: number; head: string; rows: { hash: string }[] } }).chain;
  await page.waitForSelector("#c-box:not([hidden])");
  // (With the changed row, the chain as served no longer checks: that is what "Verify the chain" must find below.)
  check(checkChain(served.rows).ok === !tamper && served.length > receipt.chain.length && (tamper || JSON.stringify(served.rows.slice(0, receipt.chain.length)) === JSON.stringify(receipt.chain.rows))
    && (await page.locator("#c-len").innerText()).trim() === `${served.length} events` && (await page.locator("#c-head").innerText()).trim() === `${served.head.slice(0, 12)}…` && await page.locator("#c-head").getAttribute("title") === served.head
    && (await page.locator("#c-verify").innerText()).trim() === W.done.chain.verify && !(await page.locator("#c-verify").getAttribute("class"))!.includes("primary"),
    `${tag}: the last screen: the hash chain's length (${served.length} events) and head (${served.head.slice(0, 12)}…), the receipt's chain its start, and "${W.done.chain.verify}"`);
  await page.click("#c-verify");
  await page.waitForFunction(() => /ok|bad/.test(document.getElementById("c-status")?.className ?? ""));
  const cv = (await page.locator("#c-status").innerText()).trim();
  if (tamper) {
    await page.unroute("**/api/try-sign/chain");
    check(cv === "Broken at row 3: its hash does not match." && await page.locator("#c-box").getAttribute("data-verified") === "false", `${tag}: a row changed on its way: "Verify the chain" finds it (${cv})`);
  } else check(cv === `${W.done.chain.ok}: ${served.length} of ${served.length} rows.` && await page.locator("#c-verify").isHidden() && await page.locator("#c-box").getAttribute("data-verified") === "true",
    `${tag}: "Verify the chain" recomputes every row in the browser: "${cv}"`);
  const did = `${W.done.lead} ${[W.done.items.signed, W.done.items.cheat, W.done.items.trick, W.done.items.rule, W.done.items.alone].join(" · ")}.`;
  check((await page.locator("#d-head").innerText()).trim() === W.done.head && (await page.locator("#scr-7 .lead1").innerText()).trim() === did && JSON.stringify(await dots(page)) === '["done","done","done","done","done","done"]',
    `${tag}: the closing card: "${did} ${W.done.head}"`);
  const ends = await page.locator("#t-end a").evaluateAll((as: Element[]) => as.map((a) => ({ text: (a.textContent ?? "").trim(), href: a.getAttribute("href") }))) as { text: string; href: string }[];
  check(JSON.stringify(ends) === JSON.stringify(TRY_SIGN_END.map((e) => ({ text: e.label, href: e.href }))),
    `${tag}: three ways on: ${ends.map((e) => `"${e.text}" (${e.href})`).join(", ")}`);
  check(await page.locator("#scr-7 .btn.primary").count() === 1 && await page.locator("#scr-7 .ends .btn").count() === 2, `${tag}: the closing card: one main button, two more buttons`);
  if (!args.live) {
    const proof = await (await fetch(`${local.url}/proof`)).text();
    check(/id="faceid"/.test(proof) && /P-0005/.test(proof.slice(proof.indexOf('id="faceid"'))), `${tag}: /proof#faceid is the section with the CFO's Face ID approvals, P-0005 among them`);
    check((await fetch(`${local.url}/trace`)).status === 200, `${tag}: "Trace a real payment" leads to a page the site serves (/trace)`);
  }
  await measure(page, tag, 7, Date.now() - t0);
  await shot(page, `${tag}-7-done.png`);
  await layout(page, tag, "the closing card", width);
  // A6: a refused signature is an answer (HTTP 200, verified false), so the whole visit logs no console error at all.
  check(errors.length === 0, `${tag}: A6: 0 console errors across the whole visit (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
  await v.context.close();
}

if (!args.live && !ONLY) {
  // ── The full policy (#71), at 390 and 1440 px: behind "Show all fields and what Purser sends" on screen 4. ──
  for (const width of [390, 1440] as const) {
    const tag = `policy-${width}`;
    const v = await visitor({ width, ip: `198.51.13${width === 390 ? 0 : 1}.7` });
    const { page, errors } = v;
    await openWorld(page, tag);
    await toRule(page);
    const worldId = ((await page.locator("#w-id").textContent()) ?? "").trim();
    const pstatus = async () => (await page.locator("#p-status").innerText()).trim();
    check((await page.locator("#p-open").innerText()).trim() === TRY_POLICY.open && await page.locator("#p-body").isHidden(), `${tag}: every field is behind "${TRY_POLICY.open}", closed`);
    await page.locator("#p-open").click();
    const start = await formPolicy(page);
    const t = start.agents.treasury;
    check(t.per_tx === "25.00" && t.monthly === "50.00" && t.mccs.join() === "5734" && t.currencies.join() === "EUR" && t.alone === "500.00" && start.reserve_floor === "25000.00" && /^\d{4}-\d{2}-\d{2}$/.test(t.end_date),
      `${tag}: the Treasury agent's policy (25.00 a purchase, 50.00 a month, MCC 5734, EUR, until ${t.end_date}, alone up to 500.00; floor 25000.00)`);
    let pn = await panels(page);
    check(pn.state === "in-force" && pn.pills.every((x) => x === TRY_POLICY.state.inForce) && panelsMatch(pn, expectedLocks(start, worldId)),
      `${tag}: the three panels, in force, are what Purser's own code makes of this policy (card body, mandate terms, settings)`);
    check(JSON.stringify(pn.labels.slice(1)) === JSON.stringify([TRY_POLICY.notSent.airwallex, TRY_POLICY.notSent.metal]), `${tag}: Airwallex "${TRY_POLICY.notSent.airwallex}", Metal "${TRY_POLICY.notSent.metal}"`);
    check(await page.locator("#pl-unit").isVisible() && (await page.locator("#pl-unit").innerText()).trim() === TRY_POLICY.metalUnit && JSON.stringify(await page.locator("#pl-metal dd").evaluateAll((ds: Element[]) => ds.slice(0, 2).map((d) => d.textContent))) === JSON.stringify(["25.00 *USDZ", "50.00 *USDZ"]),
      `${tag}: the Metal panel says its unit plainly ("${TRY_POLICY.metalUnit}"), and cap and budget read 25.00 *USDZ and 50.00 *USDZ`);
    await page.locator("#policy").scrollIntoViewIfNeeded();
    await shot(page, `${tag}-1-all-fields.png`);
    // Stricter: the limit per purchase down. It holds at once, and the three panels follow it (and screen 4's line).
    await page.fill("#pf-per_tx", "20.00");
    check(await page.locator('[data-pfield="per_tx"]').evaluate((n: Element) => n.classList.contains("chg")) && await page.locator("#p-apply").isEnabled(), `${tag}: the changed field is marked and "Apply" is on`);
    await page.click("#p-apply");
    await page.waitForFunction(() => /ok|bad/.test(document.getElementById("p-status")?.className ?? "") || !document.getElementById("p-refused")?.hidden);
    const stricter = await formPolicy(page);
    pn = await panels(page);
    check(/^Stricter: it holds at once/.test(await pstatus()) && stricter.agents.treasury.per_tx === "20.00" && pn.state === "in-force" && panelsMatch(pn, expectedLocks(stricter, worldId))
      && /"amount": 20,/.test(pn.awx) && pn.metal[0] === "20.00" && pn.purser.includes('"card.treasury.per_tx": "20.00"') && pn.changed >= 3 && (await page.locator("#rl-awx > span:last-child").innerText()).trim() === "Airwallex card: €20 each, €50 a month",
      `${tag}: stricter (25.00 → 20.00 a purchase) holds at once; the three panels follow it, the changed lines marked (${pn.changed}); the card's line too`);
    check(await clearOfBar(page, "#p-status", 4), `${tag}: the result line, scrolled to, is not under the sticky button`);
    await shot(page, `${tag}-2-stricter.png`);
    // Looser: the reserve floor down. Refused without a signature; nothing changes in the world.
    const floorBefore = ((await page.locator("#w-floor").textContent()) ?? "").trim();
    await page.fill("#pf-reserve_floor", "20000.00");
    await page.click("#p-apply");
    await page.waitForSelector("#p-refused:not([hidden])");
    pn = await panels(page);
    const why = (await page.locator("#p-why").innerText()).trim();
    const pterms = (await page.locator("#p-terms").textContent()) ?? "";
    const phash = (await page.locator("#p-hash .hash").getAttribute("data-hash")) ?? "";
    check((await page.locator("#p-rhead").innerText()).trim() === TRY_POLICY.refused && /looser \(reserve floor\)/.test(why) && /Nothing changed\.$/.test(why), `${tag}: a looser floor is refused without a signature, said plainly: "${why.slice(0, 70)}…"`);
    check(pn.state === "proposed" && pn.pills.every((x) => x === TRY_POLICY.state.proposed) && phash === sha256(pterms) && (JSON.parse(pterms) as { changes: { field: string }[] }).changes.map((c) => c.field).join() === "reserve_floor",
      `${tag}: the panels show it as proposed, not in force; the terms to sign hash to ${phash.slice(0, 12)}…`);
    check(await page.locator('#s1-blocked article.prop.blocked[data-proposal="T-0001"]').count() === 1 && ((await page.locator("#w-floor").textContent()) ?? "").trim() === floorBefore && await page.locator('#pl-pay li[data-proposal="T-0001"]').getAttribute("data-check") === "pass",
      `${tag}: refused, so nothing changed: T-0001 still blocked, the floor still ${floorBefore} (the proposed policy would let it pass)`);
    check(await clearOfBar(page, "#p-refused", 4), `${tag}: the refusal, scrolled to, is not under the sticky button`);
    await shot(page, `${tag}-3-looser-refused.png`);
    // Signed with the passkey: it holds; the payment the floor blocked now waits for a signature, and the next invoice too.
    await page.click("#p-sign");
    await page.waitForFunction(() => /ok/.test(document.getElementById("p-status")?.className ?? "") || /bad/.test(document.getElementById("p-sstatus")?.className ?? ""));
    check(/^Signed and verified: the looser policy holds/.test(await pstatus()) && ((await page.locator("#w-floor").textContent()) ?? "").trim() === "EUR 20,000.00" && (await panels(page)).state === "in-force",
      `${tag}: signed with the passkey and verified by the server, the looser floor holds (${await pstatus()})`);
    await page.click("#go-see");
    await page.waitForSelector("#scr-6:not([hidden])");
    check((await page.locator("#s5-head").innerText()).trim() === W.alone.waits && await page.locator("#s5-next").getAttribute("data-state") === "waits",
      `${tag}: the next invoice "${W.alone.waits}" (above the EUR 500.00 the agent may pay alone)`);
    await page.locator("#s5-others-fold > summary").click();
    const t1 = page.locator('#s5-others article.prop.sheet[data-proposal="T-0001"]');
    check(await t1.count() === 1 && (await t1.innerText()).includes("Check: pass") && await t1.locator("button[data-sign]").isEnabled() && await page.locator("#s5-others article.prop.blocked").count() === 0
      && await t1.locator('.polnote[data-note="now-allowed"]').count() === 1,
      `${tag}: the payment that was blocked (T-0001) passes Purser's check now and waits for your signature`);
    await t1.scrollIntoViewIfNeeded();
    await shot(page, `${tag}-4-formerly-blocked.png`);
    await t1.locator("button[data-sign]").click();
    await page.waitForFunction(() => /ok|bad/.test(document.getElementById("st-T-0001")?.className ?? ""));
    check(/Signed, verified and executed in your test world: test transfer test-[0-9a-f]{12}, EUR 6,500\.00/.test(await page.locator("#st-T-0001").innerText()),
      `${tag}: T-0001 signed, verified and run by the stand-in (EUR 6,500.00), under the policy the visitor signed`);
    await layout(page, tag, "after the full policy", width);
    check(errors.length === 0, `${tag}: 0 console errors (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
    await v.context.close();
  }

  // ── "May pay alone" through the full form, and the worst case (1.1), at 390 and 1440 px. ──
  for (const width of [390, 1440] as const) {
    const tag = `alone-${width}`;
    const v = await visitor({ width, ip: `198.51.12${width === 390 ? 2 : 3}.7` });
    const { page, errors } = v;
    await openWorld(page, tag);
    await toRule(page);
    await page.locator("#p-open").click();
    const expo = page.locator("#p-expo");
    const seen = (await expo.innerText()).trim().split(/\s+/).length;
    check(await expo.isVisible() && (await page.locator("#p-expo-head").innerText()).trim() === WORST.headline && WORST.headline.startsWith(TRY_POLICY.worstCase)
      && !(await expo.locator("details.how").evaluate((d: HTMLDetailsElement) => d.open)) && seen <= 40,
      `${tag}: the test world's figure, at a glance (${seen} words in sight, the fold closed): ${WORST.headline}`);
    await page.fill("#pf-monthly", "40.00");
    await page.click("#p-apply");
    await page.waitForFunction(() => /^Stricter/.test(document.getElementById("p-status")?.textContent ?? ""));
    const lower = worldExpo("500.00", "40.00");
    check((await page.locator("#p-expo-head").innerText()).trim() === lower.headline && lower.headline !== WORST.headline && (await page.locator("#s4-full").textContent())?.trim() === lower.headline,
      `${tag}: a stricter month lowers it at once, behind screen 5's "more" too: ${lower.headline.slice(0, 60)}…`);
    await page.fill("#pf-alone", "2000.00");
    await page.click("#p-apply");
    await page.waitForSelector("#p-refused:not([hidden])");
    const pterms = JSON.parse((await page.locator("#p-terms").textContent()) ?? "{}") as { changes: { field: string; to: string }[]; policy: { alone: string } };
    check(await page.locator("#p-expo-next").isVisible() && (await page.locator("#p-expo-next").innerText()).trim() === `${TRY_POLICY.ifSigned} ${worldExpo("2000.00", "40.00").figure}.` && (await page.locator("#p-expo-head").innerText()).trim() === lower.headline,
      `${tag}: refused: the figure in force stays, and the one it would set if signed is shown`);
    check(pterms.changes.length === 1 && pterms.changes[0]!.field === "alone" && pterms.changes[0]!.to === "2000.00" && pterms.policy.alone === "2000.00"
      && /pay alone up to EUR 2,000\.00/.test(await page.locator("#p-effect").innerText()) && await page.locator("#p-effect").isVisible(),
      `${tag}: raising "may pay alone" to 2,000.00 is refused until signed; what is signed shows the new amount, and the page says what it does`);
    check(await page.locator(`#pl-pay li[data-proposal="${NEXT_INVOICE.id}"]`).getAttribute("data-check") === "pass" && ((await page.locator("#w-balance").textContent()) ?? "").trim() === "EUR 25,020.00",
      `${tag}: refused, so nothing ran: ${NEXT_INVOICE.id} still waits, the balance EUR 25,020.00`);
    const before = (await v.signCount())[0] ?? 0;
    await page.click("#p-sign");
    await page.waitForFunction(() => /ok/.test(document.getElementById("p-status")?.className ?? "") || /bad/.test(document.getElementById("p-sstatus")?.className ?? ""));
    check(new RegExp(`${NEXT_INVOICE.id}: paid alone under your new policy\\.$`).test((await page.locator("#p-status").innerText()).trim()), `${tag}: signed: ${NEXT_INVOICE.id} ran without a signature (${PAID_ALONE})`);
    await page.click("#go-see");
    await page.waitForSelector("#scr-6:not([hidden])");
    const next = page.locator("#s5-next");
    check(await next.getAttribute("data-state") === "alone" && (await next.innerText()).includes("Paid alone under your new policy (up to €2,000)"), `${tag}: screen 5: the next invoice, paid alone`);
    await next.locator("details.more > summary").click();
    check(/Test transfer test-[0-9a-f]{12}, balance after EUR 25,020\.00/.test(await next.innerText()) && (await next.locator(".pill.said-before").innerText()).trim() === TRY_POLICY.saidBefore && await page.locator(".pill.said-before:visible").count() === 1,
      `${tag}: the agent's sentence stays, labelled "${TRY_POLICY.saidBefore}", on the paid-alone invoice only; the stand-in ran it (balance EUR 25,020.00)`);
    check(JSON.stringify(await dots(page)) === '["done","done","done","done","done","on"]' && await page.locator('ol.dots li[aria-current="step"]').count() === 1, `${tag}: the dots show the last step`);
    check(((await v.signCount())[0] ?? 0) === before + 1, `${tag}: one signature for the policy change, none for the invoice (sign count ${before} → ${(await v.signCount())[0]})`);
    check(await page.locator(`#pl-pay li[data-proposal="T-0001"]`).getAttribute("data-check") === "fail", `${tag}: T-0001 is still blocked by the reserve floor`);
    await shot(page, `${tag}-1-paid-alone.png`);
    await layout(page, tag, "after a payment ran alone", width);
    check(errors.length === 0, `${tag}: 0 console errors (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
    await v.context.close();
  }

  // ── A stricter rule by its chip: from EUR 1,000.00 (signed) back to €500, applied at once, no signature. ──
  {
    const tag = "stricter-390";
    const v = await visitor({ width: 390, ip: "198.51.124.7" });
    const { page, errors } = v;
    await openWorld(page, tag);
    await toRule(page);
    await page.locator("#p-open").click();
    await page.fill("#pf-alone", "1000.00");
    await page.click("#p-apply");
    await page.waitForSelector("#p-refused:not([hidden])");
    await page.click("#p-sign");
    await page.waitForFunction(() => /ok/.test(document.getElementById("p-status")?.className ?? ""));
    await page.locator("#p-open").click();
    const signed = (await v.signCount())[0] ?? 0;
    check(await page.locator('#rule-chips .chip[data-alone="500.00"]').getAttribute("aria-label") === "€500" && await page.locator("#rule-chips .chip .now").count() === 0 && (await page.locator("#rl-purser > span:last-child").innerText()).trim() === `Purser: up to €1,000 alone, ${ALONE_PER_DAY} a day`, `${tag}: in force now: €1,000 (signed); no chip marked in force`);
    await page.click('#rule-chips .chip[data-alone="500.00"]');
    check((await page.locator("#s4-note").innerText()).trim() === W.rule.stricter && (await page.locator("#go-apply").innerText()).trim() === W.rule.apply && await page.locator("#go-apply").isEnabled(), `${tag}: €500 is stricter: "${W.rule.stricter}", the button "${W.rule.apply}"`);
    await shot(page, `${tag}-1-stricter.png`);
    await page.click("#go-apply");
    await page.waitForSelector("#scr-6:not([hidden])");
    check((await page.locator("#s5-head").innerText()).trim() === W.alone.waits && await page.locator("#s5-next").getAttribute("data-state") === "waits" && (await page.locator("#s5-next").innerText()).includes("above the €500"),
      `${tag}: applied at once: the next invoice "${W.alone.waits}" (above the €500 the agent may pay alone)`);
    check(((await v.signCount())[0] ?? 0) === signed, `${tag}: no signature for a stricter rule (sign count stays ${signed})`);
    await shot(page, `${tag}-2-still-waits.png`);
    check(errors.length === 0, `${tag}: 0 console errors (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
    await v.context.close();
  }

  // ── Spec 6b: the agents' steps come in one by one, each drawn from the server's answer, with who works on what. ──
  {
    const tag = "steps-390";
    const v = await visitor({ width: 390, ip: "198.51.125.7" });
    const { page, errors } = v;
    // Each step's answer held back a moment, as a live model's would take.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route("**/api/try-sign/agents", async (route: any) => { const res = await route.fetch(); await new Promise((r) => setTimeout(r, 900)); await route.fulfill({ response: res }); });
    await page.goto(`${local.url}/try/sign`);
    await start(page);
    await page.waitForSelector('#st-read[data-state="done"]');
    const state = async () => (await page.locator("#s1-steps li.st").evaluateAll((ls: Element[]) => ls.map((l) => (l as HTMLElement).dataset.state))) as string[];
    const first = await state();
    check(first[0] === "done" && first[1] === "pending" && first.slice(2).every((x) => x === "waiting") && (await page.locator("#st-check .sl").innerText()).trim() === "Purser's code is checking the reading…"
      && /^Read stand-in, not Claude$/.test((await page.locator("#st-read .sl").innerText()).trim()) && (await page.locator("#st-read .fld").count()) === 5 && await page.locator("#go-sign").isDisabled(),
      `${tag}: the reading came in (its five fields), the next step says who works on what, nothing to sign yet (${first.join(" ")})`);
    await shot(page, `${tag}-1-progress.png`);
    await page.waitForSelector('#st-quote[data-state="done"]');
    check((await page.locator("#st-check ul.ticks li.ok").count()) === 4 && /EUR 870\.00 for USD 982\.82/.test(await page.locator("#st-quote").innerText()) && (await page.locator("#st-advise .sl").innerText()).trim() === "Claude Opus is advising on the timing…",
      `${tag}: Purser's code ticked its four checks; the quote buys the EUR 870.00 short; then Claude Opus advises`);
    await page.waitForFunction(() => !(document.getElementById("go-sign") as HTMLButtonElement).disabled);
    check((await state()).every((x) => x === "done") && await page.locator("#s1-ask .says").isVisible(), `${tag}: after "ready", the agent's reason and "Sign with Face ID"`);
    check(errors.length === 0, `${tag}: 0 console errors (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
    await v.context.close();
  }

  // ── The agent's sentence is text on the page, never markup (A2 review). ──
  {
    const MARKUP = "Pay <b>x</b> now <img src=x onerror=alert(1)>.";
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "cf-connecting-ip": "198.51.120.7" } });
    const page = await context.newPage();
    const dialogs: string[] = [];
    page.on("dialog", (d: { message(): string; dismiss(): Promise<void> }) => { dialogs.push(d.message()); void d.dismiss(); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route(/\/api\/try-sign\/(world|agents)$/, async (route: any) => {
      const res = await route.fetch();
      const j = (await res.json()) as { proposals?: { says: string }[]; result?: { proposal?: { says: string } } };
      for (const p of j.proposals ?? []) p.says = MARKUP;
      if (j.result?.proposal) j.result.proposal.says = MARKUP;
      await route.fulfill({ response: res, body: JSON.stringify(j) });
    });
    await page.goto(`${local.url}/try/sign`);
    await page.waitForSelector("#s1-ask .says", { state: "attached" });
    await page.waitForSelector("#s1-blocked .says", { state: "attached" });
    const says = (await page.locator(".says").evaluateAll((ns: Element[]) => ns.map((n) => ({ text: n.textContent, kids: n.children.length, html: n.innerHTML })))) as { text: string | null; kids: number; html: string }[];
    check(says.length === 2 && says.every((x) => x.text === MARKUP && x.kids === 0 && x.html === MARKUP.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")),
      `markup in the agent's sentence shows as text, escaped (${says.length} sentences; ${says.map((x) => x.kids).join(", ")} elements inside)`);
    await page.waitForTimeout(500);
    check(dialogs.length === 0 && await page.locator(".says img, .says b").count() === 0, `markup in the agent's sentence: no <b> or <img> made, no script run (${dialogs.length} dialogs)`);
    await context.close();
  }

  // ── prefers-reduced-motion: every screen shows its end state at once, with no animation and nothing counting. ──
  for (const width of [390, 1440] as const) {
    const tag = `still-${width}`;
    const v = await visitor({ width, ip: `198.51.12${width === 390 ? 6 : 7}.7`, reducedMotion: "reduce" });
    const { page, errors } = v;
    const none = async (where: string) => { const m = await motion(page); check(m.length === 0, `${tag}: ${where}: no animation (${m.map((a) => a.name).join(", ") || "none"})`); };
    await openWorld(page, tag);
    await start(page);
    await page.click("#go-sign");
    await page.waitForSelector("#scr-2:not([hidden])");
    await none("screen 2");
    check(JSON.stringify(await page.locator("#scr-2 .bigok svg > *").evaluateAll((ps: Element[]) => ps.map((p) => getComputedStyle(p).strokeDashoffset))) === '["0px","0px"]', `${tag}: the tick is drawn in full at once`);
    await page.click("#go-cheat");
    await page.waitForSelector("#tamper:not([hidden])");
    await none("screen 3, refused");
    check(await page.locator("#tamper.shake").count() === 0 && await page.locator("#t-table tr.hrow code.hp").count() === 2, `${tag}: no shake; the two hashes side by side`);
    await page.click("#go-trick");
    await page.waitForSelector("#scr-4:not([hidden])");
    await page.click('#trick-chips .chip[data-attack="pre_approved"]');
    await page.waitForSelector("#k-result:not([hidden])");
    await none("screen 4, the fake invoice");
    check(await page.locator("#k-result.go").count() === 0 && await page.locator("#k-ibans .ib").count() === 2, `${tag}: the invoice, the IBANs and the block in place at once`);
    await page.click("#go-rule");
    await page.waitForSelector("#scr-5:not([hidden])");
    await page.click('#rule-chips .chip[data-alone="2000.00"]');
    check(await page.locator("#s4-worst[data-count], #s4-worst.counting, #s4-locks.lit").count() === 0 && /\(\+€[\d,]+\)$/.test((await page.locator("#s4-worst").innerText()).trim()), `${tag}: choosing €2,000: the new worst case and its difference at once, nothing counting`);
    await none("screen 5");
    await page.click("#go-apply");
    await page.waitForSelector("#scr-6:not([hidden])");
    await none("screen 6");
    const paid = await page.locator("#s5-next ol.flow .f-paid .fd").evaluate((n: Element) => [getComputedStyle(n).backgroundColor, getComputedStyle(n.closest("ol")!, "::after").transform]) as [string, string];
    const ok = await page.evaluate(`(() => { const d = document.createElement("i"); d.style.color = "var(--ok)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`) as string;
    check(paid[0] === ok && paid[1] === "none", `${tag}: paid alone: the payment is through the locks and green at once (${paid.join(", ")})`);
    if (width >= 1024) await none("the diagram");
    check(errors.length === 0, `${tag}: 0 console errors (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
    await v.context.close();
  }

  // ── Timed (4.2): the whole story, scripted, from opening the page to the closing card, in at most 75 s. ──
  {
    const v = await visitor({ width: 390, ip: "198.51.125.7" });
    const { page } = v;
    const t0 = Date.now();
    await openWorld(page, "timed");
    await start(page);
    await page.click("#go-sign"); await page.waitForSelector("#scr-2:not([hidden])");
    await page.click("#go-cheat"); await page.waitForSelector("#tamper:not([hidden])");
    await page.click("#go-trick"); await page.waitForSelector("#scr-4:not([hidden])");
    await page.click('#trick-chips .chip[data-attack="pre_approved"]'); await page.waitForSelector("#k-result:not([hidden])");
    await page.click("#go-rule"); await page.waitForSelector("#scr-5:not([hidden])");
    await page.click('#rule-chips .chip[data-alone="2000.00"]'); await page.click("#go-apply"); await page.waitForSelector("#scr-6:not([hidden])");
    await page.click("#go-done"); await page.waitForSelector("#scr-7:not([hidden])");
    const ms = Date.now() - t0;
    metrics.push({ tag: "timed-390", screen: 7, words: 0, primaries: 0, primaryInView: true, ms });
    check(ms <= 75_000 && await page.locator("#s5-next").getAttribute("data-state") === "alone", `timed: the opening to the closing card, scripted, in ${(ms / 1000).toFixed(1)} s (at most 75 s)`);
    await v.context.close();
  }
}

writeFileSync(join(shots, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
await browser.close();
local.server?.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
