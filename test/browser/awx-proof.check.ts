// Live with Airwallex on /proof and Home, in Chromium, on this machine (14 Nov). The site's pages (src/relay/assets.ts)
// are served as the Worker serves them (worker/src/core.ts pageResponse), with the Worker's own live routes:
//   /awx-live/books.json and .svg  the reconciliation badge (worker/src/awxBooks.ts), from the real gateway
//                                  (worker/src/awxRead.ts) over a stand-in for the sandbox that answers ONLY with the
//                                  financial transactions the repo recorded from the live sandbox on 12 Nov
//   /awx-live/events.json          the relay's feed, holding the webhooks Airwallex sent in the recorded run of 7 Nov,
//                                  replayed through the relay's signature check (./awxReplay.ts)
// Then the same pages with the sandbox down: the badge goes grey and says when it last checked. It checks: the badge's
// words (never N/N), the events with their object ids in full and "Signature verified", Home's image, no console or CSP
// errors, nothing wider than the phone.
// npx tsx test/browser/awx-proof.check.ts [screenshot dir]
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildPages } from "../../src/relay/assets.js";
import { sqlOver } from "../../src/relay/local.js";
import { notFoundResponse, pageResponse } from "../../worker/src/core.js";
import { AwxReadDesk } from "../../worker/src/awxRead.js";
import { awxBooksResponse, booksCache, isAwxBooksPath } from "../../worker/src/awxBooks.js";
import { AWX_EVENTS_PATH } from "../../worker/src/awxEvents.js";
import { replayedRelay } from "./awxReplay.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

const ft = (JSON.parse(readFileSync(new URL("../../docs/runs/2026-11-12-airwallex-financial-transactions.json", import.meta.url), "utf8")).audit as { event: string; payload: { items?: Record<string, unknown>[] } }[])
  .find((a) => a.event === "awx_ft.read")!.payload.items!.map((i) => ({ ...i, amount: (i.amount_cents as number) / 100, fee: (i.fee_cents as number) / 100, net: (i.net_cents as number) / 100 }));
let sandboxUp = true;
const standIn = (async (input: string) => {
  if (!sandboxUp) throw new Error("down");
  const p = new URL(input).pathname;
  if (p === "/api/v1/authentication/login") return Response.json({ token: "stand-in-token-" + "x".repeat(30) }, { status: 201 });
  if (p === "/api/v1/financial_transactions") return Response.json({ items: ft, has_more: false });
  return Response.json({ code: "unavailable" }, { status: 503 });
}) as unknown as typeof fetch;

const pages = buildPages(process.env);
const relay = await replayedRelay();
let books = booksCache(() => new AwxReadDesk(sqlOver(new Database(":memory:")), { clientId: "stand-in", apiKey: "stand-in", fetchImpl: standIn }).read("financial"));
let base = "";
const server = createServer((req, res) => {
  void (async () => {
    const request = new Request(`${base}${req.url}`, { method: req.method });
    const path = new URL(request.url).pathname;
    const r = pageResponse(request, pages) ?? (isAwxBooksPath(path) ? await awxBooksResponse(request, books) : path === AWX_EVENTS_PATH ? await relay.fetch(request) : notFoundResponse(pages));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  })();
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
base = `http://localhost:${(server.address() as { port: number }).port}`;

const browser = await chromium.launch();
try {
  for (const state of ["live", "down"] as const) {
    if (state === "down") { sandboxUp = false; books = booksCache(() => new AwxReadDesk(sqlOver(new Database(":memory:")), { clientId: "stand-in", apiKey: "stand-in", fetchImpl: standIn }).read("financial")); }
    for (const [w, h, name] of [[1440, 1000, "1440"], [390, 844, "390"]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: shots ? 2 : 1 });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${base}/proof#awx-live`);
      await page.waitForFunction(() => !/Checking|Not checked/.test(document.querySelector("[data-axl-badge-text]")?.textContent ?? "") && !/Checking|Not checked/.test(document.querySelector("[data-axl-ev-state]")?.textContent ?? ""), null, { timeout: 15_000 });
      const badge = (await page.textContent("[data-axl-badge]"))?.replace(/\s+/g, " ").trim() ?? "";
      const cls = await page.getAttribute("[data-axl-badge]", "class");
      if (state === "live") ok(/Purser's books = Airwallex's transactions\s*all \d+ matched · checked \d\d:\d\d UTC/.test(badge) && cls?.includes("ok"), `${name}: /proof's badge is green, in words (${badge})`);
      else ok(/Airwallex unavailable · last checked \d\d:\d\d UTC/.test(badge) && cls?.includes("grey"), `${name}: with the sandbox down the badge is grey and says when (${badge})`);
      ok(!/\d+\s*\/\s*\d+/.test(badge), `${name}: no N/N on the badge`);
      const ids = await page.$$eval("[data-axl-ev] .axl-id code", (cs) => cs.map((c) => c.textContent));
      ok(ids.length === 5 && ids.includes("4140dee2-6373-4eb4-a71f-bf69130f96a7"), `${name}: the five newest events, object ids in full (${ids.length})`);
      ok((await page.$$eval("[data-axl-ev] .axl-ok", (b) => b.filter((x) => /Signature verified/.test(x.textContent ?? "")).length)) === 5, `${name}: each event says its signature verified`);
      ok(/^Last event: \d+ Nov, \d\d:\d\d UTC/.test((await page.textContent("[data-axl-ev-state]"))?.trim() ?? ""), `${name}: the feed says when the last event came`);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(wide <= 0, `${name}: /proof is no wider than the screen (${wide}px over)`);
      if (shots) await page.locator("#awx-live").screenshot({ path: join(shots, `proof-awx-live-${state}-${name}.png`) });
      await page.goto(`${base}/home`);
      const img = page.locator(".h-axl img");
      await img.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".h-axl img"); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10_000 });
      ok(await img.isVisible(), `${name}: Home shows the badge image`);
      ok((await page.getAttribute(".h-axl a", "href")) === "proof#awx-live", `${name}: Home's badge links to /proof's block`);
      const hw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(hw <= 0, `${name}: Home is no wider than the screen (${hw}px over)`);
      if (shots && state === "live") await page.locator(".e-hero .copy").screenshot({ path: join(shots, `home-awx-badge-${name}.png`) });
      ok(errors.length === 0, `${name}: no console or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
