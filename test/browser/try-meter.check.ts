// The Claude meter and the boxes of /try on a phone (21 Nov 2026; Max: "'No Claude call yet · code' makes it look fake",
// "6 calls at $0.0019 at the approved step: I think it uses more than we say", and "make sure all text stays neatly inside
// the box"). Against a real cloud with an engine in this process (test money on a simulated bank) and no model key. Live
// Claude is stood in on top of this cloud's real answers, as test/browser/try-rail.check.ts does: the start says Claude
// reads live, and the engine's events carry the Claude calls of a recorded walk of the public /try
// (docs/runs/2026-11-21-phone-try/run-4.json: each reading's two calls, then the Treasury, Checker and Payer agents' runs
// of two calls each, and the review of the invoice above the limit), with their recorded costs. The walk: the EUR 120.00
// invoice the agent pays alone, then the EUR 1,850.00 one: picked, read, checked, signed, paid, one cent changed, refused,
// and the finish. At each step, at 390 and 360 px:
// - the rail's line is a state, never an absence: "Claude is next" before the first call, then "$cost · n Claude calls",
//   and the drawer says why ("17 Claude calls: Reader 5, Treasury 4, Checker 4, Payer 4. …") and what decides the step;
// - at the CFO's approval the meter says 17 calls and USD 0.0036, the engine's own figures for that walk;
// - the reading's badge counts all of its calls ("3 calls · $0.0004": classify, read, review), not the first one only;
// - no text runs outside its box or touches its border (cards, summaries, pills, buttons, the footnote), and no
//   horizontal scroll.
// Then once with Purser's code reading (no stand-in): "Purser's rules · no AI needed", never "no Claude call".
//   npx tsx test/browser/try-meter.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { gotoLoaded, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "test-results/try-meter";
mkdirSync(shots, { recursive: true });
const PORT = 9300 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "try-meter-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "try-meter-check-"));
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "t".repeat(48), adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 }, tryIt: {},
};
env.engine = nodeEngines({ sql: env.sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN });
await handle(new Request(`${ORIGIN}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: JSON.stringify({ op: "set", key: "starts", value: "on" }) }), env);
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("cf-connecting-ip", "127.0.0.1");
  const r = await handle(new Request(`${ORIGIN}${req.url ?? "/"}`, { method: req.method ?? "GET", headers, ...(chunks.length && req.method !== "GET" ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

type Item = { seq: number; ts?: string; actor?: string; event: string; subject?: string | null; fields?: Record<string, unknown> };
// The recorded walk's Claude calls (run-4.json, main tab), by invoice: offset from the invoice's ap.received, event, fields.
const H = "claude-haiku-5-5";
const read = (cost: number, req: string) => ({ event: "claude.read", fields: { source: "claude", model: H, request_id: req, cost_usd_micros: cost } });
const agentRun = (agent: string, cost: number, ms: string, req: string) => ({ event: "agent.run", fields: { agent, model: H, status: "done", turns: 2, cost_usd_micros: cost, latency_ms: 3600, request_id: req, claude_ms: ms } });
const RECORDED: Record<string, { at: number; e: { event: string; fields: Record<string, unknown> } }[]> = {
  "120.00": [
    { at: -0.5, e: read(86, "req_011ChFBKhueffeWD17JLAXHt") }, { at: -0.45, e: read(166, "req_011ChFBKhvQ9wjkN7wG8i3r9") },
    { at: -0.4, e: agentRun("treasury", 564, "1937,1733", "req_011ChFBKys6zt5Jx4kbYssLn") }, { at: -0.35, e: agentRun("checker", 474, "1579,2101", "req_011ChFBKxPJKRjsc6DvF4Tfp") },
    { at: 0.1, e: agentRun("payer", 400, "1877,1933", "req_011ChFBLJjQpojqkE1S7t9s9") },
  ],
  "1850.00": [
    { at: -0.5, e: read(87, "req_011ChFBM4Thekhw6pknedME4") }, { at: -0.45, e: read(168, "req_011ChFBM4USjFnrfPYdTP15b") },
    { at: -0.4, e: agentRun("treasury", 561, "1901,1553", "req_011ChFBMLSdBZ7FzVKyNVh48") }, { at: -0.35, e: agentRun("checker", 507, "1538,2341", "req_011ChFBMJw6tVf5cF82zvfcM") },
    { at: 0.05, e: read(142, "req_011ChFBMUvNapKjdfhd1HZZB") }, { at: 0.1, e: agentRun("payer", 425, "1591,2050", "req_011ChFBMriYPPZYCoQGibua2") },
  ],
};

async function standInLive(ctx: BrowserContext): Promise<void> {
  const added = new Map<number, Item>();
  await ctx.route("**/v1/try/start", async (route) => {
    const res = await route.fetch();
    const j = await res.json() as { mode?: Record<string, string> };
    await route.fulfill({ response: res, json: { ...j, mode: { ...(j.mode ?? {}), claude: "live", agents: "live" } } });
  });
  await ctx.route("**/v1/engine/events*", async (route) => {
    const u = new URL(route.request().url());
    const after = Number(u.searchParams.get("after") ?? 0) || 0;
    u.searchParams.set("after", String(Math.floor(after)));
    const res = await route.fetch({ url: u.href });
    const j = await res.json() as { items?: Item[] };
    const items = (Array.isArray(j.items) ? j.items : []).filter((e) => e.event !== "claude.fallback")
      .map((e) => (e.event === "ap.received" && typeof e.fields?.amount === "string" && RECORDED[e.fields.amount] ? { ...e, fields: { ...e.fields, read_by: `claude:${H}` } } : e));
    for (const e of items) if (e.event === "ap.received" && typeof e.fields?.amount === "string" && RECORDED[e.fields.amount] && !added.has(e.seq - 0.5)) {
      for (const r of RECORDED[e.fields.amount]!) added.set(e.seq + r.at, { ...e, seq: e.seq + r.at, actor: "treasury", event: r.e.event, fields: r.e.fields });
    }
    const top = Math.max(after, ...items.map((e) => e.seq)) + 1;
    const extra = [...added.values()].filter((e) => e.seq > after && e.seq < top);
    await route.fulfill({ response: res, json: { ...j, items: [...items, ...extra].sort((a, b) => a.seq - b.seq) } });
  });
}

/** Every text that runs outside its box or comes closer than `pad` px to its left or right border; and the page's width. */
type Bad = { box: string; text: string; why: string };
// Plain JavaScript, sent as text: a function from this file would carry tsx's naming helper into the page, and a stand-in
// for that helper on the page would hide the same error in the page's own script.
const AUDIT = String.raw`(() => {
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c === "transparent" ? 0 : 1; const p = m[1].split(",").map((x) => x.trim()); return p.length === 4 ? Number(p[3]) : 1; };
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const boxed = (el) => {
    const cs = getComputedStyle(el);
    const border = (parseFloat(cs.borderLeftWidth) > 0 && alpha(cs.borderLeftColor) > 0.05) || (parseFloat(cs.borderRightWidth) > 0 && alpha(cs.borderRightColor) > 0.05);
    const fill = alpha(cs.backgroundColor) > 0.05 && parseFloat(cs.borderTopLeftRadius) >= 6;
    // Gradient text (background-clip: text) is a fill of the letters, not a box.
    const clipText = cs.backgroundClip === "text" || cs.getPropertyValue("-webkit-background-clip") === "text";
    return !clipText && ((border && parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderBottomWidth) > 0) || fill || cs.backgroundImage.includes("gradient"));
  };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
  const bad = [];
  for (const root of document.querySelectorAll("#main, .pv-rail, .pv-cap")) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent || "").trim();
      if (!t) continue;
      let box = n.parentElement;
      while (box && box !== document.body && !boxed(box)) box = box.parentElement;
      if (!box || box === document.body || !shown(box) || !shown(n.parentElement)) continue;
      if (n.parentElement.closest("input, textarea, select, pre, .pv-hood code")) continue;
      const b = box.getBoundingClientRect(), cs = getComputedStyle(box);
      // A step's number in its round badge (about 20 px) is centred, not padded: only outside it counts.
      const round = b.width <= 36 && b.height <= 36;
      const L = b.left + parseFloat(cs.borderLeftWidth), R = b.right - parseFloat(cs.borderRightWidth);
      const pad = /\b(btn|chip|pill|rchip|tag|pv-tag|pv-sm|mode|hashpill)\b/.test(name(box)) || box.tagName === "BUTTON" ? 3 : 6;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        const why = r.left < L - 0.5 || r.right > R + 0.5 ? "outside its box" : round ? "" : r.left - L < pad - 0.5 ? Math.round(r.left - L) + " px from its left border" : R - r.right < pad - 0.5 ? Math.round(R - r.right) + " px from its right border" : "";
        if (why) { bad.push({ box: name(box), text: t.slice(0, 50), why }); break; }
      }
    }
  }
  // A summary's own "+" or "−" (a ::after) and its text need the summary's padding inside a boxed details.
  for (const s of document.querySelectorAll("#main details > summary")) {
    if (!shown(s) || !(boxed(s.parentElement) || boxed(s))) continue;
    const cs = getComputedStyle(s);
    if (parseFloat(cs.paddingLeft) < 8 || parseFloat(cs.paddingRight) < 8) bad.push({ box: name(s), text: (s.textContent || "").trim().slice(0, 50), why: "summary padding " + cs.paddingLeft + " / " + cs.paddingRight });
  }
  return { bad, sw: document.documentElement.scrollWidth, iw: innerWidth };
})()`;
const audit = (page: Page) => page.evaluate(AUDIT) as Promise<{ bad: Bad[]; sw: number; iw: number }>;

const browser = await launchBrowser();
const errors: string[] = [];
const railText = (page: Page) => page.locator(".pv-rail").innerText().catch(() => "");
const head = (page: Page) => page.locator(".pv-rail-h .sum").innerText().catch(() => "");

async function boxes(page: Page, tag: string): Promise<void> {
  const a = await audit(page);
  ok(a.sw <= a.iw, `${tag}: no horizontal scroll (${a.sw} ≤ ${a.iw})`);
  ok(a.bad.length === 0, `${tag}: every text inside its box, clear of the border${a.bad.length ? ": " + a.bad.slice(0, 6).map((b) => `${b.box} "${b.text}" ${b.why}`).join(" | ") : ""}`);
}

async function walk(width: number, live: boolean): Promise<void> {
  const W = `${live ? "live" : "code"}-${width}`;
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${W}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${W}: ${m.text()}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  if (live) await standInLive(ctx);
  const click = async (name: string | RegExp, timeout = 60_000) => { const b = page.getByRole("button", { name }).first(); await b.waitFor({ timeout }); await b.click(); };
  const shot = async (n: string, opts: { drawer?: boolean } = {}) => {
    await page.waitForTimeout(700);
    if (opts.drawer && !(await page.locator(".pv-rail.open").count())) await page.locator(".pv-rail-h").click().catch(() => undefined);
    await page.waitForTimeout(300);
    await boxes(page, `${W} ${n}`);
    // A full-page picture of a phone: the site's floating menu (fixed, outside the step) would sit over the middle of
    // it, so it is left out of the picture only, then put back.
    await page.evaluate(`for (const el of document.querySelectorAll("body *")) if (/^(fixed|sticky)$/.test(getComputedStyle(el).position) && !el.closest("#main, .pv-rail, .pv-cap, .pv-how, .pv-stages")) { el.classList.add("shot-hidden"); el.style.setProperty("visibility", "hidden", "important"); }`);
    await page.screenshot({ path: join(shots, `${W}-${n}.png`), fullPage: true });
    await page.evaluate(`for (const el of document.querySelectorAll(".shot-hidden")) { el.classList.remove("shot-hidden"); el.style.removeProperty("visibility"); }`);
    if (opts.drawer) await page.locator(".pv-rail-h").click().catch(() => undefined);
  };
  await gotoLoaded(page, `${ORIGIN}/try`);
  await page.waitForTimeout(600);
  await shot("0-start");
  await click(/Start the live demo|Launch the live transfer demo/);
  await page.locator(".samples button[aria-pressed]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  {
    const h = await head(page);
    ok(live ? h === "Claude is next" : h === "Purser's rules · no AI needed", `${W} invoice: the rail says "${h}"`);
    ok(!/no Claude call|not asked/i.test(await railText(page)), `${W} invoice: no "no Claude call" anywhere in the rail`);
  }
  await shot("1-invoice", { drawer: true });
  await click(/A small invoice inside the agent's limit/);
  await click(/Give it to the AI agent/);
  await page.getByRole("button", { name: "See the agent pay it" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (live) {
    const h = await head(page);
    ok(/^\$0\.00\d\d · \d+ Claude calls$/.test(h), `${W} EUR 120.00 checked: the rail counts the calls with their cost ("${h}")`);
  }
  await click("See the agent pay it");
  await click("Try an invoice above EUR 500 →");
  await page.locator(".samples button[aria-pressed=true]").first().waitFor({ timeout: 30_000 });
  // The reading itself, held a moment so the step can be seen (live, Claude takes seconds; here the engine is instant).
  let release = () => undefined as void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route(/\/v1\/engine\/samples\/[^/]+$/, async (route) => { await held; await route.continue(); });
  await click(/Give it to the AI agent/);
  await page.waitForTimeout(1200);
  await shot("2-read");
  release();
  await page.getByRole("button", { name: /Send to CFO for approval/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (live) {
    const badge = (await page.locator(".screen.work .card.inv .slot .chip").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    // The reading of the EUR 1,850.00 invoice: classify, read and review, USD 0.000397 (the "· " before them is the badge's CSS).
    ok(/^Read by Claude · Haiku 5\.5 3 calls · \$0\.0004$/.test(badge), `${W} check: the reading's badge counts all three of its calls ("${badge}")`);
  }
  await shot("3-check", { drawer: true });
  await click(/Send to CFO for approval/);
  for (let i = 0; i < 6 && !(await page.getByRole("button", { name: /Approve & sign/ }).count()); i++) {
    const setup = page.getByRole("button", { name: /Create your approval passkey/ }).first();
    if (await setup.count() && await setup.isVisible()) await setup.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  await page.getByRole("button", { name: /Approve & sign/ }).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  {
    const h = await head(page), r = await (async () => { await page.locator(".pv-rail-h").click(); await page.waitForTimeout(300); const t = await railText(page); await page.locator(".pv-rail-h").click(); return t; })();
    if (live) {
      // The engine's own figures for the recorded walk at the CFO's approval: 17 requests, USD 0.003580 (summary.json).
      ok(h === "$0.0036 · 17 Claude calls", `${W} sign: the meter says the walk's 17 calls and USD 0.0036 ("${h}")`);
      ok(/17 Claude calls: Reader 5, Treasury 4, Checker 4, Payer 4\./.test(r), `${W} sign: the drawer says who made each call`);
    }
    ok(/This step: Your passkey signs · Purser's rules check it, no AI needed/.test(r), `${W} sign: the drawer says Purser's rules decide this step`);
    ok(!/no Claude call|not asked/i.test(r), `${W} sign: no "no Claude call" in the drawer`);
  }
  await shot("4-sign", { drawer: true });
  await click(/Approve & sign/);
  await page.getByRole("button", { name: "Now try to change it" }).waitFor({ timeout: 60_000 });
  await shot("5-paid", { drawer: true });
  await click("Now try to change it");
  await page.waitForFunction(() => (document.querySelector("#p-amt") as HTMLInputElement | null)?.value === "1850.01", null, { timeout: 20_000 });
  await click("Try to pay with my earlier approval");
  await page.waitForSelector(".why .head", { timeout: 30_000 });
  await shot("6-refused", { drawer: true });
  await click("See your result");
  await page.locator(".fin-row").nth(2).waitFor({ timeout: 30_000 });
  await shot("7-result");
  await page.locator(".fin-hood > summary").click();
  await page.waitForTimeout(500);
  await shot("8-result-open");
  await ctx.close();
}

await walk(390, true);
await walk(360, true);
await walk(390, false);
ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
