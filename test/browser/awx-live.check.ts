// Purser Cloud's Airwallex tab in Chromium, on this machine (14 Nov): a guest opens the demo company and the Airwallex
// tab, at laptop and phone width. The cloud's gateway is the real one (worker/src/awxRead.ts) over a stand-in for the
// sandbox that answers ONLY with rows the repo's records hold from earlier live sandbox runs (ids and amounts as recorded:
// docs/runs/2026-11-12-airwallex-financial-transactions.json, docs/demo/airwallex-run.json, the payee check's record).
// Views neither a record nor the live read below holds (receiving accounts, cards) answer HTTP 503 here, so the page shows its
// "Airwallex sandbox unavailable" state for them: nothing is made up. The live page is read after the deploy.
// It checks: every card ends live or unavailable (never stuck loading), the reconciliation says "0 differences" only as
// computed, ids are in full with a copy button, no console or CSP errors, nothing wider than the phone.
// npx tsx test/browser/awx-live.check.ts [screenshot dir]
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { sqlOver } from "../../src/relay/local.js";
import { AwxReadDesk, type AwxView } from "../../worker/src/awxRead.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8890 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as Record<string, unknown>;

// The recorded sandbox rows, as Airwallex gave them (amounts back in major units).
const ft = (read("docs/runs/2026-11-12-airwallex-financial-transactions.json").audit as { event: string; payload: { items?: Record<string, unknown>[] } }[])
  .find((a) => a.event === "awx_ft.read")!.payload.items!.map((i) => ({ ...i, amount: (i.amount_cents as number) / 100, fee: (i.fee_cents as number) / 100, net: (i.net_cents as number) / 100 }));
const run = read("docs/demo/airwallex-run.json") as { invoices: { transfer_id: string | null; amount: string; status: string; approval_sha256: string; paid_at: string }[] };
const transfers = run.invoices.filter((i) => i.transfer_id).map((i) => ({ id: i.transfer_id, status: i.status, transfer_amount: i.amount, transfer_currency: "EUR", created_at: i.paid_at, metadata: { approval_sha256: i.approval_sha256 } }));
// The beneficiary the recorded runs paid (src/cli/awxDepth.ts, STOCKLINE).
const beneficiaries = [{ id: "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb", beneficiary: { entity_type: "COMPANY", company_name: "Stockline Data GmbH", bank_details: { iban: "DE02120300000000202051", bank_country_code: "DE", account_currency: "EUR" } } }];

// Balances and rates as the deployed gateway read them live from the sandbox (14 Nov, 18:50 UTC): the four currencies
// with money, and 42 more at 0 (the sandbox lists every currency it offers); the rates with their currency pair.
const LIVE_NONZERO = [["CNY", "10000000", "10000000"], ["EUR", "9970627", "9970954.99"], ["GBP", "10001085.5", "10001085.5"], ["USD", "9994630.19", "9994630.19"]];
const ZERO = ["AED", "ARS", "AUD", "BDT", "BHD", "BOB", "BRL", "CAD", "CHF", "CLP", "COP", "CZK", "DKK", "EGP", "HKD", "HUF", "IDR", "ILS", "INR", "JPY", "KES", "KRW", "LKR", "MAD", "MXN", "MYR", "NGN", "NOK", "NPR", "NZD", "PEN", "PHP", "PKR", "PLN", "RON", "SAR", "SEK", "SGD", "THB", "TRY", "UYU", "VND"];
const balancesLive = [...LIVE_NONZERO.map(([currency, available, total]) => ({ currency, available_amount: available, pending_amount: 0, reserved_amount: 0, total_amount: total })),
  ...ZERO.map((currency) => ({ currency, available_amount: 0, pending_amount: 0, reserved_amount: 0, total_amount: 0 }))];
const ratesLive: Record<string, { rate: number; currency_pair: string }> = { "USD>EUR": { rate: 1.116374, currency_pair: "EURUSD" }, "GBP>EUR": { rate: 0.844602, currency_pair: "EURGBP" }, "EUR>USD": { rate: 1.08768, currency_pair: "EURUSD" } };

const standIn = (async (input: string) => {
  const u = new URL(input), p = u.pathname;
  if (p === "/api/v1/balances/current") return Response.json(balancesLive);
  if (p === "/api/v1/fx/rates/current") { const sell = u.searchParams.get("sell_currency"), buy = u.searchParams.get("buy_currency"); return Response.json({ sell_currency: sell, buy_currency: buy, ...ratesLive[`${sell}>${buy}`] }); }
  if (p === "/api/v1/authentication/login") return Response.json({ token: "stand-in-token-" + "x".repeat(30) }, { status: 201 });
  if (p === "/api/v1/financial_transactions") return Response.json({ items: ft, has_more: false });
  if (p === "/api/v1/transfers") return Response.json({ items: transfers });
  if (p === "/api/v1/beneficiaries") return Response.json({ items: beneficiaries });
  return Response.json({ code: "unavailable" }, { status: 503 });
}) as unknown as typeof fetch;
const desk = new AwxReadDesk(sqlOver(new Database(":memory:")), { clientId: "stand-in", apiKey: "stand-in", fetchImpl: standIn });

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "awx-live-check-"));
const env: CloudEnv = { sql: sqliteSql(":memory:"), blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "c".repeat(48), adminTokenSha256: createHash("sha256").update("x").digest("hex"),
  rpId: "localhost", origin: ORIGIN, mailDomain: "", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  awxRead: { read: (v: string) => desk.read(v as AwxView) } };
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

const browser = await chromium.launch();
try {
  for (const [w, h, name] of [[1440, 1000, "1440"], [390, 844, "390"]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: shots ? 2 : 1, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" && !/status of 429/.test(m.text())) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${ORIGIN}/#/guest`);
    await page.waitForFunction(() => location.hash === "#/overview" && document.body.classList.contains("signed-in"));
    // The tab, as a person reaches it (on a phone the menu wraps to a second row).
    await page.click("#tabs a[data-tab='airwallex']");
    await page.waitForFunction(() => document.querySelectorAll(".awcard").length === 9 && [...document.querySelectorAll(".awcard .awstamp")].every((s) => s.textContent!.trim() !== ""), null, { timeout: 15_000 });
    const states = await page.$$eval(".awcard", (cs) => cs.map((c) => [(c as HTMLElement).dataset.view, c.querySelector(".awlive") ? "live" : c.querySelector(".awbad") ? "unavailable" : "loading"]));
    const st = Object.fromEntries(states);
    ok(Object.values(st).every((s) => s !== "loading"), `${name}: every card ends live or unavailable (${JSON.stringify(st)})`);
    ok(["balances", "rates", "reconcile", "financial", "transfers", "beneficiaries", "calls"].every((k) => st[k] === "live"), `${name}: the views the stand-in holds read through the gateway`);
    ok(["accounts", "issuing"].every((k) => st[k] === "unavailable"), `${name}: views the stand-in does not hold say "Airwallex sandbox unavailable", nothing made up`);
    // Balances: the four with money first, the 42 at 0 folded into one line.
    ok(JSON.stringify(await page.$$eval(".aw-balances .awtile .awtl", (n) => n.map((x) => x.textContent))) === JSON.stringify(["EUR", "USD", "GBP", "CNY"]), `${name}: balances with money only, the books' currencies first`);
    ok((await page.textContent(".aw-balances details.awzero summary"))?.trim() === "42 other currencies at 0.00", `${name}: the zeros folded into one line`);
    await page.waitForTimeout(1300); // the count-up ends on Airwallex's own figure
    ok((await page.textContent(".aw-balances .awtile b"))?.includes("9,970,627.00") === true, `${name}: the count-up ends on the real figure (${await page.textContent(".aw-balances .awtile b")})`);
    // Rates: in the pair's own terms, buy side named.
    const rates = await page.$$eval(".aw-rates .awtile", (n) => n.map((x) => [x.querySelector(".awtl")!.textContent, x.querySelector("b")!.textContent]));
    ok(JSON.stringify(rates) === JSON.stringify([["Sell USD, buy EUR", "1 EUR = 1.116374 USD"], ["Sell GBP, buy EUR", "1 EUR = 0.844602 GBP"], ["Sell EUR, buy USD", "1 EUR = 1.08768 USD"]]), `${name}: the rates read the right way round (${JSON.stringify(rates)})`);
    ok(await page.$eval(".awhead img.awlogo", (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 2435), `${name}: the official logo, its own size, in the header`);
    const rec = await page.textContent(".aw-reconcile .awrec");
    ok(/^0 differences: all \d+ movements match to the cent\.$/.test(rec?.trim() ?? ""), `${name}: the reconciliation says 0 differences as computed (${rec?.trim()})`);
    const ids = await page.$$eval(".aw-transfers code.awid", (cs) => cs.map((c) => c.textContent));
    ok(ids.includes(transfers[0]!.id!) && ids.includes(run.invoices[0]!.approval_sha256), `${name}: transfer ids and approval hashes in full`);
    ok((await page.$$eval(".aw-transfers .obadge.ok", (b) => b.length)) === transfers.length, `${name}: each recorded transfer's approval hash matches the record`);
    if (name === "1440") {
      await page.click(".aw-transfers .awcopy");
      ok((await page.evaluate(() => navigator.clipboard.readText())) === transfers[0]!.id, `${name}: the copy button copies the full id`);
    }
    ok(await page.$eval("#tabs a[data-tab='airwallex']", (a) => a.getAttribute("aria-current") === "page"), `${name}: the Airwallex tab is the current page`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(wide <= 0, `${name}: nothing wider than the screen (${wide}px over)`);
    const callsText = await page.textContent(".aw-calls .awcalls");
    ok(/\d+ calls to the Airwallex sandbox/.test(callsText ?? ""), `${name}: the calls panel counts the calls (${callsText?.trim()})`);
    ok(!(await page.content()).includes("stand-in-token"), `${name}: no token on the page`);
    ok(errors.length === 0, `${name}: no console or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    if (shots) await page.screenshot({ path: join(shots, `console-airwallex-standin-${name}.png`), fullPage: true });
    // The Overview's live card, apart from the demo month.
    await page.click("#tabs a[data-tab='overview']");
    await page.waitForSelector(".awov .awlive", { timeout: 15_000 });
    await page.waitForTimeout(1300);
    const ov = await page.$eval(".awov", (c) => c.textContent ?? "");
    ok(/test money/.test(ov) && /simulated month/.test(ov) && /EUR/.test(ov) && /1 EUR = 1\.116374 USD/.test(ov), `${name}: the Overview card shows live balances and a rate, labelled apart from the demo month`);
    ok(await page.$eval(".awov a.awov-go", (a) => a.getAttribute("href")) === "#/airwallex", `${name}: the Overview card opens the Airwallex tab`);
    ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${name}: the Overview is no wider than the screen`);
    if (shots) await (await page.$(".awov"))!.screenshot({ path: join(shots, `console-overview-airwallex-standin-${name}.png`) });
    // The Agents tab links here.
    await page.goto(`${ORIGIN}/#/agents`);
    await page.waitForSelector("a[href='#/airwallex']:not([data-tab])");
    ok(true, `${name}: the Agents tab links to the agents' live cards`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
