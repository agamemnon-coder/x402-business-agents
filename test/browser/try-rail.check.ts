// The Live engine rail on /try (cloud/src/try/presentMode.ts; owner, 16 Nov): read-only, beside the steps at 1280 px and
// wider, a closed drawer below that. Against a real cloud with an engine in this process (test money on a simulated
// bank) and no model key, so the reading is the code fallback and the rail says so (no Claude call). The run: the small
// EUR 120.00 sample inside the agent's EUR 500.00 limit, read, then paid by the agent alone; checked at each step:
// - 1280×800 (public /try) and 1280×800 at ?present=1&phone=0: the rail sits to the right of the steps, 310 px wide,
//   inside the window, not over the steps, no horizontal scroll, its four modules there (Claude, agents, under the hood,
//   partner rails) with Visa Intelligent Commerce as a word in its white pill, and no navigation links in it;
// - 390×844: the rail is in the page under the step, closed, opens on a tap, no horizontal scroll.
// npx tsx test/browser/try-rail.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { LIVE } from "../../cloud/src/tryCopy.js";
import { gotoLoaded, launchBrowser } from "./support/browser.js";

const shots = process.argv[2] ?? "test-results/try-rail";
mkdirSync(shots, { recursive: true });
const PORT = 9400 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "try-rail-check-admin-token-not-a-secret";
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "try-rail-check-"));
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

type Geo = { rail: { x: number; y: number; w: number; h: number; right: number; side: boolean; open: boolean; shown: boolean } | null; main: { x: number; right: number } | null; sw: number; iw: number; text: string; links: number; visa: { bg: string; text: string } | null; modules: number };
const geo = (page: Page) => page.evaluate((): Geo => {
  const r = document.querySelector<HTMLElement>(".pv-rail"), m = document.querySelector<HTMLElement>("#main");
  const rb = r?.getBoundingClientRect(), mb = m?.getBoundingClientRect();
  const visaEl = [...document.querySelectorAll<HTMLElement>(".pv-rail .pv-m-rails li")].find((li) => /Visa Intelligent Commerce/.test(li.textContent ?? ""));
  const pill = visaEl?.querySelector<HTMLElement>(".pv-word, .hw-logo, .pill") ?? visaEl ?? null;
  return {
    rail: r && rb ? { x: rb.x, y: rb.y, w: rb.width, h: rb.height, right: rb.right, side: r.classList.contains("side"), open: r.classList.contains("open"), shown: getComputedStyle(r).display !== "none" && rb.width > 0 } : null,
    main: mb ? { x: mb.x, right: mb.right } : null,
    sw: document.documentElement.scrollWidth, iw: innerWidth, text: r?.innerText ?? "",
    links: r ? r.querySelectorAll("a[href]").length : -1,
    visa: pill ? { bg: getComputedStyle(pill).backgroundColor, text: pill.textContent ?? "" } : null,
    modules: r ? r.querySelectorAll(".pv-rail-b > *").length : 0,
  };
});

const browser = await launchBrowser();
const errors: string[] = [];
async function open(path: string, width: number, height: number) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path} ${width}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${path} ${width}: ${m.text()}`); });
  await gotoLoaded(page, `${ORIGIN}${path}`);
  await page.waitForTimeout(800);
  return { ctx, page };
}

function sideChecks(g: Geo, tag: string) {
  ok(g.rail?.shown, `${tag}: the rail is on screen`);
  if (!g.rail || !g.main) return;
  ok(g.rail.side, `${tag}: the rail sits beside the steps`);
  ok(Math.abs(g.rail.w - 310) <= 1, `${tag}: the rail is 310 px wide (${g.rail.w})`);
  ok(g.rail.right <= g.iw, `${tag}: the rail ends inside the window (${g.rail.right} ≤ ${g.iw})`);
  ok(g.rail.x >= g.main.right, `${tag}: the rail does not cover the steps (rail ${g.rail.x} ≥ steps ${g.main.right})`);
  ok(g.sw <= g.iw, `${tag}: no horizontal scroll (${g.sw} ≤ ${g.iw})`);
  ok(g.links === 0, `${tag}: no navigation links in the rail (${g.links})`);
}
function moduleChecks(g: Geo, tag: string) {
  // 19 Nov 2026 (live review): this cloud has no model key, so Purser's code reads and decides; the rail names the roles
  // ("Reader", "Checker", "Payer") and says code did the work in this run, never "Reader agent: Claude reads the PDF".
  for (const w of ["Live engine", "Claude", "Reader", "Checker", "Payer", "Under the hood", "Airwallex", "Alta", "Visa Intelligent Commerce"]) ok(g.text.toLowerCase().includes(w.toLowerCase()), `${tag}: the rail shows "${w}"`); // its headings are upper case
  ok(!/Claude reads the PDF/.test(g.text), `${tag}: the rail does not say Claude reads the PDF (code read it in this run)`);
  ok(g.visa && /rgb\(255, 255, 255\)/.test(g.visa.bg), `${tag}: Visa Intelligent Commerce in a white pill (${g.visa?.bg})`);
}

// 1. Public /try at 1280: the agent pays the EUR 120.00 invoice alone.
{
  const { ctx, page } = await open("/try", 1280, 800);
  await page.getByRole("button", { name: /Start the live demo|Launch the live transfer demo/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /A small invoice inside the agent's limit/ }).first().click();
  await page.getByRole("button", { name: /File this invoice|Give it to the AI agent/ }).click();
  await page.getByRole("button", { name: "See the agent pay it" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  let g = await geo(page);
  sideChecks(g, "/try 1280 (checks done)"); moduleChecks(g, "/try 1280 (checks done)");
  ok(/Auto-pay ≤ EUR 500\.00/.test(g.text), `/try 1280: the mandate reads "Auto-pay ≤ EUR 500.00"`);
  ok(/amount <= agent_limit/.test(g.text) && /120\.00/.test(g.text), "/try 1280: the code window shows amount <= agent_limit with 120.00");
  ok(await page.getByText("Checks passed. Approved by your policy.").isVisible(), "/try 1280: the heading says the policy approved it");
  // 16 Nov (Max: "out of the text box"): the answer uses the whole step column, the button on one line.
  const cols = await page.evaluate(() => { const m = document.querySelector("#main")!.getBoundingClientRect(), r = document.querySelector(".screen.work .result")!.getBoundingClientRect(), b = document.querySelector(".screen.work .payrow .btn")!.getBoundingClientRect(); return { main: m.width, res: r.width, btnH: b.height }; });
  ok(cols.res >= cols.main * 0.85, `/try 1280: the work answer fills the column (${Math.round(cols.res)} of ${Math.round(cols.main)} px)`);
  ok(cols.btnH <= 64, `/try 1280: the pay button is one line (${Math.round(cols.btnH)} px high)`);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector(".pv-cap")!).position !== "sticky"), "/try 1280: the step bar does not stick over the page");
  ok(await page.evaluate(() => [...document.querySelectorAll(".pv-m-rails .hw-logo")].every((e) => Number(getComputedStyle(e).opacity) === 1 && Number(getComputedStyle(e.parentElement!).opacity) === 1)), "/try 1280: the partner logos are not dimmed");
  ok(!(await page.getByText("Waiting for your approval").count()), "/try 1280: no \"Waiting for your approval\" within the limit");
  await page.screenshot({ path: join(shots, "desktop-1280-work.png") });
  await page.getByRole("button", { name: "See the agent pay it" }).click();
  await page.waitForFunction(() => /within_limit/.test(document.querySelector(".pv-rail")?.textContent ?? ""), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(800);
  g = await geo(page);
  sideChecks(g, "/try 1280 (paid)");
  ok(/within_limit/.test(g.text), "/try 1280 (paid): the code window shows the within_limit audit entry");
  ok(/Auto-pay ≤ EUR 500\.00/.test(g.text), "/try 1280 (paid): the mandate stays auto-pay");
  await page.screenshot({ path: join(shots, "desktop-1280-paid.png") });
  // On to the invoice above the limit: the button says so and picks the EUR 1,850.00 sample.
  const onward = page.getByRole("button", { name: "Try an invoice above EUR 500 →" });
  await onward.waitFor({ timeout: 30_000 }).catch(() => {});
  ok(await onward.isVisible(), "/try 1280 (paid): the main button reads \"Try an invoice above EUR 500 →\"");
  await onward.click().catch(() => {});
  await page.locator(".samples button[aria-pressed=true]").first().waitFor({ timeout: 30_000 }).catch(() => {});
  const chosen = await page.locator(".samples button[aria-pressed=true]").first().innerText().catch(() => "");
  ok(/1,850\.00/.test(chosen), `/try 1280: the invoice above the limit is picked (${chosen.replace(/\s+/g, " ").slice(0, 80)})`);
  await ctx.close();
}

// 2. Recording mode at 1280 without the phone frame.
{
  const { ctx, page } = await open("/try?present=1&phone=0", 1280, 800);
  await page.getByRole("button", { name: /Start the live demo|Launch the live transfer demo/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /A small invoice inside the agent's limit/ }).first().click();
  await page.waitForTimeout(800);
  const g = await geo(page);
  sideChecks(g, "?present=1&phone=0 1280"); moduleChecks(g, "?present=1&phone=0 1280");
  await page.screenshot({ path: join(shots, "present-1280.png") });
  await ctx.close();
}

// 3. Phone: a closed drawer under the step, opened by a tap.
{
  const { ctx, page } = await open("/try", 390, 844);
  // 19 Nov 2026 (live review: the button started at y≈926 on a 390 x 844 phone): the main button is on the first screen.
  const launch = await page.getByRole("button", { name: /Start the live demo|Launch the live transfer demo/ }).boundingBox();
  ok(launch && launch.y >= 0 && launch.y + launch.height <= 844, `390 x 844: "Launch the live transfer demo" is on the first screen (bottom ${launch ? Math.round(launch.y + launch.height) : "none"} ≤ 844)`);
  await page.screenshot({ path: join(shots, "phone-390-start.png") });
  await page.getByRole("button", { name: /Start the live demo|Launch the live transfer demo/ }).click();
  await page.waitForTimeout(1500);
  let g = await geo(page);
  ok(g.rail?.shown && !g.rail.side && !g.rail.open, "390: the rail is a closed drawer in the page");
  // 19 Nov 2026 (live review): the EUR 1,850.00 sample is above the agent's limit, so it says it needs a signature; the
  // "held on purpose" heading comes before the first held sample (the EUR 480.00 one cash holds), not after it.
  await page.locator(".samples button[aria-pressed]").first().waitFor({ timeout: 30_000 });
  const picker = (await page.locator(".samples").innerText()).replace(/\s+/g, " ");
  ok(/Needs your signature.*?1,850\.00/.test(picker) && !/Ready to pay/.test(picker), `390: the EUR 1,850.00 sample says it needs your signature (${picker.slice(0, 160)})`);
  ok(picker.indexOf("Held on purpose") >= 0 && picker.indexOf("Held on purpose") < picker.indexOf("480.00"), "390: \"Held on purpose\" comes before the EUR 480.00 sample cash holds");
  ok(g.sw <= g.iw, `390: no horizontal scroll (${g.sw} ≤ ${g.iw})`);
  await page.locator(".pv-rail-h").click();
  await page.waitForTimeout(400);
  g = await geo(page);
  ok(g.rail?.open, "390: a tap opens the drawer");
  ok(g.sw <= g.iw, `390 (open): no horizontal scroll (${g.sw} ≤ ${g.iw})`);
  ok(g.rail && g.rail.right <= g.iw, "390 (open): the drawer fits the screen");
  moduleChecks(g, "390 (open)");
  await page.screenshot({ path: join(shots, "phone-390-drawer.png"), fullPage: true });
  await ctx.close();
}

// 4. 19 Nov 2026 (live review): the hosted run whose Claude switch said "live" while its action cap was unset. The start
//    answer says Claude is live and the engine's events say every call was capped (claude.capped, agent.run unavailable,
//    as the hosted engine wrote them that day), stood in here on top of this cloud's real answers. The page must count no
//    call and say Purser's code read the invoice.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`capped 1280: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`capped 1280: ${m.text()}`); });
  await ctx.route("**/v1/try/start", async (route) => {
    const res = await route.fetch();
    const j = await res.json() as { mode?: Record<string, string> };
    await route.fulfill({ response: res, json: { ...j, mode: { ...(j.mode ?? {}), claude: "live", agents: "live" } } });
  });
  await ctx.route("**/v1/engine/events*", async (route) => {
    const u = new URL(route.request().url());
    const after = u.searchParams.get("after");
    if (after && !/^\d+$/.test(after)) u.searchParams.set("after", String(Math.floor(Number(after))));
    const res = await route.fetch({ url: u.href });
    const j = await res.json() as { items?: { seq: number; event: string; fields?: Record<string, unknown> }[] };
    const items = Array.isArray(j.items) ? j.items : [];
    const add = items.filter((e) => e.event === "ap.received" && e.fields?.amount === "1850.00").flatMap((e) => [
      { ...e, seq: e.seq - 0.5, event: "claude.capped", fields: { reason: "action_budget" } },
      ...["checker", "coder", "payer"].map((agent, i) => ({ ...e, seq: e.seq + 0.1 * (i + 1), event: "agent.run", fields: { agent, model: "claude-haiku-5-5", status: "unavailable", turns: 0, cost_usd_micros: 0, latency_ms: 0 } })),
    ]);
    await route.fulfill({ response: res, json: { ...j, items: [...items, ...add].sort((a, b) => a.seq - b.seq) } });
  });
  await gotoLoaded(page, `${ORIGIN}/try`);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Start the live demo|Launch the live transfer demo/ }).click();
  await page.locator(".samples button[aria-pressed]").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /A supplier's invoice/ }).first().click();
  await page.getByRole("button", { name: /File this invoice|Give it to the AI agent/ }).click();
  await page.getByRole("button", { name: /Send to CFO for approval/ }).waitFor({ timeout: 60_000 });
  // Who read the invoice reaches the rail with the engine's own events (claude.capped, then the read), which the page
  // polls once a second; until then the rail says what the start's mode said. Wait on that state, not on a fixed time
  // (21 Nov: a 1.2 s wait failed now and then in the judge job): the rail naming Purser's code as the reader, in its
  // header and its code window. If it never does, the checks below fail as before.
  await page.waitForFunction(() => { const t = document.querySelector<HTMLElement>(".pv-rail")?.innerText ?? ""; return /Purser’s code read the invoice in this run/.test(t) && /what Purser’s code read/.test(t); }, undefined, { timeout: 20_000 }).catch(() => undefined);
  const g = await geo(page);
  const body = await page.evaluate(() => document.body.innerText);
  ok(!/\d+ calls? this run/.test(g.text) && !/\d+ calls?\b/.test(g.text.split("\n").slice(0, 3).join(" ")), `capped 1280: the rail counts no Claude call (${g.text.replace(/\s+/g, " ").slice(0, 120)})`);
  // 21 Nov 2026 (Max): a strength, never an absence: Purser's code read it, its rules decide.
  ok(/Purser’s code read the invoice in this run/.test(g.text) && /Purser's rules · no AI needed/.test(g.text) && !/no Claude call|Not asked/i.test(g.text), "capped 1280: the rail says Purser's code read it and its rules decide, no \"no Claude call\"");
  ok(!/Haiku/.test(g.text), "capped 1280: no agent run that never reached Claude is listed as a Haiku call");
  ok(/what Purser’s code read/.test(g.text) && !/what Claude read/.test(g.text), "capped 1280: the code window says what Purser's code read");
  ok(!/Claude reads the PDF/.test(g.text), "capped 1280: the agents module does not say Claude reads the PDF");
  ok(!/The AI agent read the invoice/.test(body) && /Purser's code read the invoice and checked it\./.test(body), "capped 1280: the step's line says Purser's code read the invoice");
  // Max, 19 Nov 2026: the visitor sees it in the main flow, why first, not only in the rail.
  const notice = page.locator("#main .screen.work .pv-paused");
  ok(await notice.isVisible() && (await notice.innerText()).startsWith(`Live Claude is paused right now: ${LIVE.caps.action_budget}.`), `capped 1280: the reading step says live Claude is paused and why (${(await notice.innerText().catch(() => "none")).slice(0, 90)})`);
  await page.screenshot({ path: join(shots, "capped-1280-work.png") });
  await ctx.close();
}

// 5. 19 Nov 2026: the live case, stood in the same way: the engine's events say Claude read the invoice (claude.read, and
//    ap.received's read_by "claude:<model>"). One call is counted, the live words stay, and no "paused" notice shows.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`live 1280: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`live 1280: ${m.text()}`); });
  await ctx.route("**/v1/try/start", async (route) => {
    const res = await route.fetch();
    const j = await res.json() as { mode?: Record<string, string> };
    await route.fulfill({ response: res, json: { ...j, mode: { ...(j.mode ?? {}), claude: "live" } } });
  });
  await ctx.route("**/v1/engine/events*", async (route) => {
    const u = new URL(route.request().url());
    const after = u.searchParams.get("after");
    if (after && !/^\d+$/.test(after)) u.searchParams.set("after", String(Math.floor(Number(after))));
    const res = await route.fetch({ url: u.href });
    const j = await res.json() as { items?: { seq: number; event: string; fields?: Record<string, unknown> }[] };
    const items = (Array.isArray(j.items) ? j.items : []).filter((e) => e.event !== "claude.fallback")
      .map((e) => (e.event === "ap.received" ? { ...e, fields: { ...(e.fields ?? {}), read_by: "claude:claude-haiku-5-5" } } : e));
    const add = items.filter((e) => e.event === "ap.received" && e.fields?.amount === "1850.00").map((e) => ({ ...e, seq: e.seq - 0.5, event: "claude.read", fields: { source: "claude", model: "claude-haiku-5-5", request_id: "req_0123456789abcdef", cost_usd_micros: 1234, latency_ms: 900 } }));
    await route.fulfill({ response: res, json: { ...j, items: [...items, ...add].sort((a, b) => a.seq - b.seq) } });
  });
  await gotoLoaded(page, `${ORIGIN}/try`);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Start the live demo|Launch the live transfer demo/ }).click();
  await page.locator(".samples button[aria-pressed]").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /A supplier's invoice/ }).first().click();
  await page.getByRole("button", { name: /File this invoice|Give it to the AI agent/ }).click();
  await page.getByRole("button", { name: /Send to CFO for approval/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  const g = await geo(page);
  ok(/1 Claude call this run/.test(g.text) && /Reader agent/.test(g.text) && /Claude reads the PDF/.test(g.text), `live 1280: one Claude call counted and the live words kept (${g.text.replace(/\s+/g, " ").slice(0, 120)})`);
  ok(await page.locator(".pv-paused").count() === 0, "live 1280: no \"paused\" notice when Claude read the invoice");
  ok(/The AI agent read the invoice and checked it\./.test(await page.evaluate(() => document.body.innerText)), "live 1280: the step's line says the AI agent read it");
  await page.screenshot({ path: join(shots, "live-1280-work.png") });
  await ctx.close();
}

ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
