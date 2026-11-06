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
const { TAMPER_VERDICT, TRY_POLICY, TRY_SIGN_END, TRY_SIGN_HOOK, TRY_SIGN_LABEL, TRY_SIGN_SIGNED, TRY_SIGN_START_NOTE, TRY_SIGN_STEPS, WHATS_REAL } = await import("../../src/try/sign.js");
const { threeLocks } = await import("../../src/try/policy.js");
const { TRY_IT } = await import("../../src/config/brand.js");
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

// Step 0, "Set the policy" (Max, item 1): the Treasury agent's policy as the form shows it, the three panels as the page
// shows them, and what Purser's own code makes of that policy (src/try/policy.ts threeLocks: the card body IssuingRest
// sends, the mandate's terms the owner signer passes to metal-agent, Purser's settings), to compare field for field.
type FormPolicy = { reserve_floor: string; agents: { treasury: { per_tx: string; monthly: string; mccs: string[]; currencies: string[]; end_date: string; alone: string } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formPolicy = (page: any) => page.evaluate(`(() => {
  const v = (f) => document.getElementById("pf-" + f).value, ck = (f) => [...document.querySelectorAll('input[name="pf-' + f + '"]:checked')].map((n) => n.value).sort();
  return { reserve_floor: v("reserve_floor"), agents: { treasury: { per_tx: v("per_tx"), monthly: v("monthly"), mccs: ck("mccs"), currencies: ck("currencies"), end_date: v("end_date"), alone: v("alone") } } };
})()`) as Promise<FormPolicy>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const panels = (page: any) => page.evaluate(`(() => ({
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
// Where the page itself leaves a step-0 element after its own smooth scroll: its top, and the sticky step bar's bottom.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const belowBar = async (page: any, id: string) => {
  await page.waitForTimeout(1200); // the page's own smooth scroll settles
  return page.evaluate((elId: string) => ({ top: document.getElementById(elId)!.getBoundingClientRect().top, bar: document.querySelector("ol.progress")!.getBoundingClientRect().bottom }), id) as Promise<{ top: number; bar: number }>;
};
const panelsMatch = (pn: Awaited<ReturnType<typeof panels>>, ex: ReturnType<typeof expectedLocks>) =>
  pn.awx.trimEnd() === ex.awx && pn.purser.trimEnd() === ex.purser && pn.metal[0] === ex.cap && pn.metal[1] === ex.budget && pn.metal[2] === ex.payee && pn.args.startsWith(ex.args);

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
  // The button; and "Try it in 30 seconds.", its own line after the three sentences under the heading (section D,
  // 6 Nov), links here too.
  const button = page.locator('a.btn[href="try/sign"]');
  check(await button.count() === 1, `${tag}: the landing has the "Sign with your own Face ID" button`);
  const tryLine = page.locator('.why + .tryline a[href="try/sign"]');
  check(await tryLine.count() === 1 && (await tryLine.innerText()).trim() === TRY_IT, `${tag}: "${TRY_IT}" under the three sentences links here`);
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
  // A4: from 1024 px the start screen's right column shows "one policy → three locks"; the screen is not mostly empty.
  const startFill = await page.evaluate(`(() => {
    const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
    const boxes = [".intro", "ol.progress", "#s-world .go", "#diagram"].map((q) => document.querySelector(q)).filter(vis).map((e) => e.getBoundingClientRect());
    const top = document.querySelector("header.top").getBoundingClientRect().bottom, H = innerHeight - top, W = innerWidth;
    const area = boxes.reduce((a, b) => a + Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, top)) * b.width, 0);
    const d = document.querySelector("#diagram");
    return { fill: area / (H * W), diagram: vis(d) ? { left: d.getBoundingClientRect().left, right: d.getBoundingClientRect().right, bottom: d.getBoundingClientRect().bottom, locks: d.querySelectorAll(".dlocks li").length } : null };
  })()`) as { fill: number; diagram: { left: number; right: number; bottom: number; locks: number } | null };
  if (width >= 1024) {
    check(!!startFill.diagram && startFill.diagram.left > width * 0.45 && startFill.diagram.bottom <= height && startFill.diagram.locks === 3,
      `${tag}: A4: the right column shows "one policy → three locks" (from x ${Math.round(startFill.diagram?.left ?? 0)}, three locks, above the fold)`);
    check(startFill.fill >= 0.4, `${tag}: A4: the start screen is not mostly empty (content covers ${Math.round(startFill.fill * 100)}% of the screen below the header)`);
    // The left column (Max, 6 Nov: no second copy of the steps; the bar at the top says them): the start button, the
    // hook and one short line, level with the middle of the diagram so the column does not look empty.
    const left = await page.evaluate(`(() => {
      const go = document.querySelector("#s-world .go").getBoundingClientRect(), d = document.querySelector("#diagram").getBoundingClientRect();
      const note = document.querySelector("#go-note");
      return { note: note && note.getClientRects().length ? note.textContent : null, steps: document.querySelectorAll("#s-world .go ol, #s-world .gosteps").length, goTop: go.top, goBottom: go.bottom, goRight: go.right, dTop: d.top, dBottom: d.bottom, dLeft: d.left };
    })()`) as { note: string | null; steps: number; goTop: number; goBottom: number; goRight: number; dTop: number; dBottom: number; dLeft: number };
    const off = Math.abs((left.goTop + left.goBottom) / 2 - (left.dTop + left.dBottom) / 2);
    check(left.note === TRY_SIGN_START_NOTE && left.steps === 0 && left.goRight <= left.dLeft && off <= 0.15 * (left.dBottom - left.dTop),
      `${tag}: A4: the left column is the button, the hook and one line, level with the diagram's middle (${Math.round(off)} px off), no second copy of the steps`);
  } else {
    check(startFill.diagram === null, `${tag}: below 1024 px the diagram is not shown`);
    check(await page.locator("#go-note").isHidden(), `${tag}: below 1024 px the line under the button is not shown`);
  }
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

  check(JSON.stringify(await steps()) === '["done","on","-"]', `${tag}: after the proposal, step 1 is done and step 2 under way`);
  // On a phone (Max, 6 Nov): after the step change the sheet's eyebrow is below the sticky step bar, not under it; every
  // label of the terms is on one line ("Proposal expires" and "Quote expires" kept apart); and the last row of the terms
  // can be read above the sticky buttons, scrolled to it or to the end of the sheet.
  if (mobile) {
    await page.waitForTimeout(1200); // the page's own smooth scroll to the sheet settles
    const eb = await page.evaluate(`(() => ({ eyebrow: document.querySelector("article.prop.sheet .eyebrow").getBoundingClientRect().top, bar: document.querySelector("ol.progress").getBoundingClientRect().bottom }))()`) as { eyebrow: number; bar: number };
    check(eb.eyebrow >= eb.bar, `${tag}: "You are approving" is below the sticky step bar after the step change (eyebrow top ${Math.round(eb.eyebrow)} px, bar bottom ${Math.round(eb.bar)} px)`);
    await page.screenshot({ path: join(shots, `${tag}-2a-sheet-top.png`) });
    const labels = await page.evaluate(`(() => [...document.querySelectorAll("article.prop.sheet dl.facts dt")].map((dt) => { const r = document.createRange(); r.selectNodeContents(dt); const tops = new Set([...r.getClientRects()].map((b) => Math.round(b.top))); return [dt.textContent, tops.size]; }))()`) as [string, number][];
    check(labels.length >= 6 && labels.every(([, n]) => n === 1) && labels.some(([t]) => t === "Proposal expires"),
      `${tag}: every label of the terms is on one line (${labels.filter(([, n]) => n !== 1).map(([t]) => t).join(", ") || labels.map(([t]) => t).join(" · ")})`);
    for (const how of ["the last row", "the end of the sheet"] as const) {
      const r = await page.evaluate(`(() => {
        const dl = document.querySelector("article.prop.sheet dl.facts"), rows = [...dl.children], last = rows.slice(-2);
        (${how === "the last row" ? "last[1]" : 'document.querySelector("article.prop.sheet")'}).scrollIntoView({ block: "end", behavior: "instant" });
        const acts = document.getElementById("s-key").getBoundingClientRect();
        return { bottom: Math.max(...last.map((e) => e.getBoundingClientRect().bottom)), acts: acts.top, label: last[0].textContent };
      })()`) as { bottom: number; acts: number; label: string };
      check(r.bottom <= r.acts + 0.5, `${tag}: scrolled to ${how}, "${r.label}" is fully above the sticky buttons (row bottom ${Math.round(r.bottom)} px, buttons from ${Math.round(r.acts)} px)`);
      if (how === "the last row") await page.screenshot({ path: join(shots, `${tag}-2b-sheet-terms-end.png`) });
    }
  }

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
  // A5: after signing, few words: what shows in the result (a closed "more" shows nothing), at most about 150.
  const words = ((await page.locator("#result").innerText()) as string).split(/\s+/).filter((w: string) => /[A-Za-z0-9]/.test(w)).length;
  check(words <= 150, `${tag}: A5: ${words} visible words after signing (at most 150)`);
  // A8: the quick tamper's label on one line.
  const oneLine = await page.locator("#go-tamper").evaluate((b: HTMLElement) => { const span = [...b.querySelectorAll("span")].find((x) => x.getClientRects().length > 0)!; return { lines: span.getClientRects().length, fits: b.scrollWidth <= b.clientWidth + 1 }; }) as { lines: number; fits: boolean };
  check(oneLine.lines === 1 && oneLine.fits, `${tag}: A8: the quick tamper ("${(await page.locator("#go-tamper").innerText()).trim()}") is on one line (${oneLine.lines} line${oneLine.lines === 1 ? "" : "s"})`);
  check(await page.locator("#t-another").isHidden() && await page.locator("#t-end").isHidden(), `${tag}: before any tamper: no "Try another field", no end buttons`);

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
    check(await page.locator("#t-another").isVisible(), `${tag}: tamper ${field}: "Try another field" is shown after the refusal`);
  }
  // On a phone the tamper and its refusal fill the screen; on a laptop the whole result card fits.
  await shotAt(page, mobile ? "#tamper" : "#tamper-box", join(shots, `${tag}-5-tamper-refused.png`));
  await layout(page, tag, "after the tamper", width);
  // The terms, opened: the canonical JSON is one long line of text.
  await page.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
  await layout(page, tag, "with all terms open", width);
  // A7: after the tamper, three ways on: the real run's Face ID approval, the film, the code.
  const ends = await page.locator("#t-end a").evaluateAll((as: Element[]) => as.map((a) => ({ text: (a.textContent ?? "").trim(), href: a.getAttribute("href") }))) as { text: string; href: string }[];
  check(await page.locator("#t-end").isVisible() && JSON.stringify(ends) === JSON.stringify(TRY_SIGN_END.map((e) => ({ text: e.label, href: e.href }))),
    `${tag}: A7: after the tamper, three buttons: ${ends.map((e) => `"${e.text}" (${e.href})`).join(", ")}`);
  if (!args.live) {
    const proof = await (await fetch(`${local.url}/proof`)).text();
    check(/id="faceid"/.test(proof) && /P-0005/.test(proof.slice(proof.indexOf('id="faceid"'))), `${tag}: A7: /proof#faceid is the section with the CFO's Face ID approvals, P-0005 among them`);
  }
  // A8: "Try another field" puts the signed values back and readies the next field.
  await page.click("#t-another");
  check(await page.locator("#t-send").isDisabled() && /^Now change the /.test(await page.locator("#t-status").innerText()) && await page.evaluate("document.activeElement && document.activeElement.closest('.tf') !== null"),
    `${tag}: A8: "Try another field": the signed values back, the next field focused (${await page.locator("#t-status").innerText()})`);
  await shotAt(page, "#tamper", join(shots, `${tag}-5b-end.png`));

  // Step 0, "Set the policy" (Max, item 1), after the visit above: the policy holds in this world for the rest of it.
  if (!args.live) {
    const worldId = (await page.locator("#w-id").innerText()).trim();
    const pstatus = async () => (await page.locator("#p-status").innerText()).trim();
    await page.locator("#policy").scrollIntoViewIfNeeded();
    // (The check above opened every <details> on the page; a fresh world's step 0 is closed, see "step 0 first" below.)
    check(await page.locator("#policy").isVisible(), `${tag}: step 0 "${TRY_POLICY.title}" is on the page`);
    if (!(await page.locator("details#pol").evaluate((d: HTMLDetailsElement) => d.open))) await page.locator("details#pol > summary").click();
    const start = await formPolicy(page);
    const t = start.agents.treasury;
    check(t.per_tx === "25.00" && t.monthly === "50.00" && t.mccs.join() === "5734" && t.currencies.join() === "EUR" && t.alone === "500.00" && start.reserve_floor === "25000.00" && /^\d{4}-\d{2}-\d{2}$/.test(t.end_date),
      `${tag}: step 0 shows the Treasury agent's policy (25.00 a purchase, 50.00 a month, MCC 5734, EUR, until ${t.end_date}, alone up to 500.00; floor 25000.00)`);
    let pn = await panels(page);
    check(pn.state === "in-force" && pn.pills.every((x) => x === TRY_POLICY.state.inForce) && panelsMatch(pn, expectedLocks(start, worldId)),
      `${tag}: step 0: the three panels, in force, are what Purser's own code makes of this policy (card body, mandate terms, settings)`);
    check(JSON.stringify(pn.labels.slice(1)) === JSON.stringify([TRY_POLICY.notSent.airwallex, TRY_POLICY.notSent.metal]), `${tag}: step 0: Airwallex "${TRY_POLICY.notSent.airwallex}", Metal "${TRY_POLICY.notSent.metal}"`);
    await shotAt(page, "#policy", join(shots, `${tag}-8-policy.png`));

    // Stricter: the limit per purchase down. It holds at once, and the three panels follow it.
    await page.fill("#pf-per_tx", "20.00");
    check(await page.locator('[data-pfield="per_tx"]').evaluate((n: Element) => n.classList.contains("chg")) && await page.locator("#p-apply").isEnabled(), `${tag}: step 0: the changed field is marked and "Apply" is on`);
    await page.click("#p-apply");
    await page.waitForFunction(() => /ok|bad/.test(document.getElementById("p-status")?.className ?? "") || !document.getElementById("p-refused")?.hidden);
    const stricter = await formPolicy(page);
    pn = await panels(page);
    check(/^Stricter: it holds at once/.test(await pstatus()) && stricter.agents.treasury.per_tx === "20.00" && pn.state === "in-force" && panelsMatch(pn, expectedLocks(stricter, worldId))
      && /"amount": 20,/.test(pn.awx) && pn.metal[0] === "20.00" && pn.purser.includes('"card.treasury.per_tx": "20.00"') && pn.changed >= 3,
      `${tag}: step 0: stricter (25.00 → 20.00 a purchase) holds at once; the three panels follow it, the changed lines marked (${pn.changed}): ${await pstatus()}`);
    // The result line lands below the sticky step bar, not under it (#65's --stick); the picture is where the page left it.
    const res = await belowBar(page, "p-status");
    check(res.top >= res.bar, `${tag}: step 0: after the change the result line is below the sticky step bar (its top ${Math.round(res.top)} px, bar bottom ${Math.round(res.bar)} px)`);
    await page.screenshot({ path: join(shots, `${tag}-9-panels-after-change.png`) });
    // On a phone the three panels stack: one picture of all three.
    if (mobile) await page.locator("#p-locks").screenshot({ path: join(shots, `${tag}-9b-panels-after-change-all-three.png`) });

    // Looser: the reserve floor down. Refused without a signature; nothing changes in the world.
    const floorBefore = (await page.locator("#w-floor").innerText()).trim();
    await page.fill("#pf-reserve_floor", "20000.00");
    await page.click("#p-apply");
    await page.waitForSelector("#p-refused:not([hidden])");
    pn = await panels(page);
    const why = (await page.locator("#p-why").innerText()).trim();
    const terms = (await page.locator("#p-terms").textContent()) ?? "";
    const phash = (await page.locator("#p-hash .hash").getAttribute("data-hash")) ?? "";
    check((await page.locator("#p-rhead").innerText()).trim() === TRY_POLICY.refused && /looser \(reserve floor\)/.test(why) && /Nothing changed\.$/.test(why),
      `${tag}: step 0: a looser floor is refused without a signature, said plainly: "${why.slice(0, 70)}…"`);
    check(pn.state === "proposed" && pn.pills.every((x) => x === TRY_POLICY.state.proposed) && phash === sha256(terms) && (JSON.parse(terms) as { changes: { field: string }[] }).changes.map((c) => c.field).join() === "reserve_floor",
      `${tag}: step 0: the panels show it as proposed, not in force; the terms to sign hash to ${phash.slice(0, 12)}…`);
    check(await page.locator('article.prop.blocked[data-proposal="T-0001"]').count() === 1 && (await page.locator("#w-floor").innerText()).trim() === floorBefore && await page.locator('#pl-pay li[data-proposal="T-0001"]').getAttribute("data-check") === "pass",
      `${tag}: step 0: refused, so nothing changed: T-0001 still blocked, the floor still ${floorBefore} (the proposed policy would let it pass)`);
    const ref = await belowBar(page, "p-refused");
    check(ref.top >= ref.bar, `${tag}: step 0: the refusal is below the sticky step bar (its top ${Math.round(ref.top)} px, bar bottom ${Math.round(ref.bar)} px)`);
    await page.screenshot({ path: join(shots, `${tag}-10-loosening-refused.png`) });

    // Signed with the passkey (the virtual authenticator): it holds, and the payment the floor blocked can be signed and run.
    await page.click("#p-sign");
    await page.waitForFunction(() => /ok/.test(document.getElementById("p-status")?.className ?? "") || /bad/.test(document.getElementById("p-sstatus")?.className ?? ""));
    const t1 = page.locator('article.prop.sheet[data-proposal="T-0001"]');
    check(/^Signed and verified: the looser policy holds/.test(await pstatus()) && (await page.locator("#w-floor").innerText()).trim() === "EUR 20,000.00" && (await panels(page)).state === "in-force",
      `${tag}: step 0: signed with the passkey and verified by the server, the looser floor holds (${await pstatus()})`);
    check(await t1.count() === 1 && (await t1.innerText()).includes("Check: pass") && await t1.locator("button[data-sign]").isEnabled() && await page.locator("article.prop.blocked").count() === 0
      && await t1.locator('.polnote[data-note="now-allowed"]').count() === 1,
      `${tag}: step 0: the payment that was blocked (T-0001) passes Purser's check now and waits for your signature`);
    await shotAt(page, "#p-status", join(shots, `${tag}-11-loosening-signed.png`));
    await shotAt(page, 'article.prop.sheet[data-proposal="T-0001"]', join(shots, `${tag}-12-formerly-blocked-now-allowed.png`));
    await t1.locator("button[data-sign]").click();
    await page.waitForFunction(() => /ok|bad/.test(document.getElementById("st-T-0001")?.className ?? ""));
    check(/Signed, verified and executed/.test(await page.locator("#st-T-0001").innerText()) && /Test transfer test-[0-9a-f]{12}: EUR 6,500\.00/.test(await page.locator("#r-exec").innerText()),
      `${tag}: step 0: T-0001 signed, verified and run by the stand-in (EUR 6,500.00), under the policy the visitor signed`);
    await shotAt(page, "#result", join(shots, `${tag}-13-formerly-blocked-paid.png`));
    await layout(page, tag, "after the policy step", width);
  }
  // A6: a refused signature is an answer (HTTP 200, verified false), so the whole visit logs no console error at all.
  check(errors.length === 0, `${tag}: A6: 0 console errors across the whole visit (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
  void beforeTamper;
  await context.close();
}

// Step 0 first (Max, item 1): a visitor who sets the policy before anything else. The looser floor is refused, then
// signed, the test passkey made on the way (the world's one passkey, as from the sheet); then a stricter floor blocks
// both payments, the one that was allowed too, and no sheet is left to sign. No console error.
if (!args.live) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "cf-connecting-ip": "198.51.121.7" } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${local.url}/try/sign`);
  await page.click("#go-world");
  await page.waitForSelector("#s-props:not([hidden])");
  check(await page.locator("#policy").isVisible() && !(await page.locator("details#pol").evaluate((d: HTMLDetailsElement) => d.open)) && (await page.locator("details#pol > summary").innerText()).includes(TRY_POLICY.title),
    `step 0 first: "${TRY_POLICY.title}" is shown once the world is open, closed until asked`);
  await page.locator("details#pol > summary").click();
  await page.fill("#pf-reserve_floor", "20000.00");
  await page.click("#p-apply");
  await page.waitForSelector("#p-refused:not([hidden])");
  check(/makes your test passkey/.test(await page.locator("#p-sstatus").innerText()), "step 0 first: before any passkey, signing the policy says it makes the test passkey first");
  await page.click("#p-sign");
  await page.waitForFunction(() => /ok/.test(document.getElementById("p-status")?.className ?? "") || /bad/.test(document.getElementById("p-sstatus")?.className ?? ""));
  check(/^Signed and verified/.test(await page.locator("#p-status").innerText()) && /registered in this world only|is kept/.test(await page.locator("#k-status").innerText()) && await page.locator("#go-key").isHidden(),
    "step 0 first: the passkey is made and the looser floor signed with it; the sheet knows the passkey is there");
  check(await page.locator("article.prop.sheet").count() === 2 && await page.locator("article.prop.sheet button[data-sign]:not([disabled])").count() === 2,
    "step 0 first: both payments now wait for a person, each with its own signature to give");
  await page.fill("#pf-reserve_floor", "29500.00");
  await page.click("#p-apply");
  await page.waitForFunction(() => /^Stricter/.test(document.getElementById("p-status")?.textContent ?? ""));
  check(await page.locator("article.prop.sheet").count() === 0 && await page.locator("article.prop.blocked").count() === 2 && /EUR 29,500\.00/.test(await page.locator('article.prop.blocked[data-proposal="T-0002"]').innerText())
    && await page.locator('article.prop.blocked[data-proposal="T-0002"] .polnote[data-note="now-blocked"]').count() === 1,
    "step 0 first: a stricter floor (29,500.00) applies at once and blocks both, the payment that was allowed (T-0002) too");
  await layout(page, "step-0-first-390", "after a stricter floor", 390);
  await page.screenshot({ path: join(shots, "step-0-first-390-blocked-by-stricter.png") });
  check(errors.length === 0, `step 0 first: 0 console errors (${errors.length}${errors.length ? `: ${errors.join(" | ")}` : ""})`);
  await context.close();
}

// The agent's sentence is text on the page, never markup (A2 review). The server never passes markup on from the model
// (test/try-agent-line.test.ts), so here the world's answer is rewritten in the browser to carry some, on both
// proposals, and the page must show it as plain text: no element made, no script run.
if (!args.live) {
  const MARKUP = "Pay <b>x</b> now <img src=x onerror=alert(1)>.";
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "cf-connecting-ip": "198.51.120.7" } });
  const page = await context.newPage();
  const dialogs: string[] = [];
  page.on("dialog", (d: { message(): string; dismiss(): Promise<void> }) => { dialogs.push(d.message()); void d.dismiss(); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.route("**/api/try-sign/world", async (route: any) => {
    const res = await route.fetch();
    const j = (await res.json()) as { proposals: { says: string }[] };
    for (const p of j.proposals) p.says = MARKUP;
    await route.fulfill({ response: res, body: JSON.stringify(j) });
  });
  await page.goto(`${local.url}/try/sign`);
  await page.click("#go-world");
  await page.waitForSelector("article.prop.sheet .says");
  const says = (await page.locator(".says").evaluateAll((ns: Element[]) => ns.map((n) => ({ text: n.textContent, kids: n.children.length, html: n.innerHTML })))) as { text: string | null; kids: number; html: string }[];
  check(says.length === 2 && says.every((x) => x.text === MARKUP && x.kids === 0 && x.html === MARKUP.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")),
    `markup in the agent's sentence shows as text, escaped (${says.length} sentences; ${says.map((x) => x.kids).join(", ")} elements inside)`);
  await page.waitForTimeout(500);
  check(dialogs.length === 0 && await page.locator(".says img, .says b").count() === 0, `markup in the agent's sentence: no <b> or <img> made, no script run (${dialogs.length} dialogs)`);
  await context.close();
}

await browser.close();
local.server?.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed; screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
