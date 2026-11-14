// Purser Cloud's Airwallex actions in Chromium, on this machine (14 Nov): a signed-in company with the engine, the
// admin's switch on and small caps, and an IN-MEMORY STAND-IN in Airwallex's place (no network, no sandbox call: the
// live run is the deployment's). A new supplier is checked and signed for with a virtual passkey, its invoice is paid
// with a second signature and followed to PAID, money comes in, then the invoice page and Invoices at 1440 and 390.
// It checks: no console or CSP errors, nothing wider than the phone, the transfer id in full, the bank's label.
// npx tsx test/browser/awx-act.check.ts [screenshot dir]
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { sessionToken } from "../../cloud/src/auth.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { SAMPLES } from "../../cloud/src/engine/samples.gen.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { FakePayeeNames } from "../../src/airwallex/payeeName.js";
import type { Rails3 } from "../../src/airwallex/routedRail.js";
import { FakeAirwallex } from "../../src/redteam/airwallex.js";

const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 8890 + Math.floor(Math.random() * 100);
const ORIGIN = `http://localhost:${PORT}`;
const ADMIN = "awx-act-check-admin-token-not-a-secret";
const SECRET = "c".repeat(48);
let failed = 0;
const ok = (cond: unknown, what: string) => { if (cond) console.log(`ok    ${what}`); else { failed++; console.log(`FAIL  ${what}`); } };

/** The stand-in with ids in Airwallex's shape, so the console shows what an Airwallex id looks like (not a real one). */
function standIn(fake: FakeAirwallex): Rails3 {
  const out = (v: unknown): unknown => typeof v === "string" ? v.replace(/^([a-z]+)_(\d+)$/, "local-standin-$1-$2")
    : Array.isArray(v) ? v.map(out) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, out(x)])) : v;
  const back = (v: unknown): unknown => typeof v === "string" ? v.replace(/^local-standin-([a-z]+)-(\d+)$/, "$1_$2")
    : Array.isArray(v) ? v.map(back) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)])) : v;
  return new Proxy(fake, { get: (t, k) => {
    const f = (t as unknown as Record<string | symbol, unknown>)[k];
    return typeof f === "function" ? async (...a: unknown[]) => out(await (f as (...x: unknown[]) => Promise<unknown>).apply(t, a.map(back))) : f;
  } }) as unknown as Rails3;
}

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "awx-act-check-"));
const sql = sqliteSql(":memory:");
const env: CloudEnv = {
  sql, blobs: dirBlobs(join(dir, "blobs")), sessionSecret: SECRET, adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
  rpId: "localhost", origin: ORIGIN, mailDomain: "in.purser.test", rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  asset: async (path) => (path === "/assets/pdfjs.mjs" ? new Response(readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")))) : null),
};
const awxFake = new FakeAirwallex();
env.engine = nodeEngines({ sql, blobs: env.blobs, rpId: "localhost", origin: ORIGIN, awxStandIn: { rail: standIn(awxFake), payees: Object.assign(new FakePayeeNames(), { confirmAll: true }) } });
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`${ORIGIN}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));
const call = async (method: string, path: string, key: string, body?: unknown) => {
  const r = await fetch(`${ORIGIN}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", origin: ORIGIN }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
};

const made = await call("POST", "/v1/admin/tenants", ADMIN, { slug: "northwind", name: "Northwind Outdoor (test company)", owner: { display_name: "The CFO" } });
ok(made.status === 201, "a test company");
// The admin's switch on and small caps (500.00 a company, 2,000.00 in all, a day).
for (const [k, v] of <[string, string][]>[["awx_act", "on"], ["awx_act_company_cents_day", "50000"], ["awx_act_global_cents_day", "200000"]]) await sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES (?, ?, '')", [k, v]);
const tenant = (made.json.tenant as { id: string } | undefined)?.id ?? (await sql.first<{ id: string }>("SELECT id FROM tenants WHERE slug = 'northwind'"))!.id;
const owner = (await sql.first<{ id: string; session_gen: number }>("SELECT id, session_gen FROM users WHERE tenant_id = ? AND role = 'owner'", [tenant]))!;
await call("POST", "/v1/company", made.json.api_key as string, { language: "en" });
const session = await sessionToken(SECRET, { tenantId: tenant, userId: owner.id, role: "owner", gen: owner.session_gen }, new Date());
for (const key of ["unknown", "clean"]) {
  const s = SAMPLES.find((x) => x.key === key)!;
  const up = await call("POST", "/v1/engine/documents", session, { filename: s.filename, mime: "application/pdf", base64: s.base64 });
  ok(up.status === 201 || up.status === 200, `the sample "${key}" is filed (${up.status})`);
}

ok((await call("POST", "/v1/engine/sync", session)).status === 200, "the read model is fed");

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: shots ? 2 : 1 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await page.goto(`${ORIGIN}/#/invoices`);
await page.evaluate((s) => sessionStorage.setItem("purser.cloud.session", JSON.stringify({ token: s, exp: Date.now() + 14 * 60_000 })), session);

const invoices = (await call("GET", "/v1/engine/invoices", session)).json.items as { id: string; status: string; vendor: string }[];
const zeeland = invoices.find((i) => i.status === "needs_vendor")!;
ok(!!zeeland, "an invoice waits for a new supplier");

// The new supplier: the owner's check, the payee's bank, then the CFO's passkey (made here on first use).
await page.goto(`${ORIGIN}/#/invoices/${encodeURIComponent(zeeland.id)}`);
await page.reload();
await page.waitForSelector(".awx-form", { timeout: 20_000 });
await page.fill(".awx-form input[name=how]", "Called their finance desk on the number in our contract file");
await page.fill(".awx-form input[name=street]", "Havenweg 1");
await page.fill(".awx-form input[name=city]", "Vlissingen");
await page.fill(".awx-form input[name=postcode]", "4381 AA");
await page.click("text=Check and file for the CFO");
await page.waitForSelector("text=Set up approval on this device", { timeout: 20_000 });
await page.click("text=Set up approval on this device");
await page.waitForSelector("text=Approve with passkey", { timeout: 20_000 });
await page.click("#pay >> text=Approve with passkey");
await page.waitForTimeout(1500);
// Pay: planned at "Airwallex" (the stand-in), signed, sent, followed to PAID.
await page.reload();
await page.waitForSelector("#pay >> text=Pay…", { timeout: 20_000 });
await page.click("#pay >> text=Pay…");
await page.waitForSelector("#pay >> text=Approve with passkey", { timeout: 20_000 });
ok(/Airwallex sandbox, with test money/.test((await page.textContent("#pay")) ?? ""), "the payment card says it runs at the Airwallex sandbox, with test money");
await page.click("#pay >> text=Approve with passkey");
await page.waitForTimeout(2000);
await page.reload();
await page.waitForSelector("#airwallex >> text=PAID", { timeout: 30_000 });
const card = (await page.textContent("#airwallex")) ?? "";
ok(/Airwallex sandbox · test money/.test(card), "the invoice's Airwallex card names the bank and test money");
ok(/local-standin-tr-\d+/.test(card) && /local-standin-ben-\d+/.test(card), "the transfer id and the beneficiary id are shown in full");
ok(awxFake.transfers.length === 1 && awxFake.transfers[0]!.status === "PAID", "one transfer at the stand-in, PAID");
const snap = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, name), fullPage: true }); };
await page.locator("#airwallex").scrollIntoViewIfNeeded();
await snap("console-airwallex-invoice-1440.png");

// Invoices: Pay all ready, and money in.
await page.goto(`${ORIGIN}/#/invoices`);
await page.waitForSelector("text=Simulate a deposit", { timeout: 20_000 });
await page.click("text=Simulate a deposit");
await page.waitForSelector("text=Deposit booked", { timeout: 20_000 });
ok(/local-standin-dep-\d+/.test((await page.textContent(".awx")) ?? ""), "money in: the deposit's id is shown");
await snap("console-airwallex-invoices-1440.png");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${ORIGIN}/#/invoices/${encodeURIComponent(zeeland.id)}`);
await page.waitForSelector("#airwallex >> text=PAID", { timeout: 20_000 });
const wide = await page.evaluate(() => document.documentElement.scrollWidth);
ok(wide <= 390, `nothing wider than the phone (${wide})`);
await page.locator("#airwallex").scrollIntoViewIfNeeded();
await snap("console-airwallex-invoice-390.png");
await page.goto(`${ORIGIN}/#/invoices`);
await page.waitForSelector("text=Simulate a deposit", { timeout: 20_000 });
await snap("console-airwallex-invoices-390.png");

ok(errors.length === 0, `no console or CSP errors${errors.length ? ` (${errors.join(" | ")})` : ""}`);
await browser.close();
server.close();
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);
