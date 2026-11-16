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
  for (const w of ["Live engine", "Claude", "Invoice Reader", "Policy Guard", "Settlement Executor", "Under the hood", "Airwallex", "Alta", "Visa Intelligent Commerce"]) ok(g.text.includes(w), `${tag}: the rail shows "${w}"`);
  ok(g.visa && /rgb\(255, 255, 255\)/.test(g.visa.bg), `${tag}: Visa Intelligent Commerce in a white pill (${g.visa?.bg})`);
}

// 1. Public /try at 1280: the agent pays the EUR 120.00 invoice alone.
{
  const { ctx, page } = await open("/try", 1280, 800);
  await page.getByRole("button", { name: /Launch the live transfer demo/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /A small invoice inside the agent's limit/ }).first().click();
  await page.getByRole("button", { name: /File this invoice|Give it to the AI agent/ }).click();
  await page.getByRole("button", { name: "See the agent pay it" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  let g = await geo(page);
  sideChecks(g, "/try 1280 (checks done)"); moduleChecks(g, "/try 1280 (checks done)");
  ok(/Auto-pay ≤ EUR 500\.00/.test(g.text), `/try 1280: the mandate reads "Auto-pay ≤ EUR 500.00"`);
  ok(/amount <= agent_limit/.test(g.text) && /120\.00/.test(g.text), "/try 1280: the code window shows amount <= agent_limit with 120.00");
  await page.screenshot({ path: join(shots, "desktop-1280-work.png") });
  await page.getByRole("button", { name: "See the agent pay it" }).click();
  await page.waitForFunction(() => /within_limit/.test(document.querySelector(".pv-rail")?.textContent ?? ""), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(800);
  g = await geo(page);
  sideChecks(g, "/try 1280 (paid)");
  ok(/within_limit/.test(g.text), "/try 1280 (paid): the code window shows the within_limit audit entry");
  ok(/Auto-pay ≤ EUR 500\.00/.test(g.text), "/try 1280 (paid): the mandate stays auto-pay");
  await page.screenshot({ path: join(shots, "desktop-1280-paid.png") });
  await ctx.close();
}

// 2. Recording mode at 1280 without the phone frame.
{
  const { ctx, page } = await open("/try?present=1&phone=0", 1280, 800);
  await page.getByRole("button", { name: /Launch the live transfer demo/ }).click();
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
  await page.getByRole("button", { name: /Launch the live transfer demo/ }).click();
  await page.waitForTimeout(1500);
  let g = await geo(page);
  ok(g.rail?.shown && !g.rail.side && !g.rail.open, "390: the rail is a closed drawer in the page");
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

ok(errors.length === 0, `no console or page error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : "all ok");
process.exit(failed ? 1 : 0);
