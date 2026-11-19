// One recorded walk through the public /try (19 Nov), for docs/runs/2026-11-19-live-try.md: the judge's journey of
// test/browser/judge-try.check.ts --live, on https://kit11.max-31b.workers.dev, in Chromium with a CDP virtual passkey
// (ctap2, internal, user verification on), with every /v1 answer the page gets kept as data. Test money only: each run
// is a fresh /try test company on the simulated bank, and its payouts go to the Airwallex sandbox.
//   1. Launch; the EUR 120.00 invoice, read and paid by the agent alone (within the EUR 500.00 limit).
//   2. The EUR 1,850.00 invoice: sent to the CFO, a passkey enrolled and the exact terms signed, then paid.
//   3. The one-cent change (1,850.01) with the earlier signature: refused.
//   4. The proof downloaded and checked on /verify (the file picker); the paid proof from the pay answer pasted there too;
//      both also checked with the repository's verifier (src/proof/bundle.ts).
//   5. In a second tab (a test company of its own, as the judge check does): the EUR 480.00 invoice inside the limit that
//      code's cash check holds.
// What is kept: the engine's own events (GET /v1/engine/events, read to the end after each part), the answers of the
// pay, approve, payout and sample routes, every /v1 call's method, path, status and time, and the times between clicks
// and what the page shows. Never kept: the session, the visitor token, any header. Nothing here reads a key.
//   npx tsx scripts/try-live-record.ts <run number> <desktop|phone|tablet|tablet-dark> <out dir>
// BROWSER=firefox (or webkit) walks it in that browser instead: Playwright has no virtual authenticator there, so the
// repository's software passkey (test/browser/support/softPasskey.ts, TEST ONLY: a real ES256 key in the page, whose
// signatures the server verifies as it does a phone's) is injected before the pages load. NSSDB=<dir>, with Firefox: a
// profile whose certificate store is a copy of that NSS store's (cert9.db, key4.db), for a machine whose outbound HTTPS
// goes through a proxy with its own CA (Chromium reads ~/.pki/nssdb itself; Firefox only its profile's). Nothing is
// trusted that the machine does not already trust, and no certificate check is turned off.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Browser, BrowserContext, BrowserContextOptions, Page, Response } from "playwright";
import { verifyProofBundle } from "../src/proof/bundle.js";
import { browserName, contextOptions, FIREFOX_PREFS, hasVirtualAuthenticator, launchBrowser } from "../test/browser/support/browser.js";
import { SOFT_PASSKEY } from "../test/browser/support/softPasskey.js";

const BASE = "https://kit11.max-31b.workers.dev";
const HOST = new URL(BASE).hostname;
const [runArg, profileArg, outArg] = process.argv.slice(2);
const run = Number(runArg);
const PROFILE_NAMES = ["desktop", "phone", "tablet", "tablet-dark"] as const;
const profile = (PROFILE_NAMES as readonly string[]).includes(profileArg ?? "") ? (profileArg as (typeof PROFILE_NAMES)[number]) : "desktop";
if (!Number.isInteger(run) || run < 1 || !outArg) throw new Error("usage: try-live-record.ts <run> <desktop|phone|tablet|tablet-dark> <out dir>");
const BROWSER = browserName();
const passkey = hasVirtualAuthenticator(BROWSER) ? "cdp-virtual-authenticator" : "software-passkey";
const out = outArg;
mkdirSync(out, { recursive: true });
const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, colorScheme: "light" as const },
  phone: { viewport: { width: 390, height: 844 }, colorScheme: "dark" as const, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  tablet: { viewport: { width: 768, height: 1024 }, colorScheme: "light" as const, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  "tablet-dark": { viewport: { width: 768, height: 1024 }, colorScheme: "dark" as const, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

/** Fields a /v1 answer may carry that are never written: a session or token, a passkey challenge. */
const NEVER = new Set(["session", "visitor_token", "challenge", "token"]);
const clean = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !NEVER.has(k)).map(([k, x]) => [k, clean(x)]));
  return v;
};

interface Call { at: string; method: string; path: string; status: number; ms: number | null; tab: string }
interface Ev { seq: number; ts: string; actor: string; event: string; subject: string | null; fields: Record<string, unknown> }
const calls: Call[] = [];
const kept: { at: string; method: string; path: string; status: number; tab: string; body: unknown }[] = [];
const errors: string[] = [];
const outside: string[] = [];
const failures: string[] = [];
const steps: Record<string, number | null> = {};
const page_says: Record<string, string | null> = {};
const site_build: Record<string, string | null> = {};
const KEEP = /^\/v1\/(try\/start|engine\/samples\/[a-z]+|engine\/invoices\/[^/]+\/pay|engine\/proposals\/[^/]+\/(approve|pay|payout\/simulate))$/;

function watch(p: Page, tab: string): void {
  p.on("pageerror", (e) => errors.push(`${tab}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${tab}: ${m.text()}`); });
  p.on("request", (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.hostname !== HOST) outside.push(r.url()); });
  p.on("response", async (r: Response) => {
    const u = new URL(r.url());
    if (u.hostname !== HOST || !u.pathname.startsWith("/v1/")) return;
    await r.finished().catch(() => null);
    const t = r.request().timing();
    const call: Call = { at: new Date().toISOString(), method: r.request().method(), path: u.pathname + u.search, status: r.status(), ms: t.responseEnd >= 0 ? Math.round(t.responseEnd) : null, tab };
    calls.push(call);
    if (call.method === "POST" && KEEP.test(u.pathname)) {
      const body: unknown = await r.json().then(clean, () => null);
      kept.push({ at: call.at, method: call.method, path: u.pathname, status: call.status, tab, body });
    }
  });
}

/** The engine's own events of the page's test company, read to the end (the page's session, from its own storage). */
async function events(p: Page): Promise<Ev[]> {
  return p.evaluate(async () => {
    const st = JSON.parse(sessionStorage.getItem("purser.try") || "{}") as { session?: string };
    const h = { authorization: `Bearer ${st.session ?? ""}` };
    const all: unknown[] = [];
    let after = 0;
    // The engine answers 2 reads a second per company (429 slow_down past that, with retry_ms), and the page reads too:
    // a page every 0.6 s, and a 429 waited out (up to 3 times) rather than taken for the end of the events.
    for (let i = 0, slowed = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const res = await fetch(`/v1/engine/events?after=${after}&limit=200`, { headers: h });
      if (res.status === 429 && slowed < 3) { slowed++; i--; const w = (await res.json().catch(() => ({}))) as { retry_ms?: number }; await new Promise((r) => setTimeout(r, Math.min(5_000, Math.max(1_000, w.retry_ms ?? 1_000)))); continue; }
      const j = (await res.json()) as { items?: { seq: number }[]; next?: number };
      const items = j.items ?? [];
      all.push(...items);
      if (!items.length) break;
      after = j.next ?? items.at(-1)!.seq;
    }
    return all;
  }) as Promise<Ev[]>;
}

/**
 * /verify's verdict for a proof whose every check passes: "VALID", or since the redeploy of 19 Nov during the mega run
 * (src/proof/verifyPage.ts VERIFY_BUNDLE_VERDICT, PR #438) "Proof valid · payment refused" for a refusal's proof, as the
 * downloaded one is; never "NOT VALID".
 */
const validVerdict = (v: string) => /^(VALID|Proof valid · payment refused)\b/.test(v) && /every check passes/.test(v) && !/NOT VALID/.test(v);
const clock = () => performance.now();
const since = (t: number) => Math.round(performance.now() - t);
const text = (p: Page) => p.evaluate(() => document.body.innerText);
const ok = (cond: unknown, what: string) => { if (!cond) failures.push(what); console.log(`${cond ? "ok  " : "FAIL"}  ${what}`); return Boolean(cond); };
async function press(p: Page, name: string | RegExp, timeout = 90_000): Promise<number> {
  const b = p.getByRole("button", { name }).first();
  await b.waitFor({ timeout });
  const t = clock();
  await b.click();
  return t;
}
/** An answer waited for; one never awaited (the walk stopped before it) is not an unhandled rejection that loses the record. */
const answer = (p: Page, re: RegExp, method = "POST") => {
  const w = p.waitForResponse((r) => r.request().method() === method && re.test(new URL(r.url()).pathname), { timeout: 120_000 });
  w.catch(() => undefined);
  return w;
};
let mainPage: Page | null = null;

const started_at = new Date().toISOString();
let browser: Browser | null = null;
let browserVersion: string | null = null;
let profileDir: string | null = null;
let ctx: BrowserContext | null = null;
/** The walk's browser context: a fresh one of a launched browser, or with NSSDB in Firefox, a profile seeded with that store. */
async function openContext(o: BrowserContextOptions): Promise<BrowserContext> {
  if (BROWSER === "firefox" && process.env.NSSDB) {
    profileDir = mkdtempSync(join(tmpdir(), "try-live-firefox-"));
    for (const f of ["cert9.db", "key4.db"]) copyFileSync(join(process.env.NSSDB, f), join(profileDir, f));
    const pw = createRequire(import.meta.url)("playwright") as { firefox: { launchPersistentContext(dir: string, o: BrowserContextOptions & { firefoxUserPrefs?: Record<string, boolean> }): Promise<BrowserContext> } };
    const c = await pw.firefox.launchPersistentContext(profileDir, { ...contextOptions("firefox", o), firefoxUserPrefs: { ...FIREFOX_PREFS } });
    browserVersion = c.browser()?.version() ?? null;
    return c;
  }
  browser = await launchBrowser(BROWSER);
  browserVersion = browser.version();
  return browser.newContext(o);
}
let mainEvents: Ev[] = [];
let cashEvents: Ev[] = [];
let bundle: Record<string, unknown> = {};
let paidBundleCli: { ok: boolean; checks: number; failed: string[] } | null = null;
let held: Record<string, unknown> = {};
try {
  ctx = await openContext({ ...PROFILES[profile], acceptDownloads: true });
  // Firefox and WebKit: the software passkey, in every page of the context, before the page's own script runs.
  if (passkey === "software-passkey") await ctx.addInitScript(SOFT_PASSKEY);
  const page = await ctx.newPage();
  mainPage = page;
  watch(page, "main");
  if (passkey === "cdp-virtual-authenticator") {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  }

  // 1. Launch: a fresh test company.
  await page.goto(`${BASE}/try`, { waitUntil: "load" });
  // Which build of /try answered: the site shows no version, so the SHA-256 of the page as served, its per-answer
  // nonces taken out (the same build gives the same hash; 19 Nov, purser-try was redeployed during the mega run).
  site_build.try_page_sha256 = await page.request.get(`${BASE}/try`).then(async (r) => createHash("sha256").update((await r.text()).replace(/nonce[-=]["']?[A-Za-z0-9+/=_-]+/g, "nonce")).digest("hex"), () => null);
  const startAns = answer(page, /^\/v1\/try\/start$/);
  let t = await press(page, /Launch the live transfer demo/);
  const st = await startAns;
  ok(st.status() === 201, `start: a test company (${st.status()})`);
  await page.getByRole("button", { name: /A small invoice inside the agent's limit/ }).first().waitFor({ timeout: 60_000 });
  steps.start_ms = since(t);

  // 2. EUR 120.00: read and checked, then paid by the agent alone.
  await press(page, /A small invoice inside the agent's limit/);
  t = await press(page, /Give it to the AI agent/);
  await page.getByRole("button", { name: "See the agent pay it" }).waitFor({ timeout: 120_000 });
  steps.read_120_ms = since(t);
  ok(await page.getByText("Checks passed. Approved by your policy.").isVisible(), "EUR 120.00: within the limit, approved by the policy");
  const alonePay = answer(page, /^\/v1\/engine\/invoices\/[^/]+\/pay$/);
  const aloneSim = answer(page, /^\/v1\/engine\/proposals\/[^/]+\/payout\/simulate$/);
  t = await press(page, "See the agent pay it");
  const ap = await alonePay;
  steps.autopay_ms = since(t);
  const apBody = (await ap.json().catch(() => null)) as { proposal?: { status?: string }; airwallex_payout?: { status?: string } } | null;
  ok(apBody?.proposal?.status === "EXECUTED", `EUR 120.00: paid by the agent alone (${String(apBody?.proposal?.status)})`);
  const as = await aloneSim;
  steps.autopay_awx_paid_ms = since(t);
  ok(((await as.json().catch(() => null)) as { note?: { status?: string } } | null)?.note?.status === "PAID", "EUR 120.00: the Airwallex sandbox transfer simulated to PAID");

  // 3. EUR 1,850.00: to the CFO, the passkey, signed, paid.
  await press(page, "Try an invoice above EUR 500 →");
  await page.locator(".samples button[aria-pressed=true]").first().waitFor({ timeout: 30_000 });
  ok(/1,850\.00/.test(await page.locator(".samples button[aria-pressed=true]").first().innerText()), "the EUR 1,850.00 invoice is picked");
  t = await press(page, /Give it to the AI agent/);
  await page.getByRole("button", { name: /Send to CFO for approval/ }).first().waitFor({ timeout: 120_000 });
  steps.read_1850_ms = since(t);
  // The page enrols a passkey for a fresh company first; its own passkey button can then sign straight away (no
  // "Approve & sign" sheet), or the sheet comes up and is pressed. Either way, the click that led to the approval is the
  // one timed, and its words are kept.
  const approveAns = answer(page, /^\/v1\/engine\/proposals\/[^/]+\/approve$/);
  const signedPay = answer(page, /^\/v1\/engine\/proposals\/[^/]+\/pay$/);
  const signedSim = answer(page, /^\/v1\/engine\/proposals\/[^/]+\/payout\/simulate$/);
  let approvedAt: number | null = null;
  void approveAns.then(() => { approvedAt = clock(); }, () => undefined);
  const tCfo = await press(page, /Send to CFO for approval/);
  t = tCfo;
  const clicked: string[] = [];
  for (let i = 0; i < 240 && approvedAt === null; i++) {
    const signBtn = page.getByRole("button", { name: /Approve & sign/ }).first();
    if (await signBtn.count() && await signBtn.isVisible() && await signBtn.isEnabled()) {
      t = clock(); clicked.push((await signBtn.innerText()).trim()); page_says.sign_clicks = clicked.join(" | "); await signBtn.click().catch(() => undefined); break;
    }
    // Never a button that is only saying it is busy ("Saving your passkey…", "Waiting for your passkey…"), and at most
    // 4 presses in all: a page that does not move on stops the walk, it is not pressed again and again.
    const setup = page.getByRole("button", { name: /passkey|Face ID|Touch ID|Windows Hello|Set up/i }).first();
    if (clicked.length < 4 && await setup.count() && await setup.isVisible() && await setup.isEnabled() && !/…|\.\.\.|Saving|Waiting/i.test(await setup.innerText())) {
      // The same button pressed again only after 3 s: one passkey prompt at a time.
      const words = (await setup.innerText()).trim();
      if (words !== clicked.at(-1) || clock() - t > 3_000) { t = clock(); clicked.push(words); page_says.sign_clicks = clicked.join(" | "); await setup.click().catch(() => undefined); }
    }
    await page.waitForTimeout(250);
  }
  const apr = await approveAns;
  steps.sign_ms = Math.round((approvedAt ?? clock()) - t);
  steps.cfo_to_approved_ms = Math.round((approvedAt ?? clock()) - tCfo);
  page_says.sign_clicks = clicked.join(" | ");
  ok(apr.status() === 200, `EUR 1,850.00: approved with the passkey (${apr.status()})`);
  const sp = await signedPay;
  steps.sign_to_pay_answer_ms = since(t);
  await sp.finished().catch(() => null);
  const spT = sp.request().timing();
  steps.pay_ms = spT.responseEnd >= 0 ? Math.round(spT.responseEnd) : null;
  const spBody = (await sp.json().catch(() => null)) as { outcome?: string; proof?: unknown } | null;
  ok(spBody?.outcome === "paid", `EUR 1,850.00: paid (${String(spBody?.outcome)})`);
  await page.getByRole("button", { name: "Now try to change it" }).waitFor({ timeout: 120_000 });
  steps.sign_to_paid_on_screen_ms = since(t);
  const ss = await signedSim;
  steps.sign_to_awx_paid_ms = since(t);
  ok(((await ss.json().catch(() => null)) as { note?: { status?: string } } | null)?.note?.status === "PAID", "EUR 1,850.00: the Airwallex sandbox transfer simulated to PAID");
  await page.waitForTimeout(800);
  ok(/Paid · test money/i.test(await text(page)), "EUR 1,850.00 paid: the page says test money");
  if (spBody?.proof) {
    const r = await verifyProofBundle(spBody.proof);
    paidBundleCli = { ok: r.ok, checks: r.checks.length, failed: r.checks.filter((c) => !c.ok).map((c) => c.check) };
    writeFileSync(join(out, `run-${run}-proof-paid.json`), JSON.stringify(spBody.proof, null, 1) + "\n");
  }

  // 4. The one-cent change.
  await press(page, "Now try to change it");
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", null, { timeout: 20_000 });
  const refusedAns = answer(page, /^\/v1\/engine\/proposals\/[^/]+\/pay$/);
  t = await press(page, "Try to pay with my earlier approval");
  await refusedAns;
  await page.waitForSelector(".why .head", { timeout: 30_000 });
  steps.refusal_ms = since(t);
  const refusedText = await page.locator(".why .head").first().innerText();
  page_says.refusal_head = refusedText.trim();
  ok(/Blocked|refused/i.test(await text(page)), "1,850.01: refused");

  // 5. The result and the proof, checked on /verify.
  await press(page, "See your result");
  const dl = page.locator(".finishdl").first();
  await dl.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  const done = await text(page);
  page_says.done_line = /Done: [^\n]+/.exec(done)?.[0] ?? null;
  page_says.cost_line = /Claude cost of this invoice: [^\n]+/.exec(done)?.[0] ?? null;
  page_says.calls_line = /This run: \d+ calls?, \$[0-9.]+/.exec(done)?.[0] ?? null;
  const [download] = await Promise.all([page.waitForEvent("download"), dl.click()]);
  const file = join(out, `run-${run}-proof-downloaded.json`);
  await download.saveAs(file);
  ok(download.suggestedFilename() === "purser-proof.json", `the proof downloads as ${download.suggestedFilename()}`);
  mainEvents = await events(page);
  const v = await ctx.newPage();
  watch(v, "verify");
  await v.goto(`${BASE}/verify`, { waitUntil: "load" });
  t = clock();
  await v.locator("#v-file").setInputFiles(file);
  await v.locator("#v-verdict").waitFor({ state: "visible", timeout: 30_000 });
  steps.verify_ms = since(t);
  await v.waitForTimeout(300);
  const verdict = (await v.locator("#v-verdict").innerText()).replace(/\s+/g, " ").trim();
  const checks = await v.locator("#v-checks li").count();
  ok(validVerdict(verdict), `/verify, the downloaded proof: ${verdict}`);
  const cli = await verifyProofBundle(JSON.parse(readFileSync(file, "utf8")));
  ok(cli.ok, `the repository's verifier, the downloaded proof: ${cli.ok ? "VALID" : "NOT VALID"}`);
  let pastedVerdict: string | null = null;
  if (spBody?.proof) {
    await v.reload({ waitUntil: "load" });
    await v.locator("#v-paste").fill(JSON.stringify(spBody.proof));
    await v.locator("#v-check").click();
    await v.locator("#v-verdict").waitFor({ state: "visible", timeout: 30_000 });
    await v.waitForTimeout(300);
    pastedVerdict = (await v.locator("#v-verdict").innerText()).replace(/\s+/g, " ").trim();
    ok(validVerdict(pastedVerdict), `/verify, the paid proof pasted: ${pastedVerdict}`);
  }
  await v.close();
  const dlJson = JSON.parse(readFileSync(file, "utf8")) as { decision?: { outcome?: string }; proposal_id?: string; terms_sha256?: string };
  bundle = {
    downloaded: { file: `run-${run}-proof-downloaded.json`, outcome: dlJson.decision?.outcome ?? null, proposal_id: dlJson.proposal_id ?? null, terms_sha256: dlJson.terms_sha256 ?? null,
      verify_page: { verdict, checks_listed: checks }, repo_verifier: { ok: cli.ok, checks: cli.checks.length, failed: cli.checks.filter((c) => !c.ok).map((c) => c.check) } },
    paid: spBody?.proof ? { file: `run-${run}-proof-paid.json`, verify_page_pasted: { verdict: pastedVerdict }, repo_verifier: paidBundleCli } : null,
  };

  // 6. The EUR 480.00 invoice inside the limit that code's cash check holds, in a test company of its own.
  const p2 = await ctx.newPage();
  watch(p2, "cash");
  if (passkey === "cdp-virtual-authenticator") await (await ctx.newCDPSession(p2)).send("WebAuthn.enable");
  await p2.goto(`${BASE}/try`, { waitUntil: "load" });
  const st2 = answer(p2, /^\/v1\/try\/start$/);
  await press(p2, /Launch the live transfer demo/);
  ok((await st2).status() === 201, "cash sample: a test company of its own");
  await press(p2, /Inside the limit — but cash says wait/);
  ok(/480\.00/.test(await p2.locator(".samples button[aria-pressed=true]").first().innerText()), "cash sample: the EUR 480.00 invoice is picked");
  const sampleAns = answer(p2, /^\/v1\/engine\/samples\/[a-z]+$/);
  t = await press(p2, /Give it to the AI agent/);
  const panel = p2.locator(".why.cashctx");
  await panel.waitFor({ timeout: 120_000 });
  steps.hold_ms = since(t);
  const sa = (await (await sampleAns).json().catch(() => null)) as { invoice?: { id?: string; invoice_no?: string; total?: string; status?: string }; cash?: Record<string, unknown> } | null;
  await p2.waitForTimeout(800);
  const said = await panel.innerText();
  ok(/Decided by Purser's code, not the agent/.test(said), "cash sample: code's check decided, not the agent");
  ok(/No transfer was sent to Airwallex/.test(said), "cash sample: the page says no transfer was sent");
  cashEvents = await events(p2);
  const inv = await p2.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem("purser.try") || "{}") as { session?: string };
    const j = (await (await fetch("/v1/engine/invoices", { headers: { authorization: `Bearer ${s.session ?? ""}` } })).json()) as { items: { invoice_no: string; status: string }[] };
    return j.items.map((i) => ({ invoice_no: i.invoice_no, status: i.status }));
  });
  const moved = cashEvents.filter((e) => /^(transfer\.|airwallex\.transfer|proposal\.executed|proposal\.within_limit)/.test(e.event)).map((e) => e.event);
  ok(moved.length === 0, `cash sample: no payout made${moved.length ? ` (${moved.join(", ")})` : ""}`);
  held = {
    invoice: sa?.invoice ? { id: sa.invoice.id, invoice_no: sa.invoice.invoice_no, total: sa.invoice.total, status: sa.invoice.status } : null,
    cash: sa?.cash ?? null,
    panel_text: said.replace(/\s+/g, " ").trim(),
    invoices_after: inv,
    payout_events: moved,
  };
  await p2.close();
} catch (e) {
  failures.push(`stopped: ${String((e as Error).message ?? e).split("\n")[0]}`);
  // What the page showed when the walk stopped (its words only, no screenshot), to say why.
  page_says.when_stopped = mainPage ? await text(mainPage).then((x) => x.replace(/\s+/g, " ").trim().slice(-1500), () => null) : null;
  console.log("STOPPED", e);
} finally {
  await ctx?.close().catch(() => undefined);
  await (browser as Browser | null)?.close();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
}
ok(outside.length === 0, `no request left ${HOST}${outside.length ? `: ${[...new Set(outside)].slice(0, 5).join(", ")}` : ""}`);
ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

const record = {
  what: "One walk through the public /try on https://kit11.max-31b.workers.dev, recorded by scripts/try-live-record.ts (19 Nov 2026). A fresh /try test company each run; test money only; payouts to the Airwallex sandbox.",
  run, profile, viewport: PROFILES[profile].viewport, color_scheme: PROFILES[profile].colorScheme,
  browser: { name: BROWSER, version: browserVersion }, passkey,
  started_at, finished_at: new Date().toISOString(), ok: failures.length === 0, failures,
  steps_ms: steps, page_says, site_build, bundle, held,
  answers: kept, calls, console_errors: errors, outside_requests: [...new Set(outside)],
  events: { main: mainEvents, cash: cashEvents },
};
writeFileSync(join(out, `run-${run}.json`), JSON.stringify(record, null, 1) + "\n");
console.log(failures.length ? `${failures.length} failed` : "all ok");
process.exit(failures.length ? 1 : 0);
