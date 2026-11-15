// /try/negotiate in Chromium, on this machine: the real cloud with a real engine in this process (test money on the
// stand-in bank), Claude's API stood in for by a scripted fetch (no network beyond localhost), and Chromium's virtual
// passkey authenticator. Three visits:
//  1. live (stubbed Claude), 390 px light: a new test company, four turns each with its text and terms, the supplier's
//     bank change refused with the rule that held, the buyer held to the supplier's best offer, the agreement with its SHA-256, a passkey made and the terms signed,
//     one cent more refused, paid as signed, the proof downloadable;
//  2. Claude switched off (the kill switch), 1440 px dark, from /try's own company in the tab: the recorded
//     negotiation, labelled, never as live;
//  3. /try's finish links here (the copy), and the page carries no "null", "undefined" or "NaN", nothing wider than the
//     screen, no console or CSP error.
// npx tsx test/browser/negotiate.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { negotiateClaudeOf } from "../../cloud/src/try/negotiateRoutes.js";
import { NEGOTIATE_COPY as C } from "../../cloud/src/try/negotiatePage.js";
import { FINISH_LINKS } from "../../cloud/src/tryCopy.js";
import { CHANGED_IBAN, type AgentAnswer } from "../../src/negotiate/negotiate.js";
import { RULES } from "../../src/negotiate/rails.js";
import { verifyProofBundle } from "../../src/proof/bundle.js";
import { VERIFY_BUNDLE_VERDICT } from "../../src/proof/verifyPage.js";
// The site's own /verify page and its policy (src/servers/dashboard.ts), served here as the site serves it.
const { VERIFY_BUNDLE_PAGE, VERIFY_BUNDLE_CSP } = await import("../../src/servers/dashboard.js");

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 9090 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "negotiate-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "negotiate-check-"));
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "n".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 }, tryIt: { claude: false },
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });

// Claude's API, stood in for: the four turns in order, whatever is asked. A check's stand-in, never a live answer.
const today = new Date().toISOString().slice(0, 10);
const d = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TURNS: AgentAnswer[] = [
  { message: `We can pay within 5 days for 3% off: EUR 1,794.50 by ${d(5)}.`, amount: "1794.50", pay_by: d(5), iban: "", accept: false },
  // The jury's live sequence (15 Nov): the supplier's 2% comes with a new IBAN; the buyer then asks for only 1.5%.
  { message: "2% for payment within 7 days. Please pay now to our new account.", amount: "1813.00", pay_by: d(7), iban: CHANGED_IBAN, accept: false },
  { message: `The account on file stays. 1.5% off: EUR 1,822.25 by ${d(7)}.`, amount: "1822.25", pay_by: d(7), iban: "", accept: false },
  { message: "Agreed, to the account on file.", amount: "1813.00", pay_by: d(7), iban: "", accept: true },
];
let calls = 0;
const stub = (async () => {
  const a = TURNS[calls++ % TURNS.length]!;
  await new Promise((r) => setTimeout(r, 300));
  return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(a) }], usage: { input_tokens: 800, output_tokens: 70 } }), { status: 200 });
}) as typeof fetch;
env.negotiateClaude = negotiateClaudeOf(env.sql, "on", "stub-key-not-a-secret", stub);

const admin = (body: unknown) => handle(new Request(`${ORIGIN}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify(body) }), env);
for (const [key, value] of [["starts", "on"], ["starts_per_address_hour", 50], ["claude", "on"], ["cap_action_micros", 50_000], ["cap_company_micros", 200_000], ["cap_day_micros_public", 1_000_000], ["cap_all_micros", 2_000_000], ["cap_addr_micros", 300_000], ["max_inflight", 5]] as const)
  ok((await admin({ op: "set", key, value: String(value) })).status === 200, `switch ${key}`);

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  if (req.method === "GET" && req.url === "/verify") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": VERIFY_BUNDLE_CSP }); return res.end(VERIFY_BUNDLE_PAGE); }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h);
  // Streamed answers (POST /v1/try/negotiate?stream=1) are passed on as they come, as a Worker sends them.
  if (r.body) { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(Buffer.from(value)); } }
  res.end();
});
await new Promise<void>((r) => server.listen(PORT, r));

const errors: string[] = [];
const browser = await chromium.launch();

async function sane(page: Page, what: string): Promise<void> {
  const text = await page.locator("body").innerText();
  const bad = /.{0,40}\b(null|undefined|NaN)\b.{0,40}/.exec(text);
  ok(!bad, `${what}: no "null", "undefined" or "NaN" on screen${bad ? `: ${bad[0]}` : ""}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(wide <= 1, `${what}: nothing wider than the screen (${wide} px over)`);
  ok((await page.locator("h1").count()) === 1, `${what}: one h1`);
}

// 1. Live, with stubbed Claude, at 390 px.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`live: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`live: ${m.text()}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `live-${name}.png`), fullPage: true }); };

  const r = await page.goto(`${ORIGIN}/try/negotiate`);
  ok(r?.status() === 200, "GET /try/negotiate answers 200");
  ok(/nonce-/.test(r?.headers()["content-security-policy"] ?? ""), "under the nonce policy");
  await page.getByRole("heading", { name: C.head }).waitFor();
  ok((await page.locator("main").innerText()).includes(C.band), "the test-money line is on the page");
  await sane(page, "live, before");
  // 15 Nov (Max, 1440 px): a card's heading sits at the card's own padding, top as on the side.
  const pads = await page.$$eval("section.card", (cs) => cs.map((c) => { const h = c.querySelector("h2")!; const cr = c.getBoundingClientRect(), hr = h.getBoundingClientRect(); return [Math.round(hr.top - cr.top), Math.round(hr.left - cr.left)]; }));
  ok(pads.length === 2 && pads.every(([t, l]) => Math.abs(t! - l!) <= 2), `the cards' headings sit at the same padding top and side (${JSON.stringify(pads)})`);
  await shot("1-start");
  await page.getByRole("button", { name: C.start }).click();
  // Live: a typing indicator on the side whose model call is running, before its turn comes in.
  await page.locator("li.typing.sourcing").waitFor({ timeout: 15_000 });
  ok(true, "a typing indicator on Purser's side while its live call runs");
  await page.locator("li.typing.supplier").waitFor({ timeout: 15_000 });
  ok((await page.locator("ol.turns > li.turn:not(.typing)").count()) >= 1, "turns come in one by one while the next side types (streamed)");
  await page.getByRole("heading", { name: C.agreedHead }).waitFor({ timeout: 30_000 });
  await page.locator(".sha.done").waitFor({ timeout: 10_000 });
  ok((await page.locator("li.typing").count()) === 0, "no typing indicator once the agents are done");
  const turns = page.locator("ol.turns > li");
  ok((await turns.count()) === 4, `four turns shown (${await turns.count()})`);
  ok(calls === 4, `four model calls made (${calls})`);
  const t2 = await turns.nth(1).innerText();
  ok(t2.includes(C.supplier), "turn 2 is the supplier's agent, labelled a simulated supplier played by Claude");
  ok(t2.includes(C.refused) && t2.includes(RULES.payee_unchanged), "the bank change is refused, with the rule that held");
  ok(t2.includes("DE44 … 4931"), "the changed account shown masked");
  ok((await turns.nth(1).locator(".stamp").innerText()).trim().toLowerCase() === C.stamp.toLowerCase(), `the IBAN swap's bubble carries the "${C.stamp}" stamp`);
  ok(await turns.nth(1).evaluate((n) => n.classList.contains("supplier") && n.querySelector(".pill.sim") !== null), "the supplier's bubble is on its side, with the simulated-supplier badge");
  const sides = await page.$$eval("ol.turns > li.turn .bubble", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return Math.round(r.left + r.width / 2); }));
  // At phone width the chat is one column (Max, 15 Nov): every bubble starts at the same place; the two sides are told
  // apart by name, avatar and the simulated-supplier badge. At 1440 (part 2) Purser is left, the supplier right.
  const lefts = await page.$$eval("ol.turns > li.turn .bubble", (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().left)));
  ok(lefts.every((l) => Math.abs(l - lefts[0]!) <= 2), `390 px: the chat is one column (bubble left edges ${lefts.join(", ")}; centres ${sides.join(", ")})`);
  const chipsNow = await page.$$eval("#railchips li", (ls) => ls.map((l) => l.className));
  ok(chipsNow.length === 4 && chipsNow.every((c) => c.includes("ok")), "the four rail chips, green after the last turn");
  const meter = await page.locator("#meter").innerText();
  ok(meter.includes("EUR 1,850.00") && meter.includes("EUR 1,813.00") && /EUR 37\.00/.test(meter) && meter.includes("2.0%"), "the deal meter: the invoice, the current and best offer, the discount in EUR and %");
  const t1 = await turns.nth(0).innerText();
  ok(t1.includes(C.sourcing) && t1.includes("EUR 1,794.50") && t1.includes(d(5)) && t1.includes(C.within) && t1.includes(C.live), "turn 1: the Sourcing agent, live, its terms, within the rails");
  ok((await page.locator(".pill.rec").count()) === 0, "no turn labelled recorded in a live negotiation");
  const t3 = await turns.nth(2).innerText();
  ok(t3.includes("EUR 1,813.00") && t3.includes("held the Sourcing agent") && t3.includes("EUR 1,822.25"), "turn 3: code held the buyer to the supplier's best offer (EUR 1,813.00), and says what it had asked");
  const deal = await page.locator("#deal").innerText();
  ok(deal.includes("EUR 1,813.00") && deal.includes("EUR 37.00"), "the agreement: EUR 1,813.00, EUR 37.00 off");
  ok(/[0-9a-f]{64}/.test(deal), "the agreement's SHA-256 shown");
  await sane(page, "live, agreed");
  await shot("2-agreed");

  // The passkey: made on the first tap (one prompt a tap), the terms signed on the second.
  await page.getByRole("button", { name: C.sign }).click();
  await page.locator("ol.steps li").nth(1).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => { const b = document.getElementById("sign") as HTMLButtonElement | null; return !!b && !b.disabled; }, undefined, { timeout: 30_000 });
  await page.getByRole("button", { name: C.sign }).click();
  await page.getByRole("heading", { name: C.paidHead }).waitFor({ timeout: 30_000 });
  const steps = await page.locator("ol.steps").innerText();
  ok(steps.includes(C.steps.signed), "signed with the passkey");
  ok(steps.includes(C.tamperRefused) && steps.includes("EUR 1,813.01"), "one cent more with the same signature: refused");
  ok((await page.locator("ol.steps li.stop").count()) === 1, "the one-cent refusal drawn as a red line");
  ok(steps.includes(C.steps.paid) && steps.includes("EUR 1,813.00"), "paid as signed");
  ok((await page.locator("ol.steps li.bad").count()) === 0, "no step failed");
  ok(!(await page.getByRole("button", { name: C.sign }).isVisible()) && !(await page.locator("#go").isVisible()), "the used buttons are gone");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: C.download }).click()]);
  const proof = JSON.parse(readFileSync(await dl.path(), "utf8")) as Record<string, unknown>;
  ok(dl.suggestedFilename() === "purser-proof.json" && JSON.stringify(proof).includes("1813.00"), `the proof bundle downloads (${dl.suggestedFilename()})`);
  // End to end (Max, 15 Nov): the amount the agents agreed is the amount in the terms the passkey signed. The agreement's
  // hash names the agreed invoice (its reference); the terms' canonical JSON hashes to the WebAuthn challenge; the proof
  // file verifies with the /verify page's own code (src/proof/bundle.ts) in Node and on /verify itself in the browser;
  // an edited proof file does not.
  const agreedSha = /[0-9a-f]{64}/.exec(deal)![0];
  const terms = proof.terms as Record<string, unknown>;
  const sorted = (o: unknown) => JSON.stringify(Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))));
  ok(sorted(proof.negotiation) === sorted({ original_invoice_id: null, original_invoice_no: "BTX-2026-25", original_amount: "1850.00", agreed_amount: "1813.00", discount: "37.00", currency: "EUR", agreement_sha256: agreedSha, turns: 4, superseded: false }),
    `the proof file says what was negotiated, beside the signed terms (${JSON.stringify(proof.negotiation)})`);
  ok(terms.amount === "1813.00" && terms.currency === "EUR" && terms.reference === `BTX-2026-25-${agreedSha.slice(0, 8)}`,
    `the signed terms carry the agreed amount, EUR 1813.00, and the agreement's hash in their reference (${String(terms.amount)}, ${String(terms.reference)})`);
  const node = await verifyProofBundle(proof);
  const failedChecks = node.checks.filter((x) => !x.ok).map((x) => x.check);
  const challenge = node.checks.find((x) => x.check === "challenge");
  ok(node.ok && failedChecks.length === 0 && !!challenge?.ok && createHash("sha256").update(proof.canonical as string).digest("hex") === proof.terms_sha256,
    `the proof file verifies (Node, the /verify code): the terms' canonical JSON hashes to the passkey's challenge (${node.checks.length} checks${failedChecks.length ? `; failed: ${failedChecks.join(", ")}` : ""})`);
  const edited = JSON.parse(JSON.stringify(proof)) as { terms: Record<string, unknown> };
  edited.terms.amount = "1813.01";
  const bad = await verifyProofBundle(edited);
  ok(!bad.ok && bad.checks.some((x) => x.check === "terms hash" && !x.ok), "the same file with one cent more: NOT VALID (the terms hash no longer matches)");
  // /verify in the browser: paste the file; then the edited one.
  const vp = await ctx.newPage();
  const verifyAsked: string[] = [];
  vp.on("request", (q) => { const u = new URL(q.url()); if (u.pathname !== "/verify" && !u.pathname.startsWith("/assets/")) verifyAsked.push(u.pathname); });
  await vp.goto(`${ORIGIN}/verify`);
  const verdict = async (text: string) => {
    await vp.fill("#v-paste", text);
    await vp.click("#v-check");
    await vp.locator("#v-verdict:not([hidden])").waitFor({ timeout: 10_000 });
    await vp.waitForFunction((t) => (document.getElementById("v-paste") as HTMLTextAreaElement).value === t && document.querySelectorAll("#v-checks li").length > 0, text);
    return vp.evaluate(() => ({ ok: document.getElementById("v-verdict")?.getAttribute("data-ok"), text: document.getElementById("v-verdict")?.textContent ?? "", lines: document.querySelectorAll("#v-checks li").length, pass: document.querySelectorAll("#v-checks li.ok").length, page: document.querySelector("main")?.textContent ?? "" }));
  };
  const good = await verdict(JSON.stringify(proof));
  ok(good.ok === "true" && good.text.trim().startsWith(VERIFY_BUNDLE_VERDICT.valid) && good.text.includes(`${good.lines} of ${good.lines}`) && good.pass === good.lines && good.lines >= 10 && good.page.includes("EUR 1,813.00"), `/verify: VALID, every line passes (${good.pass}/${good.lines}), with EUR 1,813.00 in the terms`);
  ok(good.page.includes("EUR 1,850.00 to EUR 1,813.00") && good.page.includes("EUR 37.00") && good.page.includes(agreedSha), "/verify: the negotiation beside the terms: EUR 1,850.00 to EUR 1,813.00, EUR 37.00 off, the agreement's SHA-256");
  if (shots) await vp.screenshot({ path: join(shots, "verify-valid-390.png"), fullPage: true });
  const worse = await verdict(JSON.stringify(edited));
  ok(worse.ok === "false" && worse.text.includes(VERIFY_BUNDLE_VERDICT.invalid), `/verify: the edited file is NOT VALID ("${worse.text.trim().slice(0, 60)}")`);
  if (shots) await vp.screenshot({ path: join(shots, "verify-edited-390.png"), fullPage: true });
  ok(verifyAsked.length === 0, `/verify asked no server (${verifyAsked.join(", ") || "none"})`);
  await vp.close();
  await sane(page, "live, paid");
  await shot("3-paid");
  await ctx.close();
}

// 2. The kill switch: Claude off. /try's own company in the tab (sessionStorage "purser.try"), 1440 px dark.
{
  ok((await admin({ op: "set", key: "claude", value: "off" })).status === 200, "kill switch: claude off");
  const before = calls;
  const start = await handle(new Request(`${ORIGIN}/v1/try/start`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.77" }, body: "{}" }), env);
  const co = (await start.json()) as Record<string, unknown>;
  ok(start.status === 201, "a /try company to reuse");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await ctx.addInitScript((s) => { sessionStorage.setItem("purser.try", s); }, JSON.stringify({ tenant: co.tenant, session: co.session, visitor_token: co.visitor_token, expires_at: co.session_expires_at ?? co.expires_at }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`recorded: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`recorded: ${m.text()}`); });
  let started = 0;
  page.on("request", (q) => { if (q.url().endsWith("/v1/try/start")) started++; });
  await page.goto(`${ORIGIN}/try/negotiate`);
  await page.evaluate(() => { (window as unknown as { typed: number }).typed = 0; new MutationObserver(() => { if (document.querySelector("li.typing")) (window as unknown as { typed: number }).typed++; }).observe(document.body, { subtree: true, childList: true }); });
  const pads2 = await page.$$eval("section.card", (cs) => cs.map((c) => { const h = c.querySelector("h2")!; const cr = c.getBoundingClientRect(), hr = h.getBoundingClientRect(); return [Math.round(hr.top - cr.top), Math.round(hr.left - cr.left)]; }));
  ok(pads2.length === 2 && pads2.every(([t, l]) => Math.abs(t! - l!) <= 2), `1440 px: the cards' headings sit at the same padding top and side (${JSON.stringify(pads2)})`);
  await page.getByRole("button", { name: C.start }).click();
  await page.getByRole("heading", { name: C.agreedHead }).waitFor({ timeout: 30_000 });
  const talk = await page.locator("#talk").innerText();
  ok(talk.includes("Recorded negotiation") && talk.includes("Not a live model call"), "the recorded negotiation, labelled");
  ok(talk.includes("Claude is switched off"), "and why");
  ok((await page.locator(".pill.rec").count()) === 4 && !talk.includes(C.live), "every turn labelled recorded, none live");
  ok(calls === before, "no model call with the kill switch on");
  ok((await page.evaluate(() => (window as unknown as { typed: number }).typed)) === 0, "a recorded negotiation never shows a typing indicator");
  ok(started === 0, "the company /try started in this tab is used, no new start");
  ok(talk.includes(RULES.payee_unchanged), "the rails still refuse the bank change");
  const sides2 = await page.$$eval("ol.turns > li.turn .bubble", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return Math.round(r.left + r.width / 2); }));
  ok(sides2[0]! < sides2[1]! && sides2[2]! < sides2[3]!, `1440 px: Purser on the left, the supplier on the right (bubble centres ${sides2.join(", ")})`);
  await sane(page, "recorded");
  if (shots) await page.screenshot({ path: join(shots, "recorded.png"), fullPage: true });
  await ctx.close();
}

// 3. The error paths (15 Nov, Max: "nothing happens when I click"): instant feedback, a clear message for every
//    refusal, the labelled recording played at once, and Start again.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`errors: ${String(e)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (429|503)/.test(m.text())) errors.push(`errors: ${m.text()}`); });
  // a. The demo paused (starts off): the message, then the recording, labelled, with nothing to sign.
  ok((await admin({ op: "set", key: "starts", value: "off" })).status === 200, "starts off (the demo paused)");
  await page.goto(`${ORIGIN}/try/negotiate`);
  const t0 = Date.now();
  await page.getByRole("button", { name: C.start }).click();
  await page.locator("li.thinking").first().waitFor({ timeout: 2_000 }).catch(() => undefined);
  const firstFeedback = Date.now() - t0;
  ok(firstFeedback < 1_000, `a thinking row on Purser's side right after the click (${firstFeedback} ms, Playwright's click included)`);
  await page.locator(".neg-err").waitFor({ timeout: 15_000 });
  ok((await page.locator(".neg-err").innerText()).includes(C.pausedRecorded), `a paused demo says so: "${C.pausedRecorded}"`);
  await page.locator("ol.turns > li.turn:not(.thinking):not(.typing)").nth(3).waitFor({ timeout: 15_000 });
  const rec = await page.locator("#talk").innerText();
  ok(rec.includes("Recorded negotiation") && (await page.locator(".pill.rec").count()) === 4, "and plays the labelled recording at once, four turns");
  await page.getByRole("button", { name: C.again }).waitFor({ timeout: 15_000 });
  ok((await page.locator("#more").innerText()).includes(C.nothingToSign), "nothing to sign, and Start again");
  ok((await admin({ op: "set", key: "starts", value: "on" })).status === 200, "starts on again");
  ok((await admin({ op: "set", key: "claude", value: "on" })).status === 200, "claude on again (section 2 switched it off)");
  // b. A company that used its 3 negotiations: the message, the recording, then Start again runs live on a new company.
  const st = await handle(new Request(`${ORIGIN}/v1/try/start`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.91" }, body: "{}" }), env);
  const co = (await st.json()) as Record<string, string>;
  for (let i = 0; i < 3; i++) await handle(new Request(`${ORIGIN}/v1/try/negotiate`, { method: "POST", headers: { authorization: `Bearer ${co.session}`, origin: ORIGIN } }), env);
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await ctx2.addInitScript((v) => { sessionStorage.setItem("purser.try", v); }, JSON.stringify({ tenant: co.tenant, session: co.session, visitor_token: co.visitor_token, expires_at: co.session_expires_at ?? co.expires_at }));
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(`limit: ${String(e)}`));
  p2.on("console", (m) => { if (m.type() === "error" && !/status of (429|503)/.test(m.text())) errors.push(`limit: ${m.text()}`); });
  await p2.goto(`${ORIGIN}/try/negotiate`);
  await p2.getByRole("button", { name: C.start }).click();
  await p2.locator(".neg-err").waitFor({ timeout: 15_000 });
  ok((await p2.locator(".neg-err").innerText()).includes(C.companyLimit), "a company past its 3 negotiations says so");
  await p2.locator(".pill.rec").nth(3).waitFor({ timeout: 15_000 });
  ok(true, "and plays the recording");
  const before = calls;
  await p2.getByRole("button", { name: C.again }).click();
  await p2.getByRole("heading", { name: C.agreedHead }).waitFor({ timeout: 30_000 });
  const recLeft = await p2.locator(".pill.rec").count(), errLeft = await p2.locator(".neg-err").count();
  ok(calls > before && recLeft === 0 && errLeft === 0, `Start again: a new test company, a live negotiation, the old message gone (calls +${calls - before}, recorded ${recLeft}, errors ${errLeft})`);
  await sane(p2, "start again");
  if (shots) await p2.screenshot({ path: join(shots, "start-again-1440.png"), fullPage: true });
  await ctx2.close();
  await ctx.close();
}

// 4. The links.
ok(FINISH_LINKS.negotiate.href === "/try/negotiate" && FINISH_LINKS.negotiate.label === "Watch agents negotiate", "/try's finish links here, same tab");
ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
server.close();
console.log(failed ? `\nnegotiate check: ${failed} problem(s)` : "\nnegotiate check passes: live turns (stubbed Claude), the bank change refused, signed, one cent refused, paid; the recorded negotiation labelled");
process.exit(failed ? 1 : 0);
